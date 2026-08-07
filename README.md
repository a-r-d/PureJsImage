# PureJsImage

PureJsImage aims to be the smallest, fastest, and lowest-memory practical
alternative to Jimp for common image-processing workflows, implemented in
strict TypeScript and compiled to JavaScript.

The project focuses on complete application workflows—decode, inspect, orient,
crop, resize, convert, and encode—rather than trying to reproduce every image
editing feature in Jimp.

The original production motivation is AWS Lambda. Jimp's full mutable bitmap
and intermediate allocations make ordinary upload normalization consume far
more memory than the final image requires. PureJsImage is intended to lower the
Lambda memory tier and out-of-memory risk by keeping working memory bounded by
the active rows, resize filter, and output dimensions wherever the codec allows
it. A pipeline is not considered fully optimized while its peak memory still
scales like a full source-resolution RGBA bitmap.

## Implementation status

The Phase 1 core and Phase 2-5 PNG/JPEG/GIF processing paths are implemented in strict TypeScript 7:

- bounded Buffer, Uint8Array, ArrayBuffer, Blob, and file sources;
- automatic PNG, JPEG, and GIF detection and metadata parsing;
- EXIF orientation and GIF frame metadata;
- configurable hostile-input limits;
- immutable crop, resize, orientation, and encode pipeline descriptions;
- pixel-block, buffer-pool, codec-registry, and sink abstractions;
- sequential, bounded-block PNG decoding for grayscale, truecolor, indexed,
  grayscale-alpha, and RGBA inputs;
- streaming PNG encoding with alpha preservation, adaptive row filtering, and
  compression levels 0-9;
- single-scan baseline JPEG decoding in bounded MCU rows;
- baseline JPEG encoding with quality control and deterministic alpha
  flattening (white by default);
- first-composited-frame GIF LZW decoding with global and local palettes,
  transparency, frame offsets, and interlacing;
- all eight EXIF orientation transforms, using a bounded disk-backed tile spool
  when output row order differs from input row order;
- fused PNG crop execution to Buffer or file output;
- nearest, bilinear, and Lanczos3 resize kernels with cached coefficients;
- separable horizontal resizing with bounded vertical source-row retention;
- width, height, fill, cover, contain, inside, outside, and
  `withoutEnlargement` geometry; and
- a dependency-free build with JavaScript and declaration output.

```ts
import { Image } from 'purejsimage'

const image = await Image.open('input.jpg')
const metadata = await image.metadata()

const planned = await image
  .autoOrient()
  .resize({ width: 1200, withoutEnlargement: true })
  .encode('jpeg', { quality: 80, background: '#ffffff' })
  .metadata()
```

The implemented PNG path can execute directly:

```ts
const output = await (await Image.open('input.png'))
  .resize({ width: 1000, kernel: 'bilinear' })
  .png({ compressionLevel: 6 })
  .toBuffer()
```

Metadata inspection and pipeline geometry are operational. Non-interlaced PNG,
baseline JPEG, and the first composited GIF frame can be cropped, resized, and
converted through PixelBlocks. GIF animation editing and encoding are outside
the V1 scope. Baseline JPEG decoding retains one MCU row of component samples
and emits only the requested crop region; it does not materialize a
source-sized RGB or RGBA bitmap. Progressive JPEG input and output are explicit
unsupported operations. Orientations that transpose or reverse row order use
temporary storage and bounded 32x32 pixel tiles instead of retaining the
decoded frame in memory. The temporary file is deleted when the pipeline
completes or aborts; its worst-case size is approximately the decoded pixel
area, shifted from scarce Lambda RAM to ephemeral storage.

## Northstar

Our northstar is to beat Jimp across a broad, reproducible benchmark suite while
successfully completing the same workflows and producing valid output.

A fast result is not a win if the output is unsupported or invalid. For each
workflow, PureJsImage must pass the same correctness checks as Jimp. Lower peak
RSS is the primary Lambda goal; a modest CPU regression is acceptable when it
buys a substantial memory-tier reduction, while speed remains an optimization
target.
For the primary Lambda downscale workflows, the stronger goal is for working
memory to remain bounded rather than scale with source bitmap area. A modest
percentage improvement over Jimp is progress, but not completion.

