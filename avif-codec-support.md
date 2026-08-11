<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# AVIF codec support

This document is the capability contract for PureJsImage's first-party AVIF
codec. A checked item is implemented in the current code. An unchecked item is
planned and must not be presented as supported until its output is independently
validated. The correctness section records the current fixture and benchmark
coverage.

## Scope decisions

- [x] Implement AVIF and AV1 in this repository without a production codec
  dependency, native library, or WebAssembly module
- [x] Keep independent AVIF implementations as development-only research,
  fixture, and benchmark oracles
- [x] Make metadata inspection available without decoding AV1 pixels
- [x] Prioritize static still-image decode before animation
- [x] Prioritize opaque 8-bit Main Profile YUV 4:2:0 photographs before
  high-bit-depth, alpha, and uncommon chroma layouts
- [x] Return explicit unsupported errors for features outside the implemented
  pixel path rather than fabricating a normal-looking image
- [x] Treat bounded-memory AVIF-to-resize and AVIF-to-AVIF workflows as the
  long-term AWS Lambda architecture target
- [ ] Implement the initial constrained AVIF encoder

## Decode

### Detection and ISOBMFF container

- [x] Content detection through an `ftyp` box declaring `avif` or `avis`
- [x] Explicit `avifCodec` registration and automatic detection through the
  configured library instance
- [x] 32-bit box sizes, extended 64-bit sizes, and boxes extending to the end
  of their parent
- [x] `uuid` box header sizing
- [x] Validated parent bounds, safe-integer offsets, box counts, and metadata
  payload limits
- [x] Required `ftyp` and `meta` discovery
- [x] Primary-item selection through `pitm`
- [x] Item information through version 2 and 3 `infe` entries in `iinf`
- [x] Item properties and associations through `ipco` and `ipma`
- [x] Item references through version 0 and 1 `iref`
- [x] Item locations through version 0-2 `iloc`
- [x] File-relative `mdat` item extents
- [x] `idat`-relative item extents
- [x] Multiple extents per coded item
- [x] Bounded extraction with overlap, truncation, overflow, and extent-source
  validation
- [ ] Incremental AV1 item reads without concatenating multi-extent payloads
- [ ] Multiple `meta` boxes or fragmented media representations
- [ ] External data references

### Metadata and item relationships

- [x] Primary `av01` image items
- [x] Grid item dimensions, rows, columns, and `dimg` tile relationships during
  metadata and bitstream inspection
- [x] Alpha auxiliary-item discovery through `auxl` and the standard alpha
  `auxC` identifiers
- [x] Spatial extents through `ispe`
- [x] Standard and extended `pixi` channel-depth parsing
- [x] AV1 configuration through `av1C`
- [x] NCLX color primaries, transfer characteristics, matrix coefficients, and
  full-range signaling
- [x] ICC-profile presence through `prof` and `rICC`
- [x] Rotation through `irot` and conversion to pipeline orientation metadata
- [x] Width, height, alpha presence, bit depth, chroma subsampling, AV1 profile,
  color-space description, frame count, and orientation reporting
- [x] Cross-check `pixi` bit depth against `av1C`
- [x] Cross-check `av1C` profile, bit depth, chroma, level, and tier against the
  authoritative AV1 sequence header during bitstream inspection
- [x] Pixel decoding and composition of compatible opaque grid items
- [x] Pixel decoding and composition of compatible alpha auxiliary items
- [x] Validated integer clean-aperture cropping through `clap`; fractional
  dimensions and origins remain explicitly unsupported
- [x] Mirroring through `imir`, ordered `clap`/`irot`/`imir` validation, and
  composition into pipeline orientation metadata
- [ ] Pixel-aspect-ratio and other transformative item properties
- [x] ISO 21496-1 gain-map metadata, `dimg` relationships, and preferred
  alternative selection through `altr` entity groups
- [ ] Depth maps, thumbnails, overlays, derived images other than grids and
  compatible gain maps, and other auxiliary-image semantics
- [ ] EXIF and XMP item discovery and metadata exposure
- [x] Compatible RGB matrix/TRC ICC profile parsing and color-managed conversion
- [ ] Metadata preservation or explicit stripping controls when re-encoding

