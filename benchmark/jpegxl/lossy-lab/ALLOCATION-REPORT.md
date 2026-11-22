# DC/AC allocation sweep, 2026-10-14

Step A improves the allocation tradeoff but does not meet the new objective.
The best full-lab point is **alpha 0.5, s_ac 1, DC smoothing off**. Against vips
it measures **+2.241% SSIMULACRA2, +4.630% Butteraugli 3-norm and +1.240% max**,
with a **+2.704% mean**. Every metric is below +5%; the mean misses +2%.
The smoothing-on finalist has a +2.838% mean. The unchanged control's mean is
+4.613% on the same development ladder.

All **4,288 encodes** complete successfully: 32 screens of 80 points, two
full-lab finalists of 576 points, and one 576-point Gaborish diagnostic. No
holdout or original-image qualification runs were started. Step C has not
started and requires Aaron's approval under the latest owner decision.

## Full-lab result

Each triple is SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max BD-rate percent.
Negative is better. Every row has 64 photos and nine distances. The Gaborish row
uses native maps; only the two allocation rows are independent of peer decisions.

| Full 64-photo lab | vips SSIM / 3-norm / max (%) | Mean (%) | Control SSIM / 3-norm / max (%) | jSquash SSIM / 3-norm / max (%) | Own median ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| gaborish | +3.431 / +1.524 / +0.697 | +1.884 | +5.548 / -4.589 / -3.802 | +3.233 / +8.524 / +9.710 | 1038.6 |
| a0p5-s1-off | +2.241 / +4.630 / +1.240 | +2.704 | +2.465 / -3.484 / -5.079 | +0.324 / +8.707 / +9.576 | 1038.1 |
| a0p5-s1-on | +2.581 / +4.613 / +1.319 | +2.838 | +3.108 / -3.419 / -5.059 | +0.444 / +8.661 / +9.645 | 1057.7 |

Against the unchanged encoder, the best point trades +2.465% SSIM for -3.484%
3-norm and -5.079% max. These are direct paired BD-rates over each comparison's
measured overlap; subtracting the peer aggregate rates is a different calculation.
Quality-band coverage remains partial. The best point's control comparisons
cover the complete requested band for 8 SSIM photos, zero 3-norm photos and
28 max photos. Exact per-image intervals and coverage remain in the JSON.

## Frontier and selection

[Frontier close-up](ALLOCATION-FRONTIER-ZOOM.svg) shows the competitive points;
[the full-grid plot](ALLOCATION-FRONTIER.svg) includes all 32 points. Lower is
better on both axes. Colors identify alpha, circle size identifies AC precision,
and filled circles enable normative DC smoothing. The line joins nondominated
SSIM/3-norm points; maximum error remains part of the selection gate and table.

The screen frontier contains alpha/AC scale/smoothing combinations
0.25/0.8/off, 0.5/0.8/off, 0.5/1/off and 0.75/0.8/off. Finalists were selected
from the complete screen: first prefer every metric <=+5%, then rank by the
three-metric mean. Alpha 0.5 / AC 1 with smoothing off and on ranked first and
second, with screen means -0.855% and -0.379%. Both were taken to the full lab
without further tuning. The screen was substantially more favorable than the
full set, so its apparent pass did not justify promotion.

## Gaborish diagnostic

Keeping native quantization, transforms, DC, CfL, matrices and filter settings
fixed, substitute the already ported optimized inverse for the mathematical
inverse. SSIM against vips changes from +3.323% to **+3.431%**. The direct paired
comparison to the mathematical inverse is **+0.098% SSIM, -0.052% 3-norm and
+0.200% max**. This substitution does not shrink the SSIM residual and does not
support attributing that residual to this inverse-filter choice. It does not
exclude other unsignaled encoder differences.

The diagnostic's numerical mean is +1.884%, but it consumes native decisions
and cannot qualify as a standalone encoder.

## Selector speed estimate and memory

The preceding coupled screen measured 4,814.3ms for the source-selector
prototype and 1,047.4ms for native-map replay: about **3,766.9ms extra**, or
**4.60x total encode time**. This is an estimate from four-worker medians, not
an isolated selector profile. That comparison also changes inverse Gaborish and
quantization aggregation. The rewrite prototype also retains preparation from
our encoder, so this is not a timing prediction for a replacement implementation.
The evidence nevertheless shows substantial scalar selector cost that Step C
would need to address.

