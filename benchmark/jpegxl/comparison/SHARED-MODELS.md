# JPEG XL shared model controls, October 3, 2026

Sharing trees and entropy models works in the first-party prototype and reduces
header costs. It improves one photo beyond the earlier local-color result.
Three other inputs still exceed their retained ordinary file sizes, so the
prototype has not been adopted. Overall compression parity remains open.

Current production remains source
`fac18835564faddab14698f2832612e85aeaaaedc965f413e04725a85061b567`.
Its full comparison is in [PARITY.md](PARITY.md). The earlier rejected color
selection rule and frozen derivatives are in [GUARDED-COLOR.md](GUARDED-COLOR.md).

## The controlled change

The experiment retains the previous 512-pixel groups, selected reversible color
transforms and selected residual plans. One control reproduces the earlier
optimal local files exactly. A second writes separate local models using a
common hybrid configuration of 4/2/0 without LZ77. The third uses those same
plans and configuration with one global tree and pooled entropy models.

The global tree dispatches the original local subtrees by group ID. Leaf
contexts are remapped in the actual global serialization order. Pooling uses
the existing first-party histogram clustering with its 128-model limit. Every
local group references the global tree and entropy code. The checked plans have
zero offsets, unit multipliers and no LZ77; unsupported fields are rejected.

This shares serialization and entropy models. It does not train one predictor
tree across all groups. The existing local predictor decisions remain intact.

## Complete file results

All values are bytes. The ordinary column is the retained production floor,
which is separate from the experimental local-group control.

| Input | Retained ordinary | Earlier local | Independent 4/2/0 | Shared 4/2/0 |
| --- | ---: | ---: | ---: | ---: |
| im26-1416 | 649,404 | 641,956 | 642,518 | 641,414 |
| im26-2018 | 613,268 | 615,721 | 616,529 | 615,152 |
| im26-2018, one-level red dither | 617,106 | 620,639 | 621,561 | 619,960 |
| im26-1416, 513 × 512 crop | 227,797 | 228,191 | 228,360 | 228,286 |

Sharing saves 1,104, 1,377, 1,601 and 74 bytes against the matching independent
controls. Against the earlier optimal local streams it saves 542, 569 and 679
bytes on the larger inputs, but adds 95 bytes to the boundary crop.

Only the first photo beats its retained ordinary file. The other shared files
remain 1,884, 2,854 and 489 bytes larger. These results reject a broad primary
replacement. The complete controls and proofs are in
[shared-group-model-controls-corrected-e.json](results/shared-group-model-controls-corrected-e.json).

## Headers shrink while the remaining data grows

The [program profile](results/shared-group-model-program-profile.json) verifies
all section bits and actual shared-group references. It counts shared leaves
once. Relative to the matching independent 4/2/0 control:

| Input | Section header change | Remaining section data change | Whole-file change |
| --- | ---: | ---: | ---: |
| im26-1416 | −2,022 | +918 | −1,104 |
| im26-2018 | −2,220.75 | +843.75 | −1,377 |
| Red dither | −2,690.375 | +1,089.375 | −1,601 |
| 513-pixel crop | −99 | +24 | −74 |

Fractional bytes describe bit extents within sections. Header counts include
trees, entropy models, transforms and weighted-prediction fields. Remaining
data includes residuals, entropy final states, palette prefixes and padding.

The shared programs use 128, 113, 121 and 71 global entropy models. Their
775, 871, 965 and 257 leaves preserve the original disjoint local decisions.
Header sharing helps, but the pooled models encode the remaining data less
compactly than the separate models. Cross-group training or better model
selection remains a distinct next step.

## Validation and limits

All twelve files reproduce every original sample in pinned libjxl, Rust and
the public decoder, including alpha. The independent checks cover 24 grids and
75,509,760 samples. Public checks cover 37,754,880 samples without duplicate or
missing pixels. Inputs and implementation hashes stay fixed, and every encoder
closes its owned allocations.

The temporary plan capture changes scratch ownership. Single encode times and
tracked peaks do not establish runtime or RSS improvements. Representative
paired costs, the original working-memory limits, package size and broader
compression floors would still need qualification before adoption.

Failed setup and token-counting attempts remain preserved alongside the exact
partial controls. The completed experiment uses the requested ANS token helper;
the existing prefix helper and all histogram bounds remain unchanged.
