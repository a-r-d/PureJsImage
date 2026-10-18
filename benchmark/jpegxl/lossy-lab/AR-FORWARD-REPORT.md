# Reconstruction-driven EPF and writer transforms

Research branch jxl-libjxl-ports, starting at 1f8d6a5a. Main is unchanged.
The nine EPF screens all regress. The writer transform replacement preserves
572 of 576 full development streams exactly and is retained for a measured
speed gain on the research branch.
The holdout stays closed and the two frozen SSIM failures still block promotion.

## Source correction and port

The previous report ranked native perceptual quantizer refinement first. That
was an incorrect inference for the target effort. In pinned libjxl v0.12.0,
encode.cc maps effort to 10 - effort, common.h defines kKitten=2 and
kSquirrel=3, and FindBestQuantizer only runs its normal perceptual refinement
through kKitten. Our effort-7 peer skips it.

ComputeARHeuristics does run at effort 7. Its source choices, distance thresholds,
squared masking, channel weights and no-smoothing preference were ported to
a development module with the required source header and provenance entry.
Native histogram counts are strictly below totals initialized to one. Their
integer ratio is always zero, so the final context multipliers reduce exactly
to one before the no-smoothing preference.

The adaptation reconstructs our final quantized coefficients, including bias,
physical DC, CfL, Gaborish and EPF, in 64x64 tiles with an eight-pixel halo.
Pixel scratch is bounded independently of image size; one compact ownership
index scales with block count. Native float error accumulators become doubles.
The retained one-iteration cap and native iteration counts are tested separately.
At thin odd sizes and across coefficient-group boundaries, reconstructed RGB
agrees with a complete decode within one code value, including three iterations.

## Fixed screen

Values are SSIMULACRA2/Butteraugli 3-norm/maximum BD-rate percentages.
Every row has 80 fresh natively validated outputs and zero execution failures
or omissions. Partial-range metric warnings are reported separately by the runner.

| Trial | Versus frozen control | Versus vips | Versus jSquash |
| --- | --- | --- | --- |
| Native choices and no-smoothing preference | +5.132/+4.123/+3.197 | -6.604/-2.145/-2.215 | -7.427/+3.735/+5.388 |
| Include retained sharpness 4 | +5.994/+4.942/+3.871 | -5.841/-1.394/-1.585 | -6.673/+4.507/+6.080 |
| Remove no-smoothing preference | +6.876/+4.842/+3.887 | -5.401/-1.592/-1.657 | -6.355/+4.259/+6.056 |
| Couple native iteration counts | +7.773/+6.085/+5.265 | -4.711/-0.331/-0.318 | -5.657/+5.415/+7.422 |
| Native iterations, constant sharpness 4 | +2.239/+1.955/+1.231 | -8.535/-4.004/-3.881 | -9.519/+1.683/+3.343 |
| Luma error only | +5.146/+4.148/+3.190 | -6.592/-2.123/-2.223 | -7.416/+3.760/+5.381 |
| Unmasked XYB error | +5.196/+4.603/+3.408 | -6.620/-1.696/-2.020 | -7.426/+4.263/+5.608 |
| Require 1% actual error reduction | +5.167/+4.183/+3.367 | -6.442/-2.040/-2.051 | -7.392/+3.729/+5.545 |
| Require 5% actual error reduction | +2.165/+1.597/+1.660 | -8.760/-4.351/-3.587 | -9.685/+1.278/+3.818 |
| Separable/paired writer transforms | +0.000/+0.000/+0.000 | -10.654/-5.866/-5.164 | -11.546/-0.300/+2.115 |

Native sharpness selection on development im26-3012/d2 chooses 2,195 blocks
at zero, 38 at two and 1,863 at seven. Including four still leaves 3,599 of
4,096 blocks at an extreme. The baseline uses four throughout. The native map
adds 603 bytes at this point; including four adds 865 bytes. Luma-only and
unmasked losses do not repair the perceptual regression. Actual-error guards
also fail. No EPF candidate earns a full lab or a holdout run.

Diagnostic profiling also finds substantial added work: AR reconstruction
233.962ms, EPF edge handling 135.463ms and packed-group unpacking 99.788ms
of sampled self time. These are diagnostic samples, not a speed comparison.

## Why the EPF rows regress

A diagnostic separates changed reconstruction quality from added bytes. These
are virtual curves, not encodable results or promotion evidence: one uses AR
quality with the control byte counts; the other uses AR byte counts with control
quality. The two effects are not additive because interpolation and overlaps
change. All actual screening and gate decisions still use complete valid streams.

| Rule | Mean matched file growth | Quality at control bytes, SSIM/3-norm/max | Rate at control quality |
| --- | --- | --- | --- |
| Native | +4.321% | -0.581/-0.748/-1.030% | +5.696/+4.857/+4.218% |
| Include four | +5.142% | -0.756/-0.950/-1.399% | +6.740/+5.888/+5.263% |
| Require 5% error reduction | +2.229% | -0.592/-1.070/-0.649% | +2.766/+2.688/+2.309% |

