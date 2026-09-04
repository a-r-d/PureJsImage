# JPEG XL M4 fixtures

The 28 small RGB cases are generated from deterministic original gradients by
`node benchmark/jpegxl/generate-m4-color-corpus.ts`. They are MIT licensed under the repository
license. `manifest.json` records the exact libjxl revision, command options, hashes, native color
semantics, and expected PureJsImage encoder hashes. The generator checks both cjxl input and
PureJsImage output through pinned djxl without changing native samples.

`oriented-icc.jxl` is the CC0 `bench_oriented_brg/input.jxl` from
[libjxl/conformance at 4bf053529c7cefd2951be453475bb3dccc7e7be8](https://github.com/libjxl/conformance/tree/4bf053529c7cefd2951be453475bb3dccc7e7be8).
Its SHA-256 is `e223fed907c6238622b2b6ec1c80609050c9d2db4d759cf3ca6f0db304cbb82a`.
`oriented-icc.icc` is extracted from the same case's reference PNG and is used to check ICC
reconstruction byte for byte. This fixture proves inspection and profile reconstruction; it does
not promote JPEG-derived ICC pixel rendering.
