# ICO decode support plan

This document is the implementation plan and eventual capability contract for
PureJsImage's first-party Windows icon decoder. The target is static `.ico`
files used for favicons, Windows icons, and uploaded web assets. ICO encoding is
intentionally out of scope.

A checked implementation item is already present and tested. An unchecked item
is unsupported until implemented and independently validated.

## Scope decisions

- [x] Decode `.ico` files only; do not implement ICO encoding
- [x] Support multi-image icon files and deterministic image selection
- [x] Support both PNG-backed and DIB-backed icon entries
- [x] Reuse the first-party PNG and BMP pixel machinery through internal
  adapters rather than introducing a runtime dependency or duplicate decoder
- [x] Treat `.ico` and MIME metadata as hints; select the codec from file
  contents
- [x] Keep cursor, animated-icon, executable-resource, and shell-resource
  formats outside v1

## Group 1: common ICO decode — required for v1

### Directory and image selection

- [ ] Parse the six-byte `ICONDIR` header and require reserved value 0, icon
  type 1, and a non-zero bounded image count
- [ ] Parse every 16-byte `ICONDIRENTRY` with checked width, height, palette,
  planes, bit depth, byte length, and offset fields
- [ ] Interpret directory width or height byte 0 as 256 pixels
- [ ] Validate every entry extent before inspecting or decoding its payload
- [ ] Report every embedded image's dimensions, bit depth, storage type, alpha
  capability, and directory index
- [ ] Default to the largest image, then highest useful bit depth and alpha,
  with original directory order as the final tie-breaker
- [ ] For a requested resize, select the smallest suitable source that is not
  smaller than the target; fall back to the largest entry
- [ ] Allow explicit directory-index selection
- [ ] Reject zero-length, overlapping-invalid, out-of-file, or contradictory
  entries explicitly

### PNG-backed entries

- [ ] Detect an embedded PNG by its signature within the validated ICO entry
- [ ] Require the complete PNG datastream to remain inside that entry
- [ ] Decode indexed, grayscale, RGB, grayscale-alpha, and RGBA PNG entries
  through the existing first-party PNG codec
- [ ] Support common 256x256 PNG icon entries
- [ ] Preserve exact PNG alpha
- [ ] Reject APNG animation inside an ICO entry rather than silently selecting
  an arbitrary frame
- [ ] Avoid copying the embedded PNG when a bounded view can be passed to the
  decoder

### DIB-backed entries

- [ ] Parse common `BITMAPCOREHEADER`, `BITMAPINFOHEADER`, V4, and V5 DIB
  headers without requiring the normal 14-byte BMP file header
- [ ] Validate that the stored DIB height describes the combined XOR image and
  AND mask and derive the actual icon height safely
- [ ] Decode bottom-up XOR pixels and four-byte row padding
- [ ] Decode 1-, 4-, and 8-bit palette entries
- [ ] Decode 16-bit RGB555/RGB565 and valid bitfield layouts
- [ ] Decode 24-bit BGR and 32-bit BGRA entries
- [ ] Decode the one-bit AND mask with its independent four-byte row padding
- [ ] Apply the AND mask to palette, 16-bit, and 24-bit entries
- [ ] Prefer meaningful 32-bit alpha while honoring the AND mask where required
- [ ] Handle legacy 32-bit icons whose alpha bytes are all zero using a pinned,
  Windows-compatible opaque/AND-mask fallback
- [ ] Preserve partial alpha rather than reducing it to one-bit transparency
- [ ] Emit bounded `rgba8` pixel blocks into the normal crop, resize, and
  encoder pipeline

### Public behavior

- [ ] Register `.ico` and the supported ICO MIME types
- [ ] Return selected-image dimensions and total embedded image count from
  metadata
- [ ] Support ICO-to-PNG, ICO-to-JPEG with explicit alpha flattening,
  ICO-to-WebP, crop, resize, and contain workflows
