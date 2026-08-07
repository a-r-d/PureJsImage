# HEIF / HEIC decode support plan

This document is the implementation plan and eventual capability contract for
PureJsImage's first-party HEIF decoder. HEIF is the ISO Base Media File Format
container; HEIC is the common HEIF variant whose image items are compressed
with HEVC. The target is a HEIF container reader plus a first-party HEVC
still-picture decoder. HEIF and HEIC encoding are not planned.

A checked implementation item is already present and tested in the repository.
An unchecked item is not supported yet. Items in the deferred groups do not
block the initial release and must continue to produce explicit unsupported
errors rather than partial or incorrect output.

## Scope decisions

- [x] Prioritize decode for user-upload workflows, including photos uploaded
  from iPhones, photo libraries, and messaging services
- [x] Implement one shared `heifCodec` core for `.heif` and `.heic`; any
  `heicCodec` public name should be an alias, not a second decoder
- [x] Scope the first release to HEVC-coded still images in HEIF containers
- [x] Keep AV1-coded AVIF in the existing `avifCodec` rather than routing it
  through the HEIF public surface
- [x] Do not implement HEIF or HEIC encoding, container writing, or public
  `.heif()` / `.heic()` output APIs
- [x] Require a patent and licensing review before publishing HEVC decode; a
  first-party open-source implementation does not remove that release
  consideration
- [x] Keep all non-PureJsImage decoders and encoders as development-only fixture
  oracles; the published package must retain no runtime dependencies

## Encoding is not planned

HEIF/HEIC encoding is a non-goal, not a later phase of this plan. PureJsImage
will not expose HEIF/HEIC output, container writing, transcoding-to-HEIC, or an
HEVC encoder. Decoded HEIF/HEIC uploads can instead be written with an existing
JPEG, PNG, WebP, TIFF, or eventual AVIF encoder.

## Group 0: shared container foundation

These tasks should happen before HEVC pixel work. They prevent the HEIF and
AVIF codecs from growing separate parsers for the same hostile container.

- [x] Bounded ISO Base Media File Format box parsing exists in the AVIF codec
- [x] Existing AVIF parsing covers item information, primary-item selection,
  item locations, `idat`/`mdat` extents, properties, references, grids, alpha
  relationships, color information, and rotation
- [x] Extract bounded box traversal, brand parsing, checked offsets, and sized
  integers into an internal ISOBMFF module with format-neutral types, limits,
  and error context
- [x] Extract shared primary-item, item-info, item-location,
  property-association, and item-reference parsing while retaining typed
  codec-specific property decoders
- [x] Preserve the current AVIF behavior and fixture coverage through that
  extraction
- [x] Detect the common HEIF and HEVC brand families without trusting filename
  extensions or MIME types
- [x] Accept compatible generic HEIF/MIAF brands when the primary item and its
  required properties identify a supported HEVC still image
- [x] Reject AVIF, unsupported coded-image item types, protected items, external
  data references, and malformed brand/property combinations explicitly
- [x] Parse `hvc1` image items and their required `hvcC` decoder configuration
- [x] Inspect `grid` primary items and validate their tile references, geometry,
  and consistent HEVC decoder configurations without claiming pixel decode
- [x] Parse HEVC configuration arrays and length-prefixed VPS, SPS, PPS, and
  image-item NAL units with strict extent and count limits
- [x] Support multiple extents without concatenating the complete compressed
  item when a bounded reader can traverse them directly
- [x] Parse and validate `imir` mirror and `clap` clean-aperture properties,
  including transform order, aperture bounds, display dimensions, and composed
  orientation metadata
- [ ] Add the remaining properties needed by the common-decode group below

## Group 1: common still-image decode — required for v1

This group defines the minimum support that can reasonably be called HEIC
upload support. It targets the primary photograph and its intended SDR display,
not every auxiliary asset stored beside it.

### Primary image and layout

- [x] Select and decode one declared primary image
- [x] Decode a directly coded `hvc1` primary item
- [x] Decode `grid` derived images and validate every tile reference, tile
  geometry, edge crop, and final canvas extent
- [x] Decode grid tiles directly into the requested crop/resize workflow rather
  than first assembling a source-sized RGBA canvas
- [ ] Support multiple slices and tiles within one coded HEVC picture
- [x] Apply `irot`, `imir`, and `clap` in the defined order
- [x] Return display dimensions after clean-aperture and orientation transforms
- [ ] Define and test precedence between native HEIF transforms and EXIF
  orientation so a photo is never rotated twice

### Common HEVC profiles and samples

- [x] HEVC Main and Main Still Picture profile decode for 8-bit YUV 4:2:0
- [x] HEVC Main 10 profile decode for 10-bit YUV 4:2:0
- [ ] VPS, SPS, PPS, NAL-unit, picture, and slice-header syntax required by
  supported still pictures
- [x] Implement bounded EBSP-to-RBSP validation and parse common SPS and PPS
  syntax through exact RBSP trailing bits, including coding-tree geometry,
  scaling lists, reference-picture sets, VUI/HRD, PCM, tile layout, deblocking,
  and slice-header control flags
