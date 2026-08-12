<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# Radiance HDR codec support

This document defines the implemented boundary of the first-party Radiance HDR codec.

## Decode

- [x] `#?RADIANCE` and `#?RGBE` signatures
- [x] `FORMAT=32-bit_rle_rgbe`
- [x] Standard per-channel scanline RLE, including 128-byte literal packets
- [x] Legacy flat RGBE scanlines and legacy repeat packets
- [x] `+X`, `-X`, `+Y`, and `-Y` resolution orientations
- [x] Native `rgbf32` output without 8-bit clipping
- [x] Region decode with bounded scanline buffers
- [ ] XYZE pixel data
- [ ] Multiple pictures in one stream

## Metadata

- [x] Width, height, bit depth, floating-point sample format, and orientation text
- [x] Multiplicative `EXPOSURE` fields
- [x] `GAMMA`
- [ ] Automatic application of exposure, gamma, primaries, or color-correction fields

## Encode

- [x] Deterministic RGBE conversion from `rgbf32` and normalized display pixels
- [x] Standard scanline RLE for legal scanline widths
- [x] Legacy flat output for widths outside the standard RLE range
- [x] Optional `EXPOSURE` and `GAMMA` fields

## Validation

- [x] Header, dimension, allocation, scanline length, packet length, and truncation checks
- [x] Real 1K Poly Haven CC0 HDR benchmark inputs
- [x] Deterministic exponent-extreme and orientation tests
