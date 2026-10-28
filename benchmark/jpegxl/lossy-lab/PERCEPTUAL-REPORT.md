# Perceptual component validation

Research branch `jxl-libjxl-ports`, base `67f11407`, 2026-10-28.
Entries LL-1001 through LL-1005. Main, public codec behavior and the holdout are unchanged.

Directional error and coarse-scale context explain much of the earlier
predictor failure. The offline TypeScript model now reconstructs the native
Butteraugli distance map closely. This validates an offline diagnostic;
encoder-side reconstruction, local update costs and joint RD remain separate
work. No encoder policy is retained by this checkpoint.

## Fixed experiment

Use 80 cached native-scored screen pairs: guarded and low-frequency rounding
at distances 2 and 4, plus the rejected quarter-strength filtered removals at
1.85. There are 55 changes above 0.1% for each Butteraugli metric. Maximum error
has 30 worse and 25 improved changes; reported 3-norm has 24 worse and 31
improved changes. This checks both directions, unlike the earlier 3-norm
validation subset where every material change was worse.

Port the pinned v0.12.0 formulas without fitting constants: local adaptation,
frequency/color bands, masking, asymmetric quadratic costs, directional Malta
costs, and full/half-resolution mixing. The two stencils, range penalties,
weights and normalizations come from the source. The scalar implementation uses
Float64 and Math.log rather than native float and FastLog2f. Source headers,
PROVENANCE.md and the packaged/docs BSD-3 notice record each port. No runtime
dependency is added.

Retain the predeclared diagnostic criterion: at least 80% sign agreement on at
least ten native changes above 0.1%, with no harm above 1% predicted nonpositive.
For native-map fidelity, require maximum absolute pixel error below 0.001 on
saved screen intervention maps. These do not replace any promotion gate.

## Component attribution

| Model | Material max signs | Missed max harms above 1% | Material reported 3-norm signs | Missed 3-norm harms above 1% |
| --- | ---: | ---: | ---: | ---: |
| Unmasked quadratic, plain L3 | 34/55 | 11 | 45/55 | 3 |
| Masked quadratic, plain L3 | 26/55 | 12 | 46/55 | 3 |
| Asymmetric quadratic, plain L3 | 29/55 | 12 | 49/55 | 1 |
| Add directional costs, plain L3 | 44/55 | 3 | 54/55 | 0 |
| Add coarse-scale mixing, plain L3 | 55/55 | 0 | 53/55 | 1 |
| Full map, native L3/L6/L12 pooling | 55/55 | 0 | 55/55 | 0 |

The source's reported p=3 score averages L3, L6 and L12. Plain L3 is a deliberate
ablation in these rows, not an equivalent implementation of the reported native
score. The earlier local-window audit compared plain L3 of both maps in the
same windows; its local conclusions are unchanged. Native full-image lab
scores have always come from the native executable and are unchanged.

The full map is `0.85 * fine + 0.5 * half`, with half-resolution linear RGB
averaged before local adaptation. Omitting this term still misses three
material max harms despite retaining the directional costs. No native peak
location is supplied to the model.

## Native fidelity

Across the 80 screen pairs, the full model gets all 69 nonzero maximum-error
directions and all 74 nonzero reported 3-norm directions right. Maximum absolute
score differences across both endpoints are 0.000064186 for max and 0.000007677
for reported 3-norm. All 480 earlier quadratic comparisons and all 400 maximum
comparisons are reproduced exactly after the runner extensions.

| Cached native maps | States | Largest pixel error | Largest map RMSE | Largest max-score error | Largest 3-norm error |
| --- | ---: | ---: | ---: | ---: | ---: |
| 16 screen photos, d1.85 endpoints | 32 | 0.000134186 | 0.000005988 | 0.000008104 | 0.000002361 |
| im26-2004 endpoints and interventions | 47 | 0.000022813 | 0.000002170 | 0.000001465 | 0.000000083 |

The intervention set includes the four harmful coefficients, all their
nonempty subsets and 30 other individual removals. These correlated states
test fidelity; they are not independent training observations. The source
model uses neither the known native peak location nor fitted weights.

Three fresh 19x17 native fixture maps cover identity, erased structure and a
brightness shift. Their largest pixel difference is 0.000123251. Five focused
tests cover Gaussian borders, identity and finite costs, directional sign
symmetry/locality, native mixed-norm pooling and pinned native fixture scores.

This implementation is restricted to the opaque SDR sRGB diagnostic inputs.
It retains full Float64 feature planes and is unsuitable for direct insertion
into the encoder. Just the source and decoded full/half-resolution prepared
planes require roughly 240 bytes per source pixel, before scratch and maps.
That storage estimate is not a measured encoder memory result. A practical
encoder rule still needs bounded local state, faithful reconstruction and an
isolated cost measurement.

## Unchanged development validation