The baseline uses `jimp@1.6.0`, matching the version in Tooldesk when the suite
was created. It was recorded on August 6, 2026 using Node.js 24.16.0 on an Intel
Core i7-10700. Jimp passed all 23 original workflows. The dedicated PNG crop and
crop-plus-resize cases added since then bring the current suite to 25.

Phase 1 already passes the large-JPEG metadata workflow without decoding the
pixel bitmap:

| Implemented workflow | PureJsImage median | Jimp median | PureJsImage peak RSS | Jimp peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Large JPEG metadata | 0.2 ms | 5,285 ms | 97 MiB | 1,184 MiB |

See the [Phase 1 measurement](benchmark/results/purejsimage-phase1-metadata-2026-08-06.md).

The first Phase 2 comparisons validate output for both engines. PureJsImage is
2.4x faster than Jimp on the PNG crop round trip while using 29% less peak RSS;
the tiny palette round trip is tied on median time with lower peak RSS.

| Implemented workflow | PureJsImage median | Jimp median | PureJsImage peak RSS | Jimp peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Transparent PNG crop and re-encode | 20.8 ms | 49.5 ms | 97 MiB | 136 MiB |
| Palette PNG round trip | 1.1 ms | 1.1 ms | 86 MiB | 93 MiB |

See the [PNG crop measurement](benchmark/results/purejsimage-phase2-png-crop-2026-08-06.md)
and [palette measurement](benchmark/results/purejsimage-phase2-png-2026-08-06.md).

Phase 3 wins all six currently executable resize comparisons. Bilinear is the
default kernel; nearest and Lanczos3 are explicitly selectable. The
100-megapixel case is slightly faster than Jimp while reducing peak RSS by 86%.

| Implemented workflow | PureJsImage median | Jimp median | PureJsImage peak RSS | Jimp peak RSS |
| --- | ---: | ---: | ---: | ---: |
| 4000x3000 PNG to 1000 px | 638.5 ms | 868.4 ms | 140 MiB | 293 MiB |
| Transparent PNG resize | 38.2 ms | 68.7 ms | 110 MiB | 148 MiB |
| PNG crop and resize | 405.4 ms | 664.3 ms | 127 MiB | 292 MiB |
| Tooldesk PNG logo contain | 25.8 ms | 44.2 ms | 98 MiB | 143 MiB |
| Odd-dimension resize | 6.2 ms | 15.0 ms | 89 MiB | 104 MiB |
| 100-megapixel downscale | 3,560.7 ms | 3,777.8 ms | 174 MiB | 1,274 MiB |

See the [large PNG resize](benchmark/results/purejsimage-phase3-png-resize-2026-08-06.md),
[crop-plus-resize](benchmark/results/purejsimage-phase3-png-crop-resize-2026-08-06.md),
and [100-megapixel stress](benchmark/results/purejsimage-phase3-stress-100mp-2026-08-06.md)
measurements. The other Phase 3 reports are stored alongside them in
`benchmark/results/`.

Adaptive PNG filtering removed the initial output-size disadvantage without
giving up the measured speed or memory wins. The encoder evaluates PNG filters
0-4 per row while retaining only the previous unfiltered row.

| Workflow | Filter-0 output | Adaptive output | Jimp output | Adaptive PureJsImage median | Jimp median |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4000x3000 PNG to 1000 px | 2,068,955 B | 102,202 B | 775,919 B | 794.8 ms | 944.3 ms |
| PNG crop and resize | 611,057 B | 20,408 B | 164,105 B | 395.9 ms | 652.3 ms |
| Transparent PNG resize | 7,327 B | 6,756 B | 21,766 B | 49.7 ms | 84.6 ms |
| 100-megapixel downscale | 1,453,972 B | 16,698 B | 298,227 B | 3,547.5 ms | 3,732.5 ms |

