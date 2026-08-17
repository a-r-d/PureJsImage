---
name: benchmark-hillclimb
description: Run an evidence-driven optimization campaign on one PureJsImage target family or workload. Use for profiling real hotspots, testing several focused TypeScript hypotheses, retaining repeatable small gains against an explicit Git base revision, and stopping only after a material cumulative win or after re-profiling exhausts credible opportunities.
---

# Benchmark Hillclimb

Run an evidence-driven optimization campaign on one target family or workload.

A hillclimb request is a campaign, not a request to try one edit and hand off.
Profile the target, test several ranked hypotheses, retain credible small wins,
and measure their cumulative effect against the original base.

Reuse the existing benchmark harnesses through `npm run bench:hillclimb`. Never
weaken correctness, alter the measurement contract, or optimize the benchmark
instead of the implementation.

## Interpret the target

User intent outranks automatic target selection.

1. Read `AGENTS.md`, `benchmark/README.md`, and the relevant harness and workload definitions.
2. Read `benchmark/optimization-log.md` before selecting a hypothesis. Reuse its
   stable attempt IDs. Do not repeat a rejected or already-reverted idea unless
   new profiling evidence changes the case. A prior promising result that was
   reverted is unfinished evidence, not a dead end.
3. Check recent commits. Do not re-optimize a recently changed path unless fresh
   measurements still identify it as a bottleneck.

Then apply these selection rules:

- An exact workload selects that workload.
- A named codec, reader, format, transform, or subsystem constrains selection to
  that family even when phrased softly. "Maybe WebP" means choose an appropriate
  WebP workload unless profiling proves that family is already trivial.
- Only search globally when the user provides no target area.
- Within the selected family, prefer a meaningful medium or large end-to-end
  workload with significant absolute runtime or memory pressure.
- Never optimize a correctness-only microfixture.

The runner has no family filter. If the user named a family, pass an explicit
`--workload` from that family. Omitting `--workload` surveys the entire suite and
will ignore a soft family hint.

State:

1. the target family and workload;
2. the optimization goal (`speed` or `memory`);
3. the initial profiling evidence;
4. a ranked list of plausible hotspots or hypotheses.

Run one of:

```sh
npm run bench:hillclimb -- --suite web --workload northstar-photo-pipeline --goal memory --base-ref origin/main
npm run bench:hillclimb -- --suite web --workload jpeg-resize-1200 --goal speed --base-ref origin/main
npm run bench:hillclimb -- --suite scientific --workload scaling-tiff-large-warm-regions --goal speed --base-ref origin/main
```

The runner creates a temporary base worktree, builds both revisions with the same
Node runtime, measures PureJsImage only, uses seven trials by default, alternates
base-first and candidate-first pairs, and writes raw JSON plus concise JSON and
Markdown under `.tmp/hillclimb/`. It compares the dirty working tree against
`--base-ref`. It never commits results or updates public documentation.

For a small-gain confirmation, raise the sample count with `--trials 15` or
`--trials 21`. Do not change `--material-speed-percent` or
`--material-memory-percent` to manufacture an `accepted` verdict.

## Campaign model

Maintain three conceptual states:

1. original base revision;
2. retained optimization stack;
3. current experiment.

Test one hypothesis at a time, but allow several independently credible changes
to accumulate in the retained stack.

Do not commit, push, stash, amend, or alter branch history unless the user
explicitly requests it. Keep retained source changes visible in `git diff`.
Store benchmark artifacts, profiles, and temporary retained patches under
`.tmp/hillclimb/`.

The runner compares the working tree to `--base-ref`, so an uncommitted retained
stack is already the cumulative comparison against the original base. To judge
an incremental experiment, keep the previous retained-stack artifact and compare
the new paired evidence against it. Do not commit the stack just to create a new
baseline.

A reasonable default campaign is 6 to 12 cheap experiments, not three.

## Record every attempt

