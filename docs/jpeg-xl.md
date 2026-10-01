# JPEG XL in PureJsImage

## Quick answer

<!-- capabilities:jpegxl-summary:start -->
Decode common static JPEG XL with native precision, color, alpha and HDR; read wider Modular integer and floating samples, convert supported ICC and relative custom HDR color, preserve matching ICC and finite Float32 output, compose native float/CMYK or HDR VarDCT frames, stream lossless or Experimental lossy animation, and reconstruct eligible JPEGs byte for byte.

Decode status: Stable common static. Encode status: Stable lossless, static lossy and exact transcode.
<!-- capabilities:jpegxl-summary:end -->

The [capability contract](../jpegxl-codec-support.md) lists the checked syntax and
unsupported cases. Unsupported operations fail with an `ImageError`. M6 covers
progressive and range-aware work; general lossy encoding belongs to M7. M10 adds
bounded native Level 10 samples, CMYK profile conversion and exact 31-bit integer
and floating workflows.

The static decoder implements all VarDCT transform IDs from 0 through 26,
including rectangular 8 by 32 and 32 by 8 blocks and transforms up to 256 by 256.
Large-transform scratch and default weights are allocated only when needed and
remain subject to the decoder's working-memory limit.

Grouped Modular decoding handles the checked global Palette and Squeeze streams
at native 8- and 16-bit RGB precision. Palettes without spatial prediction retain
their global tables and intersecting group bands. Global Squeeze and other
spatial dependencies use compact full-frame channel planes; `explainImage()`
reports that fallback. Other transform combinations still need qualification.

## Native precision and color

The decoder separates the source description from emitted pixels. For example,
a gray image with alpha has two source channels. The pixel API expands it to
RGBA with RGB color semantics and retains the independent alpha depth and
association. Source metadata still describes gray plus alpha. Supported GRAY
ICC profiles can render that layout to straight sRGB RGBA. Both integer and Float32 GRAY ICC plus alpha can re-encode to native gray
through `keepIcc().jpegxl()` when expanded RGB channels remain equal. A GRAY
profile cannot label expanded RGB PNG output.

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

Use the specialized entry for Level 10 native samples:

```ts
import {
  encodeJpegXlNative,
  jpegXlNativeFloat32ColorPlanes,
  openJpegXlSequence,
} from 'purejsimage/jpegxl'

const encoded = await encodeJpegXlNative({
  width,
  height,
  color: [{ data: floatBits, bitDepth: 32, sampleFormat: 'binary32' }],
})

const sequence = await openJpegXlSequence(encoded)
for await (const layer of sequence.layers()) {
  const floats = jpegXlNativeFloat32ColorPlanes(layer)
  // floats preserve negative values, highlights, signed zero and subnormals.
}
await sequence.close()
```

Level 10 output uses a JPEG XL container with `jxll=10`. The ordinary encoder and
native planar writer both support explicit Level 5, Level 10, or automatic level
selection. The ordinary encoder uses `codestreamLevel: 'auto' | 5 | 10`, with
`auto` as the default. Forward VarDCT selects Level 10 when exact Modular alpha
uses more than 12 bits. Explicit Level 5 or raw output requests fail when the
input needs Level 10. Streamed Level 10 animation uses an unbounded `jxlc` box,
so it does not buffer the complete output. Float-to-integer display
conversion requires a finite black/white range and rejects NaN and infinity.
CMYK extraction keeps C, M, Y, black and alpha planes separate; use
`convertJpegXlCmykLayerToRgba8` to apply the embedded profile explicitly.

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

The profile must describe the emitted samples. Supported profiles can be
preserved into compatible PNG output. With `colorOutput: 'srgb'`, ordinary
decoding converts supported GRAY and RGB ICC integer samples through 16 bits.
High-depth input emits full-range sRGB16 and straight alpha, including mixed
integer color/alpha depths and associated alpha. The checked shifted-alpha
case uses a constant 2x grid. The converter modifies emitted rows and reserves
bounded profile tables from `maxDecodedBytes`; it adds no full-frame bitmap.
Source metadata still describes the original profile and depths. PNG output
and JPEG XL re-encoding use the converted meaning and full output precision.

