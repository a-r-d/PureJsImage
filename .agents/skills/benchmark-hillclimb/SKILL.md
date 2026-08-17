---
name: benchmark-hillclimb
description: Optimize one PureJsImage web-codec or scientific-reader workload safely against an explicit Git base revision. Use for profiling a bottleneck, testing a narrow TypeScript performance or memory hypothesis, comparing base and candidate measurements, or deciding whether an optimization is correct, material, and low-noise.
---

# Benchmark Hillclimb

Optimize one representative workload and one goal at a time. Reuse the existing benchmark harnesses through `npm run bench:hillclimb`; do not create a parallel benchmark framework or change the measurement contract to obtain a win.

## Establish the target

1. Read `AGENTS.md`, `benchmark/README.md`, and the relevant harness and workload definitions.
2. Read the checked-in attempt history in `benchmark/optimization-log.md` before selecting a hypothesis. Reuse its stable attempt IDs and do not repeat a rejected idea unless new profiling evidence changes the case.
3. Check recent commits before selecting a path. Do not re-optimize a recently changed path unless fresh measurements still identify it as a bottleneck.
4. State one workload, one goal (`speed` or `memory`), and one explicit hypothesis.
5. Prefer a fresh result from the current commit and machine. If none exists, let the runner perform its one-sample representative survey. Never select a correctness-only microfixture.
6. For speed, select the largest absolute end-to-end runtime on a meaningful medium or large workload. For memory, select the clearest source-sized allocation, peak-RSS pressure, or external, ArrayBuffer, or block growth. Treat requests and unique bytes as important evidence for range workloads.

Run one of:

```sh
npm run bench:hillclimb -- --suite web --workload northstar-photo-pipeline --goal memory --base-ref origin/main
npm run bench:hillclimb -- --suite scientific --workload scaling-tiff-large-warm-regions --goal speed --base-ref origin/main
npm run bench:hillclimb -- --suite scientific --goal memory --base-ref origin/main
```

The runner creates a temporary base worktree, builds both revisions with the same Node runtime, measures PureJsImage only, uses seven trials by default, alternates base-first and candidate-first pairs, and writes raw JSON plus concise JSON and Markdown under `.tmp/hillclimb/`. It never commits results or updates public documentation.

## Protect benchmark integrity

Treat these rules as non-negotiable:

- Preserve fixture dimensions and bytes, selection geometry, quality settings, warmup placement, timed boundaries, cache state, output hashes, and validation tolerances.
- Do not move work outside the timed operation without explicitly changing and documenting the benchmark contract.
- Require every measured run to report the same supported status. Reject errors, invalid output, newly unsupported behavior, and mixed supported or unsupported results.
- Require exact correctness hashes, output shape and type, operation semantics, matching environment fingerprints, and matching path-independent fixture fingerprints.
- Reject increases in source reads, requested bytes, returned bytes, unique bytes, overfetch, output bytes, or maximum emitted block size unless the user explicitly approves that metric.
- Compare raw samples. Report median, MAD, IQR, coefficient of variation, and paired percentage deltas.
- Treat high noise or identity mismatch as incomparable, never as a win.
- Require at least 3% material speed improvement or 5% material peak-RSS improvement by default. Reject either speed or RSS regression above 5%.
- Keep correctness and representative performance separate. Baseline microfixtures may support documentation counts but never performance headlines.
- Do not combine speed and memory into a weighted score.

Interpret exit codes as:

- `0`: accepted material improvement or neutral verification.
- `1`: correctness, protected-metric, speed, or memory regression.
- `2`: noisy, incomparable, or invalid setup.

## Profile before editing

Choose evidence that can confirm or refute the hypothesis: Node CPU profiles, heap profiles, allocation evidence, GC traces, source-read accounting, external and ArrayBuffer memory, or emitted-block sizes. Keep profiles and experiments under `.tmp/`.

Prefer pure TypeScript changes in this order:

1. Do less work or use a better algorithm.
2. Remove allocations, copies, or full-frame materialization.
3. Bound buffers and batch or coalesce requests.
4. Use contiguous typed-array operations and cache-friendly layouts.
5. Remove polymorphic calls, callbacks, or closures from hot loops.

Make one narrow change, rerun the base-versus-candidate comparison, and revert the experiment when it is incorrect, noisy, incomparable, or regresses a protected metric. Stop after three failed hypotheses unless the user explicitly requests a longer campaign.

After every comparison, append the attempt to `benchmark/optimization-log.md`,
including the stable ID, timestamp, workload and goal, hypothesis, profiling
evidence, source paths, base/candidate revisions, artifact path, medians, MAD
or paired delta when useful, correctness/protected-metric result, verdict, and
whether the patch was retained or reverted. Log controls and neutral results as
well as accepted wins.

## Validate a win

After a material win:

1. Run focused correctness tests and neighboring representative workloads.
2. Run competitors only after the PureJsImage improvement survives those checks.
3. Review the diff for hidden copies, source-sized buffers, cache-semantic changes, weakened bounds, benchmark manipulation, Node/browser divergence, dependency growth, and tree-shaking regressions.
4. Run `npm run browser:check` for public API, codec, transform, source, sink, packaging, or browser-runtime changes, with focused real-browser coverage when behavior changed.
5. Run `npm run check` before handoff.

## Gate future accelerators

Stay in TypeScript unless profiling shows a dense, stable compute kernel dominates representative end-to-end time and initialization and copy costs can be amortized.

Before Rust/WASM work, read `.agents/skills/rust-wasm/SKILL.md`. Preserve explicit opt-in registration, exact parity, bounded memory, package and cold-start evidence, and the production TypeScript fallback.

Consider WebGPU only when browser profiling proves that a large parallel numeric operation amortizes pipeline creation, upload, dispatch, and readback. Require feature detection, a TypeScript fallback, browser correctness tests, and end-to-end evidence. Do not use WebGPU for metadata parsing, range I/O, small inputs, or branch-heavy entropy decoding.

Do not build WASM or WebGPU merely because this skill describes their evidence gates.

## Hand off

Report the selected workload and why, the hypothesis and profiling evidence, base and candidate medians, MAD, paired deltas and noise, correctness and protected-metric results, accepted and rejected experiments, neighboring validation, and the exact reproduction command.
