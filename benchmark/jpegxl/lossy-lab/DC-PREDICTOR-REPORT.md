# Fixed-allocation predictor DC trial, 2026-11-03

The fixed predictor DC trial is rejected for promotion. Both previous holdout
SSIM guard failures remain, with the worst worsening from +10.579530% to
+11.202599% against the +8.05% limit. Aggregate quality, speed entry and managed
memory pass. The branch is not ready to merge.

Aaron approved one fixed configuration on `jxl-libjxl-ports`, base
`7115c408866f5664cecb02b566bc5fa08aaddfcd`. This trial changes no active source
or public defaults. No sweep, peer decisions or holdout tuning is permitted.

## Configuration and source

The named `libjxl-predictor-dc-port.ts` module takes `QuantizeWP` and the DC
group traversal from libjxl v0.12.0, commit
`a7a9c787341cf703dede03c2009fa460cae5e5df`. It uses the source's 0.62 dead zone,
predictor-relative rounding and extra DC precision bit. Large residuals round
to even integers; values near the weighted prediction can use half nominal
steps. The port preserves Float32 boundaries and rounds ties away from zero.

Aligned AC 1.25 nominal DC matrices, original-luma chroma subtraction,
smoothing off, AC decisions and current entropy selection remain fixed.
The first-party weighted predictor resets for each channel and DC group.
Storage adds three Float32 DC planes, 12 bytes per cell, and at most 10,416
bytes of predictor scratch. Original peak memory still requires measurement.
Source/BSD headers, the full package/docs license and PROVENANCE record apply.

## Development results

The screen contains 16 photos and 80 outputs; the full lab contains 64 photos
and 576 outputs. All decode and score with native libjxl. Full-lab elapsed time
is 379.273 seconds. Parallel timings overlap repository checks and are excluded.

| Full development reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -10.183799% | -4.810374% | -4.547658% |
| jSquash reference | -12.333085% | -1.230200% | +3.116260% |
| Aligned control | -2.658231% | +1.994027% | +3.048905% |
| AC 1.25 | -2.655930% | +1.918509% | +3.274653% |
| Regularized control | -1.838726% | -0.068701% | +1.221661% |
| Main | -8.703826% | -10.154198% | -8.167541% |

The vips three-metric mean is -6.513944%. Eight admitted main SSIM guards
pass, worst +4.689441%; there are zero full-band 3-norm admissions. The main
mean gates pass under LOSSY_PROMOTION_ENTRY.md. Missing 3-norm coverage is not
evidence of passing every per-image guard.

Against aligned control, the combined mean regresses +0.794900%. Against the
regularized control, the combined gain is only 0.228588%, allowing at most
1.022858837x control time under the unchanged speed rule. The worst incremental
aligned changes are +1.900398/+7.305256/+20.725008%; partial-band comparisons
remain reported. The SSIM gain does not establish a successful overall change.

Screen aligned deltas were -2.133250/+2.901676/+2.232775%, mean +1.000400%.
Screen vips was -11.549620/-4.240230/-2.835736%; jSquash was
-13.000738/-0.460080/+4.675845%. The targeted SSIM improvement justified
measuring the same configuration on full development without admitting holdout.

## Why the tradeoff occurs

All eighty screen HF-global/AC sections, fourteen checked decision fields,
nominal DC matrices and smoothing-off policy match aligned control exactly.
Total bytes rise from 2,848,180 to 2,903,185, or 1.931233%; every file grows.
The entire 55,005-byte increase is in LF-global/DC sections:

| DC cost change | Bits |
| --- | ---: |
| Complete LF-global plus local model/header | +65,302 |
| DC residual symbols | +374,713 |
| Metadata and padding | +25 |

These add to the exact byte difference. About 85% is residual coding, so
header savings alone would not recover most of the increase. Only five
candidate streams have exclusively weighted-predictor leaves; 74 mix weighted
with other predictors and one has no weighted leaf. This is leaf presence,
not per-predictor symbol counts or proof that a fixed tree would win.

At equal distance, SSIM improves in 78/80 cases, 3-norm in 73/80 and max in
48/80. Mean changes are +0.930530 SSIM points, -1.024558% 3-norm and
-0.827775% max. These are same-distance changes, not BD-rates. The additional
rate outweighs the Butteraugli gains at matched quality.

Normalized DC values change in 163,681 Y cells, 143,375 X cells and 146,127 B
cells. Y/X differences are at most half a nominal step; B differs by at most
one step. Almost all changed values use half steps. No pixel-source error
improvement is inferred from these counts.

The three largest main-relative max regressions are im26-3000 +22.037346%,
im26-3004 +12.325176% and im26-2014 +7.278681%. Native-decoded nearby-byte
pairs use candidate/main distances 1.3/1.85, 0.65/0.9 and 0.65/0.9, with byte
ratios 1.001954/0.965924/0.957952. Visual inspection shows subtle grain and
tonal differences on the dark door, pottery and blurred shoe/water scene.
These views do not localize or dismiss the metric maxima.

## Qualification and verification

