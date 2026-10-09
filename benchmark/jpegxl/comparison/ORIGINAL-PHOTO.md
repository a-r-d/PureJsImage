# JPEG XL original-size photo compression, October 8, 2026

## Quick answer

On the original 4000 × 3000 photo, PureJsImage uses fewer bytes than both
pinned WASM encoders at matched SSIMULACRA2 70, 80 and 90. It also uses fewer
bytes than jSquash at all four matched Butteraugli targets and wasm-vips at
its two resolved targets; two wasm-vips targets remain unresolved under the
unchanged rules. Parity applies to the resolved targets on this photo;
broader compression and quality rankings require separate evidence.
The later [portrait baseline](ORIGINAL-MATRIX.md) exposes remaining
Butteraugli size gaps, so this photo's result does not establish overall
lossy parity.

## Latest fine-photo update

The qualified portrait curve uses an estimated 2,562,127 bytes at matched
Butteraugli 0.5, 0.09% fewer than pinned jSquash and 15.25% fewer than pinned
wasm-vips. The independent 12 MP photo uses 2,451,585 bytes, 1.34% fewer than
jSquash and 17.99% fewer than wasm-vips. These are rounded log-byte interpolated
estimates from complete public files, with unchanged 0.25-unit brackets and no
extrapolation. Peer encoders were not rerun.

| Input | Butteraugli | PureJsImage bytes | jSquash bytes | wasm-vips bytes |
| --- | ---: | ---: | ---: | ---: |
| 2400 × 3000 portrait | 0.5 | 2,562,127 | 2,564,399 | 3,023,095 |
| 4000 × 3000 photo | 0.5 | 2,451,585 | 2,484,904 | 2,989,288 |

The [fine-photo controls](results/original-fine-production-controls.json) record
the qualified public files, source/package equivalence and protected SSIMULACRA2-90
comparison. The portrait's matched SSIMULACRA2-90 estimate is 2,008,483 bytes,
2.53% below the preceding result, 4.50% below jSquash and 10.40% below wasm-vips.
Four BA-0.5 endpoint files and two SSIM90 endpoint files have twelve complete
native/Rust grids and 211,200,000 checked public samples. Alpha is exact,
caller data is unchanged and encoder
and replay ownership closes. Public block releases and independent source-session
ownership evidence retain their separate scopes.

Fine allocation requires variation in the existing source importance scores. Inputs with nearly uniform source scores keep the preceding fine-quality path. All six published photo settings remain admitted. Their original files, decoder grids and quality scores are reused through an exact admission-only source bridge. The corrected complete packages are measured separately and remain within the original size ceilings. No photo was reencoded and no photo metric was refreshed for this guard correction.

The latest [portrait matrix](ORIGINAL-MATRIX.md) retains five confirmed size
gaps: Butteraugli 1 against both peers, Butteraugli 2 against jSquash and
Butteraugli 3 against both peers. Its qualified current coarse estimate is
385,082 bytes at Butteraugli 3. The current portrait SSIMULACRA2-70 comparison
remains unresolved. This page's earlier source-specific tables stay unchanged;
no overall lossy parity or new speed/RSS result is claimed.

## Earlier matched-quality checkpoint on the original input

The input is the unresized `im26-1416-original` RGBA8 photo with exact opaque
alpha. It contains 12 million pixels. Its raw SHA-256 is
`929b9e7363d25b1a8c4a6d2f8381786597bc14b4d718cd7af1b641fda446e959`.
The public peers are `@jsquash/jxl` 1.3.0 and `wasm-vips` 0.0.19. All encoders
use effort 7 through their public APIs.

| SSIMULACRA2 | Previous main bytes | Current bytes | jSquash bytes | wasm-vips bytes | Versus jSquash | Versus wasm-vips |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 70 | 272,865 | 271,113 | 302,681 | 309,139 | 10.43% smaller | 12.30% smaller |
| 80 | 541,839 | 513,039 | 564,888 | 557,876 | 9.18% smaller | 8.04% smaller |
| 90 | 1,432,712 | 1,424,884 | 1,639,897 | 1,686,911 | 13.11% smaller | 15.53% smaller |

Higher SSIMULACRA2 is better. Lower Butteraugli is better. Each metric uses
its own nondominated frontier and matched targets:

| Butteraugli | PureJsImage bytes | jSquash bytes | wasm-vips bytes | Versus jSquash | Versus wasm-vips |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0.5 | 2,482,443 | 2,484,904 | 2,989,288 | 0.10% smaller | 16.96% smaller |
| 1 | 1,276,115 | 1,291,165 | 1,396,748 | 1.17% smaller | 8.64% smaller |
| 2 | 489,411 | 521,032 | Unresolved | 6.07% smaller | Unresolved |
| 3 | 239,867 | 249,307 | Unresolved | 3.79% smaller | Unresolved |

