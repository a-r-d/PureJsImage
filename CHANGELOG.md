# Changelog

All notable changes to PureJsImage are documented in this file.

## [Unreleased]

### Added

- Added an explicit optional first-party Rust/WASM baseline JPEG decoder that fuses entropy decode,
  IDCT, chroma upsampling, and RGB conversion while preserving bounded MCU-row output, exact
  TypeScript parity, lazy warm reuse, and clean fallback for unsupported or unhelpful workloads.
- Added first-party refinement-based progressive JPEG encoding for grayscale and 4:2:0, 4:2:2,
  and 4:4:4 YCbCr output, with compact coefficient limits, per-scan restart markers, independent
  pixel validation, browser coverage, and isolated runtime/RSS/size benchmarks.
- Added jSquash as an isolated WebAssembly competitor using its pinned JPEG, PNG, WebP, and resize
  packages, with documented Node WASM initialization, explicit unsupported classifications,
  startup/package-footprint measurements, a codec-matched bundle comparison with exact package
  versions, validated workflow results, and regenerated charts.
- Added a fully client-side browser conversion demo with content-based format detection, optional
  transforms, honest timing and memory reporting, and an artifact-only GitHub Pages deployment
  that keeps its generated all-codec bundle out of repository history.

### Fixed

- Allowed the browser demo to convert the supported primary image from iPhone-style MPF JPEGs while
  warning that auxiliary images and gain maps are not preserved; true animated inputs remain blocked.
- Reduced progressive JPEG output with two-pass, scan-specific optimized Huffman tables; the pinned
  quality-80 benchmark moved from 3.29% larger than baseline to 7.26% smaller with identical decoded
  PSNR.
- Reduced lossless WebP output for screenshot-style pixels with block-adaptive VP8L predictors,
  adaptive color-cache codes, and a deeper bounded match search, while retaining exact independent
  libwebp pixel validation and documenting the fixed match-table memory cost.
- Fixed progressive JPEG AC refinement after a zero-run-length symbol so common Sharp/libjpeg
  output decodes correctly and can be resized and converted to WebP in Node.js and browsers.

## [0.7.0] - 2026-08-08

### Added

- Completed the common static 8-bit Huffman JPEG reference before optional WASM work: incremental
  entropy input, restart-aware region seeking, chroma-aware bilinear upsampling, SOF1 and sequential
  multi-scan decode, 4:4:0 and 4:1:1 fixtures, native grayscale and restart-marker output, hostile
  input limits, and provider-neutral parity vectors.
- Added native 1/2, 1/4, and 1/8 JPEG IDCT output, decoder-driven scale selection for safe
  full-frame downscales, baseline/progressive/restart/subsampling regressions, and an isolated
  runtime, RSS, avoided-pixel, and output-error benchmark against the full-resolution path.
- Added an explicit modern-browser entry with File/Blob, ArrayBuffer, Uint8Array, Blob output,
  custom sinks, browser-safe TypeScript declarations, and a browser bundle gate that rejects Node
  built-ins across the full codec graph.
- Added browser PNG encoding through `CompressionStream` and bounded browser rotation/orientation
  storage through OPFS, a lazy 64 MiB chunked-memory fallback, and IndexedDB for larger transforms.
- Added HEIF/HEIC EXIF and RGB ICC preservation for conversion workflows, including orientation
  normalization, plus structured ICC and nclx color-profile metadata for HEIF and AVIF.
- Refreshed the static GitHub Pages documentation with responsive guides, API and codec references,
  benchmark tables, memory-model explanations, and clearer capability boundaries.
- Documented the progressive JavaScript, optional WASM, and future WebGPU backend roadmap,
  including capability probing, workload-based selection, bounded GPU memory rules, runtime
  fallback policy, correctness gates, and a staged browser-first delivery plan.
- Added a reproducible bundle and deployment-footprint comparison for PureJsImage, Jimp, image-js,
  and Sharp, with a matched common codec set and explicit accounting for Sharp's native payload.
- Added one machine-readable codec capability manifest that generates README, detailed codec,
  website, public JSON, and compatibility-test expectations, with a stale-output CI gate and a
  repository agent skill for rolling capabilities out consistently.

### Changed

- Made bundle and installed-package size reporting part of the mandatory `npm run check` gate.
- Reworked the root README into a shorter human-facing overview with a practical all-codec example,
  bundle sizes, codec support and compatibility links, benchmark charts, and direct routes to the
  API, benchmark, browser, temporary-storage, specification, and contributor details.
