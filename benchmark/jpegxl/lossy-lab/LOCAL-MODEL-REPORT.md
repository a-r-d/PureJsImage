# Dithered reconstruction and bounded perceptual scoring

Research branch `jxl-libjxl-ports`, base `abad8e49`, 2026-10-28.
Entries LL-1006 through LL-1011. Main and the holdout are unchanged.

Ordered output dithering explains nearly all the earlier one-code-value pixel
mismatch. Our diagnostic reconstruction now predicts every material quality
direction in the fixed 80-pair screen. A bounded driver preserves the reference
map and costs much less than full-image scoring, but remains too slow for every
selector candidate. A first offline joint-RD replay matches native ranking on
the saved one-image intervention cohort. No encoder policy is promoted.

## Reconstruction

The pinned libjxl `MakeUnsigned` stage adds a 32x32 dither before rounding
8-bit output, with channel offsets `(23*c, 13*c)`. The diagnostic port retains
the table, scalar float arithmetic and ties-to-even rounding. It removes SIMD
padding and accepts crop origins so the pattern stays aligned. Public decoder
output is unchanged. The source header, PROVENANCE.md and THIRD_PARTY_NOTICES
record the BSD-3 port and the original [CC0 texture attribution](https://momentsingraphics.de/BlueNoise.html#Downloads).

First replay the 16 screen pairs at distance 1.85. Then apply the unchanged
formulas to the guarded/low rounding modes at distances 2 and 4, giving 64
additional pairs and both quality directions. Metrics are computed from our
reconstructed pixels; native labels are validation data only. Repeated control
states are deduplicated in the pixel-error counts below.

| Set | Distinct states | Ordinary-rounding sample mismatches | Dithered sample mismatches | Largest dithered max-score error | Largest dithered 3-norm error |
| --- | ---: | ---: | ---: | ---: | ---: |
| d1.85 endpoint pairs | 32 | 6,146,036 | 1,285 | 0.000009384 | 0.000032415 |
| d2/d4 guarded/low pairs | 96 | 18,488,077 | 3,704 | 0.000192639 | 0.000024058 |

Every remaining differing sample is within one code value. The remaining
float/transfer/reconstruction differences are not claimed to be bit-exact.

| Set and reconstruction | Material max signs | Material 3-norm signs | Missed max harms above 1% |
| --- | ---: | ---: | ---: |
| d1.85, ordinary rounding | 2/3 | 4/4 | 0 |
| d1.85, dithered | 3/3 | 4/4 | 0 |
| d2/d4, ordinary rounding | 46/52 | 50/51 | 2 |
| d2/d4, dithered | 52/52 | 51/51 | 0 |

Dithered reconstruction gets all 69 nonzero max directions and all 74 nonzero
3-norm directions right across the 80 pairs. The second set supplies enough
material changes to pass the predeclared diagnostic gate. It does not replace
native lab scoring or the promotion gates. In particular, none of this is an
SSIMULACRA2 predictor.

## Bounded regions

The maximum fine-scale input support is 37 pixels: local adaptation 2, LF blur
16, MF blur 7, HF blur 3, mask blur 6 and erosion 3. Directional stencils have
smaller combined support. Half-resolution sampling reaches at most 75 source
pixels. The driver uses a conservative 76-pixel halo and even crop origins to
preserve the sampling phase. No radius or coefficient was fitted to quality.

Requested windows are at most 256x256; working crops are therefore at most
410x410 regardless of original dimensions. The driver still accepts an existing
RGBA image as input. This does not establish a bounded encoder input pipeline.

An odd-sized synthetic fixture compares interior and edge windows directly with
the full reference within 1e-10. On all 16 d1.85 screen photos, three fixed 32x32
windows cover a corner, an odd-coordinate interior and the opposite corner.
All 96 endpoint-window maps differ from native by at most 0.000061639. Local
sign counts are only 3/3 max and 5/5 3-norm; these correlated windows are fidelity
evidence, not a new independently validated quality predictor.

### Isolated cost

Eleven pairs alternate full/local evaluation order. Source preparation is
outside the repeated scoring measurements and is reported separately. Every
regional value matches the corresponding full map within 1e-10.

| Photo | Full-map median | 32x32 median | Paired local/full ratio | 192x192 median | Paired local/full ratio |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-3012 | 1100.019 ms | 145.454 ms | 0.132165 | 507.683 ms | 0.461434 |
| im26-3312 | 1171.649 ms | 152.797 ms | 0.131752 | 551.299 ms | 0.458355 |

Each local variant wins 11/11 pairs on each photo. Ratio MAD is 0.000473/0.001217
for 32x32 and 0.002599/0.012178 for 192x192. Source preparation adds about
99-103 ms and 337-344 ms respectively before reuse. These are diagnostic-kernel
measurements, not encoder speed improvements.

Three fresh processes per mode measure cold scoring and a second call after
explicit GC. The median largest observed process-local VmHWM through both calls
is 211,688 KiB for full, 113,460 KiB for 32x32 and 153,228 KiB for 192x192.
Some VmHWM readbacks decreased after GC; retain the largest observed sample
and every raw reading. Post-GC ArrayBuffers are 33,652,774 / 6,347,014 /
16,561,414 bytes and stay identical before and after the warm call in every
process. External memory is also recorded. These measurements include Node,
PNG input and diagnostic state, and do not qualify encoder memory.

A fresh CPU profile assigns 38.493% of samples to directional sums and 34.611%
to Gaussian filtering. The driver computes complete cropped maps, then copies
out a small requested window. Next remove unnecessary output work and use
separate fine/coarse support before attempting selector integration.

## First joint-RD replay

Use the frozen im26-2004 distance-1.85 cohort: control, the full rejected change,
15 local coefficient subsets and 30 individual changes. All 47 stream hashes
and byte lengths are checked. Selection uses only our dithered reconstruction
scores and actual serialized bytes:

```text
cost = log(bytes / controlBytes)
     + lambda * mean(log(max / controlMax), log(norm3 / controlNorm3))
```

Fix lambda at 0.5, 1, 2 and 4 before running. Native quality labels are consulted
only after selection, to measure regret and report SSIMULACRA2. Unpadded color
bits are also reported, but the objective uses the actual complete-file size.

All four settings select `single-21`, the same state selected by native scores.
Measured regret is zero in this cohort. It saves 30 bytes and 238 color bits,
leaves native max unchanged, raises native 3-norm by 0.001110%, and improves
SSIMULACRA2 by 0.002003 points. The saving is about 0.065% of this one stream.
It is not a BD-rate result, a new standalone encoding mode, or a speed-gate pass.
The candidates are correlated and limited to the previously saved changes.

The replay establishes that rate and reconstructed perceptual cost can select
the same small intervention as the native oracle. Production feasibility still
requires much cheaper scoring, broader candidate coverage, a standalone policy
that generates its own decisions, and all three native quality gates.

## Reproduction

Raw evidence is in `.tmp/jpegxl-lossy-lab/local-model-20261028`.
Use a different fresh OUTPUT directory for each command.

```sh
node benchmark/jpegxl/lossy-lab/audit-output-dither.ts OUTPUT rate
node benchmark/jpegxl/lossy-lab/audit-output-dither.ts OUTPUT rounding
node benchmark/jpegxl/lossy-lab/audit-local-perceptual-region.ts OUTPUT
node --expose-gc benchmark/jpegxl/lossy-lab/time-local-perceptual-region.ts OUTPUT im26-3012
node --expose-gc benchmark/jpegxl/lossy-lab/time-local-perceptual-region.ts OUTPUT im26-3312
node benchmark/jpegxl/lossy-lab/replay-joint-rd.ts OUTPUT
VITEST_MAX_WORKERS=4 npx vitest run tests/jpegxl-output-dither.test.ts tests/jpegxl-local-perceptual-region.test.ts
```

Timing commands require an idle measurement interval. Their JSON records input
and implementation hashes, Node version, every paired sample and parity checks.
The raw directory also preserves the table extraction script, memory probes,
CPU profile, native comparison summaries and complete check logs.

## Retained encoder and merge boundary

`VITEST_MAX_WORKERS=4 npm run check` passes: 4,199 tests, three existing skips,
336 passed files and one skipped file. Test phase 540.35s; complete check
584.631s. Chromium, Firefox and WebKit fixtures pass in 17.8s. Three new focused
tests pass independently. Native comparison, exact regional parity, isolated
timing and all 47 intervention stream/hash/cost checks pass. No new diagnostic
module is imported by src, and runtime dependencies remain zero. Complete
logs and summaries are preserved in the raw directory.

There is no active encoder or public decoder behavior change. The retained
full-development rates remain -8.003/-5.030/-5.582% against vips and
-8.474/+0.227/+2.571% against jSquash (SSIMULACRA2/3-norm/max).
Prior speed, memory and bundle measurements are carried forward, not newly
qualified. The two SSIM holdout guards remain unresolved. No holdout input was
read, no parameter was tuned from it, and no merge or promotion was attempted.
