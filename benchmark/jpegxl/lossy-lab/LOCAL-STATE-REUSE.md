# Local perceptual state reuse

Date: 2026-11-04. Base: `b90e2e64e7a21f7640327d561f5902bcae31e126`.
Branch: `jxl-libjxl-ports`. Three optimization attempts, one final helper retained,
zero encoder changes or promotions. No new encoded configurations, peer decisions
or holdout access. All quality, speed, memory and promotion gates stay unchanged.

Caching unchanged control scores makes repeated local scoring substantially
cheaper. Total eight-proposal batches improve 35.1-35.5%, including cache setup.
All thirty saved coefficient interventions have bit-exact output maps. Their
fixed-window batch improves 25.9%. This does not repair the quality failures or
make the research branch ready to merge.

## Implementation and attempts

`local-perceptual-state.ts` snapshots the control pixels needed by one output
window. It initializes fine/half control score maps only when partial reuse is
possible. Each proposal computes its RGB change bounds, expands full dependency
support, crops the existing source bands, recomputes affected scores using the
unchanged component arithmetic and copies unaffected scores. Whole-window changes
use the existing scorer. Every proposal is independent relative to the same
control. Callers must keep the prepared source reference unchanged.

The preparation radius is 37 samples at each scale; this also covers the
32-sample directional dependency. Half-resolution sampling keeps the original
even phase and odd image edges. No approximations, fitted thresholds, changed
weights or float-delta updates are used. The helper is development-only; no
production selector calls it.

| Attempt | Finding | Decision |
| --- | --- | --- |
| LL-1131 | Cached decoded bands improved batches 17.4/18.1%, but retained 11,962,240 bytes and the first warm RSS pair rose 5.335%. | Reject that representation. Archive it. |
| LL-1132 | Caching score maps improved batches 34.6/35.5%; the first cold/warm memory checks passed. Whole-window changes were 15.4% slower. | Keep the idea only with the next repair. |
| LL-1133 | Lazy map initialization and whole-window fallback preserve local gains and reduce the neighbor regression to 0.6%. | Retain as a repeated-proposal lab helper. |

The base CPU profile placed 40.2% in Gaussian blur, 23.0% in preparation and
24.6% in directional sums. After LL-1131, directional sums grew to 34.2% of
sampled time, motivating unchanged-score reuse. The whole-window phase profile
attributed 64.4ms of a 78.1ms batch increase to unnecessary initialization.
The final profile still spends 43.3% in blur and 23.0% in preparation.
Profiles, phase measurements, module hashes and all raw samples are recorded in
[the result JSON](LOCAL-STATE-REUSE.json).

## Timing

Node 24.16.0 on the same machine as the base. Inputs are frozen 512-square
screen development photo `im26-3012` and texture `im26-3312`. Each batch has eight
nontrivial proposals: source RGB substitutions in centered 8/32-square regions,
in all channels or one channel at a time. Score output is 192-square, covering
the complete changed support. These are display-scoring workloads, not encodes.

Five warmup pairs precede twenty-one alternating measured pairs. Every batch
includes a fresh control-cache constructor and any lazy initialization. Source
preparation is common and excluded from both timed paths; its separate receipt
is preserved. Input reconstruction, file loading and correctness comparisons
are outside both timers. No concurrent profiling, tests or other measurement
jobs ran during timing.

| Workload | Base median ms | Candidate median ms | Paired ratio | Ratio MAD | Faster pairs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Photo, 8 local proposals | 508.979 | 330.385 | 0.648552 | 0.003253 | 21/21 |
| Texture, 8 local proposals | 509.624 | 328.270 | 0.645307 | 0.002653 | 21/21 |
| Photo, 8 whole-window changes | 506.676 | 509.860 | 1.005896 | 0.001756 | 3/21 |
| 30 saved coefficient edits, 13 windows | 2741.659 | 2033.058 | 0.741111 | 0.001844 | 11/11 |

Local batch throughput rises from about 15.7 to 24.2-24.4 proposals/second.
A separately labeled steady-cache run has medians 265.394/266.347ms per eight
proposals, about 33.2/33.3ms each. Its ratios are 0.520869/0.522828, with eleven
of eleven pairs faster. That run excludes control-cache initialization and is
not the qualification headline.

The real interventions come from saved `im26-2004`, distance 1.85, control plus
`single-0` through `single-29`. Stream identities and source bytes are checked
before reconstruction with our existing display and dither helpers. Their
individual complete-support windows and grouped 256-square windows both match
the original local scorer exactly. Groups use the first containing window on a
fixed 64-pixel grid, without quality selection. All thirteen cache setups are
included. Common source setup for those windows was 767.447ms; adding it to both
median totals would reduce the estimated saving to 20.2%.

