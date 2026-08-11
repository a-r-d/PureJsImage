# Changelog

All notable changes to PureJsImage are documented in this file.

## [Unreleased]

### Added

- Added immutable numeric `window()` and color `lut()` pipeline operations for browser viewers,
  including per-channel display ranges, grayscale-to-RGB/RGBA lookup tables, direct RGBA tables,
  bounded row output, and explicit output pixel formats.
- Added tile-native `WholeSlideLevel.tile(column, row, options?)` reads with validated tile
  coordinates and bounded edge-tile regions.
- Added a constrained first-party AVIF encoder with public `image.avif()` and
  `image.encode('avif')` APIs. It accepts 8-bit grayscale, RGB, and RGBA input,
  composites alpha against white or an explicit solid background, and writes deterministic
  single-tile Main Profile YUV 4:2:0 still images accepted by libavif and libaom. Quantization
  remains fixed while adaptive quality, alpha items, metadata, grids, and animation are unfinished.

### Changed

- Migrated the documentation website from hand-authored static HTML to Astro with shared layouts,
  React island support, the same `.html` routes and public assets, and the existing GitHub Pages
  artifact and browser-demo validation flow.
- Threaded `AbortSignal` through image opening, metadata, terminal output, decoder requests, TIFF
  documents and profiles, whole-slide operations, source reads, normalization, and numeric raster
  conversion. HTTP range reads combine source-lifetime and per-read signals so an obsolete viewer
  request cancels its in-flight fetch, and output sinks abort cleanly on cancellation.
- Expanded the first-party lossless WebP encoder with packed palette and cross-color transforms,
  spatial entropy groups, adaptive color-cache and LZ77 search, `effort` controls, and
  `nearLossless` quality. The pinned 1200x480 production-style logo now encodes to 2,188 bytes
  versus 6,850 bytes from PureJsImage PNG and 1,584 bytes from Sharp/libwebp, with exact
  independent pixel reconstruction.


## [0.9.0] - 2026-08-09

### Added

- Expanded TIFF decoding with unsigned 6-, 10-, 12-, and 14-bit grayscale, 2-, 4-, 10-, 12-,
  and 14-bit chunky or planar RGB, native packed horizontal prediction, direct 16-bit output,
  and five-sample CMYK plus associated or unassociated alpha while retaining bounded segment
  memory.
- Added explicit WebP-in-TIFF composition through
  `createTiffCodec({ embeddedCodecs: [webpCodec] })`; the default TIFF codec and root package do
  not import or activate WebP automatically.
- Added a complete development-only TIFF dependency matrix plus isolated raw full-image and region
  benchmark operations with source-read, maximum decoded-block, external-memory, and ArrayBuffer
  measurements.
- Added a generated evidence-backed TIFF library comparison across the README and documentation,
  backed by pinned versions and a 154-file isolated-process conformance run that reports exact
  pixels, mismatches, unsupported cases, errors, timeouts, crashes, native scientific rasters, and
  malformed-input behavior separately.
- Expanded the browser demo from 8 to 38 public examples spanning ECCI scanning electron
  microscopy, OME-TIFF microscopy dimensions, FLIM, SPIM, high-content screening, pathology,
  scientific JPEG 2000, high-bit-depth AVIF, and additional unusual codec layouts.
- Added a published `llms.txt` with a capability-manifest-generated codec map, complete quick API
  reference, runtime and safety boundaries, and migration guidance for Jimp, Sharp, image-js,
  jSquash, GeoTIFF.js, and UTIF.js; every website footer now links the guide and sitemap.
- Added TIFF signed 8-/16-bit and IEEE float16/float32/float64 grayscale and RGB decoding with
  native-precision raw pixel blocks, deterministic display ranges, bounded Predictor 2 and
  floating Predictor 3 reversal, and browser-compatible display conversion.
