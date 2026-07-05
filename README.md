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

Docker is required for this default containerized mode. Install Docker Desktop on
macOS/Windows or Docker Engine on Linux, and confirm `docker version` works before
running containerized workers.

```sh
docker compose --profile agents build agent-worker   # build the worker image (or the wiring builds it on demand)
```

Set `container.enabled: false` to fall back to in-process execution (still parallel,
governed by `loop.concurrency`).

## Install into a repo

Prerequisites:

- Node.js 20 or newer.
- Docker, for the default ephemeral-container worker model. Install Docker
  Desktop on macOS/Windows or Docker Engine on Linux, then make sure
  `docker version` works from your shell.
- Provider API keys for Fugu / Sakana AI, DeepSeek, and OpenAI.

The normal install path is npm/npx from the target repository:

```sh
cd /path/to/target-repo
npx @hartou/agent-pipeline init --target . --skill
```

The `--skill` flag is explicit for readability; the npm bootstrap installs the
Copilot skill by default. Use `--skip-skill` only if you want the runner without
the reusable installer skill.

The bootstrap installs:

- `tools/agent-runner/` with the pinned runner and templates.
- `.github/skills/agent-orchestrator-installer/` for future Copilot-assisted installs.
- `.github/agents/orchestrator.agent.md`.
- `.github/copilot-instructions.md` if the repo does not already have one.
- `AGENTS.md` if the repo does not already have one.
- starter `agent-context/`, `agent-tasks/`, and `agent-output/` folders.
- `.env.agent-pipeline.example` with env var names only.

Existing files are skipped unless you pass `--force`, so brownfield installs stay
conservative by default.

After install, edit `tools/agent-runner/pipeline.config.json` for the target repo,
add real API keys to `.env` or your shell, and run:

```sh
node tools/agent-runner/run.mjs doctor
```

Nothing about endpoints, models, or keys lives in code — only in
`pipeline.config.json`, and keys are referenced by env-var **name** only. The
engine is the same bytes in every repo; the config is the only variable.

## Fallback/dev install

1. Copy the `tools/agent-runner/` folder into the target repo (vendored — pinned
   by content, offline, no install step).
2. `node tools/agent-runner/run.mjs init` — writes `pipeline.config.json` and the
   orchestrator agent mode from `templates/`. Never overwrites without `--force`.
3. Edit `pipeline.config.json`: set `project`, `paths`, `stackFacts`, and the `qa`
   commands for this repo. Add the referenced keys to `.env`.
4. `node tools/agent-runner/run.mjs doctor` until green, then `run`.

## Installer skill

This repo also ships a reusable Copilot skill at
`.github/skills/agent-orchestrator-installer/`. Install that skill into another
repo when you want the agent to bootstrap Orchestrator mode for you. The bundled
script vendors `tools/agent-runner/`, runs `init`, creates starter
`agent-context/`, `agent-tasks/`, and `agent-output/` folders, and writes an env
example with key names only. The starter context includes
`agent-context/handoff.md`, a compact conversation handoff note to update before
ending long sessions or after accepted pipeline runs. The npm/npx bootstrap uses
this same installer under the hood.

There are two normal ways to use it.

First, make sure the target repo already exists. For a brand-new empty repo:

```sh
mkdir -p /path/to/target-repo
cd /path/to/target-repo
git init
```

### Fastest path from this repo

Clone this repo somewhere temporary, then run the installer directly against your
target repo. This does **not** require installing the skill into the target first:


```sh
gh repo clone hartou/agent-pipeline /tmp/agent-pipeline
cd /tmp/agent-pipeline
node .github/skills/agent-orchestrator-installer/scripts/install-agent-orchestrator.mjs --target /path/to/target-repo --source "$PWD"
```

### Skill-installed path

If you want the target repo to carry the reusable skill, copy only the skill first,
then run it from inside the target repo. In this mode you omit `--source`; the
script fetches `hartou/agent-pipeline` itself, then installs the runner and runs
`init`.

```sh
gh repo clone hartou/agent-pipeline /tmp/agent-pipeline
mkdir -p /path/to/target-repo/.github/skills
cp -R /tmp/agent-pipeline/.github/skills/agent-orchestrator-installer /path/to/target-repo/.github/skills/
cd /path/to/target-repo
node .github/skills/agent-orchestrator-installer/scripts/install-agent-orchestrator.mjs --target /path/to/target-repo
```

After either path, edit `tools/agent-runner/pipeline.config.json` for the target
repo, add real API keys to `.env` or your shell, and run:

```sh
node tools/agent-runner/run.mjs doctor
```

## Secrets

Keys are read from `.env` at the repo root at call time. They are never stored in
config, never printed, and never sent to the browser.

Create provider keys here, then put only the values in your local `.env`:

- Fugu / Sakana AI: https://platform.sakana.ai/
- DeepSeek: https://platform.deepseek.com/api_keys
- OpenAI: https://platform.openai.com/api-keys

The default env var names are listed in `.env.agent-pipeline.example`:

```sh
SAKANA_FUGU_API_KEY=
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
```

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

Use telemetry after real runs like this:

```sh
node tools/agent-runner/run.mjs report
```

Keep `agent-context/telemetry.csv` as the raw machine log and annotate
`agent-context/model-worker-performance.csv` with human judgment: which worker was
best for which task shape, what failed, what prompt/config adjustment helped, and
whether QA passed. Do not paste secrets, raw `.env` contents, or sensitive customer
data into the curated ledger.

## Contributing back from installed repos

Installed repos receive a vendored copy of the runner and skill. That means they
can experiment locally, but they cannot open a PR directly from the target repo's
normal branch because its git history belongs to that product repo, not to
`hartou/agent-pipeline`.

The safe contribution path is:

1. In the target repo, make and validate changes only under copied pipeline files:
  `tools/agent-runner/`, `.github/skills/agent-orchestrator-installer/`,
  `.github/agents/orchestrator.agent.md`, templates, or docs.
2. Open or clone `https://github.com/hartou/agent-pipeline` separately.
3. Port the same changes into that checkout, or create a patch from the target
  repo and apply it to the upstream checkout.
4. Run the package checks from the upstream checkout:

```sh
node --check run.mjs
node --check .github/skills/agent-orchestrator-installer/scripts/install-agent-orchestrator.mjs
npm pack --dry-run
```

5. Open a GitHub PR against `hartou/agent-pipeline`. Include the relevant
  telemetry summary and validation output, but redact secrets and private product
  details.

For lighter feedback, open an issue with the engine version, provider/model, task
shape, QA result, and any sanitized telemetry insight. The `engine_version` column
exists specifically so downstream results can be tied back to the package version
that produced them.
