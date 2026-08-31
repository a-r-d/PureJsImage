<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# JPEG XL lossless-first support plan

This document is the implementation plan and eventual capability contract for
PureJsImage's first-party JPEG XL project has separate targets for static pixel
decode, pixel-lossless Modular encoding, and coefficient-domain JPEG transcoding
with exact JPEG reconstruction. Only the checked items below are implemented.

## Current implementation note

A JPEG XL input is either a raw codestream beginning with its two-byte signature or a
box container beginning with the fixed signature box. The container then carries an
`ftyp` box and either one `jxlc` codestream box or indexed `jxlp` fragments. The
first-party codec validates these structures and returns bounded source ranges
without concatenating compressed data. Raw, single-`jxlc`, ordered `jxlp`, and
file-format-version-1 out-of-order `jxlp` codestreams can enter the implemented
pixel subset through one logical segmented source.

The current pixel milestone decodes pinned native 8/10/12/16-bit grayscale, 8-bit
grayscale with alpha, 8-bit RGB, and official 9-bit and 12-bit RGBA lossless Modular
fixtures. It parses image and frame headers, global or local MA trees, prefix and ANS
entropy, bounded LZ77 including group-aware special distances, adaptive properties,
nonzero residuals, the documented Modular predictors, reversible color transforms,
ordinary and delta palettes, palette-index prediction, and horizontal, vertical,
multi-channel, and odd-size squeeze transforms in reverse dependency order.
Compatible multi-group grayscale validates
ordered or permuted table-of-contents entries and dependencies, supports shared global or
per-group local MA trees, decodes only crop-intersecting groups, supports crops crossing
group boundaries, and releases each completed group-row band. The decoder emits native
`gray8`, big-endian `gray16`, `rgb8`, big-endian `rgb16`, `rgba8`, or big-endian `rgba16` rows with per-channel display
ranges. The pinned multi-group 8-bit fixtures and native grayscale matrix match exact
independent `djxl` pixels; official high-bit RGBA fixtures retain their documented exact or
one-sample tolerance. The exact libjxl v0.12.0 matrix records 29 exact decodes, zero
mismatches, and four explicit unsupported results. Premultiplied alpha, shifted or DC
group channels, custom color descriptions, multiple frames, and all VarDCT syntax remain
explicit unsupported operations.

A checked implementation item is already present and tested in the repository.
An unchecked item is not supported yet. Items in deferred groups do not block
the first release and must remain explicit unsupported cases until implemented
and independently validated.

## Scope decisions

- [x] Prioritize static `image/jxl` decode for upload-processing workflows
- [x] Decode bare JPEG XL codestreams and single-`jxlc` box-based containers for
  the implemented Modular subset
- [ ] Implement both Modular and VarDCT decoding; neither mode alone covers the
  common lossless and lossy image set
- [ ] Decode JPEG-lossless-transcode codestreams to pixels without requiring
  bit-exact reconstruction of the original `.jpg` file
- [x] Make one full-canvas still image the first public milestone
- [ ] Apply orientation and color conversion during the pipeline rather than
  returning incorrectly oriented or raw XYB samples
- [x] Keep `libjxl`, `djxl`, `jxlinfo`, and other implementations as pinned
  development-only references and oracles
- [x] Implement production decoding in this repository without a runtime codec
  dependency, native library, WebAssembly module, or copied third-party code
- [ ] Add a constrained pixel-lossless Modular encoder through the normal pipeline
- [ ] Add explicit coefficient-domain JPEG transcode and exact reconstruction APIs

## Planned lossless-first output boundary

The planned ordinary encoder is a constrained mathematically lossless Modular
pixel encoder. It will not claim original-file reconstruction. Exact JPEG
recompression is a separate coefficient-domain API with byte-equality gates.
A general-purpose lossy VarDCT encoder is outside this project.

## Group 0: detection, container, and metadata — required for v1

### Content detection

- [x] Recognize the two-byte bare-codestream signature
- [x] Recognize the 12-byte JPEG XL container signature box and fixed signature
  payload
- [x] Use content detection for codec selection; `.jxl` and `image/jxl` are
  hints rather than proof of valid input
- [x] Distinguish a bare codestream from a container before parsing any image
  dimensions or allocating decode state
- [x] Reject truncated signatures and lookalike box files explicitly