- Split Node file, Buffer, zlib, and temporary-file services from the portable codec and pipeline
  core while preserving the existing Node API and measured transform performance.
- Made Node.js and modern-browser portability an explicit project goal and release requirement.
- Reused a single Node file descriptor across detection, metadata, and execution reads, and avoided
  redundant copies when stable sources fill codec regions.
- Surfaced the measured 191.8-211.0 MiB JPEG 2000 decode peak and its 512 MiB Lambda-tier guidance
  in the README and codec documentation.

### Fixed

- Reduced first-party lossless WebP output for graphics by adding predictor and subtract-green
  transforms, LZ77 references, and adaptive Huffman trees, with exact Sharp/libwebp pixel checks
  and an isolated size and peak-memory benchmark for the documented full-frame encoder state.
- Decoded the quantization matrices and block delta-Q syntax used by default Sharp/libaom AVIF
  output in the restricted opaque 8-bit YUV 4:2:0 path, with exact q50 and q80 YUV agreement
  against both dav1d and libaom while delta loop-filter syntax remains explicitly unsupported.
- Restricted SVG recognition to the document's first element so HTML with inline SVG and JSON text
  mentioning `<svg` are no longer misreported as SVG input.

## [0.6.0] - 2026-08-08

### Added

- Added first-party JPEG 2000 / JP2 decoding for common Part 1 grayscale and RGB still images,
  including reversible 5/3 and irreversible 9/7 reconstruction, all five progression orders,
  multiple tiles, 1-16-bit unsigned samples, strict container validation, public pipeline
  conversion, and checksum-pinned fixtures from independent encoders.
- Added public-domain real-photograph JP2 fixtures with exact OpenJPEG oracle hashes, structured
  container and codestream corruption regressions, a deterministic JP2 mutation campaign, decoded
  allocation-limit tests, and isolated cold/warm RSS gates for the documented full-frame fallback.
- Added ordered, composable spatial stages: crop-after-resize, multiple resize stages, clockwise
  `rotate()` with arbitrary-angle bilinear sampling, vertical `flip()`, and horizontal `flop()`.
- Added opt-in `keepExif()` and `keepIcc()` pipeline operations with JPEG, PNG, and WebP metadata
  round trips, TIFF ICC round trips, orientation normalization after pixel reorientation, and
  explicit errors for unsupported preservation combinations.
- Added a transform-to-JPEG benchmark profile covering quarter-turn and arbitrary rotation,
  crop-after-resize with a second resize, and combined flip/flop workflows, with isolated timing,
  peak RSS, dimensions, pinned output-pixel validation, and an equivalent-workflow Jimp comparison.
- Added a cross-codec transform contract that runs the full ordered transform chain from every
  supported decoder through JPEG output, plus focused arbitrary-rotation coverage for grayscale,
  RGB, and RGBA sample formats.
- Added a contributor guide covering tests, benchmarks, modular feature design, documentation,
  changelog entries, AI-assisted changes, MIT licensing, and conflict-free pull requests to `main`.
- Added a repository release skill with explicit authority, validation, packaging, publishing,
  provenance, and post-release consistency gates.
- Added a private vulnerability disclosure policy that defines the dependency-free runtime boundary
  while keeping CI, build, credential, and published-artifact supply-chain risks in scope.
- Added weekly and change-triggered CodeQL analysis for JavaScript and TypeScript using the extended
  security query suite.
- Added runtime validation for custom `ImageSource` reads, normalizing short, oversized, detached,
  and rejected reads into contextual `ImageError` results before codec parsing.
- Added a release-gated deterministic corruption campaign with hundreds of bit flips across a
  committed benchmark seed for every codec, saved raw-exception reproducers, and a checked-in
  regression corpus that automatically turns promoted crashes into permanent tests.

### Changed

- Kept arbitrary-angle rotation memory bounded with a temporary 32x32 tile spool and small
  destination blocks, without per-pixel promises or temporary sample arrays.

## [0.5.0] - 2026-08-08

### Added

- Added first-party ICO decoding with validated multi-image selection,
  zero-copy embedded PNG entries, common 1/4/8/16/24/32-bit DIB layouts,
  one-bit AND masks, partial alpha, and the Windows-compatible legacy
  all-zero-alpha fallback.