- Added unsigned 24-/32-/64-bit TIFF grayscale and RGB decoding with canonical `gray32`,
  `rgb32`, `gray64`, and `rgb64` raw blocks, exact values above JavaScript's safe-integer range,
  bounded wide Predictor 2 reversal, and deterministic display conversion without an 8-/16-bit
  raw intermediate or per-pixel BigInt arithmetic.
- Added bounded TIFF SGILog and SGILog24 decompression with native CIE Y/XYZ float32 pixel
  blocks, logarithmic luminance and chroma reconstruction, deterministic CCIR 709 gamma-2
  display conversion, exact segment validation, and browser-compatible strip and tile decoding.
- Added explicit TIFF top-level frame and reduced-resolution SubIFD selection for Classic TIFF
  and BigTIFF, with selected-level metadata, bounded IFD graph traversal, cycle rejection,
  alias-safe shared-directory reuse, global directory limits, and no reads from unselected pixel
  segments.
- Added 16-bit TIFF palette decode with exact full-range ColorMap scaling, plus signed 8-/16-bit
  and float16/float32/float64 CMYK display conversion using declared sample ranges or deterministic
  full-type defaults, bounded segment output, and independent pixel validation.
- Added 8-bit TIFF CIELab conversion from D65-referenced L*a*b* to sRGB, bounded CMYK
  `lut16` A2B0 ICC-profile conversion with profile precedence over numeric display, and
  `FillOrder=2` normalization for non-fax strips and tiles before predictor reversal without
  mutating aliased source buffers.
- Added a public TIFF document layer at `purejsimage/tiff` with stable top-level/SubIFD graphs,
  absolute IFD offsets and lookup, bounded defensive-copy private metadata reads, cached immutable
  typed tags with per-call limits, per-directory display and native raster decoders, deterministic
  third-party profile registration with isolated detector failures and ambiguity rejection, and
  typed explicit `TiffProfile<T>` opening.
- Added native-precision planar or interleaved N-channel `RasterBlock` output plus explicit
  `rasterToPixels()` range mapping, so scientific samples no longer require an implicit RGB
  interpretation.
- Added `purejsimage/scientific` OME-TIFF datasets with validated Z/C/T dimensions, channel and
  physical-pixel metadata, explicit or implicit `TiffData` plane mappings, separate-channel
  assembly, and reduced-resolution SubIFD selection.
- Added a generic `WholeSlideImage` contract and first-party Aperio SVS profile with bounded
  pyramid/associated-image region reads, MPP and objective metadata, reusable JPEG 2000 codestream
  composition, and TIFF compression tags 33003/33005. The pinned irreversible Aperio tile is
  independently validated against OpenSlide within two 8-bit code values.
- Added a separately compiled Leica SCN single-area profile example that imports only published
  package entries, with an automated boundary check suitable for independent vendor packages.
- Added a dedicated TIFF documentation page covering the complete decode matrix, scientific and
  whole-slide APIs, third-party profiles, canonical output, memory model, and unsupported
  boundaries; reduced the README TIFF and Zstandard sections to direct documentation links and
  refreshed the measured bundle and installed-size tables.
- Added a reusable first-party Zstandard decompressor at `purejsimage/compression/zstd` with
  explicit output and window bounds, raw/RLE/compressed blocks, Huffman and FSE entropy decoding,
  repeated tables and offsets, frame checksums, and structured malformed-input failures.
- Added bounded TIFF `Compression=50000` strip and tile decoding through the reusable Zstandard
  backend, preserving existing predictor, sample, and pixel processing.
- Replaced simple uncompressed TIFF output with a canonical Classic little-endian 8-bit RGB/RGBA
  encoder using independently Deflate-compressed, horizontally predicted strips, automatic
  roughly 128 KiB strip planning, strict extensible strategy options, bounded raw strip scratch,
  compatible RGB ICC preservation, and exact ImageMagick/LibTIFF interoperability validation.
- Added bounded first-party TIFF LERC2 and LERC-plus-Deflate segment decoding with mask handling,
  native numeric sample reconstruction, independently validated byte/float pixels, and structured
  rejection of corrupt headers, dimensions, masks, checksums, and codec metadata.
