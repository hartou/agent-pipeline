#!/usr/bin/env node
// Minimal multi-agent runner for Northfield Mentor.
//
// Fugu (Sakana) acts as the ORCHESTRATOR: it reads the customer request + a task
// spec and decomposes it into bounded worker sub-tasks. DeepSeek-4-pro and
// gpt-4o-mini act as WORKERS: each produces a PROPOSAL (files/diffs as text) for
// its assigned slice. Nothing is applied to the repo automatically — the human
// reviewer (Copilot / PM) integrates accepted output. This mirrors the repo's
// acceptance loop in agent-context/handoff.md.
//
// Usage:
//   node tools/agent-runner/run.mjs orchestrate --task agent-tasks/<f>.md [--out agent-output/<f>.plan.json]
//   node tools/agent-runner/run.mjs worker --provider deepseek|openai|fugu \
//        --task agent-tasks/<f>.md [--context <file> ...] [--out agent-output/<f>.<provider>.md]
//
// Env (read from .env at repo root; never printed):
//   SAKANA_FUGU_API_KEY, DEEPSEEK_API_KEY, DeepSeek_Model, OPENAI_API_KEY, OPENAI_MODEL

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';

const ROOT = resolve(process.cwd());

function parseEnvFile(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

async function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return { ...process.env };
  const fileEnv = parseEnvFile(await readFile(envPath, 'utf8'));
  return { ...fileEnv, ...process.env };
}

