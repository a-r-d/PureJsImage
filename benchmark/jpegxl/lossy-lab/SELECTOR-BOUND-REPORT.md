# Bounded selector speed follow-up

All three authorized changes are rejected. None establishes a repeatable speed
gain across both development crops, and none meets the 1.016124x control allowance
across both crops. No further quality or holdout trial follows. The two frozen
holdout SSIM failures remain unresolved, worst +11.617%; that is the previous
result, not a new measurement. The research branch is not ready to merge.

Base: `2c320e3bbecd81f1343a487d601366808eeb6b50`, `jxl-libjxl-ports`,
2026-10-29. Aaron approved at most three profiled changes preserving the output
of `standalone-regularized-half`. Quality parameters, targets, memory limits and
the holdout policy stay fixed. All three changes remain archived; active source
and the public encoder are unchanged by this follow-up.

## Measurements

Fresh profiles place most selector time in coefficient scoring and forward and
inverse transforms. Across three candidate encodes, inverse-transform samples
account for 223 ms on im26-3012 and 306 ms on im26-3312. These samples identify
hotspots; they are not end-to-end speed measurements.

Each timing trial rotates control, frozen candidate and optimized candidate in
one process, after two warmup triplets. Inputs are fixed 512-pixel development
crops at distance 2. Ratios below are medians of paired encode-time ratios;
lower is better. MAD measures spread in those ratios. Runs are isolated from
other benchmark and test jobs. The control uses `standalone-forward-all`.

| Trial | Photo vs frozen | Texture vs frozen | Photo / texture vs control | Verdict |
| --- | ---: | ---: | --- | --- |
| LL-1071: partial entropy every 64 coefficients | 0.983301 | 0.977067 | 1.124486 / 1.015428 | Inconclusive gain; reject |
| LL-1072: minimum entropy before transforms | 0.963808 | 1.004365 | 1.084643 / 1.046193 | Inconsistent gain; reject |
| LL-1073: partial inverse error bound | 1.023203 | 0.992579 | 1.081977 / 1.024563 | No repeatable gain; reject |

LL-1071 has 10/15 and 12/21 faster pairs, with MAD 0.051577 and 0.044907.
LL-1072 has 10/15 and 7/15, MAD 0.068020 and 0.031969. LL-1073 has 6/15 and
8/15, MAD 0.061834 and 0.015927. Apparent gains are smaller than the observed
spread or fail to repeat on the second crop. The especially slow photo cohort
in LL-1072 is preserved; comparisons use its own interleaved references.

The frozen quality mode's full-development mean gain is only 0.161235% against
control. Its 1.016124x allowance follows the unchanged incremental speed rule.
A fast row on one crop cannot qualify the mode. Previous quality measurements
and per-image development tradeoffs remain in
[the detail-guard report](DETAIL-GUARD-REPORT.md).

## What the bounds save

The entropy checks in LL-1071 execute 27,665 / 40,749 times and reject only
21 / 3 candidates, skipping 5,824 / 704 coefficients. Their overhead exceeds
the evidence for useful saved work.

The entry bound in LL-1072 checks 22,784 candidates on each crop. It rejects
none on the photo and 559 on the texture, where timing is neutral. The apparent
photo improvement therefore cannot be attributed to skipped candidates.

LL-1073 computes the first and last eighth of inverse output rows, then checks
their masked error in the original summation order. This nonnegative subset
bounds the full spatial loss. A complete-cost check confirms rejection; an
uncertain threshold falls back to the full inverse. It rejects 675 / 441 of
3,685 / 5,859 checked channel inverses. Despite these rejections, threshold
calculation and partial scoring do not produce a repeatable end-to-end gain.

## Correctness, memory and preservation

All 108 frozen/trial stream pairs, including warmups, have identical hashes,
byte counts and managed peaks. The 96 measured triplets contain 288 timed
encodes. Another 108 inverse cases cover nine rectangular/square geometries,
four coefficient scales and three bounds. Completed inverses match every
Float32 value; early returns satisfy the full-loss lower bound.

These checks justify interpreting the two-crop timing results. They do not
replace the full screen, independent decoding or promotion gates. Rejected
trials receive no new full-lab quality, original-image memory or holdout run.
LL-1073 duplicates a constant inverse-weight cache of at most 21,760 bytes for
widths 8/16/32/64, outside the managed counter. Equal managed peaks alone are
not a complete memory pass.

[The JSON report](SELECTOR-BOUND-REPORT.json) preserves all timing samples,
profile summaries and hashes, work counts, inverse checks, normalized source
hashes and the TypeScript harnesses. Raw CPU profiles remain under
`.tmp/jpegxl-lossy-lab/selector-bound-20261029/`.

To reproduce an archived trial, start at `97c76933`, apply
`DETAIL-GUARD-EXPERIMENT.patch`, then apply exactly one of
`SELECTOR-BOUND-TRIAL1.patch`, `SELECTOR-BOUND-TRIAL2.patch` or
`SELECTOR-BOUND-TRIAL3.patch`. The normalized frozen modules match that
reconstructed quality base exactly. All three patches pass `git apply --check`
there, and applying each to a separate copy reproduces every trial module
exactly. They are independent trials, not a stack. The speed changes
are first-party adaptations; the existing port attribution headers are kept.

`VITEST_MAX_WORKERS=4 npm run check` passes all static gates, browser:check and
4,214 tests, with three skips. Existing lint and formatting warnings remain.
The archived harnesses also pass a separate strict TypeScript check. The JSON
report records the full-check completion receipt and cross-trial hash checks.

## Remaining direction

The approved three-change bound is exhausted. The earlier quality plateau
still applies. Further experiments require an owner decision.

The largest remaining measured work is full forward/inverse transforms and
coefficient scoring. A cheaper rounding-aware score has more plausible upside
than additional per-candidate bounds, but would change decisions and need a
new quality experiment. An exact transform-kernel improvement is the next
speed-only possibility; current profiles do not yet establish a specific
implementation or expected gain. Neither direction has been started.
