# Smaller AC allocation shifts and selector mask traversal

Aaron asked to continue the coherent standalone investigation. This comparison
starts from `6f282d51` on `jxl-libjxl-ports`, using the retained
`standalone-selector-inverse` mode. Main stays unchanged. All decisions come from
pixels and distance, with no peer maps.

The preceding 1.1x AC experiment failed the development grain guard. Coupling it
with actual luma rounding repaired that guard but added 12.721% encode time for
only a 0.048% mean full-lab gain. This follow-up tests smaller AC shifts without
that rounding cost.

## Allocation screens

Each multiplier scales the floating initial quantization field before transform
selection and final wire rounding. DC steps, global scale, high-frequency
modulation, filters, CfL and coefficient writing retain the control policy.
Changing global scale alone would cancel inside InitialQuantField. Regression
tests check that every new mode retains the control's DC and global scale.

All three screens finish 80 points on the fixed 16-photo development subset and
five distances. Values below are mean BD-rate percentages in SSIMULACRA2 /
Butteraugli 3-norm / Butteraugli max order. Negative is better. Quality runs use
parallel workers; their timings are excluded from speed claims.

| AC precision | vs vips | vs jSquash | vs retained |
| --- | --- | --- | --- |
| 1.025 | -10.527 / -5.894 / -4.897 | -11.547 / -0.234 / +2.373 | +0.089 / -0.440 / -1.683 |
| 1.05 | -10.744 / -6.194 / -5.852 | -11.615 / -0.430 / +1.292 | -0.118 / -0.772 / -2.763 |
| 1.075 | -10.523 / -5.999 / -5.234 | -11.397 / -0.282 / +1.974 | +0.138 / -0.603 / -2.126 |

The first two points proceed to the fixed 64-photo, nine-distance full lab.
Precision 1.075 has weaker means and a larger grain SSIM regression than 1.05,
so it is rejected at the screen. Grain screen SSIM changes against retained are
+0.726%, +1.426% and +2.142%, respectively. Full-band production guards decide
whether either finalist can be retained.

## Exact selector experiment

A fresh profile on development crop im26-3012 at distance 2 still identifies
selector scoring as the largest encoder self-time: 334.752ms, followed by the
paired forward transform at 297.389ms and cached inverse at 213.273ms. Profiling
runs alongside quality jobs and establishes relative hotspots only.

`selector-mask-loss.ts` walks the existing bounded mask by rows. It removes
per-pixel division and remainder while preserving pixel order, multiplication
order and eighth-power accumulation. It adds no buffers or source-sized state.
Direct comparisons cover all supported DCT dimensions, both tile corners and
all three channel weights. Encoded-byte comparisons cover tile and image edges.
The source formula retains the libjxl file, revision and license attribution in
the module and PROVENANCE.md.

Raw artifacts are under
`.tmp/jpegxl-lossy-lab/standalone-ac-small-20261015/`.

## Full allocation labs

| AC precision | vs vips | vs jSquash | vs retained | Mean vs retained |
| --- | --- | --- | --- | --- |
| 1.025 | -8.038 / -4.887 / -5.471 | -8.535 / +0.605 / +2.784 | +0.013 / -0.206 / +0.146 | -0.016 |
| 1.05 | -8.046 / -5.012 / -5.457 | -8.507 / +0.379 / +2.771 | +0.050 / -0.364 / +0.156 | -0.053 |
| Coarse envelope | -8.003 / -5.030 / -5.582 | -8.474 / +0.227 / +2.571 | +0.223 / -0.345 / +0.135 | +0.004 |

Each row contains 576 valid outputs. The full ladder removes the screen gains.
Both constant points pass all eight admitted production SSIM guards. Grain reaches
+7.280% and +7.741%, respectively, while the texture reaches +7.325% and +7.187%.
There are no full-band Butteraugli 3-norm admissions. Every output in both rows
also decodes independently in jxl-rs within one code value of native libjxl.

The extra diagnostic compares complementary distance envelopes. Fine allocation
uses 1.05 below distance 1.5 and tapers to one at distance 3. Coarse allocation
retains one through 1.5 and reaches 1.1 at distance 3. Both remain continuous and
retain the same DC policy, including at distances where the multiplier is one.
This is a first-party allocation experiment, not a further libjxl source port.

| Distance envelope | vs vips | vs jSquash | vs retained |
| --- | --- | --- | --- |
| Fine | -10.432 / -5.681 / -5.108 | -11.349 / +0.196 / +2.127 | +0.342 / -0.169 / -1.965 |
| Coarse | -10.654 / -5.866 / -5.164 | -11.546 / -0.300 / +2.115 | -0.006 / -0.456 / -1.859 |

The fine envelope is rejected: the constant 1.05 screen is better in all three
means, and the coarse envelope preserves SSIM better. The coarse full lab is
neutral, changing the three-metric mean by +0.004%. It is rejected too.
The development grain curves show increased file size at every
setting for constant 1.1; they do not establish DC allocation as the cause.

