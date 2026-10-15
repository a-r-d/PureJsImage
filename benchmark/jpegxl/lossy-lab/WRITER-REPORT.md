# Selector cost and speed investigation

Research base `ef651e29` on `jxl-libjxl-ports`. Aaron reopened development
research after the two holdout guards failed. This continuation uses development
photos only. The holdout is not rerun or inspected, and promotion thresholds stay
unchanged. Main and the public encoder are unchanged.

## Cost estimates

The source selector estimates costs before final field rounding, with nearest
integer coefficient rounding and unscaled chroma matrices. Our writer uses the
adjusted integer field and rate-aware coefficient rounding. Six screens test
these differences and the selector's information-loss weight. Each uses the
same 16 development photos and five frozen distances, with 80 valid outputs.
All other decisions remain those of `standalone-guard-bounded`.

Mean BD-rate, ordered SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max:

| Experiment | vs wasm-vips | vs jSquash | vs retained mode |
| --- | --- | --- | --- |
| Final quantization field | -10.531 / -5.492 / -4.046% | -11.430 / +0.346 / +3.262% | +0.233 / +0.067 / -0.809% |
| Writer rounding | -10.650 / -5.395 / -4.418% | -11.659 / +0.391 / +2.900% | +0.099 / +0.206 / -1.141% |
| Chroma matrix scales | -10.735 / -5.560 / -3.219% | -11.650 / +0.302 / +4.120% | 0 / 0 / 0% |
| All three estimates | -10.560 / -5.272 / -3.231% | -11.486 / +0.555 / +4.086% | +0.205 / +0.335 / +0.039% |
| Loss weight x0.75 | -10.719 / -5.638 / -2.465% | -11.498 / +0.368 / +5.195% | +0.086 / -0.048 / +0.978% |
| Loss weight x1.25 | -10.206 / -5.216 / -4.384% | -11.198 / +0.581 / +2.881% | +0.544 / +0.343 / -1.117% |

Matching the writer more closely does not improve the aggregate balance. The
matrix-only experiment produces identical bytes for all 80 points. The rounding
experiment improves the known dark-grain development image im26-2004 by 2.224%
on SSIM, so it proceeds to the full development lab to check whether that benefit
holds across the corpus. Neither loss-weight adjustment is selected.

The rounding variant completes all 576 full-lab outputs. Against vips it measures
-8.282 / -4.824 / -5.214%; against jSquash, -8.778 / +0.605 / +2.846%.
Relative to the retained mode, SSIM improves 0.236% and 3-norm improves 0.105%,
while maximum-error BD-rate worsens 0.415%. The average of these paired changes
is a 0.025% regression. Its improvement is not an overall quality win.

All eight admitted development SSIM guards pass; no 3-norm comparison covers its
full required band. The im26-2004 SSIM regression against production falls from
6.756% to 3.669%, and im26-3302 falls from 7.677% to 7.178%. The worst partial
maximum-error regression against production grows from 27.556% to 37.561% on
im26-3000. These are development results only.

Fifteen isolated alternating timing pairs on im26-3012/d2 measure a 12.889%
median slowdown for actual writer rounding, with zero faster pairs. Median time
rises from 1168.212 to 1315.351 ms. The small SSIM/3-norm gains do not pay for this
cost under the speed rule, and the three-metric mean worsens slightly. Reject
the rounding adaptation for effort 7. The named development modes remain for
reproduction; none of the six quality alternatives replaces the retained mode.

Bitstream inspection on those three development images at four distances finds
unchanged DC parameters and filter maps. At distance 1.85 on im26-2004, rounding
changes 2,127 of 4,096 strategy cells: DCT32 coverage grows from 1,296 to 2,512
cells. On im26-3000 at distance 0.9, DCT32 coverage grows from 1,616 to 2,112.
The more accurate rounding model therefore changes transform allocation
substantially; increasing large-transform coverage helps grain but does not
provide a uniform quality improvement. `strategy-audit.json` preserves all
twelve comparisons without consuming peer decisions.

## Exact transform optimization

The existing profile attributes 234.5 ms of self time to the symmetric forward
selector transform. That transform recalculates each mirrored pixel sum for
every frequency. `forwardPairedSelectorTransform` computes each sum once per
row or column and reuses it. Dot products retain their arithmetic order, with
512 bytes of additional scratch and no increase in measured managed peak.

| Isolated alternating pairs at distance 2 | Previous median | Candidate median | Paired median change | Wins |
| --- | ---: | ---: | ---: | ---: |
| im26-3012, 15 pairs | 1153.023 ms | 1098.774 ms | -4.880% | 13/15 |
| im26-3312, 15 pairs | 1286.271 ms | 1212.189 ms | -5.194% | 13/15 |

