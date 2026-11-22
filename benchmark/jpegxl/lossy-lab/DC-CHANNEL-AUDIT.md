# DC channel-attribution audit, 2026-11-04

The channel audit does not identify a safe precision-only fix. Luma DC contributes to
many of the predictor trial's Butteraugli-max regressions, while native blue DC
accounts for much of its SSIMULACRA2 advantage. Restoring one channel moves
regressions to other development points. Even unquantized source DC with the saved
AC decisions worsens Butteraugli max in half the predictor reconstructions.
The next decision model must account for those interactions and actual rate;
lower DC squared error is insufficient.

Aaron approved this one bounded audit on research base
`ee4409c1c6e8fe0f89f8e66ecaa2f85688ff7a6a`. It covers the same sixteen development
photos at distances 0.5, 1, 2, 4 and 7, in the saved aligned and predictor modes.
All 800 fixed reconstructions complete. No encoder changes, new encoded
configurations, fitted rules, peer decisions or holdout reads occur.

## Fixed interventions

For each saved mode and point, render five versions: actual DC, source DC
restored in X only, Y only, B only, and all three channels. Source DC comes
from the frozen writer's selected transforms and preconditioning, using the
previous display audit's verified implementation. Restore reconstructed native
XYB planes before normative reconstruction/filtering; keep saved AC, quantizer,
correlation, sharpness and filter decisions fixed. Each version is scored by
the same native Butteraugli and SSIMULACRA2 binaries.

These are independent reconstructed channels. In particular, B is native blue,
not the encoder's coded B-minus-Y residual. A Y-only restoration holds native
B fixed. Changing a coded luma integer without compensating its chroma residual
does not perform the same intervention.

These diagnostic PNGs have no attainable encoded rate. Their source DC is
available for free only in this audit. All percentages below describe
same-distance score changes, not BD-rates, allocation gains or promotion results.

## What restoring DC does within the predictor mode

Each row compares the changed reconstruction with that same mode's actual
reconstruction. SSIM changes are mean score points. Butteraugli changes are
mean relative changes; smaller is better. Every row includes all eighty points.

| Restored DC | SSIMULACRA2 points | BA 3-norm | BA max | Max worsens by over 1% |
| --- | ---: | ---: | ---: | ---: |
| X | +0.052 | -0.116% | +0.417% | 21/80 |
| Y | +0.247 | -0.625% | -0.163% | 18/80 |
| B | +0.340 | -0.089% | +0.056% | 7/80 |
| All | +0.954 | -0.851% | -0.133% | 14/80 |

Restoring Y improves 3-norm in all eighty cases, but worsens max in 39.
Restoring all DC improves SSIM and 3-norm in all eighty, but worsens max in
40, including fourteen changes above 1%. Exact DC therefore does not guarantee
better worst-region quality under the saved AC and display decisions. This is
consistent with perceptual error cancellation or masking; the audit does not
locate a particular pixel mechanism or validate a cheap predictor for it.

The aligned mode shows the same limitation: all-channel restoration adds
1.880 SSIM points and lowers 3-norm 1.851%, but worsens max in 27/80, including
thirteen above 1%. The behavior is not exclusive to nonlinear DC rounding.

## Which channels explain the difference between modes

The actual predictor reconstruction has a mean +0.926562 SSIM-point advantage
over aligned control. Restoring B in both modes reduces that advantage to
+0.356059 points, a removal of 0.570504 points. Restoring Y removes 0.205415
points; restoring X removes 0.049957. These finite interventions are not
additive causal shares: their sum leaves a 0.100686-point interaction residual.
This makes preserving blue detail important to any proposed SSIM repair.

The previous display audit identified seventeen points, across twelve photos,
where predictor Butteraugli max worsens by over 1% despite lower mean display
error. Fresh actual reconstructions preserve all seventeen cases. The table
below restores each channel in both modes and then compares those two versions.
All paired percentages retain the original actual aligned score as denominator.

| Restored in both modes | Mean max gap on the original 17 | Original cases still above 1% | Other cases now above 1% | Total across 80 |
| --- | ---: | ---: | ---: | ---: |
| None | +2.941% | 17 | 0 | 17 |
| X | +1.558% | 11 | 5 | 16 |
| Y | +1.082% | 8 | 12 | 20 |
| B | +3.220% | 14 | 6 | 20 |
| All | 0% | 0 | 0 | 0 |

Y restoration removes nine of the original threshold crossings, yet creates
twelve elsewhere. Within the predictor mode alone it improves max on fifteen
of the original seventeen cases; that targeted benefit does not generalize to
the full screen. B restoration retains most of those gaps even though it explains
much of the SSIM advantage. No single channel isolates the harmful decisions.
The all-channel equality is expected from identical saved AC; it is not evidence
that a realizable encoder can remove all errors at the same rate.

