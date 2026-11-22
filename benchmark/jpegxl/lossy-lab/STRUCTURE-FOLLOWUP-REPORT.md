# Structural-error follow-up

Four new quality hypotheses produce no retained improvement. Five development
evaluations complete 896 native-valid outputs. The exact kernel gains from
`24fdfe61` remain, but the last frozen holdout still has two failed SSIM guards,
worst +12.173%. Main and public encoder behavior are unchanged.

Base: `24fdfe6199dcec70c93c46039dff259122dbc3ed`, 2026-11-03. See the
[JSON report](STRUCTURE-FOLLOWUP-REPORT.json) for coverage, peer tables, native
feature measurements and build arguments. Raw artifacts are in
`.tmp/jpegxl-lossy-lab/selector-kernels-20261103/`.

## Development results

Each screen uses the fixed 16 photos and five distances. The full lab uses
64 photos and nine distances. Percentages are mean BD-rates in the order
SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max. Negative is better.

| Experiment | Outputs | vs frozen regularized | vs vips | vs jSquash |
| --- | ---: | --- | --- | --- |
| Cell-local structural weights | 80 | +0.110 / +0.120 / +0.718 | -10.625 / -5.732 / -5.825 | -11.715 / -0.440 / +1.303 |
| Overlapping windows, screen | 80 | -0.063 / -0.063 / -0.130 | -10.774 / -5.908 / -6.615 | -11.861 / -0.614 / +0.477 |
| Overlapping windows, full lab | 576 | +0.004 / +0.001 / +0.091 | -8.201 / -5.197 / -5.546 | -8.724 / -0.010 / +2.507 |
| Final-writer field and chroma scales | 80 | +0.188 / +0.164 / +1.058 | -10.553 / -5.675 / -5.483 | -11.625 / -0.348 / +1.611 |
| Half-strength luma DC error diffusion | 80 | +0.595 / +0.406 / +0.454 | -10.231 / -5.527 / -6.143 | -11.173 / -0.147 / +1.045 |

The overlapping-window screen gain does not generalize to the full lab.
Its eight admitted main-relative SSIM guards pass, worst +7.491%, slightly
better than regularized +7.579%. All three mean metrics worsen, however, and
the additional window work has no qualified speed benefit. It is not retained.
The other three screens worsen all mean metrics. No isolated speed, original
qualification or new holdout attempt follows these results. Parallel quality
times are diagnostic only.

The four independent patches apply to `24fdfe61`:
[cell-local weights](STRUCTURE-LOCAL-EXPERIMENT.patch),
[overlapping windows](STRUCTURE-OVERLAP-EXPERIMENT.patch),
[writer coupling](STRUCTURE-WRITER-EXPERIMENT.patch), and
[DC diffusion](STRUCTURE-DC-HALF-EXPERIMENT.patch).
Each reconstructs its isolated experimental mode by replacing the regularized
mode name. They are research snapshots, not changes to apply together.

## Native metric diagnosis

After the structural-model misses, a separate native executable enabled
libjxl's existing `SSIMULACRA2_OUTPUT_RAW_SCORES_FOR_WEIGHT_TUNING` macro.
Native source, libraries, stock scorers and encoder code were unchanged.
The probe reproduces all 36 saved scores across two development examples,
two encoders and nine distances. Two identity comparisons have zero features.

For each image, four candidate points within SSIM 60-90 have byte counts
bracketed by baseline outputs. Baseline feature values are interpolated in log
bytes. These weighted native-feature differences diagnose the metric; they
do not replace the campaign BD-rate calculation.

| Development example | Total weighted error difference | Luma structure difference | Largest individual deficit |
| --- | ---: | ---: | --- |
| im26-2004, grain | +0.122910 | +0.171531 | Luma structure, scale 4, 1-norm: +0.115393 |
| im26-3302, texture | +0.056019 | +0.051088 | Luma structure, scale 8, 1-norm: +0.035847 |

This points toward coarse-scale luma structure rather than only the current
8x8 structural proxy. It does not establish that DC rounding causes the gap:
the subsequent DC diffusion screen fails. The initial unbounded-range audit
and corrected required-band audit are both preserved. The
[diagnostic patch](STRUCTURE-METRIC-DIAGNOSTIC.patch) preserves the TypeScript
build and measurement tools; its added files are development-only.

## Next source lead and stop

libjxl v0.12.0 `lib/jxl/enc_group.cc` implements `AdjustQuantBlockAC`, called
by `QuantizeRoundtripYBlockAC`. Effort 7 maps to speed tier 3, which satisfies
the call's `<= kHare` condition (tier 5). The pass adjusts selected-block
quantizers and quadrant dead-zone thresholds together. It also handles sparse
8x8 blocks, high-frequency patterns and activity, then reconstructs luma before
chroma quantization. This specific pass is absent from the recorded standalone
ports. Its effect on our guards is unmeasured.

The next proposal is one coherent port of that quantizer/threshold stage,
with at most three development configurations. It needs an additional scan
over the selected coefficient planes and bounded quadrant statistics. Measure
complete encode cost before qualification; no speed gain is assumed. Keep the
existing licensing, quality, speed, memory and holdout gates.

The previous fourteen quality evaluations plus these five evaluations retain
only the restored 0.161235% development mean gain. This is below the 1% plateau
criterion in [LOSSY_STEERING.md section 9](../LOSSY_STEERING.md#9-stopping-and-escalation).
Stop before another port family and request owner renewal. No port of
`AdjustQuantBlockAC` has started.

## Verification

All 896 outputs decode natively and score. The 34 focused prototype checks,
strict harness TypeScript and five independent patch checks pass; all 20
reconstructed modules match their tested source snapshots. The
active implementation still matches the verified `24fdfe61` checkpoint:
`npm run check` passed 4,229 tests with three existing skips, and all three
real-browser fixtures passed. Bundles remain 614,969/687,801 bytes with zero
runtime dependencies. The new changes are reports, provenance and archives.

Remote main is `e534dec5`, one browser-test maintenance commit beyond the prior
reference. Its JPEG XL source is unchanged. The research branch has not merged
main's new Playwright configuration; integration and fresh verification remain
part of eventual merge readiness.
