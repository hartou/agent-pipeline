---
description: "Use when working with agent-pipeline, Agent Orchestrator mode, Fugu, DeepSeek, GPT QA, gpt-4o-mini, dev-agent-tasks, dev-agent-context, tools/agent-runner, or multi-agent implementation workflows."
applyTo: "**"
---

# Agent Pipeline Instructions

This repo has Agent Pipeline installed. Treat this file as the pipeline-specific
companion to any repo-owned `AGENTS.md` or `.github/copilot-instructions.md`.

Before pipeline work, read the context folder through its index first:

- `AGENTS.md`
- `dev-agent-context/context-index.md`
- Every relevant file referenced by `dev-agent-context/context-index.md`, especially
  `current-state.md`, `next-tasks.md`, `architecture-decisions.md`,
  `model-worker-guardrails.md`, `review-checklist.md`, and
  `new-conversation-handoff.md`
- `tools/agent-runner/GUIDE.md`

When the user asks for implementation through Agent Orchestrator mode or the
agent-pipeline:

- Copilot is Client/QA: optimize the request, run the pipeline, test real output,
  and approve or reject Fugu-satisfied candidates.
- Fugu is the orchestrator: it plans bounded subtasks, coordinates workers, and
  validates worker PR-like changes before they reach the Client.
- The default worker roster is role-specific: `deepseek-v4-flash` builds first,
  `gpt-5.4-mini` critiques/tests, `deepseek-v4-pro` repairs or hardens after QA
  failure, and `gpt-4o-mini` handles utility tasks such as i18n,
  sentiment/classification, and small transformations.
- `tools/agent-runner/run.mjs` is wiring only. Do not treat it as another actor or
  make it decide product behavior.
- Do not hand-edit product code while acting in Orchestrator mode. Send failures
  back through a feedback file and rerun the pipeline.
- Do not semantically validate worker PRs as Copilot. Fugu accepts/rejects worker
  PRs; Copilot/the Client approves only after Fugu is satisfied.
- Do not publish to NPM from ordinary implementation branches. Use `release/npm`
  for package release preparation and publish only after explicit client approval.
- Treat `dev-agent-context/`, `dev-agent-output/`, `dev-agent-tasks/`, and
  `dev-publication/` as development context. Do not carry them into `release/npm` unless explicitly
  requested as release documentation.
- Do not add Gemini or GLM to the active roster unless the target repo explicitly
  opts into that experiment and records telemetry.

Normal loop:

```sh
node tools/agent-runner/run.mjs doctor
node tools/agent-runner/run.mjs run --task dev-agent-tasks/<task>.md
node tools/agent-runner/run.mjs report
```

Keep secrets in `.env` or the shell only. Never print, commit, or paste API keys.