<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# ENVI Standard scientific raster support

This document is the capability contract for PureJsImage's first-party paired-file ENVI scientific raster reader. ENVI is exposed through `purejsimage/scientific`, not registered as an ordinary `ImageCodec`.

## Read

- [x] Paired portable header and binary `ImageSource` inputs
- [x] Node `.hdr` path convenience with associated binary resolution or an explicit data path
- [x] BSQ, BIL, and BIP interleave
- [x] Data types 1 uint8, 2 int16, 3 int32, 4 float32, 5 float64, 12 uint16, and 13 uint32
- [x] Little-endian and big-endian sample reconstruction
- [x] Explicit header offsets, omitted-offset default of zero, and exact binary payload sizing
- [x] Multiline brace arrays and descriptions
- [x] Band names, wavelengths, wavelength units, FWHM, nodata, default bands, sensor type, and unknown metadata
- [x] Spectral metadata on generic raster channels with nearest-wavelength selection
- [x] Multi-band native RasterBlock output
- [x] Calculated spatial and band ROI reads without full-cube materialization
- [x] Browser File, Blob, ArrayBuffer, Uint8Array, and explicit ImageSource compatibility

## Explicit unsupported boundaries

- [ ] Complex data types 6 and 9
- [ ] Signed and unsigned 64-bit integer data types 14 and 15; the current raster sample model cannot preserve them losslessly
- [ ] ENVI header and binary writing
- [ ] Compression or nonstandard ENVI container extensions

## Safety

- [x] Reject malformed or missing dimensions, fields, interleave, endian flags, arrays, offsets, truncation, trailing data, overflow, and configured limit violations
- [x] Keep display range, scale, palette, and false-color composition separate from quantitative source samples