The max interaction residual on individual original harm cases ranges from
-6.325 to +6.023 percentage points. Its small cohort mean does not make the
per-image interaction negligible. These are eighty correlated points from
sixteen photos, not eighty independent validation images.

## What this tells us about a quality fix

1. Uniformly tightening DC or fixing only Y is not supported as a safe repair.
   The diagnostic already supplies exact source values, yet max regressions move
   between images. A smaller scalar error is not an acceptance criterion.
2. Preserve the measured blue contribution to SSIM when investigating luma
   precision. A coded Y change also changes reconstructed chroma unless the
   residual is handled coherently. The earlier reconstructed-luma subtraction
   trial already regressed all three screen BD-rates; this result does not
   overturn that rejection or justify repeating it unchanged.
3. A useful next model would distinguish local beneficial and harmful DC changes
   jointly with the retained AC error, then pay the complete DC coding cost.
   This audit does not validate such a model, select a configuration, or authorize
   joint RD decisions. Its possible gain remains unmeasured.

The audit concerns saved development behavior. It neither explains the identities
or causes of the two failed holdout SSIM guards nor establishes that a proposed
change would repair them. A real fix still needs development selection and the
unchanged promotion sequence.

## Verification and reproduction

All 160 actual reconstructions match the previous audit's pixel hashes. All
eighty mode pairs become pixel-identical after restoring every DC channel.
The fresh actual scorer comparisons preserve all seventeen previous max harms.
Compared with saved native PNG scores, the largest difference is 0.157079
SSIM points, 0.007627% for 3-norm and 0.058206% for max. The largest absolute
Butteraugli-max difference is 0.001086235. The channel comparisons use the same
reconstruction path on both sides, so these differences are reported separately.

Verification checks 800 PNG hashes and scorer receipts, 160 saved stream hashes,
eighty source hashes, both scorer binaries and both reconstruction helpers.
Fifteen channel-restoration checks confirm the selected planes and preserve
inputs; invalid dimensions are rejected. Strict experimental TypeScript and
exact four-file patch reconstruction pass. There are no new native source ports.

A fresh `VITEST_MAX_WORKERS=4 npm run check` passes all static, package and
browser checks, with 340 test files and 4,229 tests passing. One file and three
tests are skipped. Final report formatting and diff checks pass as well.

[DC-CHANNEL-AUDIT.patch](DC-CHANNEL-AUDIT.patch) archives the four first-party
diagnostic scripts. In a scratch checkout at the recorded base, with the saved
development streams and previous display-audit receipts present:

```sh
git apply benchmark/jpegxl/lossy-lab/DC-DISPLAY-AUDIT.patch
node benchmark/jpegxl/lossy-lab/prepare-dc-display-audit.ts
git apply benchmark/jpegxl/lossy-lab/DC-CHANNEL-AUDIT.patch
node benchmark/jpegxl/lossy-lab/audit-dc-channels.ts
node benchmark/jpegxl/lossy-lab/summarize-dc-channels.ts
node benchmark/jpegxl/lossy-lab/verify-dc-channels.ts
```

Use a fresh `dc-channel-audit-20261104` output directory; the frozen plan, PNGs
and point receipts deliberately refuse overwriting. The display helpers retain
their existing source conversion, Gaborish and dither attribution. The raw
evidence remains under `.tmp/jpegxl-lossy-lab/dc-channel-audit-20261104/`;
[DC-CHANNEL-AUDIT.json](DC-CHANNEL-AUDIT.json) records the summaries, all paired
scores, source/output identities and validation. Diagnostic runtime overlapped
repository checks and is not an encoder speed or memory measurement.

## Disposition

One approved diagnostic completed; zero new encoded configurations, retained
encoder changes or promotions. The research branch remains unready to merge.
The previous predictor trial's full-development BD-rates remain:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -10.184% | -4.810% | -4.548% |
| jSquash | -12.333% | -1.230% | +3.116% |

Prior crop time remains 2.387946x jSquash; the 13 MP original is 1.512916x.
The 21 MP peer aborts, so no ratio is available. Original managed peaks remain
59,210,879/91,262,401 bytes against the 137,514,476-byte ceiling. Root/specialized
bundles remain 614,969/687,801 bytes with zero runtime dependencies.

Remaining hypotheses, ranked: a local coupled DC/AC perceptual decision model;
mixed-predictor context/token changes that preserve pixels; exact predictor
speed work once a quality mode qualifies. The first two have unmeasured upside;
speed work alone cannot repair the quality failures. The bounded audit is
complete, and another research round requires owner renewal under steering
section 9. No target, guard or promotion requirement changes.
