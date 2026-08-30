# Native precision in image pipelines

## Quick Answer

PureJsImage preserves 16-bit PNG samples through crop, flip, EXIF orientation,
quarter-turn rotation, resize, and PNG output. It also resizes `grayf32` and
`rgbf32` blocks without converting them to 8-bit pixels. Use
`convertPixelFormat()` when you want to reduce or change sample storage.

## Precision-preserving transforms

Crop, horizontal flip, vertical flip, EXIF orientation, and 90, 180, or 270
degree rotation copy complete pixel byte groups. They support every fixed-width
interleaved `PixelFormat`, including signed integers, float16, float32,
float64, `yf32`, and `xyzf32`.

Resize has native kernels for these formats:

- `gray16`, `rgb16`, and `rgba16`
- `grayf32` and `rgbf32`
- the existing `gray8`, `rgb8`, and `rgba8` formats

Nearest, bilinear, and Lanczos 3 use the existing geometry and fit options.
RGBA16 filtering uses premultiplied color internally and returns straight
alpha. Float resize propagates NaN and infinity. It does not replace them with
zero. RGBA input that explicitly declares premultiplied alpha is rejected
before resampling. The current resize kernels accept straight-alpha input or
the existing unspecified-alpha compatibility path.

Planar YUV and arbitrary-angle high-depth rotation remain unsupported. An
unsupported transform returns `UNSUPPORTED_OPERATION` before pixel decoding
instead of quietly converting the input.

## Explicit conversion

`convertPixelFormat()` is the public precision-change operation:

```ts
const output = await image
  .convertPixelFormat({ format: 'rgb8' })
  .jpeg({ quality: 85 })
  .toBuffer()
```

Integer conversion maps the complete source range to the complete destination
range and rounds to nearest. An 8-bit value converted to 16-bit is multiplied
by 257. Float input requires one explicit finite range for the complete
operation. The minimum must be smaller than the maximum. Integer input does
not accept a range because its complete storage range is already defined:

```ts
const output = await image
  .convertPixelFormat({
    format: 'gray16',
    range: { minimum: -1, maximum: 3 },
  })
  .png()
  .toBuffer()
```

Adding alpha requires an explicit normalized `alpha` value. Removing alpha
requires either `{ mode: 'discard' }` or an explicit `#RRGGBB` background.
Conversion is row-streaming. It never infers a float range from one block.
Explicitly premultiplied RGBA input is rejected because conversion does not
currently include an unpremultiply policy.

## Default and linear-light resize

Default resize keeps the historical encoded-sample behavior and existing
8-bit output bytes. Use `colorSpace: 'linear-light'` to decode a known sRGB
transfer function before filtering:

```ts
const output = await image
  .resize({
    width: 800,
    height: 600,
    fit: 'inside',
    kernel: 'lanczos3',
    colorSpace: 'linear-light',
  })
  .png()
  .toBuffer()
```

The opt-in mode supports 8-bit and 16-bit RGB or RGBA pixels with declared
sRGB or linear transfer semantics. RGBA is premultiplied before filtering and
unpremultiplied safely afterward. Unknown transfer functions and arbitrary ICC
profiles are rejected.

## Encoder conversion

PNG accepts `gray16`, `rgb16`, and `rgba16` directly. JPEG and other 8-bit-only
encoders receive a terminal conversion when their declared input formats
require one. The internal execution plan records that conversion as imposed by
the encoder. Missing transform support never triggers an automatic conversion.

Native 16-bit PNG pixels with source-profile color semantics require
`.keepIcc()` before PNG output. Container color signaling that cannot be
preserved is rejected. The encoder does not write untagged pixels while still
claiming source-profile semantics.

## Memory behavior

Crop, conversion, and resize stream bounded row blocks. Resize retains only
the horizontal rows required for the current vertical filter. Quarter turns
and EXIF orientations use bounded 32 by 32 tiles in the selected temporary
store. Node can opt into file-backed temporary storage; browsers use the
existing memory, OPFS, or IndexedDB adapter.

Adam7 PNG decode retains compact native samples needed across passes. That
state scales with the requested image region and is the remaining native-sample
full-image fallback. Arbitrary-angle rotation keeps its existing temporary
storage implementation and remains limited to 8-bit pixels.
