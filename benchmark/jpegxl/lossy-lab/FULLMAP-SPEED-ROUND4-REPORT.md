# Fourth complete-map speed round: incremental cost audit

Two retained changes make complete perceptual maps 5.1-5.2% faster and avoid
29,332,480 bytes of temporary allocation requests per two-scale map. Encoder
timing shows a smaller, noisier 1.1-3.0% paired improvement. The prototype still
takes 1.574-1.631 times control, above the unchanged 1.326079 allowance.
The approved three-change round ends without a new quality trial.

Base: `2694cd7318a51156ead83b98c72387776560c97e`, branch `jxl-libjxl-ports`,
2026-10-29. Aaron approved attribution of control versus incremental costs,
then at most three changes preserving exact output. All quality, absolute
speed, memory, holdout and promotion gates remain unchanged.
[The JSON report](FULLMAP-SPEED-ROUND4-REPORT.json) preserves samples,
hashes, profiles, attribution and reclamation traces.

## Where the extra time goes

Seven alternating instrumented pairs follow three warmups per crop at distance
2. Separate three-encode CPU profiles cover control and candidate. These
measurements attribute work; they do not qualify speed.

| Stage, median milliseconds | im26-3012 | im26-3312 |
| --- | ---: | ---: |
| Control selector | 696.210 | 825.985 |
| Candidate selector | 685.553 | 820.620 |
| Added refinement, total | 676.032 | 659.338 |
| Display reconstruction | 158.851 | 143.861 |
| Fine/half source and decoded preparation, sum of stage medians | 297.336 | 295.478 |
| Directional maps, sum of stage medians | 138.715 | 135.948 |
| Quadratic maps, sum of stage medians | 34.643 | 37.409 |
| Coefficient rebuild | 28.922 | 25.375 |

The selector costs are similar in control and candidate. Most added work is
preparation, directional scoring and display reconstruction. The sampled
quadratic lines repeatedly look up channels and weights. Preparation also
spends time selecting neighboring mask values. Gaussian blur is still 9.818%
of candidate self samples, but it is only part of the incremental cost.

## Three attempts

| Attempt | Change | Incremental map ratio, im26-3012 / im26-3312 | Decision |
| --- | --- | ---: | --- |
| LL-1052 | Hoist fixed channel references and specialize quadratic scoring, preserving additions | 0.946083 / 0.949030 | Keep; all 22 pairs faster |
| LL-1053 | Reuse padded directional scratch and accumulate costs directly | 1.002527 / 0.965702 | Keep for allocation reduction; timing is modest and mixed |
| LL-1054 | Unroll interior mask neighbors, preserving the border loop | 1.001084 / 0.979022 | Revert; only 12/22 pairs faster |

Each initial comparison uses five warmups and eleven alternating pairs per
photo. LL-1053 first wins 15/22 pairs. A 21-pair follow-up on im26-3012 is noisy:
ratio 1.021342, MAD 0.038764, base CV 0.235, only 6/21 faster. A second complete
follow-up gives 0.980575, MAD 0.015544 and 16/21 faster. Both runs, including
stalls, remain in the report. They do not establish a large speed gain.

Directional reuse removes six temporary result planes, five padded planes and
six separate cost-accumulation passes per scale. The 512/256-pixel scales avoid
29,332,480 requested allocation bytes in total. Each band's padded support is
fully rewritten; zero borders and cost addition order stay intact. All three
quadratic outputs remain available. No constants, thresholds or precision change.

## Final timing and memory

Complete maps include source and decoded preparation at both scales, quadratic
and directional scoring, and mixing. Eleven alternating pairs give ratios
0.948868/0.947853, MAD 0.005398/0.009244, with all 22 pairs faster. Medians are
463.811 to 439.403 ms and 467.935 to 440.221 ms.

Neighboring windows use source preparation outside both timed calls and 21
alternating pairs. The 192-pixel ratios are 0.950383/0.948806, with 40/42 pairs
faster. The 32-pixel ratios are 0.988120/1.001421, with 24/42 faster. Small-window
timing is neutral and noisy. All map hashes are exact.

The encoder confirmation uses three warmups and fifteen alternating triplets
per photo. Each triplet contains control, the base prototype and the optimized
prototype. No other research CPU job overlaps timing.

| Photo | Control median | Base prototype median | Optimized median | Optimized / base | Optimized / control |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-3012 | 1057.812 ms | 1747.296 ms | 1648.370 ms | 0.988962 | 1.631404 |
| im26-3312 | 1101.966 ms | 1754.693 ms | 1717.603 ms | 0.970382 | 1.574439 |

