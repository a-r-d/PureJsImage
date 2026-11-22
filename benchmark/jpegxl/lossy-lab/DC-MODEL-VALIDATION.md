# Fixed DC model validation, 2026-11-04

The unchanged full directional multiscale reference passes all four predeclared
gates on the other 48 development photos. It predicts every material Butteraugli
direction correctly and misses none of 273 max harms above 1%. This confirms
the reference on these additional DC cases. It does not qualify a cheaper
selector, repair the SSIM guards or promote an encoder change.

All 1,440 fixed reconstructions complete. There are 144 actual mode comparisons
and 1,152 within-mode restorations. The model uses 1,294 distinct evaluations;
146 identical reconstructions reuse a prediction within the same source photo.
No new JPEG XL encodes, fitted weights, peer decisions or holdout reads occur.

## Accuracy

Correct/material counts use native absolute score changes above 0.1%.
Missed harms are native regressions above 1% predicted nonpositive.

| Cohort | Metric | Correct/material signs | Missed harms / harms above 1% | Gate |
| --- | --- | ---: | ---: | --- |
| Actual modes, 144 pairs | Butteraugli max | 139/139 (100%) | 0/35 | Pass |
| Actual modes, 144 pairs | Butteraugli 3-norm | 123/123 (100%) | 0/0 | Pass |
| Channel restorations, 1,152 pairs | Butteraugli max | 1,063/1,063 (100%) | 0/238 | Pass |
| Channel restorations, 1,152 pairs | Butteraugli 3-norm | 917/917 (100%) | 0/0 | Pass |

Combined material signs are 1,202/1,202 max and 1,040/1,040 3-norm, with zero
abstentions or false alarms. Under the existing 1e-6% nonzero reporting threshold,
the model also matches all 1,283 max and 1,291 3-norm directions. These combined
counts are descriptive; the four separate gates decide acceptance.

There are no 3-norm harms above 1% in this cohort. Always predicting improvement
would already get 122/123 actual material signs and all 917 restoration signs
right. The full reference detects the one material actual regression, but the
3-norm harm gate has no above-1% examples here. Max supplies substantial harmful
cases: 59 actual and 495 restoration material regressions, including 35 and 238
above 1%. Always predicting improvement would score only 57.6% and 53.4% on max.

Across all 1,440 states, the largest absolute score error is 0.0000906876 for
max and 0.0000312460 for 3-norm. Mean absolute errors are 0.00000298587 and
0.000000596547. Native scoring and model evaluation use identical diagnostic
pixels. These are fidelity measurements on this cohort, not universal error bounds.

## Channel effects on the additional photos

Each row restores source DC within the predictor mode, compared with that mode's
actual reconstruction. Every row contains all 144 points. SSIM changes are score
points; Butteraugli changes are mean relative percentages. These are not BD-rates.

| Restored DC | SSIMULACRA2 points | BA 3-norm | BA max | Max harms above 1% |
| --- | ---: | ---: | ---: | ---: |
| X | +0.041 | -0.180% | +0.121% | 37/144 |
| Y | +0.172 | -0.725% | -0.168% | 28/144 |
| Native B | +0.327 | -0.158% | +0.073% | 17/144 |
| All | +0.761 | -1.075% | -0.212% | 42/144 |

All-channel restoration improves SSIM and 3-norm in every predictor case, yet
worsens max in 64/144, including 42 harms above 1%. The aligned mode shows the
same limitation: all-channel restoration improves SSIM and 3-norm in every case
but worsens max in 60/144, with 37 harms above 1%. Uniformly removing DC error
therefore remains an unsafe max-quality rule under the retained AC decisions.
The full model recognizes these interactions; it does not make restoration free
or select an encoded policy.

For the actual predictor versus aligned reconstructions, mean SSIM changes by
+0.681719 points, 3-norm by -1.373814% and max by -0.499569%. SSIM improves in
140/144 cases, while max worsens in sixty, including 35 above 1%. Average benefit
does not remove the local tradeoff. Native B restoration again has the largest
single-channel mean SSIM gain. The results support preserving blue detail while
accounting for max error and complete rate, but do not establish a passing repair.

## Verification

Verification checks 288 saved streams, 48 sources, all 1,440 PNG/pixel identities,
native scorer receipts and unchanged model/helper/scorer hashes. All 144 mode
pairs retain matching AC sections and decisions and become display-identical
after all-channel restoration. The fixed proposal and complete package/docs
license notices verify unchanged.

Actual reconstructions differ from saved native decoded PNGs in 13,006 samples,
by at most one 8-bit code value. This pixel comparison is separate from the
acceptance test, which compares model and native scores on the same diagnostic
PNG. It does not refresh the native encoder's full-lab quality curves.

Four saved screen predictions match exactly. The odd-size identity model,
fifteen channel-restoration checks and invalid-extent case pass. Strict diagnostic
TypeScript and exact six-file archive reconstruction pass. A fresh
`VITEST_MAX_WORKERS=4 npm run check` passes static, package and browser checks,
340 test files and 4,229 tests, with one file and three tests skipped. Final
report formatting and diff checks pass. Diagnostic execution overlaps the
repository check and is not isolated speed or memory evidence.

## Method and limits

Aaron approved one fixed validation on research base
`44050238375750112935024139e143adda16692d`. The cohort is all 48 photographic
development crops outside the sixteen-photo model screen, at distances 0.9,
1.85 and 3.8. These are fixed positions in the existing nine-point ladder,
chosen before inspecting their scores. The photos have been used elsewhere
in the broader development campaign; they are separate from this model screen,
not a new holdout.

