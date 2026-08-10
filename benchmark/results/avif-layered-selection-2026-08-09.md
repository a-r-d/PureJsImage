# AVIF layered item selection correctness — 2026-08-09

## Supported subset

PureJsImage parses `a1lx`, `a1op`, and `lsel` item properties, separates frame
OBUs into complete frame units, filters them by the selected AV1 operating
point, and selects the requested spatial layer. Pixel decode is supported when
the selected frame is an independently decodable shown key frame within the
existing restricted AV1 syntax boundary.

Dependent inter-frame enhancement layers, frame-dimension overrides, and
rendering every intermediate layer remain unsupported. For `lsel=0xFFFF`, the
decoder uses the format-permitted single-output policy and selects the highest
eligible spatial layer. Missing operating points, missing selected spatial
layers, invalid `a1lx` sizes, layer ranges that do not contain exactly one
complete frame, and tile groups that do not match their frame-header layer fail
explicitly.

## Correctness

`npm run fixtures:avif:layered` validates the checksum-pinned
`xiph-tiger-3layer-lsel0-1216x832.avif` fixture. The item contains three frame
OBUs with spatial IDs 0, 1, and 2; `lsel` selects spatial layer 0; and `a1lx`
records 8,299-byte and 13,754-byte layer sizes before the final layer. The
selected 1216×832 YUV 4:2:0 frame matches `avifdec` 1.3.0 using dav1d 1.5.1 and
libaom 3.12.1 byte for byte:

- native YUV SHA-256: `59d0e7013d56d51d38d76e8cd31a9ff6da949ff5d95ee002073fbeccf75a64f7`
- portable RGBA SHA-256: `d04f5c88fa8e105b354967755d1261ade0e214f85bb8707b97fcd0568098b68e`
- required and observed native-YUV tolerance: zero

The portable RGBA hash is exercised in Node.js and Chromium. Focused malformed
coverage changes `lsel` to an absent spatial layer, overflows the documented
`a1lx` sizes, and moves a layer boundary across a frame OBU; all three cases
fail before pixel reconstruction.

## Provenance and memory

The fixture is a restricted-layer derivative of Xiph's
`tiger_3layer_1res.avif` from the AOMedia AVIF conformance suite. Exact source,
license, and byte modifications are recorded in
`benchmark/corpus/files/avif/README.md`.

Frame selection retains the existing bounded payload and working-state limits.
Only the selected frame enters reconstruction; unselected frame OBUs remain
views into the item payload and are not concatenated or copied. This change does
not claim a new peak-RSS result.
