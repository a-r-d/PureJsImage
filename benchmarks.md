# Benchmarks

PureJsImage's benchmark northstar is to beat Jimp on validated image-processing
workflows, with peak memory as the primary AWS Lambda constraint. These are
comparisons with the JavaScript library **Jimp**, not the desktop application
GIMP.

The `competitors` profile expands the comparison to `sharp@0.35.3`,
`image-js@1.7.0`, and jSquash's pinned JPEG 1.6.0, PNG 3.1.1, WebP 1.5.0, and
resize 2.1.1 packages. Sharp is the native dependency, jSquash uses
WebAssembly, image-js and Jimp are pure JavaScript, and `sharp-single-thread`
is reported separately after calling `sharp.concurrency(1)` in its own process.
These versions were the stable npm releases when pinned on August 8, 2026.

A result only counts when the output is supported, decodes successfully, has
the expected dimensions, and passes the workflow's pixel or structural checks.
A fast invalid image is a failed run.

## Methodology

Unless a section says otherwise, the recorded results use:

- `jimp@1.6.0`;
- Node.js 24.16.0 on Linux x64;
- an Intel Core i7-10700 with 16 logical CPUs;
- isolated worker processes;
- median and p95 wall time across repeated runs; and
- absolute process peak RSS, including the Node.js runtime.

Input reads, worker startup, warmups, and output validation are outside the
timed region. Fixtures are checksum-pinned and prepared before measurement.
Results were recorded on August 6-9, 2026.

Peak RSS is an absolute process high-water mark, not a codec-only allocation
counter. Small workflows therefore include a large fixed Node.js baseline. The
largest workflows are more representative of memory scaling.

## Broader competitor profile

Run the reproducible comparison with:

```sh
npm run bench:competitors
```

It reuses 14 existing workflows and fixtures: large JPEG metadata; JPEG resize,
crop, and the northstar pipeline; PNG resize and alpha handling; transparent PNG
flattening; JPEG/PNG conversion; EXIF orientation 6; the 100-megapixel PNG
downscale; BMP, TIFF, WebP, and pinned iPhone HEIC inputs.

Each engine/workflow pair is reported as pass, unsupported, invalid output, or
error. Only a pass has timing data. The Markdown report's performance table is
limited to workflows supported equivalently by every selected engine. Its
separate startup table records fresh-process import time, RSS after import,
first JPEG metadata and resize latency, npm package (unpacked) size, and the
production package count, including Sharp's required platform packages.

Dimensions and pinned pixels validate crop coordinates, resize geometry,
orientation, alpha preservation, and background flattening. Lossy comparisons
also record output size, but matching `quality: 80` settings do not imply matched
visual quality across encoders. A quality or compression-efficiency claim needs
a separate matched-quality study.

The complete six-engine run recorded 67 passing engine/workflow pairs and 17
explicit unsupported results, with no invalid output or runtime errors.
jSquash passed seven workflows and reported seven unsupported without
substituting a decode for metadata inspection or approximating crop and alpha
semantics:

- [readable competitor report](benchmark/results/competitors-2026-08-08.md)
- [machine-readable competitor report](benchmark/results/competitors-2026-08-08.json)

## Bundle and npm package size comparison

Run the reproducible size comparison with:

```sh
npm run size
```

It bundles each public import with the same esbuild settings and also measures
the npm package (unpacked) contents and production dependency tree. The npm
package (unpacked) value is not the compressed `.tgz` download size; run
`npm pack --dry-run --json` to see both `size` and `unpackedSize`. JPEG and PNG are the matched codec
set because all five libraries support them. PureJsImage and jSquash can
assemble exactly that set; the normal Jimp, image-js, and Sharp imports bring
the additional codecs reported in the output. The report records exact
versions: PureJsImage 0.7.0, Jimp 1.6.0, image-js 1.7.0, Sharp 0.35.3, and
jSquash JPEG 1.6.0, PNG 3.1.1, and resize 2.1.1.

Sharp's minified JavaScript is only its wrapper. Its deployment footprint also
includes the native addon and platform-specific libvips package. Both values are
reported so the wrapper is never presented as the complete Sharp deployment.
jSquash is treated the same way: its minified JavaScript is codec/resize glue,
while its npm package (unpacked) contents include the three required WebAssembly packages.

