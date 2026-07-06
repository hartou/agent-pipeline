#!/usr/bin/env node
// agent-pipeline — deterministic, config-driven multi-agent delivery runner.
//
// Roles (real-world software team):
//   Client (you/Copilot) -> talks only to the Orchestrator, tests the REAL
//     output, approves/rejects.
//   Orchestrator (Fugu)  -> decomposes a request into bounded worker subtasks.
//   Workers (deepseek-4-pro, gpt-4o-mini) -> write product code DIRECTLY into the
//     real repo. No sandbox, no staging folder, no "build then move".
//
// Everything repo-specific (providers, models, key ENV names, paths, QA commands,
// stack facts, telemetry) lives in pipeline.config.json. Keys are referenced by
// env-var NAME only and read from .env at call time; never stored or printed.
//
// Verbs:
//   init [--force|--upgrade]                    scaffold config + agent mode
//   doctor                                      preflight: node, config, keys, QA
//   plan   --task <f> [--feedback <f>]          orchestrate -> JSON plan
//   build  --plan <p> --subtask <id> [--provider p] [--context f...]
//   qa                                          run QA commands against real output
//   run    --task <f>                           full loop plan->build->qa->retry
//   report [--run <run_id>]                     aggregate telemetry per worker
//   orchestrate | worker                        legacy aliases

import { readFile, writeFile, mkdir, appendFile, readdir, rm } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, basename, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.cwd());
const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(ENGINE_DIR, 'pipeline.config.json');

function engineScriptRel() {
  return relative(ROOT, join(ENGINE_DIR, 'run.mjs')) || 'run.mjs';
}

