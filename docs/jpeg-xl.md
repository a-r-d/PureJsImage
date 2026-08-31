# JPEG XL in PureJsImage

## Quick answer

PureJsImage has three separate JPEG XL paths:

1. A static decoder for the checked lossless Modular and common VarDCT subsets.
2. An experimental effort-1 Modular encoder for mathematically lossless pixels.
3. An explicit coefficient-domain JPEG transcoder that verifies byte-exact JPEG reconstruction.

The encoder and transcoder are experimental. Unsupported syntax fails with an `ImageError`. Exact
JPEG transcode never silently becomes a pixel transcode.

## Decode or encode pixels

Use the ordinary codec entry for pixel workflows:

```ts
import { createImageLibrary } from 'purejsimage'
import { jpegxlCodec } from 'purejsimage/codecs/jpegxl'

const images = createImageLibrary([jpegxlCodec])
const output = await images
  .open(input)
  .jpegxl({ mode: 'lossless', effort: 1, container: true })
  .toUint8Array()
```

The encoder accepts `gray8`, `gray16`, `rgb8`, `rgb16`, `rgba8`, and `rgba16`. It writes either a
raw codestream or a container with one `jxlc` box. It currently retains bounded full input and
output buffers.

## Transcode a JPEG without decoding RGB

Use the specialized entry when the original JPEG bytes matter:

```ts
import {
  inspectJpegReconstructionEligibility,
  reconstructJpegFromJpegXl,
  transcodeJpegToJpegXl,
} from 'purejsimage/jpegxl'

const eligibility = await inspectJpegReconstructionEligibility(jpegBytes)
if (!eligibility.eligible) throw new Error(eligibility.reasons.join('; '))

const result = await transcodeJpegToJpegXl(jpegBytes, {
  reconstruction: 'required',
  onlyIfSmaller: false,
})
const originalJpeg = await reconstructJpegFromJpegXl(result.data)
```

`reconstruction: 'required'` is the default. It parses quantized JPEG coefficients, writes
JPEG-derived VarDCT plus `jbrd`, reconstructs the JPEG from the finished JPEG XL file, and compares
every byte before returning.

Use `reconstruction: 'prefer'` with `fallback: 'pixel-lossless'` only when preserving decoded pixels
is acceptable. The result reports `mode: 'pixel-lossless'` and `exactReconstruction: false` when the
fallback runs. `onlyIfSmaller: true` rejects output that is not smaller than the source JPEG.

## Current boundary

The exact boundary is generated in [jpegxl-codec-support.md](../jpegxl-codec-support.md). Important
limits include:

- Static images only.
- A checked VarDCT corpus rather than every JPEG XL transform and color mode.
- A checked 8-bit Huffman baseline and progressive JPEG reconstruction subset.
- No general lossy JPEG XL encoder.
- Bounded full input and output retention in the experimental encoder and transcoder.

The browser workbench at `/jpeg-xl/` runs the same first-party TypeScript implementation in a Web
Worker. Local files stay in the browser.

