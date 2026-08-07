# PureJsImage

PureJsImage is a dependency-free image processing library written in strict
TypeScript. It is designed for serverless workloads where memory pressure,
startup portability, and predictable behavior matter as much as raw speed.

The original motivation was AWS Lambda: common Jimp workflows often retain a
full source bitmap and large intermediate buffers. PureJsImage instead aims to
decode, resize, and encode with bounded working memory wherever the codec
allows it.

## Install

```sh
npm install purejsimage
```

PureJsImage requires Node.js 24 or newer. Installing it will install one
package: there are no runtime dependencies, native addons, external binaries,
or WebAssembly modules.

The opt-in all-codec runtime bundles to **264.7 KiB** minified, **89.4 KiB**
with gzip, or **72.7 KiB** with Brotli. Applications import only the codecs
they use, so a normal root import does not pull AVIF, HEIF/HEVC, or any other
codec implementation into the module graph.

## Supported codecs

| Codec | Decode | Encode |
| --- | --- | --- |
| PNG | Grayscale, RGB, indexed, alpha, and Adam7 interlace | Yes |
| JPEG | Baseline and progressive | Baseline |
| GIF | First composited frame | No |
| WebP | Static lossy, lossless, and alpha | Static lossy and lossless |
| BMP | Indexed, RLE, RGB, bitfields, and alpha | RGB and RGBA |
| TIFF | Common strip-based grayscale, indexed, RGB, and alpha | Uncompressed grayscale, RGB, and RGBA |
| AVIF | Opaque 8-bit YUV 4:2:0 still-image subset | No |
| HEIF / HEIC | Opaque Main / Main Still Picture 8-bit YUV 4:2:0 intra stills, including grids | No |

AVIF support is still expanding. Metadata inspection covers a much broader set
of AVIF files than pixel decoding, while alpha, grids, high bit depth, in-loop
filter application, and encoding remain unfinished. HEIF/HEIC support decodes
the common opaque Main / Main Still Picture 8-bit YUV 4:2:0 intra subset through the normal
pipeline. Direct `hvc1` images and grid primary images are supported with clean
aperture, mirror/rotation metadata, limited/full-range nclx matrix conversion,
and bounded RGBA row output. The first-party HEVC path includes CABAC, coding
and transform trees, intra prediction, residual reconstruction, deblocking,
and SAO. WPP entry points, scaling lists, and CU-level QP deltas used by Apple
Main Still Picture tiles are included. Files that require multiple slices or
tiles inside one coded picture, auxiliary alpha, or HDR/Main 10 features still
fail explicitly.

Detailed capability checklists:
[PNG](https://github.com/a-r-d/PureJsImage/blob/main/png-codec-support.md),
[JPEG](https://github.com/a-r-d/PureJsImage/blob/main/jpeg-codec-support.md),
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

To enable every supported codec explicitly, use the separate all-codec entry
point:

```ts
import { createImageLibrary } from 'purejsimage'
import { allCodecs } from 'purejsimage/codecs/all'

const images = createImageLibrary(allCodecs)
```

Individual codec entry points are available at `purejsimage/codecs/jpeg`,
`png`, `gif`, `webp`, `bmp`, `tiff`, `avif`, and `heif`. The `allCodecs` entry
point is the only convenience module that imports every implementation. HEVC
code is reachable only through `purejsimage/codecs/heif` or `codecs/all`.

Inputs can be file paths, `Buffer`, `Uint8Array`, `ArrayBuffer`, or `Blob`.
Pipelines are immutable and can output a `Buffer` or write directly to a file.

## Goals

- Keep peak memory low enough for practical AWS Lambda image processing.
- Avoid source-sized RGBA bitmaps when a bounded codec path is possible.
- Ship as one portable npm package with zero runtime dependencies.
- Implement codecs in first-party strict TypeScript—no native modules or WASM.
- Reject malformed or unsupported input explicitly.
- Match or beat Jimp on validated production workflows. A modest CPU cost is
  acceptable when it produces a large memory reduction.

## Benchmarks against Jimp

Benchmarks use `jimp@1.6.0`. A timing only counts when the output passes the
same validity and correctness checks for both engines.

| Workflow | PureJsImage | Jimp | PureJsImage peak RSS | Jimp peak RSS |
| --- | ---: | ---: | ---: | ---: |
| 6000x4000 orient, crop, resize, JPEG | 3,243 ms | 3,763 ms | 119 MiB | 1,188 MiB |
| JPEG crop and resize | 2,554 ms | 2,868 ms | 121 MiB | 1,197 MiB |
| 100-megapixel PNG downscale | 3,548 ms | 3,733 ms | 174 MiB | 1,274 MiB |
| 4000x3000 PNG resize | 795 ms | 944 ms | 138 MiB | 301 MiB |
| 4000x3000 BMP resize to JPEG | 284 ms | 719 ms | 158 MiB | 262 MiB |
| Large TIFF resize to JPEG | 686 ms | 639 ms | 164 MiB | 319 MiB |
| 4032x3024 iPhone HEIC, orient and resize to 1200px JPEG | 8,080 ms | Unsupported | 190 MiB | — |

The primary 6000x4000 workflow currently uses about **90% less peak memory**
than Jimp while running about 14% faster. The 100-megapixel PNG workflow uses
about **86% less peak memory** and is slightly faster.

The HEIC result is a PureJsImage-only absolute baseline because Jimp 1.6 has
no HEIC decoder. It uses an original iPhone 12 Pro camera file, runs in an
isolated cold process, and counts only after the JPEG passes independently
pinned pixel checks.

See the
[detailed benchmarks](https://github.com/a-r-d/PureJsImage/blob/main/benchmarks.md)
for methodology, codec-specific results, absolute WebP, AVIF, and HEIF measurements,
and links to the raw reports.

## Development

The repository uses TypeScript strict mode, Biome, and Vitest.

```sh
npm install
npm run check
```

See the
[project specification](https://github.com/a-r-d/PureJsImage/blob/main/project-spec.md)
for the architecture and implementation principles.
