<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# JPEG XL lossless-first support plan

This document is the capability contract for PureJsImage's first-party JPEG XL
project. It has separate targets for static pixel
decode, pixel-lossless Modular encoding, and coefficient-domain JPEG transcoding
with exact JPEG reconstruction. Only the checked items below are implemented.

## M10 Level 10 native precision and profiles

- [x] Verify a machine-readable Level 5 and Level 10 map for syntax, metadata, rendered pixels, raw channels, display conversion, encoding, reconstruction and limits
- [x] Decode the official binary32 fixture bit exactly with 64-bit weighted-predictor working values and intentional 32-bit sample wrap
- [x] Preserve unsigned integer samples through the JPEG XL maximum of 31 bits and IEEE binary16/binary32 bit patterns through bounded native lossless encoding
- [x] Select the minimum valid output level, emit jxll=10 for Level 10 and reject conflicting raw or Level 5 requests
- [x] Include dimensions, total pixels and ICC profile size in automatic Level 5 or Level 10 selection
- [x] Write general forward VarDCT at explicit Level 10 and select it automatically for exact Modular alpha above 12 bits
- [x] Stream Level 10 VarDCT animation in an unbounded jxlc container without whole-output buffering
- [x] Extract CMYK, black and independent alpha planes; convert profile-defined CMYK to RGBA8 with straight integer or IEEE alpha
- [x] Convert IEEE binary16/binary32 gray and RGB native layers to straight RGBA16 with mixed integer or IEEE alpha, shifted alpha, zero-alpha handling and nonfinite rejection
- [x] Compare binary16/32 gray and RGB color with opposite-width IEEE or 8-bit integer alpha, straight or associated, against 17 pinned libjxl 0.12.0 float-plane and RGBA16 references, including shifted alpha
- [ ] Compare wider integer-alpha depths and other shifted float/alpha precision pairs with pinned independent rendered references
- [x] Convert high-depth GRAY/RGB/CMYK ICC native layers directly to straight sRGB16, including gray alpha and mixed or associated alpha, with pinned LittleCMS 2.16 perceptual references
- [x] Write shifted native samples across multiple 1024-pixel Modular groups and convert shifted CMYK black and alpha planes with the signaled kernel
- [x] Match the shifted alpha, black and binary16 depth native grids against pinned jxl-oxide pre-upsampling decoded samples on odd multi-group images
- [x] Run all 39 pinned official valid cases successfully, with no expected-unsupported cases left
- [x] Accept Level 10 writer output in pinned libjxl djxl and rerun all M9 gates after the last production edit

Other floating layouts and associated CMYK alpha in the older RGBA8 API remain explicit unsupported boundaries. The shifted native-grid oracle uses a pinned jxl-oxide decoder build instrumented before extra-channel upsampling.

## M9 production hardening

- [x] Twelve cross-feature workflows cover progressive selection, orientation, HDR and alpha fallback, high-depth native channels, animation timing, references, exact JPEG reconstruction, metadata invalidation, fragmented sources and strict fallback policy
- [x] Twelve mutation families cover containers, entropy, Modular transforms, VarDCT reconstruction, progressive dependencies, animation, ICC and extra channels, exact JPEG data, writers, display conversion and worker/API limits
- [x] Twelve resource cases cover stalled reads, section/frame/pixel/metadata limits, computation and fetch cancellation, sink failures, pending writes, early return, reuse and malformed late sections with zero managed ownership after cleanup
- [x] Packed public imports and browser-safe conditional exports are checked on Node 22 and 24; the public API runs in Chromium, Firefox and WebKit
- [x] Evidence admission requires exact case identities, source revision, a clean checkout, raw hashes, measured thresholds and internally consistent summaries
- [x] One bounded pull-request smoke gate runs pinned conformance plus M9 integration and hostile-input checks; full package, browser, fuzz, oracle, benchmark, memory and evidence matrices run locally

These gates harden the declared capability subsets. They do not promote Experimental lossy encoding or authorize a release. M10 reruns the M9 gates after its last production change.

## M8 sequence and native channel APIs