### Container parsing

- [x] Parse big-endian box headers with 32-bit lengths, extended 64-bit lengths,
  and boxes extending to end-of-file
- [ ] Validate every box length, nesting level, order, and end offset before
  reading or allocating
- [x] Parse the signature and file type (`ftyp`) boxes and validate the JPEG XL
  brand and supported file-format version
- [x] Read one complete codestream from a `jxlc` box without copying it
- [x] Reassemble ordered and file-format-version-1 out-of-order `jxlp` boxes through a
  bounded segmented reader rather than concatenating them
- [x] Validate `jxlp` indexes, final-fragment signaling, uniqueness, ordering,
  and total compressed-byte limits
- [x] Parse JPEG XL level (`jxll`) and bound frame-index (`jxli`) boxes sufficiently to
  validate and skip them safely
- [x] Skip unknown non-essential boxes by validated extent
- [x] Reject conflicting `jxlc`/`jxlp` representations, missing codestream data,
  duplicate required boxes, and malformed box ordering

### Metadata boxes

- [x] Locate bounded EXIF (`Exif`), XML (`xml `), JUMBF (`jumb`), and JPEG
  reconstruction (`jbrd`) boxes without parsing them during pixel decode
- [x] Recognize Brotli-compressed metadata (`brob`) and skip it safely until a
  bounded first-party Brotli decoder is available
- [x] Expose metadata presence and byte sizes without returning unchecked box
  contents by default
- [ ] Define explicit metadata preservation and stripping behavior for
  JXL-to-other-codec pipelines
- [ ] Keep JPEG bitstream reconstruction data independent from image pixel
  decode

### Metadata-only inspection

- [x] Parse basic image information without entropy-decoding image groups for the implemented subset
- [x] Expose bounded immutable inspection for the implemented Modular subset with
  structure, dimensions, orientation, bit depth, channels, alpha, color, level,
  metadata sizes, expected output format, and resource estimates
- [ ] Report width, height, orientation, bit depth, exponent bits, color channel
  count, extra channels, alpha, animation, preview, intrinsic dimensions, color
  description, frame count, and codec level
- [x] Apply configurable input, dimension, pixel, channel, frame, and metadata
  limits before starting full decode
- [x] Register `jpegxlCodec` with format `jpegxl` and MIME type `image/jxl` on the public codec surface

## Group 1: common static codestream decode — required for v1

This group defines the smallest credible JPEG XL upload decoder. It covers the
ordinary output of independent encoders for photographs, graphics, and
losslessly transcoded JPEG files.

### Bitstream and entropy foundation

- [x] Implement a bounded least-significant-bit-first bit reader with exact
  end-of-section checks
- [x] Decode JPEG XL fixed-width fields, compact integers, U32 distributions,
  signed values, and bounded enumerations
- [x] Parse the codestream and frame-header fields, group dimensions, and section
  sizes required by the implemented lossless Modular subset
- [x] Implement the bounded prefix and ANS entropy structures exercised by the
  pinned conformance fixture, including context maps and final-state validation
- [x] Implement bounded LZ77 distances, lengths, repeat offsets, and copies
  across entropy-coded streams
- [x] Reject invalid distributions, impossible symbols, non-final ANS states,
  LZ77 underflow/overflow, and reads past a declared section
- [ ] Support JPEG XL Level 5 codestream features within tighter configurable
  project limits
- [ ] Detect Level 10 inputs and reject them unless every required feature and
  resource limit is supported

### Modular mode

- [x] Parse the global and group headers, unshifted channel dimensions, group origins,
  section dependencies, and stream identifiers required by compatible multi-group Modular images
- [x] Decode meta-adaptive trees with bounded depth, node count, property
  ranges, and context count
- [x] Implement the required Modular predictors, including weighted prediction
  and its state updates
- [x] Decode residuals through the selected predictor and reconstruct signed
  channel samples without overflow
- [x] Complete palette transforms, including delta palettes and palette-index
  prediction
- [x] Implement and independently verify the pinned fixture's reversible color
  transform
- [x] Implement squeeze transforms for horizontal, vertical, and multi-channel
  reconstruction, including odd dimensions
- [x] Apply inverse Modular transforms in the exact reverse dependency order
- [x] Support single-group and compatible multi-group Modular images with shared
  global or per-group local MA trees and unshifted grouped channels
