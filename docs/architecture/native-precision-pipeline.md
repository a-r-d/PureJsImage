# Native precision pipeline

Status: Phase 1 implementation checkpoint. This document records the current
ordinary-image boundary and the contracts used by the native-precision work.
It does not change the separate scientific analysis graph or `NumericTile`
runtime.

## Current normalization and precision-loss map

The ordinary pipeline already accepts native pixel blocks from TIFF, AVIF,
PNG, and other decoders. `PixelFormat` describes their interleaved byte
layout. The current executor loses precision at one central decision and a few
format-specific boundaries:

| Boundary | Current behavior before this phase | Precision consequence |
| --- | --- | --- |
| `src/executor.ts` | Calls `normalizePixelBlocks()` when any crop, resize, orientation, flip, flop, or rotation is present | Integer samples wider than 8 bits and floating-point samples become display bytes before the transform |
| `src/crop.ts` | Accepts only `gray8`, `rgb8`, and `rgba8` | A byte-copy operation cannot preserve native high-depth blocks |
| `src/orient.ts` | Derives bytes per pixel from the three 8-bit formats | Flips, quarter turns, and EXIF orientation require prior normalization |
| `src/resize.ts` | Uses 8-bit format dispatch and 8-bit output buffers | Resampling cannot retain `gray16`, `rgb16`, `rgba16`, `grayf32`, or `rgbf32` |
| `src/rotate.ts` | Arbitrary-angle interpolation is 8-bit only | Non-quarter-turn rotation requires an explicit 8-bit path |
| `src/codecs/png.ts` decode | Converts legal 16-bit samples to their most significant display byte | Low eight bits are discarded at decode |
| `src/codecs/png.ts` encode | Advertises and writes only 8-bit gray, RGB, and RGBA | A native 16-bit pipeline cannot terminate in PNG |
| encoder selection | Uses `encoderPixelFormats` only | A required terminal conversion is indistinguishable from transform normalization |

`src/raster.ts` and `src/scientific/numeric-tile.ts` are useful references for
canonical big-endian storage and native numeric computation. The ordinary
image pipeline does not import either scientific analysis or application graph
code.

## Storage-format model

`PixelFormat` remains the compact hot-path dispatch key. It answers these
storage questions only:

- channel order and count;
- integer, signed integer, or floating-point sample type;
- bytes per sample; and
- canonical byte order for multi-byte samples.

Multi-byte ordinary `PixelBlock` samples use canonical big-endian order. This
matches PNG network sample order and the existing native TIFF and AVIF block
boundaries. Transform dispatch resolves a frozen storage descriptor once per
stage. Pixel loops use fixed bytes-per-pixel or specialized numeric kernels.

Planar YUV formats remain separate storage layouts. They are not treated as
fixed-width interleaved pixels and are rejected by transforms without a
plane-aware implementation.

## Color and alpha semantics model

Pixel storage does not imply color meaning. A small immutable
`PixelColorSemantics` value travels beside the storage format. Its fields are:

| Concept | Representation |
| --- | --- |
| Color family | gray, RGB, YUV, XYZ, or unspecified |
| Primaries | sRGB, Display P3, Rec. 2020, source-profile, or unspecified |
| Transfer function | sRGB, linear, gamma with a finite positive exponent, source-profile, or unspecified |
| Matrix coefficients | identity, BT.601, BT.709, BT.2020 non-constant-luminance, or unspecified |
| Range | full, limited, or unspecified |
| Alpha | none, straight, premultiplied, or unspecified |
| Provenance | decoder-converted, container-signaled, ICC, assumed-default, or unspecified |
| ICC | a bounded reference that states source or emitted-pixel relevance, not copied profile bytes |

Unknown values remain explicit. A decoder reports the pixels it emits. For
example, a decoder that applies an ICC transform to sRGB reports sRGB emitted
semantics while preserved source ICC metadata remains separate. Conservative
decoders may report unspecified fields.

Semantics are resolved and validated before blocks enter transform loops.
There is no global registry and no registration side effect.

## Transform capability matrix