Ratios are medians of paired ratios, not ratios of the displayed medians.
Optimized/base MAD is 0.020336/0.028210, with 9/15 and 11/15 wins. This is
weaker evidence than the map timing. Even the minimum optimized/control ratios,
1.472548/1.500470, exceed 1.326079. The cost gate fails.

Three fresh child processes per revision measure cold and reclaimed-warm
memory on im26-3012 at distance 2. Median peak RSS is 268722176 to 272900096 bytes (+1.555%); cold peak is
265453568 to 267948032 bytes. This passes the unchanged 5% diagnostic
non-regression guard and does not demonstrate an RSS reduction. All reclaimed
pre/post-warm buffer readings are 2067520 bytes, external memory is 15428081
bytes and managed peak is 6964315 bytes. Twelve GC/event-loop cycles expose
transient buffers; they clear by the second cycle. Initial resource counters
agree with current RSS and the process's own high-water readings.

Perceptual allocations remain outside the encoder's managed ledger. These
crop measurements do not qualify the policy for original-image memory or
absolute speed promotion.

## Quality, verification and branch state

All 80 freshly selected streams equal the prior scored streams, all 96 cached
native-window records remain exact, all 288 directional boundary/window/grid
cases match, and the rejected mask trial preserves all 192 prepared planes.
Pinned fixtures cover quadratic sign reversal, asymmetric penalty bounds,
six-band accumulation and repeated border windows.

The following quality numbers are carried by exact stream equality. No new
native quality labels, peer decisions or holdout results enter this round.

| Reference, prior complete-map screen | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| Retained control | +0.443% | -0.381% | -9.844% |
| wasm-vips effort 7 | -10.288% | -6.136% | -14.458% |
| jSquash effort 7 | -11.295% | -0.930% | -7.717% |

The screen has 16 photos at five distances and 75 unchanged required-range
overlap omissions. Retained standalone full-development results remain
-8.003/-5.030/-5.582% against vips and -8.474/+0.227/+2.571% against jSquash.
Its frozen crop speed is 2.635783 times jSquash; the 13 MP original takes 41.894s,
1.698729 times jSquash. Managed peaks remain 8760382/59139199/91010461 bytes,
below 137514476. Those prior qualifications do not qualify the archived policy.

The frozen holdout still has two failed SSIM guards, worst +11.617%; identities
remain unread. Main and public codec source are unchanged in this round.
The branch is not ready to merge.

`VITEST_MAX_WORKERS=4 npm run check` passes on the retained tree: 4212 tests,
three existing skips, 339 passed test files and one skipped. The test phase takes
508.84s; the full check takes 551.157s. All static checks, including browser
checks, pass. Bundles remain 614969/687801 minified bytes, runtime dependencies
remain zero and the package version remains 0.17.0. Both experiment archives
apply and reverse cleanly. An independent report audit verifies all scored
stream hashes, source hashes, paired ratios and the memory non-regression guard.

## Reproduction and remaining work

Raw evidence is in `.tmp/jpegxl-lossy-lab/fullmap-speed-round4-20261029`.
`attribute.ts` separates coarse stages and records control/candidate profiles.
`compare-full.ts`, `compare-h2.ts`, `compare-h2-confirm.ts`, `compare-h3.ts`
and `compare-local.ts` reproduce map comparisons. `time-confirm.ts` measures
the three encoder modes. `run-memory.ts` launches fresh memory processes;
`run-parity.ts` verifies all 80 streams. The input manifest hashes are checked
before each photographic measurement. Full profiles and raw logs stay local;
all numerical results needed for review are included in the JSON report.

`FULLMAP-SPEED-ROUND4-EXPERIMENT.patch` restores the measured prototype against
this checkpoint. `FULLMAP-INTERIOR-MASK-EXPERIMENT.patch` then restores the
rejected mask trial. Worker hooks, coefficient reuse and the quantization trial
remain archived. Retained files contain only the two diagnostic changes,
focused fixtures, provenance and reports.

Final stage attribution still spends about 288 ms in preparation, 129 ms in
directional maps and 150 ms reconstructing the display; quadratic scoring is
about 21 ms and rebuild 22 ms. Those diagnostic stage medians show why the
remaining cost is larger than the work removed by this round.

The three-attempt allowance is exhausted. The remaining relative cost requires
about another 16-19% reduction in total candidate time, or roughly 43-48% of its
added cost, to reach the existing allowance. Further work needs a new owner
decision. No quality trial, full lab, holdout rerun, promotion or main merge
was started.