- [x] Support native 8/10/12/16-bit lossless grayscale and the documented RGB/RGBA subset
- [ ] Support Modular sub-images used by VarDCT for low-frequency and control
  data
- [x] Verify the implemented mathematically lossless Modular fixture with exact samples

### VarDCT mode

- [ ] Parse LF global data, LF groups, HF global data, HF passes, and pass-group
  sections with validated sizes and dependencies
- [ ] Decode quantizer fields, dequantization matrices, block strategies,
  coefficient orders, context models, and chroma-from-luma factors
- [ ] Reconstruct DC and low-frequency images before dependent high-frequency
  groups
- [ ] Decode progressive high-frequency passes and accumulate coefficients in
  the correct order
- [ ] Implement every transform strategy required by the common corpus,
  including square DCT, rectangular DCT, AFV, and Hornuss families
- [ ] Apply inverse transforms, coefficient scaling, quantization bias, and
  block placement with defined numeric precision
- [ ] Reconstruct XYB samples and perform the inverse opsin transform
- [ ] Decode valid chroma subsampling and upsampling modes
- [ ] Implement Gaborish and edge-preserving restoration filters with the
  required group-boundary halo
- [ ] Decode and render patches, splines, and synthetic noise when signaled by a
  valid static image
- [ ] Decode VarDCT images created from ordinary lossy sources
- [ ] Decode the image pixels of JPEG-lossless-transcode codestreams
- [ ] Compare lossy output with conformance references using documented numeric
  tolerances

### Static frame and output

- [x] Decode one visible full-canvas frame with the default replace behavior
- [ ] Skip a declared preview and decode the main image by default
- [ ] Reject animation, multiple visible frames, non-default blending, reference
  frame dependencies, and partial-canvas frame composition until Group 2
- [ ] Apply all eight orientation values exactly once
- [ ] Return display dimensions after orientation
- [x] Emit bounded, ordered `gray8`, big-endian `gray16`, `rgb8`, big-endian `rgb16`, `rgba8`, or big-endian `rgba16` pixel blocks for the implemented subset
- [ ] Support JXL-to-JPEG, JXL-to-PNG, JXL-to-WebP, crop, resize, and
  resize-plus-encode workflows

### Common samples, alpha, and color

- [x] Native integer grayscale at 8, 10, 12, and 16 bits per sample
- [x] Complete integer RGB coverage at 8, 10, 12, and 16 bits per sample for the current single-group Modular boundary
- [x] One alpha extra channel with independent precision
- [ ] Unassociated and premultiplied alpha with correct unpremultiplication or
  preservation behavior
- [ ] Parse the encoded color encoding: color space, white point, primaries,
  transfer function, and rendering intent
- [ ] Decode compressed embedded ICC profiles with strict decoded-size limits
- [ ] Render common sRGB, linear sRGB, Display P3, and gray inputs to the
  pipeline's declared output color space
- [x] Handle grayscale and RGB codestream color representations for the compatible Modular subset
- [ ] Handle XYB codestream color representations
- [x] Preserve native 9-bit and 12-bit integer samples in `rgba16` with per-channel
  display ranges, normalizing only when an 8-bit transform or encoder requires it
- [ ] Reject unsupported color encodings or extra-channel semantics rather than
  treating their samples as sRGB or alpha

## Group 2: common compatibility improvements — should have

These features occur in real JPEG XL files, but a correct single-frame upload
decoder can ship before all of them are complete.

- [ ] Embedded preview decode and explicit preview selection
- [ ] Multiple frames required internally by a still image
- [ ] Frame crops, reference slots, save-as-reference behavior, and blend modes
- [ ] Coalesced first-frame output for animated inputs without claiming full
  animation support
- [ ] Out-of-order `jxlp` fragments permitted by newer container versions
- [ ] JPEG bitstream reconstruction from `jbrd` to the exact original JPEG file
- [ ] HDR inputs using PQ, HLG, linear-light, and floating-point samples
- [ ] Tone-mapping metadata, intensity target, luminance range, and a documented
  SDR conversion policy
- [ ] Wide-gamut Rec. 2020, Adobe RGB, ProPhoto RGB, and uncommon ICC profiles
- [ ] CMYK through a black extra channel and an applicable color profile
- [ ] Spot-color, selection-mask, depth, and black extra-channel discovery and
  opt-in extraction
