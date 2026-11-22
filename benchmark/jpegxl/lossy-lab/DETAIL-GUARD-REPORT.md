# Local detail and the SSIM guard

This round does not repair the two frozen holdout SSIM failures. Fourteen quality
experiments complete nine screens, three full development labs and two DC probes.
The best grain improvement lowers its development main-relative SSIM guard from
+7.032% to +4.844%, but the candidate still fails the incremental speed rule.
Only an exact speed change in the development writer-rounding selector is kept.
Main, public encoder behavior, quality gates and the holdout remain unchanged.

Base: `97c76933a1cfa7f4df4ffdb92349172d1f53c7ca`, branch `jxl-libjxl-ports`,
2026-10-29. Aaron reopened development research to address the failed guards.
No individual holdout results or identities were read. The known two failures,
worst +11.617%, remain the previous frozen result, not a fresh measurement.
[The JSON report](DETAIL-GUARD-REPORT.json) retains comparisons, coverage,
timing samples, hashes, DC probes and memory evidence. Raw artifacts are in
`.tmp/jpegxl-lossy-lab/detail-guard-20261029/`.

## Hypothesis and screens

The selector models AC reconstruction error before display filtering. The new
losses use existing preconditioned luma and inverse-transformed coefficient
residuals. Each 8x8 cell contributes a contrast, structure or lost-detail term.
The regularized structure mode adapts the SSIM denominator and 0.0009 stabilizer
from the attributed libjxl metric source. It uses box moments, omits DC and other
scales/channels, and is a diagnostic approximation. Actual rounding uses our
writer's existing quantizer. No peer maps or full image metric maps are consumed.

The first contrast/structure trials improve maximum error while worsening SSIM.
Coupling structure with actual rounding preserves much of the grain benefit.
Regularization attenuates almost-flat cells. Constant AC precision and a separate
lost-detail penalty test the remaining tradeoff. The no-structure ablation shows
that rounding supplies most of the grain SSIM benefit.

Each screen has 16 fixed development photos at five distances, 80 native-valid
outputs. Percentages are SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max BD-rate;
negative is better. Concurrent quality timings do not establish speed.

| Screen | vs vips | vs jSquash | vs retained |
| --- | --- | --- | --- |
| Contrast, half strength | -10.291 / -5.825 / -5.550 | -11.377 / -0.431 / +1.733 | +0.415 / +0.038 / -0.337 |
| Structure, half strength | -10.447 / -5.830 / -6.860 | -11.532 / -0.549 / +0.230 | +0.216 / +0.028 / -1.670 |
| Structure plus actual rounding | -10.779 / -5.807 / -5.931 | -11.866 / -0.526 / +1.201 | -0.112 / +0.069 / -0.620 |
| Regularized structure plus actual rounding | -10.720 / -5.851 / -6.493 | -11.810 / -0.554 / +0.605 | -0.046 / +0.028 / -1.221 |
| Same, constant AC precision 1.05 | -10.758 / -6.110 / -5.856 | -11.818 / -0.555 / +1.138 | -0.107 / -0.247 / -0.782 |
| Same, constant AC precision 1.10 | -10.601 / -6.033 / -7.075 | -11.680 / -0.673 / -0.023 | +0.088 / -0.251 / -2.060 |
| Actual rounding without structure | -10.945 / -5.952 / -4.641 | -11.891 / -0.469 / +2.565 | -0.292 / -0.076 / +0.605 |
| Actual rounding plus quarter lost-detail weight | -10.679 / -5.782 / -6.200 | -11.755 / -0.390 / +0.905 | +0.000 / +0.094 / -0.926 |
| Actual rounding plus half lost-detail weight | -10.251 / -5.424 / -6.542 | -11.343 / -0.123 / +0.519 | +0.457 / +0.458 / -1.295 |

## Full development

Each finalist completes 576 native-valid outputs on the fixed nine-distance
ladder. Full-lab results supersede the larger screen gains.

| Mode | vs vips | vs jSquash | vs retained | Grain SSIM vs main | Texture SSIM vs main |
| --- | --- | --- | --- | ---: | ---: |
| Retained | -8.003 / -5.030 / -5.582 | -8.474 / +0.227 / +2.571 | 0 / 0 / 0 | +7.032 | +7.192 |
| Structure plus actual rounding | -8.219 / -5.177 / -5.926 | -8.740 / -0.008 / +2.083 | -0.264 / -0.165 / -0.333 | +4.870 | +8.064 |
| Regularized plus actual rounding | -8.205 / -5.199 / -5.631 | -8.726 / -0.012 / +2.408 | -0.258 / -0.186 / -0.039 | +4.844 | +7.579 |
| Regularized, AC precision 1.05 | -8.226 / -5.164 / -5.656 | -8.725 / +0.121 / +2.439 | -0.390 / -0.191 / -0.116 | +5.731 | +7.800 |

The development examples are im26-2004 (grain) and im26-3302 (texture). All three
finalists admit eight main-relative SSIM guards and zero full-band 3-norm guards.
Unregularized structure fails the 8.05% limit. Both regularized modes pass those
eight guards, although their worst value is worse than retained. That worsening
is a tradeoff, not an additional promotion threshold. Neither passes cost.
Partial-band maximum-error tails against retained reach +5.957%, +6.054% and
+10.157%, respectively. They are reported separately from the admitted guards;
maximum error is not a per-image gate under the latest promotion-entry decision.
No holdout or full-original qualification follows a failed entry cost check.