### AV1 low-overhead bitstream inspection

- [x] Low-overhead OBU headers with explicit LEB128 payload sizes
- [x] Temporal and spatial OBU extension identifiers
- [x] Sequence-header discovery and uniqueness validation
- [x] Reduced still-picture sequence headers
- [x] AV1 profile, level, tier, bit depth, monochrome, chroma subsampling,
  color configuration, operating points, and coded dimensions
- [x] Sequence feature flags needed by the still decoder, including 64/128
  superblocks, filter-intra, intra-edge filtering, CDEF, restoration, and
  super-resolution signaling
- [x] Preservation of bounded OBU payload ranges for later frame parsing
- [x] Compatible non-reduced sequence headers with one operating point,
  `still_picture=0`, and one shown key frame at maximum or explicitly overridden dimensions
- [ ] General non-reduced sequence headers with decoder timing, multiple
  operating points, frame IDs, or inter-frame dimension overrides
- [ ] Multiple operating-point selection
- [ ] Annex B AV1 byte streams
- [ ] Inter-frame or general video decoding
### Implemented restricted still-image path

- [x] One complete AV1 frame OBU or one frame-header OBU followed by complete
  contiguous tile-group OBUs per coded image item
- [x] Reduced still-picture headers and compatible non-reduced shown key frames
- [x] AV1 Main, High, and Professional Profiles with 8-bit monochrome, YUV
  4:2:0, YUV 4:2:2, and YUV 4:4:4 output
- [x] Coded-lossless 10-bit and 12-bit YUV 4:2:0 and YUV 4:4:4 output with
  native high-depth planes and explicit conversion to the 8-bit RGBA contract
- [x] Lossless and lossy quantization paths used by the permanent fixtures
- [x] 64x64 and 128x128 superblocks
- [x] Complete compatible lossy 8-bit and coded-lossless high-bit-depth
  multi-tile frames in one frame OBU, plus compatible 8-bit frames split
  across complete contiguous tile-group OBUs
- [x] Range-coded symbol decoding with adaptive CDF updates and final-state
  validation
- [x] Skip signaling, keyframe intra modes, angle deltas, transform selection,
  and coefficient contexts
- [x] Coefficient all-zero contexts use full coded block dimensions across
  bounded reconstruction chunks, and palette-mode signaling retains its
  above-size context across 64-pixel row boundaries
- [x] `NONE`, `SPLIT`, horizontal, vertical, horizontal-4, vertical-4, and
  tip-split intra partition traversal
- [x] Exact structural top-right and bottom-left edge availability across the
  partition tree and at superblock/frame boundaries
- [x] DC, vertical, horizontal, all directional, smooth, Paeth, and
  filter-intra prediction modes used by common photographic input
- [x] Chroma-from-luma prediction
- [x] Intra-edge filtering and edge upsampling
- [x] Square and rectangular transform traversal through 64x64
- [x] DCT, ADST, flipped-ADST, and identity inverse-transform combinations
  needed by the permanent common-photo corpus
- [x] Lossless 4x4 Walsh-Hadamard inverse transforms
- [x] Nonzero coefficient reconstruction in quantizer contexts 0, 1, 2, and 3
- [x] 8-bit, 10-bit, and 12-bit dequantization and inverse transforms using the
  normative depth-specific AV1 lookup tables
- [x] Quantization-matrix reconstruction for every supported two-dimensional
  transform size, including flat level 15 matrices
- [x] Matrix lookup in the inverse-transform kernels' coefficient-axis order,
  including AV1's adjusted 32x32 matrix dimensions for 64-point transforms
- [x] Block delta-Q reconstruction in the supported one-tile intra-only path
- [x] Odd-dimension edge clipping without decoding transforms outside the coded
  frame
- [x] Monochrome replication, direct YUV 4:4:4 sampling, horizontal YUV 4:2:2
  interpolation, bilinear YUV 4:2:0 sampling, and container-signaled NCLX
  conversion to RGBA, including the full-range identity color transform
