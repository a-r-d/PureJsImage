# Selected-block quantization follow-up

The corrected selected-block pass improves all three full-development means.
Its eight admitted main-relative development SSIM guards pass, worst +4.752%.
Holdout still fails two SSIM guards, worst +10.090%. The branch is not ready
to merge. All three approved configurations are evaluated and archived.
Active implementation and tests match the starting checkpoint.

Aaron approved at most three coherent source-based configurations on 2026-11-03,
following the previous plateau stop. Base:
`3d61db6bc6fba32c2601e2056c9a366fde460018` on `jxl-libjxl-ports`.
Raw evidence: `.tmp/jpegxl-lossy-lab/block-quantization-20261103/`.
The [JSON report](BLOCK-QUANTIZATION-REPORT.json) preserves distributions,
coverage, source hashes, paired timings, memory and aggregate holdout results.

## Configuration 1

Port libjxl v0.12.0 `lib/jxl/enc_group.cc` selected-block quantizer adjustment
and quadrant dead zones together. Each channel proposes a raw quantizer; the
writer takes the maximum, keeps the luma thresholds, reconstructs quantized
luma, then forms and quantizes chroma residuals. The source revision is
`a7a9c787341cf703dede03c2009fa460cae5e5df`.

The scalar TypeScript adaptation uses our physical matrix steps and double
precision. It restores native B from our B-Y working plane, retains separate
DC handling and clamps final raw precision to the decoder's 1..256 range.
Scratch is 20 doubles per rewrite, independent of image area; the two static
coefficient tables contain 192 bytes. No peer decisions enter this mode.

The source file and full LICENSE match the pinned source archive exactly.
Nineteen focused port tests and twelve repeatable thin, odd and tile-edge
encodes pass. Nine saved-stream checks confirm unchanged transform choices,
DC settings, CfL maps, filtering and chroma scales.

## Development quality

Percentages are mean BD-rates, ordered SSIMULACRA2 / Butteraugli 3-norm /
Butteraugli max. Negative is better. The screen uses 16 photos and five
distances; the full lab uses 64 photos and nine distances.

| Evaluation | vs regularized control | vs vips | vs jSquash |
| --- | --- | --- | --- |
| Corrected screen, 80 native-valid outputs | -0.674 / -1.050 / -0.115 | -11.374 / -6.602 / -6.572 | -12.367 / -1.690 / +0.551 |
| Corrected full lab, 576 native-valid outputs | -0.585 / -1.017 / -0.982 | -8.755 / -6.039 / -6.510 | -9.268 / -1.129 / +1.466 |
| Coupled selector screen, 80 native-valid outputs | -0.350 / -0.665 / +0.106 | -11.049 / -6.249 / -6.418 | -12.064 / -1.319 / +0.811 |
| Coupled selector full lab, 576 native-valid outputs | -0.249 / -0.650 / -0.149 | -8.432 / -5.689 / -5.741 | -8.948 / -0.745 / +2.307 |
| Source-proxy screen, 80 native-valid outputs | -0.564 / -1.037 / +1.535 | -11.213 / -6.593 / -5.199 | -12.029 / -1.295 / +2.026 |

The full-lab mean gain against regularized is 0.861298%. Main-relative means
are -7.952 / -11.199 / -10.420%. All eight admitted SSIM guards pass; their
worst value falls from +7.579% to +4.752%. No 3-norm comparison spans its full
required band, so there are no admitted per-image 3-norm guards.

Means do not describe every development image. Worst paired regressions
against regularized are +3.274 / +2.052 / +13.472%; the SSIM worst has partial
band coverage. The grain example's max-error regression remains visible in
the screen. These results do not establish holdout success.

## Speed and remaining qualification

Fifteen isolated alternating pairs per profiling crop give writer/control
ratios 0.998452 on the photo and 1.004300 on the texture. Ratio MADs are
0.032464 and 0.036958; the candidate wins 8/15 and 6/15 pairs. This supports
the 1.086130 added-time allowance from the measured quality gain, without a
speedup claim. Repeated streams match the scored screen outputs exactly.

Fresh absolute crop timing completes all 192 engine jobs without reuse or
failures: 2.316028x jSquash. The 13 MP original takes 36.806 seconds, 1.502028x
jSquash, with managed peak 59,141,263 bytes. The 21 MP original takes 58.224
seconds with managed peak 91,084,189 bytes; jSquash aborts, so its ratio is
unavailable. Both own originals pass native decoding and scoring and stay
under the unchanged 137,514,476-byte managed ceiling.

These are entry measurements. Full cold/warm RSS and reclamation checks,
the complete watch/scale runs and final independent-decoder promotion checks
remain unqualified because the next holdout gate fails.

The frozen holdout run completes 567 native-valid outputs and all 189 engine
jobs. Vips-relative means are -6.512 / -4.239 / -3.762%, mean -4.838%.
jSquash-relative means are -7.021 / +0.737 / +1.819%. Main-relative means are
-5.966 / -8.981 / -8.839%. Two of nine admitted SSIM guards fail, worst
+10.090%, improved from the prior +12.173% but above the +8.05% limit. No
3-norm comparison has full required-band coverage. Managed peak is 26,046,019
bytes. Only aggregates were inspected; no holdout identity or curve guided
the next configuration.

