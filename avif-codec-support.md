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
- [ ] Pixel decoding and composition of grid items
- [ ] Pixel decoding and composition of alpha auxiliary items
- [ ] Clean-aperture cropping through `clap`
- [ ] Mirroring through `imir`
- [ ] Pixel-aspect-ratio and other transformative item properties
- [ ] Gain maps, depth maps, thumbnails, overlays, derived images other than
  grids, and other auxiliary-image semantics
- [ ] EXIF and XMP item discovery and metadata exposure
- [ ] ICC profile parsing and color-managed conversion
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
- [ ] Non-reduced sequence headers
- [ ] Multiple operating-point selection
- [ ] Annex B AV1 byte streams
- [ ] Inter-frame or general video decoding

### Implemented opaque 8-bit 4:2:0 still path

- [x] One `av01` primary image with one complete AV1 frame OBU
- [x] Reduced still-picture, intra-only AV1
- [x] AV1 Main Profile, 8-bit YUV 4:2:0 output
- [x] Lossless and lossy quantization paths used by the permanent fixtures
- [x] 64x64 and 128x128 superblocks
- [x] One complete AV1 tile
- [x] Range-coded symbol decoding with adaptive CDF updates and final-state
  validation
- [x] Skip signaling, keyframe intra modes, angle deltas, transform selection,
  and coefficient contexts
- [x] `NONE`, `SPLIT`, horizontal, vertical, horizontal-4, vertical-4, and
  tip-split intra partition traversal
- [x] Exact structural top-right and bottom-left edge availability across the
  partition tree
- [x] DC, vertical, horizontal, all directional, smooth, Paeth, and
  filter-intra prediction modes used by common photographic input
- [x] Chroma-from-luma prediction
- [x] Intra-edge filtering and edge upsampling
- [x] Square and rectangular transform traversal through 64x64
- [x] DCT, ADST, flipped-ADST, and identity inverse-transform combinations
  needed by the permanent common-photo corpus
- [x] Nonzero coefficient reconstruction in quantizer contexts 2 and 3
- [x] All-zero coefficient blocks in the supported frame path
- [x] 8-bit dequantization and inverse transforms
- [x] Odd-dimension edge clipping without decoding transforms outside the coded
  frame
- [x] Bilinear YUV 4:2:0 to RGBA conversion
- [x] Public crop, resize, AVIF-to-PNG, AVIF-to-JPEG, AVIF-to-WebP, and
  AVIF-to-other-implemented-codec pipelines after frame reconstruction
- [ ] Multiple independently decoded AV1 tiles
- [ ] Tile-list or partial tile-group OBUs
- [ ] Intra block copy and other screen-content tools
- [ ] Palette mode
- [ ] Complete segmentation-map, delta-Q, and delta-loop-filter reconstruction
  outside the combinations exercised by the current corpus
- [ ] Every legal transform-size, transform-type, coefficient-context, and
  quantizer-context combination
- [ ] Super-resolution reconstruction
- [ ] Film grain synthesis

### In-loop filtering and restoration

- [x] Parse loop-filter header syntax sufficiently to remain synchronized
- [x] Parse CDEF header syntax and per-unit CDEF indexes
- [x] Parse restoration types and restoration-unit sizes
- [x] Consume none, Wiener, self-guided, and switchable restoration-unit syntax
- [x] Maintain Wiener and self-guided reference parameters while reading units
- [ ] Apply the AV1 deblocking loop filter
- [ ] Apply CDEF to luma and chroma planes
- [ ] Apply Wiener loop restoration
- [ ] Apply self-guided loop restoration
- [ ] Apply super-resolution in the correct position relative to CDEF and loop
  restoration
- [ ] Match independent post-filter reference pixels within documented
  tolerances for lossy photographs

The current common-photo output is the valid pre-filter reconstruction. Files
whose restoration syntax is present can be parsed and decoded without entropy
desynchronization, but they must not yet be described as post-filter pixel
exact.

### Additional still-image compatibility

- [ ] 8-bit monochrome
- [ ] 10-bit and 12-bit Main Profile YUV 4:2:0
- [ ] 8/10/12-bit YUV 4:2:2
- [ ] 8/10/12-bit YUV 4:4:4
- [ ] Full-range high-bit-depth output without premature 8-bit truncation
- [ ] Opaque alpha-plane defaults and decoded auxiliary alpha
- [ ] Premultiplied-alpha signaling and correct unpremultiplication behavior
- [ ] Multi-tile grids and tile-edge composition
- [ ] Non-reduced still-picture headers
- [ ] Still images stored across multiple frame or tile-group OBUs
- [ ] Progressive layered AVIF items
- [ ] HDR PQ and HLG inputs with a documented SDR or HDR output policy
- [ ] Wide-gamut NCLX and ICC-managed conversion

### Animation

- [x] Detect the `avis` sequence brand and avoid reporting a false one-frame
  metadata count
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
- [x] The current decoder's padded full-frame Y, U, V, and RGBA allocations are
  documented as a temporary fallback rather than the Lambda northstar
- [ ] Decode one tile or bounded superblock working set at a time
- [ ] Avoid retaining a full source-resolution RGBA bitmap
- [ ] Feed resize directly from bounded YUV rows, blocks, or planes
- [ ] Avoid RGB entirely for compatible AVIF-to-resize-to-AVIF workflows
- [ ] Release coefficient, prediction, filter, and restoration state as soon as
  its output halo is complete
- [ ] Apply a codec-specific working-memory limit covering compressed item
  bytes, tile state, coefficient contexts, YUV planes, filter halos, RGBA
  conversion, resize state, and encoded output
- [ ] Benchmark isolated cold-process peak RSS across source dimensions and
  downscale ratios relevant to AWS Lambda
- [ ] Demonstrate the project's 80% memory-reduction target against equivalent
  Jimp-compatible workflows where a comparison is possible

## Correctness and safety contract

- [x] Reject malformed box sizes, nesting, extents, references, item IDs,
  property associations, dimensions, and metadata contradictions explicitly
- [x] Reject malformed OBU sizes, duplicate sequence headers, truncated frame
  headers, tile overruns, invalid arithmetic symbols, impossible partitions,
  coefficient scans, and transform bounds explicitly
- [x] Inspect all 25 checksum-pinned permanent corpus files and 35 unique coded
  items across `mdat`, `idat`, multiple extents, grids, alpha, 8/10/12-bit,
  4:0:0/4:2:0/4:2:2/4:4:4, and progressive storage
- [x] Pass metadata expectations for all 25 permanent corpus files
- [x] Decode exact independent reference pixels for the embedded 2x2 lossless
  fixture and the 4x4 lossy fixture
- [x] Decode and pin RGBA regression hashes for Kodak 768x512 and Fox 1204x800
  opaque 8-bit YUV 4:2:0 photographs
- [x] Benchmark both full-size photographs through the public AVIF-to-PNG
  workflow
- [x] Report the current broad decode corpus as 3 compatible, 22 explicitly
  unsupported, zero invalid, and zero unexpected
- [x] Keep `@stacksjs/ts-avif` development-only; the published package is not a
  production dependency
- [ ] Add post-filter independent-reference comparisons for the full-size
  photographs
- [ ] Expand to a 200-500 image corpus from libaom, rav1e, SVT-AV1, browsers,
  ImageMagick, Sharp/libvips, cameras, and real web uploads
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
