# JPEG XL conservative rate targeting

The fixed rule kept **21 of 24** new development encodes within their actual
byte caps. **Zero qualified as replacements.** Seventeen of the 21 in-budget
encodes lost more than 0.1 SSIMULACRA2 points. The aligned DC mode remains
archived, and the two historical holdout SSIM guards still block promotion.

## Frozen rule and evaluation

Use only the 24 measured byte ratios from
[the earlier matched-byte trial](MATCHED-BUDGET-REPORT.md) for calibration.
Take the nearest-rank 90th percentile, the 22nd of the 24 candidate-to-cap
ratios, giving 1.0206171674976419. For each validation budget, target
`floor(cap / 1.0206171674976419)`, about 2.02% below the cap before rounding.
Choose the distance by linear interpolation in log bytes and log distance
between the two saved aligned rates that bracket the target. The distance
calculation uses byte counts only.

Select the first eight crops by SHA-256 of `jpegxl-rate-target-v1:` followed
by fixture ID, sorted ascending, from the 42 development crops outside both
the original screen and the eight calibration crops. Freeze the budgets at
the regularized streams' actual bytes for distances 0.9, 1.85 and 3.8.
These crops are fresh to this diagnostic. Their pre-existing rate brackets
and regularized references come from the saved development lab. All 24
settings have brackets. Each gets one effort-7 encode from the archived
`standalone-dc-wire` worker, with no retries, extrapolation or peer decisions.

The original criterion applies to each actual stream. The stream must fit its
cap, gain more than 0.1 SSIMULACRA2 points, and preserve or improve both
Butteraugli scores. Freeze the rule, fixture IDs, distances and input hashes
in [RATE-TARGET-PLAN.json](RATE-TARGET-PLAN.json) before running. The original
serialization has SHA-256
`d3536db81db5db8c0ef73f81ef4145156e7d470da929f1ae3f6ed518cc819ca1`.

## Measurements

| Result | Count |
| --- | ---: |
| Native-valid scored encodes | 24 of 24 |
| Actual bytes at or below cap | 21 of 24 |
| In-budget gains above 0.1 SSIM points | 1 of 21 |
| In-budget losses above 0.1 SSIM points | 17 of 21 |
| In-budget reductions in Butteraugli 3-norm / max | 10 / 11 of 21 |
| Material gains that preserve both Butteraugli scores | 0 of 24 |

Median actual bytes were 2.12% below cap. The three misses were 51, 34 and
137 bytes over their individual caps. The 137-byte miss was 10.18% over a
1,346-byte cap. The calibration trial hit two budgets out of 24 on a
different cohort, so the cap-hit counts describe separate samples.

Two examples show the quality tradeoff at measured bytes. Deltas use the
saved regularized scores. Lower is better for both Butteraugli columns.

| Development photo and control distance | Cap → actual bytes | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: | ---: |
| im26-1606, 1.85 | 38,735 → 38,132 | +0.0482 | −0.019001 | −0.025265 |
| im26-2400, 0.9 | 7,646 → 7,431 | +0.1700 | +0.006246 | +0.154402 |

The first example improves all three scores, with an SSIM gain below the
materiality threshold. The second has the only in-budget material SSIM gain
and worsens both Butteraugli scores. This rule has no measured replacement
to take into the full lab. A production rate predictor would also need to
operate without the per-image saved rate brackets used here.

## Offline check at the byte cap

On the same 24 validation budgets, an exhaustive comparison against the
nine archived aligned streams per crop plus the new stream finds **zero**
actual replacements. Interpolating the archived scores at the cap suggests
one qualifying point. Adding the new measurement before interpolation
suggests two different qualifying points and 11 material SSIM losses.
Median estimated SSIM change at the cap with the new samples included is
−0.073 points.

