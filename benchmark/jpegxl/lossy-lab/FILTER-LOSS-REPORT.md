# Filter distortion loss and SSIMULACRA2

Thirteen fixed screens produce 1,040 valid outputs. No filter-loss mode is retained.
The full-region Gaussian loss improves SSIMULACRA2 BD-rate by 0.212% against
control, but worsens Butteraugli 3-norm by 0.270%. Its combined gain is only
0.002%, with an isolated 86.167% encode-time cost. The retained writer stays on
research branch `jxl-libjxl-ports`. Main and the closed holdout are unchanged.

## What hurts SSIMULACRA2

The previous pointwise squared-error objective rewards removing some genuine
texture along with reconstruction error. An offline diagnostic compares the
previous best sampled mode with the retained writer at distances 2 and 4 on all
sixteen development screen crops. Mean native SSIMULACRA2 change is -0.006069
score points. Its full-resolution Y pointwise error falls 0.0766%, while Y lost
detail rises 0.4997%; at the next scale structural error rises 0.0874% and lost
detail rises 0.5189%. This diagnostic uses box neighborhoods and reports features;
it does not replace the native metric.

Development painting im26-3012/d2 loses 0.401038 score points in that previous
mode. Its fine brush marks and cracks are legitimate detail. Y lost detail rises
5.7654%, and coarse Y structural error rises 2.3055%. Changing only the color
representation to B-Y barely affects the screen, so color alone is insufficient.

To separate objective error from sampling, change sharpness from four to seven
in each of sixteen fixed 64x64 regions, one region at a time. These are offline
own-encoder interventions, never a runtime metric search or native decision map.

| Development case | Harmful/helpful interventions | Sparse pointwise signs correct | Full-region pointwise | Sparse Gaussian | Full-region Gaussian |
| --- | --- | --- | --- | --- | --- |
| im26-3012/d2 painting | 16/0 | 12/16 | 8/16 | 14/16 | 16/16 |
| im26-3312/d4 texture | 9/7 | 7/16 | 6/16 | 10/16 | 6/16 |

The painting result demonstrates a wrong pointwise objective: complete regional
coverage still makes eight wrong predictions. It does not establish a generally
accurate Gaussian selector. The texture counterexample contains both directions
and defeats that same model. An always-keep-four decision would also get all
sixteen painting signs correct, so the one-class result is not a classifier win.

Both controls and every changed region agree with native decoded pixels within
one code value, with zero values beyond one. The painting control is byte exact
with the retained stream. This excludes a large reconstruction mismatch to the
project's decoder tolerance; it does not exclude metric sensitivity to the last
code value. Coarse-scale pooling, region borders, display rounding and sparse
extrapolation remain model approximations, rather than proven individual causes.
There are 68 causal-audit encodes, including the two repeated parity audits.

## Losses and screen results

Every mode uses our final emitted coefficients, our decoder formulas and one EPF
iteration. No peer decisions enter the encoder. Choose sharpness 0, 2, 4 or 7
once per 64x64 region. Keep the predictor-5 map entropy and alphabet charge.
Reported rates use the complete actual stream size, never the estimated map cost.

The structural losses use libjxl v0.12.0's corrected SSIM formula, normalized X,
Y and B-Y, and explicit added-edge/lost-detail features. The weighted models use
the exact feature weights for the first three scales. The Gaussian approximation
uses a seven-tap separable sigma-1.5 kernel with clamped patch borders. It pools
XYB rather than downsampling linear RGB first, and omits the three coarsest native
scales. These are development surrogates, not exact SSIMULACRA2 implementations.

The last two modes cache the mean maps and unrooted fourth moments for each
choice, then pool across the image before taking fourth roots. The mixed mode
blends the normalized change in this loss with normalized pointwise error.
Neither requires another reconstruction pass. The dual mode permits a change
only if both predicted losses improve. Full-region rows score every pixel;
all other rows use one 16x16 sample per region.

