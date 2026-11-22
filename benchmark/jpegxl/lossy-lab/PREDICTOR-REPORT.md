# Rate and local error predictor validation

Research branch `jxl-libjxl-ports`, base `85511d53`, 2026-10-28.
Entries LL-995 through LL-1000. Main and the holdout are unchanged.

The final entropy model can estimate batch savings reasonably well. Frozen
models and the ordinary order-selection estimator cannot reliably predict
the final rate change. The tested local error features cannot protect
Butteraugli max, even when given exact native decoded pixels. Joint RD was
therefore not implemented. No encoder policy or speed change is retained.

## Rate validation

Replay the rejected `standalone-rd25-filtered` changes against the retained
`standalone-forward-all` encoder. Use all 16 screen photos at distance 1.85,
then all 15 local subsets and 30 individual interventions on im26-2004.
The instrumented runs reproduce every previous endpoint and intervention
hash and color-bit count. There are 81 newly scored streams, including the
two-stream smoke check and repeated endpoints.

Four estimates are compared with the final writer's actual unpadded color
bits. Savings are positive. The ordinary estimate is the existing selected
order/family model before final histogram and hybrid-configuration refinement.
The frozen estimate uses the control's actual signaled histograms, hybrid
configurations, coefficient order and context policy. It replays all affected
contexts, including changes to nonzero-count prediction and scan state.
The exact frozen variant serializes these same symbols with that fixed model.
The adaptive estimate uses the final rebuilt model, actual header bits and
normalized ANS entropy, with one 32-bit state per AC group.

| Estimate | Screen nonzero signs | Screen mean absolute error | Marginal mean absolute error |
| --- | ---: | ---: | ---: |
| Existing order-selection estimate | 10/13 | 78.455 bits | 22.599 bits |
| Frozen control model | 5/7 supported | 56.660 bits | 22.528 bits |
| Exact frozen serialization | 5/7 supported | 56.300 bits | 20.600 bits |
| Final rebuilt model plus metadata | 13/13 | 7.255 bits | 4.445 bits |

Six of the 16 screen candidates introduce symbols absent from the frozen
model in their new contexts. These are explicitly unsupported estimates,
not silently assigned a probability floor. The frozen-error averages exclude
those six pairs. All averages include unchanged supported pairs; sign counts
exclude zero actual deltas. These are finite observed errors, not bounds.

| Case | Frozen estimate saved | Exact frozen saved | Final-model estimate saved | Actual color bits saved |
| --- | ---: | ---: | ---: | ---: |
| im26-1626, one removal | 10.555 | 16 | -22.115 | -13 |
| im26-1210, 78 changes | 305.032 | 300 | -67.320 | -54 |
| im26-2004, 731 changes | unsupported | unsupported | 2764.211 | 2754 |

On im26-1626 the rebuilt AC payload saves 64 bits but its HF header adds
77 bits. On im26-1210 the rebuilt payload adds 2,619 bits while metadata
saves 2,565. An exact frozen payload estimate cannot account for either
model switch. Across all 61 comparisons, actual metadata changes plus exact
AC changes account for every final color-bit delta.

The final-model estimator gets all 20 nonzero marginal signs right, but also
predicts positive savings for all 25 interventions whose actual saving is
zero. Its largest marginal error is 22.412 bits; the largest screen error
is 20.151 bits. A small entropy saving cannot justify quality loss without
checking serialization. Rebuilding the model is also real work: these probes
repeat token walks and writes and do not establish a cheap encoder predictor
or a speed improvement.

## Local error validation

Before evaluating results, fix 16/32/64 overlapping windows and four features:
RMSE, source-variance-normalized error, source-gradient-normalized error,
and contrast-amplitude error. Evaluate display luma and linear-light luma,
each with max and third-norm pooling. The normalization floor is 1/255 squared.
Neither the native peak nor the trial chooses window locations. No weights
are fitted. The input is the exact native decoded PNG, making this an
optimistic check before any cheaper encoder-side reconstruction approximation.

Use the 16 screen photos at distances 1.3, 1.85 and 3, then apply the unchanged
formulas to the remaining 48 development photos at the same distances.
This is 192 cached native-scored endpoint pairs. The diagnostic criterion is
at least 80% sign accuracy on at least ten native changes above 0.1%, with no
native harm above 1% predicted nonpositive. It does not replace lab gates.

| Development subset | Best max sign accuracy on material changes | Always-worse baseline for that subset |
| --- | ---: | ---: |
| 16 screen photos, 48 pairs | 4/6 (66.667%), display RMSE at 16 | 3/6 (50.000%) |
| Other 48 photos, 144 pairs | 18/27 (66.667%), display RMSE at 32 | 16/27 (59.259%) |

The best row in each subset is reported descriptively; selecting it after
seeing the validation set would not qualify a predictor. No max feature
passes. For example, display RMSE at 16 misses im26-1468 at distance 1.3,
where native max rises 7.825%, and im26-3004 at 1.85, where it rises 6.128%.
Changing window size moves these failures rather than establishing a
reliable perceptual estimate.

