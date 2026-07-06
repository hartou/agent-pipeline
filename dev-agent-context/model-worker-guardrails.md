# Model Worker Guardrails

Track model roles, strengths, failure modes, and prompt/config adjustments here. Update after benchmark or production runs.

## Current Role Split

- Fugu: orchestration, dependency graph, worker assignment, validation.
- DeepSeek: broad implementation candidate; compare speed and QA outcomes before promotion.
- gpt-4o-mini: scoped local edits and lightweight review work.
- GLM: evaluation candidate for senior coding or implementation QA; require repeated telemetry before promotion.

## Evaluation Rules

- Compare models on the same task shape, files, max token budget, QA command, and telemetry fields.
- Prefer streaming-aware metrics: time to first token, generation duration, output tokens/sec, and end-to-end latency.
- Record model decisions in `model-worker-performance.csv`.