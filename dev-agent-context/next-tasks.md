# Next Tasks

- Start the next conversation from `dev-agent-context/openai-eval-roster.md` and build a controlled benchmark for `gpt-5.4-nano`, `gpt-5.4-mini`, and `gpt-5-mini`.
- Add streaming-aware telemetry fields: time to first token, generation duration, output tokens/sec, and end-to-end latency.
- Repeat GLM vs DeepSeek comparisons with the same prompts, file targets, token budgets, and QA commands.
- Compare new OpenAI eval models against `gpt-4o-mini`, `deepseek-v4-pro`, and `glm-5.2` for speed, QA pass rate, verbosity, cost, and container concurrency.
- Keep `dev-publication/linkedin-article-multi-agent-model-benchmark.md` as editorial context outside npm release artifacts.
- Before preparing `release/npm`, verify the package tarball does not include development context.