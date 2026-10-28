# Faster exact local perceptual scoring

Research branch `jxl-libjxl-ports`, base `e8d131c0`, 2026-10-28.
Entries LL-1012 through LL-1018. The encoder and holdout are unchanged.

Five measured changes reduce the bounded diagnostic's 32x32 scoring time by
about 85%, and its 192x192 scoring time by about 71%. The full-map neighbor
improves about 36%. All measured maps preserve the frozen base exactly. This
makes further RD experiments cheaper, but does not yet supply a practical
per-candidate encoder policy.

## Changes and incremental evidence

The earlier profile attributed 38.493% of samples to directional sums and
34.611% to Gaussian blur. Restricting output work exposes blur as the next
hotspot. A later full-map profile still shows directional sums dominating.

| Entry | Change | 32px paired ratio, two images | 192px paired ratio, two images |
| --- | --- | ---: | ---: |
| LL-1012 | Calculate quadratic/directional output only in the requested window | 0.550293 / 0.556763 | 0.674165 / 0.669799 |
| LL-1013 | Separate 37-pixel fine and 76-pixel coarse input halos | 0.489252 / 0.482070 | 0.741373 / 0.745022 |
| LL-1014 | Precompute Gaussian indices and normalization per axis | 0.619981 / 0.620738 | 0.698217 / 0.695912 |
| LL-1015 | Cache the exact 256 Float32 linear RGB values | 0.906657 / 0.909770 | 0.954114 / 0.943886 |
| LL-1016 | Unroll fixed directional sums in their existing order | 0.974522 / 0.981911 | 0.871038 / 0.872013 |

Ratios compare each change with the previous retained stack. The first four
use 11 alternating pairs. The final row uses 21 pairs after five warmups per
revision because the initial 32px result was noisy. That confirmation wins
18/21 and 16/21 small-window pairs, and every 192px pair. Its separate full-map
comparison improves from 833.310 to 678.540ms, ratio 0.809278, 11/11 wins.

Keep all five changes. No quality coefficients, stencils, weights, transfer
values, summation order or image inputs change. The Gaussian index plans add
bounded scratch; the transfer lookup retains 1,024 bytes. Source attribution
and the existing packaged/docs BSD license are preserved.

## Cumulative isolated timing

Use the same two fixed screen images, same decoded inputs and same window
locations as the previous checkpoint. Source preparation stays outside each
timed scoring call for both revisions. Five equal warmups precede 21 alternating
local pairs or 11 full-map pairs. No tests or other campaign measurements run
concurrently with these comparisons. Full and local calls include decoded
preparation, map calculation and output allocation.

| Image | Output | Base median ms | Candidate median ms | Paired ratio | Ratio MAD | Wins |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| im26-3012 | 32x32 | 145.907 | 21.470 | 0.148209 | 0.000737 | 21/21 |
| im26-3312 | 32x32 | 146.706 | 21.392 | 0.146652 | 0.001224 | 21/21 |
| im26-3012 | 192x192 | 516.064 | 149.235 | 0.288459 | 0.002607 | 21/21 |
| im26-3312 | 192x192 | 507.658 | 145.775 | 0.287120 | 0.001550 | 21/21 |
| im26-3012 | full 512x512 | 1106.169 | 703.142 | 0.639615 | 0.005745 | 11/11 |
| im26-3312 | full 512x512 | 1091.169 | 695.083 | 0.634143 | 0.005085 | 11/11 |

The 32px kernel handles about 47 windows/second; full-map throughput is about
0.37 megapixels/second. The first source preparations are separately recorded,
not steady-state benchmarks: roughly 51-54ms for candidate 32px and 100ms for
192px. A later encoder budget must include source preparation, reconstruction,
rate estimation and proposal generation as well as scoring.

Raw JSON retains every sample, medians, MAD, IQR, CV, fixture hashes, module
hashes, output hashes and runtime. The final local paired-ratio CV ranges from
1.21% to 4.73%; the full-map range is 1.56% to 2.90%.

## Memory and correctness

Three fresh processes per revision and mode measure a cold call and a warm call
after explicit GC. The table gives the median largest process-local VmHWM
observed across all phases, and the post-GC ArrayBuffer count. Raw cold/warm RSS
and external memory are preserved. These include Node, PNG and diagnostic
buffers; they are not encoder memory qualification.

