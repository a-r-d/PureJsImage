# Coherent merge constraints and AC allocation

The only retained change is the exact inverse-DCT optimization described below.
The quality experiments fail promotion or the speed rule, and their code is
archived in [MERGE-EXPERIMENT.patch](MERGE-EXPERIMENT.patch) for base `a9275832`.

Aaron reopened development research after the channel-rounding plateau. Research
base is `a9275832` on `jxl-libjxl-ports`. This continuation consumes no peer maps.
The corpus, ladders, metric calculation, guards and memory ceiling stay fixed.
The holdout remains a promotion check.

## Merge constraints

The first-party guard measures modeled physical luma AC reconstruction error in
each covered 8x8 cell. It retains three 64-cell Float64 buffers for the current
color tile, totaling 1,536 bytes, and releases them before coefficient writing.
Selected small transforms establish each cell's budget. Larger square and
rectangular replacements either satisfy every covered budget or pay a penalty
for the worst local norm increase. An unchanged rectangle half keeps its budget.
DC reconstruction and the decoder's subsequent filters are outside this model.

Eight screens compare nearest-even rounding, actual writer rounding in luma,
eighth-norm and RMS budgets, relative allowances, and soft penalties. All regress
in the three-metric balance. On im26-2004, im26-3000 and im26-3012 at distance 2,
the strict caps remove all DCT32 coverage. Baseline DCT32 cell counts are 1,872,
3,472 and 1,664. Signaled DC and filter parameters stay unchanged in all six
strict-cap comparisons. The guard rejects too many useful merges. These trials
do not establish that a more accurate model including DC and filtering would
fail, but they reject this modeled local-error constraint.

## Screens

All twelve valid screens contain 16 development photos at five fixed distances,
with 80 successful outputs each. Values are mean BD-rate percentages in
SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max order. Negative is better.
Concurrent quality timing is excluded from speed claims.

| Experiment | vs vips | vs jSquash | vs retained |
| --- | --- | --- | --- |
| Strict eighth-norm, nearest rounding | +4.208 / +12.587 / +4.032 | +2.864 / +20.630 / +12.033 | +18.083 / +19.292 / +8.007 |
| Strict eighth-norm, actual luma | +4.370 / +12.704 / +6.497 | +2.982 / +20.385 / +14.602 | +18.285 / +19.494 / +10.519 |
| Eighth-norm, 10% allowance | -2.618 / +4.995 / +3.776 | -3.777 / +11.606 / +11.831 | +9.536 / +11.436 / +7.575 |
| Eighth-norm, 25% allowance | -6.928 / -0.754 / -2.008 | -8.014 / +5.129 / +5.572 | +4.313 / +5.140 / +1.441 |
| Strict RMS | +1.928 / +9.922 / +4.515 | +0.547 / +17.119 / +12.423 | +15.340 / +16.648 / +8.306 |
| RMS, 10% allowance | -4.850 / +1.852 / -0.197 | -5.955 / +8.006 / +7.534 | +7.097 / +8.098 / +3.395 |
| Soft worst-cell penalty, weight 1 | -8.988 / -3.503 / -3.938 | -10.014 / +2.220 / +3.340 | +1.845 / +2.121 / -0.684 |
| Soft worst-cell penalty, weight 4 | -4.429 / +3.021 / +1.835 | -5.576 / +9.245 / +9.573 | +7.014 / +9.043 / +5.366 |
| AC precision 0.9 | -10.526 / -5.034 / -2.566 | -11.332 / +1.227 / +4.760 | +0.127 / +0.820 / +0.812 |
| AC precision 1.1 | -10.500 / -6.124 / -5.408 | -11.378 / -0.513 / +1.769 | +0.165 / -0.801 / -2.298 |
| AC precision 1.1 plus actual luma | -10.763 / -6.083 / -5.380 | -11.702 / -0.540 / +1.793 | -0.094 / -0.752 / -2.351 |
| AC precision 1.2 | -10.032 / -6.299 / -5.765 | -11.096 / -0.918 / +1.772 | +0.670 / -1.172 / -2.500 |

## Allocation follow-up

After the guard misses, the next hypothesis changes DC/AC balance within the
coherent standalone mode. The AC multipliers scale the floating initial field
before selection and final wire rounding. Physical DC steps, global scale,
filtering and the remaining decisions stay fixed. Multiplying global scale
alone would be cancelled by the initial field's inverse scale normalization.