See the adaptive-filter reports for the [large PNG](benchmark/results/purejsimage-adaptive-png-resize-2026-08-06.md),
[crop-plus-resize](benchmark/results/purejsimage-adaptive-png-crop-resize-2026-08-06.md),
[transparent PNG](benchmark/results/purejsimage-adaptive-png-alpha-resize-2026-08-06.md),
and [100-megapixel stress](benchmark/results/purejsimage-adaptive-stress-100mp-2026-08-06.md)
workflows.

Phase 4 implements first-party baseline JPEG decode and encode, quality control,
deterministic alpha flattening, and EXIF auto-orientation. The previous Phase 4
measurements used a conventional full-frame decoder and are not a valid result
for the Lambda memory northstar.

The initial JPEG memory results were an interim baseline, not the target
architecture. They exposed that a conventional full-frame decoder still made
peak RSS scale with source dimensions. The first-party baseline decoder now
processes one MCU row at a time. Current first-party measurements are recorded
below after validation.

| 4000x3000 JPEG to 1200px | PureJsImage median | Jimp median | PureJsImage peak RSS | Jimp peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Cold process | 1,829.6 ms | 1,471.2 ms | 95.7 MiB | 588.7 MiB |
| One warmup | 1,782.5 ms | 1,391.6 ms | 104.6 MiB | 594.6 MiB |

The first-party path currently uses about 84% less peak RSS in both modes. It
is 24% slower cold and 28% slower after one warmup, an acceptable tradeoff for
the Lambda memory reduction. CPU performance remains an optimization target,
but the bounded-memory architecture is the baseline.

The complete three-sample cold-process Phase 4 pass validates all 12 JPEG and
cross-format workflows. PureJsImage uses less peak RSS in every case, including
an 89% reduction for the primary 6000x4000 pipeline and a 91% reduction for
JPEG crop and resize.

| Workflow | PureJsImage median | Jimp median | PureJsImage peak RSS | Jimp peak RSS |
| --- | ---: | ---: | ---: | ---: |
| 6000x4000 northstar pipeline | 4,859.4 ms | 4,077.8 ms | 121.5 MiB | 1,112.4 MiB |
| JPEG crop and resize | 4,155.0 ms | 3,043.1 ms | 110.9 MiB | 1,190.3 MiB |
| Tooldesk JPEG upload | 1,707.6 ms | 1,498.7 ms | 96.8 MiB | 601.6 MiB |
| Tooldesk PNG upload to JPEG | 1,314.4 ms | 2,022.2 ms | 108.9 MiB | 298.7 MiB |
| EXIF orientation 6 | 694.9 ms | 601.4 ms | 92.8 MiB | 193.7 MiB |
| High-entropy PNG to JPEG | 1,393.4 ms | 1,414.3 ms | 130.5 MiB | 377.0 MiB |

See the [complete Phase 4 report](benchmark/results/purejsimage-phase4-first-party-cold-2026-08-06.md)
and the dedicated [warm JPEG resize report](benchmark/results/purejsimage-first-party-jpeg-resize-warm-2026-08-06.md).

Phase 5 makes JPEG→PNG, PNG→JPEG, and first-frame GIF→PNG/JPEG first-class.
All five measured workflows pass. PureJsImage uses less peak RSS in every case;
the Tooldesk GIF upload normalization is 22% faster with 26% less peak RSS.

| Workflow | PureJsImage median | Jimp median | PureJsImage peak RSS | Jimp peak RSS |
| --- | ---: | ---: | ---: | ---: |
| JPEG to PNG | 722.3 ms | 722.5 ms | 93.5 MiB | 251.5 MiB |
| PNG to JPEG | 107.3 ms | 208.5 ms | 111.0 MiB | 143.8 MiB |
| Animated GIF first frame to PNG | 24.1 ms | 11.1 ms | 83.8 MiB | 94.7 MiB |
| Tooldesk GIF upload to JPEG | 80.5 ms | 103.5 ms | 97.5 MiB | 130.9 MiB |
| Tooldesk GIF logo normalization | 39.2 ms | 27.5 ms | 86.9 MiB | 94.9 MiB |

See the [complete Phase 5 report](benchmark/results/purejsimage-phase5-first-party-cold-2026-08-06.md).

