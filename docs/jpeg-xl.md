# JPEG XL in PureJsImage

## Quick answer

<!-- capabilities:jpegxl-summary:start -->
Decode common static JPEG XL with native precision, color, alpha and HDR; encode lossless Modular pixels at effort 1, 3, 5 or 7; and reconstruct eligible JPEGs byte for byte.

Decode status: Stable common static. Encode status: Stable lossless and exact transcode.
<!-- capabilities:jpegxl-summary:end -->

The [capability contract](../jpegxl-codec-support.md) lists the checked syntax and
unsupported cases. Unsupported operations fail with an `ImageError`. M6 covers
progressive and range-aware work; general lossy encoding belongs to the later
M7 work. Both remain outside this PR.

## Native precision and color

The decoder separates the source description from emitted pixels. For example,
a gray image with alpha has two source channels. The pixel API expands it to
RGBA with RGB color semantics and retains the independent alpha depth and
association. Source metadata still describes gray plus alpha. Gray ICC plus
alpha currently requires an unavailable profile-aware RGB expansion and fails
explicitly.

Modular integer samples retain their native precision. Supported crop,
orientation and resize operations preserve sample meaning. A JPEG XL re-encode
inherits native color and alpha depths, structured color, rendering intent and
luminance metadata. All eight orientations are supported. Use `autoOrient()`
when the output pixels should have display orientation applied.

Use the ordinary pixel API in Node.js or browsers:

```ts
import { createImageLibrary } from 'purejsimage'
import { jpegxlCodec } from 'purejsimage/codecs/jpegxl'
import { pngCodec } from 'purejsimage/codecs/png'

const images = createImageLibrary([jpegxlCodec, pngCodec])
```

Preserve native high-depth integer samples in a new JXL:

```ts
const native = await images.open(highDepthJxl)
const encoded = await native.jpegxl({ effort: 7 }).toUint8Array()
```

Choose a display recipe with a matching input contract. These examples are
[executable public API functions](../examples/jpegxl-display.ts).

For opaque SDR input with supported sRGB samples, normalize orientation and
convert native integer storage (including 10- or 12-bit samples) to 8-bit RGB:

```ts
export async function sdrRgbToPng(sdrRgbJxl: Uint8Array): Promise<Uint8Array> {
  const display = await images.open(sdrRgbJxl, { colorOutput: 'srgb' })
  return display.autoOrient().convertPixelFormat({ format: 'rgb8' }).png().toUint8Array()
}
```

For supported sRGB input with alpha, preserve that alpha and explicitly
straighten associated samples before display-oriented RGBA output:

```ts
export async function sdrRgbaToPng(sdrRgbaJxl: Uint8Array): Promise<Uint8Array> {
  const display = await images.open(sdrRgbaJxl, {
    colorOutput: 'srgb',
    alphaOutput: 'straight',
  })
  return display.autoOrient().convertPixelFormat({ format: 'rgba8' }).png().toUint8Array()
}
```

For opaque RGB input with supported PQ or HLG signaling, request HDR-to-SDR
tone mapping and export display-oriented RGB:

```ts
export async function hdrRgbToPng(hdrRgbJxl: Uint8Array): Promise<Uint8Array> {
  const display = await images.open(hdrRgbJxl, {
    colorOutput: 'srgb',
    hdrOutput: 'tone-map-srgb',
  })
  return display.autoOrient().convertPixelFormat({ format: 'rgb8' }).png().toUint8Array()
}
```

For supported PQ or HLG input with alpha, request straight-alpha SDR output
and preserve source alpha in the display-oriented PNG:

```ts
export async function hdrRgbaToPng(hdrRgbaJxl: Uint8Array): Promise<Uint8Array> {
  const display = await images.open(hdrRgbaJxl, {
    colorOutput: 'srgb',
    hdrOutput: 'tone-map-srgb',
    alphaOutput: 'straight',
  })
  return display.autoOrient().convertPixelFormat({ format: 'rgba8' }).png().toUint8Array()
}
```

Storage conversion alone does not convert primaries or transfer functions.
These recipes use the supported sRGB color conversion explicitly; they do not
claim arbitrary profile support. When deliberately adding alpha to an opaque
image, pass a normalized value such as `alpha: 1`; do not apply that override
indiscriminately to existing-alpha input.

Convert HLG integer storage to the full 16-bit range while preserving the source
luminance description:

```ts
const hlg = await images.open(hlgJxl)
const encoded = await hlg
  .convertPixelFormat({ format: 'rgb16' })
  .jpegxl()
  .toUint8Array()
```

For HLG with alpha, use `rgba16`. This changes integer storage precision and
retains the source `toneMapping` fields. Explicit HDR-to-SDR conversion replaces
incompatible HDR signaling. A display window or LUT cannot inherit JPEG XL source
color meaning for re-encoding and currently fails explicitly. A caller can set
validated `toneMapping` values deliberately; they are stored with finite half
precision.

Re-encode gray plus alpha through the public RGBA boundary:

```ts
const grayAlpha = await images.open(grayAlphaJxl)
const encoded = await grayAlpha.jpegxl().toUint8Array()
```

Straighten associated alpha before writing a PNG:

```ts
const straight = await images.open(associatedAlphaJxl, { alphaOutput: 'straight' })
const png = await straight.convertPixelFormat({ format: 'rgba16' }).png().toUint8Array()
```

