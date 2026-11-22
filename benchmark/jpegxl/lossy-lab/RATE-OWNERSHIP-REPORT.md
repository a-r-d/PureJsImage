# Owned rate-state qualification, 2026-11-18

The branch is not ready to merge. The checked DC cache now uses the encoder's
memory ledger, bounds proposal scratch to one AC group, and releases or reclaims
its state correctly. It still increases warm-process peak memory. Keep this
prototype archived. No new quality policy or production change is retained.

This finishes ownership qualification of LL-1184 from research checkpoint
`699557fe`. A batch contains control plus eight deterministic AC perturbations,
followed by one unchanged final stream. All preparation, comparisons, estimates
and cleanup are inside the complete instrumented encode. Its speed ratio does
not describe the ordinary encoder without these probes.

## Correctness and ownership

Each proposal copies at most one AC group into three reusable Int16 buffers,
393,216 bytes total. Compact DC snapshots add 77,728 bytes on the photo and
68,392 on the texture. Every later estimate compares the generated DC values;
changed values invalidate the saved cost. Orders, AC models, contexts and
AC-dependent metadata are rebuilt every time.

Focused checks pass for mutation, restoration, incompatible inputs, nested
batches, callback failure and allocation failure. At a budget equal to the
uncached estimator's peak, the optional cache is reclaimed and both estimates
remain exact. Every tested batch returns to its previous live-byte count.
These estimator-budget cases use separately owned geometry inputs.

On the fixed sixteen-photo development screen at distance 2, all 288 estimate
comparisons match the unchanged estimator exactly. All 48 complete streams
match their saved controls. The uncached mirror also matches the original
estimator's managed peak on every photo.

The complete managed peaks on im26-3012 are 6,191,435 bytes uncached and
6,269,163 cached. On im26-3312 they are 6,187,339 and 6,255,731. The added
storage is fully accounted; this does not qualify full-resolution originals.

## Timing and process memory

The first seven-pair complete-encode comparison gives ratios 0.799612 and
0.814143, paired MAD 0.031998 and 0.033073, with every pair faster. Its rate
batch ratios are 0.665119 and 0.656286. All estimates and final streams match.

That comparison imports both writers, but the cached variant executes the
private writer as well as the normal final writer. The uncached variant executes
only the normal writer. A second comparison executes the same private writer
on both sides, switching cache reuse on or off. The first results remain in
the evidence; they cannot isolate reuse from duplicate writer execution.

The second seven-pair comparison gives complete-encode ratios 0.805540 and
0.791538, paired MAD 0.077945 and 0.015759, with 6/7 and 7/7 faster pairs.
Rate-batch ratios are 0.677661 and 0.667458. Separate elapsed medians are
2789.401 to 2066.227ms and 2312.243 to 1992.131ms. Photo timing is visibly
noisy. These costs remain too high for the tiny gains from prior guarded
proposals, even before a perceptual selector is added.

Each memory sample is a fresh process. Cold and warm cases use the same input,
imports, executed writer modules and warmup count. Absolute Linux VmHWM includes
warmup peaks; no post-warm baseline is subtracted. Three samples per case give:

| Crop | State | Uncached peak bytes | Cached peak bytes | Ratio |
| --- | --- | ---: | ---: | ---: |
| im26-3012 | cold | 195,858,432 | 198,504,448 | 1.013510 |
| im26-3012 | warm | 254,124,032 | 271,990,784 | 1.070307 |
| im26-3312 | cold | 187,301,888 | 195,575,808 | 1.044174 |
| im26-3312 | warm | 269,193,216 | 289,599,488 | 1.075805 |

Both warm medians exceed the unchanged 5% regression guard. Correcting writer
execution does not remove the failure. The process increase is much larger
than the owned snapshots, and these measurements do not establish its cause.
Managed cleanup alone is insufficient for adoption.

The warm samples have the same median ArrayBuffer storage before the measured
encode, 1,645,764 bytes. After collection, median JavaScript heap usage is
10.3–10.5 MB on both paths, while cached process RSS remains higher. This does
not show a large retained live-buffer increase and does not identify the peak's
cause. Reusing transient AC scratch is a better next memory question than
shrinking the already compact DC snapshot alone.

Fresh profiles of three complete cached encodes on each crop still put AC
group traversal, order sorting and histogram compaction among the main rate
costs. The memory allocator and scope handling also remain visible. These are
CPU samples, not an allocation attribution. They support examining reusable
AC statistics and clustering scratch next; they do not prove what caused the
warm RSS increase. The earlier failed stable-sort trial remains rejected.
Centroid-buffer reuse also has a prior neutral ordinary-encoder result in
LL-419/420. Any revisit needs evidence for the repeated rate-batch workload;
it should not be presented as an untested general encoder speed idea.

## Unchanged quality and next work

The existing native-scored regularized-half full-development results remain:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -8.205% | -5.199% | -5.631% |
| jSquash | -8.726% | -0.012% | +2.408% |

Existing partial-band omissions remain. The historical two holdout SSIM guard
failures are unresolved. This round does not access holdout data or introduce
an encoded quality configuration. The estimator still predicts normalized ANS
entropy, not exact serialized file size.

Prior retained selector changes remain byte-identical across all 576 development
points, with complete-encode ratios 0.959927 and 0.977781 on two crops. Absolute
peer and original speed qualification remains open. Bundles remain 614,969 and
687,801 bytes, with no runtime dependencies. Public peer forcing still needs
source separation before merging. Main and release state are unchanged.

Fresh `VITEST_MAX_WORKERS=4 npm run check` exits zero with no signal: 4,245 tests
and 345 files pass, with three tests and one file skipped. Build, browser-build,
type, lint, formatting, comparison and documentation gates pass. The complete
check takes 644.580 seconds, including 599.87 seconds in Vitest. Strict private
TypeScript and all thirteen archive restorations also pass. No benchmark,
profile or scoring overlaps the check. Its initial attempt stopped on JSON
report formatting; that failed receipt remains preserved, and formatting leaves
the measured values unchanged.

Next: locate the remaining allocation/collection cost, reuse unchanged AC
statistics while rebuilding the final model, then test a useful coupled proposal
with displayed-error protection. A faster rate helper alone does not justify
adding an expensive selector or reopening holdout qualification.

## Reproduction

[Structured evidence](RATE-OWNERSHIP-REPORT.json) preserves both comparisons,
all process receipts, ownership checks and development validation.
[The archive](RATE-OWNERSHIP-EXPERIMENT.patch) restores the first-party prototype
and runners under `.tmp/jpegxl-lossy-lab/rate-owned-20261118`. Restore the preceding
[rate-state archive](RATE-STATE-EXPERIMENT.patch) for its geometry fixture first.
Use the recorded source revision and frozen development corpus. Run timing,
memory, profiling, validation and repository checks serially.

```sh
git apply benchmark/jpegxl/lossy-lab/RATE-OWNERSHIP-EXPERIMENT.patch
node .tmp/jpegxl-lossy-lab/rate-owned-20261118/make-prototype.ts
node .tmp/jpegxl-lossy-lab/rate-owned-20261118/make-shared-probes.ts
node .tmp/jpegxl-lossy-lab/rate-owned-20261118/ownership-check.ts
node .tmp/jpegxl-lossy-lab/rate-owned-20261118/qualification.ts
```

Use fresh output paths. The qualification launcher records completion on disk;
a successfully launched process is not itself a passing result.
