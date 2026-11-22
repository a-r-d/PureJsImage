# Rate-model scratch reduction, 2026-11-18

The branch is not ready to merge. This round finds a useful exact-output
allocation reduction: reuse clustering centroids and omit unused ANS payload
tables from temporary cost models. The combination without DC caching passes
the measured process-memory guard. Ordinary encoding requests less scratch,
with essentially neutral elapsed time. The historical quality failures remain.

Research base is `5ea42e9f` on `jxl-libjxl-ports`. Three declared trials are
complete. The two combinations retaining the DC cache fail protected memory;
that cache stays archived. The surviving changes are first-party TypeScript in
the existing writer modules, with no new quality configuration, peer decisions,
runtime dependency or holdout access. All 576 development streams and nine browser fixtures pass. Fresh full repository verification passes.

## Work removed

Allocation tracing of the actual nine-estimate batch attributes 70.9 MB on the
photo and 65.4 MB on the texture to repeatedly allocating clustering centroids.
Reuse keeps the same owned arrays within one clustering invocation, clears the
occupied prefix, and preserves accumulation order, assignment ties and stopping
conditions. It adds no retained state across models.

Cost-only order, hybrid-configuration and refined-header models need serialized
header bits and normalized frequencies. They do not use ANS payload lookup
tables. The new internal option skips only those tables. Actual payload writers
keep the complete model, including recursively encoded context-map payloads.
The packed-payload writer rejects a cost-only model before allocating its scratch.

Twelve focused shapes cover single, sparse and broad histograms with one,
seventeen, 257 and 5,000 contexts. Header bits, bytes and normalized frequencies
match exactly, incomplete models reject payloads, and owned storage is released.
The focused codec, ownership, progressive and budget tests pass: 155 tests in
seven files. A shared fixture also checks browser behavior.

## Measured trials

Each seven-pair batch comparison times a complete instrumented encode: control
plus eight deterministic AC perturbation estimates, then one unchanged final
stream. It includes scratch preparation, all model rebuilding and cleanup.
The batch does not select a new encoded quality policy.

| Trial | Incremental photo ratio / MAD / wins | Texture ratio / MAD / wins | Verdict |
| --- | --- | --- | --- |
| LL-1192, centroid reuse plus DC cache | 0.958277 / 0.037781 / 6 of 7 | 0.926637 / 0.038122 / 5 of 7 | Reject combination: texture warm RSS 1.112028x uncached |
| LL-1193, also omit unused payload tables | 0.948680 / 0.038710 / 6 of 7 | 0.985094 / 0.077414 / 5 of 7 | Reject combination: photo warm RSS 1.068805x uncached |
| LL-1194, both reductions without DC cache | 0.907391 / 0.016863 / 7 of 7 | 0.949658 / 0.019569 / 6 of 7 | Retain after full source qualification |

The final row compares against uncached control; the first two are incremental
against the preceding cached implementation. Their memory rejection uses the
cumulative comparison against uncached control, not their incremental ratios.
All estimates, final streams and managed peaks in these paired runs match.

Twenty-one pairs of ordinary encodes, with no rate probes or DC cache, give:

| Development crop | Paired ratio | Ratio MAD | Faster pairs | Control median ms | Candidate median ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-3012 | 0.991957 | 0.028124 | 11 of 21 | 860.117 | 819.544 |
| im26-3312 | 0.993098 | 0.019070 | 14 of 21 | 836.286 | 827.687 |

Use the paired ratios, not a ratio of the separate elapsed medians. This does
not establish a material ordinary-encoder speed win. Retention is justified by
deterministic scratch reduction with no measured runtime or protected-memory
regression. The nine-probe gain cannot be reported as ordinary encoder speed.

Tracing the ordinary final-writing phase, after transform selection, measures:

| Crop | Requested bytes before / after | Allocation calls before / after | Complete managed peak |
| --- | --- | --- | ---: |
| im26-3012 | 29,912,060 / 20,849,660 | 18,433 / 11,722 | 5,682,267 |
| im26-3312 | 28,385,655 / 19,929,463 | 15,647 / 11,008 | 5,678,171 |

These are cumulative allocation requests, not simultaneous live memory or RSS
savings. Stack capture invalidates timing, collection and process-peak readings
from the tracing run. It does not prove the cause of earlier RSS increases.

## Protected memory