- [x] Linear and extended-sRGB plus linear BT.2020 NCLX conversion to sRGB,
  and compatible RGB matrix/TRC ICC conversion to sRGB
- [x] Compatible same-size, single-channel ISO gain-map composition in linear
  light for HDR base images with an SDR alternate
- [x] Straight and premultiplied alpha auxiliary composition using full-range
  8-bit monochrome alpha, including normalization to straight RGBA output
- [x] Opaque image grids with consistent independently coded tile dimensions
  and cropped right or bottom edge tiles
- [x] Public crop, resize, AVIF-to-PNG, AVIF-to-JPEG, AVIF-to-WebP, and
  AVIF-to-other-implemented-codec pipelines after frame reconstruction
- [x] Multiple independently decoded AV1 tiles
- [ ] Tile-list OBUs or partial, overlapping, reordered, or missing tile groups
- [x] Alpha-bearing image grids
- [x] Skipped intra block copy with adaptive integer motion-vector coding
- [x] Residual intra-block-copy transform partitions, transform types,
  coefficients, inverse transforms, and reconstruction used by the pinned
  monochrome fixture
- [x] Full-block transform-size contexts, nearest reference-motion candidate
  stacks, and subsampled bilinear chroma prediction used by four pinned
  Microsoft still-picture intra-block-copy frames
- [ ] Other intra-block-copy and screen-content tools outside pinned syntax
- [x] Clear palette contexts after intra-block-copy blocks and honor block
  delta-Q state in the restricted one-tile path
- [x] Keep segmentation maps and delta loop-filter combinations explicitly
  rejected before intra-block-copy reconstruction
- [x] Luma and chroma palette mode, including cached and new palette entries,
  non-symmetric first-index coding, and diagonal color-map reconstruction
- [ ] Complete segmentation-map and delta-loop-filter reconstruction, plus
  delta-Q combinations outside the restricted one-tile intra-only path
- [ ] Every legal transform-size, transform-type, coefficient-context, and
  quantizer-context combination
- [x] Normative eight-tap horizontal super-resolution for filter-free one-tile
  8-bit frames
- [x] Film grain synthesis

### In-loop filtering and restoration

- [x] Parse loop-filter header syntax sufficiently to remain synchronized
- [x] Parse CDEF header syntax and per-unit CDEF indexes
- [x] Parse restoration types and restoration-unit sizes
- [x] Consume none, Wiener, self-guided, and switchable restoration-unit syntax
- [x] Maintain Wiener and self-guided reference parameters while reading units
- [x] Apply the AV1 deblocking loop filter for the supported intra-only frame
  state, including luma/chroma strengths, transform edges, wide/narrow filters,
  odd dimensions, and frame boundaries
- [x] Apply CDEF to luma and chroma planes with directional strength adjustment
  and frame-edge sample availability
- [x] Apply Wiener loop restoration with stripe-aware deblocked/CDEF source
  selection
- [x] Apply self-guided loop restoration with stripe-aware source selection
- [x] Apply filters in deblock, CDEF, then loop-restoration order when
  super-resolution is not signaled
- [x] Apply super-resolution between CDEF and loop restoration for filtered
  frames
- [x] Match dav1d and libaom post-filter YUV pixels exactly for deterministic
  disabled, deblock, luma/chroma CDEF, Wiener, self-guided, odd-dimension,
  frame-edge, multiple-restoration-unit, and filtered super-resolution
  fixtures; the numeric tolerance is zero
- [x] Apply deblocking, CDEF, and restoration once across a complete lossy
  multi-tile frame and match agreeing dav1d and libaom native YUV byte for byte

The two full-size Kodak and Fox photographic fixtures receive the complete
post-filter pipeline and match agreeing dav1d and libaom native YUV byte for
byte. The full-size tolerance remains zero.

### Additional still-image compatibility

- [x] 8-bit monochrome
- [x] Coded-lossless and filter-free lossy 10-bit and 12-bit YUV 4:2:0
- [x] 8-bit YUV 4:2:2
- [x] Filter-free lossy 10-bit and 12-bit YUV 4:2:2
- [x] 8-bit YUV 4:4:4
- [x] Coded-lossless and filter-free lossy 10-bit and 12-bit YUV 4:4:4
  identity-color decode, including compatible coded-lossless multi-tile frames
