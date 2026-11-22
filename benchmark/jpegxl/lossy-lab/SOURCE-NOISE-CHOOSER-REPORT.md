# Fine luma variation as an encoder choice signal

The second source-only chooser **failed calibration**. None of the 30
cutoffs made the required two safe switches on the original 16
development photos. There was no threshold to freeze for the other 48.

## Fixed signal and outcome

For each source crop, divide the luma plane into 8×8 tiles and rank them
by luma range, breaking ties in raster order. In the lowest-range
quarter, average the absolute diagonal residual `|a + d - b - c|` of
each nonoverlapping 2×2 cell. Luma uses the integer weights 54, 183
and 19, converted back to 8-bit code values for the reported feature.
The diagonal residual removes a linear ramp on either axis.

The feature and plan were frozen before fitting. The test reused the
[original chooser's rules](SOURCE-CHOOSER-REPORT.md), the same two modes
and the same 16/48 development split. Six calibration photos remain
eligible for the corrected writer according to the saved curves.
The only cutoff with zero harmful switches was a lower-tail cutoff
at 0.24591064453125, which switched one photo. The first cutoff
that switched two photos in each tail made one harmful switch.
No cutoff passed.

The frozen result contains no rule. The validation command rejects
it before loading the 48 validation labels. No fallback cutoff or
additional signal was tried. The holdout stayed closed. No streams
were encoded or rescored, and all gates stay in force.

## Verification and reproduction

Flat and linear ramps produce zero residual, the full checkerboard
gives 510, and a checkerboard with a flat quarter gives zero for the
selected tiles. All 64 feature rows, the plan, generated runner, split
and fit receipt reproduce byte for byte.
`VITEST_MAX_WORKERS=4 npm run check` passes 4,249 tests in 346 files,
with three tests and one file skipped. The archive restores byte for
byte, and the scripts pass strict TypeScript.

[SOURCE-NOISE-CHOOSER-FIT.json](SOURCE-NOISE-CHOOSER-FIT.json) contains
all calibration candidates. The raw receipt has SHA-256
`f228cccc68316430a126973b7b390ca32280f3d8a5299e633b96355fde2a1358`.
[SOURCE-NOISE-CHOOSER-AUDIT.patch](SOURCE-NOISE-CHOOSER-AUDIT.patch)
restores the feature and plan generator. Restore the preceding
[chooser archive and whole-curve receipts](SOURCE-CHOOSER-REPORT.md#verification-and-reproduction)
first. The generator reuses the pinned fit and validation code and
changes only its evidence path, scratch path and frozen plan hash.

```sh
git apply benchmark/jpegxl/lossy-lab/SOURCE-NOISE-CHOOSER-AUDIT.patch
audit=.tmp/jpegxl-lossy-lab/source-noise-chooser
node "$audit/prepare.ts"
npx tsc --noEmit -p "$audit/tsconfig.json"
node "$audit/test-source-threshold.ts" prepare
node "$audit/test-source-threshold.ts" fit
```

Lab record LL-1227.
