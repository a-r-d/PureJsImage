# JPEG XL practical coverage gaps

## Quick Answer

The explicit JPEG XL native APIs now map binary16 and binary32 gray or RGB
samples with mixed alpha to straight RGBA16. They also write shifted native
planes across multiple Modular groups. The explicit ICC native-layer API now
converts supported GRAY, RGB, and CMYK profiles to straight sRGB16. Selective
VarDCT sessions emit early SDR alpha and 16-bit SDR, linear, and PQ stages
for the supported XYB cases. Exact one-component Huffman JPEG transcoding
reconstructs the original bytes.

| Requested feature | Supported input | Public API and result | Test or independent reference | Remaining boundary |
| --- | --- | --- | --- | --- |
| Float and alpha display | Modular binary16 or binary32 gray/RGB; integer, binary16, or binary32 alpha; straight or associated; alpha shift 0–3 | `convertJpegXlFloatLayerToRgba16()` returns straight RGBA16, the display range, source color meaning, and output meaning. `jpegXlNativeUnsignedPlanes()` retains bit patterns. | `tests/jpegxl-float-display.test.ts`, `tests/jpegxl-m10-level10.test.ts`, Chromium color test, 17 pinned libjxl 0.12.0 float color/alpha PFM references, including 8-bit integer alpha and a shifted case | Wider integer alpha depths and other shifted combinations lack independent rendered references. Non-IEEE float layouts are unsupported. |
| High-depth ICC and gray plus alpha | Modular 8- through 16-bit integer GRAY/RGB/CMYK with a supported profile; integer or IEEE alpha, straight or associated | `convertJpegXlIccLayerToRgba16()` evaluates source curves at 16-bit precision and returns straight sRGB16 and source/output color meaning. Gray plus alpha expands to RGBA16. | `tests/jpegxl-icc16.test.ts` pins profile hashes and LittleCMS 2.16 perceptual sRGB16 samples; Chromium color test | The ordinary pixel pipeline still rejects high-depth ICC conversion. Unrecognized profile families stay unsupported. This API retains full output and input planes. |
| Shifted native writing | Integer or IEEE binary16/binary32 extra planes with shift 0–3; odd multi-group images | `encodeJpegXlNative()` writes native group sections and `openJpegXlSequence().layers()` returns each native grid. | Two-direction 1025×1027 test; `benchmark/jpegxl/verify-practical-shifted.ts` pins libjxl 0.12.0 display output and jxl-oxide pre-upsampling native alpha, black and depth grids | The native-grid oracle uses a temporary instrumented decoder build; the ordinary jxl-oxide CLI exposes only rendered planes. |
| Progressive alpha and HDR | Static XYB VarDCT, 8- or 16-bit SDR RGB, 16-bit linear/PQ RGB, and single global alpha planes, including associated alpha with a 2x shift | `openJpegXlSession().progressive()` emits DC, available passes, and final RGB/RGBA blocks. The DC stage reads only LF sections. | `tests/jpegxl-practical-progressive.test.ts`, Chromium test, pinned libjxl 0.12.0 DC/pass or `djxl` final pixels | Alpha that needs AC-group Modular data, non-XYB gray and color, patches, references, noise, and splines keep declared static fallbacks. Pinned jxl-oxide partial decodes independently check SDR8 and linear16 first-pass RGBA and PQ16 first-pass alpha. Group-local alpha still needs its complete AC payload. |
| Exact grayscale JPEG reconstruction | One-component 8-bit Huffman baseline or progressive JPEG, including odd dimensions, restart markers, optimized tables, and checked display metadata | `transcodeJpegToJpegXl()` writes an exact grayscale JXL container; `reconstructJpegFromJpegXl()` restores every JPEG byte. `inspectJpegReconstructionEligibility()` reports support. | `tests/jpegxl-grayscale-exact.test.ts`, Chromium test, pinned libjxl 0.12.0 `cjxl` and `djxl` reconstruction and PGM pixels | Arithmetic, 12-bit, lossless, and unsupported orientation or color metadata remain ineligible. A temporary zero coefficient plane adds one grayscale coefficient-plane allocation during transcode. |

The shifted native-grid references come from jxl-oxide commit
`c0cc4c7ea57c1207f38ff2970d94757470613be4`, with samples captured
just before its extra-channel upsampling step. The 1025×1027 file has
513×514 alpha, 257×257 black, and 129×129 binary16 depth grids. All
263,682 alpha, 66,049 black, and 16,641 depth samples match the input
bit patterns. The encoded file is pinned by SHA-256 in the verifier.

The float display conversion rejects NaN and infinity in either color or alpha.
It straightens associated color in its native numeric domain before applying
`(color - black) / (white - black)`. Alpha is normalized from its own sample
range and never uses the color display range. Associated color with zero or
negative alpha becomes zero. Finite color outside the display range is clipped.
The returned `colorSemantics` identifies the straight RGB output; its transfer
and primaries are unspecified because the caller chose an arbitrary numeric
range. `sourceColorSemantics` retains the encoded color and alpha association.
Native sample arrays and the original layer header are unchanged.
The 17 float-display fixtures cover gray and RGB, both binary16/binary32
color and alpha pairings, 8-bit integer alpha, and straight and associated
alpha. One case shifts associated integer alpha by two pixels. The reference
files contain libjxl-decoded color and alpha floats. The pinned RGBA16 values
apply the caller's 0.25-to-1.25 display range to those decoded samples.
The 8-bit alpha comparisons allow one 16-bit output code of error because
libjxl writes the normalized alpha as binary32.

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