| Workflow | Jimp median wall time | Jimp peak RSS |
| --- | ---: | ---: |
| Large JPEG metadata | 5,285 ms | 1,184 MiB |
| Large JPEG resize to 1200 px | 1,462 ms | 594 MiB |
| Orient, crop, resize, and encode | 3,708 ms | 1,187 MiB |
| JPEG crop and resize | 2,943 ms | 1,197 MiB |
| PNG resize to 1000 px | 872 ms | 299 MiB |
| Transparent PNG resize | 74 ms | 137 MiB |
| JPEG to PNG | 677 ms | 263 MiB |
| PNG to JPEG | 209 ms | 179 MiB |
| EXIF orientation 6 | 643 ms | 253 MiB |
| GIF first frame to PNG | 4.6 ms | 95 MiB |
| Palette PNG round trip | 1.5 ms | 93 MiB |
| 16-bit grayscale PNG to JPEG | 8.0 ms | 127 MiB |
| Tooldesk JPEG upload to 1024 px | 1,392 ms | 610 MiB |
| Tooldesk PNG upload to 2048 px | 1,974 ms | 338 MiB |
| Tooldesk GIF upload without enlargement | 106 ms | 154 MiB |
| Tooldesk JPEG logo normalization | 863 ms | 437 MiB |
| Tooldesk PNG logo normalization | 41.5 ms | 125 MiB |
| Tooldesk GIF logo normalization | 21.6 ms | 96 MiB |
| Odd-dimension resize | 13.4 ms | 101 MiB |
| Tiny transparent image to JPEG | 5.6 ms | 125 MiB |
| High-entropy PNG to JPEG | 1,450 ms | 431 MiB |
| 100-image thumbnail batch | 72.7 s | 604 MiB |
| 100-megapixel PNG downscale | 3,710 ms | 1,272 MiB |

The suite contains 25 workflows covering real photographs, JPEG and PNG
conversion, transparency, EXIF orientation, palette and 16-bit PNGs, GIF first
frames, odd and tiny dimensions, high-entropy images, Tooldesk's current image
workflows, batching, and a 100-megapixel stress case.

See the [complete baseline](benchmark/results/jimp-baseline-2026-08-06.md),
[raw measurements](benchmark/results/jimp-baseline-2026-08-06.json), and
[benchmark methodology](benchmark/README.md).

## Zero runtime dependencies

PureJsImage has a hard production constraint: installing it must install only
PureJsImage. The published package will declare no runtime `dependencies`, and
it will not require native addons, external binaries, or system image libraries.
Codecs and processing code needed by the supported package will ship as part of
the package itself.

Jimp remains the portability reference because it is pure JavaScript and avoids
native system dependencies. Its direct runtime packages are primarily internal
modules from the same Jimp monorepo, published separately as a logical and
packaging distinction. PureJsImage instead ships one npm package with no
production dependency tree.

Production codecs and processing code are implemented in this repository; the
package does not vendor or runtime-import third-party implementations.
Development-only libraries such as `jpeg-js` and `omggif` are permitted solely
as independent correctness and benchmark oracles and are never copied into the
published package.

Libraries used to build fixtures, validate output, and run the Jimp comparison
are development dependencies only. They are not part of the PureJsImage runtime
or its eventual installed dependency tree.

## Run the benchmark

```sh
npm run fixtures:prepare
npm run fixtures:verify
npm run bench:jimp -- --profile full
```

Once PureJsImage has an executable build:

```sh
PUREJSIMAGE_ENTRY=./dist/index.js npm run bench -- --engines jimp,purejsimage
```

The project architecture and scope are described in
[project-spec.md](project-spec.md).

## Development

All source, benchmark, script, and test code is TypeScript checked in strict
mode. The repository uses Biome for linting and formatting and Vitest for tests.
Run the complete local quality gate with:

```sh
npm run check
```

Individual commands are also available:

```sh
npm run lint
npm run format
npm run typecheck
npm test
npm run test:watch
```

See [AGENTS.md](AGENTS.md) for the repository's coding, testing, and performance
rules.
