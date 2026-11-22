# Bounded SSIM updates and combined protection

Bounded SSIM updates reduce a complete control-plus-eight-proposal scoring batch
by about 88%, including setup. The changed-transform renderer reduces its eight
reconstructions by about 98% after a retained control is available. Both helpers
remain development-only. The combined selector fails the speed rule: its best
screen gain is 0.054% mean BD-rate, while full encodes cost 87-89% more. All
three declared proposal prefixes are rejected for effort 7 and archived.

Research branch `jxl-libjxl-ports`, base `aca2c2fc`, 2026-11-15. No production
encoder change, commit, main merge, full-lab run, holdout access or promotion.
Earlier uncommitted SSIM research remains intact. The temporary worker aliases
and active combined selector have been removed after archive verification.
The [JSON report](BOUNDED-PROTECTION-REPORT.json) contains all timings, native
screen curves, memory samples, exactness results and stream identities.

## Bounded calculation

Keep all six physical scales and the existing box surrogate's eighteen raw
feature sums per tile: corrected structure, added edges and lost detail, each
with mean and fourth-power sums for three channels. Sum features across the
whole image before taking fourth roots. Pooling independent patch losses would
change the decision because the fourth root is nonlinear.

A state owns the control RGBA snapshot, source XYB, control linear RGB/XYB and
small fixed tile sums. A proposal recomputes only intersecting complete tiles,
including the two-pixel box support, and affected linear-RGB pyramid samples.
Downsampling keeps the global even phase and odd-edge replication. Global sums
are accumulated in the same tile order as a complete tiled calculation.

All 32 synthetic cases and 45 saved real coefficient interventions reproduce
the complete tiled scalar exactly. The older whole-image rolling calculation
uses a different floating-point summation order; differences remain below
1e-8. This is exact reuse of the retained surrogate, not native SSIMULACRA2.
Four focused SSIM cases cover odd edges, independent proposals, caller mutation,
identity restoration and invalid extents. Two renderer fixtures cover filtered
and unfiltered states, edge/interior owners and incorrect owner rectangles.
All eight focused cases, including the preceding full-box tests, pass.

The new renderer copies retained raw control pixels for one regular AC owner
plus sixteen input pixels on each side. It recomputes that owner, filters the
bounded crop and replaces the owner plus eight output pixels. Origins stay on
the global eight-pixel grid for EPF and ordered dither. Complete RGBA matches
full reconstruction byte for byte. The helper explicitly restricts frames to
512px, unsmoothed standalone SDR geometry, regular transforms 0/4/5, owners at
most 32px and at most one EPF pass. It does not silently extend to originals.

## Combined guard and proposal rule

The prototype generates its own proposals from final quantized AC coefficients.
For each 32px cell, choose the lowest dequantized-energy high-frequency luma
coefficient with magnitude one. Sort deterministically and test the declared
prefixes of one, four or eight. A proposal removes one coefficient; only one
selected change enters the final entropy writer. No peer map is consumed.

First require nonincreasing whole-image SSIM surrogate loss. Then require
nonincreasing Butteraugli local-map maximum and each raw L3, L6 and L12 sum over
complete changed support. Requiring only a normalized local 3-norm would not
protect the global mixture when unchanged pixels are restored. The relative
numeric allowance is 1e-10, with a unit floor for SSIM. This allowance does not
replace any native promotion threshold.

Known proposal footprints choose 256px windows before quality evaluation.
Singletons use ordinary Butteraugli preparation; repeated windows use the
existing cached state. Butteraugli source/control work is lazy after SSIM
acceptance. Bounds assert that the actual changed RGB rectangle plus all 76
pixels of model support fits its scoring window.

The forty-five saved real interventions are correlated cases on one development
photo. Four pass the combined guard; all ten native material harms are rejected.
Material means over 0.25 SSIM points lost or over 1% Butteraugli max/3-norm added.
This is a useful diagnostic, not independent validation of a general selector.
The earlier native texture orientation sensitivity remains unresolved and the
original native score remains authoritative.