## Headline results

| Workflow | PureJsImage wall | Jimp wall | Wall difference | PureJsImage RSS | Jimp RSS | Memory reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 6000x4000 orient, crop, resize, JPEG | 3,242.5 ms | 3,762.9 ms | 13.8% faster | 118.6 MiB | 1,188.3 MiB | 90.0% |
| JPEG crop and resize | 2,554.3 ms | 2,868.2 ms | 10.9% faster | 121.3 MiB | 1,197.2 MiB | 89.9% |
| 100-megapixel PNG downscale | 3,547.5 ms | 3,732.5 ms | 5.0% faster | 173.5 MiB | 1,273.5 MiB | 86.4% |
| 4000x3000 PNG resize | 794.8 ms | 944.3 ms | 15.8% faster | 138.0 MiB | 301.4 MiB | 54.2% |
| PNG crop and resize | 395.9 ms | 652.3 ms | 39.3% faster | 127.4 MiB | 296.2 MiB | 57.0% |
| 4000x3000 BMP resize to JPEG | 284.1 ms | 719.0 ms | 60.5% faster | 158.2 MiB | 262.2 MiB | 39.7% |
| Large TIFF resize to JPEG | 686.0 ms | 638.8 ms | 7.4% slower | 164.3 MiB | 318.5 MiB | 48.4% |

The primary JPEG paths now improve both time and memory, using roughly one
tenth of Jimp's peak RSS. PNG, BMP, and several cross-format workflows also
improve both measurements.

## JPEG and production upload workflows

The first-party baseline JPEG decoder retains one MCU row instead of a
source-sized RGB or RGBA bitmap.

| Workflow | PureJsImage wall | Jimp wall | PureJsImage RSS | Jimp RSS |
| --- | ---: | ---: | ---: | ---: |
| Large JPEG metadata | 0.2 ms | 5,285 ms | 97.3 MiB | 1,184 MiB |
| 4000x3000 JPEG resize to 1200 px | 893.6 ms | 1,395.1 ms | 106.4 MiB | 596.0 MiB |
| 6000x4000 northstar pipeline | 3,242.5 ms | 3,762.9 ms | 118.6 MiB | 1,188.3 MiB |
| JPEG crop and resize | 2,554.3 ms | 2,868.2 ms | 121.3 MiB | 1,197.2 MiB |
| Twilio MMS JPEG to 1024 px | 852.9 ms | 1,364.4 ms | 105.3 MiB | 600.6 MiB |
| PNG upload to 2048 px JPEG | 1,053.8 ms | 1,997.3 ms | 140.5 MiB | 399.6 MiB |
| EXIF orientation 6 | 387.6 ms | 576.0 ms | 104.5 MiB | 253.9 MiB |
| High-entropy PNG to JPEG | 576.2 ms | 1,400.0 ms | 144.1 MiB | 432.5 MiB |

The isolated 2048x1536 encoder probe measures five post-warmup encodes and
independently decodes each result with `jpeg-js`.

| Chroma sampling | Median wall | Throughput | Peak RSS | Output | PSNR |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4:2:0 | 244.6 ms | 12.86 MP/s | 100.7 MiB | 1,492,375 B | 18.44 dB |
| 4:4:4 | 433.4 ms | 7.26 MP/s | 115.4 MiB | 2,660,990 B | 25.68 dB |

The pre-change 4:4:4-only encoder probe measured 580.3 ms. The current explicit
4:4:4 path is 25.3% faster; the default 4:2:0 path is 57.9% faster and 43.9%
smaller on the deliberately high-frequency probe image. The lower 4:2:0 PSNR
records the expected chroma-quality tradeoff.

An exploratory 4000x3000 progressive-JPEG resize measured 2.12 seconds and
142.5 MiB for PureJsImage versus 1.93 seconds and 581.7 MiB for Jimp: 75.5%
less peak memory. It remains exploratory until the progressive fixture has a
stable downloadable source.

Reports:

