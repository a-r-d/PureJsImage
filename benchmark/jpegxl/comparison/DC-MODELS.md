# JPEG XL learned DC compression, October 4, 2026

This records the earlier DC-only checkpoint. The later integrated
[photo filter and AC symbol reuse](FILTER-AC.md) retains its separate source
and measured quality changes.

The integrated encoder now learns a bounded model for color DC coefficients.
It writes the original representation first and selects the learned model only
when its complete serialized section is smaller. It also avoids repeated AC
clustering logarithms and scans only occupied histogram bins. Quantization,
filtering, coefficients, metadata and public working-memory limits stay the same.

The production codec source SHA-256 is
`3e618acf293fa2edfbd6aaed077f372a42562293cf10c451be21d03c390ccebb`.
The [production proof](results/dc-ac-kernel-production-controls.json) records
the private candidate, source archives, actual packages and validation.
Earlier snapshots retain their original source identities.

## Compression at the same decoded quality

The full original matrix contains 32 lossless and 91 lossy requests.
The 32 lossless files keep identical bytes. Of the lossy files, 67 shrink and
24 keep identical bytes; none grows. All 246 complete native and Rust decoder
grids retain each decoder's previous samples, including original alpha and
16-bit lossless samples. Both quality metrics remain unchanged.

The table uses the original adequate quality endpoints for both complete photos.
Each score bracket is at most 0.25 wide. Sizes use log-byte interpolation without
extrapolation. Peer estimates remain the frozen jSquash 1.3.0 and wasm-vips
0.0.19 results from the same input samples; neither peer was re-encoded.

| Photo | SSIMULACRA2 | Previous bytes | Integrated bytes | Versus jSquash | Versus wasm-vips |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-1030 | 70 | 49,466 | 47,541 | 2.81% larger | 3.53% larger |
| im26-1030 | 80 | 74,530 | 72,269 | 0.74% larger | 1.34% larger |
| im26-1030 | 90 | 145,357 | 142,618 | 10.21% smaller | 12.09% smaller |
| im26-1416 | 70 | 31,149 | 29,715 | 1.29% smaller | 11.90% smaller |
| im26-1416 | 80 | 46,970 | 45,486 | 3.10% smaller | 13.15% smaller |
| im26-1416 | 90 | 104,253 | 102,616 | 23.94% smaller | 27.60% smaller |

The first photo's score-80 gap to wasm-vips falls from 4.51% to 1.34%.
The broader comparison still has 13 adequate pairs and 11 unresolved pairs.
Several lossless inputs also remain larger than a frozen competitor result.
Overall compression parity remains open.

## Timing and memory

Three fresh studies each use seven alternating pairs, fourteen isolated
participants and twenty-eight complete cold/warm encodes. Both paired medians
and seeded bootstrap 95% upper bounds pass. The timing allowance remains 5%.
The human-authorized absolute peak RSS allowance is 10%; process RSS is measured
separately from managed encoder allocations.

| Workload | Cold time upper | Warm time upper | Cold RSS upper | Warm process RSS upper |
| --- | ---: | ---: | ---: | ---: |
| im26-1030 photo | +2.583% | -0.887% | +8.535% | +7.993% |
| im26-1416 photo | -1.915% | -0.057% | +6.727% | +4.876% |
| im26-5034 graphic | +1.328% | +0.643% | +1.199% | +3.674% |

The original 5% RSS allowance would fail upper bounds on both photos. The extra
allowance therefore matters to this retained model. Original inputs, options,
settled garbage collection, exact streams, working budgets and package ceilings
remain protected. Earlier failed hypotheses and observations remain separate.
These studies compare PureJsImage builds; they establish no WASM speed ranking.

## Production checks

The protected palette, natural 1.5 MiB working-budget fallback and family-context
fixtures keep their original streams. Exact JPEG reconstruction retains all
nine original source classifications and sixteen supported operations; the
two unsupported operations remain unsupported.

A permanent textured-gradient regression shrinks from 4,863 to 4,184 bytes
while retaining every decoded sample. Deliberately rejecting optional model
allocation in synchronous and asynchronous encoding recovers the original bare
codestream exactly and releases all scratch memory.

Actual production packages measure 539,824 bytes for core plus JPEG XL and
612,049 bytes for the specialized APIs, within the unchanged 541,000 and
614,000-byte ceilings. Eighteen real browser cases pass, six each in Chromium,
Firefox and WebKit, including compression, allocation recovery, palette,
working-budget fallback and family contexts. The published package retains
zero runtime dependencies and the codecs remain first-party pure JavaScript.

The separate filter combination and constant-feature sort experiments remain
private. Their output screens do not qualify production adoption or a broader
compression claim. Full repository checks are recorded separately from these
production and browser controls.