The same explicit `colorOutput: 'srgb'` option converts structured SDR color:
linear, gamma and BT.709 gray/RGB, plus supported P3 and Rec. 2020 primaries.
High-depth conversions emit full-range 16-bit samples and straight alpha.
Custom white points and primaries work at 8- through 16-bit integer precision
with relative rendering intent. Other custom-color intents remain unsupported.
The default pipeline preserves structured samples and their native ranges.

Static full-canvas Modular IEEE binary16 and binary32 gray/RGB input now opens
through the ordinary pipeline as `grayf32`, `rgbf32` or `rgbaf32`. Binary16 values
promote exactly to float32. Finite negative values, signed zero, subnormals and
highlights above one are preserved. Integer or IEEE alpha has an independent
normalized range. Use `alphaOutput: 'straight'` before integer conversion when
the source alpha is associated. NaN and infinity are explicit input errors.

```ts
const floating = await images.open(floatJxl, { alphaOutput: 'straight' })
const png = await floating
  .convertPixelFormat({ format: 'rgba16', range: { minimum: 0.25, maximum: 1.25 } })
  .png()
  .toUint8Array()
```

Choose an output format with the same channel count. Gray without alpha can use
`gray16`; RGB without alpha can use `rgb16`. Float input keeps its source color
meaning by default. For structured SDR source color, request sRGB conversion:

```ts
const display = await images.open(floatJxl, { colorOutput: 'srgb' })
const displayPng = await display.png().toUint8Array()
```

This emits `gray16`, `rgb16` or straight `rgba16`. It supports linear, gamma,
BT.709, sRGB, Display P3, Rec. 2020 and relative custom white points and primaries.
Associated samples are straightened in the source color domain first. Source
values are then clipped to [0,1] for SDR conversion, and converted gamut values
are clipped at the output boundary. Integer or IEEE alpha is normalized to 16 bits.
Transfer functions evaluate the float samples directly, with one final integer
rounding. PNG output and JPEG XL re-encode retain the converted sRGB meaning.
The checked constant 2x alpha grid also crosses Modular group boundaries.

Float ICC conversion now evaluates supported GRAY curves and RGB matrix/TRC
or `mAB` profiles with float input. Explicit `colorOutput: 'srgb'` emits straight
sRGB16. Float input keeps its source profile by default. Use
`image.keepIcc().jpegxl()` to retain that profile when encoding float rows.
Gray ICC plus alpha expands to equal RGB channels for processing and folds back
to native grayscale when re-encoded. Editing those channels independently makes
the original GRAY profile ineligible.

```ts
const linear = await images.open(input, { hdrOutput: 'linear-float' })
const preservedHdr = await linear.jpegxl().toUint8Array()
const display = await images.open(input, { hdrOutput: 'tone-map-srgb' })
const png = await display.png().toUint8Array()
```

Structured PQ, HLG and linear float HDR supports sRGB, Display P3 and Rec. 2020.
Linear output keeps source primaries and highlight values above one. Display
output uses 203 nit reference white and the source-gamut Reinhard policy before
conversion to sRGB8. HLG uses a luminance-derived system-gamma factor. Relative custom
HDR primaries are supported. Profiles without supported transfer metadata remain unsupported.

Ordinary `.jpegxl()` losslessly preserves finite `grayf32`, `rgbf32` and
`rgbaf32` bit patterns, including signed zero, subnormals, negative values and
highlight headroom. Output uses binary32 in a Level 10 container, even when the
source was binary16. Associated alpha, orientation, intrinsic size and luminance
metadata are preserved. Explicit lossy mode rounds color mantissas in Modular coding and preserves
binary32 storage and exact alpha. It has no progressive passes or perceptual
quality equivalence claim. Use explicit pixel-format range conversion for
integer output. Float VarDCT writing remains unsupported.

Native Modular float and CMYK frames now compose in the source domain. Cropped
layers and reference frames are combined before ICC conversion or HDR tone
mapping. Select animated output with `images.open(input, { frame: 2 })`. The
sequence API also returns normalized integer planes or actual floating values.
Float32 animation writing and selected PQ/HLG/linear XYB VarDCT frame rendering
are supported.