| Operation | Exact byte preservation | Native numeric support | Explicit boundary |
| --- | --- | --- | --- |
| Crop | All fixed-width interleaved formats | Not applicable | Planar YUV |
| Horizontal and vertical flip | All fixed-width interleaved formats | Not applicable | Planar YUV |
| EXIF orientations and 90/180/270 degree rotation | All fixed-width interleaved formats | Not applicable | Planar YUV |
| Resize, nearest/bilinear/Lanczos3 | No | gray16, rgb16, rgba16, grayf32, rgbf32 plus existing 8-bit formats | Other storage formats and explicitly premultiplied RGBA input |
| Arbitrary-angle rotation | No | Existing 8-bit formats | High-depth and floating-point input without an explicit conversion |
| LUT and window | No | Existing declared formats | Mismatched input format |
| Pixel-format conversion | No | Declared source and destination pairs | Missing float range or alpha policy |

Byte-preserving operations validate block shape, stride, order, and backing
length. They copy complete pixel byte groups without reading numeric values.

## Conversion rules

Precision changes happen through one explicit conversion stage or through a
terminal encoder requirement recorded by the plan.

- Integer 16 to integer 8 maps 0 through 65535 to 0 through 255 and rounds to
  nearest.
- Integer 8 to integer 16 maps each code value to `value * 257` exactly.
- Float32 to integer requires a caller-supplied finite range. Values are
  clamped to that range and rounded to nearest in the destination integer
  domain. A range is never inferred from one block.
- Gray to RGB duplicates the sample without changing its numeric domain or
  transfer function.
- RGB to RGBA requires an explicit alpha value in the destination sample
  domain.
- RGBA to RGB requires an explicit background or an explicit discard policy.
  Fully transparent source color cannot leak through background composition.
- Explicitly premultiplied RGBA input is rejected before resize or storage
  conversion. Those paths do not currently expose an unpremultiply policy.
- A storage conversion does not reinterpret encoded RGB as linear RGB.

Conversion is row-streaming and preserves release, cancellation, and bounded
allocation behavior.

## Encoder negotiation rules

Each encoder declares the storage formats it accepts directly. It may also
declare accepted color semantics. Planning follows this order:

1. Keep the current storage and semantics when the encoder accepts them.
2. Apply an explicit caller conversion when present.
3. Apply the encoder's declared terminal conversion when one unambiguous
   conversion exists. Record the encoder as the reason for precision loss.
4. Fail with `UNSUPPORTED_OPERATION` when no correct conversion exists or when
   alpha, transfer, or range policy would have to be guessed.

PNG accepts native gray16, rgb16, and rgba16 after this phase. JPEG continues
to require an 8-bit terminal conversion. Arbitrary ICC transforms remain out
of scope unless the decoder already emitted converted pixels. PNG refuses to
encode source-profile pixels unless the matching ICC profile was explicitly
preserved. Container-signaled 16-bit pixels that cannot be described in the
output also fail instead of silently losing their color meaning.

## Precision-aware execution plan

The executor builds a deterministic JSON-safe description before decoding
pixels. Each stage records:

- operation and reason;
- input and output dimensions;
- input and output storage format;
- input and output color semantics;
- whether exact bytes are preserved;
- whether a conversion loses precision and why;
- memory class (`streaming-rows`, `temporary-storage`, or `full-frame`); and
- whether the stage is explicit, transform-required, or encoder-required.

The description contains no codec, source, sink, callback, TypedArray, or other
live object. Phase 2 may expose it as execution evidence. Phase 1 keeps it as
an internal planning contract with focused tests.

## Bounded-memory model

Crop and horizontal flip allocate only the current emitted block. Quarter
turns and orientations that reorder rows use the existing explicitly selected
temporary store and bounded 32 by 32 tiles. Tile capacity scales with encoded
pixel bytes, not an RGBA assumption.

Resize retains horizontal rows required by the vertical coefficient table.
Its working set is output-row width times channels and sample storage, plus
coefficient tables and a bounded output block. It does not retain a complete
intermediate image. Native 16-bit kernels use sufficiently wide accumulators.
Float32 output is written as float32 with Float64 accumulation where the
filter sum benefits from it.

Arbitrary rotation retains the existing temporary-storage fallback. It stays
8-bit-only in this phase. No new source-sized in-memory fallback is introduced.

