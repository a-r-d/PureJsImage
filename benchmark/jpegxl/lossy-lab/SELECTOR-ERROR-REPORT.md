# Selector reconstruction error investigation

The continuation starts from `c706e64d` on `jxl-libjxl-ports`, with
`standalone-guard-coarse` as control. All decisions use our own pixels and
distance. Main stays unchanged. No holdout run is used in this investigation.

Fifteen screens test whether the selector's missing reconstruction terms and
the CfL source ordering explain
the remaining quality guards. Each screen completes all 16 development photos
at five fixed distances. Every output validates in native libjxl and receives
all three quality scores. Timing from these concurrent runs is excluded.

BD-rate changes against the frozen control, in percent:

| Error estimate | SSIMULACRA2 | 3-norm | Max |
| --- | --- | --- | --- |
| DC, all channels | +0.042 | -0.002 | +0.033 |
| DC, luma | +0.042 | -0.000 | +0.034 |
| Gaborish, all channels | -0.121 | -0.163 | +1.424 |
| Gaborish, luma | -0.075 | -0.114 | +1.502 |
| DC and Gaborish, all channels | -0.119 | -0.147 | +1.502 |
| DC and Gaborish, luma | -0.116 | -0.140 | +1.532 |
| CfL propagation | +0.138 | -0.052 | -1.994 |
| DC and CfL propagation | +0.254 | +0.035 | -1.923 |
| Writer quantizer, matrices, DC and CfL | +0.203 | +0.214 | -0.521 |
| Writer quantizer, matrices and CfL | +0.430 | +0.333 | -0.165 |
| CfL maps from filtered source | -0.038 | -0.051 | -0.018 |
| Filtered-source X map only | -0.034 | -0.034 | -0.042 |
| Filtered-source B map only | +0.006 | -0.018 | -0.034 |
| Filtered-source maps and CfL loss | +0.142 | -0.014 | -1.890 |
| Quantizer-weighted filtered-source maps | -0.044 | -0.043 | +0.023 |

DC error uses our actual rounded compact DC grid and the decoder's normative
low-frequency reconstruction, normalized to the selector's AC scale. Gaborish
filters the predicted spatial error with our decoder's default kernel, using
clamped candidate borders. This estimate omits EPF, neighboring errors and the
inverse filter's approximation. CfL propagates luma reconstruction error into
chroma with separate AC and DC ratios. The B-minus-Y working plane requires
the default unit luma contribution as well as the local AC correlation.

The CfL-only screen advances to the fixed 64-photo, nine-distance full lab:

| Reference | SSIMULACRA2 | 3-norm | Max |
| --- | --- | --- | --- |
| Frozen control | +0.155 | +0.122 | -0.334 |
| wasm-vips | -7.855 | -4.908 | -5.907 |
| jSquash | -8.332 | +0.309 | +2.200 |
| Main control | -6.961 | -9.961 | -10.026 |
| Native-map replay | -10.088 | -5.858 | -5.577 |

All 576 full-lab outputs validate natively and score. The mean change against
control is -0.019%, substantially smaller than the screen suggested. All eight
admitted SSIM guards pass, but the worst reaches +8.039% against main, compared
with +7.192% for control. The tolerance limit remains +8.05%. No 3-norm curve
admits the complete 0.5-3 band. These coverage limits remain explicit.

The ten reconstruction-error trials are rejected. CfL's isolated fifteen-pair test is
5.545% slower, with only 3/15 faster pairs. Baseline/candidate medians are
1088.599/1124.302ms, with paired MAD 3.669 percentage points. The tiny 0.019%
full-lab mean gain does not meet the speed rule. The point's managed peak stays
at 5,682,267 bytes. The experiments are preserved in
[SELECTOR-ERROR-EXPERIMENT.patch](SELECTOR-ERROR-EXPERIMENT.patch) for `c706e64d`.
The patch is checked to apply to that base.

The fresh development profile identifies selector scoring, paired forward DCT
and inverse DCT as its largest selector costs, at 220.995, 212.754 and 165.758ms
self time. Profiling is concurrent diagnostic evidence. Two exact speed
experiments test fixed scratch-view reuse and row coefficient traversal;
fixture streams and managed peaks match the control. View reuse has no
measured gain: paired +7.855%, MAD 8.139 points, 5/15 faster. Row traversal is
inconclusive at paired -3.289%, MAD 5.381 points, 8/15 faster; its absolute
medians go in the other direction. It requires a fresh repeat.

