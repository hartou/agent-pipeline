# Repo File Boundaries

This repo has two different classes of files. Keep the distinction explicit before release work.

## Required To Ship And Run Agent Pipeline

These files are part of the installable package or public runtime surface:

- `run.mjs` — repo-agnostic CLI engine and API wiring.
- `pipeline.config.schema.json` — config validation schema used by `doctor`.
- `templates/` — generated config, agent mode, and instruction templates.
- `Dockerfile` — runner image for containerized orchestration/workers.
- `.github/skills/agent-orchestrator-installer/` — reusable installer skill and script.
- `README.md`, `GUIDE.md`, `LICENSE`, `package.json` — package metadata and public docs.
- `img/` — public README/package assets.

The npm tarball boundary is controlled by `package.json#files`. If a file is not needed to install, run, or document the public package, do not add it there.

## Required To Develop Agent Pipeline

These files help evolve, test, benchmark, or explain the pipeline, but are not required by users installing the package:

- `agent-context/` — development memory, handoffs, model guardrails, release hygiene notes, and curated performance context.
- `agent-tasks/` — local task specs for active runs.
- `agent-output/` — generated plans, feedback, telemetry shards, raw model dumps.
- `publication/` — editorial drafts and public narrative work in progress.
- throwaway benchmark repos under `~/dev/` — validation/evaluation artifacts, not package content.

## Release Rule

Use `release/npm` only for package preparation, version review, pack/install smoke tests, approval, publish, and tags. Do not merge ordinary development context into `release/npm` unless the user explicitly requests public-facing release documentation.