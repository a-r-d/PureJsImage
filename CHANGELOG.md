# Changelog

All notable changes to PureJsImage are documented in this file.

## [Unreleased]

### Changed

- Buffered path-backed sources in 64 KiB windows so small codec reads no longer
  reopen and close the file for every header, chunk, tag, or strip access.
- Made codec probing start from a stable registration-independent window and
  expand through declared `ftyp` boxes, with shared AVIF/HEIF brand parsing that
  excludes `minor_version` and bytes outside the box.
- Added bounded embedded RGB ICC conversion for PNG `iCCP`, WebP `ICCP`, TIFF
  `InterColorProfile` tag 34675, and AVIF/HEIF `prof` properties, preserving
  alpha while converting decoded row blocks to sRGB.
- Added PNG `gAMA`, `cHRM`, and `sRGB` precedence handling, bounded `iCCP`
  decompression, and explicit rejection of unsupported higher-precedence
  `cICP` signaling instead of silently treating tagged pixels as sRGB.
- Added Display-P3-to-sRGB conversion for AVIF and HEIF `nclx` properties that
  declare P3 primaries with the sRGB transfer function.
- Made RGB JPEG profiles with LUT-only `A2B0` transforms fail explicitly as
  unsupported instead of being mistaken for malformed matrix/TRC profiles.
- Hardened baseline JPEG parsing around byte-stuffed entropy, marker fill bytes,
  trailing data, malformed segment lengths, hostile dimensions, invalid coding
  tables and sampling factors, unknown scan components, and truncated streams.
- Hardened WebP RIFF and VP8X parsing around chunk extents and padding, reserved
  fields, duplicate reconstruction chunks, alpha signaling, canvas limits, and
  canvas-to-bitstream dimension agreement.
- Hardened GIF metadata inspection to validate logical-screen limits, every
  frame's geometry, palette and LZW prerequisites, extension structure, frame
  limits, block markers, and the required trailer.
- Accelerated baseline and progressive JPEG reconstruction with direct typed
  MCU-plane writes, sparse typed IDCT row indices, and a JIT-friendly unrolled
  second transform pass.
- Recycled released JPEG decoder blocks and resize row buffers instead of
  relying on garbage collection to reclaim each temporary allocation.
- Reduced the pinned 4000x3000 JPEG-to-1200px workflow from 1,417.1 ms to
  905.6 ms while keeping output byte-identical and median peak RSS within
  0.8 MiB of the pre-change result.
- Specialized PNG filter and unfilter loops before entering their byte kernels,
  reducing the pinned 4000x3000 PNG resize from 605.3 ms to 495.7 ms.
- Stored TIFF tag values and sample layouts in typed arrays, precomputed row
  geometry, and transferred compatible RGB and grayscale strips directly.
- Reduced the pinned large TIFF resize from 574.4 ms to 109.2 ms and the 1-bit
  LZW resize from 583.8 ms to 499.1 ms.
- Specialized BMP row conversion by bit depth and removed per-pixel palette
  tuple allocations, reducing the pinned 4000x3000 BMP resize from 176.7 ms to
  149.1 ms.
- Removed per-edge arrays and callback-based pixel transforms from VP8 and VP8L
  decoding, and reused inverse-DCT scratch storage across macroblocks.
- Reworked WebP byte writers, coefficient traversal, transforms, quantization,
  and reconstruction around typed tables and reusable fixed-size buffers.
- Reduced the pinned 1600x2000 WebP resize from 1,413.5 ms to 519.4 ms, JPEG to
  lossy WebP from 1,296.6 ms to 965.4 ms, and PNG to lossless WebP from 97.8 ms
  to 50.0 ms. The lossy encoder workflow also reduced median peak RSS from
  153.4 MiB to 112.2 MiB.
- Moved AV1 inverse transforms, quantizer tables, filter-intra neighbors, and
  generated coefficient scans to typed and reusable storage. In the fresh
  five-run AVIF benchmark, Kodak decode fell from 375.3 ms to 294.8 ms and fox
  decode from 1,015.6 ms to 782.9 ms with identical pinned RGBA hashes.

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
[Unreleased]: https://github.com/a-r-d/PureJsImage/compare/v0.3.0...HEAD
