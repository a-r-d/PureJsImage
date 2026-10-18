# Native CfL and small-transform follow-up

Nineteen development screens and one full lab retain no change. All 2,096 quality
outputs validate natively and score. Two extra profiled points also validate.
The encoder, tests and browser fixture are restored exactly to c706e64d.
Research stays on jxl-libjxl-ports; main is unchanged. The last frozen holdout
still has two failing SSIM guards. No holdout is rerun or inspected per image.

The [experiment patch](CFL-MENU-EXPERIMENT.patch) applies to fba646a8, whose
encoder source matches c706e64d. It preserves the licensed native CfL port,
all nineteen trial modes and their focused tests. [Machine-readable results](CFL-MENU-REPORT.json).

## Screens

The fixed screen has sixteen development photos at distances 0.5, 1, 2, 4 and 7.
Every vector is SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max BD-rate, in percent.
Negative means smaller files. Control is frozen standalone-guard-coarse.
Peer versions and effort stay unchanged: wasm-vips 0.0.19 and jSquash 1.3.0, effort 7.

| Screen | Against frozen control | Against vips | Against jSquash |
| --- | --- | --- | --- |
| Full native CfL1 and CfL2 | +0.815 / +0.240 / +0.389 | -9.969 / -5.657 / -4.829 | -10.783 / -0.030 / +2.460 |
| Full initial CfL only | +3.639 / +2.038 / +0.987 | -7.605 / -3.978 / -4.247 | -8.385 / +1.681 / +3.132 |
| Full final CfL only | +0.828 / +0.201 / +0.592 | -9.956 / -5.693 / -4.641 | -10.824 / -0.118 / +2.642 |
| Fast CfL1 and CfL2 | +0.558 / +0.011 / +0.141 | -10.125 / -5.848 / -5.052 | -10.993 / -0.282 / +2.197 |
| Fast initial CfL only | +0.577 / -0.008 / +0.123 | -10.109 / -5.864 / -5.067 | -10.976 / -0.302 / +2.179 |
| Fast final CfL only | +0.527 / +0.031 / +0.460 | -10.153 / -5.825 / -4.752 | -11.022 / -0.259 / +2.509 |
| Shrink our existing maps | +0.581 / -0.028 / +0.048 | -10.099 / -5.879 / -5.138 | -10.959 / -0.317 / +2.111 |
| Writer-scaled full CfL | +0.815 / +0.240 / +0.389 | -9.969 / -5.657 / -4.829 | -10.783 / -0.030 / +2.460 |
| Fast CfL without shrinkage | +0.310 / +0.083 / +0.064 | -10.383 / -5.800 / -5.117 | -11.287 / -0.228 / +2.157 |
| Complete small-transform menu | +0.218 / +0.149 / +0.180 | -10.451 / -5.723 / -4.983 | -11.349 / -0.149 / +2.300 |
| Half-block DCTs | +0.086 / +0.037 / +0.114 | -10.577 / -5.832 / -5.051 | -11.473 / -0.261 / +2.234 |
| AFV choices | +0.209 / +0.145 / +0.249 | -10.459 / -5.728 / -4.921 | -11.359 / -0.155 / +2.366 |
| Adaptive small menu | +0.114 / +0.078 / +0.140 | -10.553 / -5.791 / -5.022 | -11.454 / -0.220 / +2.259 |
| Full menu with final quantizer | +0.351 / +0.238 / -1.243 | -10.326 / -5.615 / -6.462 | -11.271 / -0.148 / +0.695 |
| Full menu with writer rounding | +0.179 / +0.357 / -0.502 | -10.515 / -5.530 / -5.752 | -11.474 / -0.053 / +1.346 |
| Compact menu with final quantizer | +0.273 / +0.209 / -0.042 | -10.399 / -5.641 / -5.187 | -11.339 / -0.176 / +2.032 |
| Adaptive menu with final quantizer | +0.351 / +0.308 / +0.088 | -10.327 / -5.549 / -5.073 | -11.271 / -0.081 / +2.153 |
| Half-block DCTs with final quantizer | +0.375 / +0.265 / +0.081 | -10.307 / -5.590 / -5.079 | -11.254 / -0.124 / +2.144 |
| AFV choices with final quantizer | +0.458 / +0.357 / -0.980 | -10.226 / -5.502 / -6.204 | -11.176 / -0.031 / +0.964 |

## Full lab

The complete small menu with the final-field cost model is the strongest
screen finalist, with mean -0.218% against control. The frozen full lab uses
all 64 development photos and nine distances. All 192 engine jobs finish;
all 576 new own streams validate natively and score, without execution
failures or missing jobs. The 293 summary warnings concern quality-band
coverage. They are not unfinished encodes. The summary's complete flag stays
false because those warnings remain.

