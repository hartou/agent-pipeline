# Draft LinkedIn Article: What a Multi-Agent Coding Benchmark Taught Us About Model Speed

## Working Title

What a Multi-Agent Coding Benchmark Taught Us About Model Speed

## Subtitle

Official model benchmarks are useful, but agent pipelines need a different kind of telemetry: end-to-end latency, output verbosity, orchestration shape, and per-file authorship.

## Draft

I have been building and testing a multi-agent software delivery pipeline.

The shape is intentionally simple: a client agent handles the request and QA, an orchestrator decomposes the work, and worker agents implement bounded slices in isolated containers or worktrees. The point is not to make one model do everything. The point is to create a blend: one model can coordinate, another can write broad implementation, another can do small local edits or reviews, and another can become a specialist if the evidence supports it.

Recently I added a new model candidate to that blend: GLM-5.2.

The reason was straightforward. On Artificial Analysis, GLM-5.2 is listed as one of the fastest models in its class. The page reports roughly 206.8 output tokens per second and a time to first answer token around 1.42 seconds, while also ranking it very highly on intelligence. On paper, that looks like a strong candidate for either a senior coding worker or an implementation QA worker.

So we tested it inside the actual pipeline instead of relying only on the public benchmark.

The test was deliberately small. We created a throwaway static browser game repo: a Flappy-Bird-style HTML/CSS/JavaScript game. The task was useful because it could be split cleanly into file-disjoint work:

- `index.html` for the shell
- `styles.css` for visual polish and responsiveness
- `game.js` for the game loop, physics, obstacles, collision, scoring, and restart behavior

That gave the orchestrator a chance to produce a truly parallel plan. It also gave us an easy QA check: a small script verified that the generated game linked the right files, used SVG or canvas, handled input, had an animation loop, implemented obstacles, updated score, and included responsive styling.

The first thing we learned had nothing to do with GLM.

I had been worried that the pipeline was only running one container at a time. In this test, it was not. The runner printed:

```text
executing 3 build sub-task(s) at concurrency 3 (containers);
initially-ready=3, dependency-edges=0, file-overlap-pairs=0
[graph] starting 3/3: html-shell, css-polish, game-logic
```

That means the container scheduler was doing what it should. When we only see one container in other runs, the cause is usually upstream: the orchestrator planned serial dependencies, tasks overlap on the same files, or a repair loop only has one remaining build task.

That is an important distinction. Parallel infrastructure does not create parallel work by itself. The plan graph has to expose independent work.

Then we looked at model behavior.

In the successful full run, gpt-4o-mini handled the HTML and CSS slices, while GLM-5.2 handled the core `game.js` slice. The pipeline went green on the first round.

The telemetry looked like this:

```text
orchestrator/fugu: 1 call, 2004 tokens, 23275 ms
gpt-4o-mini:      2 calls, 1541 tokens, avg 6620 ms, 2 files
glm-5.2:          1 call, 15076 tokens, 189976 ms, 1 file
QA:               green on round 1
```

GLM produced working code. But it also produced a very large completion: 14,569 output tokens for one file. The end-to-end call took about 190 seconds.

That seemed surprising compared with the public speed benchmark.

So we compared the benchmark definition with what our pipeline was measuring.

Artificial Analysis reports output speed: tokens per second after generation starts, often measured with streaming. Our pipeline was measuring blocking end-to-end API latency: the time from sending the request until the full response body arrived. That includes provider queueing, time to first token, possible reasoning or thinking time, network time, and the full generation.

Those are not the same metric.

When we computed output throughput from our own telemetry, GLM was around 76.7 output tokens per second on this run. That is below the public headline number, but still not slow in pure generation terms. The bigger issue was verbosity. A model can generate quickly per token and still be slow for an agent task if it chooses to emit too many tokens.

We also ran a focused comparison against DeepSeek on the same core slice. We kept the generated HTML and CSS shell, removed `game.js`, and assigned only `game.js` to DeepSeek. The same QA checker passed.

The controlled DeepSeek result was:

```text
deepseek-v4-pro: 1 call, 5618 tokens, 1025 ms, 1 file
QA:              green
```

That makes DeepSeek look dramatically faster on this tiny benchmark. But that number is also suspiciously fast: 5,193 reported completion tokens in about one second implies a token rate that is not realistic for a normal end-to-end generation. So the lesson is not simply "DeepSeek is faster than GLM" or "GLM is slow." The lesson is that provider telemetry and wall-clock timing need to be measured more carefully before we promote a model into a role.

The experiment also changed what we want the pipeline to measure. Parallelism diagnostics and per-file authorship are useful internally, but the bigger lesson was simpler: model evaluation needs streaming-aware telemetry. For a fair comparison, the runner should capture:

- time to first token
- generation duration
- output tokens per second
- end-to-end latency
- prompt tokens and completion tokens
- files written
- QA outcome
- loop count
- per-file authorship

Without those fields, public benchmarks and local agent runs talk past each other.

The current takeaway for our agent blend is this:

- GLM-5.2 remains interesting as a senior coding or implementation-QA candidate because it produced working code and has strong public intelligence/speed signals.
- DeepSeek looked much more efficient on this specific `game.js` task, but the telemetry needs repeated runs and better streaming measurements before we treat the result as definitive.
- gpt-4o-mini continues to look useful for smaller scoped HTML/CSS/local edits.
- Fugu remains responsible for planning, but the orchestrator prompt has to keep pushing for file-disjoint parallel work when the task allows it.

The broader lesson is that model benchmarks are necessary but not sufficient for multi-agent software work.

Official benchmarks tell us something important about model capability and raw serving performance. But once a model becomes part of an agent pipeline, the useful question changes:

Can this model produce the right artifact, in the right file, with the right amount of output, inside the right orchestration graph, with QA passing, at a cost and latency that improves the whole system?

That is the benchmark I care about now.

Not just model speed.

Pipeline speed.

## Evidence To Keep With The Draft

Benchmark repo:

```text
~/dev/flap-bird-pipeline-benchmark
```

Source branch:

```text
pipeline-glm-eval-and-parallel-diagnostics
```

Source commits:

```text
efc479a Add GLM worker and parallel diagnostics
3326df2 Track worker file authorship
```

Benchmark commits:

```text
53f8295 Generate benchmark flap bird game
95aca25 Evaluate DeepSeek game logic worker
```

Key caveats:

- Artificial Analysis reports streaming-oriented output speed; the pipeline measured blocking end-to-end API time.
- The public page is for GLM-5.2 (max); the configured API model was `glm-5.2`, which may or may not map to the exact same served variant.
- GLM was verbose in this task, producing 14,569 completion tokens for one file.
- DeepSeek's reported latency/token combination looked unrealistically fast, so repeated measurements and streaming telemetry are needed.