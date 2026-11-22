# Source and control preparation reuse

Writer-pass observation removes repeated source transforms: complete diagnostic
encodes improve 6.1% on painting and 7.7% on texture with identical proposals and
bytes. Retain the development callbacks and their focused coverage. All seven
quality policies fail. Guarded region exchanges cost 28-45% more for at most
0.006% mean BD-rate gain. Cheap same-transform exchanges run near control speed
but worsen mean BD-rate by 1.03-2.51%.

Research branch `jxl-libjxl-ports`, base `aca2c2fc`, 2026-11-15. This round leaves
production source, main, dependencies and normal encoder decisions unchanged.
Work remains uncommitted. Holdout stays closed; no policy earns a full lab or
promotion. Prior SSIM and bounded-reconstruction helpers remain intact.
The [JSON report](SOURCE-CONTROL-REPORT.json) contains all native curves, paired
timings, memory receipts and verification. The [archive](SOURCE-CONTROL-EXPERIMENT.patch)
restores every prototype and its measurement scripts.

## What was reused

The first attempt keeps the filtered source context alive until proposals are
generated. All 175,392 painting and 248,346 texture quantization checks match.
However, its cache holds one color tile. A later whole-image scan misses most
of that cache. Eleven full-encode pairs give 0.970127x and 1.013853x, with
opposing absolute medians on painting. This does not establish a speed gain.

The retained callbacks instead observe the existing writer pass, after each
selected transform is quantized and before its scratch buffers are reused.
They expose the current transform and coefficient views. A second callback
runs while the filtered source context is still alive. Both are optional and
development-only. Observers consume borrowed views synchronously.

| Complete unchanged-output diagnostic | Recompute median ms | Observe median ms | Paired ratio | Ratio MAD | Faster pairs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Painting, im26-3012 | 924.166 | 869.171 | 0.938616 | 0.019298 | 14/15 |
| Texture, im26-3312 | 935.000 | 879.679 | 0.922758 | 0.028974 | 13/15 |

Proposal work falls from 69.274 to 15.338ms and from 76.279 to 9.904ms.
Throughput rises from 0.284 to 0.302 megapixels/s on painting and 0.280 to
0.298 on texture. Every proposal fingerprint and final stream agrees. These gains compare two
experimental analysis paths, not the normal production encoder.

Collection is then bounded to one AC group, retaining only its best 64px region.
Scratch stays below 2.1MB and only the selected group's coefficients are copied,
at most 393,216 bytes. The guarded prototype also shares owned displayed-RGB
pyramids between SSIM and perceptual preparation. Nine focused cases verify exact
source values, tiled SSIM sums, perceptual maps and multi-owner reconstruction.
Shared RGB does not remove the expensive frequency-band preparation.

## Coupled proposals and actual rate

The first proposal family restores zero luma coefficients to magnitude one,
funded by magnitude-one removals in the same 64px region. Its source-domain
squared error must decrease. Fixed pair caps are 8, 32 and 128. Combined
protection retains global SSIM pooling and nonincreasing Butteraugli max and
L3/L6/L12 sums over complete changed support. An unprotected cap128 row measures
the proposal family's available native gain.

Equal exchange counts do not conserve stream size. The raw region row adds
1,245 bytes across its eighty outputs and causes seventeen material harms.
The combined guard admits only three, five and ten outputs at caps 128, 32 and
8. Their total size changes are still +6, +22 and +19 bytes. All BD-rates below
use complete final file sizes, including context, order, map and entropy costs.
There is one final entropy write inside each encode.

The second family exchanges coefficients inside each transform, preserving its
nonzero count. It reuses source and quantized-control AC moments already present
in the writer, with 20,480 ledger-accounted scratch bytes. Optional constraints
prevent worse AC variance mismatch and normalized AC error. These are cheap
source-domain proxies, not native SSIMULACRA2 or Butteraugli protection.

They fail on both rate and pixel quality. Constrained caps 1/4 add 14,751/24,802
bytes, increasing size in 72/75 of eighty outputs. Native SSIM falls in 62/60
outputs, averaging -0.111546/-0.275980 points at the same distances. Fourteen
and twenty-five SSIM losses exceed 0.25 points. The count-only cap1 diagnostic
adds 16,476 bytes and loses 0.115322 SSIM points on average. Thus final entropy
rate and displayed error both invalidate the source-domain proxy.

## Native screen

Eight configurations, including fresh control, finish all 640 own outputs.
The fixed sixteen development photos use distances 0.5, 1, 2, 4 and 7. No encode,
decode or ladder point fails. Candidate range warnings number 75, except the
writer rows, which retain 76. Full-band Butteraugli comparisons against control
remain zero. Material-harm counts below use 0.25 SSIM points or 1% Butteraugli
max/3-norm only as a diagnostic; normal promotion gates are unchanged.

