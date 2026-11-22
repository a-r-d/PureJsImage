# Frequency allocation and selector speed

Research base: `bb43c721`, on `jxl-libjxl-ports`, 2026-10-27.
The retained mode is `standalone-forward-all`. Main and the holdout are unchanged.

## Reconstruction error

The audit covers all 64 development photos and nine distances, using the retained
encoder's 576 saved native-decoded PNGs. It converts displayed RGB to the existing
normalized XYB diagnostic space and applies an orthonormal 8x8 DCT to source and
reconstruction. The JSON retains each channel's 64 frequency errors and source
energies, plus four band totals. Parseval, identity and constant-offset fixtures
check the energy accounting.

Bands use frequency coordinates u and v: DC is (0,0), low is u+v from 1 to 2,
middle is 3 to 6, and high is 7 to 14. At distance 3, DC contributes 0.646% of
luma reconstruction MSE and middle/high contribute 90.881%.

| Distance | DC | Low | Middle | High |
| --- | ---: | ---: | ---: | ---: |
| 0.45 | 0.550% | 3.596% | 27.570% | 68.284% |
| 3 | 0.646% | 8.473% | 46.881% | 44.000% |
| 7.5 | 1.252% | 15.063% | 57.516% | 26.168% |

The bands contain 1, 5, 22 and 35 bins. Middle/high therefore contain 57 of the
64 bins (89.063%); their 90.881% error share at distance 3 gives little evidence
of concentration by itself. Per bin, middle contributes 2.131% of luma MSE and
high 1.257% at that distance. The per-bin peak moves toward lower frequencies
as distance increases. These counts help explain why the aggregate error share
was a weak basis for source-energy redistribution.

No single frequency dominates: the largest luma bin carries 2.246% of the error
at distance 0.45, 2.378% at distance 3 and 3.765% at distance 7.5. These are displayed
reconstruction errors after filtering and rounding. They do not isolate emitted
coefficient quantization, and their proportions are not perceptual weights.

## Precision redistribution

Each trial estimates source-luma band energy per 8x8 cell and multiplies its
initial quantization field by exp(strength * (band share - mean band share)).
Both the selector and final writer consume the changed field. This preserves the
geometric mean before field rounding; it does not preserve the actual file size.
All decisions use source pixels. Every trial uses the same fixed 16-photo screen,
five distances, cached peers and native validation.

Each cell below is SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max BD-rate (%).
Negative is better. Each row has 80 valid outputs and no metric failures.

| Allocation | Against retained control | Against wasm-vips | Against jSquash |
| --- | --- | --- | --- |
| Fresh control | 0 / 0 / 0 | -10.654 / -5.866 / -5.164 | -11.546 / -0.300 / +2.115 |
| Middle and high, strength 0.4 | +0.206 / +1.510 / +4.235 | -10.455 / -4.477 / -1.003 | -11.361 / +1.232 / +6.374 |
| Middle, strength 0.4 | +0.134 / +1.063 / +3.824 | -10.530 / -4.898 / -1.377 | -11.444 / +0.792 / +6.038 |
| Low, strength 0.4 | +2.079 / +0.927 / +0.332 | -8.767 / -4.931 / -4.820 | -9.729 / +0.672 / +2.445 |
| High, strength 0.4 | -0.100 / +0.049 / +0.498 | -10.767 / -5.807 / -4.622 | -11.659 / -0.227 / +2.670 |
| Middle and high, strength 0.2 | -0.053 / +0.316 / +1.445 | -10.718 / -5.577 / -3.745 | -11.622 / +0.025 / +3.643 |

All five are rejected. The high-only variant has the smallest mean regression
(+0.149% against control), but its max metric worsens. Its measured-overlap
Butteraugli max regressions reach +6.930% on im26-1610 and +6.294% on im26-2012.
The known texture im26-3312 also loses +1.629% SSIM BD-rate against control.
These screen overlaps do not cover the full guard bands, so they are diagnostics
rather than formal promotion-guard verdicts. Source band energy alone
does not identify where extra precision improves the perceptual balance. No
candidate advances to the full lab. Four-worker quality timings are excluded
from speed claims. The reproducible modes and runner are preserved in
[FREQUENCY-EXPERIMENT.patch](FREQUENCY-EXPERIMENT.patch); the active allocation
policy is restored.

## Selector profile

A fresh im26-3012/d2 CPU profile places scoring first at 129.654ms self time,
paired forward transforms at 122.985ms, inverse transforms at 101.000ms, writer
rewrite at 64.597ms and mask filling at 63.003ms. Profile samples locate work;
isolated alternating trials determine whether changes improve encode time.

The first trials remove unused non-tiny error sums, avoid entropy arithmetic for
zero coefficients, and replace floor-based nearest-even ties with an exact
Math.round correction. Focused odd-edge tests cover fine, medium and coarse
distances and require identical output bytes and managed peaks.

