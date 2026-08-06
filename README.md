# PureJsImage

PureJsImage aims to be the smallest, fastest, and lowest-memory practical
alternative to Jimp for common image-processing workflows, implemented entirely
in JavaScript.

The project focuses on complete application workflows—decode, inspect, orient,
crop, resize, convert, and encode—rather than trying to reproduce every image
editing feature in Jimp.

## Implementation status

Phase 1 of the production library is implemented in strict TypeScript 7:

- bounded Buffer, Uint8Array, ArrayBuffer, Blob, and file sources;
- automatic PNG, JPEG, and GIF detection and metadata parsing;
- EXIF orientation and GIF frame metadata;
- configurable hostile-input limits;
- immutable crop, resize, orientation, and encode pipeline descriptions;
- pixel-block, buffer-pool, codec-registry, and sink abstractions; and
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

Metadata inspection and pipeline geometry are operational. Pixel decoding and
encoding intentionally remain explicit unsupported operations until the Phase 2
PNG vertical slice is implemented.

## Northstar

Our northstar is to beat Jimp across a broad, reproducible benchmark suite while
successfully completing the same workflows and producing valid output.

A fast result is not a win if the output is unsupported or invalid. For each
workflow, PureJsImage must pass the same correctness checks as Jimp and then
improve its median wall time. Lower peak RSS is the primary memory goal.

The baseline uses `jimp@1.6.0`, matching the version in Tooldesk when the suite
was created. It was recorded on August 6, 2026 using Node.js 24.16.0 on an Intel
Core i7-10700. Jimp passed all 23 workflows.

Phase 1 already passes the large-JPEG metadata workflow without decoding the
pixel bitmap:

| Implemented workflow | PureJsImage median | Jimp median | PureJsImage peak RSS | Jimp peak RSS |
| --- | ---: | ---: | ---: | ---: |
| Large JPEG metadata | 0.2 ms | 5,285 ms | 97 MiB | 1,184 MiB |

See the [Phase 1 measurement](benchmark/results/purejsimage-phase1-metadata-2026-08-06.md).

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

The suite contains 23 workflows covering real photographs, JPEG and PNG
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
packaging distinction. PureJsImage will keep the same self-contained source
ownership while shipping it as one npm package with no production dependency
tree.

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
