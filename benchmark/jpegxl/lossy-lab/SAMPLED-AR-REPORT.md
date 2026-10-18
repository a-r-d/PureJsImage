# Sampled reconstruction and sharpness map rate

Twelve fixed screens produce 960 valid outputs. No sampled mode is retained.
The best combined gain is 0.027%, with a measured 14.688% encode-time cost.
Research branch `jxl-libjxl-ports` retains the writer from `9924201c`.
Main is unchanged; no candidate earns a full lab or holdout run.

## Method

Reconstruct only 8x8 or 16x16 patches from our final coefficients, with an
eight-pixel halo. Use our inverse transforms, coefficient biases, physical DC,
CfL, Gaborish and retained one-iteration EPF policy. Process coefficient groups
together to avoid repeated unpacking. Cache original samples once, compute
filter differences once, and score only the sampled pixels. Scratch stays
bounded independently of the image size. No peer decisions are consumed.

Choose sharpness 0, 2, 4 or 7 once per 32, 64 or 128 pixel region, or once for
the image. Native squared masking and XYB weights remain. Test the native
preference for zero separately. The final two modes cache four doubles per
region and normalize distortion against the whole image, with no additional
reconstruction.

Charge our writer's predictor-5 residual entropy per DC group, plus an alphabet
header estimate. A region change includes its right and bottom predictor
neighbors. Normalize rate using our quantized coefficient magnitudes, then
balance the distortion change against estimated extra map bits. This is a cost
estimate, not an exact entropy serialization. Every reported BD-rate uses the
complete valid stream's actual byte count and measured quality.

## Screen results

Values are SSIMULACRA2 / Butteraugli 3-norm / maximum BD-rate percentages.
Each row has 80 fresh own outputs, native decoding and scoring, zero execution
failures and zero execution omissions. Coverage warnings remain explicit in
the raw summaries. Control is `standalone-forward-all`, on the same fixed
16-photo screen and five-distance ladder. Concurrent screen timings are excluded.

| Trial | Against control | Against vips | Against jSquash |
| --- | --- | --- | --- |
| 64 px, one 16 px patch, rate 1 | +0.329/+0.083/+0.767 | -10.352/-5.788/-4.448 | -11.246/-0.212/+2.878 |
| 128 px, one 16 px patch, rate 1 | +0.486/+0.173/+0.153 | -10.206/-5.705/-5.036 | -11.098/-0.108/+2.267 |
| Image-wide, four 16 px patches | +0.436/-0.014/-0.032 | -10.263/-5.899/-5.252 | -11.163/-0.244/+2.052 |
| 64 px, four 16 px patches, rate 1 | +0.146/-0.123/-0.017 | -10.523/-5.987/-5.196 | -11.417/-0.420/+2.090 |
| 32 px, one 8 px patch, rate 1 | +0.401/+0.196/+0.213 | -10.279/-5.677/-4.980 | -11.171/-0.099/+2.325 |
| 64 px, one 8 px patch, rate 2 | +0.408/+0.262/-0.155 | -10.275/-5.618/-5.316 | -11.165/-0.036/+1.906 |
| 64 px, one 16 px patch, rate 4 | +0.085/-0.039/+0.266 | -10.575/-5.904/-4.910 | -11.468/-0.337/+2.383 |
| 64 px, one 16 px patch, no rate term | +1.178/+0.743/+1.212 | -9.681/-5.206/-4.075 | -10.571/+0.462/+3.306 |
| Image-wide with native zero preference | +0.967/+1.313/+0.833 | -9.858/-4.668/-4.457 | -10.663/+1.170/+2.945 |
| 64 px, four patches, native zero preference | +0.429/+1.092/+0.359 | -10.300/-4.877/-4.827 | -11.108/+0.909/+2.493 |
| 64 px, one patch, image error normalization | +0.358/+0.104/+0.533 | -10.329/-5.769/-4.672 | -11.224/-0.188/+2.633 |
| 64 px, four patches, image error normalization | +0.178/-0.169/-0.092 | -10.495/-6.031/-5.266 | -11.390/-0.464/+2.017 |

The best point is four samples per 64-pixel region with image-wide distortion
normalization: +0.178/-0.169/-0.092%, a mean of -0.027%. The isolated speed
measurement rejects that small gain before a full lab.

## What the map bits explain

At matched settings, mean complete-file growth is 0.580% without the rate term,
0.085% with rate weight one, and 0.009% with weight four. The identical sparse
sampler's BD-rate changes from +1.178/+0.743/+1.212% without the rate term to
+0.329/+0.083/+0.767% with it. Charging the map is useful.

On development im26-3012 at distance 2, the sparse 64-pixel map adds 60 actual
bytes; the estimate adds 470.945 bits, or 58.868 bytes. All 30 non-sharpness
decision fields match the control. The dense image-normalized mode adds 29
bytes. The prior blockwise native map added 603 bytes at this point.

