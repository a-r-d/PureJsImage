# Coherent standalone refinement, 2026-10-14

Research base: `98183404` on `jxl-libjxl-ports`. Main remains `b2666b83`.
All encoder decisions use source pixels and distance, without peer maps.
The unchanged production encoder remains the per-image quality control.

## Retained candidate and gates

The retained development mode is `standalone-refined-chroma75`. It combines the
coherent source ports, one EPF iteration, half-strength HF modulation, half-size
luma DC steps and 0.75-size chroma DC steps. It uses the optimized selector with
bounded masks. It reads no peer decisions.

All three full development runs finish 576 own points, without execution failures.
Sixteen screens add 1,280 valid own points. The interrupted plain half-DC full run
is excluded. Metric order below is SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max.

| Full-lab candidate | Vips (%) | jSquash (%) | Vips mean (%) |
| --- | ---: | ---: | ---: |
| Optimized selector, one EPF iteration | -3.178/-4.517/-4.057 | -3.398/+1.606/+4.318 | -3.917 |
| Half luma/chroma DC, half HF | -8.895/-3.148/-3.480 | -10.418/+1.950/+4.444 | -5.174 |
| Half luma DC, 0.75 chroma DC, half HF | -8.119/-4.698/-5.081 | -9.147/+0.631/+3.051 | -5.966 |

The retained candidate improves on the unchanged production control by
-6.777/-9.577/-9.037%, on native-map replay by -10.894/-5.793/-4.946%, and on
the preceding standalone checkpoint by -5.516/-0.832/-0.810%. These aggregate
results clear the development objective and native-replay comparison.

One full-band production-control SSIM guard still fails: im26-2004 +8.397%,
above the +8% limit and its 0.05-point tolerance. The half-chroma candidate was
+8.516%. The earlier failures now pass: im26-1468 -1.511%, im26-3012
+3.529%, and im26-3302 +7.574%. There are eight full-band SSIM comparisons and no full-band 3-norm
comparisons against production. Partial overlaps are reported but cannot clear
those per-image guards. The peer summary contains 293 partial-range warnings.
Holdout and promotion remain closed; original-image timing and memory remain
unqualified. Main is unchanged.

The three worst maximum-error regressions against production are im26-3000
+29.050%, im26-3004 +9.635% and im26-1636 +8.615%, all partial-band comparisons.
Visual inspection at candidate distance 1.85 and the nearest production-control
byte size on the existing ladder shows weaker fine cracks on the dark door,
close jar-edge appearance, and smoother dark bag texture. Candidate/control bytes
are 11,776/11,656, 20,314/21,215 and 11,320/13,179 respectively. The last pair is
not closely size matched; these spot checks do not establish visual parity.

## Quality investigation

The initial one-iteration EPF candidate completes all 576 development points.
Its vips SSIM/3-norm/max BD-rates are -3.178/-4.517/-4.057%, mean -3.917%.
Against jSquash they are -3.398/+1.606/+4.318%. Against our production control,
they are -1.031/-8.787/-8.181%; against native-map replay, -5.910/-5.711/-3.995%.
The three existing SSIM guards still fail: im26-1468 +13.057%, im26-3012
+9.636% and im26-3302 +13.709%.

Each screen below uses the same 16 development photos and five distances.
Metric order is SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max. Negative is
better. The paired column compares with the `98183404` direct-mode screen.

| Experiment | Vips (%) | jSquash (%) | Paired checkpoint (%) |
| --- | ---: | ---: | ---: |
| EPF sharpness 5 | -3.092/-3.270/-5.097 | -3.085/+3.460/+2.101 | +1.190/+1.033/-0.143 |
| EPF sharpness 6 | -1.761/-2.081/-4.862 | -1.746/+4.771/+2.346 | +2.534/+2.274/+0.095 |
| At most one EPF iteration | -5.491/-5.808/-5.282 | -5.387/+0.805/+2.071 | -1.121/-1.495/-0.070 |
| Half HF modulation | -3.994/-5.092/-5.938 | -3.979/+1.385/+1.248 | +0.289/-1.042/-0.920 |
| EPF sharpness 2 | -5.827/-4.713/-4.364 | -5.814/+1.873/+2.901 | -1.559/-0.497/+0.693 |
| No EPF | -4.647/-2.896/-3.831 | -4.479/+4.001/+3.629 | -0.171/+1.586/+1.494 |
| Remove 32x32-level transforms | -0.668/+1.104/-0.838 | -0.736/+8.098/+6.524 | +3.763/+5.510/+4.238 |
| Symmetric transforms and bounded masks | -4.274/-4.268/-4.974 | -4.257/+2.384/+2.237 | 0/0/0 |
| One EPF iteration, half DC step | -10.663/-2.733/-0.328 | -11.487/+3.072/+7.120 | -7.137/+1.562/+5.081 |
| One EPF iteration, no DC smoothing | -5.911/-6.059/-5.278 | -5.355/+0.600/+2.291 | -1.192/-1.376/+0.179 |
| One EPF iteration, ordinary AC rounding | -4.171/-3.678/-2.403 | -4.147/+2.756/+5.216 | +0.254/+0.434/+3.005 |
| One EPF iteration, half DC step, half HF modulation | -11.045/-4.107/-1.623 | -11.876/+1.360/+5.743 | -7.512/-0.160/+3.806 |
| One EPF iteration, quarter DC step | -7.092/+5.221/+5.933 | -8.269/+11.222/+13.625 | -3.789/+9.818/+11.463 |
| Half luma/chroma DC, luminance-dependent HF | -9.931/-2.975/+1.002 | -10.720/+2.681/+8.540 | -6.385/+1.100/+6.499 |
| Half luma DC, 0.75 chroma DC, half HF | -10.291/-5.576/-2.915 | -11.174/+0.143/+4.373 | -6.675/-1.775/+2.414 |
| Half luma DC, source chroma DC, half HF | -8.930/-5.563/-4.641 | -9.836/+0.555/+2.488 | -5.270/-1.766/+0.494 |