- Added first-party GeoTIFF model, coordinate, bounding-box, GeoKey, GDAL metadata, and nodata
  helpers over the public TIFF document API, with exact affine and tiepoint semantics.
- Added a bounded `HttpRangeSource` with request coalescing, validator-protected reads, byte-capped
  LRU caching, response cancellation, and selective COG-style region access that does not fetch
  unrelated tiles.
- Expanded structured TIFF output with explicit rows per strip, tiled RGB/RGBA segments, automatic
  or explicit BigTIFF selection, multi-page top-level IFD chains, and reduced-resolution SubIFD
  pyramids, independently reopened through GeoTIFF.js.
- Added a development-only TIFF conformance harness that scores PureJsImage, GeoTIFF.js, UTIF.js,
  image-js, and Jimp against independent sharp/ImageMagick RGBA output with isolated memory,
  timeout, crash, exact-pixel, and error reporting.

### Changed

- Moved OME-TIFF and raster helpers, Aperio SVS, and GeoTIFF profiles out of the root and browser
  entries into `purejsimage/scientific`, `purejsimage/pathology`, and `purejsimage/tiff`; moved
  `HttpRangeSource` into `purejsimage/sources/http-range` so the core bundle does not retain
  specialized TIFF workflows or the optional HTTP adapter.
- Relabeled TIFF conformance as an unreleased commit-pinned workspace snapshot and made decoded
  coverage the compact comparison headline, with exact pixels and failure counts reported
  separately.

## [0.8.0] - 2026-08-09

### Added

- Extended the isolated Imazen codec-corpus harness and independent baselines across JPEG, PNG,
  WebP, TIFF, GIF, and BMP, covering complete decode-to-PNG round trips, structured rejection,
  timeouts, crashes, memory failures, upstream categories, and format-specific feature groups.
- Added an explicitly imported first-party Rust/WASM PNG accelerator for common non-interlaced
  8-bit grayscale, RGB, and RGBA scanline decode and encode, retaining native runtime zlib,
  bounded-row memory, scalar fallback, and the TypeScript reference for every ineligible workload.
- Added a separate `purejsimage-wasm` competitor benchmark engine and seven-engine speed, memory,
  and quality reports so the explicitly registered JPEG/PNG accelerators can be compared directly
  with the unchanged default TypeScript package.
- Added an explicit optional first-party Rust/WASM baseline JPEG decoder that fuses entropy decode,
  IDCT, chroma upsampling, and RGB conversion while preserving bounded MCU-row output, exact
  TypeScript parity, lazy warm reuse, and clean fallback for unsupported or unhelpful workloads.
- Added optional first-party scalar and SIMD Rust/WASM baseline JPEG encoders with bounded MCU-row
  input, JavaScript-owned sink backpressure, RGB/RGBA/grayscale and 4:2:0/4:2:2/4:4:4 parity, explicit
  workload selection, plus an ABI-compatible SIMD JPEG decoder artifact with scalar fallback.
  Specialized entropy writes, validated-row input reads, chroma sampling, Huffman lookup, and paired
  decoder upsampling reduce pinned warm encoder time by 61.7%-66.0% versus TypeScript and pinned warm
  decoder time by 58.4%, while retaining the same output contracts and bounded memory.
- Added first-party refinement-based progressive JPEG encoding for grayscale and 4:2:0, 4:2:2,
  and 4:4:4 YCbCr output, with compact coefficient limits, per-scan restart markers, independent
  pixel validation, browser coverage, and isolated runtime/RSS/size benchmarks.
- Added jSquash as an isolated WebAssembly competitor using its pinned JPEG, PNG, WebP, and resize
  packages, with documented Node WASM initialization, explicit unsupported classifications,
  startup/package-footprint measurements, a codec-matched bundle comparison with exact package
  versions, validated workflow results, and regenerated charts.
