# AVIF Sharp quantization-matrix validation

Created: 2026-08-08

A deterministic textured 256x192 opaque 8-bit YUV 4:2:0 source was encoded with
the pinned Sharp 0.35.3 development dependency at its default AVIF q30, q50,
q65, q80, and q90 settings. Every encoded file signals quantization matrices
and block delta-Q. Unlike the earlier checkerboard pair, this source exercises
matrix weights whose horizontal and vertical positions differ.

| Fixture | Base quantizer | Matrix Y/U/V | Delta-Q | Bytes | Maximum YUV error | YUV PSNR |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| `sharp-qmatrix-q30-256x192.avif` | 196 | 7/7/7 | 3 | 912 | 2 | 56.21 dB |
| `sharp-qmatrix-q50-256x192.avif` | 148 | 8/8/8 | 2 | 1,176 | 2 | 63.51 dB |
| `sharp-qmatrix-q65-256x192.avif` | 108 | 8/9/9 | 1 | 1,546 | 2 | 62.20 dB |
| `sharp-qmatrix-q80-256x192.avif` | 60 | 9/9/9 | 0 | 3,779 | 2 | 63.09 dB |
| `sharp-qmatrix-q90-256x192.avif` | 32 | 10/10/10 | 0 | 5,034 | 3 | 63.09 dB |

`npm run fixtures:avif:qmatrix` decoded every fixture with PureJsImage, dav1d
1.5.1, and libaom 3.12.1 through FFmpeg 7.1.1. Dav1d and libaom agreed byte for
byte. PureJsImage must stay within a maximum YUV sample error of 3 and at least
55 dB PSNR; the observed range is shown above. The public displayed-RGB test
separately requires greater than 39 dB against Sharp/libaom for all five
qualities, and the real-browser q30 test applies the same threshold against
Chromium's AVIF decoder.

The previous implementation used normative row-major matrix data without
accounting for the inverse-transform kernels' opposite coefficient-axis order.
That mistake was invisible on the old checkerboards but caused large,
content-dependent errors on ordinary textured images. The corrected decoder
transposes matrix lookup into the internal coefficient layout and uses AV1's
adjusted 32x32 matrix dimensions for 64-point transforms.

The fixtures cover default Sharp/libaom quantization matrices, quantizer
contexts 1 through 3, block delta-Q header syntax, multiple superblocks, luma
and chroma reconstruction, and disabled delta loop-filter syntax. Segmentation,
delta loop-filter, multiple tiles, high bit depth, alpha, grids, and animation
remain outside this restricted decoder milestone and continue to fail
explicitly when signaled.
