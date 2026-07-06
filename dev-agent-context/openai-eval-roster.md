# OpenAI Eval Roster

Use this file to start the next conversation about evaluating new OpenAI workers for the Agent Pipeline roster.

## Newly Added Eval Models

The `.env` file now has three OpenAI eval model slots. Keep only env-var names in repo context; never copy API keys here.

- `OPENAI_MODEL_EVAL1` -> `gpt-5.4-nano`
- `OPENAI_MODEL_EVAL2` -> `gpt-5.4-mini`
- `OPENAI_MODEL_EVAL3` -> `gpt-5-mini`

## Official Pricing Snapshot

Prices are per 1M tokens, Standard tier, from the user-provided official pricing screenshots on 2026-07-05.

| Model | Input | Cached input | Output | Notes |
| --- | ---: | ---: | ---: | --- |
| `gpt-5.4-nano` | $0.20 | $0.02 | $1.25 | New flagship pricing table, short context. |
| `gpt-5.4-mini` | $0.75 | $0.075 | $4.50 | New flagship pricing table, short context. |
| `gpt-5-mini` | $0.25 | $0.025 | $2.00 | Existing GPT-5 pricing table. |

Nearby reference points from the same screenshots:

| Model | Input | Cached input | Output |
| --- | ---: | ---: | ---: |
| `gpt-4o-mini` | $0.15 | $0.075 | $0.60 |
| `gpt-5-nano` | $0.05 | $0.005 | $0.40 |
| `gpt-5.4` | $2.50 | $0.25 | $15.00 |
| `gpt-5.5` | $5.00 | $0.50 | $30.00 |

## Evaluation Intent

Next conversation goal: test these three OpenAI candidates against the current worker roster to decide the next default worker mix for speed, quality, cost, and concurrency.

Compare against the current baseline roster:

- Fugu as orchestrator.
- DeepSeek `deepseek-v4-pro` as broad implementation worker.
- OpenAI `gpt-4o-mini` as scoped local-edit worker.
- GLM `glm-5.2` as senior-coding / implementation-QA candidate.

## Test Rules

- Use the same task prompt, repo, target files, max token budget, container settings, and QA command across candidates.
- Measure end-to-end wall time, time to first token if telemetry supports it, generation duration, output tokens/sec, output token count, QA result, files changed, and estimated cost.
- Keep container concurrency visible: record planned subtasks, initially ready subtasks, dependency edges, file-overlap locks, and observed simultaneous containers.
- Treat official model speed/pricing as a hypothesis, not as the pipeline result. Pipeline latency includes orchestration, blocking API calls, verbosity, Docker startup, QA, and repair loops.
- Record raw telemetry in `dev-agent-context/telemetry.csv` and curated decisions in `dev-agent-context/model-worker-performance.csv`.

## Starting Prompt For Next Conversation

```text
Continue from `dev-agent-context/openai-eval-roster.md`. Confirm git status, read `dev-agent-context/context-index.md`, then design and run a controlled benchmark for `OPENAI_MODEL_EVAL1`, `OPENAI_MODEL_EVAL2`, and `OPENAI_MODEL_EVAL3` against the current roster. Do not print `.env` values. Capture pricing, latency, QA result, container concurrency, and a recommendation for the next worker roster.
```