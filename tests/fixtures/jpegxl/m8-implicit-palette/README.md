# M8 implicit delta palette regression

`delta_palette.jxl` is the unchanged CC0 `delta_palette/input.jxl` from the
pinned official JPEG XL conformance corpus. The corpus revision and archive
hash remain in `benchmark/jpegxl/production-program/corpora/conformance.json`.

Input SHA-256: `00e24cc453cdf84897d62b0aafc7a9f7024205bbce1922e99d7ad0003759ae7c`.
It contains 555 by 751 RGB8 pixels, a global implicit-only palette, predictor
13, and multiple groups. There are no stored palette entries.

Both the official `ref.png` RGB8 samples and a fresh pinned libjxl 0.12.0
`djxl` PPM decode have sample SHA-256
`684e1111d59451df0a887228bf710a58b5eea37ff9c4c35ad6ad447e6c696137`.
The decoder binary SHA-256 is
`8da836ae132de221c53532a8296cc5b9e5f4bef16df4fcf4681f8b61ee4f3788`.
Its source revision is `a7a9c787341cf703dede03c2009fa460cae5e5df`.

The format facts checked against the pinned reference are implicit palette
indices, zero-width palette metadata, empty ANS final state, and global
prediction across groups. The production row reconstruction is first-party
TypeScript using the existing palette table and prediction functions.