- Added a committed, checksum-pinned ICO corpus plus correctness-gated isolated
  benchmarks for metadata, embedded PNG and DIB decoding, masks, alpha, resize,
  PNG output, and JPEG output.
- Expanded first-party TIFF decoding with BigTIFF 64-bit IFDs and offsets,
  padded tiled layouts, 16-bit integer channels, CMYK and subsampled YCbCr
  conversion, CCITT Modified Huffman and Group 3 fax, and old/new JPEG-in-TIFF.

## [0.4.0] - 2026-08-07

### Added

- Added self-contained compound-image regressions proving that Android-style
  Ultra HDR JPEGs decode their SDR MPF primary and that HEIC gain-map and
  portrait auxiliaries cannot displace the declared primary item.
- Added a hostile `ImageSource` harness that invalidates each returned buffer
  when the next read begins, plus a second full test-suite pass that exercises
  in-memory workflows under that weakest supported lifetime.
- Added deterministic corruption coverage across all eight codecs: every 1 KiB
  and final-byte truncation must throw `ImageError`, while seeded bit flips may
  decode or fail but must never leak raw runtime exceptions.
- Added bounded bomb fixtures for oversized virtual PNG inputs, streamed PNG
  expansion, and GIF LZW output beyond its declared pixel count.
- Added auto-orient storage tests that prove temporary directories are removed
  after decoder failures and simulated disk exhaustion.
- Accepted custom `ImageSource` objects as library inputs so source ownership
  and buffer-lifetime contracts can be exercised through normal pipelines.
- Added a public two-phase roadmap for first-party TypeScript reference codecs
  followed by explicitly loaded, API-compatible Rust/WASM accelerators.
- Added a reproducible esbuild, gzip, and Brotli size report for the core API,
  individual codec entries, and the opt-in all-codec graph.

### Changed

- Added first-party CCITT Group 4 TIFF decoding for bilevel fax and scanner
  strips, including independent strip references, `FillOrder=2`, full T.4 run
  tables, and explicit corruption and unsupported-mode errors.
- Lowered the minimum supported Node.js version from 24 to 22 and added CI
  coverage for both Node 22 and Node 24.
- Added HEIF Main 10 reconstruction and bounded-row 10-bit YUV output, with
  BT.2020 PQ/HLG decoding, global SDR tone mapping, and sRGB output validated by
  independently encoded x265 and FFmpeg oracle fixtures.
- Documented that `Buffer`, `Uint8Array`, and `ArrayBuffer` inputs are borrowed
  without copying and must remain unchanged until their pipelines finish.
- Copied bounded PNG `IDAT` chunks at the `DecompressionStream` ownership
  boundary, preventing deferred inflater reads from observing source buffers
  invalidated by a subsequent read.
- Enforced `maxDecodedBytes` against PNG inflater output as it streams and
  canceled the decompressor promptly when the limit or downstream decoder fails.
- Converted auto-orient temporary-file failures into explicit `ImageError`
  results, using `LIMIT_EXCEEDED` for `ENOSPC`, quota, and file-size limits.
- Documented the 32x32 tile spool, approximate disk requirement, Lambda `/tmp`
  impact, cleanup contract, and why 90-degree rotation cannot use only a bounded
  column buffer with the current row-oriented encoder boundary.
- Buffered file, `Blob`, and custom `ImageSource` inputs at the common input
  boundary using four lazy 256 KiB region slots, preventing small codec reads
  from becoming repeated filesystem, blob-slice, or remote range operations.
- Made codec probing start from a stable registration-independent window and
  expand through declared `ftyp` boxes, with shared AVIF/HEIF brand parsing that
  excludes `minor_version` and bytes outside the box.
- Added fallback content signatures that distinguish unknown input, recognized
  codecs omitted from a custom registry, malformed recognizable files, and
  unimplemented SVG, PDF, ICO/CUR, JPEG XL, JPEG 2000, and BigTIFF input.
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
[0.4.0]: https://github.com/a-r-d/PureJsImage/compare/v0.3.0...v0.4.0
[0.5.0]: https://github.com/a-r-d/PureJsImage/compare/v0.4.0...v0.5.0
[0.6.0]: https://github.com/a-r-d/PureJsImage/compare/v0.5.0...v0.6.0
[0.7.0]: https://github.com/a-r-d/PureJsImage/compare/v0.6.0...v0.7.0
[Unreleased]: https://github.com/a-r-d/PureJsImage/compare/v0.7.0...HEAD
