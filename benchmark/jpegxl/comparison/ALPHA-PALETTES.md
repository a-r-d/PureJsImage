# JPEG XL alpha compression, October 5, 2026

## Quick answer

The first-party alpha model reduces the pinned transparency fixture from
48,819 to 9,038 bytes at the same distance setting. Every decoded color and
alpha sample stays unchanged in libjxl and Rust. A higher-quality 9,155-byte
point is smaller than the frozen 9,307-byte wasm-vips point and scores better
on both SSIMULACRA2 and Butteraugli. Overall lossy parity remains open.

## Same pixels, smaller files

The input is the original 1024 × 1024 `alpha_triangles` RGBA8 fixture.
Quality uses the worse result across black and white backgrounds: minimum
SSIMULACRA2 and maximum Butteraugli. The encoder preserves every original alpha
sample. These are measured settings, without interpolation.

| Distance | Previous bytes | Current bytes | SSIMULACRA2 | Butteraugli |
| --- | ---: | ---: | ---: | ---: |
| 3.8 | 49,010 | 9,229 | 90.49518 | 1.24822 |
| 4 | 48,936 | 9,155 | 90.55154 | 1.31840 |
| 4.3026 | 48,819 | 9,038 | 90.01479 | 1.40644 |
| 11.503 | 47,112 | 7,331 | 80.02525 | 4.69272 |
| 16.22 | 46,530 | 6,749 | 70.22781 | 8.26368 |

The three original quality coordinates shrink by 81.5%, 84.4% and 85.5%.
The inversion between distances 3.8 and 4 remains in the raw measurements.
Successful decoding alone does not establish unchanged quality: both complete
independent pixel grids and both measured quality scores match the preceding
production output.

## Comparator evidence

The frozen wasm-vips 0.0.19 distance-6.2734 point has exact original alpha,
9,307 bytes, SSIMULACRA2 90.39107 and Butteraugli 1.47299. PureJsImage distance
4 uses 152 fewer bytes, a higher SSIMULACRA2 score and a lower Butteraugli score.
This proves dominance of that measured point. It does not manufacture an
adequate interpolation bracket at target 90 or change the frozen comparison's
13 adequate and 11 unresolved pair counts.

The [peer audit](results/alpha-peer-audit.json) checks all 96 frozen refined
alpha streams against the original geometry, encoded hashes and every alpha
sample. Historical metric scores are carried from the frozen report. All 24
jSquash points alter alpha; 15 of 24 wasm-vips points preserve it. Exact-alpha
wasm-vips points have no adequate target-70 or target-80 interpolation brackets
in the original sampled public domain. Other wrappers' lossy defaults may alter alpha, and those errors remain
visible. No changed-alpha result is relabeled exact or called incorrect solely
for differing from PureJsImage's guarantee.

The later [direct transparency comparison](ALPHA-POINTS.md) freshly verifies
the six selected peer/target files against current output. All six pass size
and both aggregate quality metrics. This separate evidence preserves the
original interpolation failures and records each peer's alpha changes.

## Implementation and boundaries

The encoder tries a local scalar palette with at most 16 alpha values. Eligible
multi-group effort-7 images also try one shared prediction tree and entropy
model, with predictor state reset at each actual group boundary. The search
uses the existing first-party tree learner and ANS writer. It copies no native
or WASM codec implementation.

The shared search requires default quantization, existing ANS geometry and
2–64 groups. Raw alpha values outside the native unsigned 16-bit range retain
the preceding path. The optional search retains the complete original file
when it cannot fit the working budget or cannot reduce the total section and
table-of-contents size. Cancellation unwinds owned scratch and output buffers.

Small-palette RGBA8 artwork eligible for the existing exact Modular candidate
keeps its preceding alpha search. A smaller lossy alpha stream must not bypass
that established exact-color choice. The regression tests retain the original
13,807-byte files and exact visible colors for varying and hidden alpha.

The core bundle grows from 540,986 to 544,048 bytes (0.57%). The specialized
bundle grows from 613,208 to 616,453 bytes (0.53%). Internal size ceilings rise
from 541,000/614,000 to 545,000/617,000 bytes for this measured compression gain.
The earlier private ceiling failures remain recorded. Public exports, package
version and zero runtime dependencies remain unchanged. The search adds work;
this checkpoint does not establish speed or RSS parity.

For the one-megapixel fixture, the encoder's managed backing-buffer peak rises
from about 15.4 MB to 36.9 MB. This counter excludes the process heap, caller
input and native metric tools. A smaller explicit working limit retains the
preceding complete file. This is an intentional compression-first tradeoff.

## Reproduction

[Production controls](results/alpha-palette-production-controls.json) pin the
actual source, public packages, original inputs, encoded artifacts, both full
decoder grids and metric tools. [Frozen boundary grids](results/alpha-palette-native-baseline.json)
cover native 8/16-bit samples, progressive output, partial groups, two DC groups,
prefix and ANS geometry, and the original low working budget.

```sh
node benchmark/jpegxl/comparison/verify-alpha-palettes.ts .tmp/alpha-palettes.json
npx vitest run tests/jpegxl-alpha-palette.test.ts
```

The independent verifier requires the pinned development libjxl and jxl-rs
tools. Focused tests retain frozen complete-file size ceilings and decoded
checksums. Full repository and browser gates are recorded separately.
