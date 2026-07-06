# Context Index

Read these files before substantial agent-pipeline work:

- `repo-file-boundaries.md` — which files ship/run Agent Pipeline versus which
  files are development context.
- `current-state.md` — current branch, run state, and active goal.
- `next-tasks.md` — bounded tasks ready for orchestration.
- `architecture-decisions.md` — repo rules and constraints workers must follow.
- `model-worker-guardrails.md` — model roles, strengths, and known failure modes.
- `model-worker-performance.csv` — curated model performance ledger.
- `mvp-tracker.md` — MVP scope, status, and acceptance.
- `new-conversation-handoff.md` — concise handoff for the next session.
- `review-checklist.md` — reviewer checklist before accepting worker output.
- `self-registration-mvp-handoff.md` — optional handoff for self-registration/MVP work.
- `platform-map/` — repo-specific platform and integration notes.

This `dev-agent-context/` folder is source-repo development context. Keep it off release branches such as `release/npm` unless explicitly needed for release notes.