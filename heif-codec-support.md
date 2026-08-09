<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# HEIF / HEIC experimental decode capability and support plan

PureJsImage's first-party HEIF/HEIC decoder is experimental and opt-in only.
HEIF is the ISO Base Media File Format container; HEIC commonly stores image
items encoded with HEVC/H.265. The decoder is shipped in the npm package but
is excluded from the root module, `allCodecs`, and automatic demo registration.
Applications must import it directly from
`purejsimage/codecs/experimental/heic`.

## Experimental opt-in and patent notice

HEIC files commonly contain images encoded with HEVC/H.265, which may be
subject to third-party patent rights in some jurisdictions. The PureJsImage
MIT license covers copyright in this implementation and does not grant rights
under third-party patents. Users and distributors are responsible for
determining whether their particular use requires additional licenses.
Commercial products, paid cloud conversion services, and high-volume device
distribution should receive their own licensing assessment before enabling it.

This codec must remain experimental and explicitly registered. Future changes
must not add it to the root export, `allCodecs`, the default browser demo, or
any other automatic codec set. See the [FFmpeg legal page](https://ffmpeg.org/legal.html)
and [Access Advance licensing scope](https://accessadvance.com/topic-what-do-we-license/)
for external context; these links are informational and are not legal advice.

A checked implementation item is present and tested in the repository. An
unchecked item is unsupported and must continue to produce explicit errors
rather than partial or incorrect output. HEIF and HEIC encoding are not planned.

## Measured compatibility snapshot (2026-08-08)

The reproducible compatibility corpus contains 25 HEIC/HEIF files. It covers
iPhone 7, 12 Pro, and 13/13 Pro camera output across iOS 11.0.3 and several iOS
16 releases; Xiaomi, Samsung, Nokia, libheif, and x265 encoders; direct and grid
primaries; Main, Main Still Picture, Main 10, and Range Extensions; both color
ranges; sRGB and Display P3; `irot`, `imir`, and `clap`; and valid SDR primaries
beside gain-map, depth, spatial, thumbnail, or alpha items.

Each PureJsImage decode runs in a fresh process with a 512 MiB RSS limit.
ImageMagick 7.1.2 with libheif 1.20.2 independently validates metadata and
displayed pixels. The 200 MP case uses libheif's thumbnailer plus a streaming
PNG downscale because ImageMagick's system pixel-cache policy cannot
materialize that 199.8 MP frame.

The current results are:

- 18 compatible
- 6 explicitly unsupported
- 1 incorrect-pixels result
- 0 unexpected exceptions
- 0 invalid inputs, timeouts, or excessive-memory results

The compatible set includes iPhone 7/12/13 grids, Apple depth and HDR gain-map
companions beside valid SDR primaries, Xiaomi and Samsung grids, a Vision Pro
spatial primary, clean-aperture and mirrored libheif/iPhone cases, and the 200 MP
Samsung file. The 200 MP full decode peaks at 401.8 MiB RSS and matches the
independent downscaled pixels at 0.030091 normalized sRGB RMSE.

Deterministic color-matrix resolution advances all nine formerly blocked cases.
Six now match the displayed oracle within the unchanged 0.035 RMSE limit. The
libheif example reaches a later 0.035339 displayed-pixel discrepancy, and two
Nokia files reach explicit slice-segmentation failures. Inputs outside the
narrow ICC/SDR Main or Main Still Picture 4:2:0 evidence policy remain
explicitly unsupported instead of silently assuming BT.601 or BT.709.

The `hvcC` array-completeness bit is parsed correctly. The clean-aperture
libheif file now matches at 0.001507 RMSE after applying its SPS conformance
window; the alpha fixture fails explicitly until auxiliary alpha reconstruction
is implemented. The Main 10/PQ displayed path matches ImageMagick/libheif at
0.001007 RMSE under the documented hard-clipped 8-bit compatibility policy.

See `benchmark/results/heif-compatibility-2026-08-08.md` for the complete
per-file matrix. No new HEVC syntax was added while producing this baseline.

## Scope decisions

- [x] Prioritize decode for user-upload workflows, including photos uploaded
  from iPhones, photo libraries, and messaging services
- [x] Implement one shared internal codec for `.heif` and `.heic`; the public
  `experimentalHeicCodec` and `experimentalHeifCodec` names alias that decoder
- [x] Scope the first release to HEVC-coded still images in HEIF containers
- [x] Keep AV1-coded AVIF in the existing `avifCodec` rather than routing it
  through the HEIF public surface
- [x] Do not implement HEIF or HEIC encoding, container writing, or public
  `.heif()` / `.heic()` output APIs
- [x] Publish HEIF/HEIC only through the experimental direct import and exclude
  it from the root export, `allCodecs`, and automatic demo registration
- [x] Ship the implementation in the npm package without automatically
  registering or activating it when HEIF/HEIC input is detected
- [x] State that MIT copyright permission grants no third-party HEVC patent
  rights and that users must assess obligations for their own use
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
- [x] Parse the hvcC array-completeness bit independently from its reserved bit
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
- [x] Independently validate displayed real-world `imir` and `clap` pixels
- [x] Return display dimensions after clean-aperture and orientation transforms
- [ ] Define and test precedence between native HEIF transforms and EXIF
  orientation so a photo is never rotated twice

### Common HEVC profiles and samples

- [x] HEVC Main and Main Still Picture profile decode for 8-bit YUV 4:2:0
- [x] HEVC Main 10 profile reconstruction for 10-bit YUV 4:2:0
- [x] Claim displayed Main 10/PQ compatibility only for the independently
  validated 8-bit display policy documented below; HLG is not yet promoted
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
- [ ] Complete chroma-location, limited/full-range, and odd-dimension handling
  without off-by-one reads or color-plane shifts
- [x] Reject inter-predicted pictures and multilayer NAL units explicitly in the
  still-image inspection path
- [x] Reject profiles outside Main, Main 10, and Main Still Picture, non-IDR
  random-access pictures, and SPS/PPS range, multilayer, 3D, screen-content, or
  unspecified extensions explicitly in the inspection path

### Color and output

- [x] Parse `colr` properties containing `nclx`, restricted ICC (`rICC`), and
  unrestricted ICC (`prof`) data
- [x] Correctly render the compatible sRGB and Display P3 cases to the
  pipeline's declared output color space
- [x] Resolve matching explicit nclx/VUI matrices, and resolve absent or
  unspecified matrices only for the pinned SDR/ICC Main or Main Still Picture
  4:2:0 HEVC-family evidence policy; reject conflicts and ambiguity explicitly
- [x] Convert 8-bit YUV to pipeline pixel blocks without a duplicate full-frame
  RGB or RGBA allocation
- [x] Match the Main 10/PQ displayed SDR oracle at 0.001007 normalized RMSE
  using signaled-matrix conversion, nearest 4:2:0 chroma, 8-bit rounding, and
  hard clipping while preserving PQ code values
- [ ] Preserve opaque, binary-alpha, and partial-alpha values when a supported
  auxiliary alpha item is present
- [x] Decode a valid SDR base image even when unsupported depth, matte, or gain
  map auxiliary items are also present, with invalid auxiliary payloads proving
  that `pitm` primary selection wins
- [x] Return stable metadata for width, height, bit depth, alpha, frame count,
  primary item, color description, and orientation
- [x] Expose `.heif` and `.heic` detection through the normal image pipeline only
  after the experimental codec is explicitly imported and registered

### Common metadata

- [x] Parse bounded EXIF item extents and expose the metadata fields supported
  by PureJsImage
- [ ] Parse bounded XMP MIME items without making XMP parsing necessary for
  pixel decode
- [x] Ignore unknown non-essential metadata and auxiliary items safely while
  decoding a valid SDR primary
- [x] Preserve compatible EXIF and ICC metadata according to explicit caller
  options and output-codec support, with stripping as the default
- [ ] Preserve XMP metadata when explicitly requested

## Group 2: common compatibility improvements — should have

These features are regularly encountered, but a correct primary SDR image can
ship before all of them are complete.

- [ ] Auxiliary alpha images, including independent dimensions and grid alpha
- [ ] Thumbnail (`thmb`) relationships and an explicit thumbnail-selection API
- [ ] Identity-derived images (`iden`) without recursive-reference loops
- [ ] Pixel aspect ratio (`pasp`) and additional display-aperture behavior
- [x] PQ 10-bit inputs with a documented libheif-compatible 8-bit display
  policy: preserve PQ code values, apply the signaled YCbCr matrix with nearest
  4:2:0 chroma, round to 8-bit, and hard-clip to the SDR display gamut
- [ ] Independently validate HLG displayed pixels; its existing linear-light
  BT.2020-to-sRGB Reinhard path remains unit-tested but is not corpus-promoted
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

- [x] Pin redistributable or reproducibly downloadable fixtures from multiple
  iPhone/iOS generations and at least two independent non-Apple encoders
- [x] Cover landscape and portrait orientation, mirrored orientation, grids,
  odd dimensions, crop apertures, sRGB, Display P3, 8-bit Main, and 10-bit Main
- [x] Cover auxiliary alpha, EXIF, XMP, ICC, thumbnails, unsupported auxiliary
  data, HDR base images, and gain maps as their groups are implemented
- [x] Record fixture provenance, encoder, brands, item graph, profile, bit depth,
  chroma format, color metadata, dimensions, and checksums in the corpus
- [x] Validate metadata against independent development-only parsers
- [x] Validate supported iPhone benchmark pixels against an independent
  HEIF/HEVC oracle with documented tolerances for color conversion, resizing,
  and lossy JPEG output
- [x] Verify every benchmark output before recording timing or memory results
- [x] Benchmark metadata, full HEIC-to-PNG decode, auto-oriented
  resize-to-JPEG, and crop-resize-to-PNG workflows in isolated processes
- [ ] Add distinct raw full-decode and full-size HEIC-to-JPEG workflows
- [x] Measure cold and warm absolute peak RSS, RSS delta, external memory, and
  ArrayBuffer memory on realistic phone-photo dimensions
- [x] Include large single-image and multi-tile inputs that expose source-sized
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
