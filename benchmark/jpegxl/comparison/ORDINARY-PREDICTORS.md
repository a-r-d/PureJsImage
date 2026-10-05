# JPEG XL ordinary predictor refinement, October 3, 2026

Scoring predictors over every pixel reduces four files from the retained
ordinary encoder. Sampling can choose a predictor that encodes worse over the
complete leaf, even when the tree partitions and color transforms are already
effective. Overall compression parity remains open.

The preceding calibration and common-tree controls are in
[PREDICTOR-CALIBRATION.md](PREDICTOR-CALIBRATION.md). The qualified production
comparison remains in [PARITY.md](PARITY.md).

## What changes

The experiment copies the current first-party encoder and preserves its
grouping, color-transform, palette and squeeze policies. It keeps the original
sampled partitions, candidate predictors, 256-leaf limit per channel, depth 16
and 128-model ceiling. Ordinary training uses the original 65,536-position
ceiling; existing patch groups retain their 16,384-position policy.

Within each fixed leaf, complete pixel histograms score the original channel
predictor, gradient predictor and weighted predictor. The score is empirical
token entropy plus extra bits under the existing 4/2/0 integer scheme. Ties
keep the previous predictor. The encoder rebuilds residuals and clusters and
encodes the models using the existing policies.

The raw variant refines predictors before the original candidate selection.
The guarded variant finishes the original learned group and its integer-coding
choices, then compares a refined encoded group. It keeps the previous group
when refinement loses or an optional allocation reaches the existing limit.
It does not run a second complete ordinary image encoding.

## Complete-file results

| Input | Retained ordinary file | Raw refined file | Guarded file | Bytes saved | Changed predictor leaves |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-1416 | 649,404 | 648,383 | 648,383 | 1,021 | 157 |
| im26-2018 | 613,268 | 612,152 | 612,152 | 1,116 | 181 |
| Red dither | 617,106 | 615,996 | 615,996 | 1,110 | 168 |
| 513-pixel crop | 227,797 | 227,749 | 227,749 | 48 | 26 |

Sizes include the complete file. All four selected files have exactly the same
branches, leaf contexts, offsets, multipliers and color transforms as their
ordinary baselines. All retain one 1,024-pixel group and no reference frames.

| Input | Header change, bytes | Remaining data change, bytes | Outer change, bytes |
| --- | ---: | ---: | ---: |
| im26-1416 | +24.75 | -1,045.75 | 0 |
| im26-2018 | -54.25 | -1,061.75 | 0 |
| Red dither | -31.875 | -1,078.125 | 0 |
| 513-pixel crop | +30.875 | -78.875 | 0 |

These physical bit counts reconcile every complete-file change. Fractional
bytes describe fields that share bytes with following data.

For im26-2018, the experimental 612,152-byte file is smaller than the pinned
jSquash file at 613,245 bytes and wasm-vips file at 621,262 bytes. For
im26-1416, the experimental 648,383-byte file is 4,286 bytes larger than
jSquash and 1,004 bytes smaller than wasm-vips. These two results do not
establish parity on the other inputs or on lossy encoding.

## Validation and remaining work

All 12 files reproduce every original sample with the native libjxl, Rust and
public JavaScript decoders. The two independent decoders cover 75,509,760
samples across 24 grids. Public decoding covers 37,754,880 samples with complete,
nonduplicate pixel coverage. Alpha and hidden RGB are included. A separate
audit rereads every independent sample and verifies all input, source, helper,
tool and artifact hashes. Encoder allocations close after each encoding.

The [controls](results/ordinary-refined-predictor-tree-controls.json),
[physical profile](results/ordinary-refined-predictor-tree-program-profile.json)
and [audit](results/ordinary-refined-predictor-tree-audit.json) contain the exact
files, sizes, bit accounts and validation evidence.

The prototypes add full-pixel scoring, reconstruction and encoding work. Their
single diagnostic runs take longer; those observations are not paired runtime
qualification. Managed allocation peaks also differ and do not prove an RSS
improvement. The original paired runtime and RSS limits, minimum working-memory
behavior, process limits and package-size ceilings still apply.

Production source and the qualified public comparison remain unchanged. Before
adoption, the additional work and package bytes need to fit the existing limits,
followed by the complete public input matrix, browser, memory and paired cost
checks. The next implementation test should fuse refinement with existing
residual construction and remove repeated work while preserving the encoded
group fallback.
