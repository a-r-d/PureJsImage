# JPEG XL matched-byte development trial

The archived aligned DC encoder produced **zero qualifying replacements** at
the 24 saved regularized byte budgets. All 24 streams decoded and scored with
the pinned native tools. Two met their individual byte budgets. Both reduced
Butteraugli 3-norm and increased Butteraugli max.

## Measured at or below budget

These were the only two streams that fit. Quality columns are absolute deltas
from the saved regularized score. Higher SSIMULACRA2 and lower Butteraugli are
better.

| Development photo and control distance | Budget → actual bytes | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: | ---: |
| im26-2004, 1.85 | 44,445 → 43,210 (−2.78%) | +0.624604 | −0.017651 | +0.095952 |
| im26-3316, 3.8 | 10,237 → 9,971 (−2.60%) | −0.024876 | −0.014878 | +0.023969 |

The first stream improves SSIM and 3-norm at a lower rate, with a worse
peak-error score. The second saves bytes and improves 3-norm with both other
scores worse. A qualifying result requires an SSIM gain above 0.1 points,
both Butteraugli scores at or below the control, and actual bytes at or below
that point's budget.

The [conservative rate-targeting follow-up](RATE-TARGET-REPORT.md) tests a
fixed margin on eight other development crops.

## Rate matching

The candidate exceeded the budget at 22 of 24 points. The median change
across all points was +0.552%, and the median overshoot was +0.692%. The
largest overshoot was +2.906%.

Across all rates, 23 points had lower 3-norm, ten had lower max, and 16
improved SSIM by more than 0.1 points. Nine met all three quality conditions
while spending extra bytes. The smallest such overshoot was 48 bytes on
im26-3002 at its distance-3.8 budget. On im26-3302, the worst admitted saved
development SSIM guard, the distance-1.85 comparison gained 0.978417 SSIM
points and improved both Butteraugli scores for 330 extra bytes (+0.801%).
All nine wins estimated by interpolation exceeded their budgets. Six still
met the three quality conditions at their actual higher rates.

The frozen distance interpolation consistently underestimated needed bytes
in this trial. The mixed results at or below budget leave the quality
benefit unverified at equal rate. Reject this configuration as a repair for
the per-image guards. The holdout stays closed and the historical failures
remain unresolved.

## Scope and verification

Aaron approved one frozen run on `jxl-libjxl-ports` from `e5035fe3`.
The trial used eight development crops, three settings per crop, effort 7,
and the archived `standalone-dc-wire` policy restored from `ec3ecc99` and
[DC-WIRE-EXPERIMENT.patch](DC-WIRE-EXPERIMENT.patch). Baseline stream hashes,
decoded pixels and all 72 baseline scores were verified before running. The
archived worker then encoded each target once using its predeclared distance.
All eight workers exited successfully. Native decoder and scorer executables,
the source patch and the 24 verified stream hashes are recorded in
[MATCHED-BUDGET-REPORT.json](MATCHED-BUDGET-REPORT.json).

The archived scripts pass strict TypeScript and restore byte for byte.
Replaying the receipt verifier reproduces the same report.
`VITEST_MAX_WORKERS=4 npm run check` passes 4,249 tests in 346 files, with
three tests and one file skipped.

This is a development diagnostic. Its worker timings do not qualify speed or
memory. No encoder change or promotion follows this result. The full-lab,
speed, memory and promotion thresholds stay in force.

## Reproduction

[MATCHED-BUDGET-EXPERIMENT.patch](MATCHED-BUDGET-EXPERIMENT.patch) restores the
trial's TypeScript scripts. The frozen input plan and supporting analysis
come from [the saved development audit](SAVED-FRONTIER-REPORT.md). The scratch
snapshot contains the archived encoder source and worker, with the pinned
scorers and existing development dependencies available at their original
relative paths. To restore a fresh snapshot from the repository root:

```sh
audit=.tmp/jpegxl-lossy-lab/saved-frontier
snapshot="$audit/aligned-worker-snapshot"
mkdir "$snapshot"
git archive ec3ecc99793e618cfadcadbb1a5723e358120851 -- \
  package.json tsconfig.json types src ':(glob)benchmark/jpegxl/**/*.ts' |
  tar -xf - -C "$snapshot"
git apply --directory="$snapshot" benchmark/jpegxl/lossy-lab/DC-WIRE-EXPERIMENT.patch
ln -s "$PWD/node_modules" "$snapshot/node_modules"
mkdir "$snapshot/.tmp"
ln -s "$PWD/.tmp/jpegxl-oracles" "$snapshot/.tmp/jpegxl-oracles"
```

From the repository root, with the archived scripts restored and fresh
receipt paths, the approved trial runs as follows:

```sh
audit=.tmp/jpegxl-lossy-lab/saved-frontier
node "$audit/prepare-matched-worker.ts"
node "$audit/check-matched-baselines.ts"
node "$audit/run-matched-workers.ts"
node "$audit/verify-matched-results.ts"
node "$audit/summarize-matched-trial.ts"
```

The launcher checks the frozen plan, development fixture hashes, archived
source hashes, native tool hashes and retained baseline preflight. It
requires fresh receipt paths and allows one attempt per target. Preserve the
completed raw receipts under `.tmp/jpegxl-lossy-lab/saved-frontier/`.
Lab records are LL-1218 and LL-1219.