Reuse 288 saved aligned/predictor streams. At each of 144 points, reconstruct
actual DC and the four fixed source-DC restorations: X only, Y only, native B
only and all three channels. All saved AC and filtering decisions remain fixed.
The 1,440 diagnostic PNGs receive native Butteraugli and SSIMULACRA2 scores.
Only the full directional multiscale model is evaluated. No weights, thresholds,
formulas or encoder decisions change during validation.

The model uses the same source masking, asymmetric quadratic error, six
directional costs at both scales, 0.85 full plus 0.5 half mixing, and native
mean-of-L3/L6/L12 pooling as the passing screen row. The two rejected outputs
are omitted from the wrapper. Four saved predictions match the screen exactly,
and an odd-size identity case is zero. Existing attributed source ports remain
unchanged.

The actual cohort compares aligned actual with predictor actual at every point:
144 comparisons. The restoration cohort compares each mode's actual with each
of its four fixed restorations: 1,152 comparisons. Each cohort must separately
pass both Butteraugli metrics: at least ten native changes above 0.1% in absolute
value, at least 80% correct signs, and zero harms above 1% predicted nonpositive
under the existing 1e-9 tolerance. All four gates must pass. Combined results
cannot rescue a failing cohort.

Percentages are same-distance score changes, not BD-rates. Diagnostic source DC
has no attainable encoded rate. Restoring native B is different from changing
the encoder's coded B-minus-Y residual. SSIM scores are descriptive; the tested
model does not predict SSIMULACRA2.

## What this means for the encoder

Accurate Butteraugli predictions do not choose a realizable coefficient change,
pay its entropy cost or protect SSIM. The two SSIM promotion failures remain
unresolved. No holdout input or per-image holdout curve is inspected here.

The passing screen reference is already an expensive implementation of the
metric. Earlier work has also validated a bounded regional version; simply
cropping the model is not an untried solution. Its recorded 32x32 scoring cost
was about 145-153ms with source preparation excluded. Later complete-map work
still failed its then-current encoder cost allowance. Those historical results
are documented in [LOCAL-MODEL-REPORT.md](LOCAL-MODEL-REPORT.md) and
[FULLMAP-SPEED-ROUND4-REPORT.md](FULLMAP-SPEED-ROUND4-REPORT.md). This validation
does not refresh their timing or qualify encoder speed or memory.

A possible next mechanism is to reuse unaffected prepared bands, masks and
pooling state for a small batch of DC changes, rather than recomputing a whole
halo crop for each candidate. Its accuracy and savings are unmeasured. Any
future decision policy also needs explicit protection for SSIM and complete
context-aware rate accounting. None of those encoder changes or joint decisions
is part of this approved validation.

## Reproduction

The patch archives five first-party diagnostic scripts and the fixed proposal.
Use a scratch checkout at the recorded base with the existing prepared corpus,
saved full-lab streams/native PNGs, prior model-screen receipts, and raw display
and channel audit helpers present. These prerequisites are named in the JSON
report and input records. Use fresh validation and proposal output directories.

```sh
git apply benchmark/jpegxl/lossy-lab/DC-MODEL-VALIDATION.patch
mkdir -p .tmp/jpegxl-lossy-lab/dc-model-validation-20261104
mkdir -p .tmp/jpegxl-lossy-lab/dc-model-validation-proposal-20261104
cp benchmark/jpegxl/lossy-lab/dc-model-validation-plan.json .tmp/jpegxl-lossy-lab/dc-model-validation-proposal-20261104/plan.json
node benchmark/jpegxl/lossy-lab/verify-dc-validation-fixtures.ts
node benchmark/jpegxl/lossy-lab/run-dc-model-validation.ts
node benchmark/jpegxl/lossy-lab/summarize-dc-model-validation.ts
node benchmark/jpegxl/lossy-lab/verify-dc-model-validation.ts
```

The run refuses to overwrite its plan, point images and results. Raw evidence
stays under `.tmp/jpegxl-lossy-lab/dc-model-validation-20261104/`.
[DC-MODEL-VALIDATION.json](DC-MODEL-VALIDATION.json) retains the fixed plan,
all native/model scores, four acceptance decisions, descriptive channel results,
hash receipts and verification. No new libjxl source port is introduced.

## Unchanged encoder qualification

The previous rejected predictor trial's full-development BD-rates remain:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -10.184% | -4.810% | -4.548% |
| jSquash | -12.333% | -1.230% | +3.116% |

Prior crop time remains 2.387946x jSquash and the 13 MP original 1.512916x.
The 21 MP peer aborts, so its ratio remains unavailable. Original managed peaks
remain 59,210,879/91,262,401 bytes against the 137,514,476-byte ceiling.
Root/specialized bundles remain 614,969/687,801 bytes, with zero runtime
dependencies. The current validation refreshes none of those promotion results.

One fixed validation is complete; zero new encoded configurations, encoder
changes, retained encoder changes or promotions. The research branch remains
unready to merge. The round stops after this report under the owner approval
and steering section 9, with all quality, speed, memory and promotion gates
unchanged.

Remaining hypotheses, ranked: reuse unchanged model state for localized DC
updates; protect SSIM when choosing coupled DC/AC changes; recover rate through
mixed-predictor contexts or token mappings without changing pixels. Their
quality or speed upside is unmeasured. No additional round starts without
owner renewal.