| Reference | SSIMULACRA2 | 3-norm | Max | Mean |
| --- | ---: | ---: | ---: | ---: |
| Frozen control | +0.324% | +0.131% | -0.028% | +0.142% |
| wasm-vips | -7.693% | -4.906% | -5.595% | -6.065% |
| jSquash | -8.173% | +0.366% | +2.585% | -1.741% |
| Unchanged public control | -6.749% | -9.901% | -9.566% | -8.739% |

All eight admitted public-control SSIM guards pass, but the worst worsens
from 7.192% to 7.391%. There are zero full-band 3-norm admissions; this does
not prove per-image parity over the required 3-norm band. Measured managed
peak is 9,235,829 bytes. The screen's -1.243% maximum-error gain collapses to
-0.028% on the full ladder. Reject the candidate. AFV-only with the final
field is weaker on every screen metric and does not justify another full lab.

## What the experiments establish

The native coefficient fit changes real signaled decisions. On development
im26-3012/d2, the full initial fit introduces 54 nonzero X tiles versus four
in control. The final full and fast fits remove all X correlations and weaken
B correlation. DC defaults and matrix scales agree in this diagnostic.

Native 2.6 shrinkage alone costs +0.581% screen SSIM, reproducing most of the
fast fit's +0.558% loss. Removing shrinkage reduces that loss to +0.310%,
but the quantization-weighted fit still loses. This is evidence against
transplanting that suppression constant into our current decisions.
The full iterative solver is worse than the fast fit and adds a leading
221.118ms of sampled self time in the diagnostic profile.

Adding transform choices alone also loses. Final-field scoring and the full
small menu together improve maximum error on the screen; neither component
alone retains that effect. This interaction needs the full lab: the strongest
combined screen still regresses the full-lab mean and weakens the worst guard.

## Speed, licensing and verification

All quality timing is concurrent diagnostic data. No new formal speed result
is claimed because quality rejects every candidate. The expanded-menu profile
shows selector score at 235.460ms self time, dense selection transforms at
125.658ms, and AFV inverse at 79.601ms. AFV also reaches the existing allocating
normative inverse fallback. Optimizing those calls would currently speed a
quality regression. No candidate reaches holdout or original-image promotion.

The retained encoder's existing isolated crop ratio remains 2.777562x jSquash.
Its qualified 13 MP time is 46.094s, 1.790821x jSquash; the 21 MP run is 83.743s
with a jSquash abort. Retained managed maximum is 91,010,461 bytes under the
unchanged 137,514,476-byte ceiling. These are the frozen control's measurements,
preserved by restoring its exact source, not new timing from this batch.

The new module names libjxl v0.12.0 and its full commit, carries the required
copyright/BSD-3 header and explains the scalar and B-minus-Y adaptations.
[Provenance](../PROVENANCE.md) records each source. The full libjxl license
matches THIRD_PARTY_NOTICES, is packaged, and is imported by the docs notice page.
There are zero runtime dependencies. Experimental tests pass 119 cases,
typecheck and matching Node/Chromium/Firefox/WebKit receipts for all nineteen modes.

Restored-tree VITEST_MAX_WORKERS=4 npm run check passes with code 0 and no
signal: 4,147 tests pass, three existing skips; 327 files pass and one skips.
Test duration is 486.22s; the full command takes 526.264s. All static, package,
docs and browser-build gates pass. Bundles remain 614,941/687,773 bytes under
unchanged ceilings. No release, version, tag or main merge.

## Stop and remaining hypotheses

This batch exceeds the steering's roughly fifteen experiments without 1%
retained development gain. Stop and report under
[LOSSY_STEERING.md section 9](../LOSSY_STEERING.md#9-stopping-and-escalation).
The holdout objective's means previously pass, but two SSIM guards still block
promotion. The inherited peer-forcing hooks also require cleanup before a
main merge. Full watch/scale promotion remains pending.

Estimated remaining upside, ranked qualitatively; none is measured here:

1. Final quantizer refinement after transform selection. Native FindBestQuantizer
   uses reconstructed error after the initial field and AdjustQuantField stages.
   This has the highest plausible quality upside. A bounded, cheap approximation
   needs a separate large-port proposal; the native perceptual search has unknown
   TypeScript speed and memory cost.
2. Reconstruction-driven EPF sharpness. Native ComputeARHeuristics evaluates
   reconstructed block error, while our retained mode uses constant sharpness
   and caps iterations. Estimated upside is moderate and may affect texture
   guards; reconstruction cost must fit the speed rule.
3. A selector error estimate with neighboring filter halos and final decoded
   color. Estimated upside is moderate to low, with substantial cost risk.
   Previous candidate-local clamped filter/DC/CfL estimates already failed;
   repeating them is not a new hypothesis.

Raw receipts: .tmp/jpegxl-lossy-lab/standalone-native-cfl-20261017. The previous retained qualification is in
[GUARD-ALLOCATION-REPORT.md](GUARD-ALLOCATION-REPORT.md). Previous error-model
rejections remain in [SELECTOR-ERROR-REPORT.md](SELECTOR-ERROR-REPORT.md).
