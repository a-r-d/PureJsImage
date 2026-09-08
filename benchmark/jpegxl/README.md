# JPEG XL validation and corpus preparation

The current support contract is generated from `capabilities/manifest.json`.
See [the guide](../../docs/jpeg-xl.md) and the
[remediation ledger](../../docs/architecture/jpegxl-pr35-remediation.md) for
precision, memory and compression limits. Normal unit tests do not download files.

## Pinned fixture and encoder checks

```sh
npm run fixtures:jpegxl:prepare
npm run fixtures:jpegxl:generate
npm run fixtures:jpegxl:matrix
npm run fixtures:jpegxl:encoder-matrix -- --output .tmp/jpegxl-evidence/encoder.json
npm run jpegxl:m1:reverse -- --output .tmp/jpegxl-evidence/reverse.json
```

Build the development oracles at the revisions in `oracles.ts`. The encoder
matrix covers all six integer formats and efforts 1, 3, 5 and 7. Pinned `djxl` and
jxl-rs independently check native samples. The jxl-oxide signed 16-bit Modular
limitation remains a named result instead of being removed from the matrix.

The new independent HDR and gray-alpha fixtures have their own generator and
provenance in `tests/fixtures/jpegxl/remediation/README.md`. The generator uses
pinned libjxl as a development oracle. No oracle implementation is shipped.

## Compression and memory

Run both promotion effort gates explicitly:

```sh
npm run bench:jpegxl:compression -- --effort 1 --output .tmp/jpegxl-evidence/compression-1.json
npm run bench:jpegxl:compression -- --effort 7 --output .tmp/jpegxl-evidence/compression-7.json
node benchmark/jpegxl/run-encoder-memory.ts --output .tmp/jpegxl-evidence/encoder-memory.json
npm run bench:jpegxl -- --output .tmp/jpegxl-evidence/benchmark.json
node benchmark/jpegxl/run-memory.ts --output .tmp/jpegxl-evidence/memory.json
node benchmark/jpegxl/run-vardct-memory.ts --output .tmp/jpegxl-evidence/vardct-memory.json
```

The compression suite contains 156 procedural cases across 12 classes. Labels
such as screenshot, text and photo-like describe generated patterns. Comparisons
record exactness, size and time against pinned libjxl, simple lossless, Imazen,
PNG and lossless WebP where native samples are representable. These thresholds
do not establish a universal compression advantage.

Encoder memory runs all four efforts on procedural 512×512 and 6000×4000 RGB8
inputs, in separate cold and warm processes. They record actual owned backing
buffers and verify each measured output hash in a separate pinned djxl decode.
Timing and absolute process peak are captured before independent verification.
Warmup is followed by three GC/event-loop turns. Source input and hashing sink
are outside the managed-buffer count, but included in process RSS. Older
reports with formula-based peaks remain historical estimates.

The frozen nine-case holdout includes original large photographs, real UI
captures, transparent assets and a disclosed synthetic high-depth example:

```sh
node benchmark/jpegxl/run-pr35-holdout.ts --output .tmp/jpegxl-evidence/holdout.json
node benchmark/jpegxl/run-pr35-holdout.ts \
  --manifest benchmark/jpegxl/production-program/pr35-small-jpeg-manifest.json \
  --output .tmp/jpegxl-evidence/small-jpeg-holdout.json
```

The second manifest is a disclosed supplement selected by eligibility after the
original small photograph proved ICC-ineligible. No original case was removed.
All selected results, expansions and unsupported cases are retained. Native
large-image and screenshot results are often larger than PNG or libjxl. The
current multi-group encoder uses the same left predictor at every effort.

## Official conformance and extended promotion

```sh
npm run jpegxl:program:baseline
npm run jpegxl:program:conformance -- \
  --corpus-root .tmp/jpegxl-conformance --output .tmp/jpegxl-evidence/conformance.json
node benchmark/jpegxl/production-program/verify-m4-conformance.ts --output .tmp/jpegxl-evidence/m4-conformance.json
node benchmark/jpegxl/production-program/verify-m5-pipelines.ts --output .tmp/jpegxl-evidence/m5-pipelines.json
```

Official conformance checks 39 checksum-pinned inputs against the recorded
classification baseline. The pre-existing `delta_palette` INVALID_INPUT remains
a named known failure. A matching classification baseline is not a claim that
every input decoded correctly.

The extended M1 cohort selects 250 eligible COCO JPEGs of at least 224 KiB from
357 eligible candidates, evenly spaced by source ID. Fetch and verify those
already selected bytes, without selecting new cases:

```sh
node benchmark/jpegxl/prepare-pinned-m1-inputs.ts
node benchmark/jpegxl/run-m1-real-jpeg-corpus.ts \
  .tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools \
  .tmp/jpegxl-m1-coco .tmp/jpegxl-evidence/m1-real.json
npm run jpegxl:m3:corpus -- --output .tmp/jpegxl-evidence/m3-common-static.json
node benchmark/jpegxl/production-program/verify-m5-common-static.ts \
  --corpus-report .tmp/jpegxl-evidence/m3-common-static.json \
  --output .tmp/jpegxl-evidence/m5-common-static.json
```