- [x] Independent header discovery, timed composited frame iteration, decimal tick timestamps, exact rational timebase, loop and timecode metadata
- [x] Explicit still-frame selection, index/timestamp replay, separate native layers, four reference slots and caller-owned output
- [x] Streamed lossless and Experimental lossy animation encoding with exact alpha, rectangles, references, orientation and cancellation
- [x] Typed native channel extraction, grouped shifted VarDCT alpha/depth and binary16 sample preservation
- [x] Bounded native planar encoding with matching original GRAY/RGB ICC profiles, including high-depth gray plus alpha
- [x] Global implicit delta palettes, M3 previous-channel MA-tree properties, custom inverse opsin, custom upsampling and custom Gaborish/EPF reconstruction
- [x] Independent comparisons for all 39 official cases; M10 promotes the final CMYK and binary32 native cases and every applicable Level 5 case passes
- [x] Native patch/progressive dependencies, all eight patch blend modes in Modular and XYB, YCbCr chroma reconstruction, shifted-alpha/color upsampling, and noise/spline interactions

Sequence output uses explicit full-canvas buffers and replay without a decoded sequence cache. Native extraction does not imply display conversion. See docs/jpegxl-sequences.md for ownership, budgets, timing, channel representation and level classification. The checked Level 5 corpus passes; unrestricted display of every native channel layout is not claimed.

## M6 progressive sessions

- [x] Lazy header indexing, aggregate header budgets and no pixel decode at session open
- [x] Explicit session close, one active iterator, bounded caches and source identity checks
- [x] Separate embedded preview, complete DC, completed pass and requested final events
- [x] Native denominators 2 and 4 use signaled pass boundaries; denominator 8 omits main-frame HF data
- [x] Shared execution/explanation planner with all eight coordinate orientations and restoration halos
- [x] Selective group reads and declared static dependency fallbacks with strict rejection
- [x] Task-scheduled rendering cancellation, immutable output snapshots and iteration backpressure
- [x] Progressive Modular DC dependencies checked against pinned native stage outputs
- [x] Selective XYB VarDCT SDR alpha, SDR16, linear16 and PQ16 DC and pass stages with pinned libjxl color oracles and early section reads
- [x] Selective linear16 plus alpha stages with early LF reads, a pinned jxl-oxide partial first-pass RGBA image, and pinned libjxl 0.12.0 final pixels
- [x] Selective associated 2x shifted alpha when its native plane fits one global group; preserve source alpha meaning
- [ ] Selective alpha whose native grid needs group-local AC payloads, and independent libjxl flush images for alpha intermediate passes

Use `openJpegXlSession` from `purejsimage/jpegxl`. `preview()` emits the separately encoded embedded image. `native()` rejects unavailable native boundaries. `progressive()` emits complete stages, and `decode()` defaults to final output. A final event validates the requested region and its dependencies, not unread unrelated groups.

DC reconstruction uses compact LF state and restoration bands. The supported global alpha plane is retained with LF state. Pass and final output retain a full-resolution output; high-depth and HDR passes retain full working planes. Group-local alpha, Modular main images, patches, splines, noise and other reference dependencies use their checked static paths; a plan states the fallback. The ordinary pipeline retains final-image semantics and the JPEG-derived reduced-IDCT path remains separate.

The session does not add generic read-ahead over a caller-provided source. HTTP transfer bytes still depend on that source's explicit block and cache policy. Its section-byte counter excludes metadata probes and transport overfetch. See `docs/jpeg-xl.md` for ownership, cache budgets, stage availability and memory accounting.

The frozen M6 cohort contains 30 functional fixtures and ten original-resolution photographs. Final benchmark and full handoff gates are recorded in `docs/architecture/jpegxl-m6-m10-completion.md`.

## M5 static processing

- [x] JPEG XL to JPEG, PNG, WebP, AVIF and TIFF through the public pipeline
- [x] Crop, resize, contain, cover, orientation normalization and explicit metadata preservation or stripping
- [x] Native 8-16-bit crop and resize, independent alpha ranges, and float RGBA resize with bounded row buffers
- [x] Linear-light sRGB resize uses the actual source sample range; float linear RGB and RGBA retain highlights
- [x] Pixel-lossless JPEG XL re-encode inherits color and alpha precision, orientation and luminance metadata
- [x] Explicit pixel conversion is required before an encoder that cannot retain JPEG XL sample precision
- [x] Known 8-bit PNG color signals are preserved; incompatible or unavailable color conversions fail explicitly
- [x] Planner reports native format, sample depths, color semantics, source orientation, pushed crop and scale, conversions, encoder options and decoder working storage
- [x] Planner reports full-frame VarDCT output and any decode performed while opening the decoder
- [x] Nearest and linear-light filters bypass coefficient reduction; other eligible JPEG-derived resizes use reduced floating-point IDCT
- [x] Bounded HTTP Range reads across segmented jxlp, operation cancellation and source reuse
- [x] Browser workbench opens, inspects, resizes and exports representative native-depth, P3 and HDR inputs