| Policy | SSIM vs control | 3-norm | Max | Mean | Material harms / 80 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Region, raw cap128 | +0.340347% | +0.503374% | +4.176691% | +1.673471% | 17 |
| Region, guarded cap128 | -0.000778% | -0.007333% | +0.001059% | -0.002351% | 0 |
| Region, guarded cap32 | -0.000523% | -0.007482% | -0.008857% | -0.005621% | 0 |
| Region, guarded cap8 | -0.000378% | -0.007392% | +0.001168% | -0.002200% | 0 |
| Within transform, contrast cap1 | +1.426775% | +1.127420% | +0.544231% | +1.032809% | 29 |
| Within transform, contrast cap4 | +2.939715% | +2.313020% | +2.268242% | +2.506993% | 43 |
| Within transform, count-only cap1 | +1.490833% | +1.196338% | +0.515179% | +1.067450% | 30 |

| Policy | Vips SSIM / 3-norm / max | jSquash SSIM / 3-norm / max |
| --- | --- | --- |
| Fresh control | -10.719947 / -5.850752 / -6.492535% | -11.810157 / -0.553990 / +0.605413% |
| Region, raw cap128 | -10.402933 / -5.378555 / -2.464748% | -11.493470 / -0.034418 / +4.814011% |
| Region, guarded cap128 | -10.719859 / -5.856252 / -6.491619% | -11.811046 / -0.560311 / +0.606373% |
| Region, guarded cap32 | -10.719636 / -5.856362 / -6.495834% | -11.810779 / -0.560441 / +0.602559% |
| Region, guarded cap8 | -10.719655 / -5.856263 / -6.491503% | -11.810880 / -0.560305 / +0.606490% |
| Within transform, contrast cap1 | -9.407934 / -4.766748 / -5.964667% | -10.517528 / +0.579374 / +1.251024% |
| Within transform, contrast cap4 | -7.997879 / -3.643923 / -4.333554% | -9.117659 / +1.784905 / +2.990995% |
| Within transform, count-only cap1 | -9.345670 / -4.701078 / -5.957252% | -10.450296 / +0.648836 / +1.249040% |

Peers remain wasm-vips 0.0.19 and jSquash 1.3.0 at effort 7. These are partial-band
screen comparisons, not replacement full-development or holdout figures.

## Complete encoder cost

Every source/control preparation, proposal, reconstruction, protection step and
final entropy write stays inside the timer. The standard constant override
objects and already-loaded PNG inputs are outside both timers. Two warmup pairs
precede alternating measured pairs. No other benchmark, profile, native scoring
or test overlaps. Every result matches its native-screen stream hash.

| Policy | Pairs per input | Painting control / candidate ms | Paired ratio | Texture control / candidate ms | Paired ratio |
| --- | ---: | --- | ---: | --- | ---: |
| Region, raw cap128 | 21 | 868.148 / 867.292 | 0.989093 | 795.727 / 824.203 | 1.006925 |
| Region, guarded cap128 | 7 | 896.491 / 1206.662 | 1.325139 | 902.707 / 1274.498 | 1.403828 |
| Region, guarded cap32 | 7 | 912.346 / 1198.885 | 1.277824 | 905.407 / 1299.518 | 1.443366 |
| Region, guarded cap8 | 7 | 929.153 / 1209.468 | 1.341332 | 914.968 / 1327.362 | 1.450719 |
| Within transform, contrast cap1 | 21 | 843.240 / 875.937 | 1.007281 | 838.132 / 843.763 | 1.000479 |
| Within transform, contrast cap4 | 21 | 851.254 / 861.228 | 0.983327 | 841.646 / 860.996 | 1.015254 |
| Within transform, count-only cap1 | 21 | 871.710 / 860.517 | 1.004544 | 850.121 / 856.779 | 1.009236 |

Raw/writer ratios sit near one amid roughly 4-7% paired MAD. They fail quality.
All guarded pairs are slower. A 0.002-0.006% mean gain cannot pay for 28-45%
added time under the unchanged speed rule. No policy advances.

## Memory measurement and retained state

An empty final Node command reports rusage peak 766,070,784 bytes while its own
Linux VmHWM is 67,985,408. A preceding forked command reports 67,252,224 versus
VmHWM 67,874,816. The launcher's final exec path preserves earlier rusage state.
The repeated 766MB readings cannot be interpreted as these Node processes'
actual peak RSS. Keep all legacy readings as unqualified evidence. New isolated
peaks use `/proc/self/status` VmHWM and retain rusage alongside it.