Luma-only DC probes keep chroma, AC and all other decisions fixed. Each multiplier
has 18 native-valid outputs across the same two development examples and nine
distances. At 0.75, grain changes +0.158/+0.815/+0.631% against retained, and
texture changes -0.221/+0.633/-0.928%. At 0.5, both examples worsen across all
three metrics. These probes reject a uniform luma-only precision increase as a
repair. The initial diagnostic integrated unbounded measured overlap; the
corrected results above use SSIM 60-90 and max 0.5-3 with the existing metric
implementation. Both versions are preserved, and reproduction uses the corrected
bounds. The 3-norm calculation retains the established measured-overlap policy.

## Exact selector speed change and cost

A fresh profile found repeated Gaborish/source preparation used only to restore
the writer's activity-dependent rounding state. The selector now optionally reads
the original context directly and reuses that state across candidate shapes at
the same origin. Uncorrelated pixel reads leave the state unchanged. The original
filtered path remains available as a test reference. The shortcut is enabled in
the standalone development orchestration; production code and the retained
nearest-rounding quality mode do not change.

All 80 saved regularized screen streams remain exact after the origin cache.
The coupled prototype's 21 alternating pairs are all faster, median ratio
0.890870. In the retained historical writer-rounding mode, 21 pairs on im26-3012
measure ratio 0.905780 (19 faster), and 21 on im26-3312 measure 0.941942 (18 faster).
All paired streams and managed peaks are identical. These are improvements to
the writer-rounding research mode, not a 6-9% speed claim for the default encoder.

| Quality policy vs retained control | Median paired ratio | Faster pairs | Allowed ratio |
| --- | ---: | ---: | ---: |
| Regularized, before origin cache | 1.076451 | 2/15 | 1.016124 |
| Regularized, after cache | 1.058437 | 2/21 | 1.016124 |
| Regularized AC1.05, after cache | 1.058084 | 1/21 | 1.023233 |

The latter two full-lab mean gains are only 0.161235% and 0.232331%. Under the
unchanged one-percent-gain-per-ten-percent-cost rule, both fail. The archived
AC1.05 timing imports the preserved experimental sources and verifies every
candidate hash against the saved quality stream. No tuning follows these costs.

## Memory

The retained shortcut adds two numeric origin coordinates and no buffers. Managed
peak stays exactly 5,676,123 bytes in both isolated texture processes. After three
warmups and explicit collection, both retain 2,713,100 ArrayBuffer bytes and
15,945,129 external bytes. After three measured warm encodes and collection, both
return to the same ArrayBuffer size and 15,942,589 external bytes.

Cold process peak RSS is 152,657,920 / 155,516,928 bytes (base/optimized). Warm
process peaks are 194,850,816 / 186,716,160 bytes. These single-process samples
show no retained-buffer increase; they do not establish an RSS optimization.
Earlier samples are preserved: one direct-shell launch reports a pre-existing
989,945,856-byte high-water mark, and one-warmup measurements retain transient
buffers. Those samples are excluded from clean peak and post-warmup baseline
claims. The final runs use fresh child processes and three warmups so baseline
buffers are demonstrably reclaimed. No original-image memory qualification is
inferred from these crop diagnostics.

## Preservation and validation

`DETAIL-GUARD-EXPERIMENT.patch` preserves all quality modes, their attributed
helper and tests against base `97c76933`. It passes `git apply --check` against
that base. Only the activity-state optimization and its regression coverage stay
active. The experimental suite passes 106 cases before archival; the cleaned
selector suite passes 73, including both writer-rounding modes across fine,
medium and coarse distances, mixed activity, tile edges and odd dimensions.
The decision-transplant fixture also passes in Chromium, Firefox and WebKit.
`VITEST_MAX_WORKERS=4 npm run check` passes all static gates, browser:check and
4,214 tests, with three skips. Existing lint/large-file warnings remain unchanged.
JPEG XL bundle sizes stay 614,969/687,801 bytes; runtime dependencies stay zero.

This session produces 2,484 native-valid experimental outputs, plus 80 fresh
control outputs and 80 exact state-cache replay checks. The per-image comparisons
retain partial-band warnings. Rejected changes do not count as retained quality
gain. No source/package dependency, version, main branch or public forcing hook
is changed in this round. Existing public-bundle isolation remains a later merge
requirement for the whole research branch.

The round reaches the steering's approximately-15-experiment plateau with zero
retained quality gain. Remaining hypotheses, in estimated order of usefulness:

1. Profile candidate-count changes under regularized loss, then tighten exact
   admissible lower bounds. It needs roughly four more percentage points of
   cost reduction before it can qualify for a frozen aggregate holdout attempt.
2. Model the local contrast change after display filtering within bounded tile
   support. The current preconditioned-luma proxy trades grain against texture;
   a useful cheap predictor remains unproven.
3. Test selective luma DC allocation only if a rate/error audit identifies a
   useful class of blocks. The uniform probes give no support for another global
   DC sweep.

Further quality research requires another owner continuation under
[LOSSY_STEERING.md section 9](../LOSSY_STEERING.md#9-stopping-and-escalation).
All quality, speed and memory limits stay unchanged.
