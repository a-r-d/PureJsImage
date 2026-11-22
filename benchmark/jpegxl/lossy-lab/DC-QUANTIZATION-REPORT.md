# Coherent nonlinear DC quantization trial

The one approved configuration regresses all three metrics against the frozen
AC 1.25 finalist. It is not promoted. The branch remains unready to merge;
active source and public encoder behavior are unchanged.

Aaron approved this fixed source-based trial on 2026-11-03 after the
[allocation report](BLOCK-ALLOCATION-REPORT.md). Base:
`8b8c3cc818c1fc1643a20f14b1b3945e822c3b8a` on `jxl-libjxl-ports`.
Raw evidence: `.tmp/jpegxl-lossy-lab/dc-quantization-20261103/`.
No sweep, peer decisions or holdout tuning. All gates remain unchanged.

## Source and implementation

The port combines native InitialQuantDC with `QuantizeWP` and `AddVarDCTDC`
from libjxl v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df`.
Predictor residuals use dead zone 0.62 and one extra precision bit. Larger
residuals are restricted to even integers. Weighted predictor state resets
for each channel and DC group. Chroma DC subtracts reconstructed quantized Y.

The TypeScript adaptation reuses our first-party weighted predictor and memory
ledger. It gathers Float32 DC values from selected transforms at one sample
per 8x8 cell, restores native B from our B-Y representation, preserves float32
boundaries and rounds ties away from zero. It explicitly rejects non-finite
or out-of-range integer results. Five source/license files match the pinned
archive. Module headers and PROVENANCE name the sources; the full BSD notice
remains in the npm package and docs site. No runtime dependency is added.

AC precision 1.25, the selected-block AC pass, selector, DC smoothing setting
and display filters stay frozen. Private copies of the first-party writer
and forward entry isolate the extra-precision support from public source.
Twelve prototype module hashes were frozen before the screen and still match.

## Development results

Mean BD-rates are SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max.
Negative is better. The screen has 16 photos and five distances; the full
lab has 64 photos and nine distances. All 656 outputs validate natively.

| Reference | Screen | Full development |
| --- | --- | --- |
| Regularized control | +3.837 / -0.766 / +2.917% | +3.598 / -0.896 / -0.558% |
| Frozen AC 1.25 | +2.622 / +0.979 / +1.420% | +2.738 / +0.973 / +1.537% |
| vips | -7.365 / -5.926 / -3.758% | -4.938 / -5.567 / -6.105% |
| jSquash | -8.279 / -1.710 / +3.792% | -6.033 / -1.201 / +2.142% |

The full-lab mean regresses 0.714313% against regularized and 1.749116%
against AC 1.25. All eight admitted main-relative SSIM guards pass, worst
+7.091538%, weaker than AC 1.25's +4.608959%. Main means are
-3.620 / -10.829 / -9.827%. The worst main-relative SSIM result is +24.243195%
with partial coverage, and remains reported. There are zero admitted
full-band 3-norm comparisons.

The unchanged full lab resolves the guard distribution after the weaker
screen; it does not justify a new quality configuration or holdout attempt.

## Causal and correctness checks

All 80 screen streams have exactly the same HF-global and AC section bytes
as frozen AC 1.25. Fifteen emitted fields, including transforms, raw AC
quantizers, correlation maps, matrices and filters, also match exactly.
The DC matrix ratios match the intended restoration of native nominal steps.
The difference is confined to DC coding and reconstruction.

Total screen bytes change from 2,848,367 to 2,849,166, just +0.028051%, while
the 2,440,564 AC bytes stay identical. This port provides no aggregate rate
saving at the sampled distances to compensate for its distortion changes.
This does not establish which part of the nonlinear stage causes the loss.

A second read-only audit covers 27 existing streams: three photos at three
distances, for native vips, AC 1.25 and the DC trial. Native enables normative
DC smoothing in all nine cases; both own modes disable it. Native's DC trees
use globally shared coding and only weighted-predictor leaves for the DC
channels. The trial uses local trees with reachable predictors 5, 6 and 13.
Reachable leaves are possible choices, not measured per-pixel usage counts.

Across these nine own pairs, DC stream bits fall from 305,340 to 301,251.
Local header/model bits rise from 11,960 to 17,040, offsetting 5,080 bits of
the 9,169-bit residual reduction. This is a real cost within the same own
pipeline. Native's 294,290 DC stream bits exclude its globally shared tree
and histograms, so that value is not a complete native DC coding cost.
The source's nonlinear stage remains coupled to smoothing and a different
entropy model. No new encoding or policy trial was run for this audit.

Twenty-two threshold/rounding cases, four invalid-input cases, two chroma
cases and two group-reset cases pass. Eighteen thin, odd, tile-edge and
DC-group-edge image fixtures encode repeatably and decode with native libjxl.
Every fixture DC group signals precision 1. Three frozen control streams
are exact through the private writer, and input pixels remain unchanged.
Nine DC/global-scale policy checks and three promotion-denial checks pass.
Strict experimental TypeScript passes.

## Cost and disposition

Full-lab managed peak is 9,422,327 bytes. Parallel quality-run timings and
process RSS are excluded from performance evidence. Fifteen isolated
alternating pairs per image give candidate/control ratios 1.021352 and
1.011821, with MADs 0.030488 and 0.041932. Candidate medians are 898.467ms
and 877.222ms, versus 879.425ms and 868.796ms for regularized. All repeated
candidate streams match native-valid screen hashes. Managed peaks are
5,682,267 and 5,680,219 bytes, respectively unchanged and +2,048 versus control.
There is no speedup claim; the quality regression earns no added-time allowance.

No holdout, original speed/memory, watch/scale or public integration is run
for this configuration. The last frozen AC 1.25 holdout still fails two
SSIM guards, worst +10.568972%; this trial does not retest or resolve them.

The independent experiment patch reconstructs eleven files exactly against
the base, including nine changed files. It preserves the port, private writer
support, prerequisite selected-block changes and fixture verification script.
Three pinned old-writer stream hashes keep the archived control check
independent after patch application. A separate context-audit patch preserves
three read-only diagnostic scripts, also reconstructed exactly.
The active source, tests, package metadata and lab TypeScript stay unchanged.
Bundle sizes remain 614,969 / 687,801 bytes, with zero runtime dependencies.
The three worst main-relative max regressions are im26-3000 (+19.854%),
im26-3004 (+10.456%) and im26-2004 (+3.886%). Native-decoded nearby-size
pairs were inspected at candidate/main distances 1.85/3, 0.65/0.9 and
0.9/1.85. The 512px views show subtle tonal, texture and grain differences
on the dark door, pottery and grainy curtain/interior. They do not localize
or dismiss the metric peaks. Parameters remain frozen.

Fresh `VITEST_MAX_WORKERS=4 npm run check` passes 340 test files and 4,229
tests, with one file and three existing tests skipped. Browser build checks
pass within that command. Strict TypeScript also passes for the port, fixture
checks and read-only diagnostics. All three pinned control hashes and the
18 native-decoded fixture cases pass again after archiving the verifier.

The single approved configuration is exhausted. Next hypotheses, ranked by
the current evidence:

1. Re-enable normative DC smoothing with this exact nonlinear DC stage.
   Native uses both together in all sampled streams. The old smoothing-off
   wins predate this stage; no benefit is established for the new combination.
2. Match nonlinear DC quantization to the native fixed weighted-predictor tree.
   The measured local-header increase offsets more than half the sampled
   residual saving. Full shared-code costs must be counted before a rate claim.
3. Audit selected-transform low-frequency reconstruction error. Its numerical
   contribution remains unmeasured, so it ranks below the observed differences.

An owner renewal is required before a second quality configuration. The
quality, speed, memory and holdout limits remain unchanged.
If renewed, test native DC smoothing and its fixed weighted-predictor coding
model together as one fixed completion of this stage, before any sweep.
