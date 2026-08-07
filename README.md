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

The complete v0.1.0 runtime, including every codec, bundles to **264.7 KiB**
minified, **89.4 KiB** with gzip, or **72.7 KiB** with Brotli. These are
worst-case all-codec sizes; future per-codec entry points and lazy codec
registration can make bundles smaller when an application only needs a few
formats.

## Supported codecs

| Codec | Decode | Encode |
| --- | --- | --- |
| PNG | Grayscale, RGB, indexed, and alpha | Yes |
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

Open a file and inspect it without decoding all its pixels:

```ts
import { Image } from 'purejsimage'

const image = await Image.open('input.jpg')
const metadata = await image.metadata()

console.log(metadata.width, metadata.height, metadata.format)
```

Normalize an upload for the web:

```ts
const image = await Image.open('input.jpg')

const output = await image
  .autoOrient()
  .resize({ width: 1200, withoutEnlargement: true })
  .jpeg({ quality: 80, background: '#ffffff' })
  .toBuffer()
```

Crop, resize, and write another format:

```ts
const image = await Image.open('input.png')

await image
  .crop({ x: 100, y: 50, width: 800, height: 600 })
  .resize({ width: 400, kernel: 'lanczos3' })
  .webp({ quality: 80 })
  .toFile('output.webp')
```

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
| 6000x4000 orient, crop, resize, JPEG | 4,859 ms | 4,078 ms | 122 MiB | 1,112 MiB |
| JPEG crop and resize | 4,155 ms | 3,043 ms | 111 MiB | 1,190 MiB |
| 100-megapixel PNG downscale | 3,548 ms | 3,733 ms | 174 MiB | 1,274 MiB |
| 4000x3000 PNG resize | 795 ms | 944 ms | 138 MiB | 301 MiB |
| 4000x3000 BMP resize to JPEG | 284 ms | 719 ms | 158 MiB | 262 MiB |
| Large TIFF resize to JPEG | 686 ms | 639 ms | 164 MiB | 319 MiB |

The primary 6000x4000 workflow currently uses about **89% less peak memory**
than Jimp while running about 19% slower. The 100-megapixel PNG workflow uses
about **86% less peak memory** and is slightly faster.

See the
[detailed benchmarks](https://github.com/a-r-d/PureJsImage/blob/main/benchmarks.md)
for methodology, codec-specific results, absolute WebP and AVIF measurements,
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
