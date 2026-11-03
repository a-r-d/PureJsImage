# DC serialization alignment trial, 2026-11-03

One fixed configuration corrects the DC step mismatch identified in
[the reconstruction audit](DC-RECONSTRUCTION-AUDIT.md). Its full development
quality effect is small and mixed. Speed and managed memory pass entry checks.
Two holdout SSIM guards still fail, worst +10.579530% against the +8.05% limit.
The trial is rejected for promotion. The branch is not ready to merge.

Research base: `ec3ecc99793e618cfadcadbb1a5723e358120851`, branch
`jxl-libjxl-ports`. Audit checkpoint: `4171928f`. Aaron approved one configuration
after reviewing the two-file proposal. No sweep or peer maps. This work changes
no active source or public defaults and performs no merge to main.

## Fixed change

The first-party helper rounds the three custom DC matrix entries to their
existing emitted F16 values once. DC quantization then uses those exact values.
The development-selected AC 1.25 allocation, selector, smoothing-off policy,
display filters and entropy selection stay fixed. No new libjxl algorithm is
ported. Existing licensed ports and notices are preserved.

All eighty screen HF-global/AC sections and fourteen checked decision fields
match AC 1.25 exactly. Serialized DC matrices and smoothing are unchanged.
Total screen bytes fall from 2,848,367 to 2,848,180, or 0.006565%. The changes
are confined to DC coding.

## Development quality

Negative BD-rate means smaller files at matched quality. The screen has 16
photos and 80 outputs; the full lab has 64 photos and 576 outputs. Every output
validates with native libjxl. Parallel encode times are excluded.

| Full development comparison | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -7.395105% | -6.473941% | -7.401786% |
| jSquash reference | -7.982168% | -1.927104% | +0.876009% |
| Frozen AC 1.25 | -0.024258% | -0.067491% | +0.165190% |
| Regularized control | +0.852182% | -1.907570% | -1.983097% |
| Main | -6.557223% | -11.831944% | -11.030977% |

The vips three-metric mean is -7.090277%. The paired mean against AC 1.25 is
+0.024480%, so the correction does not improve that combined development score.
Eight admitted main SSIM guards pass; the worst changes from +4.608959% to
+4.597758%. There are zero full-band 3-norm admissions. The unchanged main entry
thresholds pass.

Screen changes against AC 1.25 were -0.042212/-0.086645/-0.118885% in
SSIM/3-norm/max order. The max-error improvement did not persist across the
larger development set. All three incremental worst per-image changes remain
below 3%, with max worst +2.860303%.

The three worst max regressions against main are im26-3000 +18.811842%,
im26-3004 +8.286729% and im26-2014 +4.832759%. Native-decoded nearby-byte
pairs use candidate/main distances 1.3/1.85, 0.65/0.9 and 0.65/0.9, with byte
ratios 0.968339/0.956360/0.950647. Visual review shows subtle grain and tonal
differences in the dark texture, vessel and blurred shoe/water scenes. These
views do not localize the metric maximum or excuse the measured regressions.

## Isolated speed and memory

Fifteen alternating pairs after two warmups compare the fixed mode with the
unchanged regularized control. Photo/texture ratios are 1.044569/1.031273, with
MAD 0.047912/0.035042 and 3/15 and 4/15 faster pairs. Candidate medians are
854.335/864.053ms. These pass the 1.101283 allowance from the cumulative
1.012828% mean quality gain. There is no speedup claim.

| Isolated workload | Own encode time | Ratio to jSquash | Managed peak |
| --- | ---: | ---: | ---: |
| 64 crops, median | 1.119s | 2.318200x | See per-image receipts |
| 13 MP original | 36.583s | 1.472700x | 59,210,879 bytes |
| 21 MP original | 58.464s | unavailable | 91,262,401 bytes |