All measured streams match byte for byte. Paired median absolute deviations are
1.926 and 4.497 percentage points; raw samples and other noise statistics remain
available. The neighboring flat texture confirms the gain despite timing noise.
The retained speed mode is `standalone-selector-pairs`.

Fresh isolated timing covers all 64 crops and 192 engine jobs, with no failures
or omissions. Own median is 1390.868 ms, jSquash 485.562 ms, and vips 336.868 ms.
The **2.864447x jSquash** ratio passes the 3x target, compared with the prior
2.994898x result. Own p90 is 1443.479 ms and worst is 1513.703 ms. Managed peak
is unchanged at 8,735,786 bytes; formal process peak RSS is 207,388,672 bytes.
The run takes 268.855 seconds with one worker and no concurrent CPU tests or
benchmarks. The paired tests above establish the speed gain independently of
the two corpus runs' different measurement times.

## Full verification

All 576 full-development streams from the faster transform are byte-identical
to the retained mode. Its vips result remains -8.090 / -4.730 / -5.575%, and its
jSquash result remains -8.553 / +0.770 / +2.537%. Managed peak remains 9,232,573
bytes. The independent native/jxl-rs qualification from LL-729 applies to these
identical streams. Quality-run timing is excluded because the two lab runs and
repository verification share the host.

The 13 MP original at distance 2 completes in 47.942 seconds, compared with
jSquash at 25.891 seconds and vips at 9.359 seconds. The ratio is 1.852x jSquash,
inside the 5x target. Its 1,835,008-byte stream matches the previous candidate
exactly. Managed peak remains 59,071,615 bytes. Encoder-receipt RSS is
402,812,928 bytes, versus the previous 405,594,112. The whole worker, including
subsequent validation and scoring, peaks at 556,003,328 bytes, versus the previous
543,997,952. Both stages are recorded separately. Native decoding and all three
scores pass. This single-original measurement
does not qualify the full watch set. The 21 MP original is not rerun here.
The 72 focused cases pass, including exact transform coefficients across all 21
supported development transforms, thin images, tile edges and three distances.
Updated Node/browser receipts agree in Chromium, Firefox and WebKit.
All 576 rounding-variant streams independently decode in jxl-rs within one code
value of native libjxl as well.

`VITEST_MAX_WORKERS=2 npm run check` passes all static, package, documentation,
browser-build and test gates: 4,125 tests pass, with three existing skips. Test
duration is 1,029.96 seconds. No timeout or assertion changes are made. JPEG XL
generic and specialized bundles remain 614,941 and 687,773 bytes under unchanged
ceilings, with no runtime dependencies.

A fresh diagnostic profile after the DCT change finds selector scoring at
236.2 ms, paired forward transforms at 166.3 ms, and inverse transforms at
156.1 ms of sampled self time. These concurrent profile times do not measure a
speed delta. The direct profile launcher reports the same roughly 2.7 GB RSS
anomaly seen in the earlier investigation; formal worker receipts are used for
memory comparisons.

Experiments LL-730 onward are recorded in `../lossy-lab-log.md`. Raw evidence is
under `.tmp/jpegxl-lossy-lab/standalone-writer-20261014/`. The historical
[guard report](GUARD-REPORT.md) remains unchanged. These modules are development
experiments with no peer maps or runtime dependencies. Source attribution and
first-party adaptations are recorded in `../PROVENANCE.md`.

The two previously recorded holdout SSIM guard failures still block promotion.
This continuation retains a speed improvement with unchanged compression; it
does not claim to repair those failures. Full watch/scale qualification and
public-path integration remain pending. Peer-forcing hooks must be removed or
isolated before any main merge.

## Reproduction

Run from the repository root. Use fresh output directories and keep speed runs
isolated from tests and other CPU benchmarks.

```sh
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/reproduce-paired-lab --mode lab --variant standalone-selector-pairs --workers 4 --strategy-port standalone-selector-pairs
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/reproduce-paired-speed --mode speed --variant standalone-selector-pairs --workers 1 --strategy-port standalone-selector-pairs
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/watch-v2/manifest.json --out .tmp/jpegxl-lossy-lab/reproduce-paired-original --mode speed --variant standalone-selector-pairs --workers 1 --strategy-port standalone-selector-pairs --only im26-2004
VITEST_MAX_WORKERS=2 npm run check
npx playwright test browser-tests/jpegxl-decision-transplant.pw.ts --workers 1
```

[Machine-readable evidence](WRITER-REPORT.json) records the six screens, both
full development runs, paired measurements, fresh corpus timing and checks.
