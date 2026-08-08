<div align="center">
<pre>
██████╗ ██╗   ██╗██████╗ ███████╗         ██╗███████╗
██╔══██╗██║   ██║██╔══██╗██╔════╝         ██║██╔════╝
██████╔╝██║   ██║██████╔╝█████╗           ██║███████╗
██╔═══╝ ██║   ██║██╔══██╗██╔══╝      ██   ██║╚════██║
██║     ╚██████╔╝██║  ██║███████╗     ╚█████╔╝███████║
╚═╝      ╚═════╝ ╚═╝  ╚═╝╚══════╝      ╚════╝ ╚══════╝
                         I M A G E
</pre>

<h3>Fast, low-memory image processing in pure TypeScript</h3>

<p>First-party codecs · zero runtime dependencies · built for Lambda and portable runtimes</p>

<p>
  <a href="https://www.npmjs.com/package/purejsimage"><img alt="npm version" src="https://img.shields.io/npm/v/purejsimage?style=for-the-badge&amp;logo=npm&amp;logoColor=white&amp;color=cb3837"></a>
  <a href="https://github.com/a-r-d/PureJsImage/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/a-r-d/PureJsImage/ci.yml?branch=main&amp;style=for-the-badge&amp;logo=githubactions&amp;logoColor=white&amp;label=CI"></a>
  <a href="https://github.com/a-r-d/PureJsImage/blob/main/package.json"><img alt="TypeScript version" src="https://img.shields.io/github/package-json/dependency-version/a-r-d/PureJsImage/dev/typescript?style=for-the-badge&amp;logo=typescript&amp;logoColor=white"></a>
  <a href="https://www.npmjs.com/package/purejsimage"><img alt="Node.js version" src="https://img.shields.io/node/v/purejsimage?style=for-the-badge&amp;logo=nodedotjs&amp;logoColor=white"></a>
</p>

<p>
  <a href="https://github.com/a-r-d/PureJsImage/blob/main/package.json"><img alt="Zero runtime dependencies" src="https://img.shields.io/badge/runtime_dependencies-0-2ea44f?style=for-the-badge"></a>
  <a href="#bundle-size"><img alt="Core bundle Brotli size" src="https://img.shields.io/badge/core_Brotli-11.1_KiB-6f42c1?style=for-the-badge"></a>
  <a href="https://github.com/a-r-d/PureJsImage/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/purejsimage?style=for-the-badge&amp;color=blue"></a>
  <a href="https://github.com/a-r-d/PureJsImage"><img alt="Pure JavaScript core" src="https://img.shields.io/badge/core-pure_JS-f7df1e?style=for-the-badge&amp;logo=javascript&amp;logoColor=black"></a>
</p>

<p>
  <a href="https://a-r-d.github.io/PureJsImage/">Documentation</a> ·
  <a href="#install">Install</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#supported-codecs">Codecs</a> ·
  <a href="ROADMAP.md">Roadmap</a> ·
  <a href="#benchmarks">Benchmarks</a>
</p>
</div>

PureJsImage is a dependency-free image processing library written in strict
TypeScript. The same first-party codec and pipeline core runs in Node.js and
modern browsers, with small platform adapters for files, compression, output,
and bounded temporary storage.

The original motivation was AWS Lambda: common Jimp workflows often retain a
full source bitmap and large intermediate buffers. PureJsImage instead aims to
decode, resize, and encode with bounded working memory wherever the codec
allows it.

## Install

```sh
npm install purejsimage
```

The Node entry requires Node.js 22 or newer. Browser applications use the
explicit `purejsimage/browser` entry (modern bundlers may also select the
package browser condition). Installing it adds no runtime dependencies, native
addons, external binaries, or WebAssembly modules.

### Bundle size

Bundle sizes are built and measured from the current strict TypeScript source
with esbuild minification, gzip level 9, and Brotli quality 11.

| Entry | Minified | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Core API | 36.9 KiB | 12.5 KiB | 11.1 KiB |
| Core + PNG | 64.1 KiB | 21.8 KiB | 19.1 KiB |
| Core + JPEG | 79.9 KiB | 26.9 KiB | 23.0 KiB |
| Core + JPEG 2000 | 72.7 KiB | 24.0 KiB | 21.0 KiB |
| Core + WebP | 86.3 KiB | 30.9 KiB | 26.6 KiB |
| Core + all codecs | 427.9 KiB | 144.7 KiB | 116.1 KiB |

Run `npm run size` to reproduce these numbers and see every codec entry.
Applications import only the codecs they use, so the root API does not pull
AVIF, HEIF/HEVC, or any other codec implementation into the module graph.

