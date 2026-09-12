# M8 animation fixtures

The JXL files are unchanged CC0 inputs from the official JPEG XL conformance
corpus, revision `4bf053529c7cefd2951be453475bb3dccc7e7be8`:

- `newtons-cradle.jxl` is `animation_newtons_cradle/input.jxl`.
- `icos4d.jxl` is `animation_icos4d/input.jxl`.
- `spline.jxl` is `animation_spline/input.jxl`.

The adjacent JSON files record every displayed frame, exact duration ticks,
cumulative start ticks, native frame hashes, first-party hashes, and numeric
differences. They were checked against fresh APNG output from pinned libjxl
0.12.0. The executable float-domain verification in
`benchmark/jpegxl/verify-m8-sequence.ts` checks every displayed color and alpha
sample independently as well.

The corpus manifest pins the source file hashes. Decoder binary SHA-256:
`8da836ae132de221c53532a8296cc5b9e5f4bef16df4fcf4681f8b61ee4f3788`.
Native source revision: `a7a9c787341cf703dede03c2009fa460cae5e5df`.
