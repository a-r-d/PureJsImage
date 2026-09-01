# JPEG XL in PureJsImage

## Quick answer

PureJsImage has three separate JPEG XL paths:

1. A static decoder for the checked lossless Modular subset and selected 8-bit single-group XYB
   VarDCT fixtures.
2. An experimental effort-1 Modular encoder for mathematically lossless pixels.
3. An explicit coefficient-domain JPEG transcoder that verifies byte-exact JPEG reconstruction.

The encoder and transcoder are experimental. Unsupported syntax fails with an `ImageError`. Exact
JPEG transcode never silently becomes a pixel transcode.

The representative compression matrix is an explicit reason the encoder remains Experimental. Its
current median and worst size ratios do not meet the documented stable gate, even though the output
passes the independent exact-sample checks.

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

The encoder accepts `gray8`, `gray16`, `rgb8`, `rgb16`, `rgba8`, and `rgba16`. Pixels must use
full-range sRGB gray or RGB semantics, with no alpha or straight alpha. Linear RGB, Display P3,
unknown transfer or primaries, source-profile pixels, arbitrary ICC encoding, and premultiplied
alpha are rejected. The encoder writes either a raw codestream or a container with one `jxlc` box.
It currently retains bounded full input and output buffers.

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
if (result.data === undefined) throw new Error('Memory-mode transcode did not return data')
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
- Selected 8-bit single-group XYB VarDCT fixtures, with no alpha or orientation extra fields.
- Selected-subset VarDCT materializes the full frame and applies crop afterward. It does not
  advertise region pushdown.
- A checked three-component 8-bit Huffman baseline and progressive JPEG reconstruction subset.
  Grayscale, CMYK, and YCCK exact transcode are unsupported.
- No general lossy JPEG XL encoder.
- Bounded full input and output retention in the experimental encoder and transcoder.

Pixel-lossless encoding preserves decoded samples. Exact JPEG transcode preserves the original
JPEG byte stream. These guarantees are not interchangeable. In memory mode the transcoder returns
`data`. When a sink is supplied, it writes to that sink and returns `data: undefined` so the caller
does not retain a second complete output.

The browser workbench at `/jpeg-xl/` runs the same first-party TypeScript implementation in a Web
Worker. Local files stay in the browser. It presents pixel-lossless PNG or TIFF encode, exact JPEG
transcode, and JPEG XL inspect/decode as separate operations. The local pixel check is labeled
`byte-exact local round trip`; independent verification refers only to the pinned external matrix.