Use `.jpegxl()` to retain supported native integer samples. To export 10- or 12-bit
samples to PNG storage, use `.convertPixelFormat({ format: "rgb16" }).png()`.
That explicit step scales the declared range to all 16 output bits. Use `rgba16` for alpha.
For display output, choose `rgb8` or `rgba8` explicitly. Pixel conversion changes storage
and range; it does not change transfer functions or primaries.

Open supported P3 input with `colorOutput: "srgb"` for explicit sRGB conversion.
Open PQ or HLG with `hdrOutput: "tone-map-srgb"` for explicit SDR rendering.
Ordinary high-depth ICC, custom-chromaticity and structured integer color transforms
remain errors. Float-encoded input and float JPEG XL encoding remain unsupported.

VarDCT retains a full output frame. Eligible ordinary 8-bit photographs use bounded
restoration bands, while high-depth, alpha and other documented fallback cases retain
full working planes. Planner working-byte estimates exclude runtime and process overhead.
Ordinary VarDCT opening and `explainImage()` index headers without decoding pixels. JPEG-derived coefficient opening remains eager; `io.pixelDecode` reports that cost.

Progressive range-aware processing is M6 and is outside the M5 static boundary.

- [x] Encode sparse RGB16 effort-7 groups with sorted per-channel palettes and optional index RCT; verify native samples, partial groups and allocation limits
- [x] Accept the bounded local three-scalar-palette transform chain with optional index RCT

## M7 experimental forward encoding

Use `.jpegxl({ mode: 'lossy', distance: 1, effort: 3, progressive: true })` for forward pixel encoding. `.jpegxl()` stays lossless. Distance must be from 0.25 to 25; zero and lossless/distance conflicts are errors.

The current writer supports DCT8, effort-5/7 Hornuss and both rectangular half-block orientations, adaptive quantization, local chroma-from-luma, optional two-pass output, and exact straight alpha at native integer depths. Known-primary sRGB, linear, gamma, and PQ inputs retain their declared source metadata. HLG, custom chromaticities, premultiplied alpha, larger DCT/AFV strategies, and Gaborish remain outside this experimental encoding subset. Opaque standard-sRGB gray/RGB at effort 5/7 and distance 2 or above can use residual-scaled edge-preserving restoration when most blocks need filtering.
Opaque non-progressive effort-1 frames with 2 through 256 AC groups can use group-local entropy models and reusable scratch. DC averages and AC transforms share one pixel conversion per block. Exact section-size comparison retains the smaller prefix representation when appropriate. All scratch remains subject to maxWorkingBytes; process RSS is measured separately.

The frozen extended compression and rate-distortion gates are unfinished. These implementation and procedural conformance results do not establish production quality or speed across the corpus. The workbench exposes lossless and experimental lossy controls separately from exact JPEG recompression, with local comparison, download, reopen, and cancellation.

## PR 35 precision, memory and evidence corrections

- [x] Preserve nondefault PQ and HLG luminance fields through storage-only conversion
- [x] Keep gray-alpha source descriptors separate from expanded RGBA pixel semantics
- [x] Reject unavailable gray ICC plus alpha expansion without weakening encoder validation
- [x] Check actual encoder allocations before construction and release all ownership on failure
- [x] Validate maxWorkingBytes and maxOutputBytes; keep caller/sink memory and process RSS separate

The nine original holdout assets retain source dimensions and checksums. Every effort-1 and effort-7 pixel result is independently exact, including original 24 MP and 12 MP photographs and two real UI captures. Large photos and screenshots often exceed PNG or libjxl sizes. At that checkpoint advanced effort search was single-group. M7 extends bounded search to larger inputs, with new corpus qualification still in progress. Two separately selected small eligible WPT JPEGs supplement the original ICC-ineligible small photographic case. No original holdout case was removed.

