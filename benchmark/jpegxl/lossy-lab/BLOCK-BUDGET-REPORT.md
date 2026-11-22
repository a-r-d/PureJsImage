# Selected-block quantization at saved byte budgets

Choosing with hindsight from both archived selected-block modes yields
**three qualifying replacements in 576 development budgets**. All three
occur at distances 5.35 or 7.5. The eight admitted development SSIM guard
photos offer zero replacements, and their worst guard stays at +7.579%
against main.

## Measured comparisons

The audit compares the corrected selected-block writer and its coupled
selector with the frozen regularized controls on 64 development crops
and nine settings. It checks the on-disk byte count and the encoded
SHA-256 receipt of all 1,152 archived candidate streams. A replacement
must fit the original byte cap, gain more than 0.1 SSIMULACRA2 points
and preserve both Butteraugli scores. Each budget can keep its
regularized stream. The hindsight selection can use the best native
score among saved candidates at any archived setting.

| Saved choices | Qualifying budgets | Total bytes saved | SSIM / 3-norm / max BD-rate vs regularized |
| --- | ---: | ---: | --- |
| Corrected writer | 3 of 576 | 282 | −0.050% / −0.036% / −0.039% |
| Coupled selector | 2 of 576 | 159 | −0.046% / −0.031% / −0.041% |
| Either mode | 3 of 576 | 287 | −0.051% / −0.036% / −0.041% |

Restricting each choice to its original setting gives the same table.
All three choices occur outside the original screen and outside the
development SSIM guard cohort. There are zero wins across the 24 budgets
at 0.9, 1.85 and 3.8 on the eight crops from the independent rate-targeting
trial. One of those eight crops has a win at 7.5.

At the same nominal settings, the corrected writer meets all three
quality conditions on 378 points before applying the byte cap. On the
375 quality improvements that exceed the cap, the median
extra cost is 6.14%. The coupled selector has 370 quality improvements
before the cap, with a 6.79% median extra cost among its 368 misses.
The original byte caps admit 103 writer points and 97 selector points
regardless of quality.

| Photo and distance | Archived choice | Bytes saved | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | --- | ---: | ---: | ---: | ---: |
| im26-1050, 5.35 | Coupled selector | 113 | +0.6846 | −0.013347 | −0.259998 |
| im26-1472, 7.5 | Corrected writer | 128 | +1.3235 | −0.093375 | −0.767290 |
| im26-3318, 5.35 | Coupled selector | 46 | +0.4533 | −0.025889 | −0.222889 |

The [original selected-block report](BLOCK-QUANTIZATION-REPORT.md) records
better aggregate curves when the entire corrected mode is used. The
point-by-point cap test has a different acceptance criterion and finds
little room to switch to these archived streams. A different quality
allocation remains the strongest lead. Another test that only switches
among these two modes has three measured development opportunities and
zero on the admitted guard photos.

The [whole-photo curve audit](FULL-CURVE-CHOICE-REPORT.md) measures a
separate policy that switches every setting together.

## Verification and scope

No new stream was encoded or natively scored. Only saved development
receipts and streams entered the audit. Both historical holdout failures
still block promotion, and all promotion gates stay in force.
Two offline runs produce byte-identical receipts. The archive restores
both files exactly and the auditor passes strict TypeScript.
`VITEST_MAX_WORKERS=4 npm run check` passes 4,249 tests in 346 files, with
three tests and one file skipped.

[BLOCK-BUDGET-REPORT.json](BLOCK-BUDGET-REPORT.json) records the summaries,
selected streams and raw receipt hash. Full per-photo rows and input
digests remain under `.tmp/jpegxl-lossy-lab/block-frontier/`.
[BLOCK-BUDGET-AUDIT.patch](BLOCK-BUDGET-AUDIT.patch) restores the strict
TypeScript auditor. With the saved development runs and fresh output paths,
run from the repository root:

```sh
git apply benchmark/jpegxl/lossy-lab/BLOCK-BUDGET-AUDIT.patch
audit=.tmp/jpegxl-lossy-lab/block-frontier
npx tsc --noEmit -p "$audit/tsconfig.json"
node "$audit/evaluate.ts"
```

Lab record LL-1224.
