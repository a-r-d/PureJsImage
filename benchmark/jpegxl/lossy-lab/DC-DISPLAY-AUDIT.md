# DC display-error audit, 2026-11-04

The predictor trial's DC improvement survives display filtering. It lowers
displayed squared error at 79 of 80 saved development points and adds bytes
at every point. The saved screen still regresses in Butteraugli BD-rate.
This audit finds no reconstruction or filtering bug to fix. It also does not
explain the local perceptual harms: average squared error misses seventeen
cases where saved Butteraugli max worsens by more than 1%.

Aaron approved one bounded audit beyond the plateau stop, on research base
`8c6fd19029fc4d3bb10648c2fedb8e040128a1a8`. The cohort is the frozen sixteen
development photos at distances 0.5, 1, 2, 4 and 7, comparing saved aligned
AC 1.25 and fixed predictor streams. No encoder entry point, perceptual scorer,
peer map or holdout file is used. There is no new quality configuration.

## What was separated

All eighty pairs have identical HF-global and AC sections, transform maps,
quantizers, chroma maps and filter decisions. The audit computes unquantized
source DC for those selected transforms using the frozen writer's paired
transform and Float32 DC grid. It then replaces only reconstructed DC values
inside our decoder, leaving the saved AC integers and metadata unchanged.
This is a diagnostic reconstruction, not an encodable alternative.

With `R` the actual reconstruction, `C` the source-DC reconstruction and `S`
the reference, define `D = R - C` and `A = C - S`. The measured identity is
`||R-S||² = ||D||² + ||A||² + 2<D,A>`. It is checked independently in every
channel at raw XYB, Gaborish, EPF, linear RGB, sRGB and dithered 8-bit display.
The nonlinear stages use differences of complete reconstructions; they do not
filter or color-convert isolated error planes as if those operations were linear.

The raw reference is the source after the encoder's signaled preconditioning.
After Gaborish and EPF it is the original source XYB; the remainder therefore
includes AC error and preconditioning/filter bias. RGB references come from
the source PNG. These are unweighted numerical errors, not perceptual scores.

## Results across the ladder

Each row contains sixteen photos. Byte changes use summed original file sizes;
error changes use pooled equal-size pixel errors. Native score changes are means
of the already saved same-distance scores. These quantities are not BD-rates
and their percentages are not interchangeable.

| Distance | Added bytes | Display squared error | SSIMULACRA2 points | BA 3-norm change | BA max change |
| --- | ---: | ---: | ---: | ---: | ---: |
| 0.5 | +0.880% | -0.841% | +0.101 | -0.199% | +0.416% |
| 1 | +1.478% | -1.803% | +0.208 | -0.301% | -0.836% |
| 2 | +2.635% | -4.275% | +0.620 | -0.478% | -1.165% |
| 4 | +4.555% | -7.369% | +1.390 | -1.450% | -1.300% |
| 7 | +7.302% | -10.316% | +2.334 | -2.695% | -1.254% |

The saved screen BD-rates against aligned control remain
-2.133250/+2.901676/+2.232775% for SSIMULACRA2/3-norm/max. Total bytes grow
1.931233%. The direct DC improvements are real, but these data are consistent
with added rate outweighing the smaller Butteraugli benefits. No new BD-rate is
computed here and no result replaces the failed qualification.

## Through the filters

Raw DC error energy decreases by 34.83-61.23% across the ladder. Its original
share of unweighted raw XYB squared error is only 0.39-1.20%, so the unchanged
AC remainder dominates that particular numerical measure. This is not a claim
that DC is equally unimportant perceptually: its display-domain energy is
7.13-16.42% of total error before the trial, with a separate interaction term.

At distance 0.5 both Gaborish and EPF are disabled. At the other four distances,
Gaborish attenuates the actual between-mode DC change energy by 5.63-8.92%; EPF
attenuates it by a further 1.12-4.16%. Total XYB squared error improves on every
pair before and after both filters. The raw DC/AC cross term is within
1.311e-7 of total error, consistent with the transform projection. It becomes
nonzero after filtering and color conversion, but does not reverse the pooled
DC improvement at any distance.

