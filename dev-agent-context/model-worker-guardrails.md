# Model Worker Guardrails

Track model roles, strengths, failure modes, and prompt/config adjustments here. Update after benchmark or production runs.

## Current Role Split

- Fugu: orchestration, dependency graph, worker assignment, validation.
- DeepSeek: broad implementation candidate; compare speed and QA outcomes before promotion.
- gpt-4o-mini: scoped local edits and lightweight review work.
- GLM: evaluation candidate for senior coding or implementation QA; require repeated telemetry before promotion.
- OpenAI eval candidates: `gpt-5.4-nano`, `gpt-5.4-mini`, and `gpt-5-mini`; evaluate before assigning a permanent worker role.

## Evaluation Rules

- Compare models on the same task shape, files, max token budget, QA command, and telemetry fields.
- Prefer streaming-aware metrics: time to first token, generation duration, output tokens/sec, and end-to-end latency.
- Include official input/cached-input/output pricing from `openai-eval-roster.md` when estimating roster cost.
- Do not promote a model based on official speed claims alone; require pipeline-local latency, QA, verbosity, and repair-loop evidence.
- Record model decisions in `model-worker-performance.csv`.