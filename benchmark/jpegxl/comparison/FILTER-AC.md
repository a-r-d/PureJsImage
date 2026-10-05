# JPEG XL photo filtering and AC symbol reuse, October 4, 2026

The current encoder uses a lower maximum restoration sharpness for eligible
opaque RGBA8 sRGB photos at effort 7 and distance 2 or above. The policy retains
the existing limit of 4,194,304 pixels and the existing palette protections.
It also reuses exact packed AC symbols through one lazily initialized 32 KiB
module table, removing repeated packing and a duplicate group buffer.

The codec source SHA-256 for this photo checkpoint is
`5abf439d5dbdb53ad73ce5a5c9c414497cc770055e288dcfdfa51c0e0213f138`.
The later [repeated lossless colors](LOSSLESS-REPEATS.md) and
[lossless spatial coding](LOSSLESS-SPATIAL.md) and
[reversible-color search](LOSSLESS-RCT.md) checkpoints add effort-1
lossless compression improvements. These photo tables retain their own source.
The [production controls](results/filter-ac-production-controls.json) record
the source archives, original full cohort, cost studies, actual public packages,
independent decoders and Node and browser regressions. The earlier
[DC-only checkpoint](DC-MODELS.md) retains its original source and results.

## Matched quality and compressed size

Each estimate uses a nondominated SSIMULACRA2 bracket no wider than 0.25 score
points, with log-byte interpolation and no extrapolation. The same pinned input
samples and frozen jSquash 1.3.0 and wasm-vips 0.0.19 peer results are retained.
The two photo curves stay within the original 24-point-per-photo limit.

| Photo | SSIMULACRA2 | Current bytes | Versus jSquash | Versus wasm-vips |
| --- | ---: | ---: | ---: | ---: |
| im26-1030 | 70 | 47,299 | 2.28% larger | 3.00% larger |
| im26-1030 | 80 | 70,917 | 1.14% smaller | 0.55% smaller |
| im26-1030 | 90 | 144,647 | 8.94% smaller | 10.84% smaller |
| im26-1416 | 70 | 28,988 | 3.70% smaller | 14.06% smaller |
| im26-1416 | 80 | 44,494 | 5.21% smaller | 15.04% smaller |
| im26-1416 | 90 | 102,605 | 23.95% smaller | 27.61% smaller |

Both tested photos are smaller than both frozen peers at score 80. The first
photo at score 70 still exceeds wasm-vips by 3.00% and jSquash by 2.28%.
The table includes integrated DC compression and refined curve sampling.
Settings below distance 2 retain their previous encoding policy; differences
between score-90 estimates and the earlier DC table come from sampling.

The complete original cohort contains 32 lossless and 91 lossy files.
All lossless files keep identical bytes and samples. Of the lossy files,
64 keep identical bytes and 27 change under the eligible photo policy.
Those 27 files are slightly larger at their original fixed distance settings.
SSIMULACRA2 does not regress on any request; Butteraugli worsens in ten.
Both metrics, every original alpha sample, and all 246 complete native/Rust
grids are independently checked. The packed-symbol change alone preserves
the prior filter candidate's exact bytes and reconstructed samples.

The wider comparison remains at 13 adequately matched pairs and 11 unresolved
pairs. Several lossless inputs still exceed a frozen competitor result.
These measurements do not establish overall compression parity or a general
quality lead.

## Timing and memory

Each of three studies uses seven fresh alternating pairs, fourteen isolated
participants and twenty-eight complete cold/warm encodes. Both the paired
median and seeded 95% upper bound must pass the unchanged 5% timing guard and
the human-authorized 10% absolute peak-RSS allowance. Previous rejected filter
and sort trials remain separate, without pooling. The fixed module table is
included in process RSS; public managed image limits remain unchanged.

| Input | Measurement | Paired median change | 95% upper bound |
| --- | --- | ---: | ---: |
| First photo | cold | -1.71% | 0.23% |
| First photo | warm | -2.59% | 1.22% |
| First photo | coldMaximumRssKiB | 0.39% | 4.49% |
| First photo | maximumRssKiB | -1.37% | 2.50% |
| Second photo | cold | -3.09% | -1.02% |
| Second photo | warm | -2.79% | -0.67% |
| Second photo | coldMaximumRssKiB | -1.41% | 2.61% |
| Second photo | maximumRssKiB | 0.63% | 2.64% |
| Graphic | cold | 0.51% | 1.79% |
| Graphic | warm | 0.31% | 1.30% |
| Graphic | coldMaximumRssKiB | -1.16% | 4.09% |
| Graphic | maximumRssKiB | 0.83% | 2.28% |

The warm RSS value is the cumulative process peak after cold and warm encoding.
Photo variants can have different reconstructed pixels at the fixed request;
these studies do not measure speed at matched quality or competitor speed.

## Correctness and limits

The original budget and exact-family fixtures retain their 771, 10,986 and
2,262-byte outputs. Sixteen supported JPEG reconstruction operations retain
exact bytes; the existing YUV411 unsupported case remains explicit.
Deterministic optional DC allocation failures reproduce the directly serialized
fallback on both sync and async paths. Ten fresh independent recovery grids
and first-party complete coverage preserve the current filtered pixels.

Actual production packages remain below the original size ceilings, with the
same exports and zero runtime dependencies. All 85 focused maintained tests
and 18 cases across Chromium, Firefox and WebKit pass. The repository-wide
check remains a separate final gate.
