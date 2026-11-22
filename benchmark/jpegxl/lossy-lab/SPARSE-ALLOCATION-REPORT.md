# Sparse perceptual allocation checkpoint

Sampling the full-resolution error map reduces its cost, but loses too much of
its useful tile ranking. The strongest new screen gains 1.832% mean BD-rate and
takes 1.875-1.958 times the retained control's time. Reusing unchanged transforms
is exact and saves 7.550-8.330% within the complete-map prototype, but does not
make a quality policy affordable. All three policies and both helper changes
are archived. The retained encoder is unchanged.

Research base: `dfd8650f7ad7a69fd0b7b3a06b149c239abe7800`,
branch `jxl-libjxl-ports`, 2026-10-28. The
[JSON report](SPARSE-ALLOCATION-REPORT.json) contains peer and control
distributions, range omissions, all 42 timing pairs, 80 stream hashes and the
fresh CPU profile summary.

## Three screens

Keep the full-resolution source and decoded perceptual bands, including each
directional stencil's complete input. Evaluate output locations on an
origin-aligned grid with spacing 2, 4 or 8. Evaluate the coarse map at spacing
1, 2 or 4 respectively, so each combined sampled location retains both original
inputs. Rank aligned 64-pixel tiles by their sampled maximum and add 25% AC
precision to four tiles. DC, chroma and filters stay fixed. No peer decisions
or native quality labels enter a decision.

All 240 rows on the fixed 16-photo, five-distance screen decode natively.
There are 73/75/75 incomplete required-range comparisons for spacing 2/4/8,
with no missing encodes. These are overlap-based screen results.

| Output spacing | SSIMULACRA2 vs control | 3-norm | Max | Mean | Screen guard |
| --- | ---: | ---: | ---: | ---: | --- |
| 2 | +0.423% | -0.384% | -5.536% | -1.832% | Pass |
| 4 | +0.585% | -0.164% | -3.206% | -0.928% | Pass |
| 8 | +0.631% | +0.093% | -1.494% | -0.256% | Fail |

Spacing 8's worst per-image max BD-rate is +3.024881%, above the unchanged 3%
guard. The prior complete-map update gains 3.260791% mean BD-rate. Spacing 2
keeps only 2.1125 of its four selected tiles on average, with identical choices
in 6/80 cases; the tile containing the true peak survives in 55/80. Spacing 4
keeps 1.2625 tiles and the true peak in 36/80; spacing 8 keeps 0.9125 and 20/80.
Exact values at sampled positions do not preserve maximum-based tile selection.

| Output spacing / reference | SSIMULACRA2 | 3-norm | Max |
| --- | ---: | ---: | ---: |
| 2 / wasm-vips | -10.293% | -6.135% | -10.375% |
| 2 / jSquash | -11.306% | -0.934% | -3.607% |
| 4 / wasm-vips | -10.150% | -5.934% | -8.202% |
| 4 / jSquash | -11.142% | -0.597% | -1.202% |
| 8 / wasm-vips | -10.099% | -5.711% | -6.614% |
| 8 / jSquash | -11.103% | -0.338% | +0.497% |

## Isolated cost and correctness

Each timing process performs three warmups and seven alternating pairs at
distance 2. All timed output hashes equal the independently scored streams.
Quality runs, tests and profiling do not overlap these measurements.

| Policy | Photo | Control median | Trial median | Paired ratio | Ratio MAD |
| --- | --- | ---: | ---: | ---: | ---: |
| Spacing 2, including reuse | im26-3012 | 1078.715 ms | 2088.459 ms | 1.874519 | 0.039513 |
| Spacing 2, including reuse | im26-3312 | 1149.661 ms | 2251.171 ms | 1.958117 | 0.068262 |
| Spacing 4, including reuse | im26-3012 | 1039.517 ms | 2010.612 ms | 2.003393 | 0.066457 |
| Spacing 4, including reuse | im26-3312 | 1159.371 ms | 2019.165 ms | 1.730421 | 0.064680 |
| Complete-map coefficient reuse | im26-3012 | 2400.910 ms | 2250.894 ms | 0.924497 | 0.006440 |
| Complete-map coefficient reuse | im26-3312 | 2572.046 ms | 2357.786 ms | 0.916697 | 0.006436 |

For the first four rows the control is the retained encoder. Every one of their
28 pairs is slower; even the lowest per-workload ratio fails the quality/time
rule. Spacing 2's 1.832% gain permits only 18.323% added time, versus the measured
87.452-95.812%. Spacing 4 permits 9.283%. Spacing 8 already fails quality and
does not receive an isolated timing run.

For the last two rows the control is the complete-map prototype rebuilding all
coefficients. Reuse copies AC coefficients and preserves cloned DC for transforms
with unchanged strategy and quantizer under identical coding parameters. Changed
transforms are recomputed from the original preconditioned source. All 14 pairs
are faster. Replaying the prior own decisions reproduces all 80 complete-map
streams exactly. This is an improvement to an unaccepted prototype, not a speed
improvement to the retained encoder. Archive the helper with that prototype.

