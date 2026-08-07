# AVIF Phase B2 restricted decode — August 6, 2026

Phase B2 establishes PureJsImage's first pixel-producing, dependency-free AVIF
path. It is intentionally a narrow correctness seam, not a claim of general
AVIF decode compatibility.

## Supported slice

- single `av01` primary image, with no grid or alpha auxiliary item;
- AV1 reduced still-picture header and one complete frame OBU;
- 8-bit Main Profile YUV 4:2:0;
- one tile and lossless coding;
- square `NONE`/`SPLIT` partitions, DC luma/chroma prediction, and all-zero
  4x4 transform blocks; and
- limited- or full-range YUV420 conversion to RGBA PixelBlocks.

Every unsupported partition, prediction mode, coefficient payload, bit depth,
chroma layout, grid, alpha item, or in-loop filter exits with
`UNSUPPORTED_OPERATION`; the decoder does not synthesize approximate pixels.

## Correctness fixture

The targeted fixture is an opaque 2x2 neutral YUV420 AVIF encoded by libavif
`avifenc` 1.3.0 with libaom, speed 10, quality 100/lossless, one worker, and the
sha256 checksum
`c5ec8bee42c22403aa4c75a7cb2fa45925a44a37616362215cd7b5d84e822612`.
Its complete 291-byte AVIF is embedded in the benchmark so the run requires no
external codec or network access.

PureJsImage produces four exact reference pixels of RGBA
`[130, 130, 130, 255]`. The automated test also crops the bottom-right pixel
and converts it to PNG through the public `Image.open(...).crop(...).png()`
workflow.

## Results

Command:

```sh
/usr/bin/time -v npm run bench:avif:b2
```

Environment: Node.js 24.16.0, 25 measured in-process targeted decodes, forced GC
before each measured run.

| Measurement | Result |
| --- | ---: |
| Targeted correctness | 1/1 exact |
| Median targeted wall time | 0.863 ms |
| Process peak RSS | 93.97 MiB |
| Permanent broad corpus decoded | 0/25 |
| Permanent broad corpus explicitly unsupported | 25/25 |
| Broad corpus invalid/unexpected failures | 0 |

The absolute RSS includes Node, the TypeScript loader, the test oracle, and the
entire process; a 2x2 input cannot establish useful codec memory scaling. The
current implementation also retains padded YUV planes plus a full RGBA output,
so it does not yet satisfy the project's bounded-memory AVIF northstar.

## Next decoder work

Continue Phase B2 by adding the common intra prediction modes and nonzero
coefficient/token reconstruction, then loop filters and broader partition
syntax. Compatibility should be advanced against the permanent corpus while
moving reconstruction to bounded tile/superblock output rather than treating
this narrow success as completed AVIF support.