- Added premultiplied-RGBA PSNR against independent exact-area references to quality-enabled
  competitor workflows, with quality recorded outside timing and peak-RSS sampling, included in
  Markdown and JSON reports, and published as a dedicated comparison chart.
- Added a fully client-side browser conversion demo with content-based format detection, optional
  transforms, honest timing and memory reporting, and an artifact-only GitHub Pages deployment
  that keeps its generated all-codec bundle out of repository history.
- Added restricted opaque 8-bit monochrome AVIF decode with luma-only entropy
  reconstruction, exact Sharp/libaom and FFmpeg luma validation, and real-Chromium
  displayed-RGB coverage above 60 dB PSNR.
- Added opaque 8-bit YUV 4:4:4 AVIF decode with full-resolution chroma prediction,
  transforms, post-filters, and direct RGB conversion; the pinned Fox fixture matches
  dav1d/libaom YUV exactly and exceeds 50 dB displayed-RGB PSNR against Sharp and Chromium.
- Added opaque 8-bit YUV 4:2:2 AVIF decode with axis-specific chroma prediction,
  transforms, restoration, and horizontal RGB upsampling; the pinned Fox fixture
  matches dav1d/libaom YUV exactly and exceeds 50 dB displayed-RGB PSNR against Sharp.
- Added compatible AVIF alpha auxiliary-item decoding for straight and premultiplied
  full-range 8-bit monochrome alpha, plus opaque image-grid composition with cropped
  edge tiles; deterministic libavif fixtures match Sharp exactly for alpha and exceed
  54 dB RGBA PSNR for the pinned 1x5 grid.
- Added AVIF quantizer-context-0 coefficient decoding, coded-lossless 4x4
  Walsh-Hadamard reconstruction, and container-signaled NCLX conversion including
  full-range identity color; deterministic lossy and lossless libavif fixtures
  match Sharp/libavif RGB exactly.
- Added AV1 luma and chroma palette reconstruction for compatible AVIF screen content,
  including cache reuse, non-symmetric index coding, and diagonal color-map contexts;
  the checksum-pinned draw-points fixture matches Sharp/libavif RGBA exactly.
- Added constrained coded-lossless 10-bit and 12-bit AVIF YUV 4:4:4 decode with
  native high-depth prediction and coefficient reconstruction before explicit
  conversion to the 8-bit RGBA contract; pinned fixtures reconstruct source
  planes exactly and differ from Sharp/libavif displayed RGB by at most one.
- Added compatible lossy 10-bit YUV 4:4:4 AVIF decode with native high-depth
  deblocking, CDEF, and Wiener restoration. High-depth CDEF now adjusts its
  scaled primary strength before filtering, and Wiener convolution preserves
  the center sample through its biased intermediate. The pinned full-filter
  fixture matches agreeing dav1d and libaom native YUV byte for byte in Node.js
  and Chromium.
- Expanded filter-free lossy high-depth AVIF decode across 10-bit and 12-bit YUV
  4:2:0, 4:2:2, and 4:4:4 while retaining native `Uint16Array` samples through
  reconstruction. Six checksum-pinned fixtures match agreeing dav1d and libaom
  native YUV byte for byte and pin portable RGBA output in Node.js and Chromium.
  PQ and HLG transfer signaling now remains inspectable as metadata but fails
  explicitly before the SDR pixel-conversion path.
- Added `a1lx`, `a1op`, and `lsel` AVIF property parsing and complete frame-unit
  selection for multi-frame items. A pinned three-frame fixture explicitly selects
  an independently decodable shown-key spatial layer and matches agreeing dav1d and
  libaom native YUV byte for byte in Node.js and Chromium. Dependent enhancement
  layers, frame-dimension overrides, and rendering every intermediate layer remain
  explicitly unsupported; `lsel=0xFFFF` selects the highest eligible output layer.
