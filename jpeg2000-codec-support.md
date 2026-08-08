# JPEG 2000 / JP2 decode support plan

This document is the implementation plan and eventual capability contract for
PureJsImage's first-party JPEG 2000 decoder. The practical target is a static
`.jp2` file received as `image/jp2`, including uploads delivered through Twilio
MMS. JPEG 2000 encode is intentionally out of scope.

A checked implementation item is already present and tested in the repository.
An unchecked item is not supported yet. Items in the deferred groups do not
block the first release and must remain explicit unsupported cases until they
are implemented and independently validated.

The current codec is a useful first decode subset, not the completed v1 memory
contract below. It decodes common Part 1 grayscale and RGB JP2 files through an
explicit full-frame fallback. Reduced-resolution, crop-aware entropy decode and
the less common JP2 channel-mapping features remain unchecked.

## Scope decisions

- [x] Prioritize decoding static `image/jp2` uploads
- [x] Implement JPEG 2000 decoding in this repository without a runtime codec
  dependency, bundled native library, WebAssembly module, or copied third-party
  implementation
- [x] Use independent implementations only as development-time fixture and
  benchmark oracles
- [x] Study [`runk/jpeg2000`](https://github.com/runk/jpeg2000) as a
  development reference for pure-JavaScript codestream behavior, while keeping
  the PureJsImage implementation original and independently structured
- [x] Detect JP2 from its contents; a `.jp2` extension or `image/jp2` header is
  a hint and never proof that the input is valid
- [x] Target the Part 1 JP2 file format and Part 1 JPEG 2000 codestream first
- [x] Decode one static image from one contiguous codestream
- [ ] Make reduced-resolution, crop-aware, bounded-memory decode the primary
  Lambda path
- [x] Do not implement JPEG 2000 encoding as part of this plan

## Group 0: JP2 upload and container support — required for v1

This group gets an uploaded `image/jp2` file safely to a bounded JPEG 2000
codestream reader.

### Detection and box parsing

- [x] Recognize the 12-byte JP2 signature box, including its fixed signature
  payload
- [x] Parse big-endian box headers with 32-bit lengths, extended 64-bit lengths,
  and boxes extending to end-of-file
- [x] Validate every box header, length, nesting level, and end offset before
  reading or allocating
- [x] Require the JP2 signature, file type (`ftyp`), JP2 header (`jp2h`), and
  contiguous codestream (`jp2c`) structure expected by a baseline JP2 file
- [x] Validate the `jp2 ` brand and compatible-brand list
- [x] Enforce required box ordering, uniqueness, and containment rules
- [x] Skip unknown and application-specific boxes by their validated extents
- [ ] Reject truncated, overlapping, recursively nested, or contradictory box
  structures explicitly
- [ ] Read the `jp2c` box through a bounded byte reader rather than copying the
  complete codestream

### Image header and color boxes

- [x] Parse the image header (`ihdr`) dimensions, component count, bit depth,
  compression type, color-space-known flag, and intellectual-property flag
- [x] Parse per-component bit depth (`bpcc`) when components do not share one
  precision and signedness
- [ ] Parse all color specification (`colr`) boxes and choose the applicable
  entry using their precedence and approximation fields
- [ ] Parse palette (`pclr`), component mapping (`cmap`), and channel definition
  (`cdef`) boxes as one validated channel-mapping graph
- [ ] Parse capture and display resolution (`res `, `resc`, and `resd`) without
  allowing rational or exponent arithmetic to overflow
- [x] Cross-check `ihdr` dimensions, component count, precision, and compression
  claims against the codestream `SIZ` marker
- [x] Reject contradictory required metadata instead of silently choosing the
  more convenient value
- [ ] Report width, height, component count, channel count, channel precision,
  alpha presence, color description, lossless capability, tile geometry, and
  available resolution levels from metadata inspection

### Upload behavior

- [x] Register `.jp2` and `image/jp2` on the public decode surface
- [x] Accept `Buffer` and `Uint8Array` inputs through the configured library's `open`
  path
- [ ] Preserve the original Twilio media content type as provenance only; use
  content detection for codec selection
- [ ] Return a clear unsupported-format error for raw J2K codestreams, JPX,
  JPM, Motion JPEG 2000, and HTJ2K rather than misparsing them as baseline JP2
- [ ] Allow bounded metadata inspection without starting entropy or wavelet
  decode

## Group 1: common Part 1 codestream decode — required for v1

This is the smallest credible decode target for real JP2 uploads. It includes
both lossless and lossy still images produced by independent encoders.

### Main and tile-part syntax

- [x] Parse and validate `SOC`, `SIZ`, `COD`, `COC`, `QCD`, `QCC`, `SOT`,
  `SOD`, and `EOC` markers
- [ ] Handle marker segments split across input chunks without concatenating
  the entire codestream
- [x] Validate reference-grid origins, image extents, tile origins, tile sizes,
  component sampling, precision, and signedness before allocation
- [x] Support one tile and multiple independently reconstructed tiles
- [ ] Support multiple tile-parts per tile and verify tile-part indexes, counts,
  declared lengths, and ordering
- [x] Apply main-header coding and quantization defaults plus valid
  component-specific and tile-specific overrides
- [x] Support one or more quality layers without assuming every layer is
  present in one packet
- [x] Support all five Part 1 progression orders: LRCP, RLCP, RPCL, PCRL, and
  CPRL
- [x] Validate every resolution, component, precinct, layer, packet, code-block,
  and byte-range calculation before reading packet data

### Packet and code-block reconstruction

- [x] Generate the precinct and packet sequence for every supported progression
  order
- [x] Decode packet inclusion and zero-bit-plane tag trees with bounded depth
  and node counts
- [x] Parse code-block contribution counts, coding-pass counts, segment lengths,
  and layer accumulation without integer overflow
- [x] Implement JPEG 2000 bit stuffing and packet-header alignment exactly
- [x] Implement the MQ binary arithmetic decoder, context state transitions,
  renormalization, byte input, and termination checks
- [x] Implement significance-propagation, magnitude-refinement, and cleanup
  coding passes
- [x] Reconstruct coefficient signs, magnitudes, and subband contexts
- [ ] Support the Part 1 code-block style flags: selective arithmetic bypass,
  context reset, termination after each pass, vertical causal context, predictable
  termination, and segmentation symbols
- [ ] Validate predictable termination when signaled
- [x] Validate segmentation symbols when signaled
- [x] Reject malformed tag trees, impossible pass counts, invalid segment
  lengths, coefficient-plane overflow, and arithmetic reads past packet bounds

### Quantization, wavelets, and samples

- [x] Decode no-quantization, scalar-derived, and scalar-expounded quantization
  styles
- [ ] Apply subband guard bits, exponents, mantissas, ROI shifts, and coefficient
  scaling without unsafe integer arithmetic
- [x] Implement exact reversible 5/3 inverse wavelet reconstruction for
  lossless images
- [x] Implement irreversible 9/7 inverse wavelet reconstruction for lossy
  images with defined numeric precision and output rounding
- [x] Handle symmetric wavelet extension at odd image, tile, component, and
  resolution boundaries
- [ ] Reconstruct component sample ranges using each component's precision and
  signedness
- [x] Implement the reversible color transform for lossless RGB codestreams
- [x] Implement the irreversible color transform for lossy RGB codestreams
- [x] Combine tiles without gaps, overlaps, seams, or incorrect edge samples

### Common pixel and color output

- [x] One-component unsigned grayscale at 1-16 bits per sample
- [x] Three-component unsigned RGB at 8 and 16 bits per sample
- [x] Enumerated grayscale, sRGB, and sYCC JP2 color spaces
- [x] Correct sYCC chroma offsets, component sampling, and conversion to the
  pipeline output color space
- [ ] Restricted ICC profiles for common gray, sRGB, and Display P3 images
- [ ] Palette and component mapping for indexed images
- [ ] Unassociated and premultiplied opacity channels declared by `cdef`
- [ ] Correct channel ordering when codestream component order differs from
  display channel order
- [x] Convert high-precision samples to `gray8`, `rgb8`, or `rgba8` with a
  documented rounding policy rather than truncating low bits accidentally
- [ ] Emit bounded, ordered pixel blocks into the existing crop, resize, and
  encoder pipeline
- [x] Support JP2-to-JPEG, JP2-to-PNG, JP2-to-WebP, crop, resize, and
  resize-plus-encode workflows

## Group 2: Part 1 compatibility — should have

These features are legal Part 1 codestream options or useful static-image
behavior, but the initial Twilio upload milestone can reject them explicitly if
the pinned common corpus does not require them.

- [ ] Progression-order changes (`POC`)
- [ ] Packed packet headers in main (`PPM`) and tile-part (`PPT`) headers
- [ ] Start-of-packet (`SOP`) and end-of-packet-header (`EPH`) markers
- [ ] Tile-part length (`TLM`), packet length (`PLM`/`PLT`), component
  registration (`CRG`), and comment (`COM`) markers
- [ ] Maxshift region-of-interest (`RGN`) reconstruction
- [ ] Arbitrary unsigned and signed integer component precision up to the
  project's documented safe maximum
- [ ] Components with different sampling factors, precisions, and signedness
- [ ] Bi-level and low-bit-depth palette images
- [ ] CMYK and other four-channel images when an applicable ICC profile is
  present
- [ ] Additional valid Part 1 multi-component arrangements with an explicit
  output mapping
- [ ] Decode only a caller-selected quality-layer prefix
- [ ] Decode only a caller-selected component set when color reconstruction
  does not require the omitted components
- [ ] Treat optional XML, UUID, UUID-info, and intellectual-property boxes as
  bounded opaque metadata
- [ ] Expose capture and display resolution through image metadata

## Group 3: useful JPEG 2000 advantages — nice to have

These are valuable after ordinary static JP2 uploads work reliably.

- [ ] Public reduced-resolution decode that selects an existing wavelet
  resolution level before reconstruction
- [ ] Automatically choose the nearest useful wavelet resolution level for a
  large resize instead of reconstructing discarded full-resolution samples
- [ ] Precinct- and code-block-aware region decode for crops
- [ ] Tile selection and tile-by-tile decode APIs for very large scientific,
  medical, scanned-document, or geospatial images
- [ ] Progressive preview decode by quality layer
- [ ] Optional 16-bit pipeline output when the shared pixel model supports it
- [ ] Raw Part 1 codestream (`.j2k`, `.j2c`, or `image/j2c`) decode through a
  separately detected public alias
- [ ] Known EXIF, XMP, or application metadata carried in UUID/XML boxes, with
  strict size limits and provenance
- [ ] Color-managed Lab and uncommon ICC-based component models
- [ ] Decode diagnostics describing which tile, packet, marker, or box caused a
  failure without exposing uploaded data

## Group 4: explicitly skip

These unchecked items are outside this decode-only `image/jp2` plan. Their
absence does not block JP2 v1.

- [ ] JPEG 2000 encoding or JP2 rewriting
- [ ] JPX (`image/jpx`) multiple codestreams, compositing layers, animation, and
  Part 2 extensions
- [ ] JPM (`image/jpm`) compound documents
- [ ] Motion JPEG 2000 (`video/mj2`)
- [ ] JPIP remote and incremental delivery protocols
- [ ] HTJ2K (`image/jph`) high-throughput block coding
- [ ] JPEG 2000 Part 2 arbitrary wavelets, arbitrary multi-component transforms,
  and other extended codestream syntax
- [ ] JPSEC encrypted, authenticated, or protected codestreams
- [ ] External data references
- [ ] Floating-point or vendor-private sample models outside the Part 1 integer
  reconstruction contract

## Memory and execution contract

- [ ] Bound input bytes, box count, nesting depth, metadata bytes, dimensions,
  pixels, components, tiles, tile-parts, resolution levels, precincts,
  code-blocks, layers, packets, coding passes, and decoded working bytes
  separately
- [ ] Use checked arithmetic for reference grids, component coordinates,
  subband extents, precinct indexes, packet counts, coefficient counts, strides,
  and allocation sizes
- [ ] Keep compressed codestream data in the original input and read bounded
  packet/code-block ranges instead of duplicating `jp2c`
- [ ] Retain compact code-block coefficients only for the requested tile,
  resolution, and region whenever packet ordering permits
- [ ] Reconstruct tiles or bounded tile regions independently and release their
  coefficients and wavelet buffers as soon as output no longer needs them
- [ ] Make reduced-resolution resize decode use lower wavelet levels directly
- [ ] Avoid a full source-sized RGB or RGBA bitmap at the decoder/pipeline
  boundary
- [ ] Account for simultaneous compressed input, packet indexes, tag trees,
  coefficients, inverse-wavelet buffers, component planes, color conversion,
  resize state, and encoded output in the working-memory budget
- [ ] Keep any unavoidable full-tile or full-component fallback explicit and
  benchmark it separately from the primary bounded-memory path
- [ ] Ensure crop requests do not entropy-decode or inverse-transform unrelated
  precincts when the codestream organization makes them independently
  addressable

## Correctness and hostile-input contract

- [ ] Treat all box lengths, marker lengths, offsets, counts, coding parameters,
  tag trees, packet headers, arithmetic bytes, coefficient states, and tile
  coordinates as hostile input
- [x] Reject dimensions or component geometry that disagree between JP2 boxes
  and the codestream
- [ ] Reject duplicate mandatory markers, illegal marker ordering, missing end
  markers, impossible tile-part lengths, and unsupported coding styles
  explicitly
- [ ] Never scan unbounded input looking for a marker after a declared packet or
  tile-part extent has failed validation
- [ ] Bound MQ decoding and raw bypass reads to their declared code-block
  segments
- [ ] Prevent decompression bombs caused by huge reference grids, tiny tiles,
  excessive components, deep decompositions, many precincts, or many layers
- [ ] Fail closed on unsupported Part 2, HTJ2K, JPSEC, and vendor-private syntax
- [ ] Add fuzz targets for both the JP2 box parser and raw Part 1 codestream
  parser before declaring the codec production-ready

## Fixtures and benchmarks

- [ ] Audit `runk/jpeg2000` at a pinned commit and record which markers,
  progression orders, transforms, color paths, malformed-input checks, and
  memory strategies it actually supports
- [ ] Treat `runk/jpeg2000` primarily as a codestream reference unless that
  audit demonstrates complete JP2 box behavior; its documented entry point
  accepts a JPEG 2000 codestream directly
- [ ] Run the same pinned fixtures through `runk/jpeg2000`, OpenJPEG, and
  PureJsImage and investigate every metadata, pixel, or failure-classification
  disagreement
- [ ] Do not copy or mechanically translate its PDF.js-derived implementation,
  internal data structures, or tests into production code
- [ ] Pin a sanitized, redistributable fixture representative of an actual
  `image/jp2` Twilio upload, without customer data
- [x] Pin fixtures from at least two independent JPEG 2000 encoders
- [x] Include lossless 5/3 and lossy 9/7 images
- [ ] Include grayscale, RGB, sYCC, palette, 16-bit, alpha, tiled, odd-dimension,
  subsampled-component, multi-layer, and every progression-order case required
  by the implemented groups
- [ ] Include small correctness fixtures plus realistic phone-photo, scanned
  document, and large tiled images
- [ ] Record source, license, encoder, JP2 brand, dimensions, components, bit
  depths, color space, transform, quantization, tiles, decomposition levels,
  precincts, code-block size, layers, progression order, and checksums
- [ ] Validate container metadata against an independent development-only JP2
  parser
- [ ] Validate pixels against OpenJPEG and at least one additional independent
  decoder
- [ ] Require exact pixels for reversible 5/3 lossless fixtures
- [ ] Use documented tolerances for irreversible 9/7 and color-managed output
- [ ] Use official JPEG 2000 conformance cases where their licensing permits
  redistribution or reproducible local preparation
- [x] Verify benchmark output before recording time or memory; unsupported or
  incorrect output is a failed benchmark
- [ ] Benchmark metadata, full decode, JP2-to-JPEG, JP2-to-PNG, crop, resize,
  reduced-resolution resize, and resize-plus-encode workflows
- [ ] Measure cold and warm absolute peak RSS, RSS delta, external memory, and
  ArrayBuffer memory in isolated processes
- [ ] Compare the primary upload workflows with a development-only OpenJPEG
  oracle; record Jimp as unsupported rather than presenting failed decode as a
  performance result
- [ ] Add malformed box, marker, tile, packet, tag-tree, code-block, MQ,
  quantization, wavelet, color, and allocation-limit regression fixtures

## Decode v1 is complete when

- [ ] Group 0 and Group 1 are implemented and covered by pinned fixtures
- [ ] Every unimplemented Group 2-4 input is rejected explicitly rather than
  decoded incorrectly
- [ ] Lossless reference fixtures reproduce exact pixels
- [ ] Lossy reference fixtures remain within documented pixel tolerances
- [ ] Twilio-style `image/jp2` Buffer input can be inspected, resized, and
  converted to JPEG or PNG through the public pipeline
- [ ] A large downscale uses a lower wavelet resolution and does not allocate a
  source-sized RGB or RGBA bitmap
- [ ] Independent oracles confirm dimensions, precision, color, alpha, and
  decoded pixels
- [ ] `npm run check` and the isolated JP2 fixture and benchmark verification
  pass

## Standards and implementation references

- [ISO/IEC 15444-1:2024 — JPEG 2000 core coding system](https://www.iso.org/standard/87632.html)
- [ITU-T T.800 — JPEG 2000 core coding system](https://www.itu.int/rec/T-REC-T.800)
- [ITU-T T.803 — JPEG 2000 conformance testing](https://www.itu.int/rec/T-REC-T.803)
- [RFC 3745 — `image/jp2` MIME registration](https://www.rfc-editor.org/rfc/rfc3745.html)
- [IANA media type registry](https://www.iana.org/assignments/media-types/media-types.xhtml)
- [OpenJPEG documentation](https://www.openjpeg.org/doxygen/)
- [`runk/jpeg2000` pure-JavaScript reference implementation](https://github.com/runk/jpeg2000)
