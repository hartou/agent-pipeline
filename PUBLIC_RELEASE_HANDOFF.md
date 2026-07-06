# Public Release Handoff

Last updated: 2026-07-05

This repo is the standalone `agent-pipeline` project extracted from
`northfield-mentor`. Continue public release and npm packaging work here, not in
the Northfield app repo.

## Current State

- GitHub repo: `hartou/agent-pipeline`.
- Default branch: `main`.
- Current visibility: public.
- npm package: `@hartou/agent-pipeline`.
- Latest published npm version: `0.2.7`.
- Latest release tag: `v0.2.7`.
- Latest release commit on `main`: `53eff23 Merge branch 'update-runtime-architecture-diagram'`.
- Public install command:

```sh
npx --yes --prefer-online @hartou/agent-pipeline init --target . --skill
```

- Development context policy: source-repo development folders use a `dev-`
  prefix, such as `dev-agent-context/` and `dev-publication/`. Keep `dev-*`
  folders off `release/npm` unless the user explicitly asks to include a
  public-facing release note. The npm package `files` whitelist excludes these
  paths from published tarballs.

- Latest public install validation repo:
  `~/dev/new_repos/agent-pipeline-public-024-deepseek-test-20260705-002958`.
- Latest validation result: generated `.env.agent-pipeline.example` and
  `tools/agent-runner/pipeline.config.json` use `DEEPSEEK_MODEL`, not
  `DeepSeek_Model`; `doctor` ended with `DOCTOR: all green` using dummy env vars.
- Merged setup PRs:
  - #1 `agent-orchestrator-installer-skill`: added reusable Copilot skill and
    installer script.
  - #2 `docs-public-installer-path`: documented direct checkout and
    skill-installed bootstrap paths.
  - #3 `docs-target-repo-prereq`: documented creating a brand-new target repo
    before installation.
- Clean install was tested repeatedly outside Northfield in
  `~/dev/agent-orchestrator-readme-test`.
- Final merged-README test result: `DOCTOR: all green` with dummy env vars.
- Final local test repo commit: `eeefbdf chore: install agent orchestrator mode
  from merged readme`.

## What The Installer Currently Does

The skill lives at:

```text
.github/skills/agent-orchestrator-installer/
```

The installer script:

```text
.github/skills/agent-orchestrator-installer/scripts/install-agent-orchestrator.mjs
```

Installs into a target repo:

- `tools/agent-runner/` with `run.mjs`, templates, schema, docs, Dockerfile.
- `.github/agents/orchestrator.agent.md` via `run.mjs init`.
- `tools/agent-runner/pipeline.config.json` via `run.mjs init`.
- `.github/instructions/agent-pipeline.instructions.md` via `run.mjs init` so
  pipeline guidance is present even when existing repo instructions are skipped.
- `.github/skills/agent-orchestrator-installer/` when `--skill` is used. This
  is still the default behavior; `--skill` makes the intent explicit. Use
  `--skip-skill` to opt out.
- `.github/copilot-instructions.md` if missing.
- starter `dev-agent-context/` files, including the context index, current state,
  next tasks, architecture decisions, model-worker guardrails, review checklist,
  MVP tracker, conversation handoff, platform map, and curated performance CSV.
- empty `dev-agent-tasks/` and `dev-agent-output/` directories.
- starter `AGENTS.md` only if the target repo does not already have one.
- `.env.agent-pipeline.example` with env var names only.

Current generated env names:

```sh
SAKANA_FUGU_API_KEY=
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
FUGU_MODEL=fugu
DEEPSEEK_FLASH_MODEL=deepseek-v4-flash
DEEPSEEK_MODEL=deepseek-v4-pro
OPENAI_QA_MODEL=gpt-5.4-mini
OPENAI_MODEL=gpt-4o-mini
```

It never writes real API keys and does not print `.env` contents.

## Copilot Context And Instructions

Yes, installation adds Copilot-facing context and instructions:

- `.github/agents/orchestrator.agent.md` defines the selectable Orchestrator/PM
  mode for Copilot Chat.
- `.github/instructions/agent-pipeline.instructions.md` is the pipeline-specific
  companion instruction file. It lets brownfield repos keep existing
  `.github/copilot-instructions.md` and `AGENTS.md` untouched while still teaching
  Copilot where to find the pipeline workflow.
- `AGENTS.md` gives repo-wide operating rules and role boundaries.
- `dev-agent-context/context-index.md` is the entry point for development context.
  Read it first, then the files it references: current state, next tasks,
  architecture decisions, model-worker guardrails, review checklist, MVP tracker,
  platform map, and `new-conversation-handoff.md` for session handoff.
- The installer skill itself remains available in `.github/skills/` when using
  the skill-installed path.

The npm/bootstrap path now adds `.github/instructions/agent-pipeline.instructions.md`
and an optional `.github/copilot-instructions.md` template when missing. The
companion instruction is the stable pipeline guidance surface; the optional main
instruction points Copilot to it, `AGENTS.md`, and the compact `dev-agent-context/`
files for users who stay in the default Copilot agent instead of selecting
Orchestrator mode.

## Brownfield Support

Yes, this can be added to a brownfield repo.

Current behavior is conservative:

- Existing `tools/agent-runner/` is skipped unless `--force` is passed.
- Existing `.github/skills/agent-orchestrator-installer/` is skipped unless
  `--force` is passed.