- Added complete coded-lossless multi-tile AV1 frame reconstruction with
  independent entropy, context, partition, and prediction boundaries. The
  checksum-pinned 10-bit 2x2 YUV 4:4:4 fixture matches its source and agreeing
  dav1d/libaom native YUV byte for byte; compatible lossy multi-tile frames and
  contiguous multi-OBU tile groups are also supported, while multi-tile
  intra-block-copy remains explicitly unsupported.
- Added normative eight-tap AV1 super-resolution for one-tile 8-bit AVIF
  frames, including CDEF-before-upscale and loop-restoration-after-upscale
  ordering. The filter-free denominator-12 YUV 4:2:0 and YUV 4:4:4 fixtures
  and the CDEF-plus-Wiener YUV 4:2:0 fixture match agreeing dav1d/libaom
  native YUV byte for byte. Multi-tile super-resolution remains explicitly
  unsupported, and the supported path retains full coded and upscaled YUV planes.
- Expanded deterministic AVIF corruption fuzzing across checksum-pinned
  super-resolution, high-bit tile, premultiplied-alpha, restoration-unit, and
  cropped-grid inputs; malformed variants must fail only through `ImageError`.
- Added constrained skipped intra-block-copy reconstruction for compatible AVIF
  screen content, including adaptive integer motion vectors and allocation-free
  in-place plane copies; the pinned 320x280 fixture matches agreeing libaom and
  dav1d native YUV exactly.
- Added residual intra-block-copy reconstruction for compatible one-tile AVIF
  frames, including transform partitions, full-block transform contexts and types,
  coefficients, inverse transforms, weighted reference-motion candidate stacks,
  and bilinear chroma prediction for subsampled motion. The pinned monochrome and
  four Microsoft YUV 4:2:0 still-picture fixtures match agreeing libaom and dav1d
  native YUV byte for byte, and checksum-pinned entropy mutations verify that
  superblock-overlapping and plane-escaping motion vectors fail explicitly.
- Added block delta-Q integration coverage for skipped intra-block copy. The
  pinned 512x128 YUV 4:4:4 fixture matches agreeing libaom and dav1d native YUV
  byte for byte; segmentation maps and delta loop-filter combinations remain
  explicitly unsupported.
- Added validated AVIF clean-aperture cropping for integer `clap` rectangles
  without allocating a second full-frame buffer; malformed, out-of-bounds, and
  fractional apertures fail explicitly, and the pinned fixture matches
  Sharp/libavif RGBA exactly in Node.js and Chromium.
- Added AVIF SDR color management for linear and extended-sRGB and linear BT.2020
  NCLX signaling, compatible RGB matrix/TRC ICC profiles, and ISO 21496-1 gain
  maps with `altr` preferred-alternative selection and bounded row composition.
  Pinned outputs match Sharp/libvips exactly for ICC, stay within maximum channel
  error 13 and mean error 0.5 against FFmpeg/zimg for BT.2020, and stay within
  maximum channel error 4 and mean error 1 against libavif for HDR-to-SDR gain
  maps in Node.js and Chromium. PQ/HLG without a compatible SDR alternate,
  broader ICC/NCLX conversion, gain-map grids, resampling, and alpha remain
  explicit errors.

### Changed

- Changed AVIF RGBA conversion, alpha application, clean-aperture output, and
  opaque-grid composition to ordered row blocks instead of retaining a
  source-sized RGBA bitmap. Loop restoration now retains only deblocked stripe
  boundaries and delayed output bands, while CDEF uses reusable source windows
  and delayed 8-row output bands instead of another padded YUV frame.
- Changed compatible opaque filter-free AVIF decode to reuse two-superblock YUV,
  prediction, palette, and coefficient-context rings, copy finalized bands
  before reuse, and box-filter compatible full-aperture 2x, 4x, and 8x resize
  input directly from bounded YUV rows before RGBA conversion. Compatible
  aligned filter-free alpha auxiliaries use a synchronized second reconstruction
  ring. Every AVIF decoder path now rejects coded payload plus conservatively
  estimated working state above 64 MiB; post-filtered, rotated-alpha, and grid
  paths retain their documented full-frame YUV reconstruction fallback.
