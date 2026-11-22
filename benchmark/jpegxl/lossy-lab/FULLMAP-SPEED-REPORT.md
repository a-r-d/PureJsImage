# Complete-map preparation speed checkpoint

Two exact preparation changes reduce complete-map prototype encode time by
12.280-15.053%. The prototype still takes 1.730-1.776 times the retained
encoder's time, above the approved limit of roughly 1.33. The third change
does not show a repeatable gain and is reverted. Keep the two improvements in
development diagnostics; archive the encoder experiment. The bounded
continuation is exhausted without another quality trial.

Research base: `b9a84d455baadcb4c8daab8a9051730f12c362fa`, branch
`jxl-libjxl-ports`, 2026-10-28. Aaron approved at most three profiled changes
after the preceding 14 quality screens reached a plateau. All output,
quality, speed, memory and holdout requirements remain unchanged.
The [JSON report](FULLMAP-SPEED-REPORT.json) retains individual samples,
source and output hashes, memory readings and the carried quality evidence.

## Three measured changes

The refreshed warm encoder profile attributes 21.394% of self samples to
Gaussian blur, 4.514% to Opsin adaptation and 11.743% to directional costs.
These percentages guide the work; profile duration is not a speed measurement.

| Attempt | Change | Incremental map-time ratio, im26-3012 / im26-3312 | Faster pairs | Decision |
| --- | --- | ---: | ---: | --- |
| LL-1037 | Share Gaussian tap loads across four adjacent pixels; retain each sum's order and scalar borders | 0.766991 / 0.754884 | 22/22 | Keep |
| LL-1038 | Fuse Opsin channel adaptation and final XYB writes; share pixel loads and fixed weight products | 0.917883 / 0.903531 | 22/22 | Keep |
| LL-1039 | Omit the decoded mask, which scoring does not read | 1.008928 / 0.990074 | 8/22 | Revert |

Each comparison uses five warmups and eleven alternating pairs per photo.
The workload includes source and decoded preparation at both resolutions,
quadratic and directional maps, and scale mixing. It uses frozen source and
decoded PNGs. All output maps are exact. All 60 blur cases and all 192
prepared planes are exact against the original stack, including small and
odd image extents. The rejected mask change also passes its focused fixtures.

The two-change cumulative map ratios are 0.666567 and 0.686091, with 21/22
faster pairs. The second photo has noisy absolute times; individual samples
remain in the report. Its incremental measurements and encoder comparison
both independently support retaining the improvement. None of these map
timings measures the public encoder.

## Encoder cost gate

Three warmups and seven alternating triplets per photo compare the retained
encoder, the original complete-map prototype, and the optimized prototype at
distance 2. Both prototypes reuse unchanged coefficients. All timed streams
match their independently scored prior outputs. Quality runs, profiling and
tests do not overlap timing.

| Photo | Control median | Original prototype | Optimized prototype | Optimized / original | Optimized / control |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-3012 | 1083.485 ms | 2256.132 ms | 1913.078 ms | 0.849468 | 1.730251 |
| im26-3312 | 1164.263 ms | 2358.341 ms | 2027.750 ms | 0.877201 | 1.776060 |

Ratios are medians of paired ratios, not quotients of the displayed medians.
Optimized/original MAD is 0.023449/0.013636, with all 14 pairs faster.
Optimized/control MAD is 0.232015/0.035720. Even the smallest observed
optimized/control ratios, 1.435406 and 1.639462, exceed the cost allowance.

The prior complete-map screen gained 3.260791% mean BD-rate against control.
The unchanged rule permits 32.60791% added time, a ratio of 1.326079.
Measured added time is 73.025-77.606%. No further quality trial is admitted.

## Quality and memory scope

These are the prior complete-map screen results, carried by exact stream
equality. No new native quality labels or peer maps enter this continuation.

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| Retained control | +0.443% | -0.381% | -9.844% |
| wasm-vips effort 7 | -10.288% | -6.136% | -14.458% |
| jSquash effort 7 | -11.295% | -0.930% | -7.717% |

The fixed screen contains 16 photos at five distances. Its 75 required-range
overlap omissions remain unchanged; these are screen results, not full-lab
qualification. The complete-map policy increases AC precision in four tiles
ranked from our own reconstruction and source pixels. No peer decisions are
consumed.

All 80 prior screen streams reproduce byte-for-byte after fresh preparation,
ranking and coefficient rebuilding. All 96 fixed native-map window records
also match the prior checkpoint exactly.

Three fresh processes per prototype measure cold and reclaimed-warm encodes.
Median cold peak RSS is 264404/266536 KiB (original/optimized); overall peak
is 277472/280800 KiB, a 1.199% increase. All runs stabilize at 2067520
ArrayBuffer bytes before and after the warm encode, with 15428081 external
bytes after GC. Managed peak remains 6964315 bytes. Full readings are in the
JSON report. No buffer allocation shape changes in the retained optimizations.
Perceptual buffers remain outside the encoder's managed-memory ledger. The
prototype remains crop-only, and these process measurements cannot qualify
original-image memory scaling.

## Retained state

The active changes are confined to `libjxl-perceptual-local-port.ts` and its
Gaussian fixture. Public codec source, active encoder policy, package files,
dependencies and version are unchanged. Existing source attribution and full
BSD notices remain in place; no new native code or constants were taken.

Carried full-development results against wasm-vips are
-8.003/-5.030/-5.582% for SSIM/3-norm/max; against jSquash,
-8.474/+0.227/+2.571%. These are unchanged prior results. The frozen holdout
still has two failed SSIM regression guards, worst +11.617%. Its identities
remain unread. This branch is not ready to merge, and main remains unchanged.

## Reproduction and verification

Raw evidence is under `.tmp/jpegxl-lossy-lab/fullmap-speed-20261028`:
`base`, `h1-stack`, `h2-stack`, `h3-stack`, the three incremental timing
directories, `final-full`, `time-stack-*.json`, `parity-*.json`, memory files,
`native-windows`, and `verification`. Harnesses include `audit-blur.ts`,
`audit-preparation.ts`, `compare-full.ts`, `compare-h2.ts`, `compare-h3.ts`,
`time-stack.ts`, `audit-stack.ts`, `run-parity.ts` and `memory-stack-r2.ts`.
The first timing launcher had an incomplete snapshot import; the first parity
launcher omitted the source-pixel argument. Both failed before measurements
and their logs are preserved. Initial memory runs are retained in `memory-r1`;
the final protocol allows three GC/event-loop cycles before warm baselines.

`FULLMAP-SPEED-EXPERIMENT.patch` restores the measured prototype and its
prerequisites on this retained checkpoint. Historical allocation patches
remain unchanged and target their recorded earlier bases. The rejected third
change is preserved separately in `FULLMAP-MASK-EXPERIMENT.patch`, applied
after the complete-map archive. Neither patch is in the public bundle path.

`VITEST_MAX_WORKERS=4 npm run check` passes on the retained tree: 4208 tests,
three existing skips, 338 passed files and one skipped file. The test phase
takes 551.09s; the full command takes 608.282s. Browser-build, types, lint,
formatting, package-size and documentation gates all pass. Both archives apply
and reverse successfully; the final diff has no whitespace errors.
Bundles remain 614969/687801 minified bytes, runtime dependencies zero and
version 0.17.0. No full lab, holdout rerun, promotion or main merge occurred.