- [ ] Multiple alpha channels with explicit caller selection
- [ ] Intrinsic-size and pixel-density metadata
- [ ] Metadata decode for EXIF, XMP/XML, and JUMBF
- [ ] Bounded first-party decompression of `brob` metadata boxes
- [ ] JPEG XL Level 10 features that remain within explicit project limits

## Group 3: JPEG XL advantages — nice to have

- [ ] Progressive preview output from DC, low-frequency, and successive
  high-frequency passes
- [ ] Public reduced-resolution decode without reconstructing discarded
  high-frequency detail
- [x] Group-aware region decode for compatible multi-group Modular crops
- [ ] Decoder-driven downscale that selects only the resolution and passes
  capable of contributing to the requested output
- [x] Expose native high-bit integer decoder output through the shared `rgba16` pixel model
- [ ] Optional floating-point pipeline output
- [ ] Opt-in extraction of depth, thermal, CFA, spot-color, and selection-mask
  extra channels
- [ ] Non-coalesced frame access for applications that need individual frames
- [ ] Diagnostics identifying the box, frame, LF group, pass group, entropy
  stream, transform, or extra channel that caused a failure

## Group 4: explicitly skip

These unchecked items are outside the initial decode-only plan and do not block
JPEG XL v1.

- [ ] Animated output, animation timing, looping, and full multi-frame
  composition
- [ ] Re-encoding or editing frame references
- [ ] Producing an original JPEG reconstruction as a default decode result
- [ ] Unbounded or arbitrary user access to container boxes
- [ ] Encrypted, externally referenced, or vendor-private container extensions
- [ ] Undocumented experimental codestream extensions
- [ ] Treating every extra channel as displayable image data

## Memory and execution contract

- [ ] Bound compressed bytes, box count, metadata bytes, dimensions, pixels,
  frames, channels, extra channels, groups, LF groups, pass groups, passes,
  histograms, contexts, tree nodes, transforms, patches, splines, and decoded
  working bytes separately
- [ ] Use checked arithmetic for canvas and group geometry, channel shifts,
  strides, sample counts, coefficient counts, section sizes, patch extents,
  spline points, LZ77 copies, and allocations
- [x] Read `jxlc` and `jxlp` through segmented views without duplicating the
  compressed codestream
- [x] Decode compatible Modular groups in dependency order, retaining only crop-intersecting
  groups in one group-row band and releasing the band after output
- [ ] Release VarDCT entropy tables, coefficients, restoration buffers, and reference
  state as soon as later groups cannot reference them
- [x] Use compact signed channel planes and one bounded output row rather than a
  second source-sized RGBA decoder boundary for the implemented Modular subset
- [x] Push crop requirements into compatible Modular group selection
- [ ] Push resize and reduced-resolution requirements into group and pass selection
- [ ] Account for concurrent input, section indexes, entropy state, LF images,
  coefficients, Modular transforms, restoration halos, extra channels, color
  conversion, resize state, and encoded output
- [ ] Make any full-frame state required by patches, reference frames, or
  Modular transforms compact, explicit, and separately benchmarked
- [ ] Do not let an optional feature silently turn the normal static-photo path
  into a source-sized float RGB or RGBA allocation

## Correctness and hostile-input contract

- [ ] Treat every box, compact integer, dimension, section size, entropy
  distribution, tree node, symbol, LZ77 copy, transform, coefficient, group,
  patch, spline, frame, ICC field, and extra channel as hostile input
- [ ] Validate the complete allocation graph before allocating large planes or
  coefficient buffers
- [ ] Reject recursive or excessively deep trees, invalid context maps,
  impossible ANS states, oversized histograms, transform cycles, and invalid
  channel dependencies
- [ ] Validate patch source/destination rectangles, spline point counts, filter
  halos, frame crops, blend rectangles, and reference indexes before access
- [ ] Bound compressed ICC and Brotli metadata expansion independently from
  pixel decode
- [ ] Reject unsupported extensions using their declared lengths without
  attempting best-effort entropy decode
- [ ] Add fuzz targets for the bare codestream parser, container parser,
  entropy decoder, Modular transforms, VarDCT reconstruction, color metadata,
  and frame composition