**Amortization remains required.** The seven singleton groups are 26.3-41.3%
slower. The two-proposal groups are about 18-19% faster; groups with four to six
proposals improve 44-57%. A future selector must use the existing scorer for
singleton windows, based on its known proposal count, before adopting this
helper. No caller integration was attempted after the three-change bound.
The batch improvement does not establish an end-to-end encoder speed pass.

## Memory

Three fresh processes per path, input and cold/warm state; order alternates.
Warm processes run three batches and force two collections before the measured
baseline. Peak RSS is the OS process high-water mark, including warmup. Samples
also record RSS, external and ArrayBuffer memory before, during, retained and
after release. No claim is made that a boundary sample captures every temporary
allocation.

| Input/state | Base median peak RSS bytes | Candidate median peak RSS bytes | Ratio |
| --- | ---: | ---: | ---: |
| Photo cold | 170,348,544 | 162,623,488 | 0.954651 |
| Photo warm | 166,760,448 | 172,425,216 | 1.033969 |
| Texture cold | 163,295,232 | 161,845,248 | 0.991120 |
| Texture warm | 175,677,440 | 174,419,968 | 0.992842 |

All median comparisons remain within the 5% regression limit. RSS is noisy:
photo warm base ranges 162,578,432-176,201,728 bytes; candidate ranges
170,618,880-172,527,616. The retained ArrayBuffer increase is exactly 841,984
bytes in every case: copied control crop plus the two score maps. Source state
is shared. All warm baselines and post-release ArrayBuffer samples return to
20,151,391 bytes for both paths. The cache is bounded by the existing maximum 256-square output;
it adds no image-sized production buffer. This lab-process RSS check does not
replace the encoder's original-image managed-memory gate.

## Verification and unchanged qualification

Eleven focused tests pass, including odd dimensions, image borders, overlapping
independent proposals, outside-crop changes, caller mutation of the control,
whole-window changes before/after cache initialization, result independence and
invalid extents. Exact means identical Float64 map bytes, with no tolerance.
All timed runs validate outputs after timing. Existing component ports and the
old scorer have unchanged Git-base hashes. Strict private TypeScript passes.
Fresh `VITEST_MAX_WORKERS=4 npm run check` exits zero: 341 files and 4,234 tests
pass; one file and three tests are skipped. Static, package and browser build
checks pass. The thirteen-file archive reconstructs exactly. Final format,
module-identity and diff checks pass. Existing repository lint/large-file
warnings remain; no gates were changed.

Previous rejected encoder qualification remains unchanged:

| Full-development BD-rate | wasm-vips | jSquash |
| --- | ---: | ---: |
| SSIMULACRA2 | -10.184% | -12.333% |
| Butteraugli 3-norm | -4.810% | -1.230% |
| Butteraugli max | -4.548% | +3.116% |

Previous encoder speed: crops 2.387946x jSquash; 13 MP 39.546s, 1.512916x;
21 MP 68.866s, peer ratio unavailable because jSquash aborts. Managed originals
59,210,879/91,262,401 bytes remain below 137,514,476. Bundles remain
614,969/687,801 bytes; runtime dependencies zero. Historical holdout still has
two of ten admitted SSIM guards failing, worst +11.202599% versus +8.05%.
Zero full-band Butteraugli 3-norm admissions remain disclosed. No holdout data
was opened in this round. Peer-forcing cleanup still precedes any merge.

## Reproduction and next work

[The archive](LOCAL-STATE-REUSE.patch) restores thirteen first-party scripts,
configuration and superseded snapshots under
`.tmp/jpegxl-lossy-lab/local-state-20261104/`. It requires the existing frozen
development manifest, saved control PNGs and coefficient-intervention streams.
No peer encoder or new quality encode is needed.

```sh
git apply benchmark/jpegxl/lossy-lab/LOCAL-STATE-REUSE.patch
node --expose-gc .tmp/jpegxl-lossy-lab/local-state-20261104/measure.ts rerun im26-3012 21
node --expose-gc .tmp/jpegxl-lossy-lab/local-state-20261104/measure.ts rerun im26-3312 21
node --expose-gc .tmp/jpegxl-lossy-lab/local-state-20261104/measure.ts rerun-global im26-3012 21 global
node --expose-gc .tmp/jpegxl-lossy-lab/local-state-20261104/real.ts
node --expose-gc .tmp/jpegxl-lossy-lab/local-state-20261104/memory.ts rerun im26-3012 candidate warm 0
```

The bounded round ends here. Next hypotheses, in order: dispatch singleton and
repeated proposals using the actual selector schedule; add explicit SSIM
protection to the validated perceptual model; evaluate coherent DC/AC decisions
only after their full cost fits the existing speed allowance. None is qualified
or started by this report.