See `docs/architecture/jpegxl-pr35-remediation.md` for the raw gates, selection rules, rounding exception and exact-revision evidence.

## M4 color and metadata

- [x] Exact Modular RGB and gray samples in sRGB, linear sRGB, Display P3, Rec. 2020, PQ, HLG, bounded gamma, and custom chromaticities at 8, 10, 12, and 16 bits
- [x] All eight codestream orientations through `autoOrient()`, display dimensions, and normalized copied Exif orientation
- [x] Straight and premultiplied alpha with independent precision, VarDCT upsampling, explicit multiple-alpha selection, and zero-alpha handling
- [x] Bounded compressed ICC reconstruction, profile validation, supported first-party conversion, and source-profile preservation
- [x] High-depth VarDCT and linear RGB/RGBA float output without clipping HDR to SDR
- [x] Bounded Exif, XMP/XML, JUMBF, common brob, intrinsic dimensions, density, and timestamp metadata

The checked matrix contains 56 structured color cases, 40 independent-alpha cases, 18 high-depth VarDCT color cases, eight VarDCT alpha-upsample cases, and a two-alpha fixture. Pinned libjxl provides independent native or float references. At the M4 checkpoint, official conformance had 13 passes, 25 explicit unsupported cases, no incorrect outputs, and the separately recorded delta_palette failure. M10 later advances all 39 official cases to exact passes. ICC validation records source-profile warnings, including the cafe profile checksum mismatch; extracted profile bytes match djxl exactly.

Use `Image.open(input, { colorOutput: "preserve" })` to retain source-profile or structured Modular samples. Supported 8-bit conversions can request `colorOutput: "srgb"`. PQ and HLG Modular samples remain encoded unless `hdrOutput: "linear-float"` or `hdrOutput: "tone-map-srgb"` is selected. HDR and wide-gamut XYB reconstruction emits linear sRGB float samples, including negative gamut values and highlights above one. Float HDR uses 203 cd/m2 as reference white. The explicit native-layer ICC API converts supported high-depth GRAY/RGB/CMYK profiles to sRGB16. Ordinary high-depth ICC display conversion and custom-chromaticity conversion still throw `UNSUPPORTED_OPERATION`.

`alphaOutput: "preserve"` retains associated samples. `alphaOutput: "straight"` unpremultiplies and sets zero-alpha color to zero. HDR conversions produce straight alpha. `alphaChannel` is a zero-based index and is required when more than one alpha channel is present. Alpha display range is independent of color.

Container payloads require an explicit metadata preservation request. `metadata()` exposes only bounded density and timestamp summaries in addition to image fields. Exif orientation must be normalized before JPEG XL encoding; the `orientation` encode option owns display orientation. The `intrinsicSize` option accepts width and height. `toneMapping` accepts intensityTarget, minNits, relativeToMaxDisplay, and linearBelow; values use finite half precision. Defaults are 10000 nits for PQ, 1000 for HLG, and 255 otherwise. ICC encoding remains unsupported; source ICC can be preserved into compatible PNG output.

## Current implementation note

A JPEG XL input is either a raw codestream beginning with its two-byte signature or a
box container beginning with the fixed signature box. The container then carries an
`ftyp` box and either one `jxlc` codestream box or indexed `jxlp` fragments. The
first-party codec validates these structures and returns bounded source ranges
without concatenating compressed data. Raw, single-`jxlc`, ordered `jxlp`, and
file-format-version-1 out-of-order `jxlp` codestreams can enter the implemented
pixel subset through one logical segmented source.

The decoder covers the checked lossless Modular and common static VarDCT boundary. It includes
raw strategies 0 through 7 and 10 through 20, restoration filters, progressive reconstruction,
patches, splines, synthetic noise, reference slots, and JPEG-derived RGB or YCbCr coefficients.
The M3 real-photo corpus contains 300 files: 299 decode correctly and one unsupported internal
Modular tree fails before output. M4 adds independently checked color, alpha, and HDR cases.
The ordinary 8-bit sRGB path uses bounded restoration bands. High-depth, float, alpha, and
composition paths use an explicit full-frame fallback. Selected VarDCT crops follow decode.