The native rule improves decoded quality modestly; added map rate overwhelms
that gain. The lower-rate guard cuts the loss but still costs too much. A development
bitstream audit confirms all 24 checked non-sharpness decision fields match
control, including transforms, quantization, CfL, matrices and filter settings. This
corrects the early inference that the weighted error rule itself harms decoded
quality. The remaining component needs a decision cost that accounts for map
bits and substantially cheaper evaluation, rather than another scalar error
weight. This result concerns the added EPF maps in our writer; it does not
replace the earlier coupled audit's conclusion about the overall encoder gap.

## Writer result

The retained control still spends 66.598ms of sampled self time in dense final
writer transforms. The separate first-party trial reuses the existing separable
small kernels and paired large DCTs. It changes no decision or quantizer.
Every screen stream matches. In the full lab, 572 streams match exactly and
Four differ because the direct formulas and inverted floating-point matrix
change quantizer rounding slightly. Mean BD-rate deltas are +0.000037/-0.000027/-0.000039 percentage points.
The full lab completes all 192 engine jobs with no failures or execution omissions.

Full-lab vips: -8.003/-5.030/-5.582%;
jSquash: -8.474/+0.227/+2.571%.
All eight admitted development SSIM guards pass, with the worst unchanged
at +7.192%; zero full-band 3-norm guards are admitted. All 576 streams
agree between native libjxl and jxl-rs within one code value. No quality gain is claimed. Concurrent quality/profile
timing is excluded from speed claims.

Raw receipts: .tmp/jpegxl-lossy-lab/standalone-reconstruction-20261017. The campaign produces 1,376 quality outputs and three
additional profiled points. Source and tests are preserved in
AR-FORWARD-EXPERIMENT.patch for 1f8d6a5a.

## Isolated speed and retained scope

All quality jobs and focused/browser tests finish before speed comparisons.
Each image uses one warmup and 21 alternating baseline/candidate pairs at d2.

| Development image | Baseline/candidate median ms | Paired delta | Paired MAD | Faster pairs |
| --- | --- | --- | --- | --- |
| im26-3012 | 1041.879/1001.839 | -2.710% | 3.044 points | 15/21 |
| im26-3312 | 1079.402/1032.218 | -4.081% | 2.734 points | 18/21 |

All paired streams are exact. Managed point peaks remain 5,682,267 and
5,678,171 bytes. The full-lab managed maximum is unchanged at 9,232,573 bytes.
An earlier comparison gave -3.278%, but the experimental dispatcher also
wrapped the baseline call. Direct baseline dispatch is restored before the
two confirmation series above. No whole-corpus speed delta is inferred from
these two images.

The fresh cold crop cohort completes all 192 jobs, with no failures, execution
omissions or reused speed jobs. Own/jSquash/vips medians are
1,280.342/485.754/333.820ms. The 2.635783x jSquash ratio passes the 3x crop
limit. Managed crop maximum stays at 8,760,382 bytes.

Only the first-party writer trial remains active. The rejected AR module,
its normative-kernel exports and its aliases are removed. The archived patch
applies cleanly to 1f8d6a5a. No source in src/ or public package options changes.
The inherited peer-forcing hooks still need removal or exclusion before a
main merge. Frozen holdout failures, full watch/scale qualification and the
remaining promotion gates remain open. No release or version change.

The 13 MP development original completes all three engine jobs and its
independent decode agrees with native pixels within one code value. Encode times
are 41.894/24.662/9.221s for ours/jSquash/vips, a 1.698729x jSquash ratio.
Managed peak is unchanged at 59,139,199 bytes, below the 137,514,476 ceiling.
The encoder process peak RSS is 437,436,416 bytes; this is distinct from managed
encoder storage. This is one development original, not full watch qualification.

## Verification

The experimental source passes 101 focused cases and three browsers against
fixed source. During cleanup, an alias insertion also changed two existing
test calls; the focused check caught it, the calls were restored, and all
71 retained-tree focused cases pass. Public src/ and package files match the
starting revision. VITEST_MAX_WORKERS=4 npm run check passes with code 0 and no signal:
4,156 tests pass, three existing skips; 328 files pass and one skips. The full
command takes 529.934s; test duration is 489.92s. Static, package, docs and
browser-build gates pass. Codec/specialized bundles stay at 614,941/687,773
bytes under unchanged ceilings, with zero runtime dependencies.

Next hypotheses: sample reconstructed error for coarser sharpness regions;
include map bits in the sharpness decision; reduce inverse/scoring work before
a bounded first-party quantizer correction. Native effort-8 perceptual
search is not an effort-7 parity component.
