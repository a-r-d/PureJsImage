# JPEG XL local color selection controls, October 3, 2026

The remaining photo gap involves color transforms, prediction models and their
headers. A local color-transform candidate reduces one photo below both pinned
WASM files. Its proposed selection rule also makes two nearby inputs larger,
so it has not been adopted. Overall compression parity remains open.

The production encoder remains source
`fac18835564faddab14698f2832612e85aeaaaedc965f413e04725a85061b567`.
The original 12 MP lossless gap is already closed. Current sizes and remaining
lossy gaps are in [PARITY.md](PARITY.md). Earlier grouping and tree controls are
in [PHOTO-MODELS.md](PHOTO-MODELS.md).

## What the proposed rule does

The temporary candidate uses the existing first-party reversible color
selector. It samples at most 4,096 positions, scores 42 transforms, and requires
the original 1% estimated-rate improvement. It considers 512-pixel groups only
for lossless effort 7 RGB8 or RGBA8 inputs fitting within 1024 pixels per side,
with at least 262,144 pixels and a longest side above 512 pixels.

It also requires more than 1,024 distinct sampled RGB colors and a changed,
nonidentity transform. That color threshold comes from the existing palette
limit. Each selected group then chooses its own reversible transform. Training,
tree, predictor, histogram and cache limits stay unchanged. Other inputs keep
the previous path. The rule selects a primary path without encoding both
complete alternatives to compare their sizes.

The [original-input controls](results/guarded-local-color-controls.json) cover
all ten original RGBA8 inputs fitting this geometry. One changes: im26-1416
shrinks from 649,404 to 641,956 bytes, below jSquash's 644,097 and wasm-vips's
649,387. The other nine keep their exact previous file hashes, including
im26-2018, palette-heavy graphics, alpha triangles and gray8. These results alone
do not establish a reliable selection rule.

## Nearby inputs expose two regressions

The [neighbor controls](results/guarded-local-color-neighbor-controls.json)
freeze seven deterministic derivatives of the same original photos. Crops are
centered; the portrait transposes the original pixels. The alpha case zeros
alternating 16-pixel squares while preserving their RGB. The dither changes
only red by minus one, zero or plus one and clamps to the original 8-bit range.

| Input | Current bytes | Guarded bytes | Change |
| --- | ---: | ---: | ---: |
| im26-2018, one-level red dither | 617,106 | 620,639 | +3,533 |
| im26-1416, RGB | 649,352 | 641,882 | −7,470 |
| im26-1416, portrait | 645,086 | 636,650 | −8,436 |
| im26-1416, 1023 × 767 crop | 647,793 | 640,322 | −7,471 |
| im26-1416, hidden RGB under zero alpha | 651,870 | 644,620 | −7,250 |
| im26-1416, 512 × 512 crop | 227,541 | 227,541 | 0 |
| im26-1416, 513 × 512 crop | 227,797 | 228,191 | +394 |

The 512-pixel crop keeps its original hash because the rule is ineligible. The
513-pixel crop selects two local groups and grows. The dither selects four local
groups and also grows. Neither counterexample was removed from the results.
Changing thresholds to exclude only these cases would not establish parity.

## Where the changed bytes go

The [program profile](results/guarded-local-color-program-profile.json) accounts
for every section bit across all 34 files and 42 reference or display frames.
Headers include color transforms, weighted prediction, trees and entropy
models. Remaining section data includes residuals, final entropy states,
palette prefixes and padding. Frame headers and section tables are separate.

| Input | Change in section header bytes | Change after those headers | Whole-file change |
| --- | ---: | ---: | ---: |
| Original im26-1416 | +1,702.125 | −9,164.125 | −7,448 |
| im26-2018, red dither | +2,737.625 | +781.375 | +3,533 |
| im26-1416, 513-pixel crop | +69.5 | +318.5 | +394 |

The winning photo pays for larger headers but saves more in the remaining data.
Both regressions grow in both parts. Fractional bytes describe bit extents
within sections; the complete files still contain whole bytes.

The current complete-file winners already use a selected global transform:
type 40 for im26-1416 and its 513-pixel crop, and type 31 for the dither. The
preliminary preparation's type 6 or identity choice is not the final winner.
The dither has 1,328 sampled RGB colors and selects type 31; the 513-pixel crop
has 3,155 colors and selects type 40. Both satisfy the proposed rule while
producing larger complete files. The sampled literal-rate estimate omits the
learned models and complete header costs.

These controls show why local color selection needs a better decision method.
Shared trees or entropy models remain a separate implementation opportunity.
The observed differences do not assign all savings or growth to one feature.

## Validation and retained behavior

All 34 files are lossless in both pinned independent decoders: 68 complete grids
check 211,350,544 original samples, including alpha and hidden RGB. Their public
decode checks cover 105,675,272 samples with no duplicate or missing pixels.
Every input remains immutable and every encoder closes its owned allocations.

The first profiling attempt stopped on an incorrect single-frame assumption
before parsing. Its failed receipt remains preserved. The completed profile
includes every reference and display frame, including unchanged graphics.

The candidate remains temporary. Its regressions reject it before package or
paired runtime and RSS qualification. One-off timings and tracked scratch peaks
do not establish performance gains. The existing 5% paired-cost protections,
bundle limits and qualified production files remain unchanged.
