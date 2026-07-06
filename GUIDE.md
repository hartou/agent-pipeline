# Agent Pipeline — Guide

A plain-language guide to the multi-agent delivery pipeline: **how it works** (Part 1)
and a **FAQ** (Part 2) built from real questions people have asked.

For commands and setup steps, see [README.md](./README.md). This document explains
the *idea*.

---

## Part 1 — The whole idea

### The problem it solves

You want work done by AI the way a real software team does it: someone owns the
request, a lead breaks it down, developers build it, and the owner tests the real
result and asks for fixes until it's right. This pipeline wires up exactly that
loop using three different AI models, each playing a role it's good at.

### The three actors (and one piece of wiring)

| Role | Who | What they do |
|------|-----|--------------|
| **Client** | You / Copilot (any model — Opus 4.8, GPT‑5.5, …) | Define the work, optimize the request, **test the real output**, approve or reject. The only approver. |
| **Orchestrator** | Fugu (Sakana) | The chief engineer. Breaks the request into bounded sub‑tasks and assigns each to the best worker. |
| **Workers** | DeepSeek‑4‑pro, gpt‑4o‑mini | The developers. They write real code in isolated task branches/worktrees. |

There is also one thing that is **not** an actor: the **wiring** — the small
command‑line program [`run.mjs`](./run.mjs). The three actors are AI models behind
web APIs; they cannot call each other. `run.mjs` is the phone line between them: it
sends your request to Fugu, reads Fugu's plan, sends each sub‑task to the right
worker, carries worker PR-like changes back to Fugu for validation, and returns
Fugu-satisfied candidates to the client. It carries messages — it does **not** make
decisions. All the thinking belongs to the actors.

```mermaid
flowchart LR
    C["Client = YOU / Copilot<br/>define · test · approve"]
    F["Orchestrator = Fugu<br/>decompose · assign"]
    W["Workers = DeepSeek / gpt-4o-mini<br/>write real code"]
    C <-->|via run.mjs| F
    F <-->|via run.mjs| W
```

### How it develops: isolated branches, real code

Workers develop against the **real repository** in isolated task branches or
worktrees — the actual `apps/`, `services/`, etc., not copied product code in an
artifact folder. Each worker returns a PR-like change to Fugu. Fugu validates it,
rejects it back to the worker when needed, and returns only satisfied candidates to
the client. The client is still the final approver.

The only things that ever land in the `dev-agent-output/` folder are **plans,
feedback, telemetry, and raw dumps** — never product code.

### The loop

```mermaid
flowchart TD
    A["Client optimizes the request"] --> B["Fugu plans sub-tasks"]
    B --> C["Workers build task branches"]
    C --> D["Fugu validates worker PRs"]
    D -->|reject| C
    D -->|satisfied| E["Client reviews candidate"]
    E -->|approve| G["Integrate accepted work"]
    E -->|reject| F["Feedback back to Fugu"]
    F --> B
```

The loop is bounded (a `maxRounds` guard) so it can't run forever. On each failure
the real test output is fed back to Fugu, which produces a **minimal fix plan**;
workers update their isolated branches and Fugu validates again.

### Two kinds of sub-task

Not all work writes code. Fugu tags each sub‑task:

- **`build`** — the worker writes/edits files (implementation work).
- **`verify`** — a check only (health, smoke, "does it run?"). No code is written;
  the client's real QA confirms it.

The wiring follows Fugu's tag. It never forces a check to produce code, and it
never crashes just because a worker had nothing to write — it reports back to Fugu
and the loop continues.

### Running in parallel (Fugu coordinates, containers execute)

Coordination — what runs, in what order, what can go at the same time — is an
orchestration decision, so it belongs to **Fugu**, not the wiring. Fugu expresses
it in the plan with **`dependsOn`**: each sub‑task lists the ids that must finish
first. Sub‑tasks with no unmet dependency run **in parallel**.

The wiring is just Fugu's hands: it executes that graph, running independent
sub‑tasks concurrently up to `loop.concurrency`. When `container.enabled` is set,
Fugu orchestration runs in the runner container, and each build sub‑task runs in
its **own ephemeral Docker container** (the repo is bind‑mounted so it writes real
files; keys come from the mounted `.env`). This gives isolation and lets you scale
the number of coordinations and workers.

Docker is a prerequisite for that containerized worker mode. Install Docker
Desktop on macOS/Windows or Docker Engine on Linux, then confirm `docker version`
works from the shell where you run the pipeline. If Docker is unavailable, set
`container.enabled: false` in `tools/agent-runner/pipeline.config.json` to run
orchestration and workers in process instead. You can also set
`container.orchestrator: false` or `container.workers: false` for a split mode.