Finer DC precision gives a substantially larger SSIM improvement than the filter
changes. This is an allocation tradeoff, not a conversion repair: bitstream
inspection of the three outliers at distances .45/.9/1.85 shows that the original
port's physical DC steps already agree with vips within 0.8%. Halving the steps
preserves the AC field and selected transforms in the focused test. Quartering
them wastes enough rate to worsen all three screen metrics versus halving them.

The combined half-DC/half-HF candidate improves every screen metric over half DC
alone. It supersedes the plain half-DC full run, which terminated with status 143
before producing a summary. Its partial files are preserved and excluded from
full-lab claims. The reason for termination was not established.

## Speed and memory changes

A fresh isolated 64-photo run uses one worker and a fresh process with one timed
encode per engine/image, following the existing lab speed contract. All 192 jobs are newly measured, with no omissions or failures.
Median own time is 1,470.75ms, jSquash 493.33ms and vips 345.02ms: **2.981268x
jSquash**, passing the 3x crop gate, and 4.262740x vips.
Own p90 is 1,568.64ms and worst is 1,723.76ms. The previous standalone checkpoint
was 3.467x jSquash; the archived paired trials below isolate the optimization
from cross-run timing variation. Originals remain unqualified.


Large forward and inverse DCTs dominated the fresh direct-mode profile. The
retained first-party kernels use DCT symmetry to share work between mirrored
samples. The selector's mask now uses one 64x64 tile with a three-pixel halo,
and the initial quantization field can use a three-block-row luma ring.

The optimization-only screen preserves all 80 checkpoint bitstreams byte for
byte. Independent mask and field fixtures cover odd dimensions, thin images,
clamped borders and tile crossings. All 21 transform fixtures agree with the
reference coefficients within 1e-6 and reconstruct within 1e-5.

Two isolated warm comparisons use an archived copy of `98183404`, one warmup
and 15 alternating trial pairs per image. Every pair has identical output bytes.

| Workload, distance 2 | Checkpoint median (ms) | Optimized median (ms) | Paired median change | Wins |
| --- | ---: | ---: | ---: | ---: |
| im26-3012 | 1398.82 | 1238.84 | -11.875% | 15/15 |
| im26-1020 | 1573.18 | 1349.48 | -15.339% | 15/15 |

Baseline/candidate MAD is 48.22/25.66ms on im26-3012 and 49.66/43.59ms on
im26-1020. Corresponding coefficients of variation are 4.65/3.93% and
4.75/4.23%. Raw samples, IQR and paired variation remain in the receipts.
The earlier seven-pair inverse trial had substantial runtime drift; it does
not supply the final speed claim.

Managed peaks stay unchanged on the two byte-identical speed fixtures. The retained
full-lab candidate peaks at 9,632,981 managed bytes and 282,906,624 process RSS bytes. Selector-mask scratch falls from
12 bytes per padded pixel to 54,480 managed bytes. Initial-field luma falls from
4 bytes per padded pixel to at most 96 bytes per padded row width. The scratch sampled once per 4x4 pixels
and the block field still scale with area. Original-image qualification and the 137,514,476-byte ceiling remain separate gates.

## Verification and reproduction

`npm run check` passes all static, packaging and browser-build checks and 4,099
tests, with three existing skips. A later focused batch passes all 72 tests for the final
DC/HF variants, masks and transforms. The retained candidate passes shared
fixtures in Chromium, Firefox and WebKit. Twenty-one independent jxl-rs decodes
of the retained candidate agree with native libjxl within one 8-bit value. Every measured quality point is decoded with native
libjxl before scoring.

No production source, public default, runtime dependency, package version or
bundle limit changes in this continuation. Package verification measures the
unchanged 614,941-byte core/JPEG XL and 687,773-byte specialized bundles.
The peer-forcing hooks inherited from the prior research branch still require
removal or isolation before any main merge.

Raw evidence: `.tmp/jpegxl-lossy-lab/standalone-refine-20261014/`.
`optimized-parity.json` retains all 80 stream comparisons. `cumulative-speed.json`
and `neighbor-speed.json` retain the actual-base paired trials. `dc-decisions.json`
retains the DC-step inspection. The lab log records LL-683 onward; licensing and
source provenance remain in [PROVENANCE.md](../PROVENANCE.md).

```sh
node benchmark/jpegxl/lossy-lab/run.ts \
  --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json \
  --out .tmp/jpegxl-lossy-lab/standalone-refinement-repeat \
  --mode lab --variant standalone-refined-chroma75 --workers 4 \
  --strategy-port standalone-refined-chroma75
```

## Remaining work

The next evidence-driven hypotheses are to examine whether the coherent DC
smoothing policy changes the grain tradeoff, distinguish luma and chroma AC
error in the selector on dark textures, and profile the final selector's slow
crop tail before further pruning. These require fresh screens and full-lab
comparisons; none is a promised fix. Do not tune the holdout or relax coverage,
quality, speed, or memory gates. The original-image and public-bundle cleanup
gates remain required before any merge.
