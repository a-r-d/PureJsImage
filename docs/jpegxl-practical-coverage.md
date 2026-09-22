# JPEG XL practical coverage gaps

## Quick Answer

The explicit JPEG XL native APIs now map binary16 and binary32 gray or RGB
samples with mixed alpha to straight RGBA16. They also write shifted native
planes across multiple Modular groups. The explicit ICC native-layer API now
converts supported GRAY, RGB, and CMYK profiles to straight sRGB16. Selective
HDR progressive stages and exact grayscale JPEG reconstruction are pending.

| Requested feature | Supported input | Public API and result | Test or independent reference | Remaining boundary |
| --- | --- | --- | --- | --- |
| Float and alpha display | Modular binary16 or binary32 gray/RGB; integer, binary16, or binary32 alpha; straight or associated; alpha shift 0–3 | `convertJpegXlFloatLayerToRgba16()` returns straight RGBA16, the display range, source color meaning, and output meaning. `jpegXlNativeUnsignedPlanes()` retains bit patterns. | `tests/jpegxl-float-display.test.ts`, `tests/jpegxl-m10-level10.test.ts`, Chromium color test, pinned libjxl binary32 native fixture | Independent rendered comparisons for all mixed precision cases remain pending. Non-IEEE float layouts are unsupported. |
| High-depth ICC and gray plus alpha | Modular 8- through 16-bit integer GRAY/RGB/CMYK with a supported profile; integer or IEEE alpha, straight or associated | `convertJpegXlIccLayerToRgba16()` evaluates source curves at 16-bit precision and returns straight sRGB16 and source/output color meaning. Gray plus alpha expands to RGBA16. | `tests/jpegxl-icc16.test.ts` pins profile hashes and LittleCMS 2.16 perceptual sRGB16 samples; Chromium color test | The ordinary pixel pipeline still rejects high-depth ICC conversion. Unrecognized profile families stay unsupported. This API retains full output and input planes. |
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

The high-depth ICC evaluator reads supported GRAY `kTRC`, RGB matrix/curve or
`mAB`, and CMYK `mft2` A2B0 profiles. The CMYK reference uses the perceptual
intent selected by A2B0. The test pins all three profile hashes and compares
16-bit output with LittleCMS 2.16 using an sRGB target. CMYK uses a tolerance
of 350 in 65,535 codes because its 4D interpolation differs. The synthetic
RGB mAB fixture uses 1,300 codes because its trilinear CLUT sampling differs
from LittleCMS tetrahedral interpolation. RGB matrix profiles use 180 codes;
gray uses one code. The converter unassociates source color before evaluating
the profile, clips out-of-range samples, and sets associated zero-alpha color
to zero. The returned RGB values have straight alpha. It allocates a full
RGBA16 output and, when needed, an expanded Float64 alpha or black plane.
