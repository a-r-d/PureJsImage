# Step C: coherent standalone mode, 2026-10-14

The direct standalone mode passes the aggregate development objective and the
native-map replay gate. It remains on `jxl-libjxl-ports`: isolated crop speed is
3.47x jSquash, above 3x, and three full-band SSIMULACRA2 comparisons against our
control fail the existing per-image guard.
Holdout, original-image qualification and promotion remain closed.

All results below use pixels and distance only. No peer maps, decoded peer
images, native internal probes or runtime dependencies enter the encoder.
The source base for this session is `5cc00559`. Local main remains `b2666b83`.

## Full development lab

64 frozen photographs, nine distances, 576 valid encodes. Negative BD-rate is
better. Metric order is SSIMULACRA2, Butteraugli 3-norm, Butteraugli max.

| Reference | SSIM (%) | 3-norm (%) | Max (%) |
| --- | ---: | ---: | ---: |
| wasm-vips 0.0.19, effort 7 | -2.959 | -4.000 | -4.011 |
| Our unchanged control | -0.791 | -8.642 | -8.074 |
| Native-map replay, coupled no-patches row | -5.772 | -5.181 | -3.868 |
| jSquash 1.3.0, effort 7 | -3.318 | +2.132 | +4.394 |

The vips mean is **-3.657%**, below +2%, and no aggregate metric exceeds +5%.
Every metric is better than native-map replay, satisfying the requirement to
be no more than 1% worse. This is development evidence, not a holdout result.

Three full-band SSIM comparisons against control exceed the +8% guard:

| Image | SSIM BD-rate (%) |
| --- | ---: |
| im26-1468 | +13.584 |
| im26-3012 | +10.243 |
| im26-3302 | +14.087 |

The three largest Butteraugli-max regressions against control are im26-3000
(+33.410%), im26-3302 (+10.696%) and im26-3004 (+9.633%). These are partial-band
comparisons and max is not a per-image promotion gate. Visual inspection at
laboratory distance 1.85 shows loss of fine dark texture on im26-3000; the wall
cracks and pottery detail remain recognizable on the other two. This inspection
does not establish equal-byte quality.

Coverage is limited: direct control comparisons cover the full required band
on 7 SSIM images, 0 3-norm images and 0 max images. Keep all overlap warnings;
do not interpret the remaining comparisons as full-band passes. Exact overlaps,
per-image values and all screen rows are in [STANDALONE-REPORT.json](STANDALONE-REPORT.json).

## Implementation and selector speed work

InitialQuantField runs on the original XYB pixels. It retains floating precision
through transform selection, then AdjustQuantField aggregates each selected
footprint and rounds once for the wire field. InitialQuantDC supplies DC steps.
Optimized inverse Gaborish supplies the selector and coefficient writer.

The full adapted selector, reference transform kernels and unpruned mode remain
available for comparisons. The best mode, `standalone-direct`, uses:

- a bounded 64x64 tile cache for filtered pixels;
- partial-cost pruning using nonnegative channel costs;
- Y-first scoring, with the original X/Y/B accumulation order for survivors;
- complete transform selection within each cached tile;
- direct first-party formulas for small transforms;
- a smaller menu: DCT8, DCT4, DCT2 and Hornuss, with square and rectangular merges
  through 32x32;
- a development-only bypass of our discarded strategy search, with libjxl's
  source Gaborish/EPF defaults replacing the dependent filter decisions.

Our CfL, chroma matrix policy, coefficient rounding and entropy writer remain.
The compact menu is an explicit approximation, not a claim of native selector
parity. Port headers and [PROVENANCE.md](../PROVENANCE.md) identify source files,
commit and adaptations. Existing THIRD_PARTY_NOTICES packaging is unchanged.

| Frozen screen | Vips SSIM / 3-norm / max (%) | Own median ms |
| --- | ---: | ---: |
| Coherent reference | -2.335 / -2.512 / -1.639 | 5272.0 |
| Cache, pruning, tiled traversal | -2.335 / -2.512 / -1.639 | 3618.7 |
| Direct small transforms | -2.335 / -2.512 / -1.639 | 3539.0 |
| Compact selector | -3.209 / -2.945 / -3.598 | 2207.2 |
| Direct preparation and source filters | -4.274 / -4.268 / -4.974 | 1795.8 |

