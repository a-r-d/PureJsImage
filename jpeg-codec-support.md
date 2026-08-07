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
- [x] 4:4:4, 4:2:2, and 4:2:0 chroma sampling
- [ ] Pinned compatibility coverage for 4:4:0, 4:1:1, and other valid
  asymmetric sampling layouts
- [x] Image dimensions that do not end on an MCU boundary
- [x] Per-image quantization and Huffman tables
- [x] Entropy byte stuffing and restart intervals (`DRI` / `RST0`-`RST7`)
- [x] Multi-scan progressive DC and AC first-pass and refinement scans
- [ ] Extended sequential 8-bit and 12-bit JPEG (`SOF1`)
- [ ] Lossless JPEG (`SOF3`)
- [ ] Arithmetic-coded sequential, progressive, and lossless JPEG
- [ ] Hierarchical JPEG processes
- [ ] Baseline images split into multiple non-progressive scans
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
- [ ] Metadata preservation when converting or re-encoding a JPEG
- [ ] Higher-quality, chroma-siting-aware upsampling; the current decoder uses
  nearest-sample chroma expansion

### Compound and HDR JPEG files

- [x] Decode and pixel-validate the SDR primary image from a pinned Apple gain-map
  JPEG fixture without misreading its appended secondary image
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
- [ ] Incremental entropy decoding from `ImageSource`; the current pixel decoder
  retains the complete compressed JPEG input
- [ ] Native 1/2, 1/4, and 1/8 scaled IDCT decode for large downscales
- [ ] Decoder-driven resize planning that avoids reconstructing source samples
  which cannot contribute to the output
- [ ] True region decode with restart-marker-assisted seeking where the file
  permits it
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
- [x] Deterministic alpha flattening onto white by default or a requested RGB
  background
- [x] Streaming top-to-bottom encoding with an 8- or 16-row MCU working buffer
  rather than a full output frame
- [x] Edge replication for dimensions that are not multiples of eight
- [x] Public `image.jpeg()` and `image.encode('jpeg')` APIs

### Planned for common output

- [ ] Progressive JPEG encoding
- [ ] Optimized per-image Huffman tables
- [ ] Native single-component grayscale output instead of expanding grayscale
  input to three YCbCr components
- [ ] Faster integer/fixed-point DCT and quantization without changing decoded
  output beyond defined error bounds
- [ ] Restart interval and restart marker output
- [ ] EXIF orientation, ICC, XMP, JFIF density, comment, and application-marker
  writing or preservation
- [ ] Explicit control over metadata stripping versus preservation
- [ ] Custom quantization tables for reproducible advanced workflows
- [ ] CMYK output if real upload or print workflows justify it

## Correctness and safety contract

- [x] Validate marker extents, frame dimensions, component counts, sampling
  factors, table references, scan progression, and entropy reads
- [x] Apply configurable input-size, dimension, pixel-count, and decoded-byte
  limits before large allocations
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
- [x] Measure absolute peak RSS in isolated cold and warm processes for the
  primary large-JPEG resize workflow
- [ ] Continue broadening the compatibility corpus with more phone and camera
  models, image editors, common web upload sources, and a Motion Photo fixture
- [ ] Add dedicated Adobe RGB, 4:4:0, 4:1:1, unusual
  progressive scan, and metadata round-trip fixtures as those capabilities are
  implemented
- [ ] Add malformed-marker, entropy, table, and scan-progression fuzzing with
  strict allocation limits