Byte counts are log-byte interpolated estimates rounded for display, rather
than files encoded at an exact target. Both sides must bracket the target
within 0.25 metric units. The fixed budget remains 24 attempted settings per
unchanged source, participant and fixture. There is no extrapolation.
The current PureJsImage curve has 16 measured points. Its SSIMULACRA2
brackets are 0.13974, 0.12144 and 0.19239 scores wide. Its Butteraugli
brackets are 0.02274, 0.04096, 0.01427 and 0.20821 units wide.
All points, inversions and failed attempts remain in the
[quality study](results/original-photo-quality-study.json).

The wasm-vips budget is exhausted. Its Butteraugli-2 bracket is 0.27216
units wide, and its measured frontier does not bracket Butteraugli 3.
Its public WASM failures remain recorded. Native libjxl measurements guide
settings only; every peer size in the tables comes from the public WASM
encoder. Native encoder sizes never replace a missing comparison.

The two tables show size parity at separately matched quality targets.
They do not show that one file dominates both metrics simultaneously.
The separate [capped photo](PHOTO-PARITY.md), [graphic](GRAPHIC-POINTS.md)
and [transparency](ALPHA-POINTS.md) studies keep their own protocols.
Other original-size photos, HDR, float, CMYK and animation need separate
matched compression evidence.

## Encoder changes and verification

The first-party regular effort-7 encoder now extends its opaque-photo search
to standard-sRGB RGBA8 images above 4,194,304 and through 16,777,216 pixels,
with more than 2,048 visible colors. Fine-quality encoding uses local texture
and brightness to allocate quantization and AC precision. Larger distance
settings use refined DC precision, aligned DCT16 choices and rate-aware AC
rounding. The new entropy search clusters AC histograms with 24 iterations
and compares sixteen legal hybrid-integer configurations per histogram.

Entropy selection compares all serialized section bytes and their aligned
table-of-contents cost against the previous model. Ties retain the previous
stream. Optional working-storage failure recovers the completed baseline;
other errors and cancellation propagate. Per-encode histograms, local maps,
scratch and compressed alternatives count against `maxWorkingBytes`. The
additional cached hybrid lookup is bounded to 32 KiB. This adds encoding
work and does not establish speed or process-RSS parity. The implementation
is first-party TypeScript with no runtime encoder dependency.

The [production controls](results/original-photo-production-controls.json)
freshly encode all 14 selected PureJsImage endpoints through the complete
public package. Their streams match the qualified candidate files byte for
byte. Caller storage remains unchanged and managed live ownership returns
to zero. Both complete public packages also match the qualified package
hashes and retain all exports. The codec bundle grows by 3,531 bytes to
557,220 bytes; the specialized bundle grows by 3,734 bytes to 629,860 bytes.
Their canonical ceilings rise explicitly to 558,000 and 631,000 bytes.

The [endpoint qualification](results/original-photo-endpoint-qualification.json)
contains 37 selected endpoint files and 74 complete native/Rust floating
grids: 14 PureJsImage, 14 jSquash and nine wasm-vips files. All 16 current
PureJsImage curve points have fresh complete independent grids and public
pixel checks, covering 768 million public samples. Selected production
qualification reuses 74 pinned grids and 672 million public samples,
counted separately from fresh encodes. Every finite sample is checked,
alpha is exact, and native/Rust/public agreement stays within one 8-bit
code. Metric PNG hashes and both quality scores reproduce exactly.

The permanent 2049 × 2048 gradient regression crosses the old image-size
cutoff. Its coarse result shrinks from 91,497 to 52,620 bytes while retaining
the original color-error ceiling. Its fine-quality result is 1,409,128
bytes. Both retain exact alpha within the original 64 MiB working budget.
Forced optional allocation failures recover the qualified prior streams,
66,242 and 1,490,466 bytes, and release all managed allocations. The public
fine-quality baseline adds a 40-byte container around the identical raw
codestream; decoded pixels are identical.

Three additional [original-size controls](results/original-lossy-heldout-controls.json)
cover a 2400 × 3000 portrait at
distance 0.54, a 4000 × 3000 tundra photo at 1.25, and a 2400 × 2400
Earthrise photo at 6.3. Their six complete independent grids and all
99,840,000 public samples pass with exact alpha and one-code color tolerance.
These are fixed-setting correctness controls without matched peer curves.
They do not extend the compression-parity claim to those photos.
Real-browser and repository handoff results are recorded in the optimization
log.

## Reproduction

With the pinned inputs, raw studies and development oracles prepared:

```sh
node benchmark/jpegxl/comparison/verify-original-photo-compression.ts .tmp/original-photo-compression.json
npx vitest run tests/jpegxl-dc-model.test.ts tests/jpegxl-ac-entropy-floor.test.ts tests/jpegxl-original-lossy-bands.test.ts
npx playwright test browser-tests/jpegxl-pipeline.pw.ts --workers=1 --grep 'above four megapixels|large opaque allocation recovery|fine opaque texture|AC compression floor'
```

Raw bitstreams, metric images, independent grids, copied first-party
experiments and package builds stay ignored. The maintained studies record
their hashes and preserve unsuccessful attempts. The historical
[SSIM endpoint qualification](results/original-photo-ssim-endpoint-qualification.json)
retains the earlier peer proof used by the current study.
