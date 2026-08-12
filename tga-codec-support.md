<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# TGA codec support

This document defines the implemented boundary of the first-party TGA codec.

## Decode

- [x] Uncompressed and RLE color-mapped images, types 1 and 9
- [x] Uncompressed and RLE truecolor images, types 2 and 10
- [x] Uncompressed and RLE grayscale images, types 3 and 11
- [x] 8-bit and 16-bit color-map indices with nonzero color-map origins
- [x] 15-bit RGB555 and 16-bit RGB5551
- [x] 24-bit BGR and 32-bit BGRA
- [x] 8-bit grayscale
- [x] Top-left, top-right, bottom-left, and bottom-right origins
- [x] Image ID metadata
- [x] Region decode with bounded row output
- [ ] Interleaved two-way or four-way raster storage
- [ ] Extension-area and developer-area metadata

## Encode

- [x] Deterministic 24-bit RGB and 32-bit RGBA
- [x] Uncompressed output
- [x] Optional raw-packet and run-packet RLE
- [x] TGA 2.0 footer signature
- [ ] Indexed output

## Validation

- [x] Dimension, palette extent, palette index, attribute-bit, packet-length, and truncation checks
- [x] FFmpeg RLE interoperability fixture derived from a CC0 source image
- [x] Checksum-pinned optional historical compatibility downloads kept outside the repository