The normal pipeline exposes a stable deterministic Modular encoder for gray8, gray16,
rgb8, rgb16, rgba8, and rgba16 at effort 1, 3, 5, or 7. Explicit color and alpha
precision can be declared from 8 through 16 bits when samples use 16-bit storage.
The 163-case matrix is exact through PureJsImage, pinned `djxl`, jxl-rs, and jxl-oxide
where applicable. The 156 procedural cases measure the fixed effort-1, effort-7,
PNG and relative-speed gates. Actual encoder backing-buffer ownership has separate budget and cleanup tests. The separate stable
`purejsimage/jpegxl` API transcodes eligible baseline
and progressive one- or three-component 8-bit Huffman JPEGs in the coefficient domain, writes `jbrd`, and
reconstructs and compares every source byte before exact-mode success. Its 250-file real JPEG archive, compression, speed, bounded sink-verification, and browser parity gates pass. Exact transcode
walks APP metadata through EOI and requires Exif orientation absent or 1, Exif color absent or explicitly sRGB, and no ICC or the checked deterministic sRGB ICC.
Pinned libjxl 0.12.0 reconstructs first-party grayscale output byte for byte. Four baseline and progressive grayscale files with odd dimensions, optimized Huffman tables, and restart markers also match pinned `djxl` grayscale pixels within one code.

The checklist below preserves the initial decode roadmap and its original groupings.
Its boxes are historical planning state, not the current capability inventory.
Use the generated milestone sections above and this manifest's boundary, status,
memory and notes fields for current support. Unimplemented operations still fail explicitly.

## Scope decisions

- [x] Prioritize static `image/jxl` decode for upload-processing workflows
- [x] Decode bare JPEG XL codestreams and single-`jxlc` box-based containers for
  the implemented Modular subset
- [x] Implement both Modular and VarDCT decoding for the checked static subset; neither mode alone covers the
  common lossless and lossy image set
- [x] Decode JPEG-lossless-transcode codestreams to pixels without requiring
  bit-exact reconstruction of the original `.jpg` file
- [x] Make one full-canvas still image the first public milestone
- [ ] Apply orientation and color conversion during the pipeline rather than
  returning incorrectly oriented or raw XYB samples
- [x] Keep `libjxl`, `djxl`, `jxlinfo`, and other implementations as pinned
  development-only references and oracles
- [x] Implement production decoding in this repository without a runtime codec
  dependency, native library, WebAssembly module, or copied third-party code
- [x] Add a constrained pixel-lossless Modular encoder through the normal pipeline
- [x] Add explicit coefficient-domain JPEG transcode and exact reconstruction APIs
- [x] Pass the 250-file exact JPEG compression, 12 MP performance, bounded verification, and browser parity gates for the documented subset

## Output modes

The default encoder is a constrained mathematically lossless Modular pixel
encoder. Explicit lossy mode uses the experimental forward VarDCT subset
described above. Neither pixel mode claims original-file reconstruction.
Exact JPEG recompression is a separate coefficient-domain API with byte-equality gates.

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
- [x] Keep JPEG bitstream reconstruction data independent from image pixel
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
- [x] Support the pinned Modular sub-images used by VarDCT for low-frequency and control
  data
- [x] Verify the implemented mathematically lossless Modular fixture with exact samples

### VarDCT mode

- [x] Parse LF global data, LF groups, HF global data, HF passes, and pass-group
  sections with validated sizes and dependencies
- [x] Decode the checked quantizer fields, dequantization matrices, block strategies,
  coefficient orders, context models, and chroma-from-luma factors
- [x] Reconstruct DC and low-frequency images before dependent high-frequency
  groups
- [x] Decode progressive high-frequency passes and accumulate coefficients in
  the correct order
- [x] Implement raw strategy IDs 0 through 7 and 10 through 20,
  with full-image fixtures covering Hornuss, square DCT, rectangular DCT, large transforms, and AFV combinations
- [x] Implement raw strategy 1 Hornuss with pinned independent fixture evidence
- [x] Apply inverse transforms, coefficient scaling, quantization bias, and
  block placement with defined numeric precision
