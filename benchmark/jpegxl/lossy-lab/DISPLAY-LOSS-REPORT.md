# Display loss and metric sensitivity

No new encoder mode is retained. The display-loss audit finds a measurement
limitation in the previous texture counterexample: its sharpness changes are
small enough that flipping both metric inputs often reverses their native
SSIMULACRA2 sign. Correct display bytes, RGB scale order, blur support and
moment precision do not establish a useful selector. Research remains on
`jxl-libjxl-ports`; main, public codec source and the closed holdout are unchanged.

Base: `d9681032f5388c35edd32f6f5ebd53429a86fb6b`. The retained
`standalone-forward-all` writer still uses only its own decisions. This batch
adds offline diagnostics, 38 own-encoder streams and 360 public metric calls.
It makes no new BD-rate, encode-time, memory or promotion claim. All 38 streams
decode through the pinned native decoder. Both new controls are byte-exact with
the saved controls from the previous audit.

## Display and scale audit

Reuse the sixteen fixed sharpness 4-to-7 interventions on each development crop:
painting `im26-3012/d2` and near-flat texture `im26-3312/d4`. Read the actual
native-decoded eight-bit PNGs, removing our approximate reconstruction from this
comparison. Test linear-RGB downsampling before XYB conversion, three versus
six scales, image-wide moments, Gaussian support, zero borders and float versus
double moments. The cosine kernel comes from libjxl v0.12.0's coefficient
construction. Direct convolution does not reproduce native recursive float
rounding or SIMD color math. These losses are diagnostics, not the native metric.

| Loss on saved 64x64 interventions | Painting signs correct | Texture signs correct |
| --- | ---: | ---: |
| Previous full-region pointwise | 8/16 | 6/16 |
| Previous full-region Gaussian | 16/16 | 6/16 |
| Display bytes, regional RGB, three scales | 16/16 | 8/16 |
| Display bytes, full-image RGB, six scales | 16/16 | 8/16 |
| Wider Gaussian with zero borders | 16/16 | 5/16 |
| Wider Gaussian, zero borders, float moments | 16/16 | 8/16 |
| Source-derived cosine support, zero borders | 16/16 | 6/16 |
| Cosine support with float moments | 16/16 | 6/16 |
| Cosine support with double moments | 16/16 | 7/16 |

No row provides a reliable mixed-sign texture decision. The painting alone
cannot validate a classifier: retaining sharpness four predicts all sixteen
original signs correctly without evaluating any loss.

## Native metric orientation check

Replay all saved PNG scores through the unmodified public metric binary.
All 34 scores reproduce exactly after a byte-preserving PNG rewrite. Then apply
the same horizontal flip, vertical flip, 180-degree rotation or transpose to
both reference and output. These are exact RGBA byte permutations. The images
are square with even dimensions at all six scales.

| Orientation | Painting agreement with original signs | Texture agreement | Largest texture delta shift |
| --- | ---: | ---: | ---: |
| Identity | 16/16 | 16/16 | 0 |
| Horizontal flip | 15/16 | 10/16 | 0.064165 |
| Vertical flip | 16/16 | 5/16 | 0.050542 |
| 180-degree rotation | 16/16 | 6/16 | 0.050527 |
| Transpose | 16/16 | 9/16 | 0.051583 |

Fifteen painting signs remain unchanged across all five orientations. Only one
texture sign does. The double-moment model misses that one texture sign, so
orientation sensitivity does not excuse every wrong model prediction. Averaging
the five orientations is diagnostic only; even the best model agrees with only
10/16 of those texture mean signs. The authoritative metric and gates stay fixed.

Source inspection suggests float moment cancellation and recursive blur rounding
as possible causes of orientation sensitivity. This experiment does not isolate
their individual contributions or prove that all differences are numerical.
It establishes that these tiny texture signs are unsuitable as sole causal
labels for fitting a selector.

## Larger interventions

Increase changed area fourfold to sixteen non-overlapping 128x128 regions, then
make one uniform whole-image sharpness change. Keep transforms, quantization,
coefficients and all other own decisions fixed.

| Changed area | Painting signs stable across orientations | Texture signs stable | Double-moment model correct on stable signs |
| --- | ---: | ---: | --- |
| 64x64 | 15/16 | 1/16 | Painting 15/15; texture 0/1 |
| 128x128 | 16/16 | 2/16 | Painting 16/16; texture 1/2 |
| Full 512x512 | 1/1 | 0/1 | Painting 1/1; texture has no stable sign |

The whole-image painting change loses **0.846912 native SSIM points** in the
original orientation. All five changes lie between -0.854394 and -0.834467.
The double-moment model predicts harm. The texture instead changes by -0.038007
in the original orientation, with deltas between -0.064278 and +0.048112 across
orientations. Both uniform output sizes equal their control sizes.

Removing painting detail remains a credible failure. The texture's filter effect
remains too small relative to orientation sensitivity to validate a local loss,
even when the entire image changes. These are score-point changes, not BD-rates.

## Decision and next work

Keep the retained encoder policy. The earlier full-region losses cost 30% to 86%
more encode time without a material combined gain. The new audit provides no
reason to repeat those screens or add a more expensive approximation.

Return to coupled quantization and transform allocation with the retained filter
policy. Use the fixed development lab to identify larger, repeatable losses before
designing another heuristic. Any future filter loss needs both helpful and harmful
development interventions whose native signs survive this sensitivity check.
Do not tune to transformed-score averages, inspect holdout cases or weaken gates.

## Reproduction and evidence

The raw root is `.tmp/jpegxl-lossy-lab/display-loss-20261027/`. The joined
[JSON report](DISPLAY-LOSS-REPORT.json) includes every prediction and transformed
score, plus source PNG, control stream and metric-binary SHA-256 values for the
new encodes. The earlier saved interventions remain under
`.tmp/jpegxl-lossy-lab/filter-loss-20261018/`.

```sh
mkdir -p "$DISPLAY_AUDIT_ROOT"
node benchmark/jpegxl/lossy-lab/display-loss-audit.ts "$DISPLAY_AUDIT_ROOT/double-audit.json"
node benchmark/jpegxl/lossy-lab/display-score-replay.ts "$DISPLAY_AUDIT_ROOT/replay"
node benchmark/jpegxl/lossy-lab/display-group-audit.ts "$DISPLAY_AUDIT_ROOT/group128" 128
node benchmark/jpegxl/lossy-lab/display-group-audit.ts "$DISPLAY_AUDIT_ROOT/uniform512" 512
node benchmark/jpegxl/lossy-lab/summarize-display-audit.ts "$DISPLAY_AUDIT_ROOT" "$DISPLAY_AUDIT_REPORT"
```

Set a fresh writable `DISPLAY_AUDIT_ROOT` and an explicit `DISPLAY_AUDIT_REPORT`
path before running these commands. The group script
refuses existing case directories. There are no peer-map inputs. Ports have
source headers and entries in `../PROVENANCE.md`; the existing full BSD-3 notice
is included in the package and rendered by the docs site.

Focused verification passes eighteen cases: display conversion, odd scale edges,
identity and distortion, blur variants, coefficient normalization, exact geometric
permutations and double-moment reflection stability. `VITEST_MAX_WORKERS=4 npm run
check` exits zero: 4,174 tests pass, three existing skips; 329 test files pass and
one skips. Test duration is 521.74 seconds. Static, package, documentation and
browser-build checks also pass. No benchmark overlaps the full check.
