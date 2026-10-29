# Second complete-map speed round

The three-change stack cuts prototype encode time by 10.064-10.699% against
`5888daeb` and lowers median prototype peak RSS by about 5.2%. Complete maps
are about 21% faster. All decisions and output bytes remain exact in the
completed checks. The prototype still takes 1.681-1.692 times the retained
control's time, above the unchanged 1.326079 allowance. Keep the diagnostic
improvements and archive the encoder policy. This bounded round ends without
another quality trial.

Research base: `5888daeb45e52d8283a01a803c7f9859ee53b5d3`, branch
`jxl-libjxl-ports`, 2026-10-28. Aaron authorized another bounded round after
the preceding complete-map checkpoint. We used the same three-change bound
and retained every quality, speed, memory and holdout gate.
The [JSON report](FULLMAP-SPEED-ROUND2-REPORT.json) contains raw timing samples,
memory readings, profiles, hashes and the carried quality evidence.

## Profile and three changes

Three warm complete-map encodes after three warmups attribute 14.406% of
self samples to directional scoring, 12.847% to Gaussian blur, 6.647% to
paired selector transforms and 6.186% to inverse-Gaborish block reads.
Profile samples guide the choices; their duration is not a timing result.

| Attempt | Change | Incremental map-time ratio, im26-3012 / im26-3312 | Faster pairs | Decision |
| --- | --- | ---: | ---: | --- |
| LL-1042 | Specialize fixed directional sums and reuse identical sums at their original positions | 0.781677 / 0.802558 | 22/22 | Keep speed gain |
| LL-1043 | Reuse existing Gaussian destination planes and remove discarded copies | 1.007649 / 1.000656 | 8/22 | Keep allocation reduction; time is neutral |
| LL-1044 | Retain only the horizontal rows needed for each vertical convolution | 0.989780 / 0.997812 | 12/22 | Keep allocation reduction; time is neutral |

Each comparison uses five warmups and eleven alternating pairs per photo.
The full-map workload includes source and decoded preparation at both scales,
quadratic and directional maps, and scale mixing. Inputs are the same frozen
source and decoded PNGs as the preceding round. No preparation is moved out
of the timed workload.

The specialized directional kernels preserve all 288 reference cases across
both bands, small and odd extents, cropped windows, weights and output sampling.
The Gaussian changes preserve all 192 prepared planes in each audit. Focused
fixtures cover scalar sum equality, in-place output, source preservation and
overlapping views with different offsets or element sizes. Such incompatible
overlap keeps the full intermediate to avoid overwriting unread input.

For a complete 512-square source/decoded map at two scales, destination reuse
avoids 36700160 bytes of requested temporary allocation and 20971520 bytes of
copies. The circular intermediate avoids another 60628992 allocated bytes.
The combined Gaussian allocation reduction is 97329152 bytes per workload.
These are allocation totals, not peak or retained memory. The largest normal
Gaussian intermediate falls from 2097152 to 135168 bytes. Other perceptual
planes remain full-sized.

## Combined timing and cost gate

The cumulative map ratios are 0.787941/0.789285 with all 22 pairs faster.
Neighboring local-map measurements use five warmups and 21 alternating pairs
per photo and window size, with source preparation outside both timed calls.
At 192 pixels the ratios are 0.782210/0.784407, with all 42 pairs faster.
At 32 pixels the ratios are 0.974010/0.969544, with 16/21 and 12/21 wins;
noise is substantial, so those small-window differences do not establish a
separate speed gain. All local maps are exact.

Encoder measurements use three warmups and seven alternating triplets per
photo at distance 2: retained control, the original complete-map prototype,
and the optimized prototype. Both prototypes reuse unchanged coefficients.
Every timed hash equals its independently scored prior stream. No quality
run, test suite or profiler overlaps the timing measurements.

| Photo | Control median | Original prototype | Optimized prototype | Optimized / original | Optimized / control |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-3012 | 1067.346 ms | 1987.812 ms | 1709.933 ms | 0.893007 | 1.691539 |
| im26-3312 | 1120.829 ms | 2040.418 ms | 1835.073 ms | 0.899361 | 1.680631 |