Preserve a supported source profile into PNG:

```ts
const profiled = await images.open(profiledJxl, { colorOutput: 'preserve' })
const png = await profiled.autoOrient().keepIcc().png().toUint8Array()
```

The profile must describe the emitted samples. Supported 8-bit profiles can be
preserved into compatible PNG output. Arbitrary ICC encoding into JPEG XL and
unavailable high-depth profile conversions remain unsupported. Use `keepExif()`
for explicit Exif preservation; Exif orientation must be normalized before JXL
encoding. Exif, XMP and JUMBF preservation is bounded and opt-in.

The encoder accepts `gray8`, `gray16`, `rgb8`, `rgb16`, `rgba8` and `rgba16` with
matching structured gray or RGB semantics. It supports structured sRGB, linear
sRGB, Display P3, Rec. 2020, PQ, HLG, bounded gamma and representable custom
chromaticities, with straight or associated alpha. Native 8–16-bit color and
independent alpha precision can be declared in 16-bit storage. Missing or
incompatible semantics still fail validation. Float rows require a deliberate
representable integer output conversion before lossless JXL encoding.

## Exact JPEG reconstruction

The separate coefficient API preserves eligible original JPEG bytes:

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
  onlyIfSmaller: true,
})
const originalJpeg = await reconstructJpegFromJpegXl(result.data)
```

`onlyIfSmaller` rejects an eligible JPEG when its JXL would be larger. Exact
eligibility covers the checked three-component 8-bit Huffman baseline and
progressive subset. Exif orientation must be absent or 1. Exif color must be
absent or explicitly sRGB. ICC must be absent or match the independently checked
sRGB profile. Grayscale, CMYK/YCCK, incompatible profiles and unsupported JPEG
syntax fail explicitly.

Exact mode verifies reconstructed bytes before success. Pixel-lossless mode
preserves decoded sample values. It does not promise original file bytes or
metadata layout. An explicitly selected `reconstruction: 'prefer'` with
`fallback: 'pixel-lossless'` reports when pixel fallback runs. A supplied sink
receives the output and the result has `data: undefined`.

## Compression evidence

The promotion corpora have specific selection rules:

- M1 selects 250 eligible COCO 2017 validation JPEGs of at least 224 KiB from
  357 eligible candidates, evenly spaced by source ID. The pinned report records
  exact reconstruction, savings and libjxl size comparisons. This excludes small
  JPEGs and ineligible profiles.
- M2 uses 156 procedural cases across 12 classes. Labels such as screenshot, text
  and photo-like describe generated patterns. They are not captured screens or
  camera images.
- M3 uses 100 COCO photographs with three encoder variants each. Test rasters are
  explicitly resized or upscaled, including approximately 12 and 24 MP cases.
  Those dimensions are not the cameras' original resolutions.

The separate [PR 35 holdout](architecture/jpegxl-pr35-remediation.md) retains all
nine originally selected assets, including two real UI captures, transparent
assets, original 24 MP and 12 MP photographs, and a disclosed synthetic 16-bit
example. Every pixel encode at efforts 1 and 7 decoded exactly through pinned
libjxl. Large photos and screenshots often produced larger outputs than PNG or
libjxl. The current multi-group encoder uses the same left predictor at all four
efforts; advanced effort search applies to single-group images. Effort 7 does
not guarantee a smaller file than another codec.

The original small photographic JPEG was ICC-ineligible. Two separately disclosed
small, eligible WPT JPEGs supplement that coverage. They were selected by
eligibility after the original holdout run; no original case was removed.

The M3 maximum-error limit is one 8-bit sample and RMSE is at most 0.55 for the
recorded VarDCT/djxl comparisons. The RMSE limit is an independently documented
rounding exception to the original 0.25 target. It is not a lossless or general
HDR tolerance. PR evidence and extended promotion reports identify their exact
revision and scope; a missing extended run is reported as not run.

## Memory and browser behavior

`maxWorkingBytes` limits actual encoder-owned backing buffers before allocation.
It defaults to the image's `maxDecodedBytes`, or 1 GiB when no image limit is
supplied. It covers input staging, transform candidates, predictors, entropy
state, writer growth overlap, retained sections and metadata staging. It excludes
caller-owned input, output-sink storage and JavaScript object overhead. These
counters are separate from process RSS and garbage collection.

`maxOutputBytes` limits encoded bytes including container and metadata, up to
128 MiB. Candidate encodings also obey this limit. A budget failure throws
`LIMIT_EXCEEDED`; it does not silently choose a cheaper search. Output sections
are written in order and all encoder ownership is released after success or
failure, including cancellation during output.

The encoder retains the full input raster. VarDCT decode retains a full output
frame; common 8-bit sRGB photographs use bounded restoration bands, while the
documented high-depth, float and compositing paths retain more full-frame state.
See the capability contract for each memory class.

The [browser workbench](https://purejsimage.com/jpeg-xl/) uses the same first-party
TypeScript codec in a worker. Local files stay on the device. The local result
label distinguishes a local pixel round trip from independent fixture evidence.
Native processing preserves source meaning; canvas previews use explicit display
conversion. Node.js and browser regression tests cover the same metadata,
precision, alpha and encoder-budget boundaries.
