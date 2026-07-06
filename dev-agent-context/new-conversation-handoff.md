# New Conversation Handoff

Use this file to resume the next Copilot or Orchestrator session without replaying the whole chat.

## Current Focus

- Active branch: `pipeline-glm-eval-and-parallel-diagnostics`.
- Recent work: GLM worker config, parallel diagnostics, file authorship, DeepSeek comparison, and LinkedIn article draft under `dev-publication/`.
- Release hygiene: keep this development context off `release/npm`.

## Next Conversation Prompt

```text
Continue from `dev-agent-context/new-conversation-handoff.md`. Confirm git status, read `dev-agent-context/context-index.md`, then proceed with the next task. Do not merge `dev-*` development context into `release/npm` unless explicitly requested.
```