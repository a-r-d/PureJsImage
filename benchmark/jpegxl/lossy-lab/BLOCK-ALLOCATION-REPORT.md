# Selected-block allocation follow-up

The branch is not ready to merge. All three approved allocation trials are
complete. Development finalist AC 1.25 passes speed and original managed
memory entry, but two holdout SSIM guards fail, worst +10.569%. No quality
change is retained or promoted. Public encoder behavior is unchanged.

Aaron approved exactly three allocation trials on 2026-11-03 after the
[selected-block report](BLOCK-QUANTIZATION-REPORT.md). Base:
`9b0f8656e6280237dace22d25e81747d1f3aa5a3` on `jxl-libjxl-ports`.
Raw evidence: `.tmp/jpegxl-lossy-lab/block-allocation-20261103/`.
All quality, speed, memory and promotion gates stay unchanged. No peer maps
or per-image holdout results guide the experiments.

## Fixed scope

All three trials use the corrected selected-block quantizer and dead-zone
pass from the preceding report. AC 0.8 and 1.25 multiply the floating
precision field before transform selection, leaving global scale and physical
DC steps fixed. This uses the existing standalone allocation mechanism;
changing global scale alone would be canceled by InitialQuantField's
normalization. The old coarse-distance precision adjustment stays in place.

The third trial restores the ported InitialQuantDC physical steps. Frozen
X/Y/B factors 0.75/0.5/0.75 become 1/1/1, with AC unchanged. The source
revision remains libjxl v0.12.0 `a7a9c787341cf703dede03c2009fa460cae5e5df`.
These are first-party allocation variations around the existing licensed
ports. They add no source constants, runtime dependencies or new searches.

## Development results

Mean BD-rates are ordered SSIMULACRA2 / Butteraugli 3-norm / Butteraugli max.
Negative is better. Screens use 16 photos and five distances; full labs use
64 photos and the existing nine-distance ladders.

| Trial | vs regularized control | vs selected-block writer | vs vips | vs jSquash |
| --- | --- | --- | --- | --- |
| AC 0.8 screen | -1.015 / +0.822 / +6.894 | -0.304 / +1.855 / +7.332 | -11.703 / -5.536 / -1.076 | -12.571 / +0.369 / +6.569 |
| AC 1.25 screen | +1.209 / -1.705 / +1.445 | +1.945 / -0.528 / +1.814 | -9.752 / -6.729 / -5.034 | -10.901 / -2.319 / +2.362 |
| Native DC screen | +6.387 / -1.291 / -1.352 | +7.160 / -0.203 / -1.156 | -5.573 / -7.197 / -7.845 | -5.172 / -1.324 / -0.608 |
| AC 0.8 full lab | -1.264 / +0.364 / +1.146 | -0.677 / +1.365 / +2.254 | -9.299 / -5.084 / -4.693 | -9.741 / +0.448 / +3.220 |
| AC 1.25 full lab | +0.878 / -1.856 / -2.170 | +1.462 / -0.782 / -1.120 | -7.389 / -6.428 / -7.592 | -7.976 / -1.864 / +0.702 |

All 1,392 development outputs pass native decoding and scoring. Native DC
is rejected after its screen: its worst paired SSIM regression is +24.185%
against the selected-block writer, and its three-metric mean is weaker.

AC 0.8 passes seven admitted main-relative SSIM guards, worst +6.383%.
One previously admitted comparison loses full-band coverage. Its mean against
regularized is +0.082098%, earning no allowance for added time.

AC 1.25 passes all eight admitted main-relative SSIM guards, worst +4.609%.
Main-relative means are -6.559 / -11.784 / -11.211%. Its worst SSIM result
is +15.168%, with partial coverage; it remains visible in the report.
Neither full lab has an admitted full-band 3-norm comparison.

AC 1.25 was selected before any holdout evaluation. It has the stronger
three-metric mean and worst admitted development guard of the two AC trials.
Compared directly with the preceding selected-block writer, its mean gain
is 0.146955%; the improvement is a redistribution across metrics.

## Validation and incremental speed

Thirty-six repeatable thin, odd and tile-edge fixture cases pass. Policy
checks at nine distances per mode confirm the intended physical DC/global
scale settings. Each mode is denied holdout, watch and scale access until
it independently qualifies. Strict experimental TypeScript passes.

Twenty-seven own-stream audits confirm that AC trials preserve emitted DC
exactly. Native DC preserves every emitted transform choice and raw AC
quantizer. Its Y step doubles exactly; X/B ratios are 1.3329-1.3337 after
serialized matrix precision. No peer or holdout streams enter this audit.

Fifteen isolated alternating pairs per profiling image give AC 1.25/control
ratios 1.060116 and 1.011351. Ratio MADs are 0.038559 and 0.023288, with 3/15
and 6/15 pairs faster. Both pass the 1.104959 allowance from the measured
quality gain. This is a measured cost, not a speedup. All repeated candidate
streams match their native-valid screen hashes. Managed peaks are 5,682,267
bytes for the photo and 5,680,219 for the texture, respectively unchanged
and +2,048 bytes against control.