The same formulas pass on the other 48 development photos at distances 1.3,
1.85 and 3, totaling 144 pairs. Maximum error gets 27/27 material directions
right, and reported 3-norm gets 30/30. Neither metric misses a harm above 1%.
The max set contains 16 worse and 11 improved changes. All 30 material 3-norm
changes are worse, so that subset alone cannot establish both directions;
the screen above supplies the mixed-direction evidence.

For all nonzero changes, max gets 79/80 and 3-norm gets 115/115. The sole max
miss is im26-3010 at 1.3: native harm is 0.000023878%, far below the 0.1%
material threshold. Largest absolute score differences across these endpoints
are 0.000033261 for max and 0.000023095 for reported 3-norm. No constants were
changed after the screen, and no holdout input was read.

## Reconstruction boundary

An additional probe uses our existing `decodeDisplayStages` reconstruction
and its ordinary rounded sRGB pixels for the 16 d1.85 screen pairs. Native PNG
comparison finds 6,146,036 changed RGB samples across 32 images; every sample
differs by at most one code value. Nevertheless, max-score error reaches
0.068839 and reported 3-norm error 0.006731. Max sign agreement is only 2/3
material changes; 3-norm is 4/4, all worse. This small set does not pass the
diagnostic sample-count gate.

The known harmful im26-2004 change is detected. On im26-1002, however, the
native max improves 0.255602% while the rounded-reconstruction model predicts
an increase of 0.020620 in absolute score. This is a false alarm, not a missed
large harm, but it shows why one-code-value reconstruction parity is not
sufficient for these small decisions.

Pinned `lib/jxl/render_pipeline/stage_write.cc`, `MakeUnsigned`, applies a
32x32 ordered dither with channel offsets before rounding 8-bit output.
`decodeDisplayStages` currently uses ordinary rounding. This is a concrete
source-level hypothesis for the mismatch; its contribution is not yet
measured. No dither table or output conversion is ported in this checkpoint,
and no public decoder behavior is changed. The probe and results are saved
as `own-display.ts`, `own-display.json` and per-photo rows in the raw directory.

Next: audit the ordered-dither contribution, verify a bounded local calculation
against this full reference, then test joint batch RD with actual serialized
costs and isolated speed/memory checks. The accurate postdecode model alone
does not authorize an unvalidated encoder approximation.

## Reproduction

Inputs and outputs are under `.tmp/jpegxl-lossy-lab/perceptual-20261028`.
The runner validates source hashes and development membership and records both
decoded-PNG hashes per pair. The map audit also records native PFM hashes.
All matrix runs are offline quality diagnostics; concurrent elapsed times are
not encoder speed evidence.

```sh
node benchmark/jpegxl/lossy-lab/validate-perceptual-local.ts OUTPUT screen quadratic l3
node benchmark/jpegxl/lossy-lab/validate-perceptual-local.ts OUTPUT screen directional l3
node benchmark/jpegxl/lossy-lab/validate-perceptual-local.ts OUTPUT screen directional native
node benchmark/jpegxl/lossy-lab/validate-perceptual-local.ts OUTPUT validation directional native
node benchmark/jpegxl/lossy-lab/audit-perceptual-maps.ts OUTPUT .tmp/jpegxl-lossy-lab/predictors-20261028 screen
node benchmark/jpegxl/lossy-lab/audit-perceptual-maps.ts OUTPUT .tmp/jpegxl-lossy-lab/predictors-20261028 marginal
VITEST_MAX_WORKERS=4 npx vitest run tests/jpegxl-perceptual-local.test.ts
```

Use a fresh OUTPUT directory for each command. The native fixture generator
and three fresh PNG/PFM pairs are saved alongside the audit. Native executable
SHA-256 is `2bf52b536892c8b027843dd9fd72316262a524d22270e53ef12e9c971b0c6bde`.

`butteraugli.cc` and `lib/extras/metrics.cc` match their members in the pinned
source archive exactly. The full upstream LICENSE is present verbatim in
THIRD_PARTY_NOTICES, which remains in the npm file list and the docs notice page.

## Verification

`VITEST_MAX_WORKERS=4 npm run check` passes: 4,196 tests, three existing skips,
334 passed files and one skipped file. Test phase 598.05s; complete check
643.752s. Chromium, Firefox and WebKit fixtures pass in 20.7s. The five new
focused tests pass independently. Source, encoder decisions, package metadata
and dependencies match the base revision. Only offline diagnostics, fixtures,
provenance and reports are retained. Evidence: `check-status.json`, `check.log`,
`browser.log`, `focused-native.log`, `comparison-evidence.json` and
`validation-evidence.json` in the raw directory.

## Merge boundary

The retained full-development BD-rates are still -8.003/-5.030/-5.582% against
vips and -8.474/+0.227/+2.571% against jSquash (SSIMULACRA2/3-norm/max).
These are carried forward, not a new qualification. The prior two aggregate
holdout SSIM guard failures remain unresolved. This work does not identify or
tune from holdout photos. Speed, memory, public-bundle cleanup and promotion
checks remain required before merge readiness.
