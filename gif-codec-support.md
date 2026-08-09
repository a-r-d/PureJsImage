<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# GIF codec support

This document is the capability contract for PureJsImage's first-party GIF
codec. A checked item is implemented in the current code. An unchecked item is
planned and must not be presented as supported until its output is independently
validated. Static GIFs decode directly. Animated GIF metadata still counts
every frame, but pixel output requires an explicit frame 0 selection.

## Decode

### Container and image layout

- [x] GIF87a and GIF89a detection
- [x] Logical-screen width and height
- [x] Global color tables
- [x] Per-frame local color tables
- [x] Frame rectangles and offsets within the logical screen
- [x] Non-interlaced image data
- [x] Four-pass interlaced image data
- [x] GIF data sub-block chains
- [x] Metadata frame counting across the complete file
- [x] Metadata transparency detection from graphics control extensions
- [x] Safe skipping of comment, application, plain-text, and other extension
  sub-blocks during metadata and first-frame parsing
- [ ] Decode and composite every animation frame
- [ ] Frame delays from graphics control extensions
- [ ] Disposal methods 0-3
- [ ] Animation loop counts from Netscape/ANIMEXTS application extensions
- [ ] Logical-screen background-color semantics where they affect animation
  composition
- [ ] Pixel aspect ratio exposure
- [ ] Plain-text extension rendering

### LZW and indexed pixels

- [x] GIF LZW minimum code sizes 2-8
- [x] Clear and end codes
- [x] Variable-width codes up to the 12-bit, 4096-entry dictionary limit
- [x] Dictionary reset and the code-equals-next-available special case
- [x] Exact indexed-pixel count validation
- [x] Palette-index bounds validation
- [x] Transparent palette indices from graphics control extensions
- [x] Indexed-color expansion to `rgba8`
- [x] Transparent logical-screen pixels outside the first frame rectangle
- [ ] Preserve indexed pixels and palettes for workflows that do not require
  RGBA expansion

### First-frame behavior

- [x] Decode the first image descriptor for static GIFs and explicit frame 0
  selections
- [x] Composite that frame at its declared offset on a transparent logical
  screen
- [x] Preserve transparent pixels in PNG and other alpha-capable output
- [x] Deterministically flatten transparency when converting to JPEG with a
  requested background
- [x] Public crop, resize, GIF-to-PNG, and GIF-to-JPEG pipelines for static GIFs
  and explicit frame 0 selections
- [x] Reject implicit animated GIF pixel decode with `UNSUPPORTED_OPERATION`
- [x] Explicit API selection of frame 0
- [ ] Explicit API selection of later frames by index
- [ ] Explicit API selection by animation timestamp
- [ ] Poster-frame or representative-frame selection policies

### Memory and execution

- [x] Bounded 32-row RGBA output blocks after index decoding
- [x] Compact one-byte index storage for the first frame rather than a
  source-sized RGBA bitmap
- [x] Fixed-size 4096-entry LZW dictionary and decode stack
- [ ] Incremental parsing and LZW decoding from `ImageSource`; the current pixel
  decoder retains the complete compressed GIF input
- [ ] Row-bounded non-interlaced LZW output without retaining the complete frame
  index plane
- [ ] Bounded interlace reordering or a disk-backed fallback
- [ ] Crop- and resize-aware decode that avoids expanding unused palette pixels
- [ ] Animation composition with a bounded canvas strategy and explicit memory
  behavior for disposal method 3

### Metadata

- [x] Width, height, frame count, transparency presence, indexed color-space,
  and declared color-table depth reporting
- [ ] Frame rectangles, delays, disposal methods, transparency indices, and
  interlace flags in public metadata
- [ ] Loop count, comments, application identifiers, and plain-text metadata
- [ ] Metadata preservation or explicit stripping controls when converting

## Encode

### Current status

- [ ] Static GIF encoding
- [ ] Animated GIF encoding
- [ ] Public `image.gif()` and `image.encode('gif')` APIs

GIF output is not currently implemented. Requests must continue to fail as an
unsupported output format until independently decodable files and focused tests
exist.

### Planned static output

- [ ] Deterministic RGB/RGBA-to-indexed color quantization
- [ ] Global color-table generation with 2-256 entries
- [ ] Optional local color tables
- [ ] Binary transparency with a selected transparent palette index
- [ ] Configurable dithering
- [ ] GIF LZW encoding with dictionary clears and sub-block emission
- [ ] Optional interlaced output
- [ ] Frame cropping to the smallest changed or non-transparent rectangle
- [ ] Comment and application-extension writing when requested

### Planned animated output

- [ ] Multiple frames with per-frame rectangles
- [ ] Frame delays with defined rounding from milliseconds to centiseconds
- [ ] Disposal methods 0-3
- [ ] Per-frame transparency and local palettes
- [ ] Netscape loop-count extension
- [ ] Global-palette optimization across frames
- [ ] Frame differencing and unchanged-region optimization
- [ ] Deterministic animation output for reproducible builds
- [ ] Streaming frame input without retaining every source frame in RGBA form

## Correctness and safety contract

- [x] Validate signatures, screen dimensions, frame rectangles, color-table
  extents, extension sizes, sub-block extents, and LZW code sizes
- [x] Apply configurable input-size, dimension, pixel-count, frame-count, and
  decoded-byte limits
- [x] Bound block scans, sub-block scans, LZW code reads, dictionary chains, and
  decoded pixel counts
- [x] Reject missing palettes, invalid code sizes, unavailable dictionary codes,
  out-of-range palette indices, and truncated image data explicitly
- [x] Compare local-palette, offset, transparency, and interlaced first-frame
  pixels exactly against an independent development oracle
- [x] Benchmark first-frame PNG/JPEG conversion for a pinned 70-frame GIF and a
  production-style transparent GIF workflow
- [ ] Pin a broader GIF compatibility corpus from browsers, image editors,
  cameras, screen-recording tools, and real upload sources
- [ ] Add focused global-palette, minimum/maximum dictionary, repeated-clear,
  unusual sub-block, empty-frame, and logical-screen background fixtures
- [ ] Add animation fixtures covering every disposal mode, partial rectangles,
  local palettes, zero/short delays, transparency, and finite/infinite loops
- [ ] Add malformed extension, sub-block, palette, LZW, frame-count, and
  decompression-bomb fuzzing with strict allocation limits