- Changed compatible multi-tile AVIF decode to allocate entropy, transform, palette,
  CDEF, and skip contexts for one tile rectangle at a time, then merge compact
  frame-wide post-filter metadata. A pinned 3840x2160 8x2-tile deblock-plus-CDEF
  fixture now decodes within the 64 MiB codec working-set limit, matches
  dav1d/libaom native YUV byte for byte, and retains ordered 32-row output in
  Node.js and Chromium; padded full-frame YUV remains the documented fallback.

- Moved HEIF/HEIC decode to the explicit
  `purejsimage/codecs/experimental/heic` entry, removed it from `allCodecs` and
  the default browser demo, and documented that MIT grants no third-party HEVC
  patent rights.
- Documented when native Sharp is the better performance choice and added measured Lambda sizing
  guidance: 256 MiB completed every pinned 12-megapixel workflow, but 1024 MiB cut the JPEG-to-WebP
  warm operation from 10.6 seconds to 2.5 seconds while peak use remained about 120 MiB.

### Fixed

- Corrected AV1 CDEF primary-direction selection for Kodak's remaining luma
  sample; both full-size Kodak and Fox post-filter fixtures now match agreeing
  dav1d and libaom native YUV byte for byte.
- Added lossy 8-bit AVIF multi-tile reconstruction with independent tile
  contexts and one full-frame deblocking, CDEF, and restoration pass; the pinned
  2x2 YUV 4:2:0 fixture matches agreeing dav1d and libaom native YUV byte for
  byte in Node.js and Chromium.
- Added coded-lossless 10-bit and 12-bit AVIF YUV 4:2:0 decode and filter-free
  lossy 10-bit YUV 4:4:4 decode using the normative depth-specific AV1
  dequantization tables; three pinned fixtures match agreeing dav1d and libaom
  native YUV byte for byte in Node.js and Chromium.
- Added compatible non-reduced AV1 shown key-frame headers and complete
  contiguous tile-group OBU assembly for AVIF decode; a pinned 2x2 YUV 4:2:0
  frame split across four groups matches agreeing dav1d and libaom native YUV
  byte for byte in Node.js and Chromium.
- Bounded compatible filter-free AV1 super-resolution decode to reusable
  upscaled luma and chroma bands instead of full upscaled planes; a pinned
  multi-band YUV 4:2:0 fixture preserves the reconstruction-ring chroma halo in
  Node.js and Chromium. Corrected inherited maximum-RSS high-water accounting:
  the 2048x1536 probe reduces median absolute maximum RSS from 139.2 MB to
  118.1 MB and median peak RSS growth from 40.4 MB to 18.4 MB.
  Peak external and ArrayBuffer growth fall by 49.6% and 50.5%, respectively.
  Memory workers now reject stale inherited high-water marks.
- Added compatible `still_picture=0` AV1 sequence headers for static AVIF items
  containing one shown key frame at maximum dimensions. The pinned 1920x1080
  fixture matches agreeing dav1d and libaom native YUV byte for byte and its
  portable RGBA output is pinned in Chromium.
- Animated `avis` pixel decode now fails with `UNSUPPORTED_OPERATION` instead
  of silently presenting the primary item as a supported one-frame image.
- Corrected AV1 coefficient all-zero contexts to use full coded block dimensions
  across bounded reconstruction chunks and retained palette-mode above context
  across 64-pixel row boundaries. Three pinned FFmpeg/libaom and Sharp/libaom
  fixtures now match agreeing dav1d and libaom native YUV byte for byte in
  Node.js, with their portable RGBA output pinned in Chromium.
- Expanded the checksum-recorded 237-file AVIF compatibility survey to 162
  completed decodes: all 100 GB82 common-photo encodings and 62 of 137
  conformance/invalid/edge inputs. All 116 previously completed RGBA checksums
  remain unchanged, and the sole remaining entropy/reconstruction error is an
  intentionally corrupted conformance input.