Safety net: the wiring will never run two sub‑tasks that touch the **same file** at
once, even if Fugu forgot to sequence them — but Fugu should chain file‑sharing work
with `dependsOn`. Build the worker image once with
`docker compose --profile agents build agent-worker` (the wiring also builds it on
demand).

If you see only one worker container at a time, inspect the run's graph summary:
`initially-ready` tells you how many build sub‑tasks can start immediately,
`dependency-edges` shows how much sequencing Fugu planned, and
`file-overlap-pairs` shows where the wiring's file lock will serialize work for
safety. A healthy parallel plan usually has multiple initially-ready, file-disjoint
build tasks.

### Evaluating GLM as a faster worker

The template includes `glm-5.2` as a worker candidate for fast senior coding and
implementation QA. Start by letting Fugu choose it for independent, file-disjoint
slices; compare its telemetry rows against DeepSeek and gpt-4o-mini for latency,
files written, and whether client QA went green. Promote it to the default broad
coder only after it repeatedly lands multi-file changes with fewer feedback loops
than DeepSeek.

Recommended initial role: **fast senior coder / implementation-QA worker**, not
orchestrator. That gives the pipeline speed where the expensive calls happen while
keeping Fugu responsible for dependency graphs until GLM has enough plan-quality
evidence.

### NPM releases are deliberate

Accepted work and published packages are separate gates. Accepted work can collect
on the integration branch. When it is time to publish, create or update
`release/npm`, run package checks there (`npm pack`, install smoke test, metadata
and version review), ask for client approval, then publish and tag from that
release branch.

Keep development memory out of that branch. In this source repo, development-only
folders use a `dev-` prefix, such as `dev-agent-context/` and `dev-publication/`.
They are useful while building and evaluating, but should not be part of the npm
release branch unless explicitly approved as release documentation.

### What's configurable (so it ports to any repo)

Everything repo‑specific lives in one file, [`pipeline.config.json`](./pipeline.config.json):
the models and their endpoints, the **name** of each API‑key env var (never the key
itself), the paths, the QA commands, the stack facts fed to workers, the loop
guards, and the telemetry paths. The wiring code is identical in every repo — only
the config changes. Drop the folder into a new repo, run `init`, edit the config,
run `doctor`, then `run`.

### Secrets

API keys are read from `.env` at call time. They are **never** stored in config,
never printed, and never sent to the browser. The config only references keys by
their env‑var **name**.

Create provider keys from the provider dashboards, then store the values locally in
`.env` using the names from `.env.agent-pipeline.example`:

- Fugu / Sakana AI: https://platform.sakana.ai/
- DeepSeek: https://platform.deepseek.com/api_keys
- OpenAI: https://platform.openai.com/api-keys

### Telemetry (two tiers)

- **`telemetry.csv`** (automatic) — one row per model call: tokens, latency, HTTP
  status, estimated cost, files written, stamped with the engine version. Written
  by the wiring on every call.
- **`file-authorship.csv`** (automatic) — one row per worker-written file: path,
  created/updated action, subtask id, actor key, provider, model, and engine
  version. This tracks which agent produced each file without adding comments to
  product code.
- **`model-worker-performance.csv`** (curated) — the hand‑owned acceptance ledger
  with human judgment (what worked, what to adjust). The pipeline only *drafts* a
  row for you to annotate; it never overwrites your history.

Run `node tools/agent-runner/run.mjs report` after real runs to summarize calls,
tokens, latency, estimated cost, QA status, and file counts. Keep the automatic CSV
as raw evidence; use the curated CSV to record what a human learned. Redact secrets,
customer data, and raw prompts before sharing telemetry in an issue or PR.

### Contributing improvements upstream

Target repos receive a copied runner and skill, so local experiments happen in the
product repo. To contribute back, port the validated change to a checkout or fork of
`https://github.com/hartou/agent-pipeline` and open a PR there. Keep contributions
focused on portable pipeline files such as `run.mjs`, `templates/`,
`.github/skills/agent-orchestrator-installer/`, docs, and config schema changes.

Include the package `engine_version`, sanitized telemetry summary, and validation
commands in the PR. Do not include `.env`, API keys, private product code, or raw
customer data.

---

## Part 2 — FAQ

**Q: Is the "agent mode" the thing I pick in the Copilot chat dropdown?**
Yes. The `orchestrator` entry in that menu (next to the built‑in Agent / Ask / Plan)
is a custom agent defined in [`.github/agents/orchestrator.agent.md`](../../.github/agents/orchestrator.agent.md).
VS Code picks it up automatically. Selecting it makes Copilot behave as the Client.

