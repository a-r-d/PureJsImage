# JPEG XL corpus preparation

This directory defines the first JPEG XL conformance inputs for parser and future decoder work.
Normal tests do not download files.

Run:

```sh
npm run fixtures:jpegxl:prepare
```

The preparation script downloads three inputs from the official JPEG XL conformance repository at
commit `4bf053529c7cefd2951be453475bb3dccc7e7be8`. It checks byte length and SHA-256 before writing
to `benchmark/fixtures/jpegxl/`.

`corpus.ts` records source URLs, licenses, checksums, dimensions, and isolated feature categories.
The current inputs cover raw codestream probing, grayscale with ICC, 12-bit RGB with unassociated
alpha, and a 9-bit lossless Modular image with adaptive properties and nonzero residuals. Container,
`jxlc`, and `jxlp` fixtures will be added before container behavior is used as pixel-decoder evidence.

Generate the pinned common static VarDCT development matrix with the locally built libjxl tools:

```sh
npm run fixtures:jpegxl:generate-vardct -- \
  .tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools
```

This writes five compact raw codestreams and matching `djxl` PNM pixel oracles. The matrix varies
effort, distance, grayscale, progressive passes, and synthetic noise. The manifest keeps unknown
bitstream features marked as unknown until the first-party parser proves them. The progressive
entry currently uses a legal internal frame sequence that bounded inspection still rejects, so it
remains explicit unsupported evidence.
