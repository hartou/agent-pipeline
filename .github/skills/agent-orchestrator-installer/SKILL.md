---
name: agent-orchestrator-installer
description: 'Install or upgrade Agent Orchestrator mode and the agent-pipeline in another repository. Use when: bootstrap orchestrator agent mode, vendor agent-pipeline, upgrade installed runner/templates, install Fugu/DeepSeek/gpt-4o-mini workflow, create pipeline config, AGENTS.md, agent-context, agent-tasks, or agent-output.'
argument-hint: '<target-repo-path> [--source <agent-pipeline-checkout>] [--upgrade|--force]'
---

# Agent Orchestrator Installer

Use this skill when a user wants to install the Agent Orchestrator mode into a repo so the repo can run the multi-agent delivery pipeline: Client/Copilot -> Fugu orchestrator -> DeepSeek/gpt-4o-mini workers -> real QA.

Use `--upgrade` for already-installed brownfield repos that need the latest runner,
templates, and skill without losing their customized pipeline config.

## What This Installs

- `tools/agent-runner/` with the repo-agnostic `run.mjs` wiring.
- `.github/skills/agent-orchestrator-installer/` for future Copilot-assisted installs.
- `.github/agents/orchestrator.agent.md` via `run.mjs init`.
- `.github/instructions/agent-pipeline.instructions.md` via `run.mjs init`, as a
   companion instruction file that does not overwrite repo-owned guidance.
- `.github/copilot-instructions.md` if the target repo does not already have one.
- `tools/agent-runner/pipeline.config.json` via `run.mjs init`.
- Starter `agent-context/`, `agent-tasks/`, and `agent-output/` folders.
- `agent-context/` development tracking structure: context index, current state,
  next tasks, architecture decisions, model-worker guardrails, review checklist,
  MVP tracker, new-conversation handoff, platform map, and curated performance CSV.
- Starter `AGENTS.md` only if the target repo does not already have one.
- `.env.agent-pipeline.example` with required env var names only.

The development tracking structure is for active work branches. It should not be
carried into a package release branch such as `release/npm` unless the user
explicitly asks for release documentation.

Secrets are never generated, requested, printed, or committed. The user adds real API keys to their own `.env` or shell.

## Procedure

1. Confirm the target repo path and check its git state.
2. Prefer the npm/npx bootstrap from the target repo:

```sh
npx @hartou/agent-pipeline init --target . --skill
```

`--skill` is explicit for readability; skill installation is the default. Use
`--skip-skill` only when the target repo should not receive the reusable Copilot
installer skill.

Or run the bundled installer script from the target repo or pass `--target`:

```sh
node .github/skills/agent-orchestrator-installer/scripts/install-agent-orchestrator.mjs --target /path/to/repo
```

If the skill is being run from a checkout of this `agent-pipeline` repo, prefer the local source so it installs the exact checked-out bytes:

```sh
node .github/skills/agent-orchestrator-installer/scripts/install-agent-orchestrator.mjs --target /path/to/repo --source /path/to/agent-pipeline
```

If installed as a standalone skill, omit `--source`; the script will try to fetch `hartou/agent-pipeline` using GitHub CLI auth.

For an existing install, prefer the safe upgrade path:

```sh
npx @hartou/agent-pipeline init --target . --upgrade --skill
```

Or from a local checkout:

```sh
node /path/to/agent-pipeline/.github/skills/agent-orchestrator-installer/scripts/install-agent-orchestrator.mjs --target /path/to/repo --source /path/to/agent-pipeline --upgrade --skill
```

`--upgrade` refreshes `tools/agent-runner/`, the installer skill,
`.github/agents/orchestrator.agent.md`, and
`.github/instructions/agent-pipeline.instructions.md`. It preserves
`tools/agent-runner/pipeline.config.json`, `AGENTS.md`, and
`.github/copilot-instructions.md`.

3. Edit `tools/agent-runner/pipeline.config.json` in the target repo:
   - Set `project`.
   - Set `paths` if the repo uses non-default task/artifact directories.
   - Replace `stackFacts` with concrete architecture rules.
   - Replace `qa.commands` and `qa.order` with real target-repo checks.
   - Keep only env var names in actor config, never key values.

4. Ask the user to put these keys in `.env` or their shell if missing:

```sh
SAKANA_FUGU_API_KEY=
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
```

5. Validate:

```sh
node tools/agent-runner/run.mjs doctor
```

6. Create a tiny smoke task under `agent-tasks/` and run the loop only after `doctor` is green:

```sh
node tools/agent-runner/run.mjs run --task agent-tasks/smoke-test.md
```

7. Commit the installed skill/runner/config changes in the target repo when accepted.

## Important Rules

- Do not print `.env` contents or secrets.
- Do not overwrite repo-owned guidance. Use `--upgrade` for installed brownfield
   repos; reserve `--force` for intentional replacement of generated config/templates.
- Treat `AGENTS.md` as repo-owned. If it exists, leave it alone and ask whether to add orchestrator guidance.
- Treat `.github/copilot-instructions.md` as repo-owned. The installer adds
   `.github/instructions/agent-pipeline.instructions.md` for pipeline guidance
   instead of mutating existing main instructions.
- Keep the role split intact: Copilot/Client manages intake and QA, Fugu plans, workers write product code, `run.mjs` is wiring only.
- Do not hand-edit product code while acting in Orchestrator mode unless the user explicitly asks to leave the pipeline model.

## Useful Flags

```sh
--target <path>       Target repository root. Defaults to current directory.
--source <path>       Local agent-pipeline checkout/package to install from.
--repo <owner/name>   GitHub repo to fetch when --source is omitted. Default: hartou/agent-pipeline.
--ref <ref>           Branch or tag to fetch. Default: main.
--upgrade             Refresh pipeline-owned runner, skill, and agent templates while preserving pipeline.config.json and repo-owned guidance.
--force               Replace existing tools/agent-runner and force init templates.
--skill               Install the Copilot skill. Default; accepted for explicit npm usage.
--skip-skill          Do not install .github/skills/agent-orchestrator-installer.
--skip-init           Copy runner only; do not run run.mjs init.
--skip-agents-md      Do not create a starter AGENTS.md.
```
