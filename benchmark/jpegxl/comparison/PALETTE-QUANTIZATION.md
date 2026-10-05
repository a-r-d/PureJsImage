# JPEG XL palette quantization controls, October 3, 2026

Private first-party palette controls demonstrate smaller files on the pinned text
graphic. They also expose a perceptual-quality tradeoff. None is integrated into
the production lossy encoder or qualifies a matched-quality target. Overall
compression parity remains open.

The current im26-5034 diagnostic graphic contains 269 visible RGBA colors. Its
qualified 37,687-byte output preserves every pixel exactly. The current lossy
encoder selects this same exact file across all tested quality settings, so its
lower quality targets remain unresolved.

The first control rounds the original sRGB channels to a fixed step, preserves
alpha, and passes the result through the unchanged first-party lossless effort-7
encoder. Quality tools compare the decoded result with the original pixels.

| Step | Bytes | SSIMULACRA2 | Butteraugli | Maximum channel change |
| --- | ---: | ---: | ---: | ---: |
| 1, exact baseline | 37,687 | 100.000 | 0.000 | 0 |
| 2 | 35,845 | 93.348 | 0.921 | 1 |
| 4 | 31,821 | 91.968 | 0.919 | 2 |
| 8 | 28,178 | 92.380 | 1.285 | 4 |
| 16 | 22,214 | 89.997 | 6.157 | 8 |
| 32 | 15,993 | 86.425 | 7.928 | 16 |
| 64 | 11,239 | 59.103 | 21.052 | 32 |
| 128 | 7,916 | 52.647 | 40.418 | 64 |

Higher SSIMULACRA2 and lower Butteraugli indicate better quality. Their results
need to be read together: the step-16 file has a score near 90, but its Butteraugli
error is much higher than the finer steps. The curve is also nonmonotonic.
Smaller files alone do not justify adopting this policy.

A second control preserves the four most frequent original colors before
rounding the other colors. It selects anchors from the complete input with
deterministic tie breaking. It uses no fixture-specific color constants or quality
feedback.

| Step with dominant colors preserved | Bytes | SSIMULACRA2 | Butteraugli |
| --- | ---: | ---: | ---: |
| 16 | 23,646 | 90.053 | 6.157 |
| 32 | 18,431 | 86.599 | 7.928 |
| 64 | 12,051 | 73.079 | 21.052 |

Preserving these colors helps aggregate quality at step 64, but fails to reduce
the peak Butteraugli error. This rejects the hypothesis that preserving the four
most common colors would solve that error. A further control needs evidence
about where the error occurs before selecting another quantization policy.

All eleven complete files pass 22 native and Rust decoder grids containing
92,274,688 quantized samples. Alpha stays identical to the original input.
The independent audits derive every expected quantized pixel, check PNG geometry,
rerun both pinned metrics within 1e-9, and retain the exact qualified baseline.
These checks prove valid coding of the deliberately changed colors; they do not
claim original colors remain lossless.

The input is the complete pinned 1024 by 1024 graphic. No resized or cheaper
fixture replaces it. One-off timings exclude preprocessing and are diagnostic
only. The controls provide no public distance mapping, matched-target result,
speed claim, general memory guarantee or production adoption.

The original transparency fixture contains 95,507 visible RGBA colors, while the
two photo inputs contain 74,377 and 128,099. These counts prevent assuming that a
small-palette policy would also close their gaps.

Evidence:

- [All eight rounded-palette files and metrics](results/palette-quantization-controls.json)
- [All three dominant-color controls](results/dominant-palette-quantization-controls.json)
- [Current qualified lossless files](results/parity-funded-sampling-effort7-public.json)