- [large JPEG metadata](benchmark/results/purejsimage-phase1-metadata-2026-08-06.md)
- [current JPEG workflows](benchmark/results/jpeg-easy-wins-phase4-final-2026-08-07.md)
- [JPEG resize before optimization](benchmark/results/jpeg-easy-wins-baseline-2026-08-07.md)
- [JPEG resize after optimization](benchmark/results/jpeg-easy-wins-final-released-2026-08-07.md)
- [JPEG encoder and subsampling probe](benchmark/results/purejsimage-jpeg-jit-subsampling-2026-08-07.md)
- [cold JPEG resize](benchmark/results/purejsimage-first-party-jpeg-resize-cold-2026-08-06.md)
- [warm JPEG resize](benchmark/results/purejsimage-first-party-jpeg-resize-warm-2026-08-06.md)

## PNG

PNG decoding, crop, resize, and adaptive encoding operate in bounded rows. The
encoder evaluates PNG filters 0-4 per row.

| Workflow | PureJsImage wall | Jimp wall | PureJsImage RSS | Jimp RSS | PureJsImage output | Jimp output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 4000x3000 resize to 1000 px | 794.8 ms | 944.3 ms | 138.0 MiB | 301.4 MiB | 102,202 B | 775,919 B |
| Crop and resize | 395.9 ms | 652.3 ms | 127.4 MiB | 296.2 MiB | 20,408 B | 164,105 B |
| Transparent resize | 49.7 ms | 84.6 ms | 111.7 MiB | 139.5 MiB | 6,756 B | 21,766 B |
| 100-megapixel downscale | 3,547.5 ms | 3,732.5 ms | 173.5 MiB | 1,273.5 MiB | 16,698 B | 298,227 B |

Reports:

- [large PNG resize](benchmark/results/purejsimage-adaptive-png-resize-2026-08-06.md)
- [PNG crop and resize](benchmark/results/purejsimage-adaptive-png-crop-resize-2026-08-06.md)
- [transparent PNG resize](benchmark/results/purejsimage-adaptive-png-alpha-resize-2026-08-06.md)
- [100-megapixel stress](benchmark/results/purejsimage-adaptive-stress-100mp-2026-08-06.md)

## GIF and cross-format conversion

GIF measurements decode the first composited frame. Full animation editing and
encoding are outside the current scope.

| Workflow | PureJsImage wall | Jimp wall | PureJsImage RSS | Jimp RSS |
| --- | ---: | ---: | ---: | ---: |
| JPEG to PNG | 408.6 ms | 661.7 ms | 116.8 MiB | 265.4 MiB |
| PNG to JPEG | 59.9 ms | 201.7 ms | 115.1 MiB | 176.7 MiB |
| Animated GIF first frame to PNG | 24.1 ms | 11.1 ms | 83.8 MiB | 94.7 MiB |
| Twilio MMS GIF to JPEG | 80.5 ms | 103.5 ms | 97.5 MiB | 130.9 MiB |
| Lambda GIF logo normalization | 39.2 ms | 27.5 ms | 86.9 MiB | 94.9 MiB |

See the [complete cross-format report](benchmark/results/purejsimage-phase5-first-party-cold-2026-08-06.md).

## BMP

PureJsImage passed all 16 BMP workflows. Jimp passed nine. Its output failed
the independent reference checks for several 4-bit, RLE, 16-bit, and V5-alpha
fixtures, and it rejected the OS/2 v1 fixture.

| Workflow | PureJsImage wall | Jimp wall | PureJsImage RSS | Jimp RSS |
| --- | ---: | ---: | ---: | ---: |
| 4000x3000 metadata | 14.0 ms | 239.1 ms | 117.6 MiB | 173.7 MiB |
| 4000x3000 resize to JPEG | 284.1 ms | 719.0 ms | 158.2 MiB | 262.2 MiB |
| Top-down crop and resize | 34.1 ms | 14.8 ms | 88.3 MiB | 96.5 MiB |
| 24-bit crop, resize, JPEG | 41.3 ms | 52.3 ms | 90.4 MiB | 120.9 MiB |
| JPEG to BMP | 525.9 ms | 586.7 ms | 105.9 MiB | 292.5 MiB |

Reports:

