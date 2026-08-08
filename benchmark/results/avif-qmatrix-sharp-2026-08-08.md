# AVIF Sharp quantization-matrix validation

Created: 2026-08-08

The deterministic 256x192 opaque 8-bit YUV 4:2:0 checkerboard source was encoded
with the pinned Sharp 0.35.3 development dependency at default AVIF q50 and q80
settings. Both encoded files signal quantization matrices and block delta-Q.

| Fixture | Base quantizer | Matrix Y/U/V | Delta-Q resolution | Encoded bytes | YUV tolerance |
| --- | ---: | --- | ---: | ---: | ---: |
| `sharp-qmatrix-q50-256x192.avif` | 148 | 8/8/8 | 2 | 581 | 0 |
| `sharp-qmatrix-q80-256x192.avif` | 60 | 9/9/9 | 0 | 642 | 0 |

`npm run fixtures:avif:qmatrix` decoded both fixtures with PureJsImage, dav1d
1.5.1, and libaom 3.12.1 through FFmpeg 7.1.1. All 73,728 visible Y, U, and V
bytes matched byte for byte for each fixture, and dav1d and libaom also agreed
with each other. The required and observed numeric tolerance is zero.

The fixtures cover default Sharp/libaom quantization matrices, quantizer
contexts 3 and 1, block delta-Q header syntax, multiple superblocks, luma and
chroma reconstruction, and disabled delta loop-filter syntax. Segmentation,
delta loop-filter, multiple tiles, high bit depth, alpha, grids, and animation
remain outside this restricted decoder milestone and continue to fail
explicitly when signaled.
