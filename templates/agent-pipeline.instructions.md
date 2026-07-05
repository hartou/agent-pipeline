---
description: "Use when working with agent-pipeline, Agent Orchestrator mode, Fugu, DeepSeek, gpt-4o-mini, agent-tasks, agent-context, tools/agent-runner, or multi-agent implementation workflows."
applyTo: "**"
---

# Agent Pipeline Instructions

This repo has Agent Pipeline installed. Treat this file as the pipeline-specific
companion to any repo-owned `AGENTS.md` or `.github/copilot-instructions.md`.

Before pipeline work, read:

- `AGENTS.md`
- `agent-context/current-state.md`
- `agent-context/next-tasks.md`
- `agent-context/architecture-decisions.md`
- `agent-context/review-checklist.md`
- `agent-context/handoff.md`
- `tools/agent-runner/GUIDE.md`

When the user asks for implementation through Agent Orchestrator mode or the
agent-pipeline:

- Copilot is Client/QA: optimize the request, run the pipeline, test real output,
  and approve or reject Fugu-satisfied candidates.
- Fugu is the orchestrator: it plans bounded subtasks, coordinates workers, and
  validates worker PR-like changes before they reach the Client.
- DeepSeek and gpt-4o-mini are workers: they write product code directly into the
  real repo from isolated task branches/worktrees.
- `tools/agent-runner/run.mjs` is wiring only. Do not treat it as another actor or
  make it decide product behavior.
- Do not hand-edit product code while acting in Orchestrator mode. Send failures
  back through a feedback file and rerun the pipeline.
- Do not semantically validate worker PRs as Copilot. Fugu accepts/rejects worker
  PRs; Copilot/the Client approves only after Fugu is satisfied.
- Do not publish to NPM from ordinary implementation branches. Use `release/npm`
  for package release preparation and publish only after explicit client approval.

Normal loop:

```sh
node tools/agent-runner/run.mjs doctor
node tools/agent-runner/run.mjs run --task agent-tasks/<task>.md
node tools/agent-runner/run.mjs report
```

Keep secrets in `.env` or the shell only. Never print, commit, or paste API keys.