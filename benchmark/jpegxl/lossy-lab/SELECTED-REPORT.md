# Selected-transform error and pruning

Conservative pruning saves about 10% on two development crops with identical
streams. Seven frequency-dependent rounding variants are rejected.

Research base `c10c99be`, 2026-10-28, on `jxl-libjxl-ports`.
The holdout stays closed. This pass measures emitted AC error, frequency-dependent
rounding and conservative pruning of losing selector candidates.

## Selected-transform audit

All 64 development photos and nine distances are re-encoded with diagnostic
counters. All 576 streams match the saved, native-valid retained streams exactly.
The audit observes the selected transform's own coefficients and quantization
steps, after Gaborish preconditioning and before display filtering. DC is
excluded. Chroma errors describe the coded residual, without CfL error propagation.

For regular DCTs, coefficient error is multiplied by the transform area to give
spatial squared error. Tests independently reconstruct 8x8, 16x16 and rectangular
blocks and check this normalization. Special transforms are recorded separately;
they do not receive ordinary DCT frequency labels or rounding changes. The band
coordinate is u/width + v/height: low <= 0.25, middle <= 0.75, high > 0.75.

| Distance | Low share of luma AC error | Middle | High | Nearest-level excess in low / middle / high |
| --- | ---: | ---: | ---: | --- |
| 0.45 | 3.132% | 26.204% | 70.664% | 4.288 / 10.290 / 14.108% |
| 3 | 1.683% | 28.894% | 69.424% | 10.353 / 14.722 / 8.216% |
| 7.5 | 2.790% | 45.157% | 52.052% | 13.689 / 11.538 / 2.138% |

At distance 3, 10.132% of the total regular-DCT luma AC error exceeds the nearest
decoded-level error. Removing that excess can spend more bits. It does not imply
a free improvement in native perceptual quality or BD-rate. The bands contain
different numbers of coefficients; raw shares alone do not justify reallocating
precision. No surrogate replaces native validation or scoring.

## Frequency-dependent rounding

These trials hold selected transforms, quantization steps and filtering fixed.
They shift the quantizer input by a signed fraction of one quantization unit.
The default magnitude is 0.08; weak uses 0.04. High favors the high band and
reduces the low band by the same amount. Low reverses that shift. Middle favors
the middle band and reduces the other two bands by half as much. All applies the
high/low shift to all channels; other modes affect luma only. High-only leaves
other bands unchanged. Guarded additionally rejects a proposed high-frequency
token when its normative decoded coefficient error does not improve.

Each row has 80 valid native-decoded screen points on the fixed 16 development
photos. Values are SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max BD-rate (%).
Negative is better. Four-worker quality timing is excluded from speed claims.

| Mode | Against retained control | Against wasm-vips | Against jSquash |
| --- | --- | --- | --- |
| control | 0.000 / 0.000 / 0.000 | -10.654 / -5.866 / -5.164 | -11.546 / -0.300 / 2.115 |
| high | 2.565 / 1.213 / 2.623 | -8.431 / -4.785 / -2.640 | -9.284 / 0.952 / 4.831 |
| low | -0.206 / 1.292 / 3.507 | -10.998 / -4.684 / -1.951 | -11.970 / 1.060 / 5.423 |
| middle | 1.641 / 2.038 / 4.722 | -9.334 / -3.864 / -0.650 | -10.256 / 1.646 / 6.719 |
| weak | 0.739 / 0.145 / -0.070 | -9.976 / -5.742 / -5.249 | -10.837 / -0.124 / 2.071 |
| all | 2.627 / 1.101 / 2.064 | -8.371 / -4.891 / -3.161 | -9.231 / 0.839 / 4.284 |
| high-only | 0.697 / 0.757 / 1.199 | -10.018 / -5.121 / -3.975 | -10.920 / 0.470 / 3.356 |
| guarded | 0.585 / 0.568 / 0.711 | -10.114 / -5.298 / -4.482 | -11.021 / 0.293 / 2.858 |

All seven rounding variants are rejected. None advances to the full lab.

## Losing selector candidates

At distance 3, the full audit counts 1,458,176 candidates, 3,557,077 forward
transforms and 3,043,249 inverses. The existing bound rejects 513,828 channels
before inverse reconstruction and 369,092 after reconstruction. The X-channel
bound omits the Y-channel cost held separately to preserve summation order.
It also omits the minimum entropy of channels that have not been evaluated.

The new bound includes both costs and the existing X-channel penalty for large
transforms. An all-zero channel still has six units of the existing entropy
weight. Before evaluating the second rectangle in a partition, its maximum
useful cost is reduced by the first half's best available cost. All terms are
nonnegative. A small floating-point margin makes these bounds conservative.
The winning score and its summation order are preserved. No buffers are added.

The initial counters on im26-3012, distance 2, show 45,792 to 34,590 forward
transforms and 36,615 to 24,820 inverses with the combined bounds. All five
experimental pruning variants preserve bytes. Initial isolated 15-pair screens:

| Bound | Paired time change | MAD, percentage points | Faster pairs | Decision |
| --- | ---: | ---: | ---: | --- |
| Known Y cost only | -0.062% | 3.580 | 8/15 | Neutral |
| Minimum channel cost | -10.248% | 1.633 | 14/15 | Combine with partition budget |
| Partial coefficient loop | -11.438% | 4.248 | 14/15 | Omit extra loop branch |
| Partition budget only | -2.524% | 2.031 | 11/15 | Combine with channel bound |
| Combined | -10.672% | 2.021 | 15/15 | Clean and confirm against Git |

