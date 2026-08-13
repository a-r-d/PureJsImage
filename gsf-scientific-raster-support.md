<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# Gwyddion Simple Field scientific raster support

This document is the capability contract for PureJsImage's first-party GSF scientific raster reader and writer. GSF is exposed through `purejsimage/scientific`, not registered as an ordinary `ImageCodec`.

## Read

- [x] Exact `Gwyddion Simple Field 1.0\n` magic line
- [x] Strict UTF-8 `key = value` header parsing with one to four NUL alignment bytes
- [x] Required positive `XRes` and `YRes` dimensions with checked allocation arithmetic
- [x] Exact little-endian IEEE float32 payload with top-to-bottom rows and no trailing bytes
- [x] Single scalar labeled-axis `ScientificDataset` with native float32 samples
- [x] `XReal`, `YReal`, `XOffset`, `YOffset`, `XYUnits`, `ZUnits`, and `Title` mapping
- [x] Unknown header-field preservation as generic metadata
- [x] Bounded rectangular row-range reads through portable `ImageSource` inputs
- [x] Node and browser operation without Canvas or runtime dependencies in the reader

## Write

- [x] Deterministic GSF 1.0 header, alignment, and little-endian float32 payload output
- [x] Physical metadata, title, and application metadata writing
- [x] Exact finite, NaN, and infinity float32 roundtrips

## Safety and explicit boundaries

- [x] Reject missing or malformed required fields, invalid UTF-8, invalid padding, impossible extents, truncation, trailing data, and configured limit violations
- [x] Keep display palettes, range mapping, and relief separate from quantitative source samples
- [ ] Multi-channel, compressed, or alternate-sample GSF extensions; these are not part of GSF 1.0