- [x] Lossy 10-bit YUV 4:4:4 decode with filter-free output and compatible
  deblocking, CDEF, and Wiener restoration
- [ ] Filtered lossy 10-bit YUV 4:2:0 and 4:2:2, self-guided-restored lossy
  10-bit YUV 4:4:4, and filtered lossy 12-bit decode
- [x] Full-range high-bit-depth reconstruction without premature truncation
  before explicit conversion to the library's 8-bit RGBA output contract
- [x] Compatible full-range 8-bit monochrome alpha auxiliaries
- [x] Premultiplied-alpha signaling and normalization to straight RGBA
- [x] Multi-item opaque grids with cropped right and bottom edge composition
- [x] Compatible non-reduced shown key-frame headers without decoder timing or
  frame IDs, including selected key-frame dimension overrides below the sequence maximum
- [x] One still frame stored as a frame-header OBU followed by multiple complete
  contiguous tile-group OBUs
- [x] Explicit lsel spatial-layer selection from a1lx-indexed multi-frame items
  when the selected output is an independently decodable shown key frame, including
  a lower-resolution base layer with a frame-dimension override
- [x] Classify shown key, inter, intra-only, switch, and show-existing frame
  headers before reconstruction and explicitly reject dependent enhancement layers
- [ ] Dependent enhancement layers and rendering all intermediate layers
- [x] Reject PQ and HLG transfer signaling before SDR pixel conversion unless
  a compatible SDR gain-map alternate is selected
- [ ] Broader wide-gamut NCLX and ICC-managed conversion

### Animation

- [x] Detect the `avis` sequence brand and avoid reporting a false one-frame
  metadata count
- [x] Reject `avis` pixel decode explicitly instead of presenting its primary
  item as a supported one-frame image
- [ ] Parse AVIF tracks and sample tables
- [ ] Decode multiple AV1 frames
- [ ] Frame timing, repetition, blending, disposal, and canvas composition
- [ ] Animated AVIF frame iteration
- [ ] Animated AVIF encoding

## Encode

### Initial constrained encoder target

- [ ] Public `image.avif()` and `image.encode('avif')` APIs
- [ ] AVIF `ftyp`, `meta`, item properties, item locations, and `mdat` writer
- [ ] One opaque `av01` primary item
- [ ] Reduced still-picture AV1 sequence and one intra-only frame
- [ ] 8-bit Main Profile YUV 4:2:0
- [ ] RGB and RGBA pipeline input, with an explicit alpha-discard or background
  policy for the opaque milestone
- [ ] BT.709 RGB-to-YUV conversion and deterministic 4:2:0 subsampling
- [ ] Quality control from the public 1-100 scale to AV1 quantization
- [ ] A small, explicitly constrained prediction-mode and partition search
- [ ] Deterministic valid output accepted by independent AVIF decoders
- [ ] Output-size and perceptual-quality benchmarks against libaom, rav1e, and
  SVT-AV1

### Encoder compatibility improvements

- [ ] Alpha auxiliary-item encoding
- [ ] Lossless AVIF encoding
- [ ] YUV 4:4:4 and 4:2:2 output
- [ ] 10-bit and 12-bit output
- [ ] Wide-gamut and HDR color signaling
- [ ] Adaptive partition, prediction, transform, and quantizer decisions
- [ ] Loop-filter, CDEF, and restoration decisions
- [ ] Multi-tile and grid output for large images
- [ ] Metadata and ICC writing or preservation
- [ ] Animation

## Memory and execution contract

- [x] Metadata inspection reads bounded box payloads without decoding image
  pixels
- [x] Item extraction validates compressed byte ranges before allocation
- [x] Public decoded output is emitted as ordered 32-row `rgba8` pixel blocks
- [x] Configurable input-size, dimension, pixel-count, frame-count, and decoded
  byte limits are applied before public pixel decode
- [x] Post-filtered, rotated-alpha, and grid paths' padded full-frame YUV
  allocations are documented as temporary fallbacks rather than the Lambda
  northstar