Against the 24 new measurements at their actual rates, the archived-curve
interpolation misses SSIM by more than 0.1 points in 18 cases. Its median
absolute SSIM error is 0.191 points. Estimates for im26-1606 at 1.85 change
from +0.038 to +0.243 SSIM points after adding the new sample, and estimates
for im26-1032 at 0.9 change from +0.044 to +0.107. Both estimated wins use
an upper bracket more than 21% above their caps. The two estimates leave
little support for another general rate-margin sweep. The highest-priority
remaining hypothesis is a change to the underlying quality allocation that
preserves SSIM and peak error at actual bytes. Exact rate acceptance and
selector timing follow once a policy shows measured quality headroom.

The offline check reads pinned development scores and byte counts.
[RATE-TARGET-CAP-AUDIT.json](RATE-TARGET-CAP-AUDIT.json) records the 24
comparisons. No new streams were encoded or scored for this check.

## Transfer of the SSIM predictor to aligned DC

The unchanged six-scale box loss was previously validated on forward versus
regularized. This check applies it to saved source and decoded pixels for
aligned DC versus regularized. Both cohorts use actual native score deltas,
which include any effect of differences in byte count. The existing
requirements apply separately to each cohort: at least ten changes above
0.1 points in magnitude, both directions present, at least 80% sign accuracy
and zero missed losses above 0.25 points.

| Cohort, eight development photos each | Material gains / losses | Correct signs | Larger losses flagged |
| --- | ---: | ---: | ---: |
| Initial matched-byte trial | 16 / 3 | 19 of 19 | 2 of 2 |
| Conservative rate-targeting trial | 1 / 20 | 21 of 21 | 17 of 17 |

The unchanged predictor passes on both cohorts, including all 19 material
comparisons that fit their caps across the two cohorts. This extends support
for screening whole-image SSIM directions across these policies. It leaves
local proposal ranking, both Butteraugli metrics, rate-exact acceptance and
production cost to separate checks. No weights were fitted, and no stream
was encoded or rescored natively. The
[transfer receipt](RATE-TARGET-SSIM-TRANSFER.json) records the saved inputs
and every direction.

## Verification

All eight workers exit zero. Before encoding, the pinned native decoder and
scorers reproduced all 24 regularized baselines pixel for pixel and matched
all 72 quality scores exactly. The independent receipt check verifies the
24 new stream hashes and actual lengths. It reproduces the same rows and
summary from the saved receipts. See [RATE-TARGET-REPORT.json](RATE-TARGET-REPORT.json).
`VITEST_MAX_WORKERS=4 npm run check` passes 4,249 tests in 346 files, with
three tests and one file skipped. The offline cap and predictor checkpoint
repeats the full check with the same result. The two new receipts pass
formatting and lint, and the archived tools restore byte for byte and pass
strict TypeScript.
The holdout stays closed. No production encoder change or promotion follows
the trial. The full-lab, speed, memory and promotion gates stay in force.

## Reproduction

[RATE-TARGET-EXPERIMENT.patch](RATE-TARGET-EXPERIMENT.patch) restores the
strict TypeScript planner, runner and receipt checker. Use the archived
worker snapshot described in
[the earlier trial's reproduction instructions](MATCHED-BUDGET-REPORT.md#reproduction)
with its prepared worker plan, the saved development curves and the pinned
local tools. At the repository root with fresh output paths:

```sh
audit=.tmp/jpegxl-lossy-lab/rate-target-trial
npx tsc --noEmit -p "$audit/tsconfig.json"
node "$audit/freeze-plan.ts"
node "$audit/run-trial.ts" d3536db81db5db8c0ef73f81ef4145156e7d470da929f1ae3f6ed518cc819ca1
node "$audit/measure-trial.ts"
```

The runner requires the frozen digest and fresh receipt directory.
The final command alone replays the measurement from existing receipts.
With those saved inputs, `node "$audit/audit-cap-headroom.ts"` runs the
offline cap check. `node "$audit/validate-aligned-ssim.ts"` checks the
unchanged predictor against the two saved trials. Lab records are LL-1220
through LL-1223.