## Selective stage inventory and memory

The targeted static files encode three completed AC passes. The previous
selective planner sent all high-depth, linear, PQ, and alpha cases to the
static decoder. The new planner lists DC, two pass stages, and final for
the supported XYB cases. An embedded preview is unavailable in these
fixtures. A grouped full-resolution alpha plane still lists DC and pass
stages as unavailable. Grayscale JPEG-derived files use a separate
single-pass path and do not claim selective XYB stages.

| Pinned fixture | Encoded size | Color and alpha | Color groups | LF bytes read for DC | Managed DC peak | Managed full-session peak |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| `sdr-rgb16.jxl` | 922 B | SDR RGB16 | 4 | 273 B | 1,058,036 B | 7,541,706 B |
| `linear-rgb16.jxl` | 662 B | linear RGB16 | 4 | 271 B | 1,544,036 B | 7,541,448 B |
| `linear-rgba16-small.jxl` | 1,104 B | linear RGBA16, straight | 1 | 889 B | 1,513,646 B | 7,257,660 B |
| `pq-rgb16.jxl` | 2,842 B | PQ RGB16 | 4 | 372 B | 1,544,036 B | 7,554,271 B |
| `sdr-rgba8.jxl` | 322 B | SDR RGBA8, straight | 1 | 153 B | 189,108 B | 5,140,840 B |
| `pq-rgba16-small.jxl` | 661 B | PQ RGBA16, straight | 1 | 183 B | 238,260 B | 5,148,775 B |
| `sdr-rgba8-associated-shift2.jxl` | 324 B | SDR RGBA8, associated, 2x alpha grid | 1 | 153 B | 139,956 B | 5,054,824 B |
| `pq-rgba16-associated-shift2.jxl` | 3,010 B | PQ RGBA16, associated, 2x alpha grid | 4 | 506 B | 2,195,108 B | 8,124,524 B |

The four-group fixtures have two LF sections. Their first pass requires
seven section IDs: LF global, DC group, HF global, and four AC groups.
Each further pass adds four AC sections. The complete session releases
all managed bytes on close. Its source-byte counter counts section reads,
including repeat reads when the cache is disabled; it can exceed the
file size over several stages. The table records the counter immediately
after the DC stage. DC output retains compact LF and restoration data.
High-depth pass and final output retain full working planes. The
associated shifted PQ alpha fixture uses four color groups and one
global 150x135 alpha plane. The 300x270 full-resolution alpha fixture
needs group-local alpha sections and uses the existing static fallback.

The 200×180 linear RGBA16 fixture came from a 16-bit PAM with a
horizontal red ramp, vertical green ramp, constant blue value 32,768, and
constant alpha value 32,768. Pinned `cjxl` 0.12.0 encoded it as progressive
VarDCT with linear sRGB signaling. Pinned `djxl` 0.12.0 produced the color
and alpha PFM references.

The linear RGBA16 first pass is compared against pinned jxl-oxide
`c0cc4c7` color and alpha output from the first 1,086 of 1,104 encoded
bytes. Every channel differs by less than 0.000005 in linear units. The
final stage is compared against pinned libjxl 0.12.0 color and alpha PFM
output. Its maximum channel error is below 0.000005
in linear units. Every early stage retains the encoded half-opacity alpha.
The DC stage reads 889 of 1,104 encoded bytes.

The SDR8 RGBA first pass matches a pinned jxl-oxide partial decode
from the first 314 of 322 encoded bytes within one 8-bit code. The PQ16
RGBA first-pass alpha matches a pinned partial decode from the first 450
of 661 encoded bytes exactly. These checks use every pixel in each frame.

The SDR16 DC and first pass are compared against pinned libjxl
`JxlDecoderFlushImage` output to within one 16-bit code. The linear
and PQ DC and final stages are compared against pinned `djxl` output
in the same linear light units. The SDR8 and PQ16 alpha final stages
match pinned `djxl` output within one 8-bit code or 0.00011 in float
units, respectively. Their early alpha values are checked against the
known encoded input. Pinned libjxl did not emit intermediate alpha
flushes for these files, so independent alpha pass images are still
unavailable. The Chromium fixture runs the PQ DC cases and grayscale
exact reconstruction.

## Exact grayscale JPEG evidence

The four pinned one-component JPEGs cover 17x9 baseline, 37x29
progressive, 513x267 baseline with restart markers, and 1025x517
progressive with restart markers. The progressive files use optimized
Huffman tables. Both first-party transcoding and pinned libjxl
`cjxl` output reconstruct byte-for-byte through the public API.
Pinned `djxl` 0.12.0 also reconstructs the first-party outputs to
the original JPEG bytes. First-party gray8 pixels from both JXL
encoders differ from pinned `djxl` PGM pixels by at most one code
(RMSE at most 0.51). The tests cover an added COM marker, nonidentity
Exif rejection, malformed data, sink cancellation, and both outcomes
of `onlyIfSmaller`.

The grayscale transcode creates one temporary all-zero coefficient
plane for the two unused internal VarDCT channels. It accounts for
that plane in `managedPeakBytes` and rejects a caller's
`maxDecodedBytes` limit if the source coefficients and this plane
would exceed it. The 1025x517 sample JPEG is 114,999 bytes and the
first-party JXL is 88,961 bytes; its original JPEG bytes are restored.