- [PureJsImage BMP](benchmark/results/purejsimage-bmp-baseline-2026-08-06.md)
- [Jimp BMP](benchmark/results/jimp-bmp-baseline-2026-08-06.md)

## TIFF

PureJsImage passed all ten TIFF workflows. Jimp passed eight and failed the
planar-alpha PackBits and Deflate fixtures.

| Workflow | PureJsImage wall | Jimp wall | PureJsImage RSS | Jimp RSS |
| --- | ---: | ---: | ---: | ---: |
| Large metadata | 0.3 ms | 145.2 ms | 119.6 MiB | 254.4 MiB |
| Large resize to JPEG | 686.0 ms | 638.8 ms | 164.3 MiB | 318.5 MiB |
| LZW single-strip resize | 583.8 ms | 726.8 ms | 114.0 MiB | 283.7 MiB |
| PNG to TIFF | 21.7 ms | 103.4 ms | 103.7 MiB | 136.4 MiB |

Reports:

- [PureJsImage TIFF](benchmark/results/purejsimage-tiff-baseline-2026-08-07.md)
- [Jimp TIFF](benchmark/results/jimp-tiff-baseline-2026-08-07.md)

## WebP

Jimp 1.6 does not expose a WebP codec, so these are absolute PureJsImage
baselines rather than head-to-head comparisons. Lossy encoder output is decoded
after timing in a separate Sharp/libwebp process and must pass pinned pixel
checks before the sample counts.

| Workflow | Median wall | Peak RSS |
| --- | ---: | ---: |
| Large metadata | 0.1 ms | 91.4 MiB |
| Large resize to JPEG | 510.9 ms | 127.0 MiB |
| 12 MP lossy pressure resize | 843.0 ms | 140.7 MiB |
| 12 MP lossless pressure resize | 921.5 ms | 130.4 MiB |
| Lossy WebP to PNG | 214.5 ms | 143.1 MiB |
| Lossy crop and resize | 94.0 ms | 121.6 MiB |
| Lossless-alpha WebP to PNG | 46.9 ms | 102.2 MiB |
| Odd-sized lossless WebP to PNG | 38.5 ms | 103.7 MiB |
| Lossy-alpha WebP to PNG | 175.2 ms | 151.9 MiB |
| JPEG to lossy WebP | 979.6 ms | 123.7 MiB |
| PNG to lossless WebP | 56.3 ms | 114.6 MiB |

VP8 decode now retains two macroblock rows, while VP8L uses scanline transform
buffers and a fixed maximum 4 MiB entropy history instead of full-frame pixel
planes. Reproducible 4000x3000 lossy and lossless pressure fixtures gate both
paths; compressed RIFF input and compact VP8L transform maps remain source-sized.

See the
[oracle-validated WebP report](benchmark/results/webp-oracle-validated-2026-08-08.md),
[12 MP lossy pressure report](benchmark/results/webp-memory-lossy-2026-08-09.md), and
[12 MP lossless pressure report](benchmark/results/webp-memory-lossless-2026-08-09.md).

## ICO

Jimp 1.6 does not expose an ICO codec, so these are absolute PureJsImage
baselines. The three small first-party fixtures are committed to the repository
and checksum-pinned: a mixed 16/32/256-pixel DIB/PNG icon, a 32-bit DIB with
partial alpha, and a 24-bit DIB with a one-bit AND mask.

| Workflow | Median wall | Peak RSS |
| --- | ---: | ---: |
| Mixed-icon metadata and selection | 0.3 ms | 92.3 MiB |
| Selected 256px embedded PNG to PNG | 7.4 ms | 97.7 MiB |
| 128px 32-bit DIB with alpha to PNG | 4.0 ms | 90.6 MiB |
| 96px 24-bit DIB with mask to PNG | 2.4 ms | 90.5 MiB |
| Mixed favicon resize to 64px PNG | 8.7 ms | 94.8 MiB |
| 24-bit DIB resize to JPEG | 13.9 ms | 94.8 MiB |

Every timing above passed metadata, dimensions, and pinned pixel validation.
Input reads, worker startup, warmup, and validation remained outside the timed
region.

See the [complete ICO report](benchmark/results/ico-first-party-2026-08-08.md).