Ratios are medians of paired ratios. Optimized/original MAD is
0.027068/0.015504, with all 14 pairs faster. Optimized/control MAD is
0.098490/0.035838. Even the lowest optimized/control ratios,
1.581239/1.506994, exceed 1.326079. The prior 3.260791% mean quality gain
permits 32.60791% added time; the measured added time remains 68.063-69.154%.
No new quality trial is admitted.

## Memory and remaining cost

Three fresh processes per revision measure a cold encode and a warm encode
after three GC/event-loop cycles. Median prototype peak RSS is
292212736 bytes before and 277032960 after. Median cold peak is
273326080/266682368 bytes. Every process returns to 2067520 ArrayBuffer
bytes before and after its warm encode, with 15426980 external bytes after
GC. Managed peak stays 6964315 bytes. The complete-map-only workload has
median peak RSS 224862208/219365376 bytes and cold peak
219627520/203653120 bytes, with equal reclaimed buffers.

These are development prototype measurements. Perceptual buffers remain
outside the encoder's managed-memory ledger, and the prototype is restricted
to crops. The unchanged memory ceiling and original-image qualification
remain required before promotion.

The final warm profile puts Gaussian blur at 13.579%, inverse-Gaborish reads
at 6.979%, selector scoring at 6.652% and paired transforms at 6.321%.
The specialized low/high directional sums account for 4.077/2.580%.
The profile and ordinary timing agree that the directional change saves work;
buffer reuse mainly lowers allocation pressure. There is no fourth change
in this round.

## Quality and branch state

The following prior complete-map screen results are carried by exact stream
equality. No new native quality labels or peer decisions enter this round.

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| Retained control | +0.443% | -0.381% | -9.844% |
| wasm-vips effort 7 | -10.288% | -6.136% | -14.458% |
| jSquash effort 7 | -11.295% | -0.930% | -7.717% |

The fixed screen has 16 photos at five distances. Its 75 required-range
overlap omissions remain unchanged; these are screen results. The retained
encoder's full-development results remain -8.003/-5.030/-5.582% against
wasm-vips and -8.474/+0.227/+2.571% against jSquash. These are prior results.
The frozen holdout still has two failed SSIM regression guards, worst
+11.617%; identities remain unread. Main is unchanged and the research
branch is not ready to merge.

## Reproduction and verification

Raw evidence is under `.tmp/jpegxl-lossy-lab/fullmap-speed-round2-20261028`:
`base`, `h1-stack`, `h2-stack`, `h3-stack`, incremental timing directories,
`final-full`, `final-local`, encoder timing files, memory files, the two CPU
profiles, parity files, `native-windows` and `verification`. Harnesses include
`profile.ts`, `audit-directional.ts`, `audit-preparation.ts`, `compare-full.ts`,
`compare-h2.ts`, `compare-h3.ts`, `compare-local.ts`, `time-stack.ts`,
`memory-map.ts`, `memory-stack-r2.ts`, `audit-stack.ts` and `run-parity.ts`.
The first destination-reuse preparation audit passed its comparisons but
failed to create its output directory. The corrected auditor creates it and
the complete rerun passes; both logs are preserved.

`FULLMAP-SPEED-ROUND2-EXPERIMENT.patch` restores the measured prototype and
its earlier prerequisites against this retained checkpoint. Historical
archives remain unchanged at their recorded bases. Active changes are the
two perceptual diagnostic modules, Gaussian fixtures, provenance and reports.
Public codec source, encoder policy, dependencies and version are unchanged.

All 80 freshly selected complete-map streams reproduce the prior files
byte-for-byte. All 96 cached native-map window records are exact. The archive
applies and reverses successfully, and ten focused retained-tree tests pass.
`VITEST_MAX_WORKERS=4 npm run check` passes: 4210 tests, three existing skips,
338 passed files and one skipped. The test phase takes 539.80s and the full
command 582.887s. All static gates, including `browser:check`, pass. Bundles
remain 614969/687801 minified bytes, dependencies zero and version 0.17.0.