- [ ] Keep selection deterministic across metadata inspection and pixel decode

## Group 2: compatibility — should have

- [ ] RLE4 and RLE8 DIB-backed entries through the existing BMP RLE logic
- [ ] Unusual but valid DIB header sizes encountered in real Windows resources
- [ ] Top-down DIB entries when independently verified consumers accept them
- [ ] Entries whose directory bit depth disagrees with the embedded PNG or DIB,
  using payload metadata while reporting the discrepancy
- [ ] Duplicate sizes with different color depths or alpha representations
- [ ] Color-profile handling for PNG and V5 DIB entries
- [ ] Resolution metadata exposure where present
- [ ] Selection by exact size, minimum size, maximum size, or preferred storage
  type

## Nice to have later

- [ ] Windows cursor (`.cur`, directory type 2) decode with hotspot metadata
- [ ] Direct extraction of ICO resources from PE executables, DLLs, or resource
  files as a separately scoped container feature
- [ ] Browser- and Windows-specific selection presets if their behavior differs
  materially from the default policy
- [ ] Region decode within the selected DIB entry

## Explicitly skip

- [ ] ICO encoding
- [ ] Animated cursor (`.ani`) decode
- [ ] Executing or interpreting shell extensions and executable resources
- [ ] Embedded JPEG or undocumented vendor payloads
- [ ] Returning all icon images as one composited canvas
- [ ] Guessing dimensions or pixels from malformed directory entries

## Memory and safety contract

- [ ] Bound input bytes, image count, dimensions, selected pixels, palette
  entries, PNG expansion, DIB stride, XOR bytes, AND-mask bytes, and decoded
  output before allocation
- [ ] Use checked arithmetic for directory size, entry extents, row strides,
  doubled DIB heights, palette sizes, masks, and pixel counts
- [ ] Inspect directory metadata before decoding any payload
- [ ] Decode only the selected image unless the caller explicitly requests
  another entry
- [ ] Never materialize every embedded image merely to choose one
- [ ] Keep PNG and DIB payloads as bounded views into the original input
- [ ] Preserve bounded-row behavior for the selected image without a duplicate
  source-sized RGBA bitmap
- [ ] Reject recursive container tricks, truncated PNG chunks, malformed DIB
  headers, overlapping masks, and decompression bombs explicitly

## Fixtures and verification

- [ ] Pin redistributable multi-size favicon and Windows icon fixtures
- [ ] Cover 16x16, 32x32, 48x48, and 256x256 entries
- [ ] Cover PNG-backed icons plus 1/4/8/16/24/32-bit DIB entries
- [ ] Cover opaque, one-bit mask, partial-alpha, all-zero-alpha fallback, odd
  widths, duplicate sizes, and mixed PNG/DIB files
- [ ] Validate metadata and selected pixels against Windows and at least one
  independent ICO decoder
- [ ] Test target-aware and explicit-index selection deterministically
- [ ] Verify benchmark output before recording speed or memory
- [ ] Benchmark metadata, PNG-backed decode, DIB-backed decode, selection,
  ICO-to-PNG, and favicon resize workflows in isolated processes
- [ ] Add malformed directory, offset, length, palette, DIB height, stride,
  bitfield, PNG extent, XOR, AND-mask, and allocation-limit fixtures

## Decode v1 is complete when

- [ ] Every Group 1 item is implemented and covered by pinned fixtures
- [ ] Unsupported compatibility and deferred inputs fail explicitly
- [ ] Independent decoders confirm image count, selection, dimensions, and RGBA
  pixels
- [ ] Common mixed-size favicons decode and resize without decoding every entry
- [ ] `npm run check` and the isolated ICO fixture verification pass

## References

- [Microsoft: BITMAPINFOHEADER](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapinfoheader)
- [Microsoft: common Windows icon sizes and color depths](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/wmp/custom-image-support-for-devices)
- [W3C PNG specification](https://www.w3.org/TR/png-3/)
