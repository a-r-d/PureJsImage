<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# BMP codec support

This document is the capability contract for PureJsImage's first-party BMP
codec. A checked item is implemented in the current code. An unchecked item is
planned and must not be presented as supported until its output is independently
validated. The correctness section records the current fixture and benchmark
coverage.

## Decode

### File and DIB headers

- [x] Windows bitmap files with the `BM` signature
- [x] OS/2 1.x / Windows 2 `BITMAPCOREHEADER` (12 bytes)
- [x] Windows `BITMAPINFOHEADER` (40 bytes)
- [x] 52-byte and 56-byte bitfield headers
- [x] OS/2 2.x 64-byte DIB headers
- [x] Windows `BITMAPV4HEADER` (108 bytes)
- [x] Windows `BITMAPV5HEADER` (124 bytes)
- [x] Header-only width, height, bit depth, and explicit-alpha inspection
- [x] Bottom-up and top-down row order
- [x] Four-byte row alignment and odd-width row padding
- [ ] Bitmap-array, color-icon, color-pointer, and other non-`BM` OS/2 file
  signatures
- [ ] Standalone DIB pixel data without a 14-byte bitmap file header
- [ ] Embedded or linked V5 color-profile validation and exposure

### Pixel formats

- [x] 1-bit indexed pixels
- [x] 4-bit indexed pixels
- [x] 8-bit indexed pixels
- [x] OS/2 three-byte BGR palette entries
- [x] Windows four-byte BGR palette entries
- [x] Palette sizes smaller than the bit-depth maximum through `biClrUsed`
- [x] Uncompressed 16-bit RGB555
- [x] Uncompressed 24-bit BGR
- [x] Uncompressed 32-bit BGRX treated as opaque
- [x] 16-bit and 32-bit `BI_BITFIELDS`
- [x] 16-bit and 32-bit `BI_ALPHABITFIELDS`
- [x] RGB555, RGB565, reordered channels, and other non-overlapping contiguous
  channel masks with full-range 8-bit scaling
- [x] Embedded RGB masks from V2/V3/V4/V5 headers and explicit alpha masks from
  V3/V4/V5 headers or appended mask blocks
- [ ] 2-bit indexed OS/2 pixels
- [ ] Non-contiguous channel masks if compatible real-world files require them
- [ ] Producer-specific alpha in 32-bit `BI_RGB` files without an explicit
  alpha mask
- [ ] High-dynamic-range or scRGB BMP variants

### Compression

- [x] Uncompressed `BI_RGB`
- [x] `BI_RLE4` encoded runs
- [x] `BI_RLE4` absolute runs and word padding
- [x] `BI_RLE8` encoded runs
- [x] `BI_RLE8` absolute runs and word padding
- [x] RLE end-of-line, end-of-bitmap, and delta commands
- [x] `BI_BITFIELDS`
- [x] `BI_ALPHABITFIELDS`
- [ ] Embedded `BI_JPEG`
- [ ] Embedded `BI_PNG`
- [ ] `BI_CMYK`, `BI_CMYKRLE4`, and `BI_CMYKRLE8`

### Color and metadata

- [x] Structural indexed or RGB pixel conversion to `rgb8`
- [x] Explicit masked-alpha conversion to `rgba8`
- [ ] Calibrated RGB endpoints and gamma from V4/V5 headers
- [ ] Embedded ICC profile conversion to sRGB
- [ ] Rendering intent, resolution, palette importance, and application metadata
  exposure
- [ ] Metadata preservation or explicit stripping controls when re-encoding

### Memory and execution

- [x] Direct region reads for uncompressed and bitfield images
- [x] Bounded 32-row decode blocks without a source-sized RGB or RGBA bitmap for
  uncompressed and bitfield images
- [x] Horizontal crop conversion without materializing pixels outside the
  requested output region
- [x] Direct seeking to requested top-down or bottom-up source rows
- [x] Public crop, resize, BMP-to-BMP, and BMP-to-other-codec pipelines
- [x] Explicit RLE fallback that retains one byte of palette index data per
  source pixel to reorder the bottom-up command stream
- [ ] Bounded RLE row reconstruction or a disk-backed fallback that avoids a
  source-sized index plane
- [ ] Decoder-driven scaled output for large downscales

## Encode

### Implemented target

- [x] First-party Windows BMP encoding
- [x] Top-down output for streaming row order
- [x] Uncompressed 24-bit `BI_RGB` with a 40-byte `BITMAPINFOHEADER`
- [x] Uncompressed 32-bit `BI_BITFIELDS` with a 108-byte `BITMAPV4HEADER`
- [x] Explicit RGBA masks and sRGB color-space declaration for alpha output
- [x] Correct four-byte row padding
- [x] `gray8`, `rgb8`, and `rgba8` pipeline input
- [x] Automatic alpha output for `rgba8` input unless `alpha: false` is
  requested
- [x] Opaque alpha insertion when 32-bit output is requested from gray or RGB
  input
- [x] Streaming, top-to-bottom output with a single encoded-row buffer
- [x] Public `image.bmp()` and `image.encode('bmp')` APIs

### Planned for common output

- [ ] Indexed 1-, 4-, and 8-bit output with deterministic palette generation
- [ ] RLE4 and RLE8 output
- [ ] 16-bit RGB555 and RGB565 output
- [ ] Configurable 24-bit versus 32-bit output independent of source pixel type
- [ ] Configurable bottom-up output for consumers that reject negative heights
- [ ] Explicit alpha-discard versus background-compositing behavior when writing
  opaque BMP from RGBA input
- [ ] Configurable resolution instead of the current fixed 2835 pixels per metre
- [ ] V5 ICC profile, rendering intent, and color metadata writing or
  preservation
- [ ] OS/2 BMP and standalone DIB output if required by real consumers
- [ ] Validate output-size arithmetic and reject files that exceed BMP's 32-bit
  offsets or file-size fields

## Correctness and safety contract

- [x] Validate the declared file size does not exceed the input or precede the
  pixels, plus pixel offset, DIB size, dimensions, plane count,
  bit-depth/compression combinations, row extents, and palette bounds
- [x] Validate channel masks are non-empty, contiguous, and non-overlapping
- [x] Validate RLE commands, runs, deltas, row boundaries, padding, and the final
  end marker
- [x] Apply configurable input-size, dimension, pixel-count, and decoded-byte
  limits before decoding
- [x] Reject truncated pixels, invalid planes, invalid masks, and RLE overruns
  explicitly
- [x] Verify 14 public-domain BMP Suite fixtures with pinned reference pixels
- [x] Cover OS/2, Windows V3/V5, 1/4/8-bit palettes, RLE4/RLE8, top-down rows,
  odd-width padding, RGB555/RGB565, reordered 32-bit masks, and explicit alpha
- [x] Round-trip encoded 24-bit and 32-bit output through the first-party
  decoder and verify exact pixels
- [x] Require the benchmark's independent BMP decoder to recognize encoded
  output and its dimensions
- [x] Benchmark metadata, decode, crop, resize, conversion, and encode workflows
  in isolated processes, including a deterministic 4000x3000 image
- [ ] Add focused fixtures for every accepted DIB header size and every RLE
  command boundary rather than relying on shared parser paths
- [ ] Verify encoded opaque and alpha pixels with an independent BMP decoder
- [ ] Add malformed-header, palette, mask, offset, stride, RLE, and allocation
  fuzzing with strict limits
