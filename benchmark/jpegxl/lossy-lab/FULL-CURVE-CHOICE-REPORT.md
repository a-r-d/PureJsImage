# One saved encoder mode per development photo

Choosing one complete saved quality curve per photo with hindsight lowered
the worst full-band development SSIM guard from **+7.579% to +4.844%**.
The same eight photos cover the required band. Restricting the choice to
the corrected selected-block writer and the regularized control reaches
the same worst guard on this development set.

## Method

Use the nine original measurements for all 64 development photos from
regularized, forward, aligned DC, the corrected selected-block writer and
its coupled selector. For each photo and metric, compare every mode
against regularized over the intersection of all five measured quality
ranges, clipped to SSIM 60–90 or Butteraugli 0.5–3. All 64 photos have
positive overlap for all three metrics. The fixed main comparison
separately applies the existing full-band per-image guards.

Allow a replacement only when the common-band BD-rate is at or below
regularized for all three metrics, their mean improves, and every
previous full-band guard on that photo retains coverage and gets no
worse. Pick the lowest main-relative SSIM BD-rate for those guard photos.
For the others, pick the lowest three-metric mean against regularized.
Keep every point of the chosen mode's curve. Regularized is the fallback.
The sensitivity rows limit the available modes and use the same
intervals and acceptance conditions.

## Results

Negative BD-rate means fewer bytes at matched quality. The final column
uses the same eight admitted SSIM comparisons against main in every row.

| Allowed alternates | Photos switched out of 64 | SSIM / 3-norm / max BD-rate vs regularized | Worst main-relative SSIM guard |
| --- | ---: | --- | ---: |
| Regularized alone | 0 | 0 / 0 / 0% | +7.579% |
| All four | 40 | −0.617 / −1.113 / −2.201% | +4.844% |
| Corrected writer only | 29 | −0.545 / −0.681 / −1.623% | +4.844% |
| Aligned DC only | 18 | −0.295 / −0.861 / −0.935% | +4.844% |
| Corrected writer or aligned DC | 34 | −0.611 / −1.074 / −2.019% | +4.844% |

With all four alternates, six of the eight guard photos switch.
The original worst, im26-3302, reaches +4.538% with aligned DC or +4.752%
with the corrected writer. The new worst, im26-2004, stays at +4.844%.
The 48 photos outside the original screen provide 33 of the 40
switches. Their common-band means are −0.697 / −1.263 / −2.370%.
There are zero full-band 3-norm admissions against main.

This result uses all native scores before choosing a mode. It shows
headroom among these saved whole-image curves. The next development
question is whether a cheap input-only rule can recover enough of that
headroom while keeping incorrect switches rare. The two-mode comparison
with the corrected writer is the smallest test of that question. Its
validation would need separate development photos, a frozen rule and
actual-byte results. Speed, memory and holdout still require the normal
qualification path.

The [offline source-only chooser test](SOURCE-CHOOSER-REPORT.md) tries
a single luma detail threshold against these saved curves. It fails
the calibration gate.

## Verification and reproduction

The auditor reads 384 pinned development receipts from the five modes
and the saved main comparator. No streams were encoded or rescored.
Both historical holdout SSIM failures still block promotion.
Raw and compact replay receipts match byte for byte. The archive restores
both files exactly and the auditor passes strict TypeScript.
`VITEST_MAX_WORKERS=4 npm run check` passes 4,249 tests in 346 files,
with three tests and one file skipped.

[FULL-CURVE-CHOICE-REPORT.json](FULL-CURVE-CHOICE-REPORT.json) contains the
summaries, guard rows and saved choices. The full raw receipt is under
`.tmp/jpegxl-lossy-lab/full-curve-choice/`.
[FULL-CURVE-CHOICE-AUDIT.patch](FULL-CURVE-CHOICE-AUDIT.patch) restores the
strict TypeScript auditor. With the saved development runs and fresh
output paths, run from the repository root:

```sh
git apply benchmark/jpegxl/lossy-lab/FULL-CURVE-CHOICE-AUDIT.patch
audit=.tmp/jpegxl-lossy-lab/full-curve-choice
npx tsc --noEmit -p "$audit/tsconfig.json"
node "$audit/evaluate.ts"
```

Lab record LL-1225.