`benchmark/optimization-log.md` is the durable, checked-in campaign memory. Raw
seven-pair measurements remain under `.tmp/hillclimb/`.

After every comparison, including controls, misses, and confirmation reruns,
append an attempt before starting the next experiment. Include:

- stable ID, continuing the family series already in the log;
- timestamp;
- workload and goal;
- hypothesis and profiling evidence;
- source paths;
- base and candidate revisions;
- artifact path;
- medians, MAD, and paired delta;
- pair win rate when evaluating a sub-threshold gain;
- correctness and protected-metric result;
- campaign verdict;
- whether the patch was retained or reverted.

Use the campaign verdict in the log, not a raw copy of the runner label:

| Campaign verdict | Runner may print | Meaning |
| --- | --- | --- |
| `rejected` | `rejected` | Incorrect, protected regression, or credible performance regression |
| `inconclusive` | `incomparable` | Too noisy, setup mismatch, or insufficient samples |
| `neutral` | `neutral` | No credible positive effect |
| `promising` | `neutral` | Repeatable sub-material gain; retain conditionally |
| `material` | `accepted` | Cumulative target reached |

Do not copy runner `neutral` into the log when the paired evidence is promising.
Update the log's current-state section whenever the retained stack changes. Log
controls as well as wins.

## Experiment loop

1. Profile before editing. Rank several actual hotspots rather than guessing.
   Choose evidence that can confirm or refute the next hypothesis: Node CPU
   profiles, heap profiles, allocation evidence, GC traces, source-read
   accounting, external and ArrayBuffer memory, or emitted-block sizes.
2. Make one narrow pure TypeScript change.
3. Run focused correctness tests.
4. Compare the experiment against the retained stack with
   `npm run bench:hillclimb`.
5. Classify the result with the campaign verdicts above.
6. Revert rejected and neutral experiments.
7. Rerun inconclusive experiments with better isolation or more samples.
8. Keep promising low-risk experiments in the retained stack.
9. Periodically compare the full retained stack against the original base.
10. After three consecutive misses, re-profile and select a different hotspot.
    Do not stop merely because three hypotheses failed.

Continue until one of these conditions is met:

- the retained stack reaches the cumulative material target;
- two rounds of profiling reveal no remaining credible hotspot;
- further changes require an unjustified architectural escalation;
- a user-specified experiment budget is exhausted.

Investigate small credible wins before discarding them. Do not keep every
negative percentage. If a promising change later looks weaker in a cumulative
comparison, re-profile and re-measure it against the current retained stack
instead of treating the first number as conclusive.

## Measurement policy

The default final material targets are:

- speed: at least 3% improvement;
- peak RSS: at least 5% improvement.

These are campaign and handoff thresholds, not per-edit deletion thresholds.
3% is the threshold for declaring victory, not the threshold for learning
anything from an experiment.

A sub-threshold speed result may be retained as promising when:

- correctness and protected metrics match;
- the code change is narrow and maintainable;
- the initial result is at least plausibly larger than measurement noise,
  roughly 0.5% to 3%;
- an escalated run of at least 15 paired trials has a positive paired median;
- a clear majority of trial pairs favor the candidate.

Report pair win rate when evaluating small gains. Judge the gain against
complexity: a simple 0.8% hot-loop improvement can be worthwhile; a sprawling
0.8% rewrite probably is not.

A deterministic reduction in source reads, unique bytes, copies, scratch
allocation, output allocation, or maximum emitted block size may be retained
without a 5% RSS change when it does not regress representative runtime or
correctness. RSS is coarse and GC-sensitive. Do not throw away an exact
source-sized allocation reduction merely because process RSS barely moves.

Do not combine unrelated metrics into one weighted score.

The runner currently prints only `accepted`, `incomparable`, `neutral`, or
`rejected`, and it uses the material threshold to choose between `accepted` and
`neutral`. Read the paired medians, MAD, IQR, CV, and per-pair deltas yourself.
A correct 2% improvement is not the same as a 0.02% result.