The initial diagnostic estimates entropy for accepted candidates. Its profile
shows that rate setup alone costs 623ms. The screened mode instead uses the
existing three-bit magnitude-one coefficient proxy and takes the first guarded
proposal. This is a proposal policy, not an exact bit estimate. All reported
BD-rates use actual final complete-stream bytes, including map, context and
entropy costs. Quantization, transform and filter maps are unchanged by these
coefficient proposals. One final entropy write remains inside every timed encode.

Actual bytes expose the proxy's limit. Of 35 accepted eight-proposal changes,
twelve increase stream size by at most three bytes, fourteen keep the same size
and nine shrink it. The total saving across all eighty outputs is fourteen
bytes. One/four-proposal totals save four/twenty bytes. These byte counts suggest
that quality changes, especially maximum error, drive most of the tiny BD
benefit. No exact rate guarantee is
inferred from removing a magnitude-one coefficient.

## Native quality screen

Run the standard sixteen development photos at distances 0.5, 1, 2, 4 and 7.
All four rows, including fresh control `standalone-regularized-half`, complete
80 own outputs each with zero execution failures. Every candidate retains 75
explicit partial-band warnings. Against control, SSIM admits eleven full-band
comparisons and Butteraugli admits zero. These partial-band results cannot
qualify full-band parity or the holdout objective.

| Proposal prefix | SSIM delta vs control | 3-norm delta | Max delta | Mean delta | Selected | Material native harms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | -0.000332% | -0.001793% | -0.079805% | -0.027310% | 8/80 | 0 |
| 4 | -0.000206% | -0.005524% | -0.134526% | -0.046752% | 22/80 | 0 |
| 8 | +0.007379% | -0.006148% | -0.163136% | -0.053968% | 35/80 | 0 |

| Row | Vips SSIM / 3-norm / max | jSquash SSIM / 3-norm / max |
| --- | --- | --- |
| Fresh control | -10.719947 / -5.850752 / -6.492535% | -11.810157 / -0.553990 / +0.605413% |
| 1 proposal | -10.720300 / -5.852427 / -6.564309% | -11.810646 / -0.555658 / +0.524404% |
| 4 proposals | -10.720088 / -5.855953 / -6.623508% | -11.810394 / -0.559308 / +0.467235% |
| 8 proposals | -10.714296 / -5.856534 / -6.647045% | -11.805423 / -0.559874 / +0.439131% |

Peers remain wasm-vips 0.0.19 and jSquash 1.3.0, effort 7. No fresh holdout
measurement is implied by these screen means. No material native harm in this
screen is a narrower result than passing all encoder promotion guards.

## Complete selector cost

PNG loading is outside both timers. Everything required to encode is inside:
existing standalone decisions, owned coefficient capture, proposal generation,
control reconstruction, source/control loss setup, bounded reconstruction,
SSIM and Butteraugli updates, rate decisions and final entropy writing. Two
warmup pairs precede alternating measured pairs. No other benchmark, native
quality scoring, profile or test overlaps these timings. Every output hash is
stable; all twelve control/candidate identities match the native-screen streams.

| Input and prefix | Pairs | Control median ms | Candidate median ms | Paired ratio | Ratio MAD | Faster pairs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Painting, 1 | 11 | 855.571 | 1149.408 | 1.343440 | 0.052133 | 0/11 |
| Painting, 4 | 7 | 911.623 | 1351.025 | 1.517056 | 0.081101 | 0/7 |
| Painting, 8 | 11 | 860.056 | 1564.581 | 1.867946 | 0.088848 | 0/11 |
| Texture, 1 | 11 | 867.331 | 1359.795 | 1.549001 | 0.060017 | 0/11 |
| Texture, 4 | 7 | 907.511 | 1641.874 | 1.824849 | 0.038036 | 0/7 |
| Texture, 8 | 11 | 866.497 | 1647.318 | 1.886371 | 0.061504 | 0/11 |

