# Architecture Decisions

- `run.mjs` remains repo-agnostic wiring. It transports messages, executes plans, logs telemetry, and runs QA; it does not make product decisions.
- Fugu owns orchestration and dependency graphs through `dependsOn`.
- Workers write real files in isolated containers/worktrees and are tracked by telemetry plus `file-authorship.csv`.
- `dev-agent-context/` is development memory for this source repo, not runtime product code and not npm package content.
- NPM releases are staged from `release/npm`; development context should be removed or left unmerged there.