Promotion is rejected. Watch/scale, independent-decoder promotion checks and
public integration do not follow this failed holdout. Public encoder behavior
is unchanged.

## Preserved correction and next configuration

The first implementation assigned the 32x16 error-weight row to 16x8 transform
IDs. Its screen completed, but those numbers are invalid evidence for the
intended source port. The initial full lab was interrupted. Both raw runs and
the original prototype are preserved. Four shape-specific tests catch the
mapping error; the corrected screen and full lab use fresh outputs.

Configuration 2 makes the selector evaluate the same final quantizer, native
thresholds and reconstructed-luma chroma residuals before choosing a transform.
Its implementation and initial twelve fixture checks preceded the first
configuration's holdout result. Its full-lab averages and worst admitted
development SSIM guard (+5.996%) are weaker than configuration 1. Fifteen
isolated pairs per profiling crop give ratios 1.189254 and 1.105069 against
regularized, above its 1.034924 quality-based allowance. Ratio MADs are
0.035328 and 0.026551; only 0/15 and 1/15 pairs favor the candidate. Reject
this mode without holdout qualification.

Configuration 3 restores the existing ported source selector proxy before
the native selected-block writer pass. It keeps the current allocation,
filters, transforms and bounded storage; only the selector's rate-aware
rounding and half-strength detail adaptation are removed. No new numerical
weights are fitted. Its twelve fixture checks and promotion-denial checks
pass. Its max regression and negligible three-metric mean gain do not justify
a full lab. A speed-only claim would fail the unchanged +/-0.2% quality rule.
This is the third and final authorized configuration.

## Preservation and stop

The corrected evaluations produce 1,392 native-valid development outputs.
One frozen holdout adds 567. The invalid first screen and interrupted first
lab are preserved separately and contribute no qualification evidence.

Four independent patches apply to the base revision and exactly reconstruct
24 prototype modules. Each corrected patch also restores the 19-test port
suite, for 27 verified file reconstructions in total:
[invalid initial mapping](BLOCK-QUANTIZATION-WRITER-EXPERIMENT.patch),
[corrected selected-block writer](BLOCK-QUANTIZATION-WRITER-V2-EXPERIMENT.patch),
[coupled selector](BLOCK-QUANTIZATION-SELECTOR-EXPERIMENT.patch), and
[source selection proxy](BLOCK-QUANTIZATION-NATIVE-PROXY-EXPERIMENT.patch).
Apply one patch in an isolated checkout; these are alternative research
snapshots, not an additive stack or public encoder changes.
Archive normalization rewrites import paths and adds the writer's attribution
header; it does not change executable statements.

The normal runner reproduces each patched mode with the existing
`corpus-512-v2/manifest.json`, `--mode screen` or `--mode lab`, four workers,
and matching `--variant` and `--strategy-port` values:
`standalone-block-quantization`, `standalone-block-selector`, or
`standalone-block-native-proxy`. Use a fresh output directory. The archived
patches do not grant promotion access; that requires the entry checks again.

For example, after applying the corrected writer patch to the base checkout:

```sh
node benchmark/jpegxl/lossy-lab/run.ts \
  --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json \
  --out .tmp/jpegxl-lossy-lab/reproduce-block-writer-screen \
  --mode screen --workers 4 --budget-seconds 1800 \
  --variant standalone-block-quantization \
  --strategy-port standalone-block-quantization
```

For the full lab, use `--mode lab`, a fresh output directory and
`--budget-seconds 7200`. Other configurations use their matching names above.

Nineteen port tests, 36 repeatable fixture cases, promotion-fence checks and
strict experimental TypeScript pass. Fresh `VITEST_MAX_WORKERS=4 npm run check`
passes, including browser build checks: 4,229 tests pass and three existing
tests remain skipped. All 340 active test files pass; one file is skipped.
Bundle sizes remain 614,969 bytes for the codec and 687,801 for the specialized
entry, with zero runtime dependencies. Public source, package metadata and
release state are unchanged.

The bounded approval is exhausted. No new quality policy is retained. Ranked
remaining hypotheses, with no measured benefit claim:

1. Revisit existing DC/AC allocation controls while freezing the corrected
   selected-block pass. It raises mean leader precision by 14.7% on the
   development grain example at distance 2, changing the old balance. This
   is the strongest remaining lead and adds little computation. A proposed
   three-point follow-up would test existing AC scales 0.8 and 1.25, then
   restore native InitialQuantDC steps at AC scale 1, with all other choices
   fixed. Each point still needs development, speed and promotion gates.
2. Audit native low-frequency/chroma reconstruction ordering against our
   separate DC representation. This is a possible source-fidelity gap, with
   lower confidence because the feature diagnosis primarily implicated luma.
3. Check native Float32 versus scalar double rounding near quantizer
   thresholds. Expected upside is small; there is no evidence that these
   rare differences explain the guard failure.

Further quality trials require Aaron's renewal. The holdout remains
aggregate-only; the quality, speed and memory limits remain unchanged.