Output dithering and rounding partly offset the benefit. At distance 0.5 the
DC contribution falls by 1.698 percentage points of the old display error,
while the interaction adds 0.858 points back, leaving a 0.841% net reduction.
At distance 7 the corresponding changes are -10.515 and +0.199 points, leaving
a 10.316% reduction. Dropping the cross term would overstate the benefit.

Displayed mean squared error improves at 79/80 points and the worst fixed
32x32 window improves at 65/80. The largest absolute RGB error improves at
only 27/80. Display mean-error signs agree with saved Butteraugli max at
49/80 points, and miss all seventeen harms above 1%. This provides no safe
local perceptual predictor and does not justify joint RD or new rounding.

The included near-flat image im26-3312 improves at all five distances in all
three saved native metrics. Pooled display squared error falls 18.21%, worst
32x32 error falls 19.56%, and error in the fixed 8-pixel boundary band falls
18.58%, compared with 17.96% inside blocks. This measures numerical error;
it does not prove that visible block boundaries disappear. The other historical
near-flat images are outside this fixed screen and were not added to the audit.

## Verification and reproduction

All 160 actual reconstructions match our ordinary decoder exactly at raw XYB,
Gaborish, EPF and sRGB. All eighty pairs become exactly equal at all six stages
after replacing DC with the same source values. Saved native PNGs differ in
5,905 samples by at most one 8-bit code value; none differs by more than one.
The audit uses our floating reconstruction for the decomposition and discloses
this small native-output difference.

All 160 stream hashes match the preceding coding audit. All 2,880 channel
energy identities pass. Nine scalar reinforcement/cancellation/zero cases and
an invalid-extent case pass. Four fixed screen cases, with filters both off and
on, verify source DC against aligned nearest rounding. Their largest error is
below half a nominal step without using the allowed Float32 capture margin.
Strict experimental TypeScript and exact five-file patch reconstruction pass.

A fresh `VITEST_MAX_WORKERS=4 npm run check` passes, including static, package,
browser and test gates: 340 files and 4,229 tests pass, with one file and three
tests skipped. Root/specialized bundles remain 614,969/687,801 bytes with zero
runtime dependencies. There is no new encoder speed or memory measurement.

The first preflight assumed Gaborish was always enabled and stopped before
writing any point. The diagnostic was corrected to follow the signaled policy;
the failed log is retained. The final run covers every point once, with no
encoder policy or data-selection change.

[DC-DISPLAY-AUDIT.patch](DC-DISPLAY-AUDIT.patch) contains first-party preparation,
stage, audit, summary and verification scripts. In a scratch checkout at the
recorded base, apply it with the saved corpus and streams available, then run:

```sh
node benchmark/jpegxl/lossy-lab/prepare-dc-display-audit.ts
node benchmark/jpegxl/lossy-lab/audit-dc-display.ts
node benchmark/jpegxl/lossy-lab/summarize-dc-display.ts
node benchmark/jpegxl/lossy-lab/verify-dc-display.ts
```

Use a fresh audit directory: point files deliberately refuse overwriting.
The preparer exposes our existing source-conversion functions in an ignored
copy without invoking the encoder. Existing attributed Gaborish and dither
ports are imported unchanged; there is no new source port. Raw receipts remain
under `.tmp/jpegxl-lossy-lab/dc-display-audit-20261104/`; aggregate results,
point identities and validation are in [DC-DISPLAY-AUDIT.json](DC-DISPLAY-AUDIT.json).
Diagnostic allocations and overlapping run times are not encoder qualification.

## Disposition

One bounded display audit is complete. Zero encoder changes, new quality
configurations, holdout attempts, retained heuristics or promotions. The branch
remains unready to merge: the previous trial still has two holdout SSIM guard
failures, and public-bundle cleanup and later promotion checks remain open.
No holdout explanation is inferred from these development-only results.

The most useful remaining question is which local perceptual effects make DC
changes harmful despite lower average error. A different DC context/token model
could instead reduce rate without changing pixels, but the tested fixed tree
and current-model ANS precision do not support that gain. Exact predictor speed
work is lower priority until a quality mode qualifies. These are unmeasured
hypotheses, not approved configurations. This bounded renewal is exhausted;
another research round requires an owner decision under steering section 9.
