# JPEG XL sequences and native channels

Import these APIs from `purejsimage/jpegxl`. They use the first-party TypeScript
codec in Node.js and modern browsers. Lossy encoding remains Experimental.

```ts
import { openJpegXlSequence } from 'purejsimage/jpegxl'

const sequence = await openJpegXlSequence(bytes, {
  orientation: 'apply',
  maxDecodedPixels: 100_000_000,
  limits: { maxFrames: 500, maxDecodedBytes: 512 * 1024 * 1024 },
  signal,
})
try {
  for await (const frame of sequence.frames()) {
    // Independent Float64Array planes, normalized without clipping.
    // Inspect frame.colorSemantics before interpreting the color samples.
    display(frame)
  }
} finally {
  await sequence.close()
}
```

`headers()` scans frame headers and their tables of contents without decoding
pixels. A complete scan is needed to know the total displayed-frame count.
Headers include internal reference frames and progressive DC dependencies.
Progressive passes belong to a coding frame and are not separate animation frames.
`frames()` emits composited displayed frames. A zero-duration nonfinal frame can
update references without producing a timed presentation. No delay is invented.
A final zero-duration displayed frame has no positive time interval; select it
by frame index.
The ordinary image decoder requires its `frame` option for animated files.
Supported XYB sequence frames emit normalized sRGB planes, including wide-gamut
source colors converted to sRGB. The original source descriptor stays in the
header; `frame.colorSemantics` describes the emitted values.

`index` counts displayed frames. `internalFrameIndex` counts coding frames,
including internal dependencies. `header.animation` retains the original ticks
per second numerator and denominator, loop count and timecode flag. Duration is
an integer number of ticks. `startTicks` is a decimal integer string, including
for short sequences, so JSON serialization never loses an accumulated timestamp.
A tick lasts denominator/numerator seconds. A positive loop count is the total number of traversals, including the first.
A loop count of zero means infinite repetition. Iteration emits one traversal and does not schedule playback or
repeat frames. The caller applies the declared repetition count.

`frame(index)` and `frameAtTicks(bigintOrDecimalString)` replay from the beginning.
Timestamp selection addresses the first traversal. Negative or out-of-range
selections are errors. There is no decoded checkpoint cache. Replay still decodes
all dependencies before the selected frame. The budget counts those pixels too.
Only one iterator may run at a time on a sequence. Closing or cancelling an old
sequence prevents further output from that request. Start a new sequence for an
independent playback request.

Displayed planes and ICC byte arrays belong to the caller. Modifying an emitted
frame cannot modify retained reference pixels or a later header. Retaining many
outputs is the caller's memory use. The codec retains a full canvas, up to four
reference slots, compact progressive DC dependencies, and the current layer and
output. This is an explicit full-frame memory class. It does not retain every
frame of a sequence or promise bounded-row animation decoding. Working-buffer
limits are allocation admission limits, not measurements of process RSS.

## Native extraction and preservation

`layers()` exposes coding layers, their rectangles, and channel descriptors.
Modular output uses `Int32Array` storage for the decoded integer samples or
floating-point bit patterns. VarDCT output uses three reconstructed XYB
`Float64Array` color planes followed by native integer extra planes. These are
not RGB pixels. `layouts` contains each plane's actual dimensions. The image
header retains the original color metadata, sample depth, exponent bits, channel
names, dimension shifts, association and typed extra-channel metadata.

Extraction and display are different operations. Native extraction preserves
multiple alpha, depth, spot color, selection mask, CFA, thermal and optional
channels supported by the decoder. A depth channel has no implied physical units.
Spot color is not automatically mixed into RGB. Shifted or floating-point native
channels need explicit interpretation by the application. Unsupported display
conversions return an error rather than changing the profile label or dropping
channels. Raw VarDCT layers reconstruct required patch references, progressive
DC dependencies, filters, splines, noise and color upsampling before yielding
XYB planes. Extra planes retain their encoded grid. Raw Modular layers expose
native samples plus `frameFeatures` and `dcQuantization`; these samples precede
rendering features. Both forms preserve the original header descriptors.

