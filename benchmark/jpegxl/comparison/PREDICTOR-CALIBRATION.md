# JPEG XL predictor calibration, October 3, 2026

Predictors that minimize sampled leaf costs can differ from predictors that
minimize costs over every pixel. On the two problem photos, changing the final
integer coding scheme has much less effect on sampled choices than using the
complete pixels. This supports testing leaf predictor refinement while keeping
tree splits fixed. Overall compression parity remains open.

The preceding cost and allocation controls are in
[RESIDUAL-MODELS.md](RESIDUAL-MODELS.md). The retained production comparison is
in [PARITY.md](PARITY.md).

## What the calibration measures

The original first-party decoder observer captures each actual leaf context and
packed residual. Existing fixed and weighted predictors then replay the coded
group planes, with prediction history reset at every group. Every chosen
predictor must reproduce the actual packed residual exactly. Candidate
predictors are those used in the same coded channel plus the existing gradient
and weighted predictors. Tree decisions and local color transforms remain fixed.

The profile scores empirical token entropy plus hybrid extra bits over all
pixels and over the exact original 65,536 deterministic training positions per
channel. It scores both the training scheme, 4/2/0, and each leaf's final model
integer configuration. A regret is the chosen predictor's estimated cost minus
the lowest candidate cost within that fixed leaf. These are estimated costs;
changing predictors also changes model clustering, headers and final coding.

All eight raw common trees have zero sampled-optimum violations under the
training scheme. Their chosen predictors minimize sampled costs within the
observed candidate subset. The baseline and floor use the same global sample
for diagnosis, with a separate label because some originated from per-group
training.

| Raw tree and input | Full-pixel regret, training scheme | Full-pixel regret, final scheme | Sampled regret, final scheme |
| --- | ---: | ---: | ---: |
| Global budget, im26-1416 | 16,084.879 | 15,547.764 | 22.258 |
| Global budget, im26-2018 | 16,883.851 | 16,438.570 | 1.980 |
| Global budget, red dither | 12,568.068 | 12,599.747 | 46.094 |
| Global budget, 513-pixel crop | 658.592 | 679.896 | 13.578 |
| Reserved budget, im26-1416 | 16,076.756 | 15,597.554 | 31.109 |
| Reserved budget, im26-2018 | 14,033.083 | 13,867.542 | 0.000 |
| Reserved budget, red dither | 12,634.003 | 12,521.637 | 14.243 |
| Reserved budget, 513-pixel crop | 658.592 | 679.896 | 13.578 |

Values are bits, rounded to three decimals. On the two problem inputs, the
sampled choices change little under the final coding schemes. Full-pixel
choices can reduce estimated within-leaf costs much more. This does not prove
that every residual regression comes from predictor choice or that the tree
splits themselves are optimal.

## Exact validation

All 24 profiled files reconstruct 75,509,760 original samples in 84 groups with
zero error and complete, nonduplicate coverage. The profiler verifies every
actual residual read, group initialization, normalization, extra bit, padding
and whole-section account. Full selected leaf costs under the final integer
configurations also reconcile the complete residual statistics.

Source, copied decoder and encoder, helpers, harnesses, inputs, complete files,
prior native and Rust grids and tools remain pinned. Those independent decoder
grids were created in the preceding controls; this calibration does not count
them as new native decodes. The
[complete calibration](results/predictor-cost-calibration-profile.json)
contains every leaf and predictor cost.

The profile leaves production source, qualified comparisons and the original
memory, process, cost and package protections unchanged. It establishes no
runtime or RSS improvement.

## Complete-file refinement control

The refinement keeps the reserved tree's 65,536 spatial training samples,
1,024-leaf combined ceiling, depth 16, properties, selected local color
transforms and original predictor candidates. It accumulates complete leaf
histograms while constructing residuals, then chooses a lower empirical-cost
predictor within each fixed leaf. Ties keep the previous predictor. It reuses
the existing group residual and context buffers for reconstruction, clustering
and final integer coding.

This adds full-population scoring and reconstruction work. The spatial tree
training remains sampled. Scratch arrays are tracked by encoder ownership and
released before reconstruction; original memory and process limits stay fixed.

| Input | Previous experimental floor | Refined raw file | Selected floor | Changed predictor leaves | Header change | Remaining data change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| im26-1416 | 640,549 | 638,405 | 638,405 | 309 | −89.125 | −2,054.875 |
| im26-2018 | 614,379 | 614,054 | 614,054 | 231 | +735.5 | −1,060.5 |
| Red dither | 619,207 | 624,641 | 619,207 | 196 | +404.375 | +5,029.625 |
| 513-pixel crop | 227,774 | 227,707 | 227,707 | 30 | +92 | −159 |

File sizes and changes are bytes. Header and remaining-data changes compare
raw candidates with the previous complete-file floor; outer bytes stay fixed.
The raw tree has exactly the same branches, contexts, offsets and multipliers
as its matching reserved raw parent. Only the leaf predictors change. Model
clustering and integer configurations can change afterward.

Three experimental floors improve by 2,144, 325 and 67 bytes. The dither case
keeps its previous file. Compared with the retained ordinary encoding, the
first photo is now 10,999 bytes smaller and the crop 90 bytes smaller. The two
other photo floors still exceed their ordinary files by 786 and 2,101 bytes.
Overall parity remains open.

All 12 complete files pass 24 pinned native and Rust grids covering 75,509,760
original samples. Public decoding checks another 37,754,880 samples with full,
nonduplicate coverage. Exact baseline and floor hashes, original input identity
and closed encoder ownership also pass. The
[refinement controls](results/refined-pooled-predictor-tree-controls.json) and
[program profile](results/refined-pooled-predictor-tree-program-profile.json)
record complete files and unchanged tree structures.

These copied prototypes remain experimental. The retained production source
and qualified public matrices stay unchanged. Original paired runtime and RSS
costs, working-memory fallback, package limits and broader public compatibility
still require qualification before adopting this refinement.