- [x] RGBA conversion emits requested regions in ordered 32-row blocks without
  retaining a source-sized RGBA bitmap
- [x] Opaque grids decode and retain only one contributing tile row while
  composing ordered output bands
- [x] Loop restoration writes through three delayed 4-row luma bands rather
  than allocating another padded full-frame YUV output
- [x] CDEF snapshots bounded source windows and delays one 8-row luma output
  band instead of retaining an additional padded YUV frame
- [x] Compatible opaque filter-free single-item frames reconstruct through
  reusable two-superblock YUV, prediction, palette, and coefficient-context
  rings, copying finalized bands before their storage is reused
- [x] Compatible filter-free single-tile super-resolution reuses bounded
  upscaled luma and chroma band buffers and retains the source chroma halo
  across reconstruction-ring reuse
- [x] Compatible aligned filter-free alpha auxiliaries reconstruct through a
  synchronized second row ring before per-block alpha composition
- [x] Compatible gain-map composition synchronizes bounded base and gain-map
  row decoders without retaining a source-sized RGBA frame
- [x] Every decoder path rejects coded payload plus conservatively estimated
  live working state above the 64 MiB codec limit
- [x] Sequential multi-tile decode retains only one tile rectangle of entropy,
  transform, palette, CDEF, and skip contexts while merging compact frame-wide
  post-filter metadata; padded full-frame YUV remains an explicit fallback
- [x] Measure the checksum-pinned 3840x2160 8x2-tile deblock-plus-CDEF fixture
  in three isolated cold processes: median absolute peak RSS 165,031,936 bytes,
  RSS growth 61,734,912 bytes, external growth 33,290,386 bytes, and
  ArrayBuffer growth 32,738,320 bytes
- [ ] Decode one tile or bounded superblock working set at a time
- [x] Avoid retaining a full source-resolution RGBA bitmap
- [x] Feed compatible full-aperture 2x, 4x, and 8x resize directly from
  bounded box-filtered YUV rows before RGBA conversion
- [ ] Avoid RGB entirely for compatible AVIF-to-resize-to-AVIF workflows
- [ ] Release coefficient, prediction, filter, and restoration state as soon as
  its output halo is complete
- [x] Apply a codec-specific working-memory limit covering compressed item
  bytes, tile state, coefficient contexts, YUV planes, filter halos, and
  RGBA conversion state
- [x] Benchmark isolated cold-process peak RSS across 512x384, 1024x768, and
  2048x1536 source dimensions with full-size and 4x downscaled output
- [x] Benchmark a 2048x1536 filter-free denominator-12 super-resolution
  decode: bounded bands cut median absolute maximum RSS by 15.2%, peak RSS
  growth by 54.4%, external growth by 49.6%, and ArrayBuffer growth by 50.5%
- [ ] Demonstrate the project's 80% memory-reduction target against equivalent
  Jimp-compatible workflows where a comparison is possible

## Correctness and safety contract

- [x] Reject malformed box sizes, nesting, extents, references, item IDs,
  property associations, dimensions, and metadata contradictions explicitly
- [x] Reject malformed OBU sizes, duplicate sequence headers, truncated frame
  headers, tile overruns, invalid arithmetic symbols, impossible partitions,
  coefficient scans, and transform bounds explicitly
- [x] Inspect all 49 checksum-pinned permanent corpus files and 67 unique coded
  items across `mdat`, `idat`, multiple extents, grids, alpha, gain maps, mirroring,
  8/10/12-bit, 4:0:0/4:2:0/4:2:2/4:4:4, progressive storage, HDR signaling,
  layered frame units, reduced and full still-picture headers, and a non-still
  sequence header
- [x] Pass metadata expectations for all 49 permanent corpus files
- [x] Decode exact independent reference pixels for the embedded 2x2 lossless
  fixture and the 4x4 lossy fixture
- [x] Decode and pin RGBA regression hashes for Kodak 768x512 color; Fox
  1204x800 YUV 4:2:0, monochrome, YUV 4:2:2, and YUV 4:4:4 photographs;
  deterministic straight and premultiplied alpha fixtures; and a 1024x770
  cropped-edge image grid
