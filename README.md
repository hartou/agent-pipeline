# agent-pipeline

A deterministic, config-driven multi-agent delivery pipeline. Zero runtime
dependencies (pure `node:*` + global `fetch`).

Roles mirror a real software team:

- **Client** (you / Copilot) — intake, QA, approval. Talks only to the orchestrator.
- **Orchestrator** (Fugu) — decomposes a request into bounded subtasks.
- **Workers** (deepseek-4-pro, gpt-4o-mini) — write product code **directly into
  the real repo**. No sandbox, no staging folder, no "build then move".

The client tests the **real output** (typecheck / Playwright / curl against the
live stack). On failure, feedback goes back to the orchestrator, which re-plans;
workers fix in place; re-test — until the client approves.

> New here? Read [GUIDE.md](./GUIDE.md) for the full concept + a FAQ.

## Layout

```
tools/agent-runner/
  run.mjs                       # the engine (repo-agnostic)
  pipeline.config.json          # THIS repo's profile (the only per-repo variable)
  pipeline.config.schema.json   # validates the config (used by `doctor`)
  templates/                    # scaffolds written by `init`
  package.json                  # name, version (stamped into telemetry), bin
```

## Commands

```sh
node tools/agent-runner/run.mjs init         # scaffold config + agent mode (idempotent)
node tools/agent-runner/run.mjs doctor       # preflight: node version, config, keys, QA cmds
node tools/agent-runner/run.mjs plan --task agent-tasks/<f>.md   # dry-run decomposition
node tools/agent-runner/run.mjs build --plan <plan.json> --subtask <id>  # one subtask
node tools/agent-runner/run.mjs qa           # run the repo's QA commands
node tools/agent-runner/run.mjs run --task agent-tasks/<f>.md    # full loop plan→build→qa→retry→report
node tools/agent-runner/run.mjs report [--run <run_id>]          # aggregate telemetry
```

## Parallel execution (containers)

Fugu owns coordination: its plan declares `dependsOn` per sub-task, and the wiring
runs everything with no unmet dependency **in parallel**, up to `loop.concurrency`.
With `container.enabled` in the config, each build sub-task runs in its **own
ephemeral Docker container** (repo bind-mounted, keys from the mounted `.env`).
Two sub-tasks that touch the same file are never run at the same time.

```sh
docker compose --profile agents build agent-worker   # build the worker image (or the wiring builds it on demand)
```

Set `container.enabled: false` to fall back to in-process execution (still parallel,
governed by `loop.concurrency`).

## Deploying to a new repo (deterministic)

1. Copy the `tools/agent-runner/` folder into the target repo (vendored — pinned
   by content, offline, no install step).
2. `node tools/agent-runner/run.mjs init` — writes `pipeline.config.json` and the
   orchestrator agent mode from `templates/`. Never overwrites without `--force`.
3. Edit `pipeline.config.json`: set `project`, `paths`, `stackFacts`, and the `qa`
   commands for this repo. Add the referenced keys to `.env`.
4. `node tools/agent-runner/run.mjs doctor` until green, then `run`.

Nothing about endpoints, models, or keys lives in code — only in
`pipeline.config.json`, and keys are referenced by env-var **name** only. The
engine is the same bytes in every repo; the config is the only variable.

## Installer skill

This repo also ships a reusable Copilot skill at
`.github/skills/agent-orchestrator-installer/`. Install that skill into another
repo when you want the agent to bootstrap Orchestrator mode for you. The bundled
script vendors `tools/agent-runner/`, runs `init`, creates starter
`agent-context/`, `agent-tasks/`, and `agent-output/` folders, and writes an env
example with key names only.

From a checkout of this repo:

```sh
node .github/skills/agent-orchestrator-installer/scripts/install-agent-orchestrator.mjs --target /path/to/target-repo --source "$PWD"
```

From a repo where only the skill is installed, omit `--source`; the script fetches
`hartou/agent-pipeline` through GitHub CLI auth:

```sh
node .github/skills/agent-orchestrator-installer/scripts/install-agent-orchestrator.mjs --target /path/to/target-repo
```

## Secrets

Keys are read from `.env` at the repo root at call time. They are never stored in
config, never printed, and never sent to the browser.

## Telemetry (two-tier)

- **`telemetry.csv`** (auto) — one machine-written row per model call:
  `ts_iso, engine_version, run_id, round, verb, actor, role, provider, model,
  prompt_tokens, completion_tokens, total_tokens, latency_ms, http_status,
  result, qa_passed, qa_failed, files_written, est_cost_usd, task_file, error`.
- **`model-worker-performance.csv`** (curated) — the hand-owned acceptance ledger.
  `report` only *drafts* a row; you annotate and keep it.

`est_cost_usd` is computed from each actor's `pricing` in config (blank if pricing
is 0/unset — never fabricated). `engine_version` (from this package's `version`)
is stamped on every row so any result is traceable to the engine that produced it.
