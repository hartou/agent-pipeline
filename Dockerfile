# Thin, pinned Node runtime for agent-pipeline workers / orchestrator calls.
#
# The wiring (run.mjs) and pipeline.config.json come from the repo, which is
# bind-mounted at /repo by the coordinator — so this image stays generic and
# always uses the repo's current pipeline and config (single source of truth).
#
# The coordinator launches one ephemeral container per build sub-task, e.g.:
#   docker run --rm -v <repo>:/repo -w /repo \
#     -e PIPELINE_TELEMETRY_CSV=/repo/agent-output/.telemetry/<run>__<sub>.csv \
#     agent-pipeline-runner:local \
#     node tools/agent-runner/run.mjs build --plan <plan> --subtask <id>
#
# Keys are read from the mounted /repo/.env at call time (never baked in).
FROM node:20-alpine
WORKDIR /repo
CMD ["node", "tools/agent-runner/run.mjs", "doctor"]