Initial fifteen-pair photo/texture medians were 1.024846/1.038315x regularized
control, narrowly above the 1.022858837 allowance. Because the margins were
small relative to noise, one confirmation was declared before running it,
with a decision based on all thirty pairs. Confirmation medians were
0.992298/0.988463. Pooled medians are 1.018912/1.017860, with MAD
0.047960/0.029607 and 13/30 and 11/30 faster pairs. These pass the allowance.
Both runs are retained; there is no speedup claim. Pooled candidate time
medians are 2,117.627/1,792.429ms. Both modes' hashes match their frozen streams.
Photo managed peak is unchanged at 5,682,267 bytes; texture adds 2,048 bytes
to 5,680,219.

| Fresh isolated workload | Own encode time | Ratio to jSquash | Managed peak |
| --- | ---: | ---: | ---: |
| 64 crops, median | 1.310s | 2.387946x | See per-image receipts |
| 13 MP original | 39.546s | 1.512916x | 59,210,879 bytes |
| 21 MP original | 68.866s | unavailable | 91,262,401 bytes |

All 192 crop engine jobs have fresh measurements and no failures. Both own
originals finish, decode natively and score. jSquash aborts on the 21 MP image;
its runner exit 1 is preserved and no ratio is inferred. Process peak RSS is
426,385,408/514,064,384 bytes for the originals, separately from managed memory.

Managed peak is 9,235,969 bytes on the screen and
9,422,327 bytes on full development. The original managed ceiling remains
137,514,476 bytes. Entry passes and the fourteen modules are frozen for one
aggregate-only holdout. Only private fixture admission changes; encoder modules
stay unchanged. Full watch/scale, second-decoder promotion, cold/warm RSS and
public integration do not follow the failed holdout.

## Holdout and disposition

All 189 engine jobs and 567 own outputs complete without failure. Every own
output validates natively. Review is aggregate only; no identities, per-image
curves or holdout images are inspected. Managed peak is 26,183,855 bytes.

| Holdout reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -7.492331% | -3.572892% | -1.656583% |
| jSquash reference | -9.159372% | -0.214670% | +3.729473% |
| Main | -6.605213% | -8.418870% | -6.834939% |

The vips mean is -4.240602%; the mean and single-metric objective passes.
Main mean gates also pass. Two of ten admitted SSIM guards fail, worst
+11.202599%. All ten previous admissions remain, including both prior failures;
neither failure now passes. Zero 3-norm comparisons cover the full required
band. Passing averages do not override the two failed SSIM guards.

The approved configuration is complete: zero retained changes and zero
promotions. Preserve its source and receipts outside active code. The one-trial
allowance is exhausted; another quality configuration requires owner renewal
under LOSSY_STEERING section 9. No thresholds, memory ceilings or public defaults
change.

Eighteen thin, odd and DC-group boundary fixtures encode repeatably and decode
natively; all signal extra precision one. Two transparent fixtures preserve
exact alpha. Three pinned AC 1.25 control streams and three promotion-denial
checks pass. The prior scalar checks cover rounding, signed allocation,
channel order and predictor resets. All fourteen prototype hashes stay frozen.
Strict experimental TypeScript passes. Fresh `VITEST_MAX_WORKERS=4 npm run check`
passes 340 files and 4,229 tests, with one file and three tests skipped, including
static, package and browser build checks. The test phase took 1,071.71 seconds.
A brief read-only stack inspection identified the remaining worker in the
effort-9 luma-context test's alpha tree training; it was resumed immediately
and completed without code changes. Timing begins only after the check exits.

[DC-PREDICTOR-EXPERIMENT.patch](DC-PREDICTOR-EXPERIMENT.patch) reconstructs
twelve files against the research base, ten changed. The
[audit patch](DC-PREDICTOR-AUDIT.patch) reconstructs ten first-party scripts.
Both apply exactly. Run the archived inspector preparation before the bit-cost
audit. The detailed receipts are in [DC-PREDICTOR-REPORT.json](DC-PREDICTOR-REPORT.json);
raw files remain under `.tmp/jpegxl-lossy-lab/dc-predictor-20261103/`.

Reproduce in a scratch checkout at the recorded base, applying the experiment
patch and using the frozen corpus-512-v2 manifest with `--mode screen` or
`--mode lab`, `--variant standalone-dc-predictor` and
`--strategy-port standalone-dc-predictor`. Promotion admission is deliberately
absent and must be requalified.

Bundles remain 614,969/687,801 bytes, with no runtime dependencies.
Peer-decision forcing hooks still need removal from the public bundle path
before any merge. Remote main remains `4a40c68f`; no merge or rebase occurs.

Remaining development investigations, ranked by the measured cost: first,
measure achievable DC residual savings from predictor/context coding on saved
development integers; second, estimate clustered fixed-tree model costs,
including the complete global header; third, profile the nonlinear predictor
only if a rate gain can justify more work. Residual coding accounts for about
85% of this screen's added bytes. The earlier unclustered fixed-tree and
smoothing trial regressed, so it should not be repeated unchanged. These ideas
have no measured net benefit and authorize no new quality configuration.