## Supported codecs

| Codec | Decode | Encode |
| --- | --- | --- |
| PNG | Grayscale, RGB, indexed, alpha, and Adam7 interlace | Yes |
| JPEG | Baseline and progressive | Baseline |
| JPEG 2000 / JP2 | Part 1 grayscale and RGB, reversible 5/3 and irreversible 9/7 | No |
| GIF | First composited frame | No |
| WebP | Static lossy, lossless, and alpha | Static lossy and lossless |
| BMP | Indexed, RLE, RGB, bitfields, and alpha | RGB and RGBA |
| ICO | Multi-image PNG and common DIB-backed Windows icons | No |
| TIFF | Classic/BigTIFF strips and tiles; grayscale, indexed, RGB, CMYK, YCbCr, alpha, fax, and JPEG compression | Uncompressed grayscale, RGB, and RGBA |
| AVIF | Opaque 8-bit YUV 4:2:0 still-image subset | No |
| HEIF / HEIC | Opaque 8/10-bit YUV 4:2:0 intra stills, including grids | No |

JPEG 2000 decoding is currently a full-frame memory fallback. A measured
1920x2172 JP2 resize reached 191.8 MiB cold and 211.0 MiB warm absolute peak
RSS, so it is not safe for a 256 MiB Lambda tier after normal runtime headroom
or concurrency. Use at least a 512 MiB tier for comparable inputs, or lower
`maxPixels` and `maxDecodedBytes`. See the
[reproducible RSS report](benchmark/results/jpeg2000-real-world-rss-2026-08-08.md).

AVIF support is still expanding. Metadata inspection covers a much broader set
of AVIF files than pixel decoding, while alpha, grids, high bit depth, in-loop
filter application, and encoding remain unfinished. HEIF/HEIC support decodes
the common opaque Main / Main Still Picture 8-bit and Main 10 10-bit YUV 4:2:0
intra subsets through the normal pipeline. Direct `hvc1` images and grid primary
images are supported with clean aperture, mirror/rotation metadata,
limited/full-range nclx matrix conversion, PQ/HLG-to-sRGB tone mapping, and
bounded RGBA row output. The first-party HEVC path includes CABAC, coding
and transform trees, intra prediction, residual reconstruction, deblocking,
and SAO. WPP entry points, scaling lists, and CU-level QP deltas used by Apple
Main Still Picture tiles are included. Files that require multiple slices or
tiles inside one coded picture, auxiliary alpha, or HDR gain-map reconstruction
still fail explicitly.