All encode times in this report come from four-worker quality sweeps. The
existing timer starts after override construction, including the closed-form
InitialQuantDC parameter calculation and peer-map extraction in the replay
diagnostic; blending and our encoder decisions run inside the timer. These
measurements are not isolated crop or original speed qualification. No allocation point passed the development
objective, so promotion speed and holdout runs were not started.

Maximum managed storage is 9,694,613 bytes across the 32 screens and 9,656,661
for each allocation finalist; the replay diagnostic peaks at 9,749,721. Full-lab
process peak RSS is 316,207,104 bytes for smoothing off, 320,270,336 for smoothing
on, and 268,181,504 for the replay diagnostic. These process peaks include the
worker's encode/decode/scoring workflow. Original-image memory remains unqualified.

## Method and implementation

Base revision is `120e0675`, on `jxl-libjxl-ports`. Inputs, five-distance screen,
nine-distance full lab and cached effort-7 peers remain unchanged. Every stream
is independently decoded and scored with the existing lab tools. The new
allocation mode reads no peer decisions: it blends each channel's physical DC
step geometrically with the existing licensed InitialQuantDC port, and scales
the encoder's global AC precision before its own decisions. Integer global
scale and wire DC matrices retain their existing rounding.

The 20 base points explicitly disable normative DC smoothing; the 12 additional
points at alpha >=0.5 enable it. Our normal photo policy already enables it.
The neutral knobs with that normal policy are byte-identical to control at all
five tested distances. Focused tests verify physical DC blending, independent
AC scaling, smoothing and emitted-map preservation in the Gaborish diagnostic.

The development hooks change source files but are rejected by the public codec
options and do not change normal encode decisions. No version, runtime
dependency, quality threshold, memory ceiling or bundle ceiling is changed.
Before a future main merge, peer-forcing hooks must be removed or kept outside
the public bundle path. This research checkpoint is not a main merge.

The full libjxl license remains in npm contents and the docs site. This work
reuses the recorded InitialQuantDC and inverse-Gaborish ports; provenance records
the reuse and owner-specified blend. Final repository verification is recorded
in LL-669. Three-browser allocation and Gaborish coverage passes.

## Complete screen table

Names encode alpha, AC scale and smoothing; `p` represents a decimal point.
Times are diagnostic medians in milliseconds. jSquash reference curves and all
individual comparisons are included in [ALLOCATION-REPORT.json](ALLOCATION-REPORT.json).