## Evidence and reproduction

Raw output is under `.tmp/jpegxl-lossy-lab/frequency-20261027/`. The lab log records
LL-938 onward. The audit expects the fixed prepared corpus and cached native
outputs at the paths in `audit-frequency-error.ts`.

```sh
node benchmark/jpegxl/lossy-lab/audit-frequency-error.ts .tmp/jpegxl-lossy-lab/frequency-20261027/error-frequencies.json
node benchmark/jpegxl/lossy-lab/profile-selector.ts .tmp/jpegxl-lossy-lab/frequency-20261027/profile/control.cpuprofile .tmp/jpegxl-lossy-lab/frequency-20261027/profile/control-summary.json
```

## Speed results

These are isolated im26-3012/d2 encodes with one untimed warmup pair and
alternating order. Negative paired deltas mean faster. Every output hash and
managed peak matches control. Initial comparisons use development switches;
confirmation comparisons import the actual `bb43c721` source separately.

| Trial | Pairs | Paired time delta | Paired MAD | Faster pairs | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Skip unused non-tiny error sums | 15 | +0.252% | 2.211 points | 7 | No gain |
| Skip zero-magnitude entropy arithmetic | 15 | -1.393% | 3.726 points | 8 | Weak initial signal |
| Correct ties after Math.round | 15 | +2.172% | 3.860 points | 6 | No gain |
| Combine all three | 15 | -1.192% | 6.336 points | 8 | Inconclusive |
| Clean zero-magnitude skip against Git | 21 | +1.105% | 7.297 points | 8 | Initial gain does not reproduce |
| Clear only skipped DC residual slots, against Git | 21 | +1.004% | 6.052 points | 9 | Inconclusive |
| Exact square-root table, against Git | 21 | +4.522% | 5.407 points | 9 | Slower |

A second baseline profile still places scoring first (151.516ms), with 19
coefficient-scoring ticks attributed to square-root entropy arithmetic. The table
trial uses tracked, bounded 32,768-byte scratch and releases it before writing;
the measured writer-dominated managed peak remains 5,682,267 bytes. RSS is not
measured in these exploratory trials. No claim of improved end-to-end speed or
memory follows from fewer arithmetic operations or writes.

All six hypotheses are archived and reverted. The three original variants and
combined switch are in `SCORE-EXPERIMENT.patch`. Clean confirmation patches are
`SPARSE-SCORE-EXPERIMENT.patch`, `RESIDUAL-CLEAR-EXPERIMENT.patch` and
`SQRT-SCORE-EXPERIMENT.patch`. Each applies independently to `bb43c721`.
The frequency patch also includes its first-party band diagnostic dependency.

## Retained state and next experiments

The retained encoder remains byte-for-byte unchanged from `bb43c721`. Its prior
64-photo development BD-rates are vips -8.003/-5.030/-5.582% and jSquash
-8.474/+0.227/+2.571%. This session's fresh screen reproduces its screen results.
Prior qualified speed remains 2.635783x jSquash for crops and 1.698729x for the
13 MP original. These are existing qualifications, not new timing measurements.
The frozen holdout still has two failed SSIM guards, worst +11.617%. It stays
closed, and nothing is promoted or merged to main.

The next quality experiment should measure errors in the selected transform's
own coefficient coordinates, separated from final display filtering. That can
support a small frequency-dependent rounding trial within each transform,
without inferring perceptual value from source energy alone. A speed follow-up
should profile candidate counts and the cost of losing transforms: this pass
found no repeatable benefit from six coefficient arithmetic changes. Any pruning
change must preserve an admissible lower bound or be evaluated as a quality
change on the fixed development screen.

After applying `SCORE-EXPERIMENT.patch` to the research base, the existing speed
harness reproduces an initial alternating comparison:

```sh
node benchmark/jpegxl/lossy-lab/selector-speed.ts .tmp/jpegxl-lossy-lab/corpus-512-v2/im26-3012.png .tmp/sparse-speed.json standalone-forward-all standalone-score-sparse 15
```

Clean confirmation uses the preserved `frequency-20261027/git-speed.ts` runner
and a `git archive bb43c721` source snapshot in its `git-base` directory. Raw
pair rows, distribution summaries and the runner remain with the local evidence.

## Verification

`VITEST_MAX_WORKERS=4 npm run check` passed: 4,177 tests, three existing skips,
330 passing test files and one skipped file; test duration 518.03s. Static,
TypeScript, lint, formatting, package, documentation and browser-build gates pass.
The three new diagnostic fixtures and all archive applicability checks pass.
No benchmark overlaps the check. JPEG XL bundle sizes stay 614,941/687,773 bytes;
runtime dependencies remain zero. No public or active encoder source changes.
Raw verification is `frequency-20261027/check.log` and `check-status.json`.