- [x] Decode and auto-orient both `imir` axes exactly; compose the pinned integer-`clap`,
  `irot`, `imir`, 2x2 color-grid, and alpha-grid fixture exactly against its
  deterministic source pixels
- [x] Pin separate Sharp and Chromium behavior for combined grid-item transforms
- [x] Benchmark both full-size photographs through the public AVIF-to-PNG
  workflow
- [x] Report the current broad decode corpus as 8 compatible, 17 explicitly
  unsupported, zero invalid, and zero unexpected
- [x] Match Sharp/libaom, FFmpeg/dav1d, and FFmpeg/libaom luma exactly and
  exceed 60 dB displayed-RGB PSNR against Chromium for the checksum-pinned
  8-bit monochrome Fox fixture
- [x] Match FFmpeg/dav1d and FFmpeg/libaom YUV 4:4:4 planes exactly and
  exceed 50 dB displayed-RGB PSNR against Sharp/libaom and Chromium for the
  checksum-pinned 8-bit YUV 4:4:4 Fox fixture
- [x] Match FFmpeg/dav1d and FFmpeg/libaom YUV 4:2:2 planes exactly and
  exceed 50 dB displayed-RGB PSNR against Sharp/libaom for the checksum-pinned
  8-bit YUV 4:2:2 Fox fixture
- [x] Exercise YUV 4:2:2 decode in Chromium through the portable TypeScript
  codec and pin its RGBA output; Chromium's native AVIF decoder rejects this
  Professional Profile source and is not used as its browser oracle
- [x] Reconstruct the deterministic coded-lossless 10-bit 2x2 AV1 tile
  fixture exactly against its source and agreeing dav1d/libaom native YUV
- [x] Match agreeing dav1d and libaom native YUV byte for byte for a pinned
  lossy 10-bit YUV 4:4:4 frame with deblocking, CDEF, and Wiener restoration
  active on all three planes
- [x] Match agreeing dav1d and libaom native YUV byte for byte for pinned
  filter-free lossy 10-bit and 12-bit YUV 4:2:0, 4:2:2, and 4:4:4 frames
- [x] Select an independently decodable shown-key spatial layer from a pinned
  three-frame a1lx/lsel item and match agreeing dav1d/libaom native YUV exactly
- [x] Match agreeing FFmpeg/dav1d and FFmpeg/libaom native YUV byte for byte
  for three checksum-pinned filter-free denominator-12 YUV 4:2:0 and 4:4:4
  super-resolution fixtures, including a multi-band 4:2:0 chroma boundary
- [x] Match agreeing FFmpeg/dav1d and FFmpeg/libaom native YUV byte for byte
  for a checksum-pinned lossy 8-bit YUV 4:2:0 2x2 tile frame exercising
  deblocking, CDEF, and restoration
- [x] Exercise lossy multi-tile AVIF decode through the portable TypeScript
  codec in Chromium and pin its RGBA output
- [x] Match agreeing FFmpeg/dav1d and FFmpeg/libaom native YUV byte for byte
  for a checksum-pinned 3840x2160 YUV 4:2:0 8x2 tile frame with deblocking
  and CDEF, and exercise its ordered 32-row RGBA output in Node.js and Chromium
- [x] Match a checksum-pinned non-reduced 8-bit YUV 4:2:0 frame split across
  four tile-group OBUs byte for byte against agreeing dav1d and libaom native
  YUV, and exercise its pinned RGBA output in Chromium
- [x] Match a checksum-pinned `still_picture=0` static AVIF's 1920x1080
  native YUV byte for byte against agreeing dav1d and libaom output, and pin
  its portable RGBA output in Chromium
- [x] Match three checksum-pinned FFmpeg/libaom and Sharp/libaom common-photo
  AVIF fixtures byte for byte against agreeing dav1d and libaom native YUV,
  and pin their portable RGBA outputs in Chromium
- [x] Exercise single-band and multi-band filter-free AV1 super-resolution
  through the portable TypeScript codec in Chromium and pin their RGBA output