The pipeline audit reads libjxl's `enc_heuristics.cc` at the pinned v0.12.0
revision. Native CfL estimation follows Gaborish preconditioning. Our mode
retains covariance maps computed before preconditioning. Five source-order
screens therefore recompute our estimator on the already cached filtered
tile, without an extra image pass. The unchanged-source test reproduces our
current maps exactly, including Float32 accumulation and per-block centering.
Channel separation and initial-quantizer-squared weighting isolate their
contributions. The both-channel unweighted mode advances to the full lab
because all three screen means improve slightly.

The filtered-source full lab completes all 576 outputs with native validation
and all scores:

| Reference | SSIMULACRA2 | 3-norm | Max |
| --- | --- | --- | --- |
| Frozen control | -0.034 | -0.036 | +0.034 |
| wasm-vips | -8.032 | -5.061 | -5.546 |
| jSquash | -8.501 | +0.195 | +2.604 |
| Main control | -7.149 | -10.118 | -9.580 |

The mean gain is only 0.012%. The same eight SSIM guards pass, with the worst
unchanged at +7.192%. No 3-norm curve admits the full required band. Managed
peak remains 9,232,573 bytes. Source ordering is a verified difference, but
reordering our existing covariance estimator yields little quality improvement.

Fifteen isolated pairs show no speed benefit for filtered-source estimation:
baseline/candidate medians 1134.559/1188.175ms, paired +2.554%, MAD 7.042 points,
6/15 faster. A 0.012% mean quality gain does not justify this result. The source
ordering trials are rejected and archived with the reconstruction-error trials.
All quality decisions return to `c706e64d`.

The cleaned row-traversal candidate then runs 21 alternating pairs against an
unchanged copy of actual `c706e64d` source. Every encoded hash, input hash and
managed peak matches. Baseline/candidate medians are 1191.568/1202.306ms, paired
-2.192%, MAD 8.750 points, and only 11/21 pairs improve. The conflicting medians
and high noise do not establish a speed gain. Row traversal is not retained.

The encoder, tests, browser fixture, package metadata and runtime dependencies
are restored exactly to `c706e64d`. The full experiment patch applies to that
base and retains the rejected code and tests. The combined view/row alias was
fixture-tested but received no timing run and is not retained.

This batch stops under the fifteen-trial plateau rule, with zero retained
quality or speed change. The best two full-lab mean gains are 0.019% and 0.012%,
and their measured costs provide no reason to retain either. Across all
screens and both full labs, 2,352 fresh encoded outputs validate natively and
receive all scores. No individual holdout result is read and no holdout run
is started.

The next source-informed candidate is libjxl's coefficient-weighted CfL fit,
including its pull toward zero. The source uses weighted transform residuals
and a different objective from our covariance estimator. A cheap adaptation
of that fit and shrinkage is another option. Neither is implemented or timed
here. A separate remaining loss-model hypothesis is the actual source
roundtrip residual of preconditioning, which the linear filter trials omit.

The final restored-tree `VITEST_MAX_WORKERS=4 npm run check` passes all static,
package, docs and browser-build gates, plus 4,147 tests with three existing
skips. There are 327 passed files and one skipped file; test duration is
611.10s. Two managed executions end with SIGTERM before producing a verdict.
A durable runner completes the same command in 662.419s and records exit code
0 with no signal in `check-v4-status.json`. Both interrupted logs are preserved.
Public bundles remain 614,941/687,773 bytes, with zero runtime dependencies.
The full pinned libjxl license is present in package notices and rendered by
the docs page.

All 111 focused cases and Chromium, Firefox and WebKit pass the experimental
tree. TypeScript checking passes. No public codec or package source changes.

Raw artifacts: `.tmp/jpegxl-lossy-lab/standalone-dc-loss-20261015/`.
Exact quality summaries and development guards are in
[SELECTOR-ERROR-REPORT.json](SELECTOR-ERROR-REPORT.json).
