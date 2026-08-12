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
