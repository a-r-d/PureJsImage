<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# PNG codec support

This document is the capability contract for PureJsImage's first-party PNG
codec. A checked item is implemented in the current code. An unchecked item is
planned and must not be presented as supported until its output is independently
validated. The correctness section records which implemented paths currently
have focused fixture or benchmark coverage.

## Decode

### Container and compression

- [x] Standard eight-byte PNG signature and `IHDR` detection
- [x] Non-interlaced PNG images
- [x] Zlib/Deflate image-data decompression
- [x] Consecutive single or multiple `IDAT` chunks
- [x] Incremental compressed-data reads and streaming decompression
- [x] PNG row filters 0-4: None, Sub, Up, Average, and Paeth
- [x] `IDAT` CRC validation
- [x] Rejection of unknown critical chunks
- [x] Header-only metadata inspection without inflating image data
- [x] APNG frame-count inspection from `acTL`
- [x] Adam7 interlaced PNG decode
- [ ] APNG frame decode, composition, timing, disposal, and blending
- [x] CRC validation for every chunk during full decode, including `IHDR`,
  `PLTE`, `tRNS`, `IDAT`, ancillary chunks, and `IEND`
- [x] Critical-chunk ordering, uniqueness, and dependency validation, including
  consecutive `IDAT`, indexed-palette, and transparency rules
- [ ] Apple CgBI PNG normalization if real upload fixtures justify supporting
  that non-standard variant

### Pixel formats

- [x] Grayscale, color type 0, at 1, 2, 4, 8, and 16 bits
- [x] Truecolor RGB, color type 2, at 8 and 16 bits
- [x] Indexed color, color type 3, at 1, 2, 4, and 8 bits
- [x] Grayscale with alpha, color type 4, at 8 and 16 bits
- [x] Truecolor RGBA, color type 6, at 8 and 16 bits
- [x] Palette lookup through `PLTE`
- [x] Palette alpha through `tRNS`
- [x] Grayscale and truecolor color-key transparency through `tRNS`
- [x] Packed sub-byte sample extraction and expansion to 8-bit output
- [x] Exact big-endian 16-bit sample output without display normalization
- [x] Output as `gray8`, `rgb8`, `rgba8`, `gray16`, `rgb16`, or `rgba16`
  according to decoded depth and alpha needs
- [ ] Optional lower-bit-depth or indexed output preservation for workflows
  that do not need expanded pixels

### Color and metadata

- [x] Structural grayscale, indexed, and RGB color-family classification from
  the PNG color type
- [x] Alpha-presence reporting from the color type or `tRNS`
- [x] Embedded ICC profile (`iCCP`) parsing and color-managed conversion
- [x] `sRGB`, `gAMA`, and `cHRM` parsing with defined color-conversion behavior
- [x] Common full-range RGB `cICP` signaling for sRGB and Display P3
- [x] EXIF (`eXIf`) metadata parsing for opt-in preservation and orientation
  handling through the public pipeline
- [ ] Physical pixel dimensions (`pHYs`)
- [ ] Text chunks (`tEXt`, `zTXt`, and `iTXt`) with decompression limits
- [ ] Significant bits (`sBIT`), suggested palettes, background color, and
  histogram metadata where application workflows need them
- [x] Opt-in compatible ICC and EXIF preservation, with metadata stripped by
  default

### Memory and execution

- [x] Sequential scanline decode without a source-sized RGBA bitmap
- [x] Bounded 32-row output blocks with only the current and previous encoded
  scanlines retained for filtering
- [x] Fused crop output so pixels outside the requested horizontal region are
  not expanded into output blocks
- [x] Public crop, resize, PNG-to-PNG, and PNG-to-other-codec pipelines
- [x] Declared inflated scanline-size validation before decompression
- [x] Adam7 reconstruction that retains compact native samples only for the
  requested even rows instead of allocating a full source-sized RGBA frame
- [ ] Decoder-driven resize planning to avoid expanding source samples that
  cannot contribute to a large downscale
- [ ] Early termination after the requested bottom crop row while still
  defining whether remaining `IDAT` data and checksums must be validated
