# AVIF Phase B2 restricted decode — August 6, 2026

Phase B2 establishes PureJsImage's first pixel-producing, dependency-free AVIF
path. The phase is complete as a deliberately restricted correctness seam, not
as a claim of general AVIF decode compatibility.

## Supported slice

- single `av01` primary image, with no grid or alpha auxiliary item;
- AV1 reduced still-picture header and one complete frame OBU;
- 8-bit Main Profile YUV 4:2:0;
- one tile and lossless or lossy intra coding;
- square `NONE`/`SPLIT` partitions, DC and horizontal luma/chroma prediction,
  neutral directional angle deltas, and filter-intra mode 0;
- 4x4/8x8 all-zero blocks in every quantizer context and nonzero coefficient
  tokens in quantizer context 3;
- 4x4 and 8x8 DCT/ADST dequantization and inverse transforms; and
- matrix-aware limited- or full-range YUV420 conversion with bilinear chroma
  upsampling to RGBA PixelBlocks.

Every unsupported partition, prediction mode, transform size, quantizer
context, bit depth, chroma layout, grid, alpha item, or in-loop filter exits with
`UNSUPPORTED_OPERATION`; the decoder does not synthesize approximate pixels.

## Correctness fixture

The lossless fixture is an opaque 2x2 neutral YUV420 AVIF encoded by libavif
`avifenc` 1.3.0 with libaom, speed 10, quality 100/lossless, one worker, and the
sha256 checksum
`c5ec8bee42c22403aa4c75a7cb2fa45925a44a37616362215cd7b5d84e822612`.
Its complete 291-byte AVIF is embedded in the benchmark so the run requires no
external codec or network access.

PureJsImage produces four exact reference pixels of RGBA
`[130, 130, 130, 255]`. The automated test also crops the bottom-right pixel
and converts it to PNG through the public `Image.open(...).crop(...).png()`
workflow.

The lossy fixture is libavif's checksum-pinned `extended_pixi.avif`: a 330-byte
opaque 4x4, 8-bit YUV420 image. It exercises a horizontal luma mode with a
neutral angle delta, an 8x8 luma transform, 4x4 chroma transforms, EOB values
of 36/10/10, signed nonzero coefficients, dequantization, inverse DCT, and
bilinear chroma reconstruction. PureJsImage's 64 RGBA bytes exactly match both
the development oracle and an independent dav1d/libavif decode.

## Results

Command:

```sh
/usr/bin/time -v npm run bench:avif:b2
```

Environment: Node.js 24.16.0, 25 measured in-process targeted decodes, forced GC
before each measured run.

| Measurement | Result |
| --- | ---: |
| Targeted correctness | 2/2 exact |
| Median lossless targeted wall time | 1.142 ms |
| Process peak RSS | 96.0 MiB |
| Permanent broad corpus decoded | 1/25 |
| Permanent broad corpus explicitly unsupported | 24/25 |
| Broad corpus invalid/unexpected failures | 0 |

The 24 explicit rejections break down into 14 unsupported profile/bit-depth/
chroma combinations, six alpha images, two images requiring in-loop filters,
one multi-frame item, and one grid. There are no entropy desynchronizations or
generic invalid-input failures left in the permanent corpus.

The absolute RSS includes Node, the TypeScript loader, and the entire process;
these tiny inputs cannot establish useful codec memory scaling. The
current implementation also retains padded YUV planes plus a full RGBA output,
so it does not yet satisfy the project's bounded-memory AVIF northstar.

## Phase B3

The next decoder phase adds broader partition and transform-size syntax, the
remaining common intra prediction modes, and CDEF/restoration before targeting
the two large 8-bit 4:2:0 photographs in the permanent corpus. Compatibility
must advance while reconstruction moves toward bounded tile/superblock output;
completing this restricted phase is not a broad AVIF support claim.