- [x] Reconstruct the pinned XYB samples and perform the inverse opsin transform
- [x] Decode the checked 2x, 4x, and 8x chroma resampling modes
- [x] Implement pinned single-group and multi-group Gaborish and edge-preserving restoration filters
- [x] Decode and render checked patches and splines in valid static images
- [x] Decode and render the pinned synthetic-noise fixtures
- [x] Decode the pinned VarDCT images created from ordinary lossy sources
- [x] Decode the image pixels of pinned JPEG-lossless-transcode codestreams
- [x] Compare lossy output with conformance references using documented numeric
  tolerances

### Static frame and output

- [x] Decode one visible full-canvas frame with the default replace behavior
- [ ] Skip a declared preview and decode the main image by default
- [x] Resolve checked internal DC frames, reference slots, partial-canvas frames, and common static blend modes
- [x] Require explicit displayed-frame selection for animation in the ordinary still API
- [x] Apply all eight orientation values exactly once through explicit autoOrient()
- [x] Return display dimensions after orientation
- [x] Emit bounded, ordered `gray8`, big-endian `gray16`, `rgb8`, big-endian `rgb16`, `rgba8`, or big-endian `rgba16` pixel blocks for the implemented subset
- [ ] Support JXL-to-JPEG, JXL-to-PNG, JXL-to-WebP, crop, resize, and
  resize-plus-encode workflows

### Common samples, alpha, and color

- [x] Native integer grayscale at 8, 10, 12, and 16 bits per sample
- [x] Complete integer RGB coverage at 8, 10, 12, and 16 bits per sample for the current single-group Modular boundary
- [x] One alpha extra channel with independent precision
- [x] Decode the checked common VarDCT straight-alpha form
- [x] Premultiplied alpha with correct unpremultiplication or preservation behavior
- [x] Parse and report the checked sRGB and linear-sRGB gray or RGB encoding and rendering intent
  with distinct source metadata and emitted pixel semantics
- [x] Decode compressed embedded ICC profiles with strict decoded-size limits
- [ ] Render common sRGB, linear sRGB, Display P3, and gray inputs to the
  pipeline's declared output color space
- [x] Handle grayscale and RGB codestream color representations for the compatible Modular subset
- [x] Handle checked 8-bit sRGB XYB codestream color representations
- [x] Preserve native 9-bit and 12-bit integer samples in `rgba16` with per-channel
  display ranges; pipeline normalization requires an explicit pixel conversion
- [x] Reject unsupported color encodings or extra-channel semantics rather than
  treating their samples as sRGB or alpha for the checked subset

## Group 2: common compatibility improvements — should have

These features occur in real JPEG XL files, but a correct single-frame upload
decoder can ship before all of them are complete.

- [ ] Embedded preview decode and explicit preview selection
- [x] Multiple frames required internally by a checked still image
- [x] Checked frame crops, reference slots, save-as-reference behavior, and static blend modes
- [ ] Coalesced first-frame output for animated inputs without claiming full
  animation support
- [x] Out-of-order `jxlp` fragments permitted by newer container versions
- [x] JPEG bitstream reconstruction from `jbrd` to the exact original JPEG file for the checked subset
- [x] Common static PQ, HLG, and linear-light integer inputs with float output
- [ ] Floating-point encoded input samples
- [x] Tone-mapping metadata, intensity target, luminance range, and a documented
  SDR conversion policy
- [ ] Wide-gamut Rec. 2020, Adobe RGB, ProPhoto RGB, and uncommon ICC profiles
- [ ] CMYK through a black extra channel and an applicable color profile
- [ ] Spot-color, selection-mask, depth, and black extra-channel discovery and
  opt-in extraction
- [x] Multiple alpha channels with explicit caller selection for the documented layouts
- [x] Intrinsic-size, pixel-density, and bounded timestamp metadata
- [x] Bounded metadata preservation for Exif, XMP/XML, and JUMBF
- [x] Bounded first-party decompression of `brob` metadata boxes
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
- [x] Native coding-layer access through the explicit sequence API, with unsupported unresolved dependencies reported
- [ ] Diagnostics identifying the box, frame, LF group, pass group, entropy
  stream, transform, or extra channel that caused a failure

## Group 4: explicitly skip

These unchecked items are outside the initial decode-only plan and do not block
JPEG XL v1.

- [x] Animated output, exact timing, looping metadata and checked frame composition through the explicit sequence API
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