PNG non-interlaced decode and encode stream rows. Adam7 reconstruction retains
compact native sample storage required to combine passes, then emits bounded
rows. This is an explicit full-image native-sample fallback for interlaced PNG,
not an RGBA display bitmap.

## Browser and Node portability boundaries

Storage descriptors, semantics, conversion, planning, transforms, resize, and
PNG sample handling use portable TypeScript and TypedArrays. They do not import
Node built-ins, `Buffer`, paths, streams, scientific modules, or application
modules.

Node and browser temporary storage remain selected through `ImageRuntime`
before transform loops. Deflate and sink behavior remain behind existing
runtime interfaces. Browser behavior must pass the portable graph check and a
real browser precision pipeline test.

The already-async output path imports the execution engine on first use. This
keeps the initial core chunk below its existing 64 KiB ceiling while making
native precision part of every ordinary pipeline without registration. The
initial and execution chunks have separate 64 KiB gates. The current measured
sizes are 24,421 and 58,715 minified bytes respectively.

## Backward-compatibility policy

- Existing 8-bit resize and transform kernels remain separate. Their geometry,
  rounding, output bytes, alpha behavior, and performance are regression
  protected.
- Native precision preservation is additive when both the transform and
  destination encoder support it.
- A destination that inherently accepts only 8-bit samples may request the
  same terminal display conversion previously performed early. The plan names
  that conversion.
- Existing metadata preservation remains separate from emitted pixel color
  semantics.
- Unimplemented high-depth operations fail instead of silently normalizing.
- Public alpha contracts change only through explicit conversion options.
- The ordinary core entry includes these capabilities without an optional
  registration step. Execution loads on first output, which preserves the
  existing initial-chunk safety limit and gives the new chunk its own limit.

## Baseline evidence

The Phase 1 baseline at Git revision
`51361e9c823934c22425121fb13db45461ebbd25` used package version `0.17.0`.
The focused pipeline, resize, PNG, and orientation suite passed 43 tests.
Correctness-gated local benchmark medians were:

| Workload | Median wall time | Correctness |
| --- | ---: | --- |
| `jpeg-resize-1200` | 513.4 ms | 30.02 dB quality gate |
| `png-resize-1000` | 359.8 ms | exact |
| `png-alpha-resize` | 66.9 ms | 48.39 dB quality gate |
| `stress-100mp-downscale` | 1218.0 ms | 57.84 dB quality gate |

These local results are regression evidence, not public benchmark headlines.

## Implementation checklist and acceptance gates

- [x] Record clean status, base revision, package version, focused regression
      tests, and representative benchmark baseline.
- [x] Map every ordinary-pipeline normalization, transform-format restriction,
      encoder conversion, and memory fallback relevant to this phase.
- [x] Add immutable color and alpha semantics with exhaustive validation.
- [x] Add deterministic JSON-safe precision-aware execution planning.
- [x] Generalize crop, flip, flop, quarter turns, and EXIF orientation to all
      required fixed-width interleaved formats with exact-byte tests.
- [x] Add native gray16, rgb16, rgba16, grayf32, and rgbf32 resize for nearest,
      bilinear, and Lanczos3 with scalar differential tests.
- [x] Add explicit streamable pixel-format conversion with range, rounding,
      alpha, and plan metadata.
- [x] Add opt-in linear-light resize for known sRGB or linear 8-bit and 16-bit
      RGB/RGBA semantics.
- [x] Decode and encode legal native 16-bit PNG gray, RGB, gray-alpha, and RGBA
      paths, including transparency and Adam7 fixtures.
- [x] Update the PNG capability manifest and regenerate every derived surface.
- [x] Add focused browser execution and keep portable entries free of Node
      built-ins.
- [x] Run the precision benchmark, neighboring 8-bit workloads, PNG fixtures,
      package types, browser checks, generated checks, and `npm run check`.
      The full gate passes through 2,126 tests and stops only on the unrelated
      OME-Zarr README image assertion that is already unsatisfied at the recorded
      base revision.

An item is complete only after its focused acceptance evidence passes. Release,
version, tag, and publication work remain outside this phase. Branch commits
and pushes require separate authorization.