- [x] Match agreeing FFmpeg/dav1d and FFmpeg/libaom native YUV byte for byte
  for a checksum-pinned CDEF-plus-Wiener denominator-12 YUV 4:2:0
  super-resolution fixture with a non-block-aligned coded width
- [x] Exercise filtered AV1 super-resolution through the portable TypeScript
  codec in Chromium and pin its RGBA output
- [x] Match agreeing dav1d and libaom native YUV byte for byte for a
  checksum-pinned AV1 film-grain test vector and hold displayed RGBA to
  maximum channel error 2 against both native decoders
- [x] Exercise AV1 film-grain synthesis through the portable TypeScript
  codec in Chromium and pin its RGBA output
- [x] Match Sharp/libavif RGBA exactly for checksum-pinned straight and
  premultiplied alpha fixtures after normalizing premultiplied color to the
  library's straight-RGBA pixel contract
- [x] Exceed 54 dB RGBA PSNR against Sharp/libavif for the checksum-pinned
  cropped-edge 1x5 image grid
- [x] Exercise straight alpha, premultiplied alpha, and image-grid composition
  through the portable TypeScript codec in Chromium and pin each PNG output
- [x] Match compatible RGB matrix/TRC ICC output exactly against Sharp/libvips
  for two checksum-pinned fixtures
- [x] Hold linear BT.2020 conversion to maximum channel error 13 and mean error
  at most 0.5 against an FFmpeg/zimg staged-sRGB oracle
- [x] Hold four checksum-pinned single-image, grid, and resampled ISO
  gain-map outputs to mean channel error at most 1.35 and RGB PSNR at
  least 39 dB against libavif 1.3.0, and reject a non-preferred tmap
- [x] Exercise Rec.2020, RGB ICC, and single-image, grid, and resampled
  gain-map SDR output through the portable TypeScript codec in Chromium
  and pin each RGBA output
- [x] Keep `@stacksjs/ts-avif` development-only; the published package is not a
  production dependency
- [x] Add exact post-filter comparisons against both dav1d and libaom for five
  checksum-pinned deterministic fixtures
- [x] Decode five checksum-pinned default Sharp 0.35.3/libaom q30 through q90
  quantization-matrix fixtures after exact dav1d/libaom oracle agreement
- [x] Hold quantization-matrix output to maximum YUV sample error 3 and at
  least 55 dB PSNR, plus displayed RGB PSNR above 39 dB against Sharp/libaom
- [x] Match Sharp/libavif RGB exactly for checksum-pinned lossy and lossless
  quantizer-context-0 YUV 4:4:4 fixtures, including lossless identity color
- [x] Match Sharp/libavif RGBA exactly for the checksum-pinned 33x11
  draw-points screen-content fixture using luma and chroma palettes
- [x] Match agreeing libaom and dav1d native YUV exactly for the checksum-pinned
  320x280 skipped intra-block-copy fixture
- [x] Match agreeing libaom and dav1d native YUV exactly for the checksum-pinned
  1280x720 monochrome residual intra-block-copy fixture
- [x] Match agreeing libaom and dav1d native YUV exactly for the checksum-pinned
  512x128 YUV 4:4:4 skipped intra-block-copy plus block delta-Q fixture
- [x] Match agreeing libaom and dav1d native YUV exactly for four pinned
  1280x720 and 3840x2160 Microsoft YUV 4:2:0 frames that exercise reduced and
  full still-picture headers plus non-skipped intra-block copy
- [x] Exercise the pinned 1280x720 reduced-header still-picture fixture through
  the portable codec entry in Chromium and pin its RGBA output
- [x] Reject checksum-pinned entropy mutations whose intra-block-copy motion
  vectors overlap the current superblock or escape the decoded plane
- [x] Apply the checksum-pinned 8x6 integer clean aperture to its 16x12 coded
  image and match Sharp/libavif RGBA exactly
- [x] Exercise clean-aperture cropping through the portable codec entry in
  Chromium and pin its RGBA output
- [x] Reconstruct native 10-bit and 12-bit planes exactly for two
  checksum-pinned coded-lossless YUV 4:4:4 fixtures and hold displayed RGB
  maximum error to 1 against Sharp/libavif
