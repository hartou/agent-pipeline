# Public Release Handoff

Last updated: 2026-07-04

This repo is the standalone `agent-pipeline` project extracted from
`northfield-mentor`. Continue public release and npm packaging work here, not in
the Northfield app repo.

## Current State

- GitHub repo: `hartou/agent-pipeline`.
- Default branch: `main`.
- Current visibility at last check: private.
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
- starter `agent-context/` files.
- empty `agent-tasks/` and `agent-output/` directories.
- starter `AGENTS.md` only if the target repo does not already have one.
- `.env.agent-pipeline.example` with env var names only.

It never writes real API keys and does not print `.env` contents.

## Copilot Context And Instructions

Yes, installation adds Copilot-facing context and instructions:

- `.github/agents/orchestrator.agent.md` defines the selectable Orchestrator/PM
  mode for Copilot Chat.
- `AGENTS.md` gives repo-wide operating rules and role boundaries.
- `agent-context/current-state.md`, `next-tasks.md`,
  `architecture-decisions.md`, `review-checklist.md`, and `handoff.md` provide
  compact persistent context for future runs. `handoff.md` is the conversation
  handoff: update it before ending long Copilot sessions or after accepted
  pipeline runs so the next session can resume without replaying the chat.
- The installer skill itself remains available in `.github/skills/` when using
  the skill-installed path.

Public-release recommendation: add an optional `.github/copilot-instructions.md`
template during the npm/bootstrap work. It should be short and point Copilot to
`AGENTS.md` plus the compact `agent-context/` files. Right now the custom agent
mode and `AGENTS.md` carry the main instruction load, so the installer works, but
the Copilot instruction file would make the repo friendlier for users who stay in
the default Copilot agent instead of selecting Orchestrator mode.

## Brownfield Support

Yes, this can be added to a brownfield repo.

Current behavior is conservative:

- Existing `tools/agent-runner/` is skipped unless `--force` is passed.
- Existing `AGENTS.md` is skipped, so repo-owned instructions are not overwritten.
- Existing starter context files are skipped individually.
- `run.mjs init` skips existing `pipeline.config.json` and
  `.github/agents/orchestrator.agent.md` unless `--force` is passed.

Brownfield recommended flow:

```sh
cd /path/to/existing-repo
git status --short
node .github/skills/agent-orchestrator-installer/scripts/install-agent-orchestrator.mjs --target "$PWD"
```

Then manually merge repo-specific rules into:

- `AGENTS.md` if it already existed.
- `tools/agent-runner/pipeline.config.json`.
- `agent-context/architecture-decisions.md`.
- `agent-context/review-checklist.md`.

Do not use `--force` in brownfield repos unless the user explicitly wants to
replace existing runner/config/agent files.

## Npm / Package Release Findings

- The unscoped npm name `agent-pipeline` is already taken (`npm view
  agent-pipeline version` returned `0.1.4`).
- Scoped names checked with no result at last run:
  - `@hartou/agent-pipeline`
  - `@hartou/create-agent-pipeline`
- `package.json` now uses the scoped name `@hartou/agent-pipeline`, MIT license
  metadata, public publish config, and no `private` flag.
- The package binary points to `./run.mjs`. In npm-package context, `init` now
  delegates to the installer script with `--source <package-root>` so public npm
  UX can bootstrap a normal target repo.

Recommended public command:

```sh
npx @hartou/agent-pipeline init --target .
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

## Public Release Tasks

1. Make the GitHub repo public after final secret/license review.
2. Add a license file if this will be public.
3. Update `package.json` for npm:
   - rename to `@hartou/agent-pipeline` unless another scope/name is chosen.
   - remove `"private": true`.
   - add `repository`, `homepage`, `bugs`, `keywords`, `license`, and
     `publishConfig.access` if publishing scoped public.
4. Add an npm bootstrap mode to the CLI, so `npx @hartou/agent-pipeline init`
  works from a package cache and installs into the target repo. Done locally;
  validate from a packed tarball before publishing.
5. Add an optional `.github/copilot-instructions.md` template that points to
  `AGENTS.md`, `agent-context/current-state.md`, `agent-context/next-tasks.md`,
  `agent-context/architecture-decisions.md`, `agent-context/review-checklist.md`,
  and `agent-context/handoff.md`. Done locally; installer skips existing files.
6. Ensure npm package includes every file needed by the bootstrapper:
   - `run.mjs`
   - `package.json`
   - `pipeline.config.schema.json`
   - `templates/`
   - `Dockerfile`
   - `README.md`
   - `GUIDE.md`
   - `.github/skills/`
7. Rewrite README primary install path around npm/npx, leaving clone/copy as a
   fallback/dev path.
8. Test in a fresh repo outside this checkout:

```sh
mkdir -p ~/dev/agent-pipeline-npx-test
cd ~/dev/agent-pipeline-npx-test
git init
npx /path/to/local/packed/tarball init --target .
SAKANA_FUGU_API_KEY=dummy DEEPSEEK_API_KEY=dummy OPENAI_API_KEY=dummy node tools/agent-runner/run.mjs doctor
```

9. Pack and inspect contents:

```sh
npm pack --dry-run
```

10. Publish only after package install has been tested from a tarball.

## Known Good Manual Install Command

From merged `main`, the README skill-installed path worked:

```sh
mkdir -p /path/to/target-repo
cd /path/to/target-repo
git init
gh repo clone hartou/agent-pipeline /tmp/agent-pipeline -- --depth 1 --branch main
mkdir -p /path/to/target-repo/.github/skills
cp -R /tmp/agent-pipeline/.github/skills/agent-orchestrator-installer /path/to/target-repo/.github/skills/
cd /path/to/target-repo
node .github/skills/agent-orchestrator-installer/scripts/install-agent-orchestrator.mjs --target /path/to/target-repo
SAKANA_FUGU_API_KEY=dummy DEEPSEEK_API_KEY=dummy OPENAI_API_KEY=dummy node tools/agent-runner/run.mjs doctor
```

Expected validation output ends with:

```text
DOCTOR: all green
```