# AVIF compatibility survey — 2026-08-10

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
in [`avif-compatibility-survey-2026-08-10.json`](avif-compatibility-survey-2026-08-10.json).

A completed decode in this survey means that the decoder emitted all rows without an exception. It
is compatibility evidence, not an independent pixel oracle. Pixel correctness remains gated by the
checksum-pinned dav1d, libaom, FFmpeg, Sharp, and Chromium fixtures in the AVIF test suite.

## Results

| Source | Files | Completed decode | Explicit error |
|---|---:|---:|---:|
| Imazen AVIF Conformance | 137 | 73 | 64 |
| GB82 common-photo matrix | 100 | 100 | 0 |
| **Total** | **237** | **173 (73.0%)** | **64** |

Conformance categories:

| Declared category | Files | Completed decode | Explicit error |
|---|---:|---:|---:|
| Valid | 106 | 60 | 46 |
| Invalid | 12 | 1 | 11 |
| Edge cases | 19 | 12 | 7 |

The one decoded file in the corpus's `invalid` directory is `wrong_brand.avif`; the byte stream
contains a decodable AVIF item despite its intentionally wrong file brand. The decoder does not use
that result as evidence that the declared invalid container is a conforming AVIF file.

Common-photo encoders:

| Encoder/muxer | Files | Completed decode | Explicit error |
|---|---:|---:|---:|
| Sharp/libvips/libaom | 50 | 50 | 0 |
| FFmpeg/libaom | 50 | 50 | 0 |

## Failure taxonomy

| Boundary | Conformance | Common photo | Total |
|---|---:|---:|---:|
| Unsupported AV1 or container feature | 35 | 0 | 35 |
| Malformed or unsupported container | 11 | 0 | 11 |
| Animation | 8 | 0 | 8 |
| 64 MiB working-set limit | 4 | 0 | 4 |
| Film grain | 2 | 0 | 2 |
| Alpha auxiliary subset | 2 | 0 | 2 |
| Entropy or reconstruction syntax | 1 | 0 | 1 |
| Presentation transform | 1 | 0 | 1 |

The sole remaining entropy/reconstruction error is the conformance corpus's intentionally invalid
`corrupted_mdat.avif`. No common-photo input terminates in an arithmetic-symbol or tile-padding
error. Strict tile-termination validation remains enabled.

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

## Implemented blockers: coefficient-skip and palette contexts

Coefficient all-zero signaling now derives its context from the full coded luma or chroma block
rather than the bounded 64x64 luma or 32x32 chroma reconstruction chunk. Palette-mode signaling now
retains the above palette-size context across a 64-pixel row boundary; the separate superblock-local
palette-cache rule remains unchanged.

These two state corrections newly complete 46 survey inputs: all 31 previous common-photo failures
and 15 conformance inputs. All 116 previously completed RGBA checksums are unchanged. The three
permanent `diagnostic-*.avif` fixtures cover FFmpeg/libaom YUV 4:2:0 and 4:4:4 plus
Sharp/libvips/libaom YUV 4:2:0. PureJsImage, dav1d, and libaom agree byte for byte over each
fixture's visible native YUV, and their public RGBA checksums are pinned in Node.js and Chromium.

## Implemented blocker: still-picture intra-block-copy state

Four Microsoft conformance inputs that previously ended as arithmetic-symbol or tile-termination
errors now complete strict tile termination. The underlying divergence was earlier: intra-block-copy
blocks used transform dimensions instead of their full block dimensions for neighboring transform
contexts, selected only one immediate reference motion instead of the normative weighted candidate
stack, and copied subsampled chroma without bilinear interpolation when an integer luma motion vector
lands between chroma samples.

The pinned 1280x720 reduced-header, 1280x720 full-header, and 3840x2160 full-header fixtures match
agreeing dav1d and libaom visible native YUV byte for byte. The decoder still rejects invalid trailing
bits; it does not relax arithmetic-symbol or tile-padding validation.

## Implemented blockers: SDR color management and HDR gain maps

The decoder now converts the independently verifiable color subset to its public sRGB output:
linear and extended-sRGB NCLX transfer functions, linear BT.2020 NCLX primaries, and compatible
RGB matrix/TRC ICC profiles. PQ and HLG still fail before SDR pixel conversion when no compatible
gain-map alternate is selected.

ISO 21496-1 gain-map metadata and `altr` entity groups are parsed from the AVIF container. Compatible
single-channel, same-size, 8-bit coded gain maps are decoded in bounded rows and composed in linear
light. The pinned HDR-base/SDR-alternate fixture agrees with libavif 1.3.0 within maximum channel
error 4 and mean channel error 1. The swapped-order `altr` edge case is rejected instead of applying
an inactive `tmap`. Gain-map grids, resampling, alpha, and color conversion outside the supported
NCLX subset remain explicit errors.

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
  --output benchmark/results/avif-compatibility-survey-2026-08-10.json
npm run fixtures:avif:common-photo-syntax
npm run fixtures:avif:nonstill-sequence
npm run fixtures:avif:still-picture-entropy
npm run fixtures:avif:color
```

The survey is intentionally broader than the published decoder claim. PQ/HLG without a compatible
gain-map alternate, broader wide-gamut and ICC color management, animation, encoding, general inter
frames, and the unsupported syntax classes above remain outside the public capability boundary.
