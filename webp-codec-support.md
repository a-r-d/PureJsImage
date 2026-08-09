<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# WebP codec support

This document is the capability contract for PureJsImage's first-party WebP
codec. A checked item is implemented in the current code. An unchecked item is
planned and must not be presented as supported until its output is independently
validated. The correctness section records the current fixture and benchmark
coverage.

## Decode

### RIFF container and image layout

- [x] RIFF `WEBP` detection and bounded chunk-extent parsing
- [x] Simple lossy WebP with a `VP8 ` image chunk
- [x] Simple lossless WebP with a `VP8L` image chunk
- [x] Extended static WebP with a `VP8X` canvas
- [x] Extended lossy WebP with a separate `ALPH` chunk
- [x] RIFF odd-length chunk padding
- [x] Canvas dimensions and alpha-presence metadata
- [x] Animated-image detection and `ANMF` frame counting
- [x] Explicit rejection of animated WebP pixel decode
- [ ] Animated WebP frame parsing, timing, blending, disposal, and canvas
  composition
- [ ] Complete `VP8X` reserved-bit, feature-flag, chunk-order, uniqueness, and
  chunk-dependency validation
- [ ] Incremental RIFF parsing; metadata and pixel decode currently retain the
  complete compressed WebP input

### Lossless VP8L pixels

- [x] 8-bit ARGB lossless pixel reconstruction
- [x] Normal and simple Huffman code representations
- [x] Literal pixels
- [x] LZ77 backward references and two-dimensional distance mapping
- [x] Color caches
- [x] Spatially varying Huffman entropy groups
- [x] Predictor transform
- [x] Color transform
- [x] Subtract-green transform
- [x] Color-indexing transform and packed palette indices
- [x] Exact alpha reconstruction
- [ ] Bounded-row or tiled lossless reconstruction without retaining a full
  32-bit source pixel plane
- [ ] Avoid duplicate full-frame storage while reversing color-indexing and
  other transforms

### Lossy VP8 pixels

- [x] Intra-coded VP8 key frames, bitstream versions 0-3
- [x] Boolean entropy decoding and updated coefficient probabilities
- [x] Segmentation maps, segment quantizers, and segment filter levels
- [x] One, two, four, and eight coefficient token partitions
- [x] Macroblock and 4x4 luma intra prediction modes
- [x] Chroma intra prediction
- [x] Skip signaling, coefficient token decoding, dequantization, and inverse
  transforms
- [x] Normal and simple in-loop deblocking filters, including sharpness and
  reference/mode deltas
- [x] YUV 4:2:0 to 8-bit RGB conversion
- [x] Raw extended alpha
- [x] VP8L-compressed extended alpha
- [x] None, horizontal, vertical, and gradient alpha filtering
- [ ] Bounded macroblock-row VP8 reconstruction without full Y, U, V, and RGBA
  frame allocations
- [ ] Crop- and resize-aware reconstruction that avoids RGB conversion for
  pixels which cannot contribute to the output
- [ ] Higher-quality chroma-siting-aware upsampling instead of nearest chroma
  sample selection
- [ ] Alpha-plane reconstruction in bounded rows

### Color and metadata

- [x] Static image width, height, alpha, bit-depth, and frame-count reporting
- [x] Opaque, binary-alpha, and partial-alpha output through `rgba8`
- [x] Embedded ICC profile (`ICCP`) parsing and color-managed conversion
- [x] EXIF metadata parsing for opt-in preservation and orientation handling
  through the public pipeline
- [ ] XMP metadata parsing
- [x] Opt-in compatible ICC and EXIF preservation, with metadata stripped by
  default

### Pipeline execution

- [x] Region selection from the decoded pixel plane
- [x] Bounded 32-row `rgba8` output blocks after full-frame reconstruction
- [x] Public crop, resize, WebP-to-WebP, and WebP-to-other-codec pipelines
- [ ] True region decode rather than cropping a fully reconstructed source
  frame
- [ ] Decoder-driven scaled output for large downscales

## Encode

### Lossless implemented target

- [x] First-party static VP8L encoding
- [x] Exact 8-bit RGB and alpha preservation
- [x] `gray8`, `rgb8`, and `rgba8` pipeline input
- [x] Ordered pixel input staged in one 32-bit transformed frame with two
  predictor rows; the encoded payload is buffered so the RIFF length is known
  before output begins
- [x] Block-adaptive predictor transform across all 14 VP8L modes with
  VP8L-specified top-row, left-column, and right-edge behavior
