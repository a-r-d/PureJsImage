# Third complete-map speed round: Gaussian convolution

Two retained Gaussian changes make complete maps 15.724-17.530% faster and
the complete-map encoder prototype 3.002-3.395% faster against `165224cc`.
The third change is reverted because it slows maps by about 21%.
The prototype still takes 1.588-1.670 times retained-control time, above the
unchanged 1.326079 allowance. This bounded round ends without a new quality trial.

Research base: `165224cc5ecbe7958dbfa69e7e7132d848a19777`, branch
`jxl-libjxl-ports`, 2026-10-28. Aaron authorized another bounded round focused
on Gaussian blur. We used the previous three-change bound and kept every
quality, speed, memory, holdout and promotion gate. The
[JSON report](FULLMAP-SPEED-ROUND3-REPORT.json) contains raw samples and hashes.

## Profile and changes

Three warm complete-map encodes after three warmups put Gaussian blur at
12.838% of total self samples. Horizontal multiply/adds dominate its sampled
lines, followed by vertical convolution and tap/index traversal. Plan
construction is not a leading cost. Profiles guide experiments; their duration
is not a timing measurement.

| Attempt | Change | Incremental map ratio, im26-3012 / im26-3312 | Faster pairs | Verdict |
| --- | --- | ---: | ---: | --- |
| LL-1047 | Share coefficients and row indices over eight output pixels instead of four | 0.939288 / 0.928947 | 19/22 | Keep |
| LL-1048 | Reuse horizontal samples shared by adjacent taps | 0.891055 / 0.884194 | 22/22 | Keep |
| LL-1049 | Accumulate vertical taps across whole output rows | 1.215769 / 1.213565 | 0/22 | Revert |

Each comparison uses five warmups and eleven alternating pairs per photo.
Each prepared-plane audit checks 192 planes exactly. Scalar-reference fixtures
cover Float32/Float64 inputs, tiny and odd extents, eight-pixel group boundaries,
ring wrap, normalized borders, in-place destinations and incompatible overlapping
views. All full maps remain exact, including the rejected trial.

Horizontal sample reuse reduces input loads for an interior eight-output group
from `8 * taps` to `taps + 7`. For the 33-tap kernel this is 264 loads reduced
to 40. Each output keeps its original addition order. Array shapes, buffer
lifetimes, the bounded intermediate and the overlapping-view fallback are
unchanged. The rejected vertical traversal adds output-array traffic per tap;
its slower result is preserved in a separate patch.

## Cumulative map and encoder timing

The complete-map workload includes source and decoded preparation at both
scales, quadratic and directional maps, and scale mixing. Nothing moves outside
the timed operation. Eleven alternating pairs per photo give ratios
0.842758/0.824704, MAD 0.009527/0.011791, with 21/22 faster. The first photo
has one slow candidate outlier; all samples are retained.

Neighboring local windows use source preparation outside both timed calls,
five warmups and 21 alternating pairs each. At 32 pixels, ratios are
0.883848/0.873079 with 18/21 and 21/21 wins. At 192 pixels they are
0.856812/0.858746 with all 42 pairs faster. All local map hashes are exact.

The initial seven-triplet encoder run was noisy: optimized/original ratios
were 0.879334 on im26-3012 and 1.005022 on im26-3312. The latter ranged from
0.818364 to 1.212612. We preserve that run and use a longer confirmation for
the final estimate. The repeated protocol keeps three warmups and uses fifteen
alternating triplets per photo at distance 2. Each triplet contains retained
control, the Git-base prototype and the optimized prototype. Both prototypes
reuse unchanged coefficients. All timed hashes equal the independently scored
prior streams. No other research CPU job overlaps timing.

| Photo | Control median | Base prototype median | Optimized median | Optimized / base | Optimized / control |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-3012 | 1044.138 ms | 1724.177 ms | 1679.448 ms | 0.969983 | 1.669968 |
| im26-3312 | 1107.403 ms | 1825.160 ms | 1763.191 ms | 0.966047 | 1.588474 |

Ratios are medians of paired ratios. Optimized/base MAD is 0.024434/0.021770;
12/15 and 13/15 pairs are faster. Optimized/control MAD is 0.028676/0.039545.
Even the minimum control ratios, 1.566669/1.386906, exceed 1.326079.
The prior 3.260791% mean quality gain permits 32.60791% added time; confirmed
added time remains 58.847-66.997%. The cost gate fails.

## Memory and remaining work

The final three fresh child processes per revision give median encoder peak
RSS 269680640/265867264 bytes, a 1.414% decrease, and cold peak
266989568/255823872 bytes. Every pre-warm and post-warm reading has 2067520
ArrayBuffer bytes, 15428081 external bytes after collection and managed peak
6964315 bytes. These results satisfy the diagnostic non-regression guard;
they do not establish a separate material memory win. Map-only peak RSS is
217337856/217608192 bytes (+0.124%), with equal reclaimed buffers.