Several third-norm features correctly predict all nine material screen
changes and all 30 material changes in the remaining photos. Every one of
these native changes is worse. The trivial always-worse prediction also
gets 100%, so this result does not validate quality-aware selection.

### Check local effects without image-wide pooling

As a separate diagnostic, divide each image into fixed, disjoint 16/32
windows. Select windows containing changed decoded pixels, then compare
feature changes to the native distance map in those same windows. Use the
16 screen endpoint pairs and 45 coefficient interventions at 1.85. This
selection does not consult native error values. The local map norms are
diagnostics, not new whole-image metric scores.

| Set and target | Best observed sign accuracy | Always-worse baseline | Missed local harms above 1% |
| --- | ---: | ---: | ---: |
| Screen, local max | 313/510 (61.373%) | 62.157% | 10 |
| Screen, local 3-norm | 542/631 (85.895%) | 83.043% | 0 |
| Interventions, local max | 21/37 (56.757%) | 59.459% | 1 |
| Interventions, local 3-norm | 34/44 (77.273%) | 68.182% | 0 |

These best observed features differ between rows. Windows from the same
photo and related coefficient subsets are correlated observations, not
independent validation images. Local max still fails, so global pooling
alone does not explain the predictor problem. The current evidence does
not support a joint RD policy using these features.

## Retained state and next work

Retain offline validation tools, four focused tests and the instrumentation
archive. Restore all encoder files to `85511d53`. The existing rejected
rounding modes remain only in `DISPLAY-EXPERIMENT.patch`; temporary rate
instrumentation is in `RATE-INSTRUMENTATION.patch`. No runtime dependency
or new third-party port is added.

Prior retained full-development BD-rate remains:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -8.003% | -5.030% | -5.582% |
| jSquash | -8.474% | +0.227% | +2.571% |

Carried-forward crop speed is 2.635783x jSquash; 13 MP is 41.894s and
1.698729x. The prior 21 MP encode completes while jSquash aborts. Managed
peaks remain 8,760,382 / 59,139,199 / 91,010,461 bytes for crops / 13 MP /
21 MP, below 137,514,476. Bundles remain 614,941 / 687,773 minified bytes,
with zero runtime dependencies. These are prior measurements, not new
qualification results. The two frozen holdout SSIM guards remain unresolved.

Next hypotheses:

1. Make batch rate evaluation cheaper by updating token counts for changed
   transforms and their nonzero-prediction neighbors. Missing frozen-model
   symbols must trigger model refresh; close estimates need exact writes.
2. Validate perceptual masking and color-channel error on a balanced set of
   beneficial and harmful interventions. The current luma predictors fail
   even with exact decoded pixels; faster approximations cannot fix that.
3. Only after that validation, try joint block decisions with a batch model
   refresh and exact rate acceptance, then apply the normal lab and speed gates.

## Reproduction

Raw root: `.tmp/jpegxl-lossy-lab/predictors-20261028/`. `rate-summary.json`
contains every rate comparison; `screen/` and `marginal/` retain streams,
native PNGs, distance maps and rates. `final-features-screen/` and
`final-features-validation/` contain fixed-window features, native deltas and
class-balance summaries. `local-patches/` records every matched local window.
The feature refactor reproduces all 192 earlier feature rows exactly.

```sh
# Temporary diagnostic setup in the research checkout.
git apply benchmark/jpegxl/lossy-lab/DISPLAY-EXPERIMENT.patch
git apply benchmark/jpegxl/lossy-lab/RATE-INSTRUMENTATION.patch
node benchmark/jpegxl/lossy-lab/audit-local-rate.ts fresh/screen/im26-1626 endpoints im26-1626 rate
# Repeat endpoints for all manifest screenIds, then:
node benchmark/jpegxl/lossy-lab/audit-local-rate.ts fresh/marginal marginal im26-2004 rate
node benchmark/jpegxl/lossy-lab/summarize-rate-predictors.ts fresh
node benchmark/jpegxl/lossy-lab/validate-local-patches.ts fresh/local-patches fresh
# These use the prior full-lab decoded artifacts and need no runtime patch:
node benchmark/jpegxl/lossy-lab/validate-local-predictors.ts fresh/features-screen screen
node benchmark/jpegxl/lossy-lab/validate-local-predictors.ts fresh/features-validation validation
```

Rate-audit mode fails explicitly when its archived instrumentation is absent.
Restore encoder files and remove the temporary rounding module/test before
the final checks or any future promotion.

Validation: `VITEST_MAX_WORKERS=4 npm run check` passes, exit 0, with 4,191
tests passed and three existing skips; 333 files pass and one is skipped.
Test phase 534.01s; complete check 575.69s. Chromium, Firefox and WebKit
decision fixtures pass. Seven focused predictor/rate tests pass. Both archives
apply cleanly, the absent-instrumentation check fails explicitly, and diff
whitespace checks pass. Every public codec source and active encoder decision
file matches the starting checkpoint. Logs, status and 12 evidence hashes are
under the raw root. No holdout rerun, promotion or main merge occurred.