Every sample uses a fresh process, identical imports and executed writer graph,
and the same warmups. Absolute Linux VmHWM includes imports, input and warmups;
no post-warm baseline is subtracted. Managed peak and released buffers are
recorded separately. The unchanged regression limit is 1.05x.

| Workload | Photo cold / warm RSS ratio | Texture cold / warm RSS ratio |
| --- | --- | --- |
| Ordinary encoder | 1.022161 / 1.013611 | 0.962618 / 0.980111 |
| Nine-probe instrumented encoder | 0.994680 / 1.006991 | 0.972872 / 0.997841 |

Each cell has three samples per variant except ordinary texture cold. Its first
three gave 1.052485x with a wide spread. One predeclared confirmation increased
that cell to twelve per variant, keeping all initial samples. The final median
uses the mean of the two middle values. Both initial and final results remain
in the evidence; no sample was discarded and no threshold changed.

On the fixed sixteen-photo development screen at distance 2, 288 rate-estimate
comparisons and all 48 streams match saved controls. No batch retains temporary
ownership. The retained source preserves all 576 complete development streams and sizes. Managed peaks decrease on 158 points and stay equal on 418; none increase. The largest decrease is 2,529 bytes, and the maximum is 9,233,504 bytes versus 9,235,833 before. All nine fixtures pass across Chromium, Firefox and WebKit; the browser build and strict private TypeScript also pass.

## Quality and merge status

Prior native-scored regularized-half full-development BD-rates are unchanged:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -8.205% | -5.199% | -5.631% |
| jSquash | -8.726% | -0.012% | +2.408% |

Existing partial-band omissions remain. These figures are not a new holdout
result. The two historical holdout SSIM failures remain unresolved. The separate
rejected predictor-DC result must not be substituted for a fresh result of the
current regularized mode. Holdout stays closed.

Absolute peer/original speed still needs qualification, as do complete quality
promotion and public forcing-hook isolation. The managed original ceiling stays
137,514,476 bytes. Bundles are 615,136 and 687,968 bytes, up 167 each. The core check ceiling is 616,000 under the existing owner bundle amendment; the specialized ceiling remains 690,000. Main, package version and release state are unchanged.

Next three questions: reuse exact AC statistics across local proposals while
still rebuilding affected models; reduce the proposal set before expensive
perceptual checks; then test useful coupled changes under displayed-error
protection. A faster estimator alone does not justify a quality promotion.

## Reproduction and verification

[Structured evidence](RATE-SCRATCH-REPORT.json) preserves raw paired samples,
allocation traces, all memory receipts, failed setup attempts and validation.
[The archive](RATE-SCRATCH-EXPERIMENT.patch) restores the small first-party
runners and generators, excluding large generated source mirrors.

Use a disposable checkout of `5ea42e9f` and the frozen development corpus.
Restore the preceding rate-state and rate-ownership archives and run their
prototype generators first. Then run this archive's `make-prototype.ts`,
`make-metadata.ts` and `make-lean.ts` in order. They mirror the recorded source;
running them against the already changed writer is not a baseline reproduction.
Use fresh output paths. Timing, memory probes, profiling, scoring and full
repository tests must not overlap.

The source qualification uses the retained patch, requires exact complete bytes
and sizes, and rejects any managed-memory increase. Its old equality-only
assertion first rejected two decreased peaks; that failed receipt remains.
A nullable-type check was corrected before the next valid run. Neither setup
fix changes encoder code or accepts a quality or memory regression.

The first full check stops at stale generated README/documentation data after
the size update. Its failed receipt is retained. Regenerate those surfaces with
`npm run documentation:write` before retrying; no measured source changes.

Fresh `VITEST_MAX_WORKERS=4 npm run check` exits zero with no signal: 4,246
tests and 346 files pass; three tests and one file skip. All build, packaging,
documentation, type, browser-build, lint and formatting checks pass. Total
check time is 575.564 seconds, including 533.12 seconds in Vitest. No timing,
profile, memory probe or scoring job overlaps it.

A subsequent fixed budget comparison preserves all 24 encoded outputs on the
two development crops at distances 0.45, 1.85 and 7.5. Every tested budget
completes successfully; these cases do not establish a new minimum or exercise
limit errors. The separate focused tests cover allocation failures. Limits are ample, the prior managed peak, one byte below it and 65,536
bytes below it. No threshold changes. All thirty-eight archived files restore
exactly, and all thirteen regenerated modules match the measured versions at
the recorded base. Retain the two small source reductions as one combination;
reject the two DC-cache combinations. No quality policy is promoted.
