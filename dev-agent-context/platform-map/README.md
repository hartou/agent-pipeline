# Platform Map

Record repo-specific platform boundaries, services, external APIs, deployment surfaces, and ownership notes here.

## Agent Pipeline Repo

- Runtime: Node.js 20+ CLI using built-in `fetch` and `node:*` modules.
- Distribution: public npm package `@hartou/agent-pipeline`.
- Release branch: `release/npm` for packaging, approval, publish, and tagging only.
- Development context: keep `dev-agent-context/`, `dev-agent-output/`, `dev-agent-tasks/`, and `dev-publication/` out of release branches unless explicitly requested.