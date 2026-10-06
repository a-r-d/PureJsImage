# JPEG XL original-size photo compression, October 6, 2026

## Quick answer

The original 4000 × 3000 photo now uses fewer bytes than both pinned WASM
encoders at matched SSIMULACRA2 70, 80 and 90. PureJsImage is 4–13% smaller
than jSquash and 3–15% smaller than wasm-vips. Butteraugli still shows
tradeoffs. This establishes compression parity for these three SSIMULACRA2
targets on one original-size photo.

## Matched quality on the original input

The input is the original `im26-1416-original` RGBA8 photo with exact opaque
alpha. It contains 12 million pixels and has not been resized. Its raw
SHA-256 is `929b9e7363d25b1a8c4a6d2f8381786597bc14b4d718cd7af1b641fda446e959`.
The public peers remain `@jsquash/jxl` 1.3.0 and `wasm-vips` 0.0.19.
All encoders use effort 7 through their existing public APIs.

| SSIMULACRA2 | Previous PureJsImage bytes | Current bytes | jSquash bytes | wasm-vips bytes | Versus jSquash | Versus wasm-vips |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 70 | 373,671 | 272,865 | 302,681 | 309,139 | 9.85% smaller | 11.73% smaller |
| 80 | 654,977 | 541,839 | 564,888 | 557,876 | 4.08% smaller | 2.87% smaller |
| 90 | 1,671,874 | 1,432,712 | 1,639,897 | 1,686,911 | 12.63% smaller | 15.07% smaller |

Byte counts are log-byte interpolated estimates rounded for display. The
original nondominated frontier, maximum 0.25-score bracket width, shared
24-point budget per participant and no-extrapolation rule remain unchanged.
The current PureJsImage curve uses 15 measured points. Its three selected
brackets are 0.14832, 0.20429 and 0.11217 scores wide. All inversions remain
in the [raw quality study](results/original-photo-quality-study.json).

The first wasm-vips sweep aborts at distance 4. That failure reproduces in
a fresh process and remains recorded. Native libjxl results guide later
settings only. Six actual wasm-vips files encoded in separate fresh
processes supply the successful target brackets. Every peer size and
quality metric in the table comes from the public WASM encoder. Native
libjxl sizes are excluded from these comparisons.

## Quality tradeoffs

Butteraugli is recorded for every actual endpoint. Around SSIMULACRA2 70,
current PureJsImage has Butteraugli near 3.05 while jSquash is near 2.82.
Around score 80, PureJsImage is near 2.1 and jSquash near 1.84. Around
score 90, PureJsImage is near 0.98 versus about 0.8 for jSquash and 0.9
for wasm-vips. These are measured endpoint comparisons rather than an
interpolated Butteraugli ranking. Lower Butteraugli is better.

The table establishes fewer bytes at matched SSIMULACRA2. It does not
establish two-metric dominance or an overall quality lead. The separate
[capped photo](PHOTO-PARITY.md), [graphic](GRAPHIC-POINTS.md) and
[transparency](ALPHA-POINTS.md) studies keep their own inputs and protocols.
Other original-size photos, HDR, float, CMYK and animation still need
separate compression evidence.

## Encoder correction and verification

The first-party effort-7 encoder previously stopped using the opaque RGB
DC precision policy above 4,194,304 pixels. Larger opaque RGBA8 photos
therefore used coarser DC precision and omitted the photo filter map.
This reduced quality at a given distance setting and required more AC
data to reach a matched score.

The optional compression search now extends that existing policy to
16,777,216 pixels. It retains the same sRGB, 8-bit opaque RGBA, distance
above 1 and more-than-2,048-visible-colors checks. An optional allocation
failure retries with compression search disabled and restores the prior
large-image path. Larger transforms and coarse AC rounding retain their
separate four-megapixel limit. No external encoder implementation is
copied or used at runtime.

The [production controls](results/original-photo-production-controls.json)
freshly encode all six selected PureJsImage endpoints through the complete
public package. Their files match the independently qualified streams byte
for byte. Caller storage remains unchanged and managed live ownership
returns to zero. Both complete JPEG XL packages grow by 20 bytes, fit their
existing 554,000/627,000-byte ceilings and retain all exports.

The [endpoint qualification](results/original-photo-endpoint-qualification.json)
contains 18 complete endpoint files and 36 native/Rust floating grids.
It checks every finite sample, exact alpha, complete public JavaScript
coverage and agreement within one 8-bit code. All 288 million public
decoded samples are checked. PNG hashes and both quality metrics reproduce
exactly. Production controls rehash every physical qualification pin and
count reused grids separately from fresh encodes.

The permanent 2049 × 2048 gradient regression crosses the old cutoff.
Its 91,497-byte file retains exact alpha and independently qualified colors
within a 64 MiB working budget. Forced optional filter-map failure recovers
the qualified 66,242-byte prior file and releases all managed allocations.
Real-browser and repository handoff results are recorded in the optimization
log. These diagnostic runs do not establish speed or process-RSS parity.

## Reproduction

With the pinned inputs, raw studies and development oracles prepared:

```sh
node benchmark/jpegxl/comparison/verify-original-photo-compression.ts .tmp/original-photo-compression.json
npx vitest run tests/jpegxl-dc-model.test.ts
npx playwright test browser-tests/jpegxl-pipeline.pw.ts --workers=1 --grep 'above four megapixels|large opaque allocation recovery'
```

Raw bitstreams, metric images, independent grids, copied first-party
experiments and package builds stay ignored. The maintained studies record
their hashes and preserve unsuccessful attempts.
