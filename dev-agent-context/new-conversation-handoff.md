# New Conversation Handoff

Use this file to resume the next Copilot or Orchestrator session without replaying the whole chat.

## Current Focus

- Active branch: `pipeline-glm-eval-and-parallel-diagnostics`.
- Recent work: GLM worker config, parallel diagnostics, file authorship, DeepSeek comparison, LinkedIn article draft under `dev-publication/`, and a new OpenAI eval roster in `dev-agent-context/openai-eval-roster.md`.
- Release hygiene: keep this development context off `release/npm`.

## Next Conversation Prompt

```text
Continue from `dev-agent-context/new-conversation-handoff.md`. Confirm git status, read `dev-agent-context/context-index.md`, then proceed with the next task. Do not merge `dev-*` development context into `release/npm` unless explicitly requested.

Priority next task: read `dev-agent-context/openai-eval-roster.md`, then design and run a controlled benchmark for `OPENAI_MODEL_EVAL1`, `OPENAI_MODEL_EVAL2`, and `OPENAI_MODEL_EVAL3` against the current roster. Do not print `.env` values.
```