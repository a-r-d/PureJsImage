# Channel rounding investigation

Research base `eade5bff` on `jxl-libjxl-ports`. Six development screens and two
full labs test whether the writer-rounding tradeoff can be improved by separating
luma from chroma or using a cheaper decoded-coefficient estimate. All variants
use the retained paired-input transform and the same field, DC, filter and writer
policy. They consume no peer maps. Main and the public encoder are unchanged.

## Screens

Each screen covers the same 16 development photos at five distances, with all
80 outputs valid. Numbers are mean BD-rate percentages in SSIMULACRA2 /
Butteraugli 3-norm / Butteraugli max order. Negative is better.

| Selector estimate | vs vips | vs jSquash | vs retained |
| --- | --- | --- | --- |
| Actual writer rounding, luma | -10.768 / -5.472 / -4.572 | -11.773 / +0.308 / +2.737 | -0.028 / +0.124 / -1.295 |
| Actual writer rounding, chroma | -10.755 / -5.578 / -3.246 | -11.668 / +0.282 / +4.095 | -0.021 / -0.020 / -0.024 |
| Decoded bias, all channels | -10.683 / -5.561 / -3.226 | -11.680 / +0.212 / +4.119 | +0.043 / +0.008 / +0.020 |
| Decoded bias, luma | -10.681 / -5.561 / -3.241 | -11.678 / +0.212 / +4.103 | +0.046 / +0.008 / +0.005 |
| Nearest decoded level, all channels | -10.606 / -5.594 / -4.100 | -11.449 / +0.357 / +3.210 | +0.149 / -0.014 / -0.833 |
| Nearest decoded level, luma | -10.619 / -5.608 / -4.132 | -11.468 / +0.341 / +3.173 | +0.139 / -0.029 / -0.867 |

Decoded-bias modes retain nearest-even integer choice but estimate reconstruction
using the normative bias. Nearest-level modes choose between adjacent decoded
levels without the writer's rate penalty. Actual-rounding modes call the writer's
quantizer for the selected channel after setting its block activity state.

Chroma-only rounding has little effect. Changing the reconstruction estimate alone
is also nearly neutral. Actual luma rounding improves the screen grain image
im26-2004 by 2.293% SSIM, while nearest-level luma rounding worsens it by 0.350%.
The rate penalty changes allocation in a way that nearest-level rounding does not
reproduce. The two luma alternatives proceed to full development.

## Full development

Each candidate completes all 64 photos and nine distances, with 576 valid outputs.

| Mode | vs vips | vs jSquash | vs retained | Mean paired change |
| --- | --- | --- | --- | ---: |
| Retained paired-input selector | -8.090 / -4.730 / -5.575 | -8.553 / +0.770 / +2.537 | 0 / 0 / 0 | 0 |
| Actual writer rounding, luma | -8.286 / -4.809 / -5.201 | -8.782 / +0.621 / +2.866 | -0.240 / -0.090 / +0.423 | +0.031 |
| Nearest decoded level, luma | -8.046 / -4.710 / -5.255 | -8.504 / +0.769 / +2.956 | +0.051 / +0.022 / +0.301 | +0.125 |

The actual-rounding mode repeats the prior all-channel tradeoff. Its grain SSIM
regression against production falls from +6.756% to +3.744%; im26-3302 falls from
+7.677% to +7.178%. All eight admitted development SSIM guards pass. No 3-norm
comparison covers its full required band. Maximum-error tails worsen: the partial
im26-3000 regression against production grows from +27.556% to +37.685%.

The cheaper mode worsens all three mean metrics and fails one development guard:
im26-3302 reaches +8.238% SSIM against production, above the unchanged 8% limit
and 0.05-point tolerance. It does not preserve the grain benefit either.

Neither mode replaces `standalone-selector-pairs`. The screen maximum-error wins
reverse on the full ladder and corpus. This is evidence against using either
approximation as a general repair, even before considering their speed cost.
Managed full-lab peaks are 9,272,693 and 9,268,653 bytes respectively, compared
with the retained 9,232,573 bytes. All remain below the existing ceiling.