The retained callbacks are compared with three original `aca2c2fc` modules,
with only first-party imports redirected. All eighty control streams and managed
peaks match the prior control. Three focused observation cases validate borrowed
values, multi-group geometry and cleanup when a callback throws. Initial fixture
assumptions about DCT8 and signed floating-point zero were corrected without
changing encoder math or metric tolerances.

Normal-path timing has 21 isolated alternating pairs after three warmups:
painting 879.352/844.856ms, paired 0.961370x, MAD 0.033376, 15/21 faster;
texture 837.476/852.502ms, 1.015590x, MAD 0.016222, 5/21 faster.
These mixed results do not establish a normal-encoder speedup.

| Isolated memory | Original median peak bytes | Retained median peak bytes | Ratio | Samples per variant |
| --- | ---: | ---: | ---: | ---: |
| Painting cold | 172,384,256 | 175,937,536 | 1.020613 | 12 |
| Painting warm | 204,636,160 | 199,393,280 | 0.974380 | 3 |
| Texture cold | 163,196,928 | 168,083,456 | 1.029943 | 3 |
| Texture warm | 202,846,208 | 204,255,232 | 1.006946 | 3 |

The initial three-sample painting cold comparison was +5.85%. Add nine fresh
samples per variant, balance order, and preserve all twelve. The confirmed
median is +2.06%. Warm processes include three complete warmups and collections.
Absolute peaks include imports, PNG inputs and all warmups. Post-warm external
and ArrayBuffer snapshots remain diagnostic; they are not an incremental-memory
baseline or a claim that every background allocation was reclaimed.

Keep the two optional observation callbacks and focused coverage. Restore the
normal lab worker and prior bounded helpers; archive all policies and added
preparation/collector prototypes. The 51-file archive includes the preceding
uncommitted helper prerequisites and restores exactly on `aca2c2fc`. No public
codec option or runtime dependency is added. Existing license headers, provenance
and full package/docs notices remain.

Fresh `VITEST_MAX_WORKERS=4 npm run check` exits zero with no signal: 4,245
tests and 345 files pass, three tests and one file skip. All static and browser
build gates pass. Whole check takes 582.979s; Vitest takes 541.90s. Eleven retained
focused cases pass separately. No benchmark overlaps checking.

Historical qualification carries forward:
full-development vips -10.184/-4.810/-4.548%, jSquash -12.333/-1.230/+3.116%,
main -8.704/-10.154/-8.168%. Those belong to the earlier rejected predictor,
not this screen control. Previous crop speed is 2.387946x jSquash; originals take
39.546/68.866s, with the 13MP case 1.512916x and the 21MP peer aborting. Managed
peaks remain 9,422,327/59,210,879/91,262,401 against 137,514,476. Bundles remain
614,969/687,801 bytes and runtime dependencies zero. The frozen holdout still
has two SSIM guard failures, worst +11.202599% against +8.05%.

Next: price coupled changes with incremental final-context rate; test displayed
error when changing quantization/transforms; amortize source/control preparation
only across updates whose native gain pays for the complete encoder cost.

## Reproduction

Raw root: `.tmp/jpegxl-lossy-lab/coupled-reuse-20261115`. Use the archive in a clean
`aca2c2fc` checkout with the pinned development corpus and saved prior datasets.
It includes retained callbacks, helper prerequisites and rejected modes; applying
it over the current modified tree is not the reproduction path. Use fresh output
directories because encoding and timing runners reject overwrites.

```sh
git apply benchmark/jpegxl/lossy-lab/SOURCE-CONTROL-EXPERIMENT.patch
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out NEW_SCREEN --mode screen --workers 4 --budget-seconds 600 --variant standalone-coupled32 --strategy-port standalone-coupled32
node .tmp/jpegxl-lossy-lab/coupled-reuse-20261115/stream-cost.ts im26-3012
node .tmp/jpegxl-lossy-lab/coupled-reuse-20261115/full-cost.ts im26-3012 cap32
node .tmp/jpegxl-lossy-lab/coupled-reuse-20261115/writer-cost.ts im26-3012 swap1
node .tmp/jpegxl-lossy-lab/coupled-reuse-20261115/normal-cost.ts im26-3012
node --expose-gc .tmp/jpegxl-lossy-lab/coupled-reuse-20261115/normal-memory.ts im26-3012 retained cold 0
```

Repeat both photos and the mode/sample sets recorded in the JSON. Complete the
native control/candidate screens before timings that check their stream hashes.
For a fresh sibling tree, change the private output-root literals consistently.
Run timing, memory, native scoring and repository checking serially.
