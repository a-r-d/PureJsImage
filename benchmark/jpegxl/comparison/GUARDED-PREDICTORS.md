# JPEG XL predictor fallback, October 3, 2026

The optional predictor refinement now preserves the previous complete encoded
group as a file-size fallback. It retains all four smaller files from
[ORDINARY-PREDICTORS.md](ORDINARY-PREDICTORS.md). Production remains unchanged.
Overall compression parity remains open.

| Input | Retained ordinary file | Guarded refinement | Bytes saved |
| --- | ---: | ---: | ---: |
| im26-1416 | 649,404 | 648,383 | 1,021 |
| im26-2018 | 613,268 | 612,152 | 1,116 |
| Red dither | 617,106 | 615,996 | 1,110 |
| 513-pixel crop | 227,797 | 227,749 | 48 |

## Preserving the previous result

The encoder completes the existing group search, including its hybrid coding
choices, before comparing the refined group. It accepts the refinement only
when its complete encoded bytes are smaller. Lower empirical predictor cost
alone cannot establish that guarantee.

Full-pixel scoring shares the original context traversal and weighted predictor
work. The prototype caches only weighted predictions needed by leaves that
change from another predictor to the weighted predictor. It reuses the learned
residual buffer and supplies clustering with the collected histograms.

When deterministic training already visits every pixel, the prototype skips
the new scoring and scratch. Two exhaustive controls preserve the exact original
models and allocation peaks. A sampled photo crop uses 981 cached predictions
for 134,829 residuals. Its refined model matches every residual, context, node
and histogram from the preceding full replay. Two other controls verify the
matching fallback when neither encoder needs a learned tree.

## Encoding cost

The first guarded prototype repeated plain, LZ and global hybrid trials for
the refined model. Its CPU profile places 14.35% of samples in the optional
refinement encoding. All four smaller files use per-histogram coding.

The next prototype tries that coding once for refinement after a complete
original learned group without LZ has been selected. It retains every original
search candidate and reproduces all four earlier smaller files exactly.

| Input | Original seconds | Selective refinement seconds |
| --- | ---: | ---: |
| im26-1416 | 27.773 | 30.377 |
| im26-2018 | 33.137 | 36.434 |
| Red dither | 34.449 | 36.623 |
| 513-pixel crop | 10.670 | 11.852 |

These are single observations. They still show added work and do not qualify
the original 5% paired median and 95% bootstrap upper limits. Tracked buffer
peaks are lower on these four inputs; process RSS requires separate measurement.

## Validation and remaining work

The full and selective guarded controls contain 16 files and 32 native libjxl
and Rust grids. They verify 100,679,680 original samples with zero error,
including alpha and hidden RGB. Source public decoders verify another
50,339,840 samples with complete, nonduplicate coverage. Every encoder closes
its owned allocations. The four file hashes match the preceding physical
predictor profiles.

Evidence:

- [Complete guarded controls](results/guarded-fused-predictor-tree-controls.json).
- [Strict CPU sample analysis](results/guarded-fused-cpu-sample-profile-typed.json).
- [Exhaustive, fallback and sparse-cache checks](results/guarded-fused-learner-boundary-controls-retry.json).
- [Selective guarded controls](results/guarded-selective-predictor-tree-controls.json).

Before adoption, the prototype still needs qualified paired runtime and RSS,
the complete original working-memory fallback, unchanged package ceilings,
real browser execution and the full public lossless and matched-quality lossy
matrices. The earlier raw fused bundle measurements do not establish the size
of this guarded implementation. Existing production files and support claims
remain unchanged.