- Kept the nested packed-declaration smoke test operational during `npm pack --dry-run`, so the
  documented release gate validates package contents instead of inheriting npm's outer dry-run mode.
- JPEG decoding now treats sampling factors as one for single-component non-interleaved scans,
  tolerantly preserves completed progressive coefficients when a partial scan reaches a DHT, SOS,
  or EOI boundary, and decodes AVI1/MJPEG baseline frames that omit standard Huffman tables. Strict
  progressive decoding continues to reject partial entropy.
- Recognized 12-bit and arithmetic-coded JPEG inputs now fail with `UNSUPPORTED_OPERATION`,
  separating deliberate codec boundaries from supported-subset failures in the Imazen conformance
  baseline.
- TIFF decoding now defers BigTIFF offset validation until an inline value actually needs an
  external offset, recognizes legacy LSB-packed LZW streams with late code-width changes, accepts
  legacy tile tables in strip tags, bounds padded final YCbCr LZW strips, reconstructs multi-strip
  old-style JPEGs with omitted legacy fields, and decodes one-dimensional Group 3 fax rows without
  EOL markers. Recognized 64-bit sample layouts remain structured unsupported boundaries. BMP RLE4
  now accepts the single encoded padding pixel used for odd-width scanlines while retaining overrun
  rejection.
- Animated GIF pixel decode now fails with `UNSUPPORTED_OPERATION` instead of silently discarding
  animation; callers can explicitly request the supported first image with `open(input, { frame: 0 })`.
- Baseline JPEG restart recovery now defaults to tolerant decoding for malformed real-world files;
  pass `open(input, { tolerantDecoding: false })` to require strict restart sequencing. Explicit
  Rust/WASM decoding now implements the same bounded recovery instead of being skipped. JPEG and
  PNG decode accelerator setup or midstream failures now resume through their TypeScript decoders
  without duplicate rows. Focused scalar and SIMD PNG regressions keep trailing `IEND` data,
  full-range `cICP`, and ICC v4 RGB `mAB` color conversion at parity without silently falling back.
  The same corpus-driven work completed those compatibility fixes for the TypeScript reference.

- Removed ambient `Buffer` references from the Node entry's published declarations so strict
  TypeScript consumers can compile the zero-dependency package without installing `@types/node`.
- Changed the default resize kernel from bilinear to scale-aware Lanczos 3 so ordinary downscales
  no longer discard most source samples and alias heavily; strong downscales now use bounded
  streaming box pre-shrink before the final Lanczos pass, format-specialized horizontal kernels,
  opaque-RGBA handling, and a fixed retained-row ring instead of a map. Bilinear remains available
  as an explicit faster, lower-quality option, and benchmark reports identify cross-kernel
  comparisons. On the pinned profiles, the 4× PNG resize fell from 1,253 ms to 530 ms and the
  10× 100-megapixel downscale fell from 8,455 ms to 2,408 ms.

- Allowed the browser demo to convert the supported primary image from iPhone-style MPF JPEGs while
  warning that auxiliary images and gain maps are not preserved; true animated inputs remain blocked.
- Reduced progressive JPEG output with two-pass, scan-specific optimized Huffman tables; the pinned
  quality-80 benchmark moved from 3.29% larger than baseline to 7.26% smaller with identical decoded
  PSNR.
- Corrected AV1 quantization-matrix coefficient-axis lookup and adjusted matrix
  dimensions for 64-point transforms, with q30-q90 YUV and displayed-RGB gates
  against independent libaom, dav1d, Sharp, and Chromium decoders.
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
[0.8.0]: https://github.com/a-r-d/PureJsImage/compare/v0.7.0...v0.8.0
[0.9.0]: https://github.com/a-r-d/PureJsImage/compare/v0.8.0...v0.9.0
[Unreleased]: https://github.com/a-r-d/PureJsImage/compare/v0.9.0...HEAD