| Output | Base peak KiB | Candidate peak KiB | Base post-GC buffers B | Candidate post-GC buffers B |
| --- | ---: | ---: | ---: | ---: |
| 32x32 | 114,848 | 104,312 | 6,347,014 | 4,105,478 |
| 192x192 | 150,772 | 150,216 | 16,561,414 | 11,862,278 |
| full | 215,580 | 212,752 | 33,652,774 | 33,653,798 |

Every process has identical ArrayBuffer counts before and after the reclaimed
warm call. The full-map persistent increase is exactly the 1,024-byte lookup.
The local driver still accepts a full source RGBA input; its bounded working
crop is not a streaming encoder boundary.

All 60 Gaussian comparisons are bit-exact across Float32/Float64 and tiny,
odd and 512-square dimensions. All 768 RGB channel/code samples match. Expanded
odd-coordinate, edge and invalid-window fixtures pass. All 96 fixed native-map
window comparisons reproduce the previous checkpoint's JSON exactly, with a
maximum absolute native-pixel error of 0.000061638710. Both final timing suites
have zero map differences against e8d131c0.

## Actual coefficient-change support

LL-1018 checks the 30 saved single-coefficient interventions from the previous
joint-RD cohort. Use our dithered reconstruction to find the changed display
pixels, expand their bounds by the derived 76-pixel support, and replace only
that region in the control's full perceptual map. Compare the result with a
fresh full-map calculation and the cached complete-map scores.

Every replacement map and pooled score matches exactly. The interventions
change 62-845 displayed pixels, but their conservative scoring windows span
85-187 pixels horizontally and 93-188 vertically after edge clipping. Thus the
21ms 32x32 result cannot be used as the cost of scoring a complete coefficient
change. The roughly 147ms 192x192 result is the more relevant current bound.
This support audit ran during repository checks, so its elapsed time is excluded.
It is one correlated development cohort, not a new quality result.

The next useful reduction is to reuse unchanged decoded bands and update only
the filter support affected by a proposal. Then test a bounded batch of joint
rate/quality proposals, including native SSIMULACRA2 checks. The model still
does not predict SSIMULACRA2, and the prior single-21 result remains only a
30-byte saving on one image.

## Reproduction and validation

Artifacts are in `.tmp/jpegxl-lossy-lab/local-speed-20261028/`:

- `base/` holds the six unmodified modules from e8d131c0. `roi-stack/`,
  `split-stack/`, `blur-stack/` and `transfer-stack/` preserve intermediate bases.
- `compare.ts`, `compare-*.ts` and `confirm*.ts` run the paired comparisons.
  `final/` and `final-full/` contain the cumulative measurements.
- `audit-blur.ts`, `audit-transfer.ts`, `blur-parity.json`,
  `transfer-parity.json` and `native-windows/` contain fidelity evidence.
- `memory-base.ts`, `memory-candidate.ts`, `memory.jsonl` and
  `memory-summary.json` retain all cold/warm process evidence.
- `profile-split/`, `profile-blur/` and `profile-full/` retain fresh CPU profiles.
- `audit-sparse-rd.ts` and `sparse-rd.json` retain the 30 intervention checks.

Run the saved paired confirmation with:

```sh
node --expose-gc .tmp/jpegxl-lossy-lab/local-speed-20261028/confirm.ts .tmp/jpegxl-lossy-lab/local-speed-20261028/rerun im26-3012
node --expose-gc .tmp/jpegxl-lossy-lab/local-speed-20261028/compare-full.ts .tmp/jpegxl-lossy-lab/local-speed-20261028/rerun-full im26-3012
node benchmark/jpegxl/lossy-lab/audit-local-perceptual-region.ts .tmp/jpegxl-lossy-lab/local-speed-20261028/rerun-native
```

Repeat the timing commands with im26-3312. Keep timing isolated from tests and
other measurements. Repository verification is recorded in the lab log after
completion. All changes remain in development diagnostics and tests; no public
codec behavior, dependency, encoder decision, holdout result or bundle changes.

Final validation: `VITEST_MAX_WORKERS=4 npm run check` passes with 4,200 tests
and three existing skips (547.472s complete command). Chromium, Firefox and
WebKit pass in 17.7s. All 25 focused fixtures, typecheck and diff checks pass.
Production src and dependency files equal e8d131c0. Keep the research branch;
existing per-image promotion guards and public forcing-hook cleanup remain.