Modular CMYK input with unsigned C/M/Y/black through 31 bits or legal floats and a supported
embedded `mft2` A2B0 profile opens as straight sRGB8 or sRGB16 rows. Integer or
IEEE alpha and associated color are supported. PNG and JPEG XL output use the
converted sRGB meaning; source metadata retains the CMYK profile. Native
extraction is required to preserve source CMYK samples. Floating black is supported. Other
CMYK profile families remain unsupported.

Independent unshifted native groups decode cropped bands. Global transforms,
shifted extras and dependent groups retain full native planes. Composition also
retains a canvas and up to four reference slots, with a cumulative replay limit.
Converter rows, normalized extras and profile tables are reserved from
`maxDecodedBytes` before allocation. Structured SDR matrix scratch reserves
4 KiB; HDR scratch reserves 32 KiB. Float encoding stages planar bits and retains
compressed sections and assembled output, bounded by `maxWorkingBytes` and
`maxOutputBytes`. It does not retain an additional interleaved float bitmap.

Matching GRAY/RGB ICC profiles can be explicitly retained on lossless integer
or Float32 JPEG XL output. Other non-alpha extra channels and nonrelative
custom-color conversion remain unsupported. Opaque Modular integers through
31 bits retain exact `gray32`/`rgb32` samples. Mixed floating or wide alpha uses
normalized `rgbaf32` and reports precision loss. Custom floating layouts emit
Float32 values, including checked 24-bit/8-exponent and 16-bit/4-exponent fields.
Integer-color VarDCT with floating alpha emits `rgbaf32`; binary32 and custom
16-bit/4-exponent alpha have pinned straight and associated references. Wider
integer VarDCT display remains unsupported.

Forward integer VarDCT writing now accepts HLG, relative custom chromaticities,
associated alpha and nondefault intensity targets. Progressive floating-alpha
stages and transformed implicit-palette prefix layouts still need qualification.
The explicit native APIs cover additional profile and sample layouts. Use `keepExif()`
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

Ordinary VarDCT opening and `explainImage()` now index headers without decoding
pixels. Pixel allocation begins when decode iteration starts. Header inspection
does not verify entropy payloads; those errors can appear during decoding.
`maxHeaderBytes` bounds the combined parsed headers, including requested ICC
data, rather than counting the compressed frames between them. JPEG-derived
coefficient decoding still runs during opening and the planner reports it.
The ordinary VarDCT decoder remains a one-shot final-image iterator. The explicit
session API below supplies staged and selective output.

