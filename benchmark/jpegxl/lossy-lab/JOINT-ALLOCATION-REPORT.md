# Joint transform and precision allocation

The strongest screen improves the mean of the three BD-rates by 3.587%, mostly
through a 10.084% Butteraugli max gain. Its decision cost is too high for effort 7.
One update retains most of that quality gain but still more than doubles encode
time. All eight policies are archived. The retained encoder, main and the frozen
holdout are unchanged.

Research base: `f3169514210b9376404f0a0c44304cde84b3b3a3`,
branch `jxl-libjxl-ports`, 2026-10-28. The
[JSON report](JOINT-ALLOCATION-REPORT.json) contains all peer tables, distributions,
guard results, range omissions, rate checks and isolated timing summaries.

## Decisions and validation

Rank aligned 64-pixel tiles by the maximum of our complete dithered perceptual
map. The first trial compares control with four alternatives: 25% higher AC
precision in the highest-error tile or four tiles; DCT8 transforms throughout
the highest-error tile; and DCT8 plus 25% higher precision there. DC steps,
chroma maps and filters stay fixed. Coefficients are recomputed from source.
Each alternative receives separate DC storage to preserve the control.

Selection uses the prior lambda-1 log-rate/mean-log-error cost, a 32-bit rate
margin and a 1% predicted max/3-norm harm limit. The rate query uses the final
order, context and hybrid models. Only the selected geometry is serialized.
Native scores are obtained after that decision.

Two fixed screen cases, `im26-2004/d2` and `im26-3312/d4`, independently validate
all alternatives. Unchanged rebuilds preserve stream bytes; candidate generation
preserves control; direct reconstruction matches the finished-stream decoder.
All eight non-control rate deltas have the correct sign. The largest rate-delta
error is 20.344559 bits, within the 32-bit margin.

Across the 80 selected screen outputs, predicted/native signs agree on all 73
nonzero changes for each Butteraugli metric. At 0.1% materiality, agreement is
73/73 for max and 69/69 for 3-norm. Largest percentage-change errors are
0.022561 and 0.002166 percentage points. This validates selected outcomes and
the two candidate cohorts; there is no SSIM predictor.

## Eight direct screens

All screens use the fixed 16 development photos at distances 0.5, 1, 2, 4 and 7.
All 640 rows finish and decode natively. Each screen records 73-77 incomplete
required-range comparisons; none has a missing encode or ladder point. Large
originals are excluded under the screen contract. These are overlap-based screen
results, not full-lab or promotion evidence.

BD-rate changes below are relative to the retained control. Negative is better.

| Trial | SSIMULACRA2 | 3-norm | Max | Mean | Screen guard |
| --- | ---: | ---: | ---: | ---: | --- |
| Joint transform/precision selection | -0.028% | -0.650% | -10.084% | -3.587% | Pass |
| One libjxl-style quantization update | -0.056% | +0.228% | -2.776% | -0.868% | Fail |
| Four precision tiles, complete map | +0.443% | -0.381% | -9.844% | -3.261% | Pass |
| Four tiles, half-resolution map | +0.325% | -0.072% | -2.107% | -0.618% | Pass |
| Four tiles, quarter-resolution map | +0.171% | +0.343% | +1.038% | +0.517% | Pass |
| Two-scale quadratic map | +0.613% | -0.038% | -2.449% | -0.625% | Pass |
| Fine-only quadratic map | +0.664% | -0.018% | -2.561% | -0.638% | Pass |
| Quadratic map, 50% more precision | +1.886% | +1.043% | -0.827% | +0.701% | Fail |

The joint trial chooses four precision tiles 52 times, one precision tile ten
times, DCT8 nine times, DCT8 plus precision twice, and control seven times.
Its worst per-image deltas are +0.582785/+0.127243/-0.465289% in
SSIM/3-norm/max order. Against vips its screen means are
-10.703996/-6.404269/-14.680932%; against jSquash,
-11.550652/-0.986009/-7.977707%.

The native-derived quantization trial ports one first-iteration update from
`TileDistMap` and `FindBestQuantization`. It retains the source 16th norm,
1.2 factor, 0.2 low-error exponent and range constraints, adapted to our fixed
raw field and dithered display map. Native libjxl runs that loop above effort 7.
Three numeric fixtures pass, but the screen's worst max BD-rate regresses
7.146294%, failing the 3% development guard. The stronger quadratic policy
fails both SSIM (+4.630901%) and max (+8.150491%) guards.

