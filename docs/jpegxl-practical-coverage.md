# JPEG XL practical coverage gaps

## Quick Answer

The explicit JPEG XL native APIs now map binary16 and binary32 gray or RGB
samples with mixed alpha to straight RGBA16. They also write shifted native
planes across multiple Modular groups. High-depth ICC display conversion,
selective HDR progressive stages, and exact grayscale JPEG reconstruction are
still pending.

| Requested feature | Supported input | Public API and result | Test or independent reference | Remaining boundary |
| --- | --- | --- | --- | --- |
| Float and alpha display | Modular binary16 or binary32 gray/RGB; integer, binary16, or binary32 alpha; straight or associated; alpha shift 0–3 | `convertJpegXlFloatLayerToRgba16()` returns straight RGBA16, the display range, source color meaning, and output meaning. `jpegXlNativeUnsignedPlanes()` retains bit patterns. | `tests/jpegxl-float-display.test.ts`, `tests/jpegxl-m10-level10.test.ts`, Chromium color test, pinned libjxl binary32 native fixture | Independent rendered comparisons for all mixed precision cases remain pending. Non-IEEE float layouts are unsupported. |
| High-depth ICC and gray plus alpha | Existing 8-bit GRAY/RGB and CMYK profile families | `Image.open({ colorOutput: 'srgb' })` has the existing 8-bit path. High-depth conversion has no new result. | Existing M4 color and M8 native tests | 10-, 12-, and 16-bit source to 16-bit output, mixed alpha, and gray plus alpha need a direct high-depth color evaluator and pinned color-management comparison. |
| Shifted native writing | Integer or IEEE binary16/binary32 extra planes with shift 0–3; odd multi-group images | `encodeJpegXlNative()` writes native group sections and `openJpegXlSequence().layers()` returns each native grid. | Two-direction 1025×1027 test; `benchmark/jpegxl/verify-practical-shifted.ts` pins libjxl 0.12.0 decoded output digests and jxl-oxide channel layout | Independent decoding currently returns upsampled display planes; exact native-grid comparison by an independent tool remains pending. |
| Progressive alpha and HDR | Existing selective 8-bit SDR XYB cases | `openJpegXlSession()` keeps the existing selective stages and declared fallbacks. | Existing session and progressive tests | Selective SDR alpha and high-depth linear/PQ color and alpha stages need encoded-stage inventory, implementation, and resource evidence. |
| Exact grayscale JPEG reconstruction | Existing three-component 8-bit Huffman JPEGs | `transcodeJpegToJpegXl()` and `reconstructJpegFromJpegXl()` retain the three-component exact path. | Existing JPEG reconstruction suite | One-component baseline and progressive JPEGs need a coefficient writer, byte reconstruction, independent reconstruction, and cancellation tests. |

The float display conversion rejects NaN and infinity in either color or alpha.
It straightens associated color in its native numeric domain before applying
`(color - black) / (white - black)`. Alpha is normalized from its own sample
range and never uses the color display range. Associated color with zero or
negative alpha becomes zero. Finite color outside the display range is clipped.
The returned `colorSemantics` identifies the straight RGB output; its transfer
and primaries are unspecified because the caller chose an arbitrary numeric
range. `sourceColorSemantics` retains the encoded color and alpha association.
Native sample arrays and the original layer header are unchanged.