- [ ] Fully row-bounded Adam7 reconstruction whose retained state does not scale
  with the requested output height

## Encode

### Implemented target

- [x] First-party non-interlaced PNG encoding
- [x] 8-bit grayscale output from `gray8` input
- [x] 8-bit truecolor RGB output from `rgb8` input
- [x] 8-bit truecolor RGBA output from `rgba8` input
- [x] 16-bit grayscale output from `gray16` input
- [x] 16-bit truecolor RGB output from `rgb16` input
- [x] 16-bit truecolor RGBA output from `rgba16` input
- [x] Exact alpha preservation
- [x] Zlib compression levels 0-9
- [x] Adaptive per-row selection across filters 0-4 when compression is enabled
- [x] Filter-0 output when compression level is 0
- [x] Streaming, top-to-bottom `IDAT` output without a full-frame staging buffer
- [x] CRC generation for every emitted chunk
- [x] Public `image.png()` and `image.encode('png')` APIs
- [x] Buffer and file sinks with cleanup of failed file output

### Planned for common output

- [ ] Indexed palette output with deterministic color quantization
- [ ] 1-, 2-, and 4-bit grayscale or indexed output when the source permits it
- [ ] Grayscale-alpha output without expanding grayscale to RGBA
- [ ] Adam7 interlaced output
- [ ] APNG encoding
- [ ] Configurable filter selection or filter strategy in addition to the
  current adaptive heuristic
- [ ] Additional Deflate strategy and memory controls where they improve Lambda
  peak RSS or output size
- [x] Compatible ICC and EXIF metadata writing when explicitly preserved
- [x] Exact representable `gAMA`, `sRGB`, and supported full-range RGB `cICP`
  signaling for native 16-bit output
- [ ] Chromaticity, physical-dimension, and text metadata writing
- [x] Explicit control over ICC and EXIF stripping versus preservation

## Correctness and safety contract

- [x] Validate dimensions, color-type/bit-depth combinations, chunk extents,
  palette bounds, transparency lengths, filter values, and decoded row counts
- [x] Apply configurable input-size, dimension, pixel-count, frame-count, and
  decoded-byte limits before large allocations
- [x] Bound palette and chunk counts and reject truncated or extra scanlines
- [x] Verify representative RGBA round trips against an independent PNG decoder
- [x] Verify an indexed 8-bit PNG and a 16-bit grayscale PNG against an
  independent PNG decoder
- [x] Verify exact low-byte retention for 16-bit grayscale, RGB, RGBA,
  grayscale-alpha, color-key transparency, Adam7, and transformed round trips
- [x] Verify exact crop pixels and alpha preservation
- [x] Verify adaptive filtering reduces representative smooth-image output size
- [x] Benchmark large, transparent, indexed, cropped, resized, high-entropy, and
  100-megapixel production-style workflows in isolated processes
- [x] Add pinned deterministic fixtures for every legal non-interlaced
  color-type and bit-depth combination, every filter, multiple `IDAT` layouts,
  and each `tRNS` form
- [x] Add a pinned deterministic Adam7 compatibility corpus covering every legal
  color-type and bit-depth combination, crop behavior, and small-image pass edges
- [ ] Add APNG fixtures covering default-image rules, frame rectangles, delay
  denominators, disposal operations, and blend operations
- [x] Add focused malformed fixtures for CRC failures, duplicate and misplaced
  chunks and non-consecutive `IDAT`; bytes after the complete `IEND` datastream
  are ignored for compatibility with padded or concatenated real-world files
- [x] Keep opt-in scalar and SIMD Rust/WASM non-interlaced 8-bit decoding at exact
  pixel parity for trailing `IEND` data, full-range `cICP`, and ICC v4 RGB `mAB`,
  with bounded TypeScript fallback after setup or midstream accelerator failures
- [ ] Add malformed chunk-order, CRC, Deflate, palette, transparency, and
  decompression-bomb fuzzing with strict allocation limits

## JPEG XL pipeline color signals

- [x] Preserve representable sRGB, linear and structured signals for 8-bit as well as 16-bit encoder input
- [x] Preserve requested compatible source ICC bytes through orientation and reject unrepresentable color semantics
