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
  node install-agent-orchestrator.mjs [--target <path>] [--source <path>] [--repo <owner/name>] [--ref <ref>] [--upgrade] [--force] [--skill] [--skip-skill] [--skip-init] [--skip-agents-md]

Options:
  --target <path>       Target repository root. Defaults to current directory.
  --source <path>       Local agent-pipeline checkout/package to copy from.
  --repo <owner/name>   GitHub repo to fetch when --source is omitted. Default: ${DEFAULT_REPO}.
  --ref <ref>           Branch or tag to fetch when --source is omitted. Default: ${DEFAULT_REF}.
  --upgrade             Refresh pipeline-owned runner, skill, and agent templates while preserving pipeline.config.json and repo-owned guidance.
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
    upgrade: false,
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
    } else if (arg === '--upgrade') {
      args.upgrade = true;
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

async function copyRunner({ sourceRoot, targetRoot, force, preserveConfig }) {
  const targetRunner = join(targetRoot, 'tools', 'agent-runner');
  const targetConfig = join(targetRunner, 'pipeline.config.json');
  const savedConfig = preserveConfig && existsSync(targetConfig)
    ? await readFile(targetConfig, 'utf8')
    : null;
  if (existsSync(targetRunner)) {
    if (!force) {
      console.error(`[installer] exists, skipped: ${targetRunner}`);
      console.error('[installer] pass --upgrade to refresh the runner while preserving config, or --force to replace it.');
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
    'examples',
  ];

  for (const entry of entries) {
    const src = join(sourceRoot, entry);
    if (!existsSync(src)) throw new Error(`Source is missing required file: ${src}`);
    await cp(src, join(targetRunner, entry), { recursive: true });
  }

  if (savedConfig !== null) {
    await writeFile(targetConfig, savedConfig, 'utf8');
    console.error(`[installer] preserved ${targetConfig}`);
    await migratePreservedConfig({ sourceRoot, targetConfig });
  }

  console.error(`[installer] wrote ${targetRunner}`);
  return true;
}

async function migratePreservedConfig({ sourceRoot, targetConfig }) {
  const templateConfig = join(sourceRoot, 'templates', 'pipeline.config.json');
  const target = JSON.parse(await readFile(targetConfig, 'utf8'));
  const template = JSON.parse(await readFile(templateConfig, 'utf8'));
  let changed = false;

  const migrated = {};
  for (const [key, value] of Object.entries(target)) {
    migrated[key] = value;
    if (key === 'actors') {
      migrated.actors = {
        ...value,
        workers: {
          ...(value.workers || {}),
        },
      };
      for (const [workerKey, workerConfig] of Object.entries(template.actors?.workers || {})) {
        if (migrated.actors.workers[workerKey] === undefined) {
          migrated.actors.workers[workerKey] = workerConfig;
          changed = true;
          console.error(`[installer] added default worker ${workerKey} to ${targetConfig}`);
        }
      }
    }
    if (key === 'stackFacts' && target.workflow === undefined && template.workflow !== undefined) {
      migrated.workflow = template.workflow;
      changed = true;
      console.error(`[installer] added default workflow policy to ${targetConfig}`);
    }
  }
  if (migrated.workflow === undefined && template.workflow !== undefined) {
    migrated.workflow = template.workflow;
    changed = true;
    console.error(`[installer] added default workflow policy to ${targetConfig}`);
  }

  if (!changed) return;
  await writeFile(targetConfig, `${JSON.stringify(migrated, null, 2)}\n`, 'utf8');
}

async function copySkill({ sourceRoot, targetRoot, force }) {
  const sourceSkill = join(sourceRoot, '.github', 'skills', 'agent-orchestrator-installer');
  const targetSkill = join(targetRoot, '.github', 'skills', 'agent-orchestrator-installer');
  if (!existsSync(sourceSkill)) throw new Error(`Source is missing installer skill: ${sourceSkill}`);
  if (existsSync(targetSkill)) {
    if (!force) {
      console.error(`[installer] exists, skipped: ${targetSkill}`);
      console.error('[installer] pass --upgrade or --force to replace the existing installer skill.');
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

async function copyFileFromSource({ sourceRoot, targetRoot, sourceRel, targetRel }) {
  const src = join(sourceRoot, sourceRel);
  const dest = join(targetRoot, targetRel);
  if (!existsSync(src)) throw new Error(`Source is missing required file: ${src}`);
  await mkdir(dirname(dest), { recursive: true });
  await cp(src, dest);
  console.error(`[installer] refreshed ${dest}`);
}

async function refreshPipelineOwnedTemplates({ sourceRoot, targetRoot }) {
  await copyFileFromSource({
    sourceRoot,
    targetRoot,
    sourceRel: join('templates', 'orchestrator.agent.md'),
    targetRel: join('.github', 'agents', 'orchestrator.agent.md'),
  });
  await copyFileFromSource({
    sourceRoot,
    targetRoot,
    sourceRel: join('templates', 'agent-pipeline.instructions.md'),
    targetRel: join('.github', 'instructions', 'agent-pipeline.instructions.md'),
  });
}

async function scaffoldRepoFiles({ targetRoot, skipAgentsMd }) {
  await mkdir(join(targetRoot, 'dev-agent-context'), { recursive: true });
  await mkdir(join(targetRoot, 'dev-agent-context', 'platform-map'), { recursive: true });
  await mkdir(join(targetRoot, 'dev-agent-tasks'), { recursive: true });
  await mkdir(join(targetRoot, 'dev-agent-output'), { recursive: true });

  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'context-index.md'),
    '# Context Index\n\nRead these files before substantial agent-pipeline work:\n\n- `repo-file-boundaries.md` — which files ship/run Agent Pipeline versus which files are development context.\n- `current-state.md` — current branch, run state, and active goal.\n- `next-tasks.md` — bounded tasks ready for orchestration.\n- `architecture-decisions.md` — repo rules and constraints workers must follow.\n- `model-worker-guardrails.md` — model roles, strengths, and known failure modes.\n- `model-worker-performance.csv` — curated model performance ledger.\n- `mvp-tracker.md` — MVP scope, status, and acceptance.\n- `new-conversation-handoff.md` — concise handoff for the next session.\n- `review-checklist.md` — reviewer checklist before accepting worker output.\n- `self-registration-mvp-handoff.md` — optional handoff for self-registration/MVP work.\n- `platform-map/` — repo-specific platform and integration notes.\n\nThis `dev-agent-context/` folder is development context. Keep it off release branches such as `release/npm` unless explicitly needed for release notes.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'repo-file-boundaries.md'),
    '# Repo File Boundaries\n\nThis repo has two different classes of files. Keep the distinction explicit before release work.\n\n## Required To Ship And Run Agent Pipeline\n\n- `tools/agent-runner/` — vendored runner, schema, templates, docs, and Dockerfile.\n- `.github/skills/agent-orchestrator-installer/` — reusable installer skill when installed.\n- `.github/agents/orchestrator.agent.md` and `.github/instructions/agent-pipeline.instructions.md` — Copilot/Orchestrator guidance.\n- `AGENTS.md` and `.github/copilot-instructions.md` when this repo chooses to keep generated guidance.\n- `.env.agent-pipeline.example` — env var names only, never real keys.\n\n## Required To Develop This Repo\n\n- `dev-agent-context/` — development memory, handoffs, model guardrails, and curated performance context.\n- `dev-agent-tasks/` — local task specs for active pipeline runs.\n- `dev-agent-output/` — generated plans, feedback, telemetry shards, and raw dumps.\n\nThe `dev-` prefix is intentional: it makes development artifacts visually distinct from files that ship or run Agent Pipeline.\n\n## Release Rule\n\nDo not merge `dev-*` development context into `release/npm` unless the user explicitly requests public-facing release documentation.\n',
  );

  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'current-state.md'),
    '# Current State\n\n- Agent Orchestrator mode is installed. Update this file with branch, run state, current goal, blockers, and validation before major pipeline runs.\n\n## Release Hygiene\n\nDevelopment context belongs on active development branches. Do not carry `dev-agent-context/`, `dev-agent-output/`, or `dev-agent-tasks/` into `release/npm` unless the user explicitly requests release documentation.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'next-tasks.md'),
    '# Next Tasks\n\nList bounded tasks suitable for the orchestrator pipeline.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'architecture-decisions.md'),
    '# Architecture Decisions\n\nRecord repo architecture rules and constraints that workers must follow.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'review-checklist.md'),
    '# Review Checklist\n\n- [ ] Secrets are not printed or committed.\n- [ ] Changes follow existing repo patterns.\n- [ ] Configured QA commands pass.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'new-conversation-handoff.md'),
    '# New Conversation Handoff\n\nUse this file to resume the next Copilot or Orchestrator session without replaying the whole chat. Update it after each accepted pipeline run or before ending a long conversation.\n\n## Role Split\n\nCopilot acts as Client/QA and final approver, Fugu plans and validates worker PR-like changes, workers implement in isolated task branches/worktrees, and `tools/agent-runner/run.mjs` is wiring only. NPM publishing is staged separately on `release/npm`.\n\n## Latest User Request\n\n- Pending: replace this with the most recent accepted request or goal.\n\n## Current State\n\n- Branch/status:\n- Important decisions:\n- Files changed or generated:\n- Validation run:\n\n## Next Conversation Prompt\n\nStart the next session with this concise instruction:\n\n```text\nContinue from `dev-agent-context/new-conversation-handoff.md`. Confirm current git status, read `AGENTS.md` plus the relevant `dev-agent-context/` files, then proceed with the next task.\n```\n',
  );
  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'model-worker-guardrails.md'),
    '# Model Worker Guardrails\n\nTrack model roles, strengths, failure modes, and prompt/config adjustments here. Update after benchmark or production runs.\n\n## Current Role Split\n\n- Fugu: orchestration, dependency graph, worker assignment, validation.\n- deepseek-v4-flash: primary low-cost implementer for bounded product slices.\n- gpt-5.4-mini: QA/spec critic for acceptance criteria, tests, checkers, and edge-case review.\n- deepseek-v4-pro: repair and integration hardener after QA failure or high-risk changes.\n- gpt-4o-mini: utility tasks such as i18n, sentiment/classification, copy variants, and small transformations.\n\n## Evaluation Rules\n\n- Compare models on the same task shape, files, max token budget, QA command, and telemetry fields.\n- Prefer streaming-aware metrics: time to first token, generation duration, output tokens/sec, and end-to-end latency.\n- Record model decisions in `model-worker-performance.csv`.\n- Keep Gemini and GLM out of the active roster unless the repo explicitly opts into a new experiment.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'mvp-tracker.md'),
    '# MVP Tracker\n\n## Goal\n\n- Define the active MVP or release candidate here.\n\n## In Scope\n\n- Pending.\n\n## Out of Scope\n\n- Pending.\n\n## Acceptance\n\n- [ ] QA commands pass.\n- [ ] Client approves the candidate.\n- [ ] Release/npm work is staged separately from development context.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'self-registration-mvp-handoff.md'),
    '# Self-Registration MVP Handoff\n\nUse this optional handoff when the current repo has self-registration or onboarding MVP work. If it is not relevant, leave this file as a placeholder and use `new-conversation-handoff.md` for general continuation.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'platform-map', 'README.md'),
    '# Platform Map\n\nRecord repo-specific platform boundaries, services, external APIs, deployment surfaces, and ownership notes here. Keep secrets out of this directory.\n',
  );
  await writeIfMissing(
    join(targetRoot, 'dev-agent-context', 'model-worker-performance.csv'),
    'date,priority,batch,job,provider,model,verb,task_file,result,qa_decision,integration_decision,files_changed,validation,what_worked,what_failed,prompt_adjustment,next_use\n',
  );
  await writeIfMissing(
    join(targetRoot, '.env.agent-pipeline.example'),
    'SAKANA_FUGU_API_KEY=\nDEEPSEEK_API_KEY=\nOPENAI_API_KEY=\nFUGU_MODEL=fugu\nDEEPSEEK_FLASH_MODEL=deepseek-v4-flash\nDEEPSEEK_MODEL=deepseek-v4-pro\nOPENAI_QA_MODEL=gpt-5.4-mini\nOPENAI_MODEL=gpt-4o-mini\n',
  );
  await writeIfMissing(
    join(targetRoot, '.github', 'copilot-instructions.md'),
    '# Copilot Instructions\n\nBefore making agent-pipeline changes in this repo, read:\n\n- `.github/instructions/agent-pipeline.instructions.md`\n- `AGENTS.md`\n- `dev-agent-context/context-index.md`\n- Every relevant file referenced by `dev-agent-context/context-index.md`\n\nUse Orchestrator mode for implementation work: Copilot handles intake, QA, and final approval; Fugu plans and validates worker PR-like changes; workers implement in isolated task branches/worktrees; and `tools/agent-runner/run.mjs` stays wiring only. Stage NPM publishing on `release/npm`, not ordinary implementation branches. Treat `dev-agent-context/`, `dev-agent-output/`, `dev-agent-tasks/`, and `dev-publication/` as development context; do not carry them into `release/npm` unless explicitly requested.\n',
  );

  if (!skipAgentsMd) {
    await writeIfMissing(
      join(targetRoot, 'AGENTS.md'),
      '# Agent Guide\n\n## Architecture Rules\n\n- Add this repo\'s architecture boundaries, package manager, framework versions, and security rules.\n- Never store or print API keys or other secrets.\n\n## Agent Orchestrator Mode\n\n- Copilot acts as Client/QA and final approver.\n- Fugu plans bounded subtasks and validates worker PR-like changes.\n- Workers write product code in isolated task branches/worktrees.\n- `tools/agent-runner/run.mjs` is wiring only and makes no product decisions.\n- Stage NPM publishing on `release/npm` and publish only after explicit approval.\n\n## Useful Commands\n\n```sh\nnode tools/agent-runner/run.mjs doctor\nnode tools/agent-runner/run.mjs run --task dev-agent-tasks/<task>.md\n```\n',
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
    const replaceExisting = args.force || args.upgrade;
    await copyRunner({ sourceRoot, targetRoot, force: replaceExisting, preserveConfig: args.upgrade && !args.force });
    if (args.installSkill) await copySkill({ sourceRoot, targetRoot, force: replaceExisting });
    await scaffoldRepoFiles({ targetRoot, skipAgentsMd: args.skipAgentsMd });
    if (args.upgrade && !args.skipInit) await refreshPipelineOwnedTemplates({ sourceRoot, targetRoot });
    if (!args.skipInit) await runInit({ targetRoot, force: args.force });

    process.stdout.write(`\nAgent Orchestrator mode ${args.upgrade ? 'upgraded' : 'installed'} in ${targetRoot}.\n\nNext steps:\n`);
    process.stdout.write('1. Edit tools/agent-runner/pipeline.config.json for this repo.\n');
    process.stdout.write('2. Add real API keys to .env or your shell; use .env.agent-pipeline.example for names only.\n');
    process.stdout.write('3. Run: node tools/agent-runner/run.mjs doctor\n');
    process.stdout.write('4. Optional fast demo: cp tools/agent-runner/examples/flatbird-demo-task.md dev-agent-tasks/flatbird-demo.md && node tools/agent-runner/run.mjs run --task dev-agent-tasks/flatbird-demo.md\n');
  } finally {
    if (tempSource) await rm(tempSource, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[installer] ${error.message}`);
  process.exit(1);
});