## Protect benchmark integrity

Treat these rules as non-negotiable:

- Preserve fixture dimensions and bytes, selection geometry, quality settings,
  warmup placement, timed boundaries, cache state, output hashes, and
  validation tolerances.
- Do not move work outside the timed operation without explicitly changing and
  documenting the benchmark contract.
- Require every measured run to report the same supported status. Reject errors,
  invalid output, newly unsupported behavior, and mixed supported or unsupported
  results.
- Require exact correctness hashes, output shape and type, operation semantics,
  matching environment fingerprints, and matching path-independent fixture
  fingerprints.
- Reject increases in source reads, requested bytes, returned bytes, unique
  bytes, overfetch, output bytes, or maximum emitted block size unless the user
  explicitly approves that metric.
- Compare raw samples. Report median, MAD, IQR, coefficient of variation, and
  paired percentage deltas.
- Treat high noise or identity mismatch as inconclusive, never as a win.
- Reject either speed or RSS regression above 5%.
- Keep correctness and representative performance separate. Baseline
  microfixtures may support documentation counts but never performance
  headlines.

Interpret runner exit codes as:

- `0`: material improvement or no protected/performance regression. Inspect the
  paired evidence before deciding promising versus neutral.
- `1`: correctness, protected-metric, speed, or memory regression. Revert.
- `2`: noisy, incomparable, or invalid setup. Rerun or redesign measurement.

## Validation cadence

During the inner loop:

- run only focused tests and the selected PureJsImage workload;
- do not run competitors;
- do not refresh public benchmark snapshots, package metrics, or generated docs;
- do not run the complete repository suite after every hypothesis.

After retaining several changes, run a neighboring representative workload in
the same family.

At final handoff:

1. Compare the cumulative retained stack against the original base.
2. Run neighboring representative workloads.
3. Run the codec or reader's relevant compatibility corpus. For Imazen-covered
   web codecs that is `npm run corpus:imazen` with the matching `--format`.
4. Run `npm run browser:check` for public API, codec, transform, source, sink,
   packaging, or browser-runtime changes, with focused real-browser coverage
   when behavior changed.
5. Run `npm run check`.
6. Refresh generated metrics and documentation once, if required.
7. Leave source changes uncommitted unless the user requested a commit.

Review the diff for hidden copies, source-sized buffers, cache-semantic changes,
weakened bounds, benchmark manipulation, Node/browser divergence, dependency
growth, and tree-shaking regressions.

## Technology order

Prefer pure TypeScript first:

1. eliminate work;
2. improve algorithms;
3. remove allocations and copies;
4. bound buffers;
5. coalesce I/O;
6. improve typed-array and cache behavior;
7. simplify hot-loop dispatch.

Stay in TypeScript unless profiling shows a dense, stable compute kernel
dominates representative end-to-end time and initialization and copy costs can
be amortized.

Before Rust/WASM work, read `.agents/skills/rust-wasm/SKILL.md`. Preserve
explicit opt-in registration, exact parity, bounded memory, package and
cold-start evidence, and the production TypeScript fallback.

Consider WebGPU only when browser profiling proves that a large parallel numeric
operation amortizes pipeline creation, upload, dispatch, and readback. Require
feature detection, a TypeScript fallback, browser correctness tests, and
end-to-end evidence. Do not use WebGPU for metadata parsing, range I/O, small
inputs, or branch-heavy entropy decoding.

Do not build WASM or WebGPU merely because this skill describes their evidence
gates.

## Handoff

Report:

- target and selection rationale;
- ranked profiling hotspots;
- retained and rejected experiments, with optimization-log IDs;
- incremental results versus the retained stack;
- cumulative results versus the original base;
- paired medians, pair win rates, noise, and confirmation evidence;
- correctness, I/O, memory, neighboring-workload, and corpus validation;
- exact reproduction commands.

Do not hand off merely because one experiment passed or three experiments
failed.
