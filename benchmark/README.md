# PureJsImage benchmark suite

This suite is the performance and workflow-success contract for PureJsImage.
Jimp 1.6.0 is the pinned baseline because that is the version used by the
original Lambda image-processing workload when this suite was created.

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

The BMP corpus pins 14 public-domain files from BMP Suite 2.8. They cover OS/2,
Windows v3 and v5 headers, 1/4/8-bit palettes, RLE4/RLE8, top-down storage,
odd-width row padding, RGB555/RGB565, 24-bit pixels, reordered 32-bit
bitfields, and explicit alpha. A deterministic 4000x3000 24-bit BMP provides
the large Lambda memory workload. Reference-image pixels are pinned for codec
correctness.

The TIFF corpus pins seven fixtures from LibTIFF 4.7.1 and adds a deterministic
4000x3000 stripped RGB image. It covers both byte orders, RGB, grayscale,
bi-level, palette, planar alpha, uncompressed, PackBits, Deflate, and LZW data.
The large RGB and 7795x3122 single-strip LZW cases establish the decode and
Lambda-memory baselines.

The HEIF corpus pins three original 4032x3024 iPhone 12 Pro HEIC camera files.
All three are 48-tile HEVC Main Still Picture grids with 8-bit YUV 4:2:0,
orientation metadata, WPP, scaling lists, SAO, and CU QP deltas. The profile
checks metadata, full HEIC-to-PNG decode, auto-oriented HEIC-to-JPEG resize, and
an oriented crop-resize workflow. Pixel samples are pinned from an independent
ImageMagick/libheif decode with narrow documented tolerances.

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

First-party BMP compatibility and performance profile:

```sh
npm run bench:bmp
```

The separate Jimp compatibility baseline is expected to report failures for
formats where its output does not match BMP Suite or it cannot decode the
input:

```sh
npm run bench:bmp:jimp
```

Jimp TIFF decode, transform, and encode baseline:

```sh
npm run bench:tiff:jimp
```

First-party TIFF compatibility and performance profile:

```sh
npm run bench:tiff
```

Verify the pinned iPhone HEIF container and HEVC configuration:

```sh
npm run fixtures:heif
```

Run the isolated cold and warm HEIF/HEVC pipeline profiles:

```sh
npm run bench:heif:cold
npm run bench:heif:warm
```

The pinned Jimp engine has no HEIF decoder, so these are correctness-gated
PureJsImage baselines rather than a synthetic head-to-head comparison.

The planar PackBits alpha fixture is validated against its source alpha plane,
and the trailing-data Deflate fixture is validated against independent TIFF
decoders. Jimp 1.6.0 decodes both incorrectly, so its baseline reports those
cases as correctness failures while continuing to measure the other workflows.

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