Painting and texture are im26-3012 and im26-3312, each 512x512. Eight-proposal
throughput falls from 0.305/0.303 to 0.168/0.159 megapixels per second. These
are complete selector costs relative to own control, not a fresh qualification
against jSquash or originals. Screen concurrency times are excluded.

The eight-proposal phase medians explain the remaining cost. Painting/texture
control reconstruction costs 125/129ms and SSIM setup 94/92ms. Proposal
reconstruction costs 15/20ms and SSIM updates 6.8/7.2ms. Butteraugli setup costs
322/320ms and updates 79/189ms. Capture and generation cost under 2ms together.
The one-proposal painting case rejects before Butteraugli and still costs 34%
more. Removing only further SSIM update work cannot solve this setup floor.

The unchanged rule requires at least one percentage point of mean BD-rate gain
per 10% slowdown. Gains of 0.027-0.054% cannot pay for 34-89% more time. No full
lab, effort-9 admission, original qualification or holdout run is earned.

## Retained helper cost and memory

Eleven three-way alternating batches compare nine full box losses against
source/control preparation plus eight bounded updates. Both paths include
linear-RGB conversion, setup and pooling. Three warmup cycles precede timing.
All scores agree with the old rolling reference within 1e-8.

| Input | Nine full losses ms | Tile16 ms / paired ratio | Tile32 ms / paired ratio |
| --- | ---: | --- | --- |
| Painting | 842.277 | 103.402 / 0.122452 | 102.888 / 0.121871 |
| Texture | 857.087 | 102.356 / 0.120038 | 101.401 / 0.118269 |

All forty-four candidate comparisons are faster. Keep tile16 as the default;
tile32 changes too little to justify an encoder policy. Tile16 retained state
is 13,824,976 bytes, excluding transient scratch. Twenty-four fresh-process
memory batches cover three samples per path, input and cold/warm state. Warm
baselines follow three full calls and two explicit collections.

| Input/state | Full-loss median peak RSS | Bounded median peak RSS | Ratio |
| --- | ---: | ---: | ---: |
| Painting cold | 237,154,304 | 149,348,352 | 0.629752 |
| Painting warm | 229,302,272 | 166,457,344 | 0.725930 |
| Texture cold | 228,794,368 | 148,475,904 | 0.648949 |
| Texture warm | 272,683,008 | 172,412,928 | 0.632283 |

All SSIM post-GC ArrayBuffer counts return exactly to their respective baseline
of 10,932,932 bytes. RSS includes imports, PNG inputs and all warmups. External,
ArrayBuffer, heap and RSS boundary samples are preserved. These measurements
qualify this bounded crop helper only, not original-image encoder memory.

Eleven isolated eight-render batches compare complete geometry rendering with
bounded rendering after both have the same retained control. Painting improves
973.801 to 21.331ms, paired ratio 0.021741; texture 938.706 to 19.585ms, 0.020553.
All twenty-two pairs are faster and every full RGBA SHA256 agrees. Control
setup is excluded from this component test and included in complete encodes.
The final owner-rectangle validation adds only an entry guard after timing;
valid input paths and pixels are unchanged and final fixtures pass.

Encoder memory is a separate failed-policy diagnostic. Eight fresh processes
cover both paths, inputs and cold/warm states once each. Candidate peak RSS is
233-279MB, 1.317-1.401x control. Post-GC encoder buffer deltas vary, so those
single samples establish neither full retention safety nor a leak. The earlier
joint timing process reaches 766,070,784 bytes on the one-proposal texture run.
That high-water mark includes both paths and warmups and remains in the report.
The lab managed-byte counter excludes these new float caches. It cannot certify
the combined selector's memory. Do not promote this policy on memory or speed.

## State and next work

