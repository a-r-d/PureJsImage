<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# Netpbm and PFM codec support

This document defines the implemented boundary of the first-party Netpbm codec family.

## Integer Netpbm decode

- [x] PBM P1 ASCII and P4 packed binary
- [x] PGM P2 ASCII and P5 binary
- [x] PPM P3 ASCII and P6 binary
- [x] PAM P7 `BLACKANDWHITE`, `BLACKANDWHITE_ALPHA`, `GRAYSCALE`, `GRAYSCALE_ALPHA`, `RGB`, and `RGB_ALPHA` tuples
- [x] Comments and Netpbm whitespace between header tokens
- [x] MAXVAL from 1 through 65535
- [x] Native big-endian `gray16`, `rgb16`, and `rgba16` blocks for 16-bit samples
- [x] Bounded row output
- [ ] Multiple concatenated images
- [ ] Nonstandard PAM tuple types

## Integer Netpbm encode

- [x] P1 and P4 PBM
- [x] P2 and P5 PGM
- [x] P3 and P6 PPM
- [x] P7 PAM grayscale, grayscale-alpha, RGB, and RGBA
- [x] Deterministic 8-bit and 16-bit output

## PFM convention

PureJsImage implements the Netpbm-documented PFM convention. `Pf` stores one grayscale float32 sample and `PF` stores three RGB float32 samples. A negative scale selects little-endian storage and a positive scale selects big-endian storage. The scale magnitude multiplies samples on decode and samples are divided by it on encode. Raster rows are stored bottom to top.

- [x] `Pf` grayscale and `PF` RGB
- [x] Little-endian and big-endian float32 samples
- [x] Non-unit finite scale magnitudes
- [x] Negative, greater-than-one, NaN, and infinite samples
- [x] Native `grayf32` and `rgbf32` output
- [x] Deterministic little- or big-endian encoding

## Validation

- [x] Capped token and header parsing
- [x] Dimension, MAXVAL, tuple, sample-range, raster-size, and truncation checks
- [x] CC0 Imazen PNM conformance fixtures
- [x] FFmpeg PFM interoperability fixture derived from a CC0 Poly Haven HDR