Composited Modular frames also reconstruct YCbCr 4:4:4, 4:2:2 and 4:2:0,
custom filters, splines, noise and shifted alpha. Combined extra-channel
upsampling and dimension shift cannot exceed eight. Patch composition that
requires incompatible color and extra-channel grids is explicitly unsupported.
The native layer API still exposes those channels without relabeling them.

`encodeJpegXlNative` writes one bounded Modular image from one or three color
planes and up to four typed extra channels. It accepts unsigned 1–16-bit samples
in `Uint8Array` or `Uint16Array`, or binary16 bit patterns in `Uint16Array`.
Extra channels may have dimension shifts from zero through three. Every plane
must have exactly its declared dimensions and sample count. The current writer
uses one group and accepts dimensions up to 1024 by 1024.

Pass `iccProfile` to preserve source-profile samples and original ICC bytes.
The profile must describe GRAY for one color plane or RGB for three color planes.
The writer checks profile and compressed-output budgets. It does not convert
samples. This provides explicit gray-plus-alpha and high-depth ICC preservation
without attaching a gray profile to replicated RGB. Unavailable profile-aware
rendering remains an error. The qualification writes GRAY/RGB profiles and
checks both exact native samples and an explicit native CMM conversion to a
linear target profile, including unchanged alpha.

## Streamed encoding

`encodeJpegXlAnimation(frames, options)` consumes an async iterable and yields
encoded byte chunks. Options specify canvas dimensions, pixel format, color
semantics and the exact animation header. `encoding.mode` selects `lossless` or
`lossy`; lossy uses the M7 encoder and retains exact alpha by default. This is
pixel/timing encoding, not reconstruction of a source GIF or video file.

Each input frame supplies `data`, `width`, `height` and `durationTicks`. Optional
fields include `x`, `y`, `timecode`, `blend`, `source` and `saveAsReference`.
The first frame must replace the full canvas. Subsequent frames may use legal
rectangles and negative origins. Blend modes are replace, add, blend and multiply.
A partial frame reads its chosen source reference; explicitly set `source` to the
slot saved by the preceding frame when retaining the preceding canvas.
`saveBeforeColorTransform` requires a nonfinal full replacement frame that saves
a reference. Progressive encoding is not accepted by this sequence writer.

The writer pulls one input frame ahead to determine the last-frame bit. It does
not collect the whole sequence. Early termination returns the input iterator.
`maxEncodedPixels`, `maxOutputBytes`, `limits.maxFrames` and
`limits.maxDecodedBytes` bound cumulative work, total output, input frame count
and admitted working buffers. Chunks belong to the caller and are not reused.

## Level classification

The selected baseline is libjxl 0.12.0 at revision
`a7a9c787341cf703dede03c2009fa460cae5e5df`. Its level checks distinguish these
constraints; they are not a complete bitstream conformance validator:

| Feature | Level 5 | Level 10 or additional constraint |
| --- | --- | --- |
| Image dimensions | Each axis at most 2^18; at most 2^28 pixels | Larger images require Level 10 |
| Sample depth | Up to 16 bits, including binary16 floating samples | Wider floating samples require Level 10 |
| Extra channels | At most four; BLACK excluded | CMYK/BLACK requires Level 10 |
| ICC profile | At most 4 MiB | Larger profiles require Level 10 |
| Animation rate | At most 120 frames per second | Higher rates require Level 10 |
| Modular arithmetic | 16-bit buffer-sufficient flag and level-compatible transforms | Wider arithmetic and some global transforms require Level 10 |

See the [official encoder level API](https://libjxl.github.io/libjxl/api_encoder.html)
and the pinned source's `VerifyLevelSettings` in `lib/jxl/encode.cc`. Application
resource limits may be tighter. Float input is not automatically Level 10.
The checked corpus retains all 39 original cases, including CMYK and 32-bit
floating cases outside the selected Level 5 acceptance cohort. Expected
unsupported cases never count as passing output comparisons. Passing that cohort
does not advertise every possible Level 5 feature combination.