Values below are SSIMULACRA2 / Butteraugli 3-norm / maximum BD-rate percentages.
Control is the retained `standalone-forward-all` writer. Each row has eighty
fresh, independently decoded/scored outputs, zero execution failures or omissions.
Seventy-three partial-band warnings per screen remain explicit in the JSON;
a complete execution is not a full-band promotion claim. Fixed screen: sixteen
photos, distances 0.5/1/2/4/7, effort 7. Concurrent timings are excluded.

| Loss | Against control | Against vips | Against jSquash |
| --- | --- | --- | --- |
| Opponent color only | +0.321/+0.081/+0.766 | -10.359/-5.789/-4.448 | -11.252/-0.213/+2.878 |
| Local corrected SSIM | +0.119/+0.371/+0.697 | -10.547/-5.515/-4.505 | -11.444/+0.075/+2.820 |
| Structure and detail penalties | +0.064/+0.429/+0.715 | -10.599/-5.459/-4.488 | -11.497/+0.133/+2.844 |
| Weighted mean/L4, box moments | +0.237/+0.637/+0.407 | -10.443/-5.270/-4.789 | -11.340/+0.335/+2.482 |
| Weighted metric, global normalization | +0.277/+0.698/+0.477 | -10.409/-5.216/-4.720 | -11.306/+0.398/+2.560 |
| Signed gradient error | +0.341/+0.103/+0.630 | -10.345/-5.768/-4.581 | -11.240/-0.191/+2.741 |
| Robust absolute error | +0.212/+0.003/+0.279 | -10.462/-5.864/-4.901 | -11.355/-0.294/+2.388 |
| Gaussian moments, sparse | +0.248/+0.655/+0.434 | -10.436/-5.252/-4.766 | -11.334/+0.352/+2.509 |
| Gaussian moments, full regions | -0.212/+0.270/-0.065 | -10.857/-5.609/-5.234 | -11.751/-0.025/+2.045 |
| Dual native and Gaussian constraint | +0.176/+0.102/+0.806 | -10.497/-5.769/-4.401 | -11.392/-0.195/+2.932 |
| Pointwise error, full regions | +0.148/-0.146/-0.080 | -10.522/-6.008/-5.249 | -11.416/-0.444/+2.020 |
| Gaussian image-wide moment pooling | +0.269/+0.830/+0.673 | -10.420/-5.090/-4.537 | -11.318/+0.517/+2.803 |
| Pooled Gaussian and pointwise blend | +0.250/+0.314/+0.669 | -10.432/-5.575/-4.532 | -11.329/+0.017/+2.794 |

Coverage and loss must be considered separately. The earlier sparse pointwise
row was +0.329/+0.083/+0.767%; scoring full regions gives
+0.148/-0.146/-0.080%. Sparse Gaussian gives +0.248/+0.655/+0.434%; full-region
Gaussian gives -0.212/+0.270/-0.065%. Coverage helps both criteria. At fixed full
coverage, structural loss repairs SSIM by trading away Butteraugli 3-norm.
Image-wide fourth-moment pooling alone does not fix sparse prediction error.

Virtual quality-at-control-bytes and rate-at-control-quality curves are preserved
in the JSON for diagnosis. They are not additive or encodable promotion rows.
For example, local structure already improves virtual SSIM by 0.0096%, while
actual rate makes its final SSIM result +0.1185%. The rate-aware model controls
most earlier map overhead but does not eliminate the quality tradeoff.

## Time, memory and verification

Two isolated 21-pair series follow one warmup pair on im26-3012/d2, alternating
execution order. Per-mode hashes are stable. Full-region Gaussian takes median
2027.888ms versus control 1098.376ms, paired +86.167%, MAD 14.558 points,
only 1/21 wins. The series is noisy, with CV 0.415/0.378, but its added cost is
far larger than the 0.0023-point combined gain. Under the speed rule this cost
would need about 8.617 points of combined gain. This is not a fresh absolute
jSquash speed qualification.

