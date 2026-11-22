# Source-only encoder choice

The predeclared one-threshold chooser **failed on the 16 calibration
photos**. The best lower-tail and upper-tail cutoffs each switched one
photo safely. The fit required at least two safe switches. The other
48 development photos remained reserved for validation.

## The fixed test

The chooser had two choices per photo. It could keep the regularized
encoder or use the corrected selected-block writer at all nine settings.
The input was one luma detail ratio. On a stride-four grid, sum the
horizontal and vertical absolute luma differences at offsets 1, 4 and 8
pixels. Divide the combined 4- and 8-pixel sums by twice the 1-pixel sum,
with a one-code-value floor in the denominator. Use the original 16
development screen photos for fitting. Hold the other 48 apart from
the calibration labels.

The fit uses existing native scores and measured bytes from the
[whole-curve audit](FULL-CURVE-CHOICE-REPORT.md). A switch is eligible
when it improves the common-band mean, leaves each metric at or below
the regularized BD-rate, and preserves admitted full-band guards.
The fit tries the 15 midpoints between ordered calibration values,
once for each tail. A cutoff must switch at least two eligible photos
and zero ineligible photos.

## What happened

Six of the 16 photos are eligible for the writer according to their
saved whole curves. Each tail contains one eligible photo at its
extreme and an ineligible photo in the next position. The first
cutoff that switches two photos therefore makes one harmful switch
in either direction. None of the 30 tested cutoffs qualifies.

The frozen result has no rule. The validation command rejects that
result before loading validation labels. No threshold, feature or
acceptance condition was adjusted after fitting. This result rejects
the tested luma ratio with a one-sided cutoff. The earlier hindsight
result still describes the headroom in the saved whole-image curves.

The [second source-only chooser test](SOURCE-NOISE-CHOOSER-REPORT.md)
tries fine luma variation in smooth tiles with the same fit gate.

## Verification and reproduction

The input feature reproduces byte for byte across all 64 source
crops. Flat and alternating patterns give zero coarse-to-fine ratio.
A linear luma ramp gives exactly six. The fit process reads only the
16-row calibration file. The split records both cohort digests, and
replaying the fit produces the same rejection.
`VITEST_MAX_WORKERS=4 npm run check` passes 4,249 tests in 346 files,
with three tests and one file skipped. The archived files restore
byte for byte and the scripts pass strict TypeScript.

[SOURCE-CHOOSER-FIT.json](SOURCE-CHOOSER-FIT.json) records all 30
calibration candidates. The raw frozen receipt has SHA-256
`f0597c1203cf3f50c8791f32f7f604463fa39f2688c690937c488441a23ec32d`.
[SOURCE-CHOOSER-AUDIT.patch](SOURCE-CHOOSER-AUDIT.patch) restores the
original test plan and the TypeScript runners. With the saved
whole-curve audit results and fresh output paths, run from the
repository root:

```sh
git apply benchmark/jpegxl/lossy-lab/SOURCE-CHOOSER-AUDIT.patch
audit=.tmp/jpegxl-lossy-lab/full-curve-choice
npx tsc --noEmit -p "$audit/tsconfig.json"
node "$audit/prepare-source-detail.ts"
node "$audit/test-source-threshold.ts" prepare
node "$audit/test-source-threshold.ts" fit
```

No new streams were encoded or natively scored. The holdout stayed
closed, production code stayed unchanged, and the two historical
holdout SSIM failures still block merging. Lab record LL-1226.