Detailed capability checklists:
[PNG](https://github.com/a-r-d/PureJsImage/blob/main/png-codec-support.md),
[JPEG](https://github.com/a-r-d/PureJsImage/blob/main/jpeg-codec-support.md),
[JPEG 2000](https://github.com/a-r-d/PureJsImage/blob/main/jpeg2000-codec-support.md),
[GIF](https://github.com/a-r-d/PureJsImage/blob/main/gif-codec-support.md),
[WebP](https://github.com/a-r-d/PureJsImage/blob/main/webp-codec-support.md),
[BMP](https://github.com/a-r-d/PureJsImage/blob/main/bmp-codec-support.md),
[TIFF](https://github.com/a-r-d/PureJsImage/blob/main/tiff-codec-support.md),
[AVIF](https://github.com/a-r-d/PureJsImage/blob/main/avif-codec-support.md), and
[HEIF](https://github.com/a-r-d/PureJsImage/blob/main/heif-codec-support.md).

## Usage

Create one library instance with the codecs your application accepts. Importing
the root package alone includes no image codecs:

```ts
import { createImageLibrary } from 'purejsimage'
import { jpegCodec } from 'purejsimage/codecs/jpeg'
import { pngCodec } from 'purejsimage/codecs/png'

const images = createImageLibrary([jpegCodec, pngCodec])
```

### Browser usage

Use the browser entry for DOM-native input and output. A browser `File` is a
`Blob`, so file inputs, drag-and-drop items, fetched blobs, `ArrayBuffer`,
`Uint8Array`, and custom range sources all use the same pipeline:

```ts
import { createImageLibrary } from 'purejsimage/browser'
import { jpegCodec } from 'purejsimage/codecs/jpeg'
import { pngCodec } from 'purejsimage/codecs/png'

const images = createImageLibrary([jpegCodec, pngCodec])
const image = await images.open(file)

const output = await image
  .autoOrient()
  .resize({ width: 1200, withoutEnlargement: true })
  .jpeg({ quality: 80, background: '#ffffff' })
  .toBlob()

const previewUrl = URL.createObjectURL(output)
```

Use `toUint8Array()` for encoded bytes or `toSink()` for a custom streaming
destination. Browsers cannot open arbitrary local path strings; use a `File`,
`Blob`, fetched bytes, or a custom `ImageSource`. `toFile(path)` remains a Node
API.

PNG encoding in browsers uses `CompressionStream` and currently supports the
default `compressionLevel: 6`; other levels fail explicitly because the browser
API does not expose compression tuning.

The real-browser suite is pinned to Playwright's Chromium 151.0.7922.34,
Firefox 153.0, and WebKit 26.5 builds. See
[`browser-support.md`](browser-support.md) for exact compatibility coverage,
commands, CI gates, and the Chromium-only performance methodology.

Create the library once and reuse it across requests. Codec registration is
immutable after initialization.

Each conversion needs the input decoder and output encoder. For example, the
library above can read JPEG or PNG and can encode either format. A missing
codec fails explicitly instead of loading one dynamically.

Open a file and inspect it without decoding all its pixels:

```ts
const image = await images.open('input.jpg')

const metadata = await image.metadata()

console.log(metadata.width, metadata.height, metadata.format)
```

Normalize an upload for the web:

```ts
const image = await images.open('input.jpg')

const output = await image
  .autoOrient()
  .resize({ width: 1200, withoutEnlargement: true })
  .jpeg({ quality: 80, background: '#ffffff' })
  .toBuffer()
```

Crop, resize, and write another format:

```ts
import { createImageLibrary } from 'purejsimage'
import { pngCodec } from 'purejsimage/codecs/png'
import { webpCodec } from 'purejsimage/codecs/webp'

const webImages = createImageLibrary([pngCodec, webpCodec])
const image = await webImages.open('input.png')

await image
  .crop({ x: 100, y: 50, width: 800, height: 600 })
  .resize({ width: 400, kernel: 'lanczos3' })
  .webp({ quality: 80 })
  .toFile('output.webp')
```

Spatial operations run in call order, so multiple resize stages and crops after a resize are
supported. `rotate()` uses clockwise degrees, accepts arbitrary angles, and expands the output
canvas; `flip()` mirrors top-to-bottom and `flop()` mirrors left-to-right.

```ts
const output = await image
  .resize({ width: 800 })
  .crop({ x: 40, y: 20, width: 640, height: 480 })
  .rotate(12, { background: '#ffffffff' })
  .flop()
  .jpeg({ quality: 82 })
  .toBuffer()
```

EXIF and ICC data are stripped by default. Opt in independently with `keepExif()` and
`keepIcc()`. When ICC is retained, decoding leaves the tagged samples in their source color space
and the output encoder embeds the original profile, avoiding a double conversion. Pixel
reorientation through `autoOrient()`, `rotate()`, `flip()`, or `flop()` normalizes the retained EXIF
orientation to 1.

JPEG, PNG, WebP, and HEIF/HEIC can read retained EXIF and RGB ICC metadata; the selected output
codec must also support writing it. TIFF can read and write compatible ICC profiles, but retaining
EXIF into or out of TIFF is not implemented. BMP cannot carry either through this API. Unsupported
source or output combinations fail explicitly instead of silently stripping requested metadata.

`metadata().colorSpace` remains a compact compatibility label. HEIF and AVIF additionally expose
`colorProfile`: ICC profiles report a validated description when present, while nclx profiles
report their numeric primaries, transfer characteristics, matrix coefficients, and range.

To enable every supported codec explicitly, use the separate all-codec entry
point:

```ts
import { createImageLibrary } from 'purejsimage'
import { allCodecs } from 'purejsimage/codecs/all'

const images = createImageLibrary(allCodecs)
```

Individual codec entry points are available at `purejsimage/codecs/jpeg`,
`jpeg2000`, `png`, `gif`, `webp`, `bmp`, `tiff`, `avif`, and `heif`. The `allCodecs` entry
point is the only convenience module that imports every implementation. HEVC
code is reachable only through `purejsimage/codecs/heif` or `codecs/all`.

The initial JP2 decoder is an explicit full-frame fallback. It supports common
Part 1 still images, but does not yet provide reduced-resolution or crop-aware
entropy decode, palette/component mapping, alpha channels, ICC color, or
encoding. Unsupported color, channel-mapping, and coding inputs fail explicitly;
ordinary crop and resize workflows currently use the documented full-frame path.

Node inputs can be file paths, `Buffer`, `Uint8Array`, `ArrayBuffer`, `Blob`, or
a custom `ImageSource`, with Buffer and direct-file output. Browser inputs can
be `File`/`Blob`, `Uint8Array`, `ArrayBuffer`, or a custom `ImageSource`, with
`Uint8Array`, `Blob`, or custom-sink output.

`Buffer`, `Uint8Array`, and `ArrayBuffer` inputs are borrowed without copying to keep peak memory
bounded. Do not mutate or detach them until every pipeline created from the image has finished.
Custom `ImageSource.read()` implementations must return exactly the requested in-range byte count
as a `Uint8Array`, or reject when the backing read fails. Results may be reused or invalidated when
the next read starts; codecs copy only the bytes they need to retain across reads. Short, oversized,
detached, and rejected custom reads become `ImageError` results. File, `Blob`, and custom source
inputs are lazily cached in up to four aligned 256 KiB regions, bounding cache memory to 1 MiB while
coalescing small codec reads and remote range requests. In-memory inputs retain their zero-copy path.

The default `maxInputBytes` limit is 128 MiB, so very large ProRAW/DNG files or burst containers are
rejected with `LIMIT_EXCEEDED` before their contents are read. Raise that limit explicitly only when
the surrounding service can safely accept larger uploads. The default `maxDecodedBytes` limit is
1 GiB and is also enforced while compressed image data is streaming, rather than only from declared
header dimensions. Both limits can be overridden through `open(input, { limits: { ... } })`.

### Temporary storage for orientation and rotation

EXIF orientations 3 through 8 and arbitrary-angle rotations require output rows in a different
order from a sequential decoder. PureJsImage keeps memory bounded by spooling 32x32 pixel tiles to a
runtime temporary store. Node uses a temporary file under `os.tmpdir()` and removes the temporary directory on success or failure. Plan
for roughly one decoded frame of temporary disk capacity: a 100-megapixel RGBA image needs about
400 MB, including small tile-edge padding. On AWS Lambda this consumes the function's configured
`/tmp` storage. Modern browsers use origin-private file storage when available, then use a lazy
chunked-memory store for images requiring at most 64 MiB of tile storage. This keeps ordinary
12-megapixel RGBA photos working without allocating the full 64 MiB up front. Larger transforms
fall back to a temporary chunked IndexedDB store, allowing 12–48-megapixel transforms without a
source-sized heap allocation. They fail explicitly only when neither persistent browser store is
available.
Exhausted or unavailable temporary storage fails with an `ImageError`; capacity errors such as
`ENOSPC` use `LIMIT_EXCEEDED`.

For 90-degree orientations 6 and 8, each destination row depends on one pixel from every source row.
A column buffer therefore cannot feed the existing row-oriented encoders until the complete source
has arrived without growing to a source-sized bitmap. The tile spool is the bounded-memory fallback
until decoder or encoder boundaries can carry transposed tiles directly.

## Goals

- Keep peak memory low enough for practical AWS Lambda image processing.
- Avoid source-sized RGBA bitmaps when a bounded codec path is possible.
- Ship as one portable npm package with zero runtime dependencies, with tested
  Node.js and modern-browser entries over one codec and pipeline core.
- Keep the reference codecs in first-party strict TypeScript with no required
  native modules or WASM.
- Reject malformed or unsupported input explicitly.
- Match or beat Jimp on validated production workflows. A modest CPU cost is
  acceptable when it produces a large memory reduction.

## Roadmap

PureJsImage has a deliberate two-layer roadmap:

| Now: reference engine | Next: optional acceleration |
| --- | --- |
| Fast, low-memory codec implementations written in first-party strict TypeScript | Equivalent per-codec implementations written in Rust and compiled to WebAssembly |
| Broad format coverage with safe parsing and practical decode/encode subsets | Explicitly loaded accelerators that preserve the same API, limits, errors, and conformance corpus |
| Basic transforms including metadata, orientation, crop, resize, color conversion, and common encoders | Much faster execution where startup and deployment constraints make WASM a good tradeoff |

The pure-JavaScript implementation remains the portable reference and fallback;
WASM will never be required or downloaded implicitly. Every mature reference
codec is intended to gain an optional Rust/WASM acceleration path, ordered by
measured user impact.

See the [project roadmap](ROADMAP.md) for milestones, invariants, and current
priorities.

## Benchmarks

The competitor profile compares PureJsImage with Jimp, Sharp, Sharp configured
for one processing thread, and image-js. Sharp uses native libvips code; the
other engines shown here are pure JavaScript. Every displayed timing passed the
same output-validation checks, and every engine ran in its own isolated worker
process.

[![Image workflow speed comparison. Sharp and Sharp single-thread use native libvips code.](benchmark/results/competitors-speed-2026-08-08.png)](benchmark/results/competitors-speed-2026-08-08.png)

[![Image workflow absolute peak memory comparison.](benchmark/results/competitors-memory-2026-08-08.png)](benchmark/results/competitors-memory-2026-08-08.png)

The speed chart uses a logarithmic scale because the validated timings span
roughly 0.2 ms to 4,000 ms. The memory chart shows median absolute peak RSS on a
linear scale. Timings include encoding, but lossy encoders do not share a
calibrated quality scale; compression quality and efficiency require a separate
matched-quality study. Run `npm run bench:competitors` to reproduce the report
and `npm run bench:competitors:charts` to regenerate the images.

### Jimp baseline

Benchmarks use `jimp@1.6.0`. A timing only counts when the output passes the
same validity and correctness checks for both engines.

| Workflow | PureJsImage | Jimp | PureJsImage peak RSS | Jimp peak RSS |
| --- | ---: | ---: | ---: | ---: |
| 6000x4000 orient, crop, resize, JPEG | 3,243 ms | 3,763 ms | 119 MiB | 1,188 MiB |
| JPEG crop and resize | 2,554 ms | 2,868 ms | 121 MiB | 1,197 MiB |
| 100-megapixel PNG downscale | 1,970 ms | 3,733 ms | 169 MiB | 1,274 MiB |
| 4000x3000 PNG resize | 496 ms | 944 ms | 142 MiB | 301 MiB |
| 4000x3000 BMP resize to JPEG | 149 ms | 719 ms | 153 MiB | 262 MiB |
| Large TIFF resize to JPEG | 109 ms | 639 ms | 133 MiB | 319 MiB |
| 1600x2000 WebP resize to JPEG | 508 ms | Unsupported | 179 MiB | — |
| 96x96 ICO resize to 192px JPEG | 14 ms | Unsupported | 95 MiB | — |
| JPEG to lossy WebP | 980 ms | Unsupported | 124 MiB | — |
| PNG to lossless WebP | 56 ms | Unsupported | 115 MiB | — |
| 4032x3024 iPhone HEIC, orient and resize to 1200px JPEG | 8,080 ms | Unsupported | 190 MiB | — |

The ordered transform planner also has isolated, correctness-gated
transform-to-JPEG comparisons. These measurements use three runs after one
warmup on an Intel i7-10700 with Node 24.16.0:

| Workflow | PureJsImage | Jimp | Faster | PureJsImage peak RSS | Jimp peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4000x3000 JPEG, rotate 90 degrees, resize to 1200px, JPEG | 1,795 ms | 2,052 ms | 12% | 175 MiB | 609 MiB |
| 4000x3000 JPEG, resize, crop, resize again, JPEG | 952 ms | 1,434 ms | 34% | 121 MiB | 584 MiB |
| 257x193 RGBA PNG, flip, flop, flatten to JPEG | 22 ms | 70 ms | 68% | 101 MiB | 153 MiB |

PureJsImage's 17-degree RGBA rotation and JPEG flattening takes 254 ms with
141 MiB peak RSS. It is not presented as a Jimp speed comparison because Jimp
uses a 1290x812 canvas and different sampling semantics for the same input and
angle, while PureJsImage produces 1288x810.

The primary 6000x4000 workflow currently uses about **90% less peak memory**
than Jimp while running about 14% faster. The 100-megapixel PNG workflow uses
about **87% less peak memory** and is 47% faster. The 4000x3000 PNG resize is
47% faster, while the large TIFF resize is 83% faster and uses 58% less peak
memory. The 4000x3000 BMP resize is 79% faster and uses 42% less peak memory.

The WebP, ICO, and HEIC results are PureJsImage-only absolute baselines because
Jimp 1.6 does not expose those codecs. The HEIC workflow uses an original iPhone
12 Pro camera file. Every workflow runs in an isolated process and counts only
after the output passes its pinned validation checks. For lossy WebP encode,
validation runs in a separate Sharp/libwebp process and checks decoded pixels;
the native oracle is not loaded into the measured PureJsImage process.

See the
[detailed benchmarks](https://github.com/a-r-d/PureJsImage/blob/main/benchmarks.md)
for methodology, codec-specific results, absolute WebP, ICO, AVIF, and HEIF
measurements, and links to the raw reports.

## Development

The repository uses TypeScript strict mode, Biome, and Vitest.

```sh
npm install
npm run check
```

See the
[project specification](https://github.com/a-r-d/PureJsImage/blob/main/project-spec.md)
for the architecture and implementation principles.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution requirements, tests,
benchmarks, modular feature guidance, and the pull-request checklist.