All 192 crop engine jobs use fresh timing. Both own originals finish, decode
natively and score. jSquash aborts on the 21 MP original, so no ratio is claimed
there. The managed ceiling stays 137,514,476 bytes. Process peak RSS is
430,055,424 and 508,813,312 bytes for the two own originals; this includes the
worker's input and runtime allocations. Full-lab managed peak is 9,422,327 bytes.

## Holdout and disposition

The single frozen holdout evaluation completes all 189 engine jobs and 567
native-valid own outputs, with no failures. Review is aggregate only; no
per-image holdout values or identities are inspected and no decisions change
after admission.

| Holdout comparison | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -5.779439% | -4.491810% | -4.188952% |
| jSquash reference | -6.277550% | +0.044060% | +1.486564% |
| Main | -5.251640% | -9.593119% | -9.467303% |

The vips mean is -4.820067%, so the mean and single-metric objective passes.
Main mean gates also pass. Two of ten admitted SSIM guards fail, worst
+10.579530%. All ten previous admissions remain; both prior failures still
fail and none are dropped from coverage. Zero 3-norm comparisons cover the full
required band. Holdout managed peak is 26,183,855 bytes.

The previous AC 1.25 worst guard was +10.568972%. The correction leaves the
blocking result essentially unchanged. One approved configuration is complete,
zero retained or promoted. Preserve the experiment outside active source. No
full watch/scale, second-decoder or public-integration phase follows this failed
holdout. Another quality configuration requires owner renewal.

## Verification and reproduction

Eighteen thin, odd and DC-group boundary fixtures encode repeatably and decode
natively. Two transparent fixtures preserve exact alpha. Three pinned old
control hashes match. Nine saved development streams additionally verify the
emitted luma DC integer against the nearest signaled grid point, allowing only
the measured source-capture Float32 error. All nine have lower reconstructed
luma DC squared error. At im26-3312 distance 0.45, the actual after/before ratio
is 0.135188. This verifies the numerical correction; it is not a perceptual gain
or a replacement for the lab results.

Strict experimental TypeScript passes. Fresh `VITEST_MAX_WORKERS=4 npm run check`
passes 340 files and 4,229 tests, with one file and three tests skipped, including
static and browser build checks. The check ended at 2026-11-03T23:10:22.092Z.
No active source, test, package metadata or lab TypeScript changes follow it.
Bundles remain 614,969/687,801 bytes, with zero runtime dependencies.

[DC-WIRE-EXPERIMENT.patch](DC-WIRE-EXPERIMENT.patch) reconstructs eight files
against the research base, including the frozen AC 1.25 stack, correction and
fixture checks. [DC-WIRE-AUDIT.patch](DC-WIRE-AUDIT.patch) reconstructs six
first-party stream checks, alpha fixtures, visual-pair and timing scripts. Both archives
apply exactly. The separate two-file proposal shows the incremental change.
Raw results remain under `.tmp/jpegxl-lossy-lab/dc-wire-20261103/`;
[DC-WIRE-REPORT.json](DC-WIRE-REPORT.json) records complete summaries, source
hashes and receipts. Lab records are LL-1110 through LL-1114.

For reproduction, apply the experiment in a scratch checkout at the recorded
base, then use the standard lab harness with `--variant standalone-dc-wire`
and `--strategy-port standalone-dc-wire`, the frozen corpus-512-v2 manifest,
and the unchanged screen/lab ladders. Promotion admission must be requalified.
Public peer-forcing hooks still require removal before any merge.

Final remote verification found main at `4a40c68f`, two commits beyond the
previously observed `e534dec5`: site documentation/SEO and a Playwright package
contract expectation. Neither changes JPEG XL source or package dependencies.
This work did not merge or rebase; comparisons retain the frozen baseline.

Remaining development investigations, in order: separate chroma DC error from
luma error using the frozen streams; examine predictor-aware DC rounding while
preserving the chosen physical allocation; estimate fixed-tree histogram
clustering savings from saved DC symbols. The broader nonlinear and smoothing
trials already regressed, so they should not be repeated unchanged. These
hypotheses have no measured quality benefit and authorize no further trial.