Precision 0.9 worsens all screen means. Precision 1.1 improves the screen mean
0.978% but worsens grain SSIM. Coupling it with actual luma rounding improves all
three screen means, averaging 1.066%, and removes that grain-screen regression.
These two points proceed to the full lab. Precision 1.2 has a worse SSIM/door-tail
tradeoff and is not selected.

The first AC110-luma and AC120 launches are invalid: the aliases did not select
the intended multiplier and therefore did not inherit the coherent DC policy.
Both are intentionally stopped with exit 130. Their partial artifacts are
preserved and excluded. A mapping fix and four DC-policy regression tests precede
the fresh `-v2` screens used above.

## Full development

Each finalist completes all 64 photos and nine distances, with 576 valid outputs.
The full-lab ladder remains authoritative over the larger screen gains.

| Mode | vs vips | vs jSquash | vs retained | Mean paired change |
| --- | --- | --- | --- | ---: |
| Retained selector | -8.090 / -4.730 / -5.575 | -8.553 / +0.770 / +2.537 | 0 / 0 / 0 | 0 |
| AC precision 1.1 | -7.887 / -5.239 / -5.663 | -8.350 / +0.087 / +2.579 | +0.333 / -0.583 / -0.033 | -0.094 |
| AC precision 1.1 plus luma rounding | -8.021 / -5.312 / -5.308 | -8.530 / -0.034 / +2.838 | +0.153 / -0.662 / +0.366 | -0.048 |

AC precision alone fails the grain im26-2004 SSIM guard at +8.808% versus
production. Coupled rounding brings it to +6.163% and reduces im26-3302 to
+6.749%. All eight admitted development SSIM guards pass for that coupled mode;
no 3-norm comparison covers the full required band. The coupled mode trades a
0.662% 3-norm improvement for worse SSIM and maximum-error means. Its mean gain
is only 0.048%, so even a small speed cost requires scrutiny. Both modes remain
more than 1% better than native-map replay on all three development metrics.

Managed peaks are 9,307,591 and 9,310,297 bytes, compared with the retained
9,232,573 bytes. These crop results stay below the unchanged memory ceiling.
Original-image qualification is not inferred from them.

## Inverse-DCT speed experiment

A fresh diagnostic profile attributes 164.234 ms of self time to the retained
selector's inverse transform. The new first-party kernel caches the existing
cosine weights in dot-product order and hoists coefficient orientation and
strides. Each even/odd sum keeps the same arithmetic order. All 21 supported
transform fixtures preserve their exact Float32 output. The constant cache is
5,376 bytes for the compact menu, at most 21,760 bytes across all supported
dimensions. It retains no image data and adds no source-sized scratch.

| Isolated alternating pairs | Baseline median | Candidate median | Paired change | Faster pairs | Paired MAD |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-3012, initial 15 | 1154.727 ms | 1179.166 ms | -2.700% | 9/15 | 6.334 points |
| im26-3012, repeat 21 | 1147.283 ms | 1107.349 ms | -2.971% | 15/21 | 4.018 points |
| im26-3312, 15 | 1229.904 ms | 1217.238 ms | -3.118% | 10/15 | 5.079 points |
| im26-3012 after cleanup, 21 | 1161.471 ms | 1144.449 ms | -2.052% | 13/21 | 3.672 points |

All measured paired streams are byte-identical and managed peaks stay unchanged. The noisy first
run is inconclusive by itself; repeats and the neighboring texture support a
small gain. The final paired result does not establish a material 3% gain.
Raw samples, IQR and coefficient-of-variation statistics remain available.
Only `standalone-selector-inverse` remains as the new active research mode. A fresh
full development run confirms byte identity for all 576 streams and unchanged
managed peak of 9,232,573 bytes. Its full-lab quality is exactly the retained
row above; independent decoder qualification transfers from those same bytes.

## Isolated allocation cost

Each finalist also receives 15 alternating im26-3012/d2 pairs after tests and
quality jobs finish. Precision 1.1 alone measures medians 1147.867/1110.118 ms,
paired -3.543%, with 9/15 faster pairs. Its development guard still fails.
The coupled point measures 1164.267/1325.343 ms, paired +12.721%, with zero
faster pairs. Its 0.048% mean quality gain cannot pay for that slowdown.
Neither quality finalist replaces the retained mode.

## Fresh qualification and cold comparison