**Q: Which model is the Client?**
Whatever model Copilot is running (Opus 4.8, GPT‑5.5, …). The Client role is
model‑agnostic — the behavior comes from the agent‑mode instructions, not the model.

**Q: What is the "engine," and where did it come from?**
"Engine" is just a name for the wiring — the [`run.mjs`](./run.mjs) command‑line
program. It was in the project from the start; it makes the API calls to Fugu and
the workers. It is **not** a fourth actor and it makes no decisions. (We now prefer
to call it the *wiring* or *transport* to avoid confusion.)

**Q: Doesn't Fugu delegate to the workers directly?**
No. Fugu is a language model behind an API — it outputs a plan as text. It cannot
call DeepSeek or gpt‑4o‑mini itself. The wiring reads Fugu's plan and makes those
calls. That's the only reason the wiring exists.

**Q: Do workers write to a sandbox first?**
No. Workers write directly into the real repo. You test the real result. Nothing is
staged and moved later.

**Q: Do I talk to the workers?**
No. As the Client you talk only to the Orchestrator (Fugu). Direction and fixes flow
through Fugu, exactly like a client talking only to the chief engineer.

**Q: Does the Client change my request before sending it?**
Yes. The Client optimizes every request into a crisp brief — goal, scope /
out‑of‑scope, constraints, acceptance criteria (mapped to the real QA commands), and
the likely files — before it reaches Fugu. Real ambiguity is raised as a question
first; the raw prompt is never forwarded blindly.

**Q: Where do the API keys live? Are they safe to commit?**
Keys live only in `.env`. The config stores just the **name** of each key's env var,
so `pipeline.config.json` is safe to commit. Keys are never printed or bundled.

**Q: Where do I create the keys?**
Use the provider dashboards: Fugu / Sakana AI at https://platform.sakana.ai/,
DeepSeek at https://platform.deepseek.com/api_keys, and OpenAI at
https://platform.openai.com/api-keys. Store the resulting values only in `.env`.

**Q: How do I use this in another repo?**
Copy the `tools/agent-runner/` folder in, run `init` (scaffolds the config and the
agent mode; never overwrites without `--force`), edit `pipeline.config.json` for
that repo, add the keys to `.env`, run `doctor` until green, then `run`.

**Q: What happened with the "verification task" problem?**
The wiring used to assume every sub‑task writes code, so a verification‑only plan
crashed it. It was fixed: Fugu now tags sub‑tasks `build` vs `verify`, and the wiring
follows the tag instead of imposing its own rule. It also no longer crashes when a
worker returns no files — it reports back to Fugu and keeps the loop alive.

**Q: Can workers run in parallel?**
Yes. Fugu declares a `dependsOn` graph in the plan; the wiring runs all independent
sub‑tasks at once, up to `loop.concurrency`. With `container.enabled`, each build
sub‑task runs in its own ephemeral Docker container. Two sub‑tasks that touch the
same file are never run concurrently (Fugu sequences them; the wiring also guards).

**Q: Is Fugu the coordinator, or the wiring?**
Fugu. Coordination (order, dependencies, what's parallel) is an orchestration
decision, so Fugu makes it in the plan (`dependsOn`). Fugu is a remote API and can't
launch containers itself, so the wiring is its hands — it faithfully executes the
graph. It does not decide the batching.

**Q: How do I see performance / cost?**
Every call is logged to `telemetry.csv` automatically. Run `report` for a per‑worker
summary (calls, tokens, average latency, estimated cost) and a draft row for the
curated ledger.

**Q: Can an installed repo contribute improvements back?**
Yes, but not as a direct PR from the target repo's normal branch. The runner is
vendored into that repo, so port the validated change to a clone or fork of
`hartou/agent-pipeline`, then open the PR there. Include sanitized telemetry and
validation output so the upstream project can judge whether the change generalizes.

**Q: Will it run forever or rack up cost?**
No. The loop is bounded by `maxRounds` in the config, and cost is tracked per call
(and can be summarized with `report`).

**Q: Why DeepSeek‑4‑pro specifically, not `deepseek-chat`?**
The DeepSeek worker must use the `deepseek-v4-pro` model; `deepseek-chat` is a
different, weaker model and is explicitly disallowed in the stack rules.

**Q: Does anything get merged automatically?**
No. The Client stays the approver. Workers write code and QA runs, but you review and
approve; nothing is merged (and no PR is opened) without your say‑so.
