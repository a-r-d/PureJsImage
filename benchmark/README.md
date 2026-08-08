# PureJsImage benchmark suite

This suite is the performance and workflow-success contract for PureJsImage.
Jimp 1.6.0 remains the original Lambda baseline. The broader competitor profile
also pins Sharp 0.35.3 and image-js 1.7.0.

## Principles

* Benchmark complete decode-transform-encode workloads, not isolated pixel
  loops.
* Require a valid output before treating a timing as successful.
* Keep input bytes identical across engines.
* Record wall time, CPU time, output size, absolute peak RSS, and peak RSS delta
  from the post-warmup baseline.
* Run each measured sample in an isolated process after an optional untimed
  warmup. A measured process loads exactly one engine.
* Keep real photographs, standards fixtures, transparent graphics, pathological
  dimensions, and high-entropy images in the corpus.
* Classify every engine/workflow pair as pass, unsupported, invalid output, or
  error. Unsupported and invalid output never contribute timing results.
* Keep startup/import measurements separate from warm workflow timings.

## Corpus

`corpus/manifest.json` records every downloaded image's source, license,
expected dimensions, and SHA-256 hash. Downloaded and generated binaries live
under `corpus/files/` and are normally ignored by Git. Small permanent codec
regressions such as the ICO corpus are committed explicitly.

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

The JPEG compatibility corpus adds an Apple iPhone gain-map image, libultrahdr
ICC and ordinary JPEG fixtures, and Web Platform Tests' progressive Squoosh
MozJPEG RGB and YUV outputs. The dedicated verifier checks MPF image count,
color-space and sampling classification, SDR-primary decoding, ICC conversion,
and pixels derived from independent ImageMagick/LittleCMS decodes.

The ICO corpus commits three deterministic files covering multi-image
selection, a PNG-backed 256px primary, 24-bit DIB masking, and 32-bit DIB
partial alpha. Exact decoded pixels are pinned and were cross-checked with
ImageMagick. The profile measures metadata, PNG-backed and DIB-backed decode,
favicon resize, alpha flattening, absolute peak RSS, and output correctness.

## Running

Quick harness validation:

```sh
npm run bench:smoke
```

Broader competitor comparison:

```sh
npm run bench:competitors
```

The equivalent direct harness command, after `npm run build`, is:

```sh
node benchmark/run.ts --engines purejsimage,jimp,sharp,sharp-single-thread,image-js --profile competitors
```

The profile covers large JPEG metadata; JPEG resize, crop, and orientation;
transparent and opaque PNG workflows; JPEG/PNG conversion; the 100-megapixel
PNG downscale; BMP, TIFF, WebP, and HEIC inputs. It reuses the existing pinned
fixtures. An engine is marked unsupported when its public API or installed
codec build cannot express the exact workflow. In particular, the installed
Sharp build is probed against the pinned iPhone HEIC file rather than relying on
a generic HEIF capability flag.

`sharp` uses its production defaults. `sharp-single-thread` is a separate
engine and process that calls `sharp.concurrency(1)` before processing.
image-js uses its normal public decode, transform, and encode APIs. Its optional
Canvas integration is omitted and is not part of the benchmark dependency
tree.

The current checked-in artifacts are
[`competitors-2026-08-08.md`](results/competitors-2026-08-08.md) and
[`competitors-2026-08-08.json`](results/competitors-2026-08-08.json).

Standard Jimp baseline:

```sh
npm run bench:jimp -- --profile standard
```

JPEG implementation and cross-format regression pass:

```sh
PUREJSIMAGE_ENTRY=./dist/index.js npm run bench -- --engines jimp,purejsimage --profile phase4
```

Verify the pinned JPEG compatibility pixels and run the isolated encoder probe:

```sh
npm run fixtures:jpeg
npm run bench:jpeg:encode -- 420
npm run bench:jpeg:encode -- 444
```

Verify the checksum-pinned JPEG 2000 corpus, then run its isolated real-photo
metadata and resize-to-JPEG RSS gates:

```sh
npm run fixtures:jpeg2000
npm run bench:jpeg2000:rss
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
without inventing an invalid direct Jimp comparison. Lossy WebP encoder output
is decoded in a separate Sharp/libwebp oracle process after timing and must pass
pinned pixel checks; the native oracle is never loaded into the measured
PureJsImage process.

Ordered spatial transforms ending in JPEG output:

```sh
npm run bench:transforms
npm run bench:transforms:compare
```

This profile measures a 90-degree rotation and downscale, arbitrary-angle
rotation with alpha flattening, crop-after-resize followed by a second resize,
and combined vertical and horizontal reflection. Every result is checked for
the expected dimensions and pinned pixels before its timing is accepted. The
arbitrary-angle workflow is intentionally a PureJsImage absolute baseline:
Jimp uses different canvas sizing and sampling semantics, so its output is not
an equivalent comparison. The comparison command runs the other three
workflows through both engines with the same correctness gates.

Run the real-browser compatibility suite in Chromium, Firefox, and WebKit:

```sh
npm run browser:test
```

Record the Chromium-only browser performance baseline:

```sh
npm run browser:bench
```

PureJsImage and native `createImageBitmap` + `OffscreenCanvas` results are
complete decode-resize-encode pipelines. jSquash JPEG, PNG, and WebP results are
codec-only decode or encode measurements and are deliberately labeled as such.
See `../browser-support.md` for exact engine versions and measurement details.

Verify and benchmark ICO inputs:

```sh
npm run fixtures:ico
npm run bench:ico
```

Jimp 1.6.0 does not decode ICO, so this is a correctness-gated PureJsImage-only
profile rather than an invalid head-to-head timing.

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

Prepare the checksum-pinned HEIF compatibility corpus, regenerate its two
first-party transform/profile fixtures, and verify the pinned matrix:

```sh
npm run fixtures:heif:prepare
npm run fixtures:heif
```

Re-run the isolated PureJsImage versus ImageMagick/libheif compatibility and
RSS report:

```sh
npm run report:heif:compatibility
```

The report command requires ImageMagick with its HEIC delegate, FFmpeg, and
`heif-thumbnailer` from libheif. These are development oracles only and are not
package dependencies.

The 2026-08-08 baseline classifies 25 files as 10 compatible, 12 explicitly
unsupported, 1 incorrect-pixels result, and 2 unexpected exceptions. The
largest unsupported cluster is absent or unspecified color-matrix signaling;
see `results/heif-compatibility-2026-08-08.md` for the evidence and next-project
recommendation.

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

Every report contains a compatibility table, a performance table limited to
workflows that passed equivalently for every selected engine, and a separate
startup/package table. Startup uses one fresh process per engine and records
module import time, RSS immediately after import, first JPEG metadata and resize
latency, installed package footprint, and installed production package count.
The package count includes the engine package itself and every installed
production dependency instance required on the current platform.

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

Workflow timing includes encoding, but `quality: 80` is not a calibrated quality
target shared by different JPEG encoders. Compression quality and size require
a separate matched-quality study; the competitor report does not rank encoders
by output size alone.
