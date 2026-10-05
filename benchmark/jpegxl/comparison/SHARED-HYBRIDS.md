# JPEG XL shared hybrid controls, October 3, 2026

Choosing an integer code separately for each shared entropy model saves another
147 to 773 bytes on the four tested inputs. Three files still exceed their
retained production sizes. This prototype has not been adopted, and overall
compression parity remains open.

Current production remains source
`fac18835564faddab14698f2832612e85aeaaaedc965f413e04725a85061b567`.
Its full comparison is in [PARITY.md](PARITY.md). The preceding shared-model
experiment is in [SHARED-MODELS.md](SHARED-MODELS.md).

## The controlled change

The experiment preserves the selected local color transforms, predictor trees,
residuals, global group dispatch and pooled model map from the earlier shared
experiment. Only the hybrid integer configurations and their entropy histograms
change. Each model chooses among six configurations already used by the
first-party encoder: 4/2/0, 2/1/0, 3/1/0, 2/0/1, 4/1/2 and 0/0/0.

Selection uses the existing cost estimate for extra bits and the normalized,
serialized histogram. The encoder then writes actual sections. A separate
route keeps the smaller complete file between the common configuration and
the model-specific result. Its comparison includes actual serialized table
of contents bytes and padding. It reuses captured residual plans without
another pixel encode or concatenating a complete residual frame.

## Complete file results

All values are bytes. The floor route selects the model-specific file on every
tested input and reproduces its exact hash.

| Input | Retained ordinary | Shared 4/2/0 | Per-model hybrid | Change from ordinary |
| --- | ---: | ---: | ---: | ---: |
| im26-1416 | 649,404 | 641,414 | 641,051 | −8,353 |
| im26-2018 | 613,268 | 615,152 | 614,379 | +1,111 |
| im26-2018, one-level red dither | 617,106 | 619,960 | 619,207 | +2,101 |
| im26-1416, 513 × 512 crop | 227,797 | 228,286 | 228,139 | +342 |

Savings against the identical shared controls are 363, 773, 753 and 147 bytes.
The first photo beats its ordinary floor. The other three still regress, so a
broad replacement remains rejected. The full controls are in
[shared-group-hybrid-controls.json](results/shared-group-hybrid-controls.json).

## Where the saved bytes come from

The [complete profile](results/shared-group-hybrid-program-profile.json)
verifies identical predictor-node hashes, context maps, transforms and global
model counts across all three routes. Every local group uses the shared tree
and entropy code. Only the model-specific integer coding changes.

| Input | Section header change | Remaining section data change | Whole-file change |
| --- | ---: | ---: | ---: |
| im26-1416 | −136.375 | −226.625 | −363 |
| im26-2018 | −78.625 | −694.375 | −773 |
| Red dither | −48 | −705 | −753 |
| 513-pixel crop | −245 | +98 | −147 |

Fractional bytes describe bit extents within sections. Outer bytes are unchanged.
Entropy headers shrink on every input. Remaining data shrinks on the three
photos but grows on the thin crop. The shared trees still contain the original
disjoint local predictor decisions. Training predictors across groups remains
a separate next step.

## Validation and limits

All twelve complete files reproduce every original color and alpha sample in
pinned libjxl, Rust and the public decoder. Independent checks cover 24 grids
and 75,509,760 original samples. Public checks cover 37,754,880 samples with
complete, nonduplicate pixel coverage. Baseline hashes, complete-file floors,
input identity and encoder allocation closure all pass.

The prototype performs additional model scoring and serialization. Single
observations do not establish a runtime or RSS improvement. The original
paired cost limits, working-memory limits, package size and broader compression
floors still require qualification before adoption. No production source,
dependency, version or published comparison has changed in this experiment.
