# Current State

- Branch: `pipeline-glm-eval-and-parallel-diagnostics`.
- Active focus: GLM/DeepSeek worker evaluation, parallel diagnostics, file authorship, and publication draft context.
- Latest source package validation: `npm pack --dry-run` passed after authorship tracking.
- Release branch rule: do not carry `agent-context/`, `agent-output/`, `agent-tasks/`, or `publication/` into `release/npm` unless the user explicitly requests release documentation.

## Recent Decisions

- Use `dev` or feature branches for active implementation and evaluation work.
- Use `release/npm` only for npm package preparation, version review, pack/install smoke tests, publish approval, and tags.
- Keep model-worker benchmark notes in development context and curated telemetry, not in release package artifacts.