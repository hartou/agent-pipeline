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