- [x] Inspect IDR slice-segment headers, resolve their PPS and SPS, bound CTB
  addresses and entry-point offsets, and validate ordering across multiple
  slices without reading the CABAC payload
- [x] CABAC context initialization, binary arithmetic decoding, bypass bins,
  and termination with strict end-of-stream checks
- [x] Coding-tree-unit and coding-unit partition reconstruction
- [x] Planar, DC, and angular intra prediction for luma and chroma
- [x] Transform-unit parsing, inverse quantization, inverse transforms, and
  residual reconstruction for supported transform sizes
- [x] Default and signaled scaling lists used by the target profiles
- [x] Deblocking and sample-adaptive offset filtering before releasing pixels
- [ ] Constrained intra prediction, transform skip, PCM, and other tools that
  valid target-profile still images can signal
- [x] Entropy-coding synchronization and WPP entry-point offsets used by Apple
  Main Still Picture tiles
- [ ] Tiles within a coded picture, dependent slice segments, and their
  entry-point layouts
- [ ] Chroma-location, limited/full-range, and odd-dimension handling without
  off-by-one reads or color-plane shifts
- [x] Reject inter-predicted pictures and multilayer NAL units explicitly in the
  still-image inspection path
- [x] Reject profiles outside Main, Main 10, and Main Still Picture, non-IDR
  random-access pictures, and SPS/PPS range, multilayer, 3D, screen-content, or
  unspecified extensions explicitly in the inspection path

### Color and output

- [ ] Parse `colr` properties containing `nclx`, restricted ICC (`rICC`), and
  unrestricted ICC (`prof`) data
- [ ] Correctly render the common sRGB and Display P3 cases to the pipeline's
  declared output color space
- [x] Convert 8-bit YUV to pipeline pixel blocks without a duplicate full-frame
  RGB or RGBA allocation
- [x] Convert 10-bit YUV to pipeline pixel blocks and validate it against an
  independent oracle
- [ ] Preserve opaque, binary-alpha, and partial-alpha values when a supported
  auxiliary alpha item is present
- [x] Decode a valid SDR base image even when unsupported depth, matte, or gain
  map auxiliary items are also present
- [x] Return stable metadata for width, height, bit depth, alpha, frame count,
  primary item, color description, and orientation
- [x] Expose `.heif` and `.heic` content detection and the public decode path
  through the normal image pipeline

### Common metadata

- [ ] Parse bounded EXIF item extents and expose the metadata fields supported
  by PureJsImage
- [ ] Parse bounded XMP MIME items without making XMP parsing necessary for
  pixel decode
- [ ] Ignore unknown non-essential metadata and auxiliary items safely
- [ ] Preserve or intentionally strip EXIF, XMP, and ICC metadata according to
  an explicit pipeline policy; never preserve it accidentally

## Group 2: common compatibility improvements — should have

These features are regularly encountered, but a correct primary SDR image can
ship before all of them are complete.

- [ ] Auxiliary alpha images, including independent dimensions and grid alpha
- [ ] Thumbnail (`thmb`) relationships and an explicit thumbnail-selection API
- [ ] Identity-derived images (`iden`) without recursive-reference loops
- [ ] Pixel aspect ratio (`pasp`) and additional display-aperture behavior
- [x] PQ and HLG 10-bit inputs with a documented SDR tone-map policy: decode
  the signaled transfer to linear light, convert BT.2020 primaries to sRGB,
  apply a luminance-preserving global Reinhard curve with 203-nit PQ reference
  white, and encode 8-bit sRGB
- [ ] Optional higher-precision output when the core pixel model supports more
  than 8 bits per channel
- [ ] Monochrome HEVC still images
- [ ] Additional MIAF-conformant brands and constraints
- [ ] Multiple top-level still images with explicit index selection while
  retaining primary-image decode as the default
- [ ] Metadata-only inspection without parsing or allocating HEVC coefficient
  or sample state

## Group 3: nice to have later

These improve photo-library fidelity or specialist compatibility, but are not
required for the normal upload-to-resize workflow.

- [ ] Apple HDR gain-map discovery and reconstruction
- [ ] ISO 21496 gain-map and HEIF tone-map (`tmap`) derived-image support
- [ ] Preserve a backward-compatible SDR base when gain-map reconstruction is
  unavailable
- [ ] Auxiliary depth and disparity image discovery and opt-in extraction
- [ ] Portrait-effects, semantic-segmentation, and other auxiliary matte access
- [ ] Overlay-derived images (`iovl`)
- [ ] HEVC Range Extension 4:2:2 and 4:4:4 chroma formats
- [ ] Twelve-bit and higher-precision HEVC still images
- [ ] Lossless HEVC still-image modes
- [ ] Region-of-interest APIs for independently addressable tiles

## Group 4: explicitly skip for the initial codec

These unchecked items are deliberate non-goals for v1 and v1 compatibility
work. Their absence should be documented and detected cleanly.