The three largest development main-relative max regressions are im26-3000
(+18.515%), im26-3004 (+7.781%) and im26-2014 (+5.225%). Native-decoded
nearby-size pairs inspected at candidate/main distances 1.85/3, 1.85/3 and
0.65/0.9 show subtle texture and tonal changes on the dark door, pottery and
grainy feet/water image. No gross structural break is visible at 512px.
This does not localize or dismiss the metric peaks. Parameters stay frozen.

Fresh absolute crop speed is 2.321100x jSquash, with all 192 engine jobs
complete and no reuse or failure. The 13 MP original takes 36.080 seconds,
1.457947x jSquash, with managed peak 59,210,879 bytes. The 21 MP original
takes 58.877 seconds, managed peak 91,262,401 bytes. Both own originals
decode natively and score. jSquash aborts on 21 MP, so its ratio is
unavailable and the runner's exit 1 remains recorded.

Both managed peaks are below 137,514,476 bytes. Encode-receipt process RSS
is 448,188,416 and 508,436,480 bytes respectively. These entry measurements
do not replace the full cold/warm RSS and reclamation qualification.

## Frozen holdout

All 189 engine jobs finish, with 567 native-valid outputs and no execution
failures. Results remain aggregate only; no identities or per-image curves
were inspected.

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| vips | -5.769% | -4.432% | -4.254% |
| jSquash | -6.270% | +0.107% | +1.432% |
| main | -5.192% | -9.521% | -9.492% |

The vips mean is -4.818409%; the objective and main-relative mean gates pass.
Two of ten admitted SSIM guards fail, worst +10.568972%, above the unchanged
+8.05% limit. The preceding selected-block trial's worst was +10.090154%.
All nine previously admitted comparisons remain admitted, including both
failures; one comparison is newly admitted. Neither previous failure passes.
There are zero full-band 3-norm admissions. Managed crop peak is 26,183,855 bytes.

Promotion stops here. The other two modes never enter holdout. Full watch/scale,
cold/warm RSS and reclamation qualification, independent-decoder promotion and
public integration remain unqualified for this candidate.

## Read-only DC audit

A source and existing-development-stream audit identifies a missing native DC
quantization stage. The four source files checked against the pinned archive
match exactly: `enc_modular.cc`, `enc_cache.cc`, `common.h` and `encode.cc`.
Effort 7 enables nonlinear DC quantization. `QuantizeWP` applies a predictor
residual dead zone of 0.62, rounds small residuals on a grid with one extra
precision bit, and restricts larger residuals to even integers. It updates
weighted predictor state after each coefficient. Chroma DC uses reconstructed
quantized Y for its correlation subtraction.

Nine pinned vips development streams, from three photos and three distances,
all signal raw DC extra precision 1. Our corresponding streams signal 0.
The first audit incorrectly read the assembled decoder state's zero value.
That value describes coefficients already divided by the raw precision factor.
Reading the raw groups resolves the apparent source/bitstream contradiction;
all 18 raw group coefficient sets match their assembled decoder values exactly.
The decoder's rendering is unchanged. The development extractor's assembled
precision field must not be treated as a raw signal for separated DC groups.

The native fine Y grid is close to our current Y grid, and its fine X/B grids
are about two-thirds of ours. The native-DC trial above changed nominal steps
only; it did not implement predictor-aware nonlinear rounding or the extra
precision bit. Its regression does not test that coherent native stage.
This establishes a missing mechanism, not a measured quality benefit or a
proven explanation of the two holdout failures. No new encode, native probe,
port or quality configuration was run for this audit.

## Checkpoint and next decision

Fresh `VITEST_MAX_WORKERS=4 npm run check` passes: 340 test files and 4,229
tests, with one file and three existing tests skipped. Browser build checks
pass within that command. Strict experimental TypeScript and all fixture,
decision and archive checks pass. The three independent experiment patches
reconstruct 21 files exactly against `9b0f8656`. Each preserves the previously
validated 19-test block-quantization suite. A separate DC audit patch preserves
the read-only diagnostic. Source, active tests, package metadata and active lab
TypeScript match the base. Bundles remain 614,969 / 687,801 bytes, with zero
runtime dependencies.

The approved three-configuration scope is exhausted. Ranked next hypotheses:

1. Coherent nonlinear DC quantization with native InitialQuantDC and
   reconstructed-Y chroma DC subtraction. Highest priority because source and
   raw development streams confirm the missing stage; numerical upside is
   unmeasured. Test one fixed source-derived configuration before any sweep.
2. Audit DC/AC reconstruction consistency for the low frequencies of selected
   large transforms. It could expose a systematic rounding mismatch; no
   measured error budget or quality gain yet supports a port.
3. Audit native float32 and rounding-tie semantics at quantization boundaries.
   Lower expected upside; pursue only if coefficient traces show a material
   mismatch.

Another quality trial requires an owner renewal of the bounded plateau stop.
All quality, speed, memory and holdout rules remain unchanged.