function engineVersion() {
  try {
    return JSON.parse(readFileSync(join(ENGINE_DIR, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function parseEnvFile(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const source = line.trim().replace(/^export\s+/, '');
    if (!source || source.startsWith('#')) continue;
    const m = source.match(/^([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/);
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

async function loadRegistry() {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found: ${CONFIG_PATH}\nRun: node tools/agent-runner/run.mjs init`);
  }
  return JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
}

function allActors(reg) {
  const out = {};
  if (reg.actors?.orchestrator) out.orchestrator = { key: 'orchestrator', ...reg.actors.orchestrator };
  for (const [k, v] of Object.entries(reg.actors?.workers || {})) out[k] = { key: k, ...v };
  return out;
}

// Resolve by actor key ("orchestrator", "deepseek-4-pro"), by provider
// ("deepseek", "openai", "sakana"), or by legacy alias ("fugu").
function resolveActor(nameOrProvider, reg, env) {
  const actors = allActors(reg);
  let a = actors[nameOrProvider];
  if (!a) {
    const alias = { fugu: 'sakana' };
    const want = alias[nameOrProvider] || nameOrProvider;
    a = Object.values(actors).find((x) => x.provider === want);
  }
  if (!a) throw new Error(`Unknown actor/provider: ${nameOrProvider}`);
  const modelEnv = [a.modelEnv, ...(a.modelEnvAlternates || [])].find((name) => name && env[name]);
  const apiKeyEnv = [a.apiKeyEnv, ...(a.apiKeyEnvAlternates || [])].find((name) => name && env[name]) || a.apiKeyEnv;
  const baseUrl = a.baseUrlEnv && env[a.baseUrlEnv] ? env[a.baseUrlEnv] : a.baseUrl;
  const model = modelEnv ? env[modelEnv] : a.model;
  return {
    label: a.key,
    role: a.role,
    provider: a.provider,
    baseUrl,
    apiKeyEnv,
    apiKey: apiKeyEnv ? env[apiKeyEnv] : undefined,
    model,
    extra: a.params || {},
    maxTokens: a.maxTokens || 4000,
    pricing: a.pricing || null,
  };
}

// ---- telemetry (Tier-1, auto-appended machine log) ----
const TELEMETRY_COLUMNS = [
  'ts_iso', 'engine_version', 'run_id', 'round', 'verb', 'actor', 'role',
  'provider', 'model', 'prompt_tokens', 'completion_tokens', 'total_tokens',
  'latency_ms', 'http_status', 'result', 'qa_passed', 'qa_failed',
  'files_written', 'est_cost_usd', 'task_file', 'error',
];

const AUTHORSHIP_COLUMNS = [
  'ts_iso', 'engine_version', 'run_id', 'round', 'subtask_id', 'file_path',
  'action', 'actor', 'role', 'provider', 'model',
];

function csvField(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function estCost(pricing, usage) {
  if (!pricing) return '';
  const inRate = pricing.inputPer1M || 0;
  const outRate = pricing.outputPer1M || 0;
  if (inRate === 0 && outRate === 0) return '';
  const p = usage?.prompt_tokens || 0;
  const c = usage?.completion_tokens || 0;
  return ((p / 1e6) * inRate + (c / 1e6) * outRate).toFixed(6);
}

// Serialize telemetry writes within this process so parallel in-process builds
// can't interleave rows. (Container workers each write their own shard file.)
let telemetryChain = Promise.resolve();
async function logTelemetry(reg, row) {
  const csvPath = process.env.PIPELINE_TELEMETRY_CSV || reg?.telemetry?.csv;
  if (!csvPath) return undefined;
  const write = async () => {
    const abs = resolve(ROOT, csvPath);
    await mkdir(dirname(abs), { recursive: true });
    if (!existsSync(abs)) await writeFile(abs, TELEMETRY_COLUMNS.join(',') + '\n', 'utf8');
    const full = { ts_iso: new Date().toISOString(), engine_version: engineVersion(), ...row };
    await appendFile(abs, TELEMETRY_COLUMNS.map((c) => csvField(full[c])).join(',') + '\n', 'utf8');
  };
  telemetryChain = telemetryChain.then(write, write);
  return telemetryChain;
}

let authorshipChain = Promise.resolve();
async function logFileAuthorship(reg, rows) {
  const csvPath = process.env.PIPELINE_AUTHORSHIP_CSV || reg?.telemetry?.fileAuthors || 'agent-context/file-authorship.csv';
  if (!csvPath || !rows.length) return undefined;
  const write = async () => {
    const abs = resolve(ROOT, csvPath);
    await mkdir(dirname(abs), { recursive: true });
    if (!existsSync(abs)) await writeFile(abs, AUTHORSHIP_COLUMNS.join(',') + '\n', 'utf8');
    const ts = new Date().toISOString();
    const version = engineVersion();
    const lines = rows.map((row) => AUTHORSHIP_COLUMNS.map((c) => csvField({ ts_iso: ts, engine_version: version, ...row }[c])).join(','));
    await appendFile(abs, lines.join('\n') + '\n', 'utf8');
  };
  authorshipChain = authorshipChain.then(write, write);
  return authorshipChain;
}

async function chat(cfg, messages, maxTokens = 4000) {
  if (!cfg.apiKey) {
    throw new Error(`Missing API key for ${cfg.label}: set ${cfg.apiKeyEnv} in .env`);
  }
  const body = {
    model: cfg.model,
    messages,
    max_completion_tokens: maxTokens,
    ...cfg.extra,
  };
  const started = Date.now();
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - started;
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
  return { content, usage: json.usage, latencyMs, httpStatus: res.status };
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

const BOOL_FLAGS = new Set(['force', 'upgrade', 'skill', 'skip-skill', 'skip-init', 'skip-agents-md']);
function parseArgs(argv) {
  const args = { _: [], context: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--context') args.context.push(argv[++i]);
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      if (BOOL_FLAGS.has(key)) args[key] = true;
      else args[key] = argv[++i];
    } else args._.push(a);
  }
  return args;
}

function workerRoster(reg) {
  return Object.entries(reg.actors?.workers || {})
    .map(([k, v]) => `- "${k}": ${(v.bestFor || []).join('; ') || 'general implementation'}.`)
    .join('\n');
}

function orchestratorSystem(reg) {
  return `You are the orchestrator/PM for the ${reg.project} repo.
Read the customer request and the given task spec, then decompose the work into
bounded worker sub-tasks. Assign each sub-task to the best-fit worker:
${workerRoster(reg)}
Respect the task's stated scope and out-of-scope. Do NOT invent files or APIs.
Optimize for wall-clock speed: split independent, file-disjoint work into separate
sub-tasks and leave their "dependsOn" arrays empty. Do NOT add dependencies for
preference, review order, or convenience; add them only when a later task truly
needs output from an earlier task or when two tasks edit the same file.
Tag each sub-task with a "kind":
- "build": the worker writes/edits code files (this is the default for
  implementation work).
- "verify": a verification/health/smoke check only. It MUST NOT change code; the
  client runs the repo's real QA to confirm it. Leave "files" empty for verify.
YOU OWN COORDINATION. Declare the execution order with "dependsOn" (a list of
sub-task ids that must finish first). Sub-tasks with no unmet dependencies run in
PARALLEL, so:
- Give independent sub-tasks empty "dependsOn" so they run concurrently.
- Two sub-tasks that edit the SAME file must NOT be concurrent — chain them with
  "dependsOn" so they run one after another.
Output STRICT JSON only (no prose, no markdown fences) with this shape:
{"epic":"...","subtasks":[{"id":"...","title":"...","kind":"build|verify","worker":"<worker-key>","dependsOn":["..."],"files":["..."],"instructions":"...","acceptance":["..."]}],"review_focus":["..."]}`;
}

const WORKER_SYSTEM = `You are an implementation worker for the Northfield Mentor repo
(React 19 + Vite + Tailwind v4 web app; thin Node/TS node:http signaling service).
Produce a PROPOSAL for your assigned slice only. Output concise Markdown with, for
each file, its full new/updated contents in a fenced code block labeled with the
path. Rules: modify existing files minimally, never delete unrelated code, keep
scope tight, no new heavy dependencies unless required, and never expose secrets
to the browser. If something is ambiguous, list it under a "Flags" section instead
of guessing. Keep it reviewable.`;

function buildSystem(reg) {
  const facts = (reg.stackFacts || []).map((f) => `- ${f}`).join('\n');
  return `You are an implementation worker building directly into the ${reg.project} repo.
Stack facts you MUST follow (do not deviate):
${facts || '- (no stack facts configured)'}
Implement ONLY your assigned slice and ONLY the listed files. Modify existing
files minimally; never delete unrelated code; never expose secrets to the browser.
Output ONLY file blocks in this EXACT format and nothing else (no prose, no
markdown fences):
@@@FILE: <repo-relative path>
<the COMPLETE file contents after your change>
@@@END
Repeat one block per file. Do NOT use ellipses ("...") or placeholders or omit any
code — every block must contain the entire file, ready to write to disk.`;
}

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
    const action = existsSync(abs) ? 'updated' : 'created';
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.content, 'utf8');
    written.push({ path: f.path, action });
  }
  return written;
}

// ---- pipeline stages ----

async function doOrchestrateInProcess({ reg, env, task, feedback, runId, round }) {
  const cfg = resolveActor('orchestrator', reg, env);
  const requestPath = reg.paths?.request ? resolve(ROOT, reg.paths.request) : null;
  const request = requestPath && existsSync(requestPath) ? await readFile(requestPath, 'utf8') : '';
  const userContent = feedback
    ? `CUSTOMER REQUEST:\n\n${request}\n\n---\n\nTASK SPEC:\n\n${task}\n\n---\n\nCLIENT QA FEEDBACK — the previous build FAILED acceptance. Produce a minimal FIX plan (subtasks in the same JSON shape) that only addresses this failure; do not re-scope the whole epic:\n\n${feedback}`
    : `CUSTOMER REQUEST:\n\n${request}\n\n---\n\nTASK SPEC:\n\n${task}`;
  const messages = [
    { role: 'system', content: orchestratorSystem(reg) },
    { role: 'user', content: userContent },
  ];
  process.stderr.write(`[plan] ${cfg.label} (${cfg.model})...\n`);
  let out;
  try {
    out = await chat(cfg, messages, cfg.maxTokens);
  } catch (err) {
    await logTelemetry(reg, {
      run_id: runId, round, verb: 'plan', actor: cfg.label, role: cfg.role,
      provider: cfg.provider, model: cfg.model, result: 'error', error: err.message,
    });
    throw err;
  }
  await logTelemetry(reg, {
    run_id: runId, round, verb: 'plan', actor: cfg.label, role: cfg.role,
    provider: cfg.provider, model: cfg.model,
    prompt_tokens: out.usage?.prompt_tokens, completion_tokens: out.usage?.completion_tokens,
    total_tokens: out.usage?.total_tokens, latency_ms: out.latencyMs, http_status: out.httpStatus,
    result: 'plan_ok', est_cost_usd: estCost(cfg.pricing, out.usage),
  });
  return out.content;
}

function containerOrchestratorEnabled(reg) {
  return !!reg.container?.enabled && reg.container.orchestrator !== false;
}

function containerWorkersEnabled(reg) {
  return !!reg.container?.enabled && reg.container.workers !== false;
}

function safeName(x) {
  return String(x).replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function spawnCapture(command, args) {
  return new Promise((resolveP) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on('close', (code) => resolveP({ exitCode: code ?? 1, stdout, stderr }));
    child.on('error', (error) => resolveP({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` }));
  });
}

async function doOrchestrateInContainer({ reg, task, feedback, runId, round }) {
  ensureImage(reg);
  const artifacts = reg.paths?.artifacts || 'agent-output';
  const inputRel = join(artifacts, '.orchestrator', `${safeName(runId)}-r${round}.json`);
  await mkdir(dirname(resolve(ROOT, inputRel)), { recursive: true });
  await writeFile(resolve(ROOT, inputRel), JSON.stringify({ task, feedback, runId, round }), 'utf8');
  const shardRel = `${artifacts}/.telemetry/${safeName(runId)}__orchestrator_r${round}.csv`;
  const args = [
    'run', '--rm',
    '-v', `${ROOT}:/repo`, '-w', '/repo',
    '-e', `PIPELINE_TELEMETRY_CSV=/repo/${shardRel}`,
    reg.container.image,
    'node', engineScriptRel(), 'orchestrate-call', '--input', inputRel,
  ];
  process.stderr.write(`[plan] container orchestrator (${reg.container.image})...\n`);
  const result = await spawnCapture('docker', args);
  await mergeTelemetryShards(reg, join(artifacts, '.telemetry'));
  if (result.exitCode !== 0) {
    throw new Error(`containerized orchestrator failed with exit code ${result.exitCode}: ${result.stderr.slice(-500)}`);
  }
  return result.stdout.trim();
}

async function doOrchestrate(opts) {
  if (containerOrchestratorEnabled(opts.reg)) return doOrchestrateInContainer(opts);
  return doOrchestrateInProcess(opts);
}

async function doBuildSubtask({ reg, env, sub, providerOverride, contextFiles, runId, round }) {
  const cfg = resolveActor(providerOverride || sub.worker, reg, env);
  const existing = await readContextFiles((sub.files || []).filter((p) => existsSync(resolve(ROOT, p))));
  const extra = contextFiles?.length ? await readContextFiles(contextFiles) : '';
  const messages = [
    { role: 'system', content: buildSystem(reg) },
    {
      role: 'user',
      content: `SUBTASK ${sub.id}: ${sub.title}\n\nASSIGNED FILES (only these):\n${(sub.files || []).join('\n')}\n\nINSTRUCTIONS:\n${sub.instructions}\n\nACCEPTANCE:\n${(sub.acceptance || []).join('\n')}${extra ? `\n\n---\n\nREFERENCE / GROUND TRUTH:\n\n${extra}` : ''}\n\n---\n\nCURRENT CONTENTS OF EXISTING TARGET FILES:\n\n${existing || '(all target files are new)'}`,
    },
  ];
  process.stderr.write(`[build:${cfg.label}] ${sub.id} calling ${cfg.model}...\n`);
  let out;
  try {
    out = await chat(cfg, messages, cfg.maxTokens);
  } catch (err) {
    await logTelemetry(reg, {
      run_id: runId, round, verb: 'build', actor: cfg.label, role: cfg.role,
      provider: cfg.provider, model: cfg.model, result: 'error', error: err.message, task_file: sub.id,
    });
    throw err;
  }
  const files = parseFileBlocks(out.content);
  let result = 'build_ok';
  let written = [];
  let dumpPath;
  if (files.length === 0) {
    dumpPath = join(reg.paths?.artifacts || 'agent-output', `${sub.id}.raw.txt`);
    await mkdir(dirname(resolve(ROOT, dumpPath)), { recursive: true });
    await writeFile(resolve(ROOT, dumpPath), out.content, 'utf8');
    result = 'no_file_blocks';
  } else {
    written = await writeRepoFiles(files);
    await logFileAuthorship(reg, written.map((file) => ({
      run_id: runId,
      round,
      subtask_id: sub.id,
      file_path: file.path,
      action: file.action,
      actor: cfg.label,
      role: cfg.role,
      provider: cfg.provider,
      model: cfg.model,
    })));
  }
  await logTelemetry(reg, {
    run_id: runId, round, verb: 'build', actor: cfg.label, role: cfg.role,
    provider: cfg.provider, model: cfg.model,
    prompt_tokens: out.usage?.prompt_tokens, completion_tokens: out.usage?.completion_tokens,
    total_tokens: out.usage?.total_tokens, latency_ms: out.latencyMs, http_status: out.httpStatus,
    result, files_written: written.length, est_cost_usd: estCost(cfg.pricing, out.usage), task_file: sub.id,
  });
  // The engine does NOT decide that a build must produce files; it records the
  // outcome and lets the orchestrator (via the run loop) decide what happens next.
  if (result === 'no_file_blocks') {
    process.stderr.write(`[build:${cfg.label}] ${sub.id} produced no file changes (raw output at ${dumpPath}).\n`);
  } else {
    process.stderr.write(`[build:${cfg.label}] ${sub.id} wrote ${written.length} file(s): ${written.map((f) => f.path).join(', ')}\n`);
  }
  return { written, result, dumpPath };
}

// Runs the repo's real QA commands against the real output. Captures output so
// failures can be fed back to the orchestrator.
function runQaCommands(reg) {
  const cmds = reg.qa?.commands || [];
  const order = reg.qa?.order?.length ? reg.qa.order : cmds.map((c) => c.name);
  const results = [];
  for (const name of order) {
    const cmd = cmds.find((c) => c.name === name);
    if (!cmd) {
      results.push({ name, ok: false, code: null, output: 'command not defined in qa.commands' });
      continue;
    }
    process.stderr.write(`[qa] ${name}: ${cmd.run}\n`);
    const r = spawnSync(cmd.run, { cwd: ROOT, shell: true, encoding: 'utf8' });
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    process.stderr.write(output);
    results.push({ name, ok: r.status === 0, code: r.status, output: output.slice(-4000) });
  }
  const passed = results.filter((r) => r.ok).length;
  return { results, passed, failed: results.length - passed, allPass: results.every((r) => r.ok) };
}

// ---- telemetry reading / report ----

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split('\n').filter((l) => l.length);
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
}

async function doReport({ reg, runId }) {
  const csvPath = reg?.telemetry?.csv ? resolve(ROOT, reg.telemetry.csv) : null;
  if (!csvPath || !existsSync(csvPath)) {
    process.stdout.write('No telemetry recorded yet.\n');
    return;
  }
  const rows = parseCsv(await readFile(csvPath, 'utf8')).filter((r) => !runId || r.run_id === runId);
  const byActor = {};
  for (const r of rows) {
    if (r.verb !== 'plan' && r.verb !== 'build') continue;
    const a = (byActor[r.actor] ||= { calls: 0, total: 0, latency: 0, cost: 0, files: 0 });
    a.calls += 1;
    a.total += Number(r.total_tokens) || 0;
    a.latency += Number(r.latency_ms) || 0;
    a.cost += Number(r.est_cost_usd) || 0;
    a.files += Number(r.files_written) || 0;
  }
  const qaRows = rows.filter((r) => r.verb === 'qa');
  const qaGreen = qaRows.filter((r) => r.result === 'qa_green').length;
  process.stdout.write(`\n=== Pipeline report${runId ? ` (run ${runId})` : ''} ===\n`);
  process.stdout.write('actor             calls   tokens    avg_ms    est_usd   files\n');
  for (const [actor, a] of Object.entries(byActor)) {
    process.stdout.write(
      `${actor.padEnd(16)} ${String(a.calls).padStart(6)} ${String(a.total).padStart(8)} ${String(Math.round(a.latency / (a.calls || 1))).padStart(9)} ${a.cost.toFixed(4).padStart(10)} ${String(a.files).padStart(7)}\n`,
    );
  }
  process.stdout.write(`QA runs: ${qaRows.length} (green: ${qaGreen})\n`);
  const today = new Date().toISOString().slice(0, 10);
  const totalFiles = Object.values(byActor).reduce((n, a) => n + a.files, 0);
  process.stdout.write('\nDraft row for the curated ledger (annotate the <...> fields, then paste):\n');
  process.stdout.write(`${today},"<priority>","<batch>","<job>","<provider>","<model>","run","<task_file>","<result>","<qa_decision>","<integration_decision>",${totalFiles},"<validation>","<what_worked>","<what_failed>","<prompt_adjustment>","<next_use>"\n`);
}

// ---- init / doctor ----

async function doInit({ force }) {
  const targets = [
    { src: join(ENGINE_DIR, 'templates', 'pipeline.config.json'), dest: CONFIG_PATH, label: 'tools/agent-runner/pipeline.config.json' },
    { src: join(ENGINE_DIR, 'templates', 'orchestrator.agent.md'), dest: join(ROOT, '.github', 'agents', 'orchestrator.agent.md'), label: '.github/agents/orchestrator.agent.md' },
    { src: join(ENGINE_DIR, 'templates', 'agent-pipeline.instructions.md'), dest: join(ROOT, '.github', 'instructions', 'agent-pipeline.instructions.md'), label: '.github/instructions/agent-pipeline.instructions.md' },
  ];
  for (const t of targets) {
    if (existsSync(t.dest) && !force) {
      process.stderr.write(`[init] exists, skipped (use --force to overwrite): ${t.label}\n`);
      continue;
    }
    await mkdir(dirname(t.dest), { recursive: true });
    await writeFile(t.dest, await readFile(t.src, 'utf8'), 'utf8');
    process.stderr.write(`[init] wrote ${t.label}\n`);
  }
  process.stderr.write('[init] done. Edit pipeline.config.json for this repo, add keys to .env, then: doctor\n');
}

function isVendoredRunner() {
  return ENGINE_DIR === join(ROOT, 'tools', 'agent-runner');
}

function shouldBootstrapTarget(args) {
  if (isVendoredRunner()) return false;
  if (args.target) return true;
  if (ENGINE_DIR === ROOT) return false;
  return existsSync(join(ENGINE_DIR, '.github', 'skills', 'agent-orchestrator-installer', 'scripts', 'install-agent-orchestrator.mjs'));
}

function runBootstrapInit(args) {
  const installerPath = join(ENGINE_DIR, '.github', 'skills', 'agent-orchestrator-installer', 'scripts', 'install-agent-orchestrator.mjs');
  if (!existsSync(installerPath)) throw new Error(`Missing npm bootstrap installer: ${installerPath}`);
  const target = resolve(args.target || process.cwd());
  const installerArgs = [installerPath, '--target', target, '--source', ENGINE_DIR];
  if (args.force) installerArgs.push('--force');
  if (args.upgrade) installerArgs.push('--upgrade');
  if (args.skill) installerArgs.push('--skill');
  if (args['skip-skill']) installerArgs.push('--skip-skill');
  if (args['skip-init']) installerArgs.push('--skip-init');
  if (args['skip-agents-md']) installerArgs.push('--skip-agents-md');
  const result = spawnSync(process.execPath, installerArgs, { cwd: target, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Bootstrap init failed with exit code ${result.status}`);
}

function validateConfig(cfg) {
  const errs = [];
  const need = (obj, keys, path) => keys.forEach((k) => { if (obj?.[k] === undefined) errs.push(`missing ${path}.${k}`); });
  need(cfg, ['version', 'project', 'paths', 'actors', 'qa', 'loop', 'telemetry'], 'config');
  if (cfg.actors) {
    need(cfg.actors, ['client', 'orchestrator', 'workers'], 'actors');
    const api = { orchestrator: cfg.actors.orchestrator, ...(cfg.actors.workers || {}) };
    for (const [k, a] of Object.entries(api)) {
      if (a) need(a, ['provider', 'baseUrl', 'model', 'apiKeyEnv'], `actors.${k}`);
    }
  }
  return errs;
}

async function doDoctor({ reg, env }) {
  let ok = true;
  const line = (sym, msg) => process.stdout.write(`${sym} ${msg}\n`);
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) line('✓', `node ${process.versions.node}`);
  else { line('✗', `node ${process.versions.node} (need >=20)`); ok = false; }
  const errs = validateConfig(reg);
  if (errs.length === 0) line('✓', 'config schema');
  else { errs.forEach((e) => line('✗', e)); ok = false; }
  for (const a of Object.values(allActors(reg))) {
    const cfg = resolveActor(a.key, reg, env);
    const keyNames = [a.apiKeyEnv, ...(a.apiKeyEnvAlternates || [])].filter(Boolean).join(' or ');
    if (cfg.apiKey) line('✓', `${a.key}: key ${cfg.apiKeyEnv} present`);
    else { line('✗', `${a.key}: missing ${keyNames} in .env`); ok = false; }
  }
  const names = new Set((reg.qa?.commands || []).map((c) => c.name));
  for (const n of reg.qa?.order || []) {
    if (names.has(n)) line('✓', `qa command: ${n}`);
    else { line('✗', `qa order references unknown command: ${n}`); ok = false; }
  }
  if (reg.container?.enabled) {
    const d = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
    if (d.status === 0) line('✓', `docker available (${(d.stdout || '').trim()})`);
    else { line('✗', 'docker not available but container mode is enabled'); ok = false; }
  }
  process.stdout.write(ok ? '\nDOCTOR: all green\n' : '\nDOCTOR: issues found\n');
  if (!ok) process.exitCode = 1;
}

// ---- parallel execution (Fugu owns coordination via dependsOn; wiring executes) ----

// Execute a dependency graph with max parallelism. A sub-task runs once all its
// dependsOn are DONE and it shares no file with a currently-running sub-task
// (a safety net; Fugu should already sequence file-sharing tasks). runOne(sub)
// resolves to { exitCode } (0 = ok).
async function runGraph(subtasks, concurrency, runOne) {
  const byId = new Map(subtasks.map((s) => [s.id, s]));
  const done = new Set();
  const remaining = new Set(subtasks.map((s) => s.id));
  const running = new Map(); // id -> Promise<{ id, sub, r }>
  const lockedFiles = new Set();
  const results = [];
  const filesOf = (s) => s.files || [];
  const depsReady = (s) => (s.dependsOn || []).every((d) => !byId.has(d) || done.has(d));
  const clashes = (s) => filesOf(s).some((f) => lockedFiles.has(f));

  while (remaining.size > 0 || running.size > 0) {
    if (running.size < concurrency) {
      const started = [];
      for (const id of [...remaining]) {
        if (running.size >= concurrency) break;
        const s = byId.get(id);
        if (!depsReady(s) || clashes(s)) continue;
        filesOf(s).forEach((f) => lockedFiles.add(f));
        remaining.delete(id);
        started.push(id);
        running.set(id, (async () => ({ id, sub: s, r: await runOne(s) }))());
      }
      if (started.length) {
        process.stderr.write(`[graph] starting ${started.length}/${concurrency}: ${started.join(', ')}\n`);
      }
    }
    if (running.size === 0) {
      // everything left is blocked by an unmet dependency or a cycle
      for (const id of remaining) results.push({ sub: byId.get(id), r: { exitCode: 1, blocked: true } });
      break;
    }
    const { id, sub, r } = await Promise.race(running.values());
    running.delete(id);
    filesOf(sub).forEach((f) => lockedFiles.delete(f));
    if (!r.blocked && r.exitCode === 0) done.add(id);
    results.push({ sub, r });
  }
  return results;
}

function analyzeParallelism(subtasks) {
  const dependencyEdges = subtasks.reduce((n, s) => n + (s.dependsOn || []).length, 0);
  const initiallyReady = subtasks.filter((s) => !(s.dependsOn || []).length).length;
  let fileOverlapPairs = 0;
  for (let i = 0; i < subtasks.length; i += 1) {
    const left = new Set(subtasks[i].files || []);
    if (left.size === 0) continue;
    for (let j = i + 1; j < subtasks.length; j += 1) {
      if ((subtasks[j].files || []).some((f) => left.has(f))) fileOverlapPairs += 1;
    }
  }
  return { dependencyEdges, initiallyReady, fileOverlapPairs };
}

function ensureImage(reg) {
  const image = reg.container.image;
  if (spawnSync('docker', ['image', 'inspect', image], { stdio: 'ignore' }).status === 0) return;
  const dockerfile = reg.container.dockerfile || 'tools/agent-runner/Dockerfile';
  process.stderr.write(`[container] building image ${image} from ${dockerfile}...\n`);
  const build = spawnSync('docker', ['build', '-t', image, '-f', dockerfile, '.'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) throw new Error(`docker build failed for ${image}`);
}

function makeContainerRunner({ reg, image, planRel, runId, round, artifacts }) {
  return (sub) => new Promise((resolveP) => {
    const shardRel = `${artifacts}/.telemetry/${safeName(runId)}__${safeName(sub.id)}.csv`;
    const authorshipShardRel = `${artifacts}/.authorship/${safeName(runId)}__${safeName(sub.id)}.csv`;
    const args = [
      'run', '--rm',
      '-v', `${ROOT}:/repo`, '-w', '/repo',
      '-e', `PIPELINE_TELEMETRY_CSV=/repo/${shardRel}`,
      '-e', `PIPELINE_AUTHORSHIP_CSV=/repo/${authorshipShardRel}`,
      image,
      'node', engineScriptRel(), 'build',
      '--plan', planRel, '--subtask', sub.id, '--run-id', runId, '--round', String(round),
    ];
    process.stderr.write(`[run ${runId}] container ${sub.id} (${sub.worker})...\n`);
    const child = spawn('docker', args, { stdio: 'inherit' });
    child.on('close', (code) => resolveP({ exitCode: code ?? 1 }));
    child.on('error', (e) => { process.stderr.write(`docker error for ${sub.id}: ${e.message}\n`); resolveP({ exitCode: 1 }); });
  });
}

function makeInProcessRunner({ reg, env, runId, round }) {
  return async (sub) => {
    try {
      const res = await doBuildSubtask({ reg, env, sub, runId, round });
      return { exitCode: res.result === 'build_ok' ? 0 : 1, dumpPath: res.dumpPath };
    } catch (e) {
      process.stderr.write(`[build] ${sub.id} error: ${e.message}\n`);
      return { exitCode: 1 };
    }
  };
}

// After a container batch, fold each per-sub-task telemetry shard into the main
// CSV (single writer here, so no interleaving), then remove the shard dir.
async function mergeTelemetryShards(reg, shardDir) {
  await mergeCsvShards(reg.telemetry.csv, TELEMETRY_COLUMNS, shardDir);
}

async function mergeAuthorshipShards(reg, shardDir) {
  await mergeCsvShards(reg.telemetry?.fileAuthors || 'agent-context/file-authorship.csv', AUTHORSHIP_COLUMNS, shardDir);
}

async function mergeCsvShards(csvPath, columns, shardDir) {
  const dirAbs = resolve(ROOT, shardDir);
  if (!existsSync(dirAbs)) return;
  const mainAbs = resolve(ROOT, csvPath);
  await mkdir(dirname(mainAbs), { recursive: true });
  if (!existsSync(mainAbs)) await writeFile(mainAbs, columns.join(',') + '\n', 'utf8');
  const header = columns.join(',');
  for (const f of (await readdir(dirAbs)).filter((x) => x.endsWith('.csv'))) {
    const lines = (await readFile(join(dirAbs, f), 'utf8')).split('\n').filter((l) => l.length);
    const rows = lines[0] === header ? lines.slice(1) : lines;
    if (rows.length) await appendFile(mainAbs, rows.join('\n') + '\n', 'utf8');
  }
  await rm(dirAbs, { recursive: true, force: true });
}

// ---- full loop ----

async function doRun({ reg, env, task, taskFile }) {
  const runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const artifacts = reg.paths?.artifacts || 'agent-output';
  const base = basename(taskFile, '.md');
  const maxRounds = reg.loop?.maxRounds || 1;
  let feedback = '';
  for (let round = 1; round <= maxRounds; round += 1) {
    process.stderr.write(`\n[run ${runId}] round ${round}/${maxRounds}\n`);
    const planJson = await doOrchestrate({ reg, env, task, feedback, runId, round });
    const planPath = resolve(ROOT, join(artifacts, `${base}.plan.json`));
    await mkdir(dirname(planPath), { recursive: true });
    await writeFile(planPath, planJson, 'utf8');
    let plan;
    try {
      plan = JSON.parse(planJson);
    } catch {
      process.stderr.write(`[run] plan was not valid JSON (saved ${planPath}); stopping.\n`);
      await logTelemetry(reg, { run_id: runId, round, verb: 'qa', actor: 'client', role: 'client', provider: 'local', result: 'plan_invalid', task_file: taskFile });
      process.exitCode = 1;
      return;
    }
    // Verify sub-tasks write no code; the client's QA confirms them.
    for (const sub of plan.subtasks || []) {
      if ((sub.kind || 'build') === 'verify') {
        process.stderr.write(`[run ${runId}] ${sub.id} is a verify sub-task — no code; the client's QA confirms it.\n`);
        await logTelemetry(reg, {
          run_id: runId, round, verb: 'build', actor: sub.worker || 'client', role: 'worker',
          result: 'verify_skipped', files_written: 0, task_file: sub.id,
        });
      }
    }
    const buildable = (plan.subtasks || []).filter((s) => (s.kind || 'build') !== 'verify');
    const concurrency = Math.max(1, reg.loop?.concurrency || 1);
    const useContainers = containerWorkersEnabled(reg);
    let runOne;
    if (useContainers) {
      ensureImage(reg);
      runOne = makeContainerRunner({ reg, image: reg.container.image, planRel: relative(ROOT, planPath), runId, round, artifacts });
    } else {
      runOne = makeInProcessRunner({ reg, env, runId, round });
    }
    const parallel = analyzeParallelism(buildable);
    process.stderr.write(`[run ${runId}] executing ${buildable.length} build sub-task(s) at concurrency ${concurrency}${useContainers ? ' (containers)' : ' (in-process)'}; initially-ready=${parallel.initiallyReady}, dependency-edges=${parallel.dependencyEdges}, file-overlap-pairs=${parallel.fileOverlapPairs}.\n`);
    const graphResults = await runGraph(buildable, concurrency, runOne);
    if (useContainers) {
      await mergeTelemetryShards(reg, join(artifacts, '.telemetry'));
      await mergeAuthorshipShards(reg, join(artifacts, '.authorship'));
    }
    const buildIssues = graphResults
      .filter((g) => g.r.exitCode !== 0)
      .map((g) => ({ sub: g.sub, res: { result: g.r.blocked ? 'blocked' : 'build_failed', dumpPath: g.r.dumpPath || join(artifacts, `${g.sub.id}.raw.txt`) } }));
    const qa = runQaCommands(reg);
    await logTelemetry(reg, {
      run_id: runId, round, verb: 'qa', actor: 'client', role: 'client', provider: 'local',
      result: qa.allPass ? 'qa_green' : 'qa_red', qa_passed: qa.passed, qa_failed: qa.failed, task_file: taskFile,
    });
    if (buildIssues.length === 0 && qa.allPass) {
      process.stderr.write(`\n[run ${runId}] QA GREEN on round ${round}. Client should review the real output and approve.\n`);
      await doReport({ reg, runId });
      return;
    }
    const failing = qa.results.filter((r) => !r.ok);
    const parts = [`Round ${round} did not pass.`];
    if (buildIssues.length) {
      parts.push('BUILD ISSUES (worker produced no file changes for a build sub-task):\n'
        + buildIssues.map((b) => `- ${b.sub.id}: ${b.sub.title} (raw output at ${b.res.dumpPath})`).join('\n'));
    }
    if (failing.length) {
      parts.push('QA FAILURES:\n'
        + failing.map((f) => {
          const cmd = (reg.qa?.commands || []).find((c) => c.name === f.name);
          return `### ${f.name} (exit ${f.code})\ncommand: ${cmd?.run}\noutput (tail):\n${f.output || ''}`;
        }).join('\n\n'));
    }
    parts.push('Produce a minimal fix plan targeting ONLY these issues.');
    feedback = parts.join('\n\n');
    const fbPath = resolve(ROOT, join(artifacts, `${base}.feedback.r${round}.md`));
    await writeFile(fbPath, feedback, 'utf8');
    process.stderr.write(`[run ${runId}] round ${round} not green (build issues: ${buildIssues.length}, qa failing: ${failing.length}); wrote ${fbPath}; re-planning.\n`);
  }
  process.stderr.write(`\n[run ${runId}] exhausted ${maxRounds} round(s) without QA green.\n`);
  await doReport({ reg, runId });
  process.exitCode = 1;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];

  if (mode === 'init') {
    if (shouldBootstrapTarget(args)) {
      runBootstrapInit(args);
      return;
    }
    await doInit({ force: !!args.force });
    return;
  }

  const env = await loadEnv();

  if (mode === 'doctor') {
    await doDoctor({ reg: await loadRegistry(), env });
    return;
  }

  if (mode === 'plan' || mode === 'orchestrate') {
    if (!args.task) throw new Error(`${mode} requires --task`);
    const reg = await loadRegistry();
    const task = await readFile(resolve(ROOT, args.task), 'utf8');
    const feedback = args.feedback && existsSync(resolve(ROOT, args.feedback))
      ? await readFile(resolve(ROOT, args.feedback), 'utf8')
      : '';
    const content = await doOrchestrate({ reg, env, task, feedback, runId: `plan-${Date.now()}`, round: 0 });
    const out = args.out || join(reg.paths?.artifacts || 'agent-output', `${basename(args.task, '.md')}.plan.json`);
    await mkdir(dirname(resolve(ROOT, out)), { recursive: true });
    await writeFile(resolve(ROOT, out), content, 'utf8');
    process.stderr.write(`[plan] wrote ${out}\n`);
    process.stdout.write(content + '\n');
    return;
  }

  if (mode === 'orchestrate-call') {
    if (!args.input) throw new Error('orchestrate-call requires --input');
    const reg = await loadRegistry();
    const input = JSON.parse(await readFile(resolve(ROOT, args.input), 'utf8'));
    const content = await doOrchestrateInProcess({ reg, env, task: input.task || '', feedback: input.feedback || '', runId: input.runId || `plan-${Date.now()}`, round: Number(input.round || 0) });
    process.stdout.write(content + '\n');
    return;
  }

  if (mode === 'build') {
    if (!args.plan || !args.subtask) throw new Error('build requires --plan and --subtask');
    const reg = await loadRegistry();
    const plan = JSON.parse(await readFile(resolve(ROOT, args.plan), 'utf8'));
    const sub = (plan.subtasks || []).find((s) => s.id === args.subtask);
    if (!sub) throw new Error(`Subtask ${args.subtask} not found in plan`);
    const res = await doBuildSubtask({
      reg, env, sub, providerOverride: args.provider, contextFiles: args.context,
      runId: args['run-id'] || `build-${Date.now()}`, round: args.round ? Number(args.round) : 0,
    });
    if (res.result !== 'build_ok') {
      process.stderr.write(`[build] ${sub.id}: no file changes produced (raw output at ${res.dumpPath}).\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (mode === 'qa') {
    const reg = await loadRegistry();
    const qa = runQaCommands(reg);
    await logTelemetry(reg, {
      run_id: `qa-${Date.now()}`, round: 0, verb: 'qa', actor: 'client', role: 'client',
      provider: 'local', result: qa.allPass ? 'qa_green' : 'qa_red', qa_passed: qa.passed, qa_failed: qa.failed,
    });
    process.stdout.write(qa.allPass ? 'QA: green\n' : `QA: red (${qa.results.filter((r) => !r.ok).map((r) => r.name).join(', ')})\n`);
    if (!qa.allPass) process.exitCode = 1;
    return;
  }

  if (mode === 'run') {
    if (!args.task) throw new Error('run requires --task');
    const reg = await loadRegistry();
    const task = await readFile(resolve(ROOT, args.task), 'utf8');
    await doRun({ reg, env, task, taskFile: args.task });
    return;
  }

  if (mode === 'report') {
    await doReport({ reg: await loadRegistry(), runId: args.run });
    return;
  }

  if (mode === 'worker') {
    // Legacy proposal mode: writes a Markdown proposal to artifacts. NOT used by
    // `run` (workers write real files via build). Kept as an escape hatch.
    if (!args.provider || !args.task) throw new Error('worker requires --provider and --task');
    const reg = await loadRegistry();
    const cfg = resolveActor(args.provider, reg, env);
    const task = await readFile(resolve(ROOT, args.task), 'utf8');
    const context = args.context.length ? await readContextFiles(args.context) : '';
    const messages = [
      { role: 'system', content: WORKER_SYSTEM },
      { role: 'user', content: `TASK:\n\n${task}${context ? `\n\n---\n\nCONTEXT FILES:\n\n${context}` : ''}` },
    ];
    process.stderr.write(`[worker:${cfg.label}] calling ${cfg.model}...\n`);
    const out = await chat(cfg, messages, cfg.maxTokens);
    const dest = args.out || join(reg.paths?.artifacts || 'agent-output', `${basename(args.task, '.md')}.${args.provider}.md`);
    await mkdir(dirname(resolve(ROOT, dest)), { recursive: true });
    await writeFile(resolve(ROOT, dest), out.content, 'utf8');
    process.stderr.write(`[worker:${cfg.label}] wrote ${dest}\n`);
    return;
  }

  throw new Error('Usage: run.mjs <init|doctor|plan|build|qa|run|report|worker> ...');
}

main().catch((err) => {
  process.stderr.write(`ERROR: ${err.message}\n`);
  process.exit(1);
});
