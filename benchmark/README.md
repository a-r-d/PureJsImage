# PureJsImage benchmark suite

This suite is the performance and workflow-success contract for PureJsImage.
Jimp 1.6.0 is the pinned baseline because that is the version used by the
Tooldesk repository when this suite was created.

## Principles

* Benchmark complete decode-transform-encode workloads, not isolated pixel
  loops.
* Require a valid output before treating a timing as successful.
* Keep input bytes identical across engines.
* Record wall time, CPU time, output size, absolute peak RSS, and peak RSS delta
  from the post-warmup baseline.
* Run each measured sample in an isolated process after an optional untimed
  warmup.
* Keep real photographs, standards fixtures, transparent graphics, pathological
  dimensions, and high-entropy images in the corpus.
* Treat unsupported workflows and invalid output as failures, not fast results.

## Corpus

`corpus/manifest.json` records every downloaded image's source, license,
expected dimensions, and SHA-256 hash. Downloaded and generated binaries live
under `corpus/files/` and are intentionally ignored by Git.

Prepare and verify them with:

```sh
npm run fixtures:prepare
npm run fixtures:verify
```

The preparation script generates synthetic fixtures deterministically. It only
downloads files that are missing or fail verification.

The WebP corpus adds six independently encoded files from the official Google
WebP galleries and Wikimedia Commons. It covers two ordinary lossy photographs,
a larger 1600x2000 photograph, two lossless alpha graphics with odd dimensions,
and a lossy image with a compressed alpha plane. Reference pixel samples are
pinned for decoder workflows in addition to dimensions and container hashes.

## Running

Quick harness validation:

```sh
npm run bench:smoke
```

Standard Jimp baseline:

```sh
npm run bench:jimp -- --profile standard
```

JPEG implementation and cross-format regression pass:

```sh
PUREJSIMAGE_ENTRY=./dist/index.js npm run bench -- --engines jimp,purejsimage --profile phase4
```

Cross-format and first-frame GIF regression pass:

```sh
PUREJSIMAGE_ENTRY=./dist/index.js npm run bench -- --engines jimp,purejsimage --profile phase5
```

Static WebP decode, transform, and encode profile:

```sh
npm run bench:webp
```

Jimp 1.6.0 does not provide a WebP codec, so this profile is intentionally
PureJsImage-only. Decode results still require independently generated pixel
samples to pass. The profile records absolute time, output size, and memory
without inventing an invalid direct Jimp comparison.

All Jimp-comparable workflows, including batch and 100-megapixel stress cases:

```sh
npm run bench:jimp -- --profile full
```

Results are written as both JSON and Markdown under `results/`. JSON is the
authoritative machine-readable artifact. Markdown is the review summary.

Absolute peak RSS is the headline memory number. The delta remains available in
JSON as a diagnostic, but a warmup may leave allocator pages resident and make
the delta understate the real process footprint.

When PureJsImage has an executable build, set `PUREJSIMAGE_ENTRY` to its module
entrypoint and run both engines:

```sh
PUREJSIMAGE_ENTRY=./dist/index.js npm run bench -- --engines jimp,purejsimage
```

## Interpretation

PureJsImage wins a case only when it produces valid output and improves the
median wall time. The north-star goal is to win every supported standard case
while reducing peak RSS. Stress and compatibility cases may first expose
unsupported behavior; they remain visible until fixed rather than disappearing
from the suite.
