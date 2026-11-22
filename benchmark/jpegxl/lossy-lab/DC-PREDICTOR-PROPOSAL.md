# Predictor-aware DC rounding proposal, 2026-11-03

One fixed trial is prepared for owner review. It applies libjxl's nonlinear
predictor-relative DC rounding while preserving the aligned nominal DC
allocation. No candidate image has been encoded and there is no quality,
bitrate, speed or original-memory result. The research branch remains short
of merge readiness.

The previous [nonlinear DC trial](DC-QUANTIZATION-REPORT.md) changed
InitialQuantDC allocation and reconstructed-luma chroma subtraction together
with rounding. The later [chroma-only trial](DC-CHROMA-REPORT.md) regressed
against aligned control. Neither measured predictor-relative rounding at the
aligned nominal steps with the original chroma residual policy.

## Concrete configuration

The [four-file implementation patch](DC-PREDICTOR-PROPOSAL.patch) applies after
`DC-QUANTIZATION-EXPERIMENT.patch` at `8b8c3cc8`. It restores the aligned AC 1.25
nominal DC allocation and quantizes using its serialized F16 matrix. It adds
the named `libjxl-predictor-dc-port.ts` module, derived from libjxl v0.12.0
`QuantizeWP` and the group traversal in `AddVarDCTDC`.

The rule uses a 0.62 predictor-relative dead zone and rounds larger residuals
to even integers. Its extra DC precision bit represents half nominal steps
near the prediction. Therefore fixed nominal allocation does not mean an
unchanged set of representable values. The existing archived private writer
already supports this bit; no public source change is proposed here.

Original-luma B-Y residuals, smoothing off, all AC decisions and current entropy
selection stay fixed. The proposal does not restore the rejected reconstructed-
luma chroma subtraction. It gathers three compact Float32 DC planes, requiring
12 bytes per 8x8 cell, plus at most 10,416 bytes for one weighted predictor.
This is a storage calculation, not a measured encoder memory peak.

## Checks and limits

Twenty-four scalar rounding checks, four invalid-value checks, four group-reset
cases, two signed aligned-step and source-preservation cases, and nine exact
allocation comparisons pass. Strict TypeScript passes. The patch reconstructs
four implementation files and one scalar verification script exactly.
Source, quantizer, predictor and license files match pinned commit
`a7a9c787341cf703dede03c2009fa460cae5e5df`; the full license remains in the package
and docs notices. The new module header records its sources and adaptations.

The helper tests establish arithmetic and integration inputs. They do not prove
native-valid image output or a perceptual gain. The proposal uses the existing
local entropy selector, which may exploit these residuals differently from
native global weighted coding. The prior chroma trial showed why lower scalar
error alone is insufficient. Any gain must be measured directly.

If approved, assign a distinct development mode, run repeatable native-decoder
fixtures and the fixed screen, then the full lab only if warranted. Keep all
quality, speed, memory and promotion gates, the development/holdout boundary,
and the research-branch restriction. One configuration, no sweep or peer maps.

The single chroma trial exhausted the previous allowance. Owner renewal under
LOSSY_STEERING section 9 is requested before encoding this configuration. The
worst prior holdout SSIM guard is still +10.579530% against +8.05%, with two of
ten admitted guards failing and zero full-band 3-norm admissions.

Raw preparation and checks are under
`.tmp/jpegxl-lossy-lab/dc-predictor-proposal-20261103/`. The companion JSON records
the patch, source hashes, tests and repository-check receipt. No new quality
configuration or holdout attempt belongs to this proposal checkpoint.

Fresh `VITEST_MAX_WORKERS=4 npm run check` passes 340 test files and 4,229 tests,
with one file and three tests skipped, including static and browser build
checks. It ended at 2026-11-04T00:15:05.467Z. The channel-order test uses distinct
Y/X/B results to catch storage permutation errors. Its first strengthened
fixture incorrectly assumed predictor-relative rounding stayed constant for
a non-integral flat plane; using exact-grid Y/B values fixes that test premise
without changing the proposed quantizer. Active source, tests, package metadata
and lab TypeScript remain unchanged. Bundles stay 614,969/687,801 bytes, with
zero runtime dependencies.