The active encoder and package graph are unchanged. Retain only bounded SSIM and
changed-transform reconstruction with tests. The [22-file reversible archive](BOUNDED-PROTECTION-EXPERIMENT.patch)
restores the rejected policy, temporary worker plumbing, original diagnostic
stages and typed measurement runners. Applying it in a separate base-worker
mirror reproduces every recorded source SHA256. Public peer-forcing cleanup
remains required before any future main merge.

Historical rejected-predictor qualification carries forward separately from
this screen's fresh control: full development vips -10.184/-4.810/-4.548%,
jSquash -12.333/-1.230/+3.116%, main -8.704/-10.154/-8.168%. Previous crop speed
is 2.387946x jSquash; originals take 39.546/68.866s, with the 13MP case 1.512916x
and the 21MP peer aborting. Original managed peaks 59,210,879/91,262,401 remain
below 137,514,476. Bundles remain 614,969/687,801, runtime dependencies zero.
The frozen holdout still has two SSIM guard failures, worst +11.202599% against
+8.05%. None of those qualifications is refreshed by this experiment.

Fresh `VITEST_MAX_WORKERS=4 npm run check` exits zero with no signal: 4,242
tests and 344 files pass, three tests and one file skip. All static and browser
build gates pass. Whole check takes 543.228s, with no overlapping benchmark or
profile. Changes remain uncommitted. Next hypotheses, in order: reuse source and
control reconstruction already required by the encoder; seek useful coupled
coefficient proposals that can pay for complete setup; measure incremental final
rate before replacing the proxy. Preserve all native gates and do not fit a
new loss to the unstable native texture signs.

## Reproduction

Raw root: `.tmp/jpegxl-lossy-lab/bounded-protection-20261115`. The JSON report
retains primary numeric evidence. The archive expects its private paths and
selector module to be absent and its worker to equal base `aca2c2fc`. It also
requires the retained helpers from this change and the saved development corpus,
predictor PNGs and marginal coefficient interventions. It adds no native source.
Use a separate checkout, or copy runners/config to a fresh sibling and change
the output-root literal. Timing and stream runners refuse output overwrites.

```sh
git apply benchmark/jpegxl/lossy-lab/BOUNDED-PROTECTION-EXPERIMENT.patch
node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/bounded-protection-20261115/control-screen --mode screen --workers 4 --budget-seconds 600 --variant combined-control --strategy-port standalone-regularized-half
for prefix in 1 4 8; do
  node benchmark/jpegxl/lossy-lab/run.ts --manifest .tmp/jpegxl-lossy-lab/corpus-512-v2/manifest.json --out .tmp/jpegxl-lossy-lab/bounded-protection-20261115/combined${prefix}-screen --mode screen --workers 4 --budget-seconds 600 --variant standalone-combined${prefix} --strategy-port standalone-combined${prefix}
done
node .tmp/jpegxl-lossy-lab/bounded-protection-20261115/probe.ts im26-3012 8 16 bounded-verify
node .tmp/jpegxl-lossy-lab/bounded-protection-20261115/validate.ts
node .tmp/jpegxl-lossy-lab/bounded-protection-20261115/ssim-cost.ts im26-3012
node .tmp/jpegxl-lossy-lab/bounded-protection-20261115/full-cost.ts im26-3012 8 11
node .tmp/jpegxl-lossy-lab/bounded-protection-20261115/render-cost.ts im26-3012
node --expose-gc .tmp/jpegxl-lossy-lab/bounded-protection-20261115/memory.ts ssim im26-3012 candidate warm 0
```

Repeat both photos and declared prefixes as recorded in the JSON. The render
benchmark reads the saved eight-proposal `bounded-verify` probe from probe.ts;
run that probe first in a fresh output tree. The full-cost runner checks against
completed native screens. Native scoring commands and their pinned manifests
remain in each screen's execution receipts. Run cost measurements serially on
an idle machine; do not overlap them with native scoring or repository checks.