function providerConfig(name, env) {
  switch (name) {
    case 'fugu':
      return {
        label: 'fugu',
        baseUrl: 'https://api.sakana.ai/v1',
        apiKey: env.SAKANA_FUGU_API_KEY,
        model: env.FUGU_MODEL || 'fugu',
        extra: { reasoning_effort: 'high' },
      };
    case 'deepseek':
      return {
        label: 'deepseek-4-pro',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: env.DEEPSEEK_API_KEY,
        model: env.DeepSeek_Model || env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
        extra: {},
      };
    case 'openai':
      return {
        label: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        extra: {},
      };
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

async function chat(cfg, messages, maxTokens = 4000) {
  if (!cfg.apiKey) throw new Error(`Missing API key for provider ${cfg.label}`);
  const body = {
    model: cfg.model,
    messages,
    max_completion_tokens: maxTokens,
    ...cfg.extra,
  };
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${cfg.label} HTTP ${res.status}: ${text.slice(0, 500)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${cfg.label} non-JSON response: ${text.slice(0, 500)}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${cfg.label} empty content: ${text.slice(0, 500)}`);
  return { content, usage: json.usage };
}

async function readContextFiles(files) {
  const parts = [];
  for (const f of files) {
    const p = resolve(ROOT, f);
    if (!existsSync(p)) {
      parts.push(`# (missing) ${f}\n`);
      continue;
    }
    parts.push(`# FILE: ${f}\n\n${await readFile(p, 'utf8')}`);
  }
  return parts.join('\n\n---\n\n');
}

function parseArgs(argv) {
  const args = { _: [], context: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--context') args.context.push(argv[++i]);
    else if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

const ORCHESTRATOR_SYSTEM = `You are Fugu, the orchestrator/PM for the Northfield Mentor repo.
Read the customer request and the given task spec, then decompose the work into
bounded worker sub-tasks. Assign each sub-task to the best-fit worker:
- "deepseek-4-pro": broad, multi-file implementation slices.
- "gpt-4o-mini": small, well-specified, focused edits.
Respect the task's stated scope and out-of-scope. Do NOT invent files or APIs.
Output STRICT JSON only (no prose, no markdown fences) with this shape:
{"epic":"...","subtasks":[{"id":"...","title":"...","worker":"deepseek-4-pro|gpt-4o-mini","files":["..."],"instructions":"...","acceptance":["..."]}],"review_focus":["..."]}`;

const WORKER_SYSTEM = `You are an implementation worker for the Northfield Mentor repo
(React 19 + Vite + Tailwind v4 web app; thin Node/TS node:http signaling service).
Produce a PROPOSAL for your assigned slice only. Output concise Markdown with, for
each file, its full new/updated contents in a fenced code block labeled with the
path. Rules: modify existing files minimally, never delete unrelated code, keep
scope tight, no new heavy dependencies unless required, and never expose secrets
to the browser. If something is ambiguous, list it under a "Flags" section instead
of guessing. Keep it reviewable.`;

const BUILD_SYSTEM = `You are an implementation worker building directly into the
Northfield Mentor repo. Stack facts you MUST follow (do not deviate):
- Signaling service uses Node's built-in \`node:http\` (NOT Express/Koa) and the
  global \`fetch\` (NOT node-fetch). Config is read via \`loadConfig(env)\` in
  config.ts (NOT dotenv). Routes are plain handlers \`(req,res,config)=>\` wired in
  routing.ts's \`routes\` array. Responses use helpers in lib/response.ts
  (\`readJsonBody\`, \`sendJson\`, \`sendError\`). ESM imports use \`.js\` extensions.
- Web app is React 19 + Vite + Tailwind v4 + shadcn-style components in
  src/components/ui. API calls go through src/lib/api.ts to VITE_SIGNALING_URL.
Implement ONLY your assigned slice and ONLY the listed files. Modify existing
files minimally; never delete unrelated code; never expose secrets to the browser.
Output ONLY file blocks in this EXACT format and nothing else (no prose, no
markdown fences):
@@@FILE: <repo-relative path>
<the COMPLETE file contents after your change>
@@@END
Repeat one block per file. Do NOT use ellipses ("...") or placeholders or omit any
code — every block must contain the entire file, ready to write to disk.`;

function parseFileBlocks(text) {
  const blocks = [];
  const re = /@@@FILE:[ \t]*(.+?)[ \t]*\r?\n([\s\S]*?)\r?\n@@@END/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push({ path: m[1].trim(), content: m[2] });
  }
  return blocks;
}

async function writeRepoFiles(files) {
  const written = [];
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') {
      throw new Error(`Invalid file entry: ${JSON.stringify(f)?.slice(0, 120)}`);
    }
    const abs = resolve(ROOT, f.path);
    if (!abs.startsWith(ROOT + '/')) throw new Error(`Refusing path outside repo: ${f.path}`);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.content, 'utf8');
    written.push(f.path);
  }
  return written;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  const env = await loadEnv();

  if (mode === 'orchestrate') {
    if (!args.task) throw new Error('orchestrate requires --task');
    const cfg = providerConfig('fugu', env);
    const request = existsSync(join(ROOT, 'agent-tasks/webrtc-customer-request.md'))
      ? await readFile(join(ROOT, 'agent-tasks/webrtc-customer-request.md'), 'utf8')
      : '';
    const task = await readFile(resolve(ROOT, args.task), 'utf8');
    const feedback = args.feedback && existsSync(resolve(ROOT, args.feedback))
      ? await readFile(resolve(ROOT, args.feedback), 'utf8')
      : '';
    const userContent = feedback
      ? `CUSTOMER REQUEST:\n\n${request}\n\n---\n\nTASK SPEC:\n\n${task}\n\n---\n\nCLIENT QA FEEDBACK — the previous build FAILED acceptance. Produce a minimal FIX plan (subtasks in the same JSON shape) that only addresses this failure; do not re-scope the whole epic:\n\n${feedback}`
      : `CUSTOMER REQUEST:\n\n${request}\n\n---\n\nTASK SPEC:\n\n${task}`;
    const messages = [
      { role: 'system', content: ORCHESTRATOR_SYSTEM },
      { role: 'user', content: userContent },
    ];
    process.stderr.write(`[orchestrate] calling ${cfg.label} (${cfg.model})...\n`);
    const { content, usage } = await chat(cfg, messages, 6000);
    const out = args.out || `agent-output/${basename(args.task, '.md')}.plan.json`;
    await mkdir(dirname(resolve(ROOT, out)), { recursive: true });
    await writeFile(resolve(ROOT, out), content, 'utf8');
    process.stderr.write(`[orchestrate] wrote ${out} (usage: ${JSON.stringify(usage)})\n`);
    process.stdout.write(content + '\n');
    return;
  }

  if (mode === 'build') {
    if (!args.plan || !args.subtask) throw new Error('build requires --plan and --subtask');
    const plan = JSON.parse(await readFile(resolve(ROOT, args.plan), 'utf8'));
    const sub = (plan.subtasks || []).find((s) => s.id === args.subtask);
    if (!sub) throw new Error(`Subtask ${args.subtask} not found in plan`);
    // Client can override the worker (e.g. --provider deepseek to always use DeepSeek-4-pro).
    const providerName = args.provider
      ? args.provider
      : sub.worker === 'deepseek-4-pro' ? 'deepseek' : 'openai';
    const cfg = providerConfig(providerName, env);
    // Feed the worker the current contents of its target files so it edits minimally.
    const existing = await readContextFiles((sub.files || []).filter((p) => existsSync(resolve(ROOT, p))));
    const messages = [
      { role: 'system', content: BUILD_SYSTEM },
      {
        role: 'user',
        content: `SUBTASK ${sub.id}: ${sub.title}\n\nASSIGNED FILES (only these):\n${(sub.files || []).join('\n')}\n\nINSTRUCTIONS:\n${sub.instructions}\n\nACCEPTANCE:\n${(sub.acceptance || []).join('\n')}\n\n---\n\nCURRENT CONTENTS OF EXISTING TARGET FILES:\n\n${existing || '(all target files are new)'}`,
      },
    ];
    process.stderr.write(`[build:${cfg.label}] ${sub.id} calling ${cfg.model}...\n`);
    const { content, usage } = await chat(cfg, messages, 8000);
    const files = parseFileBlocks(content);
    if (files.length === 0) {
      const dump = `agent-output/${sub.id}.raw.txt`;
      await mkdir(dirname(resolve(ROOT, dump)), { recursive: true });
      await writeFile(resolve(ROOT, dump), content, 'utf8');
      throw new Error(`${cfg.label} returned no @@@FILE blocks (saved to ${dump})`);
    }
    const written = await writeRepoFiles(files);
    process.stderr.write(`[build:${cfg.label}] ${sub.id} wrote ${written.length} file(s): ${written.join(', ')} (usage: ${JSON.stringify(usage)})\n`);
    return;
  }

  if (mode === 'worker') {
    if (!args.provider || !args.task) throw new Error('worker requires --provider and --task');
    const cfg = providerConfig(args.provider, env);
    const task = await readFile(resolve(ROOT, args.task), 'utf8');
    const context = args.context.length ? await readContextFiles(args.context) : '';
    const messages = [
      { role: 'system', content: WORKER_SYSTEM },
      { role: 'user', content: `TASK:\n\n${task}${context ? `\n\n---\n\nCONTEXT FILES:\n\n${context}` : ''}` },
    ];
    process.stderr.write(`[worker:${cfg.label}] calling ${cfg.model}...\n`);
    const { content, usage } = await chat(cfg, messages, 6000);
    const out = args.out || `agent-output/${basename(args.task, '.md')}.${args.provider}.md`;
    await mkdir(dirname(resolve(ROOT, out)), { recursive: true });
    await writeFile(resolve(ROOT, out), content, 'utf8');
    process.stderr.write(`[worker:${cfg.label}] wrote ${out} (usage: ${JSON.stringify(usage)})\n`);
    return;
  }

  throw new Error('Usage: run.mjs <orchestrate|worker> --task <file> [--provider <p>] [--context <f> ...] [--out <file>]');
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err.message}\n`);
  process.exit(1);
});
