# MVP Tracker

## Goal

- Keep the standalone `@hartou/agent-pipeline` repo installable, testable, and safe to publish through an explicit npm release branch.

## In Scope

- Config-driven worker roster and model evaluation.
- Parallel container execution diagnostics.
- Per-file authorship metadata.
- Development context for active branches.

## Out of Scope

- Publishing from ordinary feature branches.
- Shipping development context in npm tarballs.
- Carrying active benchmark notes into `release/npm` unless explicitly requested.

## Acceptance

- [ ] `npm pack --dry-run` excludes development context.
- [ ] `doctor` remains green in target repos.
- [ ] Release branch contains only package/release artifacts needed for npm publishing.