- [x] Subtract-green transform
- [x] LZ77 backward references with adjacent-pixel, previous-row, and 16 recent
  hash-bucket match candidates plus two-dimensional VP8L distance coding
- [x] Adaptive 8-to-10-bit color-cache emission for repeated transformed colors
- [x] Per-image adaptive canonical Huffman trees with a complete-tree fallback
- [x] Public `image.webp({ lossless: true })` and
  `image.encode('webp', { lossless: true })` APIs

### Lossless planned

- [ ] Spatially varying Huffman entropy groups
- [ ] Cross-color and color-indexing transform selection
- [ ] Compression-effort controls and better output-size optimization
- [ ] Near-lossless WebP encoding

### Lossy implemented target

- [x] First-party static intra-only VP8 encoding
- [x] Quality control from 1-100
- [x] YUV 4:2:0 output
- [x] `gray8`, `rgb8`, and `rgba8` pipeline input
- [x] Exact alpha preservation through an uncompressed `ALPH` chunk when needed
- [x] 4x4 luma and 8x8 chroma DC prediction
- [x] Forward transforms, quantization, coefficient coding, and standard
  coefficient probabilities
- [x] Public `image.webp()` and `image.encode('webp')` APIs

### Lossy planned

- [ ] Bounded macroblock-row encoding; the current encoder retains full Y, U,
  V, optional alpha, reconstruction, and output buffers
- [ ] Rate-distortion-driven luma and chroma prediction-mode selection
- [ ] 16x16 luma prediction and Walsh-Hadamard Y2 coding where beneficial
- [ ] Adaptive coefficient probabilities and optimized token partitions
- [ ] Segmentation, skip decisions, and per-segment quantization
- [ ] Normal or simple loop-filter selection and tuning
- [ ] Compressed and filtered `ALPH` output
- [ ] Better quality-to-quantizer mapping and compression-effort controls
- [ ] Output-size targeting and perceptual quality tuning

### Common container output planned

- [ ] Animated WebP encoding
- [x] ICC and EXIF writing when explicitly preserved
- [ ] XMP writing or preservation
- [x] Explicit control over ICC and EXIF stripping versus preservation

## Correctness and safety contract

- [x] Validate RIFF and chunk extents, VP8/VP8L dimensions, lossless transform
  structure, Huffman trees, references, partitions, and entropy reads
- [x] Apply configurable input-size, dimension, pixel-count, frame-count, and
  decoded-byte limits before decoding
- [x] Reject truncated files, unsupported animations, VP8 interframes, reserved
  color-space modes, and unsupported alpha compression explicitly
- [x] Verify six independently encoded, checksum-pinned static fixtures from the
  official WebP galleries and Wikimedia Commons
- [x] Check exact lossless reference pixels and tolerance-bounded lossy reference
  pixels
- [x] Cover odd dimensions, transparent lossless graphics, lossy photographs,
  and compressed lossy alpha in the permanent benchmark profile
- [x] Benchmark metadata, decode, conversion, crop, resize, lossy encode, and
  lossless encode in isolated processes
- [x] Gate lossy decode against a pinned libwebp encode and gate lossy encode
  through an independent libwebp decode with PSNR floors in the focused test
  suite
- [x] Decode benchmark WebP output in a separate libwebp-backed oracle process
  and require pinned pixels before accepting a timing
- [x] Decode lossless encoder output through pinned Sharp/libwebp and require
  exact RGBA pixels, including deterministic high-entropy and graphic fixtures
- [x] Require deterministic PNG and JPEG-decoded graphics' lossless WebP output
  to remain smaller than PureJsImage PNG, and record the pinned production-style logo result
  alongside libwebp in an isolated size and peak-RSS benchmark
- [x] Document and benchmark the lossless encoder's source-sized 32-bit
  transformed frame and potentially source-sized buffered payload
- [ ] Account for cumulative VP8/VP8L planes, transforms, alpha, and output in a
  dedicated working-memory limit; the general decoded-byte limit does not yet
  represent every simultaneous allocation
- [ ] Expand the pinned corpus across independent libwebp versions, browsers,
  graphics tools, and real upload sources
- [x] Cover ICC and EXIF preservation with focused round-trip fixtures
- [ ] Add animated, XMP, unusual partition, alpha-preprocessing, and
  transform-stress fixtures as those capabilities are implemented
- [ ] Add malformed RIFF, chunk, Huffman, LZ77, VP8 partition, coefficient, and
  decompression-bomb fuzzing with strict allocation limits
