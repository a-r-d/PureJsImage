# PureJsImage benchmark suite

This suite is the performance and workflow-success contract for PureJsImage.
Jimp 1.6.0 remains the original Lambda baseline. The broader competitor profile
also pins Sharp 0.35.3, image-js 1.7.0, and jSquash's JPEG 1.6.0, PNG 3.1.1,
WebP 1.5.0, and resize 2.1.1 packages.
The profile treats the default pure-JavaScript implementation and the explicitly registered
first-party JPEG/PNG WASM accelerators as separate PureJsImage engines.


## Principles

* Benchmark complete decode-transform-encode workloads, not isolated pixel
  loops.
* Require a valid output before treating a timing as successful.
* Keep input bytes identical across engines.
* Record wall time, CPU time, output size, absolute peak RSS, peak RSS delta,
  and premultiplied-RGBA PSNR where the workflow defines a quality reference.
* Run each measured sample in an isolated process after an optional untimed
  warmup. A measured process loads exactly one engine.
* Keep real photographs, standards fixtures, transparent graphics, pathological
  dimensions, and high-entropy images in the corpus.
* Classify every engine/workflow pair as pass, unsupported, invalid output, or
  error. Unsupported and invalid output never contribute timing results.
* Keep startup/import measurements separate from warm workflow timings.
* Build and decode the exact-area quality reference after measurement, outside
  both wall timing and peak-RSS sampling.

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
node benchmark/run.ts --engines purejsimage,purejsimage-wasm,jimp,sharp,sharp-single-thread,image-js,jsquash --profile competitors
```

The profile covers large JPEG metadata; JPEG resize, crop, and orientation;
transparent and opaque PNG workflows; JPEG/PNG conversion; the 100-megapixel
PNG downscale; BMP, TIFF, WebP, and HEIC inputs. It reuses the existing pinned
fixtures. An engine is marked unsupported when its public API or installed
codec build cannot express the exact workflow. In particular, the installed
Sharp build is probed against the pinned iPhone HEIC file rather than relying on
a generic HEIF capability flag.
`purejsimage` uses the default TypeScript codecs. `purejsimage-wasm` explicitly registers the
published JPEG and PNG scalar/SIMD accelerator providers and retains their normal eligibility and
fallback rules; workflows outside those accelerated subsets still execute through the same
TypeScript reference codecs.


Resize workflows use each engine's public default kernel. PureJsImage and Sharp
use Lanczos 3; Jimp uses bilinear. Cross-kernel timings describe each package's
default experience and are not matched-quality speed comparisons. `sharp` uses
its production defaults. `sharp-single-thread` is a separate engine and process
that calls `sharp.concurrency(1)` before processing. image-js uses its normal
public decode, transform, and encode APIs. Its optional Canvas integration is
omitted and is not part of the benchmark dependency tree.

For quality-enabled JPEG and PNG workflows, the harness independently decodes
the pinned input, applies crop and exact-area resize semantics, applies alpha
flattening where requested, and independently decodes each engine's output.
It reports PSNR over premultiplied RGB plus alpha, so invisible RGB values in
fully transparent pixels cannot inflate error. `exact` means every compared
channel matched. The oracle runs only for the first measured sample and after
the timed and peak-RSS regions. This makes quality loss visible alongside speed
and output size without claiming that different lossy quality scales are
calibrated or matched.

jSquash uses its public WebAssembly JPEG, PNG, WebP, and resize APIs. The worker
uses jSquash's documented manual Node WASM initialization and a minimal
`ImageData` environment shim; it does not use a Canvas package or modify the
codec implementations. Input conversion happens before timing. Its PNG encoder
does not expose compression-level tuning, so the normal package default is used
and output size remains recorded. Workflows requiring metadata-only inspection,
exact crop coordinates, explicit alpha flattening, BMP, TIFF, or HEIC are
reported as unsupported rather than approximated.

The current checked-in artifacts are
[`competitors-2026-08-09.md`](results/competitors-2026-08-09.md) and
[`competitors-2026-08-09.json`](results/competitors-2026-08-09.json).
The August 8 artifacts are retained as historical measurements from before
PureJsImage changed its default resize kernel from bilinear to Lanczos 3.

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
npm run fixtures:jpeg:prepare # optional reproducibility check; requires pnmtojpeg
npm run bench:jpeg:encode -- 420
npm run bench:jpeg:encode -- 444
npm run bench:jpeg:progressive
```

The generated reference fixtures add 4:4:0, 4:1:1, eight-bit SOF1, sequential component scans,
progressive refinement scans, restart behavior, and explicit RGB coverage. Their generator refuses
output whose SHA-256 differs from the checked-in corpus record.

The progressive encoder benchmark runs baseline, refinement-based progressive, restart-marker,
and progressive-plus-restart output in isolated cold and warm processes. It rejects output that
does not independently decode before reporting runtime, absolute peak RSS, retained coefficient
bytes, output size, and PSNR. The checked-in result is
[`jpeg-progressive-encode-2026-08-09.md`](results/jpeg-progressive-encode-2026-08-09.md).