| Point | vips SSIM / 3-norm / max (%) | Mean (%) | Control SSIM / 3-norm / max (%) | Own median ms |
| --- | ---: | ---: | ---: | ---: |
| a0-s0p8-off | -5.556 / +7.199 / +8.973 | +3.538 | -0.746 / +1.388 / +4.389 | 1142.1 |
| a0-s1-off | -5.651 / +5.159 / +4.193 | +1.234 | -0.406 / -0.142 / -0.097 | 1037.4 |
| a0-s1p25-off | -3.692 / +3.520 / +5.307 | +1.712 | +2.068 / -1.377 / +0.483 | 1226.4 |
| a0-s1p6-off | -0.359 / +3.286 / +5.402 | +2.776 | +5.748 / -1.799 / +0.184 | 1332.2 |
| a0p25-s0p8-off | -5.887 / +4.969 / +5.145 | +1.409 | -1.124 / -0.390 / +0.841 | 1186.4 |
| a0p25-s1-off | -4.720 / +2.718 / +1.611 | -0.130 | +0.378 / -2.208 / -2.231 | 1211.5 |
| a0p25-s1p25-off | -1.486 / +1.969 / +3.274 | +1.252 | +4.187 / -2.696 / -1.411 | 1206.2 |
| a0p25-s1p6-off | +3.900 / +2.609 / +2.634 | +3.048 | +10.175 / -2.297 / -2.418 | 1226.0 |
| a0p5-s0p8-off | -4.902 / +1.918 / +2.046 | -0.313 | +0.106 / -2.765 / -2.046 | 1237.1 |
| a0p5-s0p8-on | -4.166 / +2.158 / +2.503 | +0.165 | +0.875 / -2.523 / -1.595 | 1198.4 |
| a0p5-s1-off | -2.020 / +0.671 / -1.216 | -0.855 | +3.396 / -3.881 / -4.663 | 1139.0 |
| a0p5-s1-on | -0.953 / +1.022 / -1.205 | -0.379 | +4.589 / -3.556 / -4.974 | 1173.3 |
| a0p5-s1p25-off | +2.813 / +0.819 / +2.100 | +1.911 | +8.705 / -3.737 / -2.665 | 1240.7 |
| a0p5-s1p25-on | +4.089 / +1.404 / +1.996 | +2.496 | +10.110 / -3.192 / -2.780 | 1128.5 |
| a0p5-s1p6-off | +10.870 / +2.638 / +2.830 | +5.446 | +17.582 / -2.224 / -2.029 | 1123.0 |
| a0p5-s1p6-on | +12.601 / +3.540 / +2.911 | +6.351 | +19.473 / -1.391 / -1.905 | 1162.4 |
| a0p75-s0p8-off | -0.718 / -0.208 / +0.435 | -0.164 | +4.761 / -4.241 / -3.555 | 1139.3 |
| a0p75-s0p8-on | +0.989 / +0.449 / -0.007 | +0.477 | +6.784 / -3.625 / -4.165 | 1132.8 |
| a0p75-s1-off | +4.745 / +0.066 / -4.582 | +0.076 | +10.863 / -4.290 / -7.833 | 1256.3 |
| a0p75-s1-on | +6.503 / +0.706 / -3.103 | +1.369 | +13.236 / -3.630 / -6.753 | 1174.7 |
| a0p75-s1p25-off | +12.695 / +1.880 / -0.346 | +4.743 | +18.897 / -2.684 / -4.901 | 1273.3 |
| a0p75-s1p25-on | +14.650 / +2.671 / +0.974 | +6.098 | +21.933 / -1.845 / -3.763 | 1290.6 |
| a0p75-s1p6-off | +24.462 / +5.409 / +1.881 | +10.584 | +32.171 / +0.547 / -3.088 | 1260.3 |
| a0p75-s1p6-on | +27.315 / +6.974 / +6.159 | +13.482 | +35.860 / +2.033 / +0.600 | 1148.3 |
| a1-s0p8-off | +11.258 / +4.102 / +0.015 | +5.125 | +18.011 / -1.381 / -4.003 | 1113.7 |
| a1-s0p8-on | +12.040 / +4.393 / -0.190 | +5.415 | +19.672 / -0.829 / -4.204 | 1095.0 |
| a1-s1-off | +21.288 / +7.611 / -1.387 | +9.171 | +29.291 / +0.738 / -5.162 | 1199.1 |
| a1-s1-on | +21.764 / +8.096 / +0.891 | +10.250 | +31.148 / +1.539 / -3.248 | 1327.3 |
| a1-s1p25-off | +34.887 / +13.113 / +3.701 | +17.234 | +44.179 / +5.485 / -1.762 | 1276.8 |
| a1-s1p25-on | +34.065 / +13.105 / +4.802 | +17.324 | +45.357 / +6.083 / -0.448 | 1288.2 |
| a1-s1p6-off | +55.879 / +22.257 / +10.464 | +29.533 | +66.008 / +13.387 / +3.990 | 1323.5 |
| a1-s1p6-on | +53.015 / +21.974 / +13.282 | +29.424 | +66.128 / +14.215 / +6.941 | 1252.0 |

## Reproduction

Use fresh output directories; the runners refuse to overwrite their logs.
The screen batch is `node benchmark/jpegxl/lossy-lab/run-allocation-sweep.ts`.
Then run `report-allocation.ts`, `run-allocation-finalists.ts`, and
`report-allocation-finalists.ts` from the same directory. Raw inputs, streams,
receipts, reports and logs remain in `.tmp/jpegxl-lossy-lab/allocation-20261014`.
The batch wrapper's initial coverage/completion mistake and repair are recorded
in LL-664; its first completed screen was preserved without re-encoding.
