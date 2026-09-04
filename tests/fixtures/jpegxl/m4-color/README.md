# JPEG XL M4 fixtures

The 56 small RGB and grayscale cases are generated from deterministic original gradients by
`node benchmark/jpegxl/generate-m4-color-corpus.ts`. They are MIT licensed under the repository
license. `manifest.json` records the exact libjxl revision, command options, hashes, native color
semantics, and expected PureJsImage encoder hashes. The generator checks both cjxl input and
PureJsImage output through pinned djxl without changing native samples.

`oriented-icc.jxl` is the CC0 `bench_oriented_brg/input.jxl` from
[libjxl/conformance at 4bf053529c7cefd2951be453475bb3dccc7e7be8](https://github.com/libjxl/conformance/tree/4bf053529c7cefd2951be453475bb3dccc7e7be8).
Its SHA-256 is `e223fed907c6238622b2b6ec1c80609050c9d2db4d759cf3ca6f0db304cbb82a`.
`oriented-icc.icc` is extracted from the same case's reference PNG and is used to check ICC
reconstruction byte for byte. The M4 conformance report independently verifies its native-profile pixel rendering against djxl.

The alpha manifest covers 40 combinations of independent precision and associated or straight
alpha. The VarDCT manifests cover 18 high-depth color cases and eight alpha-upsample cases.
Their `.bin` references contain normalized big-endian float32 oracle samples; Modular `.bin`
files contain exact native integer samples. `multiple-alpha.jxl` carries two distinct alpha
channels, both checked against the five-channel djxl output. All generated cases use the
corresponding `benchmark/jpegxl/generate-m4-*.ts` script and the repository MIT license.