Run the isolated scaled-IDCT comparison for the pinned 4000x3000 JPEG:

```sh
npm run bench:jpeg:scaled-idct -- --runs 3
```

The 200px, 800px, and 1200px cases exercise native 1/8, 1/4, and 1/2 IDCT
output. Each is compared with the forced full-resolution decoder path and
reports decoded pixels avoided, runtime, absolute peak RSS, MAE, and PSNR. The
checked-in result is
[`jpeg-scaled-idct-2026-08-08.md`](results/jpeg-scaled-idct-2026-08-08.md).

Measure chroma interpolation quality against Sharp/libvips/libjpeg and compare full versus
restart-aware crop decoding in isolated cold and warm workers:

```sh
npm run bench:jpeg:upsampling
npm run bench:jpeg:region-rss
```

The region benchmark uses the same decoded crop for both paths and rejects a hash mismatch before
reporting timing. It records absolute peak RSS, fixed compressed-byte retention, entropy MCUs, and
reconstructed blocks; `full` is the explicit no-region baseline.

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

The profile includes reproducible 4000x3000 lossy VP8 and lossless VP8L resize-to-JPEG
pressure fixtures. Both run in isolated processes, require oracle-derived pixel samples to pass,
and report absolute peak RSS so source-height-scaled decode buffers cannot regress unnoticed.

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

### Real AWS Lambda

The Lambda deployment creates temporary Node.js 22 functions in `us-east-1`:
x86_64 at 256, 512, and 1024 MiB, plus ARM64 at 512 MiB. The original runner
measures the x86_64 memory-tier profile. The ARM/WASM runner compares x86_64 and
ARM64 at 512 MiB on the same JavaScript bundle, then explicitly selects the JPEG
WASM accelerator for eligible full-resolution decode:

```sh
AWS_PROFILE=<profile> AWS_REGION=us-east-1 npm run bench:lambda:deploy
AWS_PROFILE=<profile> AWS_REGION=us-east-1 npm run bench:lambda:run
AWS_PROFILE=<profile> AWS_REGION=us-east-1 npm run bench:lambda:run:arm-wasm
AWS_PROFILE=<profile> AWS_REGION=us-east-1 npm run bench:lambda:destroy
```

Always destroy the stack after the run. The x86_64 and ARM64 target chains run
concurrently because they use separate functions. Within each target, the runner
serializes the environment-nonce update, waits for the Lambda update, invokes
one cold sample, and immediately invokes its paired warm sample. The Lambda log
stream must match before the warm sample is accepted, so samples sharing one
function cannot run concurrently without invalidating the lifecycle check.

The final 05:51 UTC profile staged the pinned 4000x3000 JPEG and deterministic
4000x3000 RGBA PNG as external S3 fixture objects. The deployed code ZIP was
98,517 bytes; the two fixture objects totaled 14,160,578 bytes and were not part
of that ZIP. The deploy command creates the temporary staging bucket without
requiring the ECR permission used by the standard CDK bootstrap. The destroy
command removes the functions, explicit log groups, IAM role, CloudFormation
stack, code object, fixture objects, and bucket. An earlier development pass
embedded the fixtures in a roughly 5.2 MiB package; that package and cold-start
profile are obsolete and are not the final published result.

The JPEG WASM module measured 21,100 bytes raw, 5,160 bytes gzip, and 4,363 bytes
Brotli. It remains opt-in: the JavaScript reference path is the default, and the
accelerator applies only when the planner requests an eligible full-resolution
JPEG decode. An accepted accelerated cold sample must instantiate the module
exactly once during the operation; its paired warm invocation must reuse that
instance. WASM memory was 6.0 MiB for every accelerated workflow, but maximum
AWS-reported memory did not always fall.

Interpret the architecture rows per workflow rather than declaring one platform
faster. ARM64 warm operation medians were about 5–6% lower for the JPEG inputs
and about 3–8% higher for the PNG inputs. The WASM warm medians improved by about
9% on x86_64 and 16% on ARM64 for PNG output. ARM64 WebP measured 13,604.4 ms on
the reference path and 8,160.3 ms with WASM, but the three-sample distributions
were variable, so use the exact samples rather than generalizing that result.

Every accepted workflow must produce one output SHA-256 across cold and warm
invocations, both architectures, and both engines where applicable.
`operationMs` excludes the S3 fixture read and output metadata validation but
includes JS/WASM input and output copies. AWS `Duration` includes the complete
handler, including the S3 read; cold total adds `Init Duration`. Maximum memory
is the largest AWS `REPORT` value across cold and warm samples.

Read the final
[ARM64 and JPEG WASM report](results/aws-lambda-arm-wasm-2026-08-09.md) and
[raw JSON samples](results/aws-lambda-arm-wasm-2026-08-09.json).

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

The separate bundle and installed-deployment comparison is reproducible with:

```sh
npm run size
```

It reports minified, gzip, and Brotli JavaScript for codec-scoped imports, then
walks each installed production dependency tree. Sharp's JavaScript result is
identified as a native wrapper and is paired with the platform-specific addon
and libvips footprint.

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
