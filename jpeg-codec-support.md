<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# JPEG codec support

This document is the capability contract for PureJsImage's first-party JPEG
codec. A checked item is implemented and covered by tests, pinned fixtures, or
the benchmark suite. An unchecked item is planned and must not be presented as
supported until its output is independently validated.

## Decode

### Common JPEG structure

- [x] JPEG detection from the start-of-image marker
- [x] Header-only width, height, bit depth, Adobe/component-ID color-space
  classification, chroma subsampling, MPF image count, and EXIF orientation
  inspection without decoding entropy-coded pixels
- [x] 8-bit baseline sequential DCT with Huffman coding (`SOF0`)
- [x] 8-bit progressive DCT with Huffman coding (`SOF2`)
- [x] Single-component grayscale images
- [x] Three-component YCbCr images
- [x] 4:4:4, 4:4:0, 4:2:2, 4:2:0, and 4:1:1 chroma sampling with pinned
  asymmetric-layout compatibility fixtures
- [x] Image dimensions that do not end on an MCU boundary
- [x] Per-image quantization and Huffman tables
- [x] Entropy byte stuffing and restart intervals (`DRI` / `RST0`-`RST7`)
- [x] Multi-scan progressive DC and AC first-pass and refinement scans
- [x] Extended sequential 8-bit JPEG (`SOF1`)
- [ ] Extended sequential 12-bit JPEG (`SOF1`)
- [ ] Lossless JPEG (`SOF3`)
- [ ] Arithmetic-coded sequential, progressive, and lossless JPEG
- [ ] Hierarchical JPEG processes
- [x] Sequential images split into multiple non-progressive component scans
- [ ] Define-number-of-lines (`DNL`) images whose height is supplied after the
  frame header
- [ ] Abbreviated JPEG and MJPEG frames that omit coding tables and depend on
  tables supplied outside the individual image

### Color and metadata

- [x] Grayscale-to-RGB output
- [x] YCbCr-to-RGB output
- [x] EXIF orientation values 1-8 through explicit `autoOrient()` processing
- [x] Four-component CMYK JPEG decode with an explicit Adobe transform marker
- [x] Adobe YCCK JPEG decode and Adobe color-transform detection
- [x] Three-component JPEGs explicitly encoded as RGB rather than YCbCr
- [x] Ordered multi-segment ICC profile assembly and color-managed conversion
  to sRGB for RGB matrix/TRC profiles and CMYK `lut16` `A2B0` profiles
- [ ] Broader ICC transform coverage, including `lut8`, multi-process-element,
  device-link, gray, and uncommon parametric or sampled profile forms
- [ ] Full EXIF, XMP, IPTC/IIM, Photoshop image-resource, JFIF density,
  comment, and application-marker exposure
- [x] Opt-in compatible ICC and EXIF preservation, with metadata stripped by
  default
- [x] Bounded-row, chroma-siting-aware bilinear upsampling with horizontal and
  vertical halo samples across MCU-row boundaries

### Compound and HDR JPEG files

- [x] Decode and pixel-validate the SDR primary image from pinned Apple and
  self-contained Android-style Ultra HDR gain-map JPEG fixtures without
  misreading their appended secondary images
- [x] Header-only MPF image-count inspection; the pinned Apple gain-map fixture
  reports its two constituent images
- [ ] Ultra HDR / JPEG_R and ISO 21496-1:2025 gain-map discovery, HDR
  reconstruction, encoding, and preservation
- [ ] Multi-Picture Format (`MPF` / `MPO`) secondary-image enumeration and
  selection for gain maps, depth maps, stereo pairs, bursts, and other
  auxiliary images
- [ ] Motion Photo XMP and appended-video discovery, extraction, and
  preservation

### Memory and execution

- [x] Baseline reconstruction in bounded MCU rows without a source-sized RGB
  or RGBA bitmap
- [x] Crop-aware RGB emission so pixels outside the requested output region are
  not materialized
- [x] Progressive coefficient retention in compact 16-bit planes, followed by
  bounded-row RGB reconstruction
- [x] Public crop, resize, auto-orient, JPEG-to-JPEG, and JPEG-to-other-codec
  pipelines
- [x] Incremental header and entropy decoding from `ImageSource` without retaining
  the complete compressed JPEG input