The first two optimized screens preserve all 80 reference streams byte for byte.
The complete direct mode reduces the screen median by 65.94%. These are four-worker
quality-sweep diagnostics, not the isolated 3x gate. A sparse-matrix experiment
showed no meaningful gain and was reverted. Seven alternating warm pairs support
the cache and pruning changes; raw trials include the noisy losing cache pair.

The full-lab timing, 2266.5ms median, overlaps repository verification and must
not be used as isolated performance evidence. Full-lab managed peak is 9,696,469
bytes; observed process peak RSS is 264,654,848 bytes. The unchanged original-image
managed ceiling is 137,514,476 bytes and has not been qualified for this mode.

Fresh isolated speed uses all 64 crops, one worker, our distance 2 and the
established jSquash quality-80 reference at effort 7. All 192 engine jobs pass,
with no cached timing reuse or concurrent test/benchmark jobs.

| Engine | Median encode ms |
| --- | ---: |
| Standalone direct | 1695.843 |
| jSquash 1.3.0 | 489.155 |
| wasm-vips 0.0.19 | 340.202 |

The ratio is **3.467x jSquash**, so the 3x crop speed gate fails. The isolated
managed peak is 9,139,242 bytes. Original-image speed and memory were not run
after the crop and quality guard failures. The current pixel-mask port still
allocates full-image scratch planes; bounding that storage is needed before
original-image qualification. No memory ceiling was raised.

## Flat textures and correctness

At distance 1.85, im26-1020's strong square grid is substantially reduced compared
with control. Im26-3312 is smoother, with less fine grain; im26-3304 appears smooth
at its dark native display level. These same-distance observations do not certify
all distances or equal-byte comparisons.

Every lab stream is decoded with native libjxl before scoring. An additional
18-point jxl-rs check covers the three SSIM guard failures and im26-3304,
im26-3312 and im26-1020 at distances 0.45, 1.85 and 7.5. All agree with libjxl to
within one 8-bit level. Focused tests cover odd dimensions, flat borders,
fractional field precision, filter thresholds, all 21 normative transforms,
cache boundaries and unchanged behavior without a replacement selector.
Chromium, Firefox and WebKit pass the shared Node/browser receipt fixture.
`npm run check` passes all static and browser build gates and 4,081 tests, with
three existing skips. Test duration was 593.34 seconds. Bundles are 614,941 and
687,773 bytes, 45 bytes larger each and below the unchanged 615,000/690,000 limits.

The new production-tree edit only bypasses the old strategy search when the
internal research option supplies a replacement geometry. Public encoding
behavior is unchanged. The existing peer-forcing hooks remain in the public
module graph and must be removed or isolated before any main merge.

## Evidence and reproduction

Raw root: `.tmp/jpegxl-lossy-lab/standalone-20261014/`.
Research log: LL-670 onward in [lossy-lab-log.md](../lossy-lab-log.md).

```sh
node benchmark/jpegxl/lossy-lab/run.ts \
  --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json \
  --out .tmp/jpegxl-lossy-lab/standalone-repeat \
  --mode lab --variant standalone-direct --workers 4 \
  --strategy-port standalone-direct
```

`reference-screen`, `optimized-screen`, `fast-screen`, `compact-screen`,
`direct-screen` and `direct-lab` retain every result. The report generator consumes
their paired control and replay comparisons. `profile-before`, `profile-tiled`,
`cache-speed.json`, `prune-speed.json` and byte-parity receipts retain the speed
investigation. `independent/receipt.json` records the extra decoder checks.
`direct-speed/summary.json` is the fresh isolated speed qualification, also
embedded in the committed JSON report.

Next hypotheses, in order: preserve weak texture in the initial quantization
field without losing the Butteraugli gain; bound and reuse pixel-mask storage;
reduce the remaining large-transform scoring cost. No port was promoted in
this session, and main was not changed.