A fresh single-worker run measures all 64 crops and 192 engine jobs, with no
failures, omissions or reused timings. Own median is 1462.421 ms, jSquash
501.788 ms and vips 369.063 ms: **2.914422x jSquash**, within 3x. Own p90 is
1542.669 ms and worst is 1622.479 ms. Managed peak stays 8,735,786 bytes; own
worker peak RSS is 203,608,064 bytes. The run takes 286.923 seconds.

The previous formal ratio was 2.864447x on October 14. To assess the optimization
without mixing measurements from different days, a further run uses the existing
worker and exact encode clock for both modes on all 64 frozen crops. Each mode
runs in a fresh process; the first mode alternates by image. No warmup or saved
timing is used. Native decoding and all scores are required after each encode.

All 128 cold samples pass, all 64 output pairs match, and managed peaks are
identical. Baseline/candidate medians are 1487.103/1471.990 ms, a 1.016% reduction
in the median-time ratio. Median per-image change is **-1.600%**, with 38/64
faster pairs and 3.359-point MAD. Across-image baseline/candidate CVs are 12.43%
and 13.11%; that dispersion includes differences between images. One cold pair
per photo complements the repeated warm tests; it is not a per-image speed
guarantee. The evidence supports keeping a modest 1-2% gain.

The 13 MP original completes in 48.598 s; jSquash takes 26.095 s and vips
9.628 s. The **1.862321x** ratio passes the 5x target for this original. Its
1,835,008 bytes match the previous stream exactly. Managed peak remains
59,071,615 bytes. Encoder-receipt RSS is 408,924,160 bytes; the whole worker
including validation/scoring peaks at 551,284,736 bytes. Native decoding and all
scores pass. This single original does not qualify the full watch set. The
21 MP original is not rerun here.

## Verification

All 95 quality-experiment focused cases pass, including odd dimensions, all development transforms,
per-cell budget protection, tile-edge footprint copies, soft-penalty behavior,
and AC aliases preserving DC/global-scale policy. The subsequent inverse variant
passes 96 focused cases; after cleanup the active suite passes 73. The updated receipt tests pass
in Chromium, Firefox and WebKit. A retained im26-3012/d2 control stream matches
the checkpoint byte for byte. The initial full check catches only formatting in
the previous checkpoint's final JSON report before tests; formatting is corrected
without changing values and the check is rerun. The experimental full check
passes 4,148 tests with three existing skips. After cleanup, the final full check
passes 4,126 tests with three skips in 677.68 seconds of test time, plus all
static, package, documentation and browser-build gates. Final browser receipts
pass in all three engines. Public bundles remain 614,941 and 687,773 bytes,
under unchanged ceilings, with zero runtime dependencies.

Raw evidence: `.tmp/jpegxl-lossy-lab/standalone-merge-20261015/`.
Experiments LL-759 onward are recorded in `../lossy-lab-log.md`.
Source attribution and first-party adaptations are recorded in `../PROVENANCE.md`.

## Result and reproduction

Retain the inverse-weight kernel on the research branch. Twelve quality screens
and two full quality labs produce no retained quality gain. Together with the
exact speed experiment, this completes the reopened comparison set. The two
previous holdout SSIM guards remain unresolved; no holdout is run or inspected.
Main, the public encoder, targets and memory ceiling are unchanged. Peer-forcing
hook isolation and full watch/scale qualification remain prerequisites to a
future main merge.

Remaining ideas are a cheaper exact plane quantizer, a decoder-domain error
model including DC and filtering, and smaller coherent AC shifts. Their upside
is unmeasured. No further quality trial or large source port starts here.

[Machine-readable evidence](MERGE-REPORT.json) includes all screens, full labs,
warm/cold paired timing, original parity and verification. The experimental
patch applies cleanly to an isolated checkout of base `a9275832`; it contains
the rejected modes and their tests. Raw inputs, curves, logs and the cold-pair
controller remain in the evidence directory named above.

```sh
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/reproduce-inverse-lab --mode lab --variant standalone-selector-inverse --workers 4 --strategy-port standalone-selector-inverse
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/reproduce-inverse-speed --mode speed --variant standalone-selector-inverse --workers 1 --strategy-port standalone-selector-inverse
node benchmark/jpegxl/lossy-lab/selector-speed.ts .tmp/jpegxl-lossy-lab/corpus-512-v2/im26-3012.png .tmp/jpegxl-lossy-lab/reproduce-inverse-pairs.json standalone-selector-pairs standalone-selector-inverse 21
VITEST_MAX_WORKERS=4 npm run check
```