The initial three-cycle protocol left an extra 2080333 buffer bytes after one
warm encode. Twelve GC/event-loop cycles show those transient buffers clearing
by cycle two in both revisions. That follow-up also found one resourceUsage
peak counter of 989945856 bytes already present before encoding, despite
130506752 bytes current RSS and 127924 KiB in `/proc` high water. We preserve
that run and do not use its contaminated peak counter. The final launcher
creates fresh Node children and verifies agreement between the pre-encode RSS
and high-water readings. Both original memory runs and every reclamation trace
remain in the JSON report. No memory ceiling changes.

Perceptual buffers remain outside the encoder's managed ledger. Original-image
memory qualification remains required before any promotion of this policy.

The retained-stack profile puts blur at 9.502% of total self samples. Vertical
multiply/adds and their tap/index traversal now dominate its remaining lines;
horizontal cost concentrates in the tap loop and new-sample load. Paired
selector transforms account for 7.551%, Gaborish reads 7.219%.

Remaining Gaussian ideas, in order, are fixed-tap vertical specialization,
partial unrolling of the horizontal tap loop, and sharing convolution plans
within one image preparation. The last has low expected upside because plan
construction is not prominent. No fourth change is attempted. On the profiled
photo, even removing all measured blur cost suggests about 1.51 times control,
still above the allowance; this is only a profile-based estimate. A larger
remaining cost reduction would need work beyond Gaussian blur.

## Quality and branch state

These prior complete-map screen results are carried only by exact stream
equality. No new native quality labels or peer decisions enter the round.

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| Retained control | +0.443% | -0.381% | -9.844% |
| wasm-vips effort 7 | -10.288% | -6.136% | -14.458% |
| jSquash effort 7 | -11.295% | -0.930% | -7.717% |

The screen has 16 photos at five distances; its 75 required-range overlap
omissions are unchanged. Retained encoder full-development results remain
-8.003/-5.030/-5.582% against wasm-vips and -8.474/+0.227/+2.571% against
jSquash. These are prior results. Its frozen crop speed remains 2.635783 times
jSquash; the 13 MP original is 41.894s and 1.698729 times jSquash. Managed
peaks remain 8760382/59139199/91010461 bytes for crops/13 MP/21 MP, below
137514476. These retained-encoder qualifications do not qualify the archived
complete-map policy or its unaccounted perceptual buffers.

The frozen holdout still has two failed SSIM regression guards, worst +11.617%;
identities remain unread. Main is unchanged and the branch is not ready to merge.

## Reproduction and verification

Raw evidence lives under `.tmp/jpegxl-lossy-lab/fullmap-speed-round3-20261028`.
`profile.ts`, `profile-h2.ts` and `blur-lines*.ts` produce the profile evidence.
`compare-full.ts`, `compare-h2.ts`, `compare-h3.ts` and `compare-local.ts`
produce map timing. `time-stack.ts` preserves the noisy first encoder run;
`time-confirm.ts` produces the fifteen-triplet confirmation. `memory-stack-r2.ts`
and `memory-map.ts` measure cold and reclaimed-warm memory in fresh processes.
`audit-preparation.ts` and `run-parity.ts` check exact planes and selected streams.

`FULLMAP-SPEED-ROUND3-EXPERIMENT.patch` restores the measured prototype and
earlier prerequisites against the retained checkpoint.
`FULLMAP-GAUSSIAN-VERTICAL-EXPERIMENT.patch` layers the rejected vertical
traversal on that prototype. Historical archives remain unchanged.
Active changes are the Gaussian diagnostic, its fixtures, provenance and reports.
Public codec source, encoder policy, dependencies and version remain unchanged.

For a complete-map timing replay from the repository root, using the saved
base modules and frozen inputs:

```sh
node --expose-gc .tmp/jpegxl-lossy-lab/fullmap-speed-round3-20261028/compare-full.ts .tmp/jpegxl-lossy-lab/fullmap-speed-round3-20261028/reproduction im26-3012
node --expose-gc .tmp/jpegxl-lossy-lab/fullmap-speed-round3-20261028/compare-full.ts .tmp/jpegxl-lossy-lab/fullmap-speed-round3-20261028/reproduction im26-3312
```

Those map commands work on the retained tree. Encoder harnesses require the
complete-map archive to be applied first; retain their existing evidence files
before rerunning them. Run `VITEST_MAX_WORKERS=4 npm run check` after reversing
the archive to validate the retained tree.

All 80 freshly selected streams are byte-identical to their prior files, and
all 96 cached native-window records are exact. Both new archives apply and
reverse successfully. Final retained-tree `VITEST_MAX_WORKERS=4 npm run check`
passes: 4210 tests, three existing skips, 338 passed files and one skipped.
Test phase 622.37s; full command 665.860s. All static gates, including
`browser:check`, pass. Bundles remain 614969/687801 minified bytes, runtime
dependencies zero and version 0.17.0.
