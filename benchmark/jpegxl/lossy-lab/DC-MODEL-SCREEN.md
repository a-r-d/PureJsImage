# DC perceptual-model screen, 2026-11-04

Only the existing full directional, multiscale reference passes this screen.
It predicts every material Butteraugli change correctly and misses none of the
116 max harms above 1%. Removing directional terms misses 61 harms; removing
the coarse scale misses eighteen. Neither reduced model is suitable for choosing
DC changes on this evidence. The result confirms a diagnostic model for these
saved cases, but does not repair the encoder's SSIM failures or qualify a cheaper
selector.

Aaron approved one bounded screen of three formulas on research base
`eed47d49f161be20c672015c7d703b0117838f58`. All weights and formulas were declared
before evaluation. The inputs are the existing 800 scored reconstructions from
the [channel audit](DC-CHANNEL-AUDIT.md): sixteen development photos, five
distances, two saved modes and five channel-restoration variants. There are no
new reconstructions, native scorer calls, encoded configurations, fitted weights,
peer decisions or holdout reads.

## Fixed formulas and decision rule

All three models reuse the attributed libjxl v0.12.0 perceptual components already
in the lab. Each includes source activity masking, asymmetric color error and
the existing frequency decomposition. The models differ in two components:

| Model | Directional terms | Scale combination |
| --- | --- | --- |
| Quadratic multiscale | None | 0.85 times full plus 0.5 times half |
| Directional fine | All six existing directional costs | Full resolution only |
| Directional multiscale | All six existing directional costs at both scales | 0.85 times full plus 0.5 times half |

Half-resolution inputs average linear RGB before adaptation. Every map uses
maximum pooling and libjxl's reported fixed-p=3 aggregation, the mean of L3,
L6 and L12. Plain L3 is not the native reported 3-norm. No new source port or
constant is introduced. The last row is the expensive reference already examined
in [PERCEPTUAL-REPORT.md](PERCEPTUAL-REPORT.md), not a new fast approximation.

The predeclared gate applies separately to two cohorts and both metrics:

- Eighty actual comparisons: aligned reconstruction to predictor reconstruction.
- 640 restoration comparisons: within each mode, actual to each of X, Y, B and
  all-channel source-DC restoration.

A metric/cohort must have at least ten native changes above 0.1% in absolute
value, at least 80% correct signs on those material changes, and zero missed
native harms above 1%. A predicted delta at or below 1e-9 misses a native harm.
All four gates must pass. Native percentages use the unchanged before score as
denominator; model signs use the after-minus-before score. Combined, per-photo
and per-variant summaries are descriptive and cannot rescue a failed cohort.

## Results

The sign columns show correct/material comparisons. Harm misses count native
Butteraugli-max regressions above 1% predicted nonpositive. Actual comparisons
contain seventeen such harms; restorations contain 99. These are paired score
changes, not BD-rates.

| Model | Actual max signs | Actual 3-norm signs | Actual harm misses | Restoration max signs | Restoration 3-norm signs | Restoration harm misses | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Quadratic multiscale | 43/74 (58.1%) | 61/64 (95.3%) | 10/17 | 337/579 (58.2%) | 456/460 (99.1%) | 51/99 | Reject |
| Directional fine | 54/74 (73.0%) | 62/64 (96.9%) | 4/17 | 434/579 (75.0%) | 459/460 (99.8%) | 14/99 | Reject |
| Directional multiscale | 74/74 (100%) | 64/64 (100%) | 0/17 | 579/579 (100%) | 460/460 (100%) | 0/99 | Pass this screen |

Across both cohorts, the full reference gets 653/653 material max signs and
524/524 material 3-norm signs right. It also matches every nonzero native sign
under the existing 1e-6% reporting threshold: 710/710 max and 716/716 3-norm.
The largest absolute score differences across all 800 states are 0.0000468554
for max and 0.0000100356 for 3-norm. These small differences support faithful
composition of the existing ports on this cohort; they are not a bound on all
images or arbitrary local updates.

High 3-norm sign accuracy alone is weak evidence here. There are no 3-norm harms
above 1% in either cohort. Only one of 64 material actual changes and two of 460
material restoration changes worsen 3-norm. Always predicting improvement would
score 98.4% and 99.6%, respectively. The full model distinguishes all three
material regressions; the two reduced models still fail both max gates.

Directional fine abstains on one material restoration-max change. Apart from
that abstention, all material rows make directional predictions. The JSON report includes
false alarms, both native direction counts, trivial baselines and every missed
harm, so correlated improvements cannot hide a false-safe prediction.

## What this tells us about a quality fix

