# AVIF common opaque 8-bit 4:2:0 photographs — August 7, 2026

PureJsImage now decodes both full-size opaque 8-bit YUV 4:2:0 photographs in
the permanent AVIF corpus through the public `Image.open(...).png().toBuffer()`
workflow. The codec remains first-party strict TypeScript with no production
dependencies, native modules, or WASM.

## Compatibility added

- 64x64 and 128x128 AV1 superblocks;
- the intra `NONE`, `SPLIT`, horizontal, vertical, horizontal-4, vertical-4,
  and tip-split partition tree;
- all directional intra modes and angle deltas, smooth, Paeth, filter-intra,
  and chroma-from-luma prediction;
- exact structural top-right and bottom-left transform-edge availability;
- square and rectangular transforms through 64x64, with the AV1 coefficient
  context retaining the original rectangular orientation when the coefficient
  plane is capped at 32 samples;
- quantizer-context 2 and 3 coefficient reconstruction; and
- parsing of switchable Wiener and self-guided restoration-unit syntax.

## Permanent fixtures

| Fixture | Dimensions | Result | RGBA regression |
| --- | ---: | --- | --- |
| `kodim03_yuv420_8bpc.avif` | 768x512 | decoded | `8247dea62ef7bcb2a4508f2b4ebe55bee4aae63514eaf13c8c4a559527f44f98` |
| `fox.profile0.8bpc.yuv420.avif` | 1204x800 | decoded | `bc447990c95f074c8c1aa7cc9cac7b7fd0b262769a42d70457cfa86f454a7e75` |

The regression hashes cover the public RGBA result rather than the compressed
PNG bytes, so PNG encoder changes do not invalidate codec correctness tests.

## Local benchmark

Command:

```sh
npm run bench:avif:b2
```

Environment: Node.js 24.16.0, forced GC before each run, five public
AVIF-to-PNG runs per photograph.

| Fixture | Median wall time |
| --- | ---: |
| Kodak | 294.825 ms |
| Fox | 782.865 ms |

Maximum observed process RSS across the photo benchmark was 143.8 MiB. This is
an in-process high-water mark, not an isolated codec allocation measurement.
The permanent 25-file corpus now reports 3 compatible, 22 explicitly
unsupported, zero invalid, and zero unexpected results.

## Remaining boundary

Loop-restoration syntax is parsed and entropy consumption matches the full
frame, but the decoder does not yet apply loop filtering, CDEF, or Wiener/SGR
restoration to the reconstructed planes. The current public result is therefore
the valid pre-filter reconstruction, not a pixel-exact post-filter reference.
The current path also retains padded full-frame YUV plus the public RGBA output;
bounded superblock/tile output remains required for the Lambda memory
northstar.