## Second exact selector experiment

The same scoring loop copies each candidate's source pixels into planar scratch.
An 8-pixel-wide transform has contiguous 64-value source blocks. A second mode
uses TypedArray.set for those blocks when the source has exactly 64 values.
Wider candidates retain their original copy loop. This removes indexed copying
without adding buffers, temporary subarrays or source reads. Separate and
combined modes permit measuring it independently of mask traversal.

All experimental source and tests are preserved in
[AC-FOLLOWUP-EXPERIMENT.patch](AC-FOLLOWUP-EXPERIMENT.patch), checked against
`6f282d51`. The final retained code is determined by the isolated measurements.

## Isolated speed results

All timings below run after the quality jobs, independent decoder jobs and
browser tests finish. Pair order alternates, and warmup samples are excluded.
All exact-mode pairs preserve their encoded bytes and managed peaks.

| Comparison | Pairs | Paired time change | MAD, points | Faster pairs |
| --- | --- | --- | --- | --- |
| Mask traversal alone, median crop | 15 | +3.451% | 6.113 | 7 |
| Bulk copy alone, median crop | 15 | +2.244% | 2.718 | 5 |
| Combined, median crop | 15 | -2.962% | 3.857 | 10 |
| Combined repeat, median crop | 21 | -2.355% | 5.094 | 14 |
| Combined, neighboring texture | 15 | -4.661% | 6.248 | 10 |
| AC precision 1.05, median crop | 15 | -1.101% | 6.428 | 8 |
| AC precision 1.025, median crop | 15 | +0.951% | 7.193 | 7 |

The allocation timings do not establish a benefit. For 1.05, absolute medians
are almost identical at 1146.979/1147.828ms. The 1.025 run has baseline/candidate
CVs of 20.26/29.35%. Neither negligible quality gain justifies replacing the
retained policy. All five allocation modes are removed from active code and
preserved in the patch.

The combined speed adaptation is supported by two median-crop sets and a
neighbor. Its components are not individually selected. Their explicit modes
remain development comparators, with no public imports.

A fresh cold cohort measures all 64 frozen crops using one existing worker
process per mode and image. Every encode validates natively and scores. The
baseline/candidate medians are 1445.452/1389.078ms. Median per-image change is
-3.151%, MAD 2.558 points, IQR 5.105 points, with 51/64 pairs faster. The ratio of
absolute medians improves 3.900%. All 64 byte pairs and managed peaks match.
Across-image baseline/candidate CVs are 6.40/8.42% and include image variation.

The original cold batch is interrupted after 32 pairs with exit 143. Its entire
timing cohort is excluded. The successful v2 cohort uses four fresh fixed chunks
of 16, retains global alternating order and creates output directories
exclusively. It reuses no timing from the interrupted run.

A separate control checks actual unchanged Git source on 16 evenly spaced crops
at original indices 0, 4, ..., 60. Baseline workers import a Git archive of
`6f282d51`; candidate workers import the cleaned source. Medians are
1472.286/1457.513ms; paired change -1.715%, MAD 3.097 points, 10/16 faster. All
bytes and managed peaks match. This supports a small gain and limits the claim:
the 3.151% cohort figure compares against the in-tree baseline alias. It does
not establish a uniform 3% gain against unchanged Git source.

## Verified checkpoint

Fresh isolated crop timing completes all 192 jobs with no failures, omissions or
reused samples. Own median is 1437.381ms, jSquash 513.573ms and vips 377.943ms,
for 2.798786x jSquash. Managed peak stays 8,735,786 bytes; worker RSS is
203,079,680 bytes.

A fresh isolated 13 MP run completes all three engines. Own time is
47.354s, jSquash 26.441s and vips 9.352s, a 1.790932x ratio.
The 1,835,008-byte output retains SHA256 bf5af0e7aef114d596a6dde6b3a7786ab09931cbc2a16f548c9ee0e511e7b6ee.
Managed peak stays 59,071,615 bytes. Encoder RSS is 414,584,832 bytes;
whole-worker RSS including validation/scoring is 562,528,256 bytes.
The first original batch is interrupted after one job; its timings are excluded.
The fresh -v2 run supplies all original timing above. No 21 MP or full-watch
qualification is claimed.

The full check passes 4,133 tests, three existing skips and all static/package/
docs/browser-build gates in 609.04s test duration. Chromium, Firefox and WebKit
pass. Bundles remain 614,941/687,773 bytes under unchanged ceilings, with no runtime
dependencies. The retained source changes only development selector work and its
tests. The two prior holdout guards remain unresolved, so main stays unchanged.

## Guard-focused follow-up

The coarse envelope is neutral by mean but improves the worst admitted
development SSIM regression from 7.676866% to 7.192478%. Its grain result is
7.031600%; all eight admitted guards pass. This distinction warrants freezing
that allocation together with the faster exact selector for the next promotion
attempt. Selection uses development results only. The frozen holdout will be
read only through aggregate metrics and guard counts after entry gates pass.