Directional terms materially improve max prediction, but full-resolution terms
alone remain insufficient. Both native scales are needed by the tested formulas
to follow these DC and retained-AC interactions. This explains why a scalar
display-error or masked quadratic improvement cannot safely guide the next
decision. It does not locate the exact harmful pixel or prove that every term
is necessary in a different model.

The full reference can serve as an offline diagnostic for these cases. It does
not provide a cost-qualified local predictor: complete source and reconstruction
preparation, frequency bands, masks and maps remain expensive. The earlier
reference implementation estimated about 240 bytes per source pixel for prepared
full/half states before additional scratch and maps. That historical estimate is
not a new memory measurement or permission to put the full model in the encoder.
This run overlaps repository checks and supports no speed claim.

These 800 observations share sixteen already inspected photos, distances, modes
and restorations. They are not independent validation images. A survivor is only
a candidate for later independent development validation of these DC changes.
The previous model's validation on other interventions does not substitute for
that check. No joint rate-distortion decision is authorized or evaluated here.

The tested models predict Butteraugli, not SSIMULACRA2. The blue-channel SSIM
contribution found in the channel audit still needs protection. Neither this
screen nor its perfect reference signs show that the two failed holdout SSIM
guards have been repaired. Their identities and curves remain uninspected.

## Verification and reproduction

All 800 existing observations are retained. Identical PNGs within the same source
photo reuse 81 scores, leaving 719 distinct model evaluations. Verification checks
the frozen plan and input, seven implementation hashes, all 800 PNG identities,
unchanged native labels, finite nonnegative predictions and equal predictions
for equal reconstructions. The existing source headers and full package/docs
license notices remain intact.

Eight gate-boundary checks, an invalid-score check and three odd-size identity
model checks pass. The six existing perceptual fixtures also pass, including
native fixture comparisons. Strict experimental TypeScript passes. The archived
six scripts and fixed plan reconstruct exactly in a scratch directory.

A fresh `VITEST_MAX_WORKERS=4 npm run check` passes static, package and browser
checks, with 340 files and 4,229 tests passing. One file and three tests are skipped.
Final report formatting and diff checks pass.

[DC-MODEL-SCREEN.patch](DC-MODEL-SCREEN.patch) contains first-party composition,
assessment and verification scripts. In a scratch checkout at the base above,
with the saved channel-audit PNGs, labels and prepared development corpus present:

```sh
git apply benchmark/jpegxl/lossy-lab/DC-MODEL-SCREEN.patch
mkdir -p .tmp/jpegxl-lossy-lab/dc-model-screen-20261104
cp benchmark/jpegxl/lossy-lab/dc-model-screen-plan.json .tmp/jpegxl-lossy-lab/dc-model-screen-20261104/plan.json
node benchmark/jpegxl/lossy-lab/verify-dc-model-assessment.ts
node benchmark/jpegxl/lossy-lab/run-dc-model-screen.ts
node benchmark/jpegxl/lossy-lab/summarize-dc-model-screen.ts
node benchmark/jpegxl/lossy-lab/verify-dc-model-screen.ts
```

Use a fresh output directory because start, point and result receipts refuse
overwriting. [DC-MODEL-SCREEN.json](DC-MODEL-SCREEN.json) retains the plan, all 800
predictions and native scores, assessments, missed harms and validation receipts.
The larger raw evidence stays under
`.tmp/jpegxl-lossy-lab/dc-model-screen-20261104/`. The native labels and images
come from the previous channel audit unchanged.

## Disposition

One approved round and three fixed formulas are complete: two rejected and one
reference passes this screen. Zero encoder changes, new encoded configurations,
retained encoder changes or promotions. Active source, tests, package metadata
and executable lab TypeScript are unchanged. The branch remains unready to merge.

The previous rejected predictor trial's full-development BD-rates remain:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -10.184% | -4.810% | -4.548% |
| jSquash | -12.333% | -1.230% | +3.116% |

Prior crop time remains 2.387946x jSquash; the 13 MP original is 1.512916x.
The 21 MP peer aborts, so its ratio remains unavailable. Original managed peaks
remain 59,210,879/91,262,401 bytes against the 137,514,476-byte ceiling.
Root/specialized bundles remain 614,969/687,801 bytes; runtime dependencies zero.
No promotion evidence is refreshed by this diagnostic.

Next hypotheses, in order: validate the full reference on independent development
DC interventions; determine whether exact local updates can make that model
affordable; examine mixed-predictor contexts/tokens for rate recovery while
preserving pixels. Quality upside is unmeasured, and the first two are diagnostic
prerequisites rather than demonstrated encoder gains. No gates change. The
bounded screen is complete and stops here; another round needs owner renewal
under steering section 9.
