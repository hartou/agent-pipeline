#!/usr/bin/env node
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const DEFAULT_REPO = 'hartou/agent-pipeline';
const DEFAULT_REF = 'main';

function usage() {
  return `Install Agent Orchestrator mode into a target repository.

Usage:
  node install-agent-orchestrator.mjs [--target <path>] [--source <path>] [--repo <owner/name>] [--ref <ref>] [--force] [--skill] [--skip-skill] [--skip-init] [--skip-agents-md]

Options:
  --target <path>       Target repository root. Defaults to current directory.
  --source <path>       Local agent-pipeline checkout/package to copy from.
  --repo <owner/name>   GitHub repo to fetch when --source is omitted. Default: ${DEFAULT_REPO}.
  --ref <ref>           Branch or tag to fetch when --source is omitted. Default: ${DEFAULT_REF}.
  --force               Replace existing tools/agent-runner and force init templates.
  --skill               Install the Copilot skill. This is the default; the flag is accepted for explicit npm usage.
  --skip-skill          Do not install .github/skills/agent-orchestrator-installer.
  --skip-init           Copy runner only; do not run run.mjs init.
  --skip-agents-md      Do not create starter AGENTS.md.
  --help                Show this help.
`;
}

function parseArgs(argv) {
  const args = {
    target: process.cwd(),
    source: '',
    repo: DEFAULT_REPO,
    ref: DEFAULT_REF,
    force: false,
    installSkill: true,
    skipInit: false,
    skipAgentsMd: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--target') {
      args.target = argv[++index];
    } else if (arg === '--source') {
      args.source = argv[++index];
    } else if (arg === '--repo') {
      args.repo = argv[++index];
    } else if (arg === '--ref') {
      args.ref = argv[++index];
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--skill') {
      args.installSkill = true;
    } else if (arg === '--skip-skill') {
      args.installSkill = false;
    } else if (arg === '--skip-init') {
      args.skipInit = true;
    } else if (arg === '--skip-agents-md') {
      args.skipAgentsMd = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.target) throw new Error('Missing value for --target.');
  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(' ')}`);
  }
}

async function checkoutSource({ repo, ref }) {
  const target = await mkdtemp(join(tmpdir(), 'agent-pipeline-'));
  const gh = spawnSync('gh', ['--version'], { stdio: 'ignore' });

  if (gh.status === 0) {
    run('gh', ['repo', 'clone', repo, target, '--', '--depth', '1', '--branch', ref]);
    return target;
  }

  run('git', ['clone', '--depth', '1', '--branch', ref, `https://github.com/${repo}.git`, target]);
  return target;
}

async function copyRunner({ sourceRoot, targetRoot, force }) {
  const targetRunner = join(targetRoot, 'tools', 'agent-runner');
  if (existsSync(targetRunner)) {
    if (!force) {
      console.error(`[installer] exists, skipped: ${targetRunner}`);
      console.error('[installer] pass --force to replace the existing runner.');
      return false;
    }
    await rm(targetRunner, { recursive: true, force: true });
  }

  await mkdir(targetRunner, { recursive: true });
  const entries = [
    'run.mjs',
    'package.json',
    'pipeline.config.schema.json',
    'Dockerfile',
    'README.md',
    'GUIDE.md',
    'templates',
  ];

  for (const entry of entries) {
    const src = join(sourceRoot, entry);
    if (!existsSync(src)) throw new Error(`Source is missing required file: ${src}`);
    await cp(src, join(targetRunner, entry), { recursive: true });
  }

  console.error(`[installer] wrote ${targetRunner}`);
  return true;
}

async function copySkill({ sourceRoot, targetRoot, force }) {
  const sourceSkill = join(sourceRoot, '.github', 'skills', 'agent-orchestrator-installer');
  const targetSkill = join(targetRoot, '.github', 'skills', 'agent-orchestrator-installer');
  if (!existsSync(sourceSkill)) throw new Error(`Source is missing installer skill: ${sourceSkill}`);
  if (existsSync(targetSkill)) {
    if (!force) {
      console.error(`[installer] exists, skipped: ${targetSkill}`);
      console.error('[installer] pass --force to replace the existing installer skill.');
      return false;
    }
    await rm(targetSkill, { recursive: true, force: true });
  }

  await mkdir(dirname(targetSkill), { recursive: true });
  await cp(sourceSkill, targetSkill, { recursive: true });
  console.error(`[installer] wrote ${targetSkill}`);
  return true;
}

async function writeIfMissing(filePath, content) {
  if (existsSync(filePath)) {
    console.error(`[installer] exists, skipped: ${filePath}`);
    return false;
  }
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
  console.error(`[installer] wrote ${filePath}`);
  return true;
}

