# Gain-map HDR images

## Quick answer

Import `openGainMapImage()` from `purejsimage/hdr` when you need to inspect, render, transform, or
write an Ultra HDR or ISO 21496-1 gain-map image. The regular JPEG API still decodes the SDR primary
image. The regular AVIF API keeps its established display policy.

```ts
import { openGainMapImage } from 'purejsimage/hdr'

const image = await openGainMapImage(input)
try {
  console.log(image.inspection().metadata)

  for await (const block of image.render({ displayBoost: 4 })) {
    // block.pixelFormat is rgbf32, or rgbaf32 when the base has alpha.
    consumeLinearHdrBlock(block)
  }

  const output = await image
    .crop({ x: 100, y: 50, width: 1200, height: 800 })
    .resize({ width: 600, height: 400, kernel: 'lanczos3' })
    .jpeg({ metadataMode: 'dual', baseQuality: 90, gainMapQuality: 92 })
} finally {
  image.close()
}
```

`render()` returns linear light values. Values above `1` are preserved. An 8-bit tone-mapped canvas
is an SDR preview and is not an HDR pixel result.

## Minimal Node.js and browser examples

Node.js can read and write files at the application boundary while the HDR API receives portable
bytes:

```ts
import { readFile, writeFile } from 'node:fs/promises'
import { openGainMapImage } from 'purejsimage/hdr'

const image = await openGainMapImage(new Uint8Array(await readFile('input.jpg')))
try {
  await writeFile('output.jpg', await image.resize({ width: 1200, height: 800 }).jpeg())
} finally {
  image.close()
}
```

A browser can open a `File` and offer the result as a `Blob` download:

```ts
import { openGainMapImage } from 'purejsimage/hdr'

async function downloadEditedHdr(file: File): Promise<void> {
  const image = await openGainMapImage(file)
  try {
    const bytes = await image.jpeg({ metadataMode: 'dual' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
    link.download = 'edited-ultra-hdr.jpg'
    link.click()
    URL.revokeObjectURL(link.href)
  } finally {
    image.close()
  }
}
```

Cheap JPEG inspection does not entropy-decode either child:

```ts
import { inspectGainMapImage } from 'purejsimage/hdr'

const probe = await inspectGainMapImage(bytes)
if (probe.status === 'valid') console.log(probe.baseDimensions, probe.gainMapDimensions)
```

Selected-boost rendering yields caller-releasable Float32 row blocks:

```ts
for await (const block of image.render({ displayBoost: 8 })) {
  try {
    consumeLinearHdrBlock(block)
  } finally {
    block.release?.()
  }
}
```

Source-child extraction stays separate from transformed output and supports a bit-preserving repack:

```ts
import { assembleGainMapJpeg } from 'purejsimage/hdr'

const repacked = await assembleGainMapJpeg({
  baseJpeg: await image.extractOriginalBase(),
  gainMapJpeg: await image.extractOriginalGainMap(),
  metadata: image.inspection().metadata,
})
```

The constrained AVIF writer accepts an opaque sRGB SDR base and one semantic gain channel. It
rejects alpha, RGB maps, Display P3, HDR-base output, and unsupported dimensions:

```ts
const avif = await image.autoOrient().resize({ width: 640, height: 360 }).avif()
```

Every opened image and its derived fluent objects share one lifecycle. Call `close()` in `finally`.

## Supported input

The explicit HDR entry supports these relationships:

| Container | Metadata | Base direction | Gain channels |
| --- | --- | --- | --- |
| JPEG | Ultra HDR XMP | SDR | 1 or 3 |
| JPEG | ISO 21496-1 | SDR | 1 or 3 |
| JPEG | Matching ISO and Ultra HDR metadata | SDR | 1 or 3 |
| AVIF | ISO 21496-1 `tmap` relationship | SDR or HDR | 1 or 3 |

Valid ISO metadata takes precedence when both JPEG representations are present. PureJsImage also
checks the lower-priority Ultra HDR metadata. A conflicting relationship fails the explicit HDR
open operation. The regular JPEG decoder can still return the primary SDR image.

`inspectGainMapImage()` is the cheap JPEG probe. It reports `valid`, `not-present`, `unsupported`,
or `invalid` without decoding entropy-coded pixels. On a valid MPF file with adjacent images, it
uses the declared ranges and reads only headers and boundary bytes. A malformed legacy range may
require a bounded JPEG boundary scan. The only size-mismatch compatibility case is a primary
over-declaration of at most 65,535 bytes whose independently scanned EOI lands exactly on the first
secondary offset. Under-declarations and other contradictions fail.

## Rendering

Pass the linear display boost to `render()`:

```ts
for await (const block of image.render({ displayBoost: 8 })) {
  console.log(block.y, block.height, block.pixelFormat, block.colorSemantics)
}
```