- [x] Reconstruct native coded-lossless 10-bit and 12-bit YUV 4:2:0 planes
  and filter-free lossy 10-bit YUV 4:4:4 planes byte for byte against agreeing
  dav1d and libaom for three checksum-pinned fixtures
- [x] Exercise coded-lossless high-bit YUV 4:2:0 and filter-free lossy 10-bit
  YUV 4:4:4 decode through the portable codec entry in Chromium
- [x] Exercise palette-coded 8-bit and coded-lossless 10-bit and 12-bit
  decoding through the portable codec entry in Chromium
- [x] Exercise skipped intra-block-copy decoding through the portable codec
  entry in Chromium
- [x] Keep delta loop-filter syntax explicitly unsupported in the restricted
  quantization-matrix path
- [x] Normalize deterministic bit-flip corruption as `ImageError` across
  checksum-pinned single-band and multi-band super-resolution, high-bit tile,
  premultiplied-alpha, restoration-unit, and cropped-grid AVIF syntax classes
- [x] Match full-size Kodak and Fox post-filter pixels exactly against agreeing
  dav1d and libaom native YUV output
- [x] Survey 237 AVIF files spanning 137 conformance/edge/invalid cases and a
  100-file GB82 matrix encoded by Sharp/libvips and FFmpeg/libaom; complete
  all 100 common-photo inputs and 75 conformance inputs
- [ ] Expand the compatibility corpus with rav1e, SVT-AV1, browser encoders,
  ImageMagick, cameras, and real web uploads
- [ ] Add malformed ISOBMFF, OBU, entropy, partition, coefficient, restoration,
  allocation, and decompression-bomb fuzzing
- [ ] Add a conformance corpus for every checked AV1 syntax combination rather
  than relying on shared photographic fixtures
- [ ] Validate every encoded output with at least two independent decoders

Current measurements and compatibility details are recorded in:

- [`benchmark/results/avif-research-baseline-2026-08-06.md`](benchmark/results/avif-research-baseline-2026-08-06.md)
- [`benchmark/results/avif-phase-b1-bitstream-2026-08-06.md`](benchmark/results/avif-phase-b1-bitstream-2026-08-06.md)
- [`benchmark/results/avif-phase-b2-restricted-decode-2026-08-06.md`](benchmark/results/avif-phase-b2-restricted-decode-2026-08-06.md)
- [`benchmark/results/avif-common-opaque-420-2026-08-07.md`](benchmark/results/avif-common-opaque-420-2026-08-07.md)
- [`benchmark/results/avif-post-filters-2026-08-08.md`](benchmark/results/avif-post-filters-2026-08-08.md)
- [`benchmark/results/avif-qmatrix-sharp-2026-08-08.md`](benchmark/results/avif-qmatrix-sharp-2026-08-08.md)
- [`benchmark/results/avif-bounded-row-output-2026-08-09.md`](benchmark/results/avif-bounded-row-output-2026-08-09.md)
- [`benchmark/results/avif-high-bit-lossy-2026-08-09.md`](benchmark/results/avif-high-bit-lossy-2026-08-09.md)
- [`benchmark/results/avif-layered-selection-2026-08-09.md`](benchmark/results/avif-layered-selection-2026-08-09.md)
- [`benchmark/results/avif-memory-bounded-superres-2026-08-09.json`](benchmark/results/avif-memory-bounded-superres-2026-08-09.json)
- [`benchmark/results/avif-compatibility-survey-2026-08-10.md`](benchmark/results/avif-compatibility-survey-2026-08-10.md)
- [`benchmark/results/avif-memory-bounded-filtered-2026-08-10.json`](benchmark/results/avif-memory-bounded-filtered-2026-08-10.json)
- [`benchmark/results/avif-memory-auxiliary-film-grain-2026-08-10.json`](benchmark/results/avif-memory-auxiliary-film-grain-2026-08-10.json)
- [`benchmark/results/avif-imir-2026-08-09.md`](benchmark/results/avif-imir-2026-08-09.md)