async function scaffoldRepoFiles({ targetRoot, skipAgentsMd }) {
  await mkdir(join(targetRoot, 'agent-context'), { recursive: true });
  await mkdir(join(targetRoot, 'agent-tasks'), { recursive: true });
  await mkdir(join(targetRoot, 'agent-output'), { recursive: true });

  await writeIfMissing(
    join(targetRoot, 'agent-context', 'current-state.md'),
    '# Current State\n\n- Agent Orchestrator mode is installed. Update this file with the repo status before major pipeline runs.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'agent-context', 'next-tasks.md'),
    '# Next Tasks\n\nList bounded tasks suitable for the orchestrator pipeline.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'agent-context', 'architecture-decisions.md'),
    '# Architecture Decisions\n\nRecord repo architecture rules and constraints that workers must follow.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'agent-context', 'review-checklist.md'),
    '# Review Checklist\n\n- [ ] Secrets are not printed or committed.\n- [ ] Changes follow existing repo patterns.\n- [ ] Configured QA commands pass.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'agent-context', 'handoff.md'),
    '# Conversation Handoff\n\nUse this file to resume the next Copilot or Orchestrator session without replaying the whole chat. Update it after each accepted pipeline run or before ending a long conversation.\n\n## Role Split\n\nCopilot acts as Client/QA, Fugu plans, workers implement, and `tools/agent-runner/run.mjs` is wiring only.\n\n## Latest User Request\n\n- Pending: replace this with the most recent accepted request or goal.\n\n## Current State\n\n- Branch/status:\n- Important decisions:\n- Files changed or generated:\n- Validation run:\n\n## Next Conversation Prompt\n\nStart the next session with this concise instruction:\n\n```text\nContinue from `agent-context/handoff.md`. Confirm current git status, read `AGENTS.md` plus the relevant `agent-context/` files, then proceed with the next task.\n```\n',
  );
  await writeIfMissing(
    join(targetRoot, 'agent-context', 'model-worker-performance.csv'),
    'date,priority,batch,job,provider,model,verb,task_file,result,qa_decision,integration_decision,files_changed,validation,what_worked,what_failed,prompt_adjustment,next_use\n',
  );
  await writeIfMissing(
    join(targetRoot, '.env.agent-pipeline.example'),
    'SAKANA_FUGU_API_KEY=\nDEEPSEEK_API_KEY=\nOPENAI_API_KEY=\nFUGU_MODEL=fugu\nDeepSeek_Model=deepseek-v4-pro\nOPENAI_MODEL=gpt-4o-mini\n',
  );
  await writeIfMissing(
    join(targetRoot, '.github', 'copilot-instructions.md'),
    '# Copilot Instructions\n\nBefore making agent-pipeline changes in this repo, read:\n\n- `AGENTS.md`\n- `agent-context/current-state.md`\n- `agent-context/next-tasks.md`\n- `agent-context/architecture-decisions.md`\n- `agent-context/review-checklist.md`\n- `agent-context/handoff.md`\n\nUse Orchestrator mode for implementation work: Copilot handles intake and QA, Fugu plans, workers implement, and `tools/agent-runner/run.mjs` stays wiring only.\n',
  );

  if (!skipAgentsMd) {
    await writeIfMissing(
      join(targetRoot, 'AGENTS.md'),
      '# Agent Guide\n\n## Architecture Rules\n\n- Add this repo\'s architecture boundaries, package manager, framework versions, and security rules.\n- Never store or print API keys or other secrets.\n\n## Agent Orchestrator Mode\n\n- Copilot acts as Client/QA.\n- Fugu plans bounded subtasks.\n- Workers write product code directly into this repo.\n- `tools/agent-runner/run.mjs` is wiring only and makes no product decisions.\n\n## Useful Commands\n\n```sh\nnode tools/agent-runner/run.mjs doctor\nnode tools/agent-runner/run.mjs run --task agent-tasks/<task>.md\n```\n',
    );
  }
}

async function runInit({ targetRoot, force }) {
  const runPath = join(targetRoot, 'tools', 'agent-runner', 'run.mjs');
  if (!existsSync(runPath)) throw new Error(`Missing runner after install: ${runPath}`);
  const args = [runPath, 'init'];
  if (force) args.push('--force');
  run(process.execPath, args, { cwd: targetRoot });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const targetRoot = resolve(args.target);
  if (!existsSync(targetRoot)) throw new Error(`Target repo does not exist: ${targetRoot}`);

  let sourceRoot = args.source ? resolve(args.source) : '';
  let tempSource = '';
  if (!sourceRoot) {
    tempSource = await checkoutSource({ repo: args.repo, ref: args.ref });
    sourceRoot = tempSource;
  }
  if (!existsSync(join(sourceRoot, 'run.mjs'))) {
    throw new Error(`Source does not look like agent-pipeline root: ${sourceRoot}`);
  }

  try {
    await copyRunner({ sourceRoot, targetRoot, force: args.force });
    if (args.installSkill) await copySkill({ sourceRoot, targetRoot, force: args.force });
    await scaffoldRepoFiles({ targetRoot, skipAgentsMd: args.skipAgentsMd });
    if (!args.skipInit) await runInit({ targetRoot, force: args.force });

    process.stdout.write(`\nAgent Orchestrator mode installed in ${targetRoot}.\n\nNext steps:\n`);
    process.stdout.write('1. Edit tools/agent-runner/pipeline.config.json for this repo.\n');
    process.stdout.write('2. Add real API keys to .env or your shell; use .env.agent-pipeline.example for names only.\n');
    process.stdout.write('3. Run: node tools/agent-runner/run.mjs doctor\n');
    process.stdout.write('4. Create a tiny task in agent-tasks/ and run: node tools/agent-runner/run.mjs run --task agent-tasks/<task>.md\n');
  } finally {
    if (tempSource) await rm(tempSource, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[installer] ${error.message}`);
  process.exit(1);
});