Removing candidate selection preserves most of the complete map's benefit.
Downsampling or omitting directional terms loses most of it. More precision
cannot recover inaccurate tile ranking in the tested quadratic policy.

## Isolated cost

Each process performs three warmups followed by seven alternating control/trial
pairs at distance 2. All hashes equal the independently scored screen streams.
No quality runs or repository tests overlap these measurements.

| Policy | Photo | Control median | Trial median | Median paired ratio | Ratio MAD |
| --- | --- | ---: | ---: | ---: | ---: |
| Joint selection | im26-3012 | 1073.555 ms | 7629.625 ms | 7.191405 | 0.314929 |
| Complete map | im26-3012 | 1059.322 ms | 2443.395 ms | 2.313356 | 0.105711 |
| Complete map | im26-3312 | 1123.353 ms | 2522.524 ms | 2.239160 | 0.082715 |
| Half-resolution | im26-3012 | 1074.408 ms | 1728.619 ms | 1.605555 | 0.029225 |
| Half-resolution | im26-3312 | 1110.870 ms | 1729.900 ms | 1.583685 | 0.018843 |
| Fine quadratic | im26-3012 | 1105.933 ms | 2126.012 ms | 1.932527 | 0.023732 |
| Fine quadratic | im26-3312 | 1137.058 ms | 2163.996 ms | 1.903403 | 0.119889 |

All 49 measured pairs are slower. Even the smallest slowdown in each workload
fails the quality/time rule. The untimed two-scale quadratic variant provides
slightly less quality gain than fine-only quadratic while doing additional
coarse-scale work; there is no measured case for retaining it. Quarter-resolution
ranking worsens all aggregate metrics. No policy proceeds to the full lab.

The encoder ledger excludes the perceptual arrays. These crop-only prototypes
also require bounded, accounted storage before promotion; their recorded managed
peaks cannot qualify the memory gate.

## Retained state and next work

| Full development, unchanged | SSIMULACRA2 | 3-norm | Max |
| --- | ---: | ---: | ---: |
| vs wasm-vips | -8.003% | -5.030% | -5.582% |
| vs jSquash | -8.474% | +0.227% | +2.571% |

Carried qualification: crops 2.635783x jSquash; the 13 MP original is 41.894s
and 1.698729x. The 21 MP original finishes in 83.743s; jSquash aborts.
Managed peaks remain 8,760,382/59,139,199/91,010,461 bytes against the
137,514,476-byte ceiling. These are prior qualification figures, not refreshed
by this batch. Bundles remain 614,969/687,801 minified bytes, with zero runtime
dependencies and no version change.

The frozen holdout still has two failed SSIM guards, worst +11.617% against
main. Its identities remain unread. Its aggregate vips means remain
-5.996/-3.605/-2.909% (mean -4.170%); jSquash -6.492/+1.640/+2.704%.
The branch is not ready to merge.

Next: sample output locations while retaining full-resolution directional bands;
recompute only changed transforms; then test bounded, bitrate-neutral precision
redistribution with native SSIM checks. The available max-error gain is now
measured. It does not justify the present decision cost or resolve the SSIM guards.

## Reproduction

`JOINT-ALLOCATION-EXPERIMENT.patch` restores all eight development modes and the
three quantization fixtures on the retained tree. The rejected module's source
attribution remains in the patch and `../PROVENANCE.md`; full BSD notices stay
in the packaged and docs notices. The active worker and public source are restored.

Raw evidence and reproduction scripts are under
`.tmp/jpegxl-lossy-lab/joint-allocation-20261028`: eight screen directories,
`audit.ts`, `summarize.ts`, `audit-selected-predictions.ts`, `time.ts`,
`timing-suite.ts` and `report-data.ts`. Use the normal lab runner with the restored
mode names and a fresh output directory. Repeating audit/timing suites requires
fresh output paths because their logs deliberately refuse replacement.

`VITEST_MAX_WORKERS=4 npm run check` passes on the retained tree: 4,207 tests,
three existing skips, 337 passed files and one skipped file. The test phase takes
539.93s; the full command takes 583.110s. The three archived quantization fixtures
and experimental typecheck also passed before removal. The archive passes
`git apply --check`, and `git diff --check` is clean. Verification logs and final
status are under the raw root's `verification/` directory.