The [browser workbench](https://purejsimage.com/jpeg-xl/) uses the same first-party
TypeScript codec in a worker. Local files stay on the device. The local result
label distinguishes a local pixel round trip from independent fixture evidence.
Native processing preserves source meaning; canvas previews use explicit display
conversion. Node.js and browser regression tests cover the same metadata,
precision, alpha and encoder-budget boundaries.

## Progressive sessions and native resolution

Import `openJpegXlSession` from `purejsimage/jpegxl` for staged and selective
reading. Opening indexes checked headers and section extents without decoding
pixels. `explainImage(session, request)` calls the same dependency planner used
by execution. A plan states whether LF feature validation is still required.
After that validation, each emitted stage carries its resolved plan.

```ts
import { openJpegXlSession } from 'purejsimage/jpegxl'

const session = await openJpegXlSession(input)
try {
  for await (const event of session.native({ scaleDenominator: 8 })) {
    if (event.type !== 'block') continue
    try {
      // Consume this stage's native sample block.
      consume(event.stage, event.block)
    } finally {
      event.block.release?.()
    }
  }
} finally {
  await session.close()
}
```

`preview()` reads the separately encoded embedded image, when present, at its
own dimensions. `native()` stops at complete DC for denominator 8, or at the
signaled pass boundary for denominator 2 or 4. An unavailable boundary throws
`UNSUPPORTED_OPERATION`. It never substitutes a final-image shrink for a
missing native stage. `progressive()` emits the embedded preview, complete DC,
completed passes and final output when those stages are available. `decode()`
emits only its requested completed stage. Its default is final output.
Existing pipeline resize and `ImageDecoder.decode()` retain final-image
semantics.

Events are `metadata`, `stage-start`, `block`, `stage-complete`, and `final`.
Only successful reconstruction of the requested final region emits `final`;
unread unrelated groups remain unvalidated. A partial stage cannot
establish final-image validity. Stage identity includes the frame and completed
pass count. Dimensions, intended downsampling, color semantics, optional native
display ranges and the resolved dependency plan travel with each stage.
`session.stages` distinguishes unavailable stages from stages that still require
compressed-data validation. None of these metadata states promises that
unread entropy data is valid.

A request region uses full-resolution coordinates. Set `coordinateSpace` to
`encoded` or `display`; display coordinates apply the codestream orientation
exactly once. The output origin is zero, its dimensions are rounded up after
scaling, and sample centers use the requested grid. Embedded previews have a
separate coordinate system and are not cropped to the main image's viewport.

Selective XYB requests support SDR8/16, linear16 and PQ16, including one integer
alpha channel through 16 bits with straight or associated alpha. They read LF
dependencies, intersecting color groups and an eight-pixel restoration halo.
Opaque DC does not read main-frame HF sections. Grouped alpha can require HF
global data and later AC passes before an early color stage. Its plan includes
those sections. Global Squeeze requires every alpha group, even for a color
viewport. Complete transparency is retained at every emitted stage, including
the checked 2x shifted associated-alpha case. Native pass requests omit later
color passes unless those sections contain required alpha data. Internal
Modular DC frames can require all of their progressive groups; their bytes
belong to the dependency cost.

Patches, splines, noise, other internal references, multiple or floating alpha,
image upsampling and Modular main images use their established complete static
paths. Their plans list the reason. `fallback: 'reject'` rejects those dependency
fallbacks and required full-resolution output or working storage for reduced or
region requests. Partial-stage requests cannot silently become final output.

Plans also state the working-memory class and explicit full-frame storage fallback.
DC samples the requested output grid from compact LF state and restoration
bands. Grouped alpha retains a complete native alpha plane and reports
`full-native-alpha-and-dc-restoration`, including for small viewports. Reading
its AC trailers also needs HF metadata and one temporary color coefficient
group. Spatial alpha transforms can require every alpha section.
Pass and final
stages still retain a full-resolution output; some dependencies also require
full working planes. Selective group decoding reduces compressed and
coefficient work without promising viewport-sized memory. Static session
fallbacks may temporarily retain a second full output while adapting the
existing decoder. `managedPeakBytes` is null when an underlying fallback cannot
supply managed accounting. These values exclude caller input, source caches,
JavaScript object overhead and application display buffers; isolated RSS is a
separate measurement.

The session borrows its source. Keep that source and its bytes unchanged until
`close()`. One iterator may be active, including an iterator that has not started
or is suspended at a block. Concurrent requests throw. A request signal cancels
that request; a signal passed when opening lasts for the session's lifetime.
`close()` cancels active work, is idempotent, and drops session-owned caches.
Returning early from iteration releases active working state. Rendering yields
to the task scheduler between bounded reconstruction steps so timer and browser
cancellation can run during computation.

Output blocks are independent snapshots. Releasing a block or requesting a
later stage does not overwrite its bytes. Consumers that retain blocks must
account for that memory themselves. Iteration supplies backpressure rather than
an unbounded queue of stage bitmaps.

`maxCachedBytes` bounds retained compressed sections and LF state between
requests. Its default is the smaller of 16 MiB and `maxDecodedBytes`. A cache
budget of zero drops owned state after each request. Large LF states need a
larger explicit cache budget to survive between requests. Cache identity stays
within a source instance and its reported validator; the session does not share
caches across unrelated inputs. It rejects a changed reported identity before
reusing decoded state. HTTP sources enforce their own response validators.
`sourceSectionBytes` counts successfully read logical section payloads; it does
not count metadata probes or HTTP overfetch. Use `HttpRangeSource.stats` for
physical transfer and source-cache measurements. Session opening disables
automatic generic read-ahead; an explicitly buffered source keeps its own policy.
