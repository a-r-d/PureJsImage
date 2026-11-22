# JPEG XL saved development rate and quality

Switching among available streams leaves the worst development SSIM guard at
+7.579% versus main. The aligned DC mode looks better near the same rate on
several of these photos. Its benefit at an actual fixed byte budget remains
unmeasured. The research branch is based on `c1e2ab42` for this audit.

## Actual saved streams

The audit reads 2,304 saved native-scored records from four modes on the frozen
64-photo development set at effort 7 and its nine distances. Each proposed
replacement must use at most the regularized stream's actual bytes, improve
SSIMULACRA2 and preserve or improve both Butteraugli metrics. The regularized
stream remains available at every point. The selection uses known native scores
and estimates headroom among these specific streams.

| Selection using saved scores | Replacements of 576 | Gains above 0.1 SSIM points | Bytes saved | BD-rate vs regularized, SSIM / 3-norm / max |
| --- | ---: | ---: | ---: | --- |
| Same setting | 29 | 7 | 3,958 | −0.053% / −0.057% / −0.182% |
| Any saved setting | 32 | 10 | 5,780 | −0.080% / −0.084% / −0.405% |

The latter 32 use 27 forward and five aligned streams. Four of the eight
full-band development SSIM guard photos admit no replacement, including the
worst and the other three highest regularized guard values. The worst value
is +7.579% with both selection methods and the same eight photos admitted.
Curve fitting can produce small per-image BD-rate shifts even when all
selected measurements dominate their original ladder points.

Measured over all 64 photos, the entire aligned DC mode changes SSIM / 3-norm /
max BD-rate by +0.852% / −1.908% / −1.983% against regularized. Its eight
development guard comparisons against main have a better worst value of
+4.598%. The archived mode still failed two historical holdout SSIM guards.

## Rate interpolation and predictor

At each actual aligned stream's byte count, linear interpolation in log bytes
between neighboring regularized points gives 510 in-range comparisons. Of
those, 190 favor aligned on SSIM and preserve both Butteraugli scores, with 130
SSIM gains above 0.1 points. The 48 photos outside the original screen supply
383 comparisons and 97 such material gains. For forward, the corresponding
all-photo counts are 504, 90 and 38. These estimates use a different rate
grid from the actual-replacement test and depend on smoothness between saved
points. Distance remapping alone cannot change the encoded rate-quality curve.

For forward versus regularized only, the fixed six-scale SSIM loss gives the
correct sign for 108 of 109 material changes on the 48-photo cohort. There
are 381 in-range pairs out of 432, with 43 material gains and 66 material losses.
The predictor flags all 32 losses above 0.25 points against the interpolated
curve. Both native SSIM and estimated loss for regularized use the same
log-byte bracket. The result extends the earlier diagnostic to equal estimated
rate. It does not establish the predictor's accuracy for aligned DC or for
choosing an encoder policy.

## Frozen follow-up

The approved run is complete. See [the matched-byte results](MATCHED-BUDGET-REPORT.md)
for measured values at the frozen budgets.

The proposed fixed diagnostic has eight development photos with an admitted
full-band SSIM comparison, each tested at the regularized byte budgets for
distances 0.9, 1.85 and 3.8. All 24 budgets have aligned rate brackets. Each
target has one candidate distance from log bytes and log distance, chosen using
byte counts only. One archived aligned encode and native score per target
would measure which outputs meet the original byte budget and improve SSIM by
more than 0.1 points while preserving both Butteraugli scores. Record misses,
including rate overshoots. The fixed plan has no retries or extrapolation.

Interpolating the aligned quality at those 24 budgets estimates nine material
wins. The rate model is biased toward overshooting in the saved backcheck.
With one interior aligned point left out at a time, the median absolute byte
error is 1.42% across 448 comparisons. Within the eight planned photos, it is
1.95%, with a 5.35% 90th percentile and 47 overshoots among 56 comparisons.
This uses wider brackets than the planned diagnostic. Even a small actual
overshoot disqualifies a replacement.

Section 9 of the steering keeps the campaign at the quality plateau. The
prepared 24-stream diagnostic needs owner approval before any encode. If actual
equal-budget gains replicate, first check that a fast development selector can
recognize them, then qualify a fixed policy under the existing full-lab, speed,
memory and promotion rules. Holdout access, quality changes and new encodes
were all outside this audit.

## Reproduction

[SAVED-FRONTIER-REPORT.json](SAVED-FRONTIER-REPORT.json) contains the candidate
distances, all eight guarded development rows, 258 input hashes and the
aggregate results. Detailed measurements remain under
`.tmp/jpegxl-lossy-lab/saved-frontier/`.
[SAVED-FRONTIER-AUDIT.patch](SAVED-FRONTIER-AUDIT.patch) restores the offline
TypeScript runners into that scratch directory. From the repository root, with
the saved development inputs still present and fresh output paths, run:

```sh
git apply benchmark/jpegxl/lossy-lab/SAVED-FRONTIER-AUDIT.patch
audit=.tmp/jpegxl-lossy-lab/saved-frontier
npx tsc --noEmit -p "$audit/tsconfig.json"
node "$audit/evaluate.ts"
node "$audit/matched-predictor.ts"
node "$audit/plan-matched-encodes.ts"
node "$audit/check-rate-interpolation.ts"
node "$audit/verify-aligned-archive.ts"
node "$audit/summarize.ts"
```

The archive verifier restores eight files from `ec3ecc99` using
[DC-WIRE-EXPERIMENT.patch](DC-WIRE-EXPERIMENT.patch). All eight hashes match the
archived experiment. Two reruns reproduce every receipt and the report after
sorting the input hash keys. The eight development crop hashes also match
the archived worker plan, which is prepared in scratch.
`VITEST_MAX_WORKERS=4 npm run check` passes all 4,249 tests in 346 files,
with three tests and one file skipped. Lab records are LL-1214 through LL-1217.