- [ ] Timed HEIF/HEIC image sequences, animation, frame timing, looping, and
  inter-picture HEVC prediction
- [ ] Live Photo paired video/audio assets
- [ ] Burst, stereo, multilayer, and multi-view presentation semantics
- [ ] AVC-, JPEG-, VVC-, EVC-, or other non-HEVC image payloads exposed through
  `heifCodec`
- [ ] Encrypted or otherwise protected image items
- [ ] External item data references or network-backed extents
- [ ] Editing-history interpretation and vendor-private photo-library data
- [ ] A generic API that exposes every item and relationship in the container

## Decode memory and safety contract

- [ ] Treat every box, item, property, NAL unit, parameter set, slice, tile,
  entropy read, and arithmetic operation as hostile input
- [ ] Validate dimensions, chroma geometry, bit depth, CTU counts, tile and slice
  boundaries, transform sizes, coefficient counts, and decoded-byte budgets
  before allocation or indexing
- [ ] Reject recursive derived-image graphs, duplicate/conflicting required
  properties, overlapping invalid extents, and allocation-size overflow
- [ ] Bound compressed input, metadata, image count, item count, property count,
  reference count, NAL count, dimensions, pixels, and working memory separately
- [ ] Reconstruct a directly coded image in bounded CTU rows, retaining only the
  neighboring samples and filter state required by HEVC
- [ ] Retain compact coefficient or syntax state only where the bitstream
  requires it; do not make a full RGBA source bitmap the decoder boundary
- [ ] Decode grids tile-by-tile and release a tile as soon as it cannot
  contribute to the requested output
- [ ] Push crop and downscale requirements into grid selection and HEVC sample
  reconstruction wherever correctness permits
- [ ] Account for concurrent YUV planes, reference rows, filter rows, alpha,
  color conversion, resize state, output buffers, and compressed output in the
  working-memory limit
- [ ] Benchmark any temporary full-frame fallback as a separate, explicit path;
  it must not define the primary Lambda workflow

## Decode tests, fixtures, and benchmarks

- [ ] Pin redistributable fixtures from multiple iPhone/iOS generations and at
  least two independent non-Apple encoders
- [ ] Cover landscape and portrait orientation, mirrored orientation, grids,
  odd dimensions, crop apertures, sRGB, Display P3, 8-bit Main, and 10-bit Main
- [ ] Cover auxiliary alpha, EXIF, XMP, ICC, thumbnails, unsupported auxiliary
  data, HDR base images, and gain maps as their groups are implemented
- [ ] Record fixture provenance, encoder, brands, item graph, profile, bit depth,
  chroma format, color metadata, dimensions, and checksums in the corpus
- [ ] Validate metadata against independent development-only parsers
- [x] Validate supported iPhone benchmark pixels against an independent
  HEIF/HEVC oracle with documented tolerances for color conversion, resizing,
  and lossy JPEG output
- [x] Verify every benchmark output before recording timing or memory results
- [x] Benchmark metadata, full HEIC-to-PNG decode, auto-oriented
  resize-to-JPEG, and crop-resize-to-PNG workflows in isolated processes
- [ ] Add distinct raw full-decode and full-size HEIC-to-JPEG workflows
- [x] Measure cold and warm absolute peak RSS, RSS delta, external memory, and
  ArrayBuffer memory on realistic phone-photo dimensions
- [ ] Include large single-image and multi-tile inputs that expose source-sized
  intermediate allocations
- [ ] Add malformed-box, extent, item-graph, `hvcC`, parameter-set, slice,
  CABAC, coefficient, tile, and decompression-bomb regression fixtures
- [ ] Run coverage-guided fuzzing with strict time, allocation, and output limits

## Decode v1 is complete when

- [ ] Group 0 and Group 1 are implemented and covered by pinned fixtures
- [ ] Unsupported Group 2-4 inputs fail explicitly or return the correct SDR
  primary image when the unsupported item is non-essential
- [ ] The primary crop/resize workflow has bounded memory for direct and grid
  HEVC images
- [ ] Independent oracles confirm dimensions, orientation, color, alpha, and
  decoded pixels
- [x] `npm run check` and the isolated HEIC fixture/benchmark verification pass

## Standards and platform references

- [ISO/IEC 23008-12:2025 — Image File Format](https://www.iso.org/standard/89035.html)
- [ISO/IEC 23008-2:2025 — High efficiency video coding](https://www.iso.org/standard/90502.html)
- [ISO/IEC 23000-22:2025 — Multi-image application format](https://www.iso.org/standard/87576.html)
- [Apple: HEIC image properties](https://developer.apple.com/documentation/imageio/heic-image-properties)
- [Apple: Applying Apple HDR effect to your photos](https://developer.apple.com/documentation/appkit/applying-apple-hdr-effect-to-your-photos)
- [Apple WWDC24: Use HDR for dynamic image experiences in your app](https://developer.apple.com/videos/play/wwdc2024/10177/)