The partial-loop variant skips only 17 more partial loops on the probe and
saves no additional transforms or inverses. Its added per-coefficient branch
is omitted. Counters, mode flags and rounding hooks are removed before the
actual Git comparisons below. These use the same input bytes, distance 2,
complete encode timing and alternating order, with one untimed warmup pair.
No quality jobs or tests overlap these timing runs.

| Development crop | Base median ms | Candidate median ms | Paired change | Paired MAD | Faster pairs | Managed peak bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| im26-3012 | 1037.622 | 937.657 | -10.108% | 5.445 points | 19/21 | 5,682,267 |
| im26-3312 | 1067.721 | 968.559 | -10.614% | 3.712 points | 20/21 | 5,678,171 |

Painting time MAD is 43.083/41.134 ms, IQR 82.972/76.276 ms and CV 5.407/6.607%
for base/candidate. Texture MAD is 52.068/40.825 ms, IQR 87.320/70.293 ms and
CV 5.351/6.817%. All 42 pairs preserve exact output, input hash and managed
peak. Output sizes are 32,830 and 7,914 bytes. The improvement is measured on
these two crops; it is not a new full-lab or original-image speed qualification.

## Memory and correctness

The cleaned selector reproduces all 576 saved native-valid streams from 64
photos and nine distances. All 576 managed allocation peaks also match their
saved baseline records exactly. The full ladder maximum is 9,232,573 bytes;
the earlier 8,760,382-byte number describes the retained speed qualification's
crop set. Both are below the existing 137,514,476-byte ceiling.

Three isolated processes per revision encode the painting crop once cold and
once again. Linux process-local VmHWM medians are 180,716 to 179,920 KiB cold
(-0.440%) and 208,768 to 210,688 KiB through the second encode (+0.920%). The
second measurement includes startup and the first encode; it is not an
incremental post-warmup allocation claim. Raw external and ArrayBuffer values
are saved. One child inherits a pre-encode `process.resourceUsage().maxRSS` of
966,744 KiB while its own VmHWM is 178,192 KiB. The confirmation records both
and uses `/proc/self/status` VmHWM for the process-local absolute peak.

The focused selector suite passes 71 tests, including exact pruned/unpruned
comparisons at three distances across flat/noisy regions and odd image edges.
Chromium, Firefox and WebKit fixtures all pass. TypeScript checking passes.
The experiment archive applies cleanly to `c10c99be`.
`VITEST_MAX_WORKERS=4 npm run check` passes with exit 0: 4,180 tests pass,
three existing tests skip, and 330 test files pass with one skipped file.
The test phase takes 489.37 seconds; the complete check takes 530.18 seconds.
This includes browser-build, package, documentation, type, lint and format checks.

## Scope and remaining gates

Only the development selector's pruning and its regression tests are retained.
The rejected rounding modes and diagnostic hooks are archived. Public `src/`
is unchanged by this pass, main is unchanged, and no peer decisions are used.
There is no new libjxl port or runtime dependency. Existing attribution and
notices remain in place.

The retained full-development BD-rates are unchanged: against vips,
-8.003 / -5.030 / -5.582%; against jSquash, -8.474 / +0.227 / +2.571%.
The previous crop speed qualification is 2.635783x jSquash, and the 13 MP
qualification is 41.894 seconds / 1.698729x. These are historical qualification
results, not extrapolations from the new two-crop timings. Bundle sizes remain
614,941 / 687,773 bytes because the changed selector is outside the public graph.

The two frozen holdout SSIM guards still fail, worst +11.617%. No holdout data
is reopened or used for this pass. Full watch/scale, peer-hook cleanup and all
promotion gates still apply before any merge to main.

Next hypotheses are ranked by likely value: (1) trace selected coefficient error
through display filtering to identify which local improvements survive; (2)
measure rate cost together with cross-channel error before another rounding
policy; (3) profile candidates that survive the new bounds for further exact
speed work. Current rounding evidence does not justify a new quality policy.

## Reproduction and artifacts

The research archive `SELECTED-EXPERIMENT.patch` applies to `c10c99be` and
contains the selected-error audit, all seven rounding modes, five pruning
variants, counters and focused experimental tests. Use a separate checkout for
replaying it. Raw artifacts are under `.tmp/jpegxl-lossy-lab/selected-20261028/`.
`audit-summary.json` records the full coefficient audit; each `*-screen` directory
contains native metrics and comparisons to control, vips and jSquash.

The saved local `git-speed.ts` imports an untouched `git archive c10c99be`
snapshot under `git-base/` and the active candidate. The command below runs the
21 alternating pairs; substitute im26-3312 and a fresh output path for the
neighbor. `summarize-speed.ts` records median, MAD, IQR, CV and pair wins.

```sh
node .tmp/jpegxl-lossy-lab/selected-20261028/git-speed.ts \
  .tmp/jpegxl-lossy-lab/corpus-512-v2/im26-3012.png \
  /tmp/selected-pruning-speed.json 21
node .tmp/jpegxl-lossy-lab/selected-20261028/summarize-speed.ts \
  /tmp/selected-pruning-speed.json
node .tmp/jpegxl-lossy-lab/selected-20261028/full-parity.ts /tmp/selected-pruning-parity
npx playwright test browser-tests/jpegxl-decision-transplant.pw.ts --workers=1
VITEST_MAX_WORKERS=4 npm run check
```

`clean-parity/`, `rss-confirm.jsonl`, `browser.log` and `check.log` preserve the
clean candidate's verification evidence. Lab entries are LL-956 through LL-973.