The previous blockwise trial grew files by 4.321% on average. The four-patch
64-pixel map grows them by 0.031%; image-wide distortion normalization changes
that to 0.042%. Removing most of that rate penalty
does not establish a sufficient quality gain. Virtual rate/quality curves in
the JSON report are diagnostic, not encodable promotion results or additive
effects. For the best point, quality at control bytes is +0.118/-0.223/-0.151%; the
SSIM trade remains even with free map bytes. The sampled decision loss remains
the problem after map overhead falls.

## Isolated time and memory

Twenty-one alternating pairs follow one warmup pair, on im26-3012 at distance 2.
No other benchmark, browser fixture, profile or test runs during either series.

| Mode | Control / candidate median | Median paired change | MAD | Candidate faster |
| --- | --- | --- | --- | --- |
| Dense, image-normalized | 1013.924 / 1138.402 ms | +14.688% | 5.025 points | 2/21 |
| Sparse, rate weight one | 1032.008 / 1066.391 ms | +4.698% | 5.005 points | 8/21 |

Managed peak is 5,682,267 bytes in both modes and controls. Per-mode hashes
are stable; changed sharpness intentionally changes encoded bytes. Whole-process
RSS is 350,416,896 bytes for the dense alternating series and 343,773,184
bytes for the sparse series. These joint warm-process peaks include both modes;
the raw time receipts preserve the separate series.
The dense mode would need about 1.469 points of combined BD-rate improvement
for this time cost under the speed rule; it achieves 0.027 points.

Profiles locate 54.154 ms inclusive sampled-evaluator time for one patch,
159.077 ms for four patches, and 26.480 ms for the image-wide decision. Generic
EPF edge traversal is absent. These concurrent profiles are diagnostic only;
the isolated pairs above establish the measured time cost.

## Retained control and gates

The unchanged writer's previously qualified 64-photo full development lab is:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | --- | --- | --- |
| wasm-vips | -8.003% | -5.030% | -5.582% |
| jSquash | -8.474% | +0.227% | +2.571% |
| Main | -7.149% | -10.072% | -9.609% |

Its previous isolated crop ratio remains 2.636x jSquash. These are retained
control measurements, not new full-lab or peer-speed runs from this batch.
The existing frozen holdout SSIM guard failures and remaining watch/scale
qualification still block main. The holdout stays closed.

## Verification and archive

All twelve experimental modes pass 96 focused tests and fixed-source Chromium,
Firefox and WebKit fixtures. Incremental map-bit estimates match complete
histogram recomputation across image and DC-group boundaries. Sampled final
coefficient reconstruction matches full decoding within one code value on thin,
odd-sized and coefficient-group boundary fixtures.

The rejected modules, aliases and tests are preserved in
[SAMPLED-AR-EXPERIMENT.patch](SAMPLED-AR-EXPERIMENT.patch), applicable to
`9924201c`. Active source and benchmark code return to that retained control.
The source headers and [provenance](../PROVENANCE.md) identify the exact libjxl
revision and adaptations. Existing full BSD-3 notices remain included in npm
and the docs site. No runtime dependencies or public source changes.

The restored tree passes `VITEST_MAX_WORKERS=4 npm run check` with exit code
zero and no signal: 4,156 tests pass, three existing tests skip; 328 files pass
and one skips. Tests take 527.16 seconds; the full command takes 567.711
seconds. Static, package, docs and browser-build checks pass. Codec bundles
remain 614,941/687,773 bytes, and runtime dependencies remain zero.
The durable receipt is in the raw root below.

## Next hypotheses

1. Highest expected value: improve the filter-specific distortion criterion.
   With map overhead mostly removed, native masked XYB error still chooses
   changes that trade SSIM against Butteraugli. Compare candidate loss with
   measured development perceptual changes before adding more rate weights.
2. Lower expected value: require spatial sample agreement before changing a
   region. Four samples help, but their time cost is already too large for the
   observed gain; test a cheaper confidence rule only with a credible loss signal.
3. Lowest expected value: revisit cached regional decisions in reverse order to
   account for neighboring map choices. Residual map overhead is already about
   0.04%, so map optimization alone has little measured headroom.

Raw evidence: `.tmp/jpegxl-lossy-lab/standalone-sampled-ar-20261017/`.
The [JSON report](SAMPLED-AR-REPORT.json) includes exact screen values, execution
status, rate/quality diagnostics, map audits, speed statistics and check status.
Log entries LL-895 through LL-910 record the trials and cleanup.

To reproduce, apply the archived patch and use a fresh output directory:

```sh
git apply benchmark/jpegxl/lossy-lab/SAMPLED-AR-EXPERIMENT.patch
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/sampled-reproduction --mode screen --variant standalone-sample64-four-global-rd --strategy-port standalone-sample64-four-global-rd --workers 4
```