- [ ] Turn every upstream libjxl security advisory relevant to accepted syntax
  into a local hostile-input regression test without copying its fix

## Reference implementations and conformance

- [x] Pin `libjxl` and its `djxl`/`jxlinfo` tools at an exact development-oracle
  version
- [ ] Study libjxl's module boundaries, supported features, test taxonomy,
  low-memory behavior, and security history without copying or mechanically
  translating its implementation
- [x] Pin the official JPEG XL conformance corpus and reference decoded outputs
  at an exact commit
- [ ] Run every applicable conformance codestream through PureJsImage and record
  unsupported cases separately from incorrect pixels
- [ ] Use a second independent decoder, such as a pinned `jxl-oxide` build, to
  investigate disagreements with libjxl
- [ ] Never use conformance to replace project-specific hostile-input, memory,
  crop, resize, and pipeline tests

## Fixtures and benchmarks

- [ ] Pin redistributable fixtures from at least two independent encoders
- [ ] Include bare and container files, `jxlc` and `jxlp`, Modular and VarDCT,
  lossless and lossy, JPEG-transcoded, grayscale, RGB, alpha, 8/10/12/16-bit,
  ICC, orientation, odd dimensions, multiple groups, and progressive passes
- [ ] Include realistic photos, transparent graphics, screenshots, high-entropy
  images, wide-gamut images, and a large downscale workload
- [ ] Record provenance, license, encoder/version, container form, dimensions,
  orientation, bit depth, channels, extra channels, color encoding, mode,
  frames, groups, passes, level, feature flags, and checksums
- [x] Verify native high-bit samples for lossless Modular fixtures against official conformance outputs
- [ ] Use conformance-defined or documented numeric tolerances for VarDCT, XYB,
  ICC, restoration-filter, and HDR output
- [x] Verify every recorded benchmark output before recording speed or memory
- [x] Record isolated full-decode and crop memory for a checksum-pinned 4096x4096
  multi-group fixture with a permuted table of contents and per-group local MA trees
- [ ] Benchmark metadata, full decode, JXL-to-JPEG, JXL-to-PNG, crop, resize,
  reduced-resolution resize, and resize-plus-encode workflows
- [ ] Measure cold and warm absolute peak RSS, RSS delta, external memory, and
  ArrayBuffer memory in isolated processes
- [ ] Compare upload workflows with pinned `djxl`; record Jimp as unsupported
  rather than treating failed decode as a performance result
- [ ] Include malformed container, fragment, header, entropy, LZ77, MA-tree,
  palette, squeeze, VarDCT, patch, spline, ICC, frame, and allocation-limit
  fixtures

## Decode v1 is complete when

- [ ] Group 0 and Group 1 are implemented and covered by pinned fixtures
- [ ] Unimplemented Group 2-4 features fail explicitly rather than producing
  plausible but incorrect pixels
- [ ] Lossless Modular and JPEG-transcoded reference images decode to the
  expected pixels
- [ ] VarDCT output meets the conformance tolerances
- [ ] Static `image/jxl` Buffer input can be inspected, oriented, resized, and
  converted to JPEG or PNG through the public pipeline
- [ ] The common large-photo resize path does not allocate a full
  source-resolution float RGB or RGBA bitmap
- [ ] Independent oracles confirm dimensions, orientation, color, alpha, and
  decoded pixels
- [ ] `npm run check` and the isolated JPEG XL fixture and benchmark
  verification pass

## Standards and implementation references

- [ISO/IEC 18181-1:2024 — JPEG XL core coding system](https://www.iso.org/standard/85066.html)
- [ISO/IEC 18181-2:2026 — JPEG XL file format](https://www.iso.org/standard/91379.html)
- [ISO/IEC 18181-3:2025 — JPEG XL conformance testing](https://www.iso.org/standard/87633.html)
- [JPEG Committee: JPEG XL overview](https://jpeg.org/jpegxl/)
- [JPEG Committee: JPEG XL documentation](https://jpeg.org/jpegxl/documentation.html)
- [IANA media type registry](https://www.iana.org/assignments/media-types/media-types.xhtml)
- [`libjxl` reference implementation](https://github.com/libjxl/libjxl)
- [Official JPEG XL conformance corpus](https://github.com/libjxl/conformance)