M3 uses 100 COCO sources with three variants each. Test images are resized or
upscaled, including approximately 12 and 24 MP cases. Source and test dimensions
are recorded separately. The documented 8-bit VarDCT/djxl maximum error is one
sample and RMSE is at most 0.55, an independently justified rounding exception
to the original 0.25 target. Lossless native samples still require exactness.

Scheduled and manual CI runs execute the extended M1, M3 and M5 corpora. Pull
requests run the pinned fixture, encoder, both compression, memory and pipeline
gates. Absolute reference-machine timing thresholds are not CI gates.

## Evidence artifact

```sh
npm run bench:jpegxl:evidence -- --input-dir .tmp/jpegxl-evidence --scope pr
# After the three extended reports are present:
npm run bench:jpegxl:evidence -- --input-dir .tmp/jpegxl-evidence --scope extended
```

The builder rejects malformed, missing required, failed and wrong-revision
reports. Capability status derives from actual gates. Missing extended evidence
is explicitly not run; known conformance failures remain visible. The workflow
uploads every raw report with commands, SHA-256 provenance and the combined
summary. Browser jobs and full repository checks are separate. No artifact
marks M6 or all JPEG XL milestones complete.

## M6 progressive and Range acceptance

The frozen M6 cohort contains thirty known functional regression fixtures and ten
original-resolution photographs. Selection, original URLs, attribution, licenses,
native dimensions, original hashes, normalization versions, encoder options and
encoded hashes live in `production-program/m6-*.json`. Do not resize photographs
or remove cases that miss a byte target. Normal CI verifies the checked-in report
and functional fixtures without downloading photos or loading a native library.

The native development oracle requires Linux x64, Bun 1.4, and libjxl 0.12.0 at
revision `a7a9c787341cf703dede03c2009fa460cae5e5df`. Use the existing pinned tools
under `.tmp/jpegxl-oracles/libjxl-v0.12.0/source/build-pinned/tools`. Build the same
source as a Release shared library with `BUILD_SHARED_LIBS=ON`, tests, tools,
examples and benchmarks disabled, in `.tmp/jpegxl-remediation-oracle`. The
preparation and flush scripts verify the exact encoder and shared-library hashes;
compiler-dependent binaries need a separately recorded provenance update before
substitution. Neither binary ships with PureJsImage.

Reproduce from the repository root, with no other benchmarks running:

```sh
node benchmark/jpegxl/fetch-m6-native-sources.ts
node benchmark/jpegxl/prepare-m6-native-corpus.ts
```

For each ID in `production-program/m6-native-sources.json`, run:

```sh
bun benchmark/jpegxl/flush-progressive-oracle.ts \
  .tmp/jpegxl-m6-native/encoded/ID.jxl .tmp/jpegxl-m6-native/oracle/ID
```

Then run these sequentially. Commit implementation changes before measuring so
the reports identify the actual source revision.

```sh
node benchmark/jpegxl/verify-m6-native.ts
node benchmark/jpegxl/run-m6-native-measurements.ts
npm run jpegxl:program:conformance -- --corpus-root .tmp/jpegxl-conformance --output .tmp/jpegxl-m6-m10/m6-final-conformance.json
node benchmark/jpegxl/production-program/verify-m4-conformance.ts --output .tmp/jpegxl-m6-m10/m6-final-m4-conformance.json
node benchmark/jpegxl/run-vardct-memory.ts --output .tmp/jpegxl-m6-m10/m6-final-vardct-memory.json
node benchmark/jpegxl/production-program/verify-m5-pipelines.ts --output .tmp/jpegxl-m6-m10/m6-final-m5-pipelines.json
node benchmark/jpegxl/production-program/build-m6-report.ts
npx vitest run tests/jpegxl-m6-cohort.test.ts tests/jpegxl-m6-report.test.ts
npm run build
npx playwright test browser-tests/jpegxl-pipeline.pw.ts --retries=0 --workers=3
```

The fifty native comparisons cover DC, two complete passes, a 6.25% viewport and
final output. The sixty isolated processes cover cold and warm preview, viewport
and full static decode. Warm runs close the first decoder and force GC twice
before measuring; absolute peak RSS still includes warmup. The report retains
post-GC baselines, external memory, ArrayBuffer memory, elapsed and first-pixel
time, output hashes and managed peaks.

Byte measurements count exact source payload requests, including structural
reads, without automatic read-ahead. They exclude HTTP headers. Browser tests
also exercise real local HTTP Range responses using explicit 4 KiB blocks and
verify that cached requests add no transfers. The report validator recomputes the
25% preview and 35% viewport median targets and the per-photo 50% managed-memory
reduction gate. Every individual miss remains in the report.

Pass and final rendering still retain full output storage. Some internal DC
frames retain full working planes. Plans expose these costs, and strict selective
requests reject them. These limits are separate from compressed group selection.
