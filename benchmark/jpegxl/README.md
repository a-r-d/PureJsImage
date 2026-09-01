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

This writes six raw codestreams and matching `djxl` PNM pixel references. The matrix varies effort,
distance, grayscale, progressive passes, synthetic noise, and a 255 by 255 near-boundary selected
single-group image. The selected 8-bit single-group XYB entries decode within the fixed maximum
error and RMSE limits. Unsupported VarDCT syntax remains explicit.

Run the PureJsImage encoder interoperability matrix after building the pinned libjxl, jxl-rs, and
jxl-oxide tools:

```sh
npm run fixtures:jpegxl:encoder-matrix
```

The matrix covers all six advertised pixel formats, odd dimensions, alpha-heavy graphics, and a
multi-group image. PureJsImage, `djxl`, and jxl-rs must return exact native samples. The pinned
jxl-oxide revision is exact for the 8-bit cases. Its known signed 16-bit Modular limitation is kept
in the report instead of removing those cases.

Run the representative compression comparison after building the pinned simple lossless and
Imazen encoders:

```sh
npm run bench:jpegxl:compression
```

This compares per-file size, time, and exactness with libjxl efforts 1 and 7, the standalone simple
lossless encoder, Imazen, PNG, and lossless WebP where native samples are preserved. The current
PureJsImage compression results do not meet the stable threshold, so the encoder remains
Experimental. Managed-memory values stay unavailable for tools that do not expose a compatible
ledger; the report does not substitute process RSS.

Run the correctness-gated encoder and JPEG transcode benchmark with:

```sh
npm run bench:jpegxl
```

The command uses three fresh Node.js processes per workload. It records absolute peak RSS, the
post-GC baseline, external and ArrayBuffer memory, wall time, output size, and output hashes. The
encoder output is decoded to exact native pixels by PureJsImage and, when the pinned local tool is
available, by `djxl` 0.12.0. The transcode output must reconstruct the exact source JPEG bytes.
Set `PUREJSIMAGE_JPEGXL_ORACLE_DIR` to a directory containing `djxl` when the pinned local path is
not present.

After writing the encoder, reverse-transcode, compression, benchmark, Modular-memory, and
VarDCT-memory JSON files to `.tmp/jpegxl-evidence/`, combine them with:

```sh
npm run bench:jpegxl:evidence
```

The combined report rejects inputs generated from a different Git revision. It records the exact
branch SHA, pinned tool revisions, commands, output hashes, unsupported classifications, and the
reason the encoder remains Experimental.