## AVIF

AVIF metadata inspection passes all 25 permanent corpus files and 35 coded
items. The current pixel decoder supports three of the 25 files, including two
full-size opaque 8-bit YUV 4:2:0 photographs. Unsupported files fail explicitly.

| Public AVIF-to-PNG workflow | Median wall |
| --- | ---: |
| Kodak 768x512 | 294.8 ms |
| Fox 1204x800 | 782.9 ms |

The five-run photo benchmark reached 143.8 MiB maximum observed process RSS.
The decoder currently retains padded full-frame YUV and RGBA state and does not
yet apply loop filtering, CDEF, or Wiener/SGR restoration, so this is not the
final memory or post-filter quality result.

The development-only `@stacksjs/ts-avif` research baseline decoded 23/25 files,
but it is not a production dependency. Its median full decode was 180.1 ms with
118.5 MiB median peak RSS across its compatible research cases; the inputs and
scope differ from the two targeted PureJsImage photo timings above, so this is
not a direct performance comparison.

Reports:

- [AVIF research baseline](benchmark/results/avif-research-baseline-2026-08-06.md)
- [AV1 bitstream inspection](benchmark/results/avif-phase-b1-bitstream-2026-08-06.md)
- [restricted pixel decode](benchmark/results/avif-phase-b2-restricted-decode-2026-08-06.md)
- [common opaque photographs](benchmark/results/avif-common-opaque-420-2026-08-07.md)

## HEIF / HEVC

The HEIF profile uses three checksum-pinned original iPhone 12 Pro camera
files. Each input is a 4032x3024 HEIC grid containing 48 independently coded
512x512 HEVC Main Still Picture tiles. Before measurement, the fixture verifier
checks the item layout, profile, bit depth, chroma format, WPP entry points,
scaling lists, SAO, and CU QP deltas. Timings count only when the PNG or JPEG
output also passes pixel samples pinned from an independent
ImageMagick/libheif decode.

| Workflow | Cold wall | Cold peak RSS | Warm wall | Warm peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Metadata | 32.3 ms | 89.0 MiB | 2.2 ms | 89.5 MiB |
| Full auto-oriented HEIC to PNG | 11,510.1 ms | 326.5 MiB | 11,513.7 ms | 430.4 MiB |
| Auto-oriented resize to 1200px JPEG | 8,080.0 ms | 189.8 MiB | 8,141.6 ms | 241.5 MiB |
| Auto-oriented crop and resize to 800x600 PNG | 8,922.5 ms | 164.0 MiB | 8,529.4 ms | 219.8 MiB |

These are first-party absolute baselines; the pinned Jimp engine has no HEIF
decoder. The higher warm absolute RSS is retained allocator state after the
untimed warmup, which is why the suite keeps absolute RSS, post-warmup RSS
delta, external memory, and ArrayBuffer memory in the JSON report. The crop
case demonstrates useful tile selection, but the full decode remains well
above the desired Lambda memory tier and is an explicit optimization target.

Reports:

- [cold iPhone HEIF/HEVC workflows](benchmark/results/heif-iphone-cold-2026-08-07.md)
- [warm iPhone HEIF/HEVC workflows](benchmark/results/heif-iphone-warm-2026-08-07.md)

## Reproducing the benchmarks

Prepare and verify the pinned fixtures first:

```sh
npm run fixtures:prepare
npm run fixtures:verify
npm run fixtures:avif
npm run fixtures:heif
npm run fixtures:ico
```

Build the package and run the desired profiles:

```sh
npm run build
npm run bench:jimp -- --profile full
npm run bench:competitors
npm run bench:bmp
npm run bench:bmp:jimp
npm run bench:tiff
npm run bench:tiff:jimp
npm run bench:webp
npm run bench:ico
npm run bench:avif:b2
npm run bench:heif:cold
npm run bench:heif:warm
```

The harness design, validation rules, profiles, corpus manifest, and raw result
format are documented in [benchmark/README.md](benchmark/README.md). The
original complete Jimp baseline is in
[benchmark/results/jimp-baseline-2026-08-06.md](benchmark/results/jimp-baseline-2026-08-06.md).
