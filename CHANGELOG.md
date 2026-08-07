# Changelog

All notable changes to PureJsImage are documented in this file.

## [0.3.0] - 2026-08-07

### Added

- Configurable JPEG 4:2:0, 4:2:2, and 4:4:4 chroma subsampling, with 4:2:0 as
  the photographic default.
- JPEG decoding for Adobe CMYK, YCCK, and explicitly encoded RGB images.
- Ordered ICC profile assembly and sRGB conversion for RGB matrix/TRC profiles
  and CMYK `lut16` `A2B0` profiles.
- MPF image-count inspection and pinned SDR-primary coverage for an Apple
  gain-map JPEG.
- Pinned JPEG fixtures from libultrahdr and Web Platform Tests, plus dedicated
  compatibility verification and encoder benchmarks.
- Adam7 interlaced PNG decoding across every legal color-type and bit-depth
  combination.

### Changed

- Reworked JPEG entropy, Huffman, transform, color-conversion, and sampling hot
  paths around reusable typed buffers and predictable JIT-friendly kernels.
- Reduced the median 4000x3000 JPEG-to-1200px workflow from 1,829.6 ms to
  1,408.1 ms in the pinned benchmark environment.
- Added full-decode PNG CRC validation and stricter critical-chunk ordering,
  uniqueness, palette, transparency, and trailing-data checks.

[0.3.0]: https://github.com/a-r-d/PureJsImage/compare/v0.2.0...v0.3.0