The renderer decodes the base transfer function before applying gain. It supports sRGB, linear,
PQ, and HLG signals where the container supplies supported color semantics. The base and alternate
must use the same declared sRGB or Display P3 primaries. Relationships that need a gamut conversion
fail explicitly. Output blocks describe linear RGB pixels with an identity matrix and full range.
One-channel maps apply the same gain to red, green, and blue. Three-channel maps apply independent
values. A base alpha channel is copied unchanged and is never multiplied by the gain map.

Untransformed output is emitted in bounded row blocks and does not retain decoded full-frame base
and map images. Use `gainMapLinearF32ToRgba16()` when an integer HDR boundary needs explicit scaling
and clamping.

## Paired transforms

The fluent object applies each geometry operation to the base and the encoded gain map:

- `autoOrient()`
- `crop({ x, y, width, height })`
- `flipHorizontal()` and `flipVertical()`
- `rotate(90 | 180 | 270)`
- `resize({ width, height, kernel })`

Base and map pixel edges share normalized coordinates. A crop can therefore map to fractional gain
coordinates. PureJsImage resamples that exact region instead of rounding two unrelated integer
crops. Scalar gain maps stay scalar.

Call `autoOrient()` before transformed JPEG or AVIF output when the source has a pending EXIF
orientation. Crop, flip, rotate, and resize retain that pending orientation so a later
`autoOrient()` still applies it exactly once. Transformed encoding fails instead of silently
dropping an unapplied orientation.

The current paired-transform and re-encode path retains one 8-bit base raster and one smaller encoded
gain raster. Adapted Float32 output is emitted in independent 32-row blocks and never exists as a
complete Float32 image. `maxMaterializedBytes`, which defaults to 256 MiB, is one aggregate ledger for
library-owned decoded and transformed rasters, an aligned map when needed, retained encoded artifacts,
and live Float32 blocks. Each allocation is reserved before it is created. Its reservation is released
when a raster is replaced, an encoded staging buffer is copied or handed to the caller, or a rendered
block is released. The limit does not describe process RSS. The benchmark records RSS, external
memory, and ArrayBuffer memory separately.

## JPEG output

`jpeg()` re-encodes transformed base and map pixels and writes a backward-compatible compound JPEG.
The default `metadataMode` is `dual`. Use `iso` or `ultra-hdr` only when the receiving system needs
one representation.

```ts
const jpeg = await image.jpeg({
  metadataMode: 'dual',
  baseQuality: 90,
  gainMapQuality: 92,
  baseChromaSubsampling: '420',
  maxOutputBytes: 64 * 1024 * 1024,
})
```

The primary child is a complete ordinary JPEG. A reader that stops at its EOI marker sees the SDR
image. MPF offsets, GContainer length, XMP, ISO metadata, and both child ranges are recalculated and
validated before bytes are returned.

Use `extractOriginalBase()` and `extractOriginalGainMap()` with `assembleGainMapJpeg()` for a
bit-preserving metadata repack. Those names always mean the byte-exact source children. Use
`previewTransformedComponents()` for current transformed base and map samples.

Re-encoded primary pixels use sRGB and carry a deterministic first-party matrix-shaper ICC profile.
It uses the ICC sRGB D50 colorants and IEC 61966-2-1 transfer curve. Its SHA-256 is
`85f1616e233eb429b3517a97ed4151b4ae74a79eca58fd5c7c22bf44c24610a9`.
Gain-map ICC and EXIF orientation metadata do not alter encoded map samples.

## AVIF output

`avif()` writes a narrow ISO gain-map subset:

- an opaque 8-bit sRGB SDR base;
- one semantic gain channel encoded as an achromatic YUV AV1 image;
- one ISO tone-map metadata item;
- compatible base and map aspect ratios;
- `dimg`, `altr`, NCLX, `ispe`, and exact ISO rational metadata.

Alpha, RGB gain maps, Display P3 output, HDR-base output, grids, animation, external item data, and
unknown auxiliary items are rejected. This boundary keeps the first writer small and testable.
The map AV1 sequence header and item NCLX signal unspecified primaries and transfer values 2 and 2.
The base AV1 item remains sRGB.

## Limits and lifecycle

JPEG marker, APP segment, XMP, XML, RDF, MPF, embedded-image, dimension, pixel, source, output, and
materialized-byte limits are checked before large allocations. XML DTD and entity declarations are
rejected. Source offsets and output lengths use safe-integer checks.

Call `close()` when all work derived from an opened image is finished. Closing one derived fluent
object closes the shared owner, so sibling objects must no longer be used. `close()` is idempotent.
Pass an `AbortSignal` to open, extraction, rendering, and output options when work must be
cancellable.

## Current boundaries

PureJsImage does not generate gain maps from unrelated SDR and HDR images. Drawing, compositing,
arbitrary-angle rotation, JPEG XL output, HEIF output, C2PA authoring, and AVIF animation are outside
this feature.

The experimental HEIF decoder does not currently prove and decode the required Apple gain-map item
relationship from a redistributable fixture. A HEIF bridge is therefore deferred. The existing
experimental import and its HEVC patent notice are unchanged.

The API is provisional until an authorized release. No version or compatibility promise is implied
by the feature branch.