Nine focused fixtures pass, including exact sampled map values and zeros at
unsampled positions, odd edges, cropped windows, invalid spacing, and reused
coefficients across groups. Strict TypeScript passes. The sparse maps retain
full-sized input and output buffers; the perceptual allocations remain outside
the encoder ledger. The measured managed peaks do not qualify their memory use.

A separate warm CPU profile of three spacing-2 encodes on im26-3012 shows
`perceptualBlur` at 23.882% of samples and `opsin` at 4.987%. The local perceptual
module accounts for 33.286%, while the directional module accounts for 5.829%.
Sparse output evaluation leaves most full-image preparation in place. Further
stencil pruning alone cannot resolve the measured cost gap.

## Retained state and plateau

| Full development, unchanged | SSIMULACRA2 | 3-norm | Max |
| --- | ---: | ---: | ---: |
| vs wasm-vips | -8.003% | -5.030% | -5.582% |
| vs jSquash | -8.474% | +0.227% | +2.571% |

Carried qualification: crops 2.635783x jSquash; the 13 MP original is 41.894s
and 1.698729x. The 21 MP original finishes in 83.743s; jSquash aborts.
Managed peaks remain 8,760,382/59,139,199/91,010,461 bytes under the
137,514,476-byte ceiling. Bundles remain 614,969/687,801 minified bytes,
with zero runtime dependencies and unchanged version 0.17.0.

The frozen holdout's aggregate vips results remain -5.996/-3.605/-2.909%
(mean -4.170%); jSquash -6.492/+1.640/+2.704%. Two SSIM promotion guards
still fail, worst +11.617% against main. Identities remain unread. This batch
does not rerun the holdout or qualify a merge.

There have now been 14 consecutive quality screens with no retained improvement:
three coefficient-RD screens (LL-1021-1023), eight allocation screens
(LL-1025-1032), and these three sampling screens. This meets the steering's
approximate plateau boundary. Section 9 says to stop after "about 15 lab
experiments in a row" without 1% cumulative development improvement.
Further quality experiments need an owner decision; the gates remain unchanged.

Remaining hypotheses, ranked by measured potential rather than promised gains:

1. Reduce complete-map preparation cost through shared passes and bounded
   source/decoded storage. The measured quality opportunity is the prior
   3.261% mean gain; after coefficient reuse the speed gap is still large.
   The CPU profile identifies blur and color adaptation as the next costs.
2. Use a sparse shortlist followed by complete map windows around shortlisted
   tiles. Its ceiling is the same measured complete-map gain; no recovered
   percentage is established. Spacing 2 already misses the true peak tile in
   25/80 rows, so window coverage must be measured before claiming savings.
3. Try bitrate-neutral precision redistribution with an explicit SSIM check.
   This might address the unresolved metric, but its upside is unmeasured.
   The current full-map policy costs +0.443% SSIM BD-rate versus control and
   cannot be assumed to fix the frozen SSIM guards.

The proposed continuation is bounded to three profiled, exact-output changes
to full-map preparation. It would require the complete-map prototype to reach
roughly 1.33x control time before another quality trial. That limit comes from
the existing speed rule and its measured 3.261% screen gain; full-lab results
would still have to justify the cost. This continuation awaits an owner decision.
No target or promotion guard is proposed to change.

## Reproduction and verification

Apply `JOINT-ALLOCATION-EXPERIMENT.patch`, then
`SPARSE-ALLOCATION-EXPERIMENT.patch`. The latter is a small layer containing
sampling, coefficient reuse, their fixtures and the three worker modes.
Both layers pass application checks, and reverse application restores the active
worker and helpers. Source attribution and BSD notices from the earlier ports
remain in their modules, provenance record and packaged/docs notices.

Raw evidence and reproduction scripts are under
`.tmp/jpegxl-lossy-lab/sparse-allocation-20261028`: `summarize.ts`, `ranking.ts`,
`audit-reuse.ts`, `run-reuse.ts`, `time.ts`, `timing-suite.ts`, `profile.ts`,
`profile-summary.ts`, `archive.ts` and `report-data.ts`. Use fresh output paths
when rerunning suites; their logs refuse replacement.

The normal screen runner takes `--strategy-port standalone-peak-sparse2`
and `--variant peak-sparse2`; replace both suffixes with 4 or 8 for the other
two trials. Use the existing frozen crop manifest, `--mode screen`,
`--screen-skip-large`, `--workers 2` and `--budget-seconds 600`.

The final retained-tree `VITEST_MAX_WORKERS=4 npm run check` passes: 4,207
tests, three existing skips, 337 passed files and one skipped file. The test
phase takes 501.54s; the full check takes 543.068s. All static
gates pass, including browser:check. The initial attempt stopped before tests
on JSON report formatting; it is preserved alongside the successful rerun.
Logs and status are in the raw root's `verification/` and `verification/r2/`
directories. No active source or test code is retained from these trials; the
report and layered experiment archive are kept.