Full-region pointwise takes median 1329.301ms versus control 1004.704ms,
paired +30.020%, MAD 4.487 points and 0/21 wins. Its CV is 0.0449/0.0436.
The combined gain is 0.0262 points; this cost requires about 3.002 points.
Joint warm-process RSS is 337,588 KiB with the same measurement scope.
Both series manage 5,682,267 bytes on this crop. The screen maximum is 9,238,381
bytes, below the unchanged 137,514,476-byte ceiling. Joint warm-process RSS for
the Gaussian series is 348,968 KiB; this scope includes Node and both alternating
modes and is not the codec's managed-memory figure or a cold per-mode RSS gate.

Profiles locate feature work: sparse weighted metric has 27.337ms loss self and
75.046ms evaluator-inclusive samples; gradient has 7.433/62.255ms; full-region
Gaussian has 1502.990/2653.418ms. Profiles ran under concurrent diagnostic load,
so their wall times are not speed comparisons. Generic EPF edge traversal is
absent from this sampled path; full Gaussian feature work is the new cost.

Before archival, strict TypeScript and lint pass, all 156 focused cases pass,
and Chromium, Firefox and WebKit pass on fixed source. Cases cover feature
pooling, identity loss, edge/detail behavior, map rate, changing sharpness,
odd/thin image edges and final-coefficient reconstruction parity. An unchanged
cache fixture timed out once under concurrent diagnostics; it passes the
isolated rerun without a timeout change. The cleaned-tree full check passes with code zero and no signal: 4,156
tests pass, 3 existing tests skip; 328 files pass and 1 skips. Tests take
486.44s; the full command takes 526.533s. No benchmark overlaps
this check. Static, package, docs and browser-build gates pass.

## Retained state and next work

The previous 64-photo, nine-distance retained writer result remains
-8.003/-5.030/-5.582% against vips and -8.474/+0.227/+2.571% against jSquash.
Against main it is -7.149/-10.072/-9.609%. All eight admitted development SSIM
guards pass, worst 7.192%; no 3-norm comparison covers the full required band.
The frozen holdout still has two SSIM guard failures, worst 11.617%. It was not
reopened or used to tune this experiment. The overall objective is not complete.

Retained isolated crop speed is 2.635783x jSquash; 13MP is 41.894s, 1.698729x,
with 59,139,199 managed bytes. The earlier 21MP run finishes in 83.743s with
91,010,461 managed bytes and a jSquash abort. No new original-size qualification
is inferred from filter screens. Package bundles remain 614,941/687,773 bytes,
with no runtime dependencies.

No candidate earns a full lab or holdout. All thirteen losses are archived in
`FILTER-LOSS-EXPERIMENT.patch`, based on `1e10c5f4`; active code returns to
that retained writer. Source headers and [provenance](../PROVENANCE.md) preserve
the pinned libjxl attribution. No public codec or package source changes.

The next hypotheses, ranked by evidence, are:

1. Audit exact display rounding and linear-RGB scale features on the mixed-sign
   texture interventions. Require better sign agreement on both development
   cases before another loss sweep; the last-code-value and pooling hypotheses
   are currently unresolved.
2. If that diagnostic improves, distill only its useful local features into a
   cheaper bounded patch loss. Full-region Gaussian is too expensive to retain.
3. Measure allocation/transform-boundary decisions jointly with filtering only
   after the regional predictor is credible. The present evidence does not
   justify another large coherent port or a holdout run.

## Reproduction

Raw evidence: `.tmp/jpegxl-lossy-lab/filter-loss-20261018`.
The machine-readable [report](FILTER-LOSS-REPORT.json) preserves exact results,
causal interventions, profiles, timing dispersion and verification receipts.
Restore the archived experiment on its recorded base, and use a fresh output
root for each run:

```sh
git apply benchmark/jpegxl/lossy-lab/FILTER-LOSS-EXPERIMENT.patch
node benchmark/jpegxl/lossy-lab/run.ts \
  --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json \
  --out .tmp/jpegxl-lossy-lab/filter-loss-reproduction \
  --mode screen --variant standalone-filter-gaussian-full \
  --strategy-port standalone-filter-gaussian-full --workers 4
```

Use `filter-loss-diagnostic.ts` for decoded-crop features and
`filter-loss-region-audit.ts input.png fresh-output-root distance` for the
fixed sixteen-region interventions. Neither diagnostic is an encoder mode.