## Why the screen result reversed

A diagnostic using existing curves holds the 16 screen photos fixed. Actual
luma rounding changes maximum-error BD-rate from -1.295% on five distances to
+0.832% on nine; the other 48 photos give +0.287%. Nearest-level luma changes
from -0.867% to +1.065% on the same 16 photos; the other 48 give +0.046%.
Thus adding photos is not the main reason for the reversal.

Combining all 14 already measured distances on those 16 photos gives max deltas
of -0.192% and +0.100%. The small apparent gains depend on curve sampling. This
is not evidence of an interpolation bug. No ladder, interpolation method or
gate is changed, and the union is not substituted for the fixed full-lab result.
The evidence does not establish a dependable overall quality gain.

## Isolated speed

Fifteen alternating warm pairs on im26-3012 at distance 2 run after all tests and
quality jobs finish. Full encode time is measured with the same retained mode as
baseline. No fresh peer ratio is inferred from these single-image measurements.

| Candidate | Baseline median | Candidate median | Paired change | Faster pairs | Paired MAD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Actual luma rounding | 1165.882 ms | 1317.182 ms | +10.347% | 0/15 | 4.165 points |
| Nearest-level luma | 1147.324 ms | 1181.794 ms | +2.604% | 6/15 | 5.041 points |

Actual luma rounding fails the speed rule as well as the quality balance. The
cheaper mode has noisy timing, with no demonstrated speed benefit; its quality
and guard failures already reject it. Managed paired peaks are 5,682,267 and
5,680,219 bytes. Raw paired samples and dispersion statistics are retained.
The active selector is restored exactly to eade5bff, preserving the previous
qualified 2.864447x crop ratio and 1.851700x result on the 13 MP original.

## Verification and next work

All 78 focused tests and the Chromium, Firefox and WebKit receipt comparisons
pass. All 1,152 full-lab files independently decode in jxl-rs within one code
value of native libjxl. The experimental patch passes the full check: 4,131 tests
and three existing skips in 1,192.28 seconds, plus all static, package, docs and
browser-build gates.
After restoring the active code, all 72 focused tests pass again and the archived
patch applies cleanly. Bundles remain 614,941 and 687,773 bytes; runtime
dependencies remain zero.
Quality timing is excluded because lab and repository checks share the host.

The previous two holdout guard failures remain unresolved. No holdout is run or
inspected in this continuation. The rejected code and its tests are preserved in
[CENTROID-EXPERIMENT.patch](CENTROID-EXPERIMENT.patch), then removed from the active
selector. Apply the patch to reproduce the named development modes. Attribution
is recorded in `../PROVENANCE.md`. [Machine-readable results](CENTROID-REPORT.json)
include both full labs, paired speed and the curve-sampling diagnostic.

The next useful quality hypothesis is an error constraint on large-transform
merges using the actual luma estimate: rounding alone increases large-transform
coverage but does not control its worst-region cost. Across this and the previous
writer-estimate continuation, 15 quality trials (12 screens and three full labs)
have produced no retained quality improvement. This reaches the steering's
plateau stop; another quality campaign needs Aaron to reopen it. An exact
plane-level rate-cost optimization is a separate speed opportunity if a better
quality policy justifies actual rounding. Chroma rounding and bias-only scoring
are low-priority directions after these results.

Raw evidence: `.tmp/jpegxl-lossy-lab/standalone-centroids-20261014/`.
Experiments LL-746 onward are in `../lossy-lab-log.md`.

## Reproduction

Use a fresh output directory for each run. Replace the variant with
`standalone-round-centroid-luma` for the other full-lab candidate.

```sh
git apply benchmark/jpegxl/lossy-lab/CENTROID-EXPERIMENT.patch
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/reproduce-luma-lab --mode lab --variant standalone-round-luma --workers 4 --strategy-port standalone-round-luma
VITEST_MAX_WORKERS=2 npm run check
npx playwright test browser-tests/jpegxl-decision-transplant.pw.ts --workers 1
```
