# AVIF compatibility survey — 2026-08-09

## Scope

This survey exercises 237 AVIF files against the first-party TypeScript decoder:

- 137 files from `imazen/codec-corpus` AVIF Conformance at revision
  `28205bbc5cf40364d012c462240ba28143373d67` (106 valid, 12 invalid, 19 edge cases);
- 100 common-photo files generated from the 25 CC0 GB82 images: each source was encoded as
  Sharp 0.35.3/libvips 8.18.3/libaom 3.14.1 q50 YUV 4:2:0, Sharp q80 YUV 4:4:4,
  FFmpeg/libaom CRF 30 YUV 4:2:0, and FFmpeg/libaom CRF 45 YUV 4:4:4.

`benchmark/avif/prepare-compatibility-survey.ts` generates the common-photo matrix.
`benchmark/avif/run-compatibility-survey.ts` records every input checksum, result, normalized error
class, output dimensions, RGBA checksum for successful decodes, and wall time. The full results are
in [`avif-compatibility-survey-2026-08-09.json`](avif-compatibility-survey-2026-08-09.json).

A completed decode in this survey means that the decoder emitted all rows without an exception. It
is compatibility evidence, not an independent pixel oracle. Pixel correctness remains gated by the
checksum-pinned dav1d, libaom, FFmpeg, Sharp, and Chromium fixtures in the AVIF test suite.

## Results

| Source | Files | Completed decode | Explicit error |
|---|---:|---:|---:|
| Imazen AVIF Conformance | 137 | 47 | 90 |
| GB82 common-photo matrix | 100 | 69 | 31 |
| **Total** | **237** | **116 (48.9%)** | **121** |

Conformance categories:

| Declared category | Files | Completed decode | Explicit error |
|---|---:|---:|---:|
| Valid | 106 | 37 | 69 |
| Invalid | 12 | 1 | 11 |
| Edge cases | 19 | 9 | 10 |

The one decoded file in the corpus's `invalid` directory is a gain-map-version case. PureJsImage
currently ignores gain-map semantics rather than claiming gain-map support; it is not counted as
proof that the invalid gain map is accepted semantically.

Common-photo encoders:

| Encoder/muxer | Files | Completed decode | Explicit error |
|---|---:|---:|---:|
| Sharp/libvips/libaom | 50 | 46 | 4 |
| FFmpeg/libaom | 50 | 23 | 27 |

## Failure taxonomy

| Boundary | Conformance | Common photo | Total |
|---|---:|---:|---:|
| Entropy or reconstruction-syntax divergence | 17 | 31 | 48 |
| High-bit-depth subset | 19 | 0 | 19 |
| Alpha auxiliary subset | 15 | 0 | 15 |
| Multiple-frame or tile-group layout | 13 | 0 | 13 |
| Animation | 8 | 0 | 8 |
| Malformed or unsupported container | 7 | 0 | 7 |
| Intra-block-copy residuals | 5 | 0 | 5 |
| Film grain | 2 | 0 | 2 |
| 64 MiB working-set limit | 2 | 0 | 2 |
| Presentation transform | 1 | 0 | 1 |
| Other unsupported AV1/container feature | 1 | 0 | 1 |

The 48 entropy/reconstruction failures are the next common-photo priority. Their terminal errors
(`symbol decoder over-read`, missing trailing one bit, or nonzero trailing padding) show arithmetic
state divergence, not three independent trailing-bit features. They must be reduced to the first
incorrect partition, mode, transform, coefficient context, or CDF update before changing the strict
tile-termination checks.

## Implemented blocker: non-still sequence headers

The survey identified 23 inputs whose AV1 sequence header clears `still_picture`. The decoder now
accepts that sequence form only when the coded item still resolves to the existing restricted
single shown key frame with maximum frame dimensions. Multiple frames, show-existing-frame,
inter-frame, decoder-model timing, and non-maximum frame dimensions remain explicit errors.

This change newly completes eight static survey cases, including Microsoft Chimera, Irvine, Mexico
YUV 4:2:0 and 4:4:4, and Kids files plus Apple single-layer/unknown-property cases. The pinned
`ms-mexico-nonstill-sequence.avif` regression reconstructs
`da3ba1342d9d5c317b6f1878af2260e74c191f5aee245b988170f7ce59c132a4`; PureJsImage, dav1d,
and libaom agree byte for byte over all 3,110,400 visible native-YUV bytes.

The `avis` sequence brand is rejected for pixel decode with `UNSUPPORTED_OPERATION`. This prevents
the new sequence-header support from silently presenting a primary item as if animated AVIF were a
supported one-frame format. Metadata inspection still detects the sequence brand without claiming a
false frame count.

## Reproduction

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/imazen/codec-corpus.git /tmp/purejsimage-codec-corpus
git -C /tmp/purejsimage-codec-corpus sparse-checkout set avif-conformance gb82
npm run bench:avif:compatibility:prepare -- \
  --source /tmp/purejsimage-codec-corpus/gb82 \
  --output /tmp/purejsimage-common-avif
npm run bench:avif:compatibility -- \
  --source conformance=/tmp/purejsimage-codec-corpus/avif-conformance \
  --source common-photo=/tmp/purejsimage-common-avif \
  --output benchmark/results/avif-compatibility-survey-2026-08-09.json
npm run fixtures:avif:nonstill-sequence
```

The survey is intentionally broader than the published decoder claim. HDR/PQ/HLG policy, wide-gamut
color management, animation, encoding, gain maps, general inter frames, and the unsupported syntax
classes above remain outside the public capability boundary.