- Existing `AGENTS.md` is skipped, so repo-owned instructions are not overwritten.
- Existing `.github/copilot-instructions.md` is skipped.
- Existing `.github/instructions/agent-pipeline.instructions.md` is skipped, but
  missing repos receive it even when other instruction files already exist.
- Existing starter context files are skipped individually.
- `run.mjs init` skips existing `pipeline.config.json` and
  `.github/agents/orchestrator.agent.md` unless `--force` is passed.

Brownfield recommended flow:

```sh
cd /path/to/existing-repo
git status --short
npx --yes --prefer-online @hartou/agent-pipeline init --target . --skill
```

Use `--force` only when intentionally upgrading/replacing the vendored runner,
skill, generated pipeline config, and generated agent mode. Back up
`tools/agent-runner/pipeline.config.json` first because target repos often have
custom QA commands, stack facts, pricing, and container settings.

Then manually merge repo-specific rules into:

- `AGENTS.md` if it already existed.
- `.github/instructions/agent-pipeline.instructions.md` if the repo needs local
  overrides for the pipeline workflow.
- `tools/agent-runner/pipeline.config.json`.
- `dev-agent-context/architecture-decisions.md`.
- `dev-agent-context/review-checklist.md`.

Do not use `--force` in brownfield repos unless the user explicitly wants to
replace existing runner/config/agent files.

## Npm / Package Release Findings

- The unscoped npm name `agent-pipeline` is already taken (`npm view
  agent-pipeline version` returned `0.1.4`).
- `@hartou/agent-pipeline` is published publicly on npm. The unscoped
  `agent-pipeline` name is still not used because it was already taken.
- `package.json` now uses the scoped name `@hartou/agent-pipeline`, MIT license
  metadata, public publish config, and no `private` flag.
- The package binary points to `run.mjs`. In npm-package context, `init` now
  delegates to the installer script with `--source <package-root>` so public npm
  UX can bootstrap a normal target repo.
- Package `0.2.1` added explicit `--skill` / `--skip-skill` flags.
- Package `0.2.2` documented Docker prerequisites, provider key links,
  telemetry usage, and downstream contribution-back flow.
- Package `0.2.3` added `img/agent-pipeline-architecture.png` to the README and
  npm package.
- Package `0.2.4` fixed the DeepSeek model env var casing to `DEEPSEEK_MODEL`.
- Package `0.2.5` prepares the companion
  `.github/instructions/agent-pipeline.instructions.md` install path so brownfield
  repos keep existing instructions untouched while still receiving pipeline
  guidance.
- Package `0.2.6` added containerized Fugu orchestration, explicit
  `container.orchestrator` / `container.workers` toggles, Fugu-owned worker PR
  validation guidance, branch/worktree isolation guidance, and safe brownfield
  `--upgrade` mode.
- Package `0.2.7` updated the README architecture diagram to show runtime
  coordination only: Copilot client, Fugu coordinator container, worker
  containers/worktrees, Fugu validation, real QA, and client approval. Merge,
  deployment, and npm release governance are intentionally separate.

Recommended public command:

```sh
npx --yes --prefer-online @hartou/agent-pipeline init --target . --skill
```

That should install the runner, skill, agent mode, starter context, env example,
and config into the current repo. After install, users can still run the vendored
runner directly:

```sh
node tools/agent-runner/run.mjs doctor
```

Suggested aliases for public UX:

- `doctor`: keep it as the developer-standard health check.
- `check`: add as an alias to `doctor` for users unfamiliar with the convention.

## OCI / Registry Notes

- Private npm packages exist, usually through scoped packages in an npm org or a
  private registry. That is possible but adds access/account setup.
- OCI registries are not a normal target for `npm install` / `npx`. npm clients
  use the npm registry protocol. OCI is more relevant to containers and generic
  artifacts.
- For next week's public release, prefer npm public scoped package
  `@hartou/agent-pipeline` unless there is a business reason to gate access.

## Completed Public Release Work

- GitHub repo is public.
- MIT license file is present.
- npm package is public at `@hartou/agent-pipeline`.
- npm bootstrap mode works from the public package.
- `.github/copilot-instructions.md` is scaffolded when missing.
- npm package includes every file needed by the bootstrapper, including `img/`.
- README primary install path is npm/npx; clone/copy remains a fallback/dev path.
- Multiple fresh external repo tests passed with `DOCTOR: all green`.
- Latest tested public package: `0.2.7`.
- Brownfield upgrades are now supported with
  `npx --yes --prefer-online @hartou/agent-pipeline init --target . --upgrade --skill`.
- The README diagram is updated at `img/agent-pipeline-architecture.png`; use it
  in launch/social posts as the visual companion to the npm announcement.

Next useful release work:

1. Add `check` as an alias for `doctor` if desired.
2. Add a small public demo repo/run showing plan JSON, worker output, QA output,
  and telemetry summary from a real task.
3. Consider reducing or optimizing the README image asset if npm package size
  matters; `0.2.7` is about 1.4 MB because of the PNG.

## Known Good Public Install Command

From published npm `0.2.7`, the public install path worked:

```sh
mkdir -p /path/to/target-repo && cd /path/to/target-repo
git init
npx --yes --prefer-online @hartou/agent-pipeline init --target . --skill
SAKANA_FUGU_API_KEY=dummy DEEPSEEK_API_KEY=dummy DEEPSEEK_MODEL=deepseek-v4-pro OPENAI_API_KEY=dummy node tools/agent-runner/run.mjs doctor
```

Expected validation output ends with:

```text
DOCTOR: all green
```