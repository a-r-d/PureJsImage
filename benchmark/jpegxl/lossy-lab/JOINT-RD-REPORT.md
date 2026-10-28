# Joint rate-distortion trial before entropy coding

Research branch `jxl-libjxl-ports`, base `83fa29b8`, 2026-10-28.

The encoder can now evaluate selected coefficients before writing the final
stream. The new reconstruction diagnostic agrees exactly with our decoder on
all 80 screen rows. The adaptive rate query reuses the writer's actual order,
context and hybrid-model searches, then stops before writing the AC payload.
It supplies the rate term for a standalone joint-RD trial with no peer maps.

## Reconstruction and rate

The direct renderer includes wire-rounded DC and chroma values, the small
transform coefficient layout, reconstruction centroids, Gaborish, EPF and
ordered output dithering. It reuses our normative inverse transform and filter
kernels. It is restricted to the retained SDR standalone geometry without DC
smoothing or custom image headers. Full-crop arrays are diagnostic storage.

All 80 development screen rows match the finished-stream decoder exactly in raw
XYB, filtered XYB, sRGB and dithered RGBA. The screen uses ten transform types.
Seven focused tests cover odd dimensions, multiple groups, all EPF iteration
counts and the rate query. An initially undersized Hornuss scratch array in the
new diagnostic was corrected before the photo run.

The rate query includes actual LF/DC/HF metadata bits and normalized ANS symbol
costs. It rebuilds the final model for each geometry. On four fixed development
cases, eight non-control validation rows have the correct rate-delta sign and
at most 13.814 bits of delta error. Two rows reproduce the same coarse-distance
alternative. The absolute color-bit estimate differs by at most 25 bits.
Selection includes a conservative 32-bit margin. Near-zero cost differences are
still uncertain. The grouped fixture verifies that querying leaves the final
control stream unchanged.

## Candidate policy

Recompute the selected luma transforms from the source. Every coefficient must
agree with the original quantizer before it can supply a proposal. Reductions
use the prior rd25-filtered proposal rule; increases reduce coefficient centroid
error. Rank by the local error/rate proxy and form three batches: reductions,
increases, and both. Empty or duplicate batches are skipped.

Each batch is reconstructed directly and scored with the complete dithered
perceptual model. Selection minimizes the following cost with lambda 1:

```text
log((estimated color bits + 32) / control estimated color bits)
+ mean(log(predicted max / control max), log(predicted 3-norm / control 3-norm))
```

Reject predicted max or 3-norm harm above 1%. Serialize the selected geometry
once. The subsequent native decode and metric calls supply validation labels;
they cannot affect the choice. Independent candidate serialization in the
four-case rate audit is diagnostic only.

## Screen

All three caps complete 80 native-scored rows: 16 photos at distances
0.5, 1, 2, 4 and 7. They use the standard screen's measured overlap; incomplete
required quality ranges and the skipped large-image screen are recorded in each
summary. These curves do not establish promotion coverage.

| Maximum changes per direction | SSIMULACRA2 vs control | 3-norm vs control | Max vs control | Mean of three |
| --- | ---: | ---: | ---: | ---: |
| 32 | -0.031150% | -0.033945% | -0.220063% | -0.095053% |
| 128 | -0.056758% | -0.008308% | -0.760774% | -0.275280% |
| 512 | -0.091281% | +0.035580% | -1.044343% | -0.366681% |

Worst per-image deltas are +0.120502/+0.010911/-0.003024% at cap 32,
+0.120502/+0.202059/+0.025029% at 128, and
+0.009990/+0.187266/+0.062689% at 512, in SSIM/3-norm/max order.
All pass the development screen's 3% regression guard.

| Cap | Control chosen | Reductions | Increases | Both |
| --- | ---: | ---: | ---: | ---: |
| 32 | 37 | 29 | 4 | 10 |
| 128 | 33 | 30 | 9 | 8 |
| 512 | 34 | 28 | 8 | 10 |

The largest cap improves max error most, while average 3-norm BD-rate slightly
worsens. The complete predictor prevents the earlier large max regressions, but
this proposal family offers only a small aggregate benefit.

Across the 240 selected screen rows, predicted max changes have the correct sign
in all 92 nonzero cases, and predicted 3-norm changes in all 136. At a 0.1%
materiality threshold, both metrics agree in 40/40 cases. Largest errors in the
predicted percentage change are 0.047796 percentage points for max and 0.005570
for 3-norm. These correlated rows verify the chosen outcomes; unselected
candidates were not all scored natively. There is still no SSIM predictor.

Cap 512's screen rates against vips are -10.736283/-5.832850/-6.173872%; against
jSquash they are -11.626175/-0.265303/+1.026789%, in SSIM/3-norm/max order.
These are screen results and must not replace the full-development table below.

Each screen has 73 recorded range omissions: 32 max, 32 3-norm and nine SSIM
comparisons do not cover the full required range. There are no failed encodes or
missing ladder points. The same screen settings also omit large originals.

## Cost and disposition

Three warmups precede seven alternating control/cap-512 pairs on each of two
photos at distance 2. Every result matches its independently scored stream.

| Photo | Control median | Joint median | Median paired ratio | Ratio MAD |
| --- | ---: | ---: | ---: | ---: |
| im26-3012 | 1124.691 ms | 6495.696 ms | 5.775538 | 0.329357 |
| im26-3312 | 2449.922 ms | 4062.290 ms | 3.200362 | 0.260621 |

The second photo has a substantial timing shift in its later trials; raw pairs
are preserved. Every candidate call is slower in all 14 pairs. Even its smallest
observed slowdown exceeds the allowance for the 0.367% mean quality gain. This
is enough to reject the policy under the speed rule, without claiming precise
production throughput. No full lab or holdout run is justified.

Peak process RSS reaches 448,364,544 and 989,945,856 bytes in these repeated
diagnostic processes. The encoder's ledger excludes the full perceptual arrays,
so its roughly 9 MB recorded peak is not a memory-gate pass. The prototype needs
bounded, accounted storage before it could enter promotion.

All three policies and their worker registration are removed and preserved in
`JOINT-RD-EXPERIMENT.patch`. The direct geometry renderer, final-model rate query
and focused fixtures remain as research tools. Public encoder decisions are
unchanged. The source helpers add 28 minified bytes to the JPEG XL entries;
generated package figures are refreshed. No dependency is added.

## Reproduction

Raw evidence is in `.tmp/jpegxl-lossy-lab/joint-rd-20261028`. It contains all
screen curves and native outputs, per-point decisions, independent candidate
rate checks, seven paired timing samples per photo and verification logs.

```sh
node benchmark/jpegxl/lossy-lab/audit-geometry-display.ts NEW_OUTPUT
git apply benchmark/jpegxl/lossy-lab/JOINT-RD-EXPERIMENT.patch
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out NEW_SCREEN --mode screen --variant joint-rd512 --strategy-port standalone-joint-rd512 --screen-skip-large --workers 4 --budget-seconds 1200
git apply --reverse benchmark/jpegxl/lossy-lab/JOINT-RD-EXPERIMENT.patch
```

Use `standalone-joint-rd` or `standalone-joint-rd128` for the other caps, with a
new output directory and distinct variant. The raw directory retains
`audit-joint.ts`, `summarize-screen.ts` and `time-joint.ts`; the latter requires
the experiment patch and an idle interval with `node --expose-gc`.

## Next work

1. Test proposals that change transform or quantization allocation, using this
   diagnostic to establish their available quality gain before investing in speed.
2. Reuse prepared source bands and update only affected display/metric regions.
   The established 76-pixel metric support gives an explicit boundary.
3. Rebuild entropy models only for short-listed batches, and validate incremental
   context counts against the final writer. Frozen-model costs remain unsuitable.

## Retained encoder

`VITEST_MAX_WORKERS=4 npm run check` passes on the retained tree: 4,207 tests,
three existing skips, 337 passed files and one skipped file. Vitest takes
529.14s; the complete check takes 571.314s. All seven focused fixtures pass
separately. Chromium, Firefox and WebKit pass in 15.6s. The initial checks found
stale generated package-size and documentation data; both were regenerated
before the successful complete run. The archived experiment patch passes
`git apply --check`.

The JPEG XL bundles are 614,969 / 687,801 minified bytes (codec / specialized),
each 28 bytes above the base. The package has zero runtime dependencies and the
version is unchanged. The new source exports are internal research helpers;
the public codec entry points do not export them or import the benchmark model.

No joint-RD policy is promoted. The retained full-development rates remain:

| Peer | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -8.003% | -5.030% | -5.582% |
| jSquash | -8.474% | +0.227% | +2.571% |

Previous qualification reports crops at 2.635783x jSquash and the 13 MP original
at 41.894s, or 1.698729x. The 21 MP encode completes in 83.743s; jSquash aborts.
Managed peaks are 8,760,382 / 59,139,199 / 91,010,461 bytes, below 137,514,476.
These are carried measurements, not new speed or memory qualification.
The two frozen SSIM holdout guards remain unresolved. Holdout input is closed.