- [x] Native 1/2, 1/4, and 1/8 scaled IDCT decode for baseline and progressive
  JPEGs, including restart-marker and common subsampling paths
- [x] Decoder-driven resize planning for full-frame downscales; it selects the
  largest safe denominator that still supplies the requested output dimensions
  and avoids reconstructing discarded full-resolution MCU samples
- [x] Restart-marker-assisted region seeking plus skipped IDCT and color work for
  MCUs outside the requested crop where the file permits it
- [ ] Lossless coefficient-domain rotate, flip, transpose, and MCU-aligned crop
  without decoding and re-encoding pixels
- [ ] Reduce progressive coefficient memory further where scan dependencies and
  coefficient ranges permit a smaller representation

## Encode

### Implemented target

- [x] First-party 8-bit baseline sequential DCT with Huffman coding (`SOF0`)
- [x] JFIF output with three YCbCr components
- [x] Configurable 4:2:0, 4:2:2, and 4:4:4 output sampling, with 4:2:0 as the
  photographic default
- [x] Quality control from 1-100 using scaled luminance and chrominance
  quantization tables
- [x] Standard luminance and chrominance Huffman tables
- [x] `gray8`, `rgb8`, and `rgba8` pipeline input
- [x] Native one-component grayscale output for `gray8` input
- [x] Configurable `DRI` restart intervals with ordered `RST0`-`RST7` markers and
  DC predictor resets
- [x] Deterministic alpha flattening onto white by default or a requested RGB
  background
- [x] Streaming top-to-bottom encoding with an 8- or 16-row MCU working buffer
  rather than a full output frame
- [x] Edge replication for dimensions that are not multiples of eight
- [x] Public `image.jpeg()` and `image.encode('jpeg')` APIs

### Planned for common output

- [ ] Progressive JPEG encoding
- [ ] Optimized per-image Huffman tables
- [ ] Faster integer/fixed-point DCT and quantization without changing decoded
  output beyond defined error bounds
- [x] Compatible ICC and EXIF metadata writing when explicitly preserved
- [ ] XMP, JFIF density, comment, and application-marker writing or preservation
- [x] Explicit control over ICC and EXIF stripping versus preservation
- [ ] Custom quantization tables for reproducible advanced workflows
- [ ] CMYK output if real upload or print workflows justify it

## Correctness and safety contract

- [x] Validate marker extents, frame dimensions, component counts, sampling
  factors, table references, scan progression, and entropy reads
- [x] Apply configurable input-size, dimension, pixel-count, decoded-byte, compact
  coefficient, scan-count, restart-index, and ICC limits before large allocations
- [x] Reject truncated files and unsupported coding processes explicitly
- [x] Compare baseline grayscale, 4:4:4, 4:2:2, 4:2:0, and restart-marker
  fixtures against an independent development oracle
- [x] Compare progressive output pixels against an independent development
  oracle
- [x] Compare CMYK and YCCK output against an independent development oracle,
  and exercise RGB matrix/TRC and CMYK LUT ICC transforms with focused fixtures
- [x] Pin and pixel-validate libultrahdr ICC and Apple gain-map fixtures plus
  Web Platform Tests' progressive MozJPEG RGB and YUV browser fixtures
- [x] Decode encoded output independently and require correct dimensions and
  pixels before benchmark timing counts
- [x] Gate both libjpeg-to-PureJsImage decode and
  PureJsImage-to-libjpeg encode/decode paths with PSNR floors in CI
- [x] Measure absolute peak RSS in isolated cold and warm processes for the
  primary large-JPEG resize workflow
- [x] Compare 1/2, 1/4, and 1/8 output against the full-resolution resize path
  and report decoded pixels avoided, wall time, absolute peak RSS, MAE, and
  PSNR from isolated processes
- [ ] Continue broadening the compatibility corpus with more phone and camera
  models, image editors, common web upload sources, and a Motion Photo fixture
- [x] Add checksum-pinned generated Adobe RGB, 4:4:0, 4:1:1, SOF1, sequential
  multi-scan, and unusual progressive scan fixtures
- [x] Add structured malformed-marker, entropy, table, restart, sampling, and
  scan-progression regressions with strict allocation and source-cleanup checks
- [x] Define provider-neutral metadata, pixel, limit, and typed-error vectors for
  later explicit WASM parity testing
