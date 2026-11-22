# Local contrast and actual coefficient rate

A single coefficient removal causes most of the worst local regression and
saves zero serialized color bits by itself. The old magnitude-rate proxy also
predicts savings on two development photos whose actual encoded size grows.
Joint rate-distortion decisions need a better local error measure and an
entropy model that accounts for context and histogram changes.

Research base `ac1fffae`, 2026-10-28, branch `jxl-libjxl-ports`. This is an
offline diagnostic of the rejected quarter-strength rounding rule. No new
encoder decision rule is retained, and the holdout stays closed.

## The failing region

The primary case is im26-2004 at distance 1.85, selected from the previous full
development failure. Native Butteraugli's maximum is at pixel (216,295).
The affected 32x32 DCT starts at (192,288), across a light/dark diagonal
transition in the crop. Four luma coefficients in this transform were removed.
All other decisions come from our encoder, with no peer maps.

The source and both complete encoded endpoint hashes match the saved lab
artifacts. Capturing group coefficients does not change the streams. Applying
all 731 captured coefficient changes to the control reproduces the rejected
trial byte for byte. Each intervention reruns the real writer, including its
normal order, context and entropy-model selection, then native decoding and
all three metrics. These re-encodes are diagnostic; they are not an effort-7
search algorithm or a speed measurement.

| Applied removals | Changes | File bytes saved | Actual color bits saved | Native BA max | Native BA 3-norm | SSIMULACRA2 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| None | 0 | 0 | 0 | 2.316706 | 1.261772 | 63.520165 |
| All | 731 | 344 | 2,754 | 2.491974 | 1.269077 | 63.313817 |
| Four near the peak | 4 | 4 | 32 | 2.491987 | 1.262180 | 63.521266 |
| All except those four | 727 | 340 | 2,722 | 2.320623 | 1.268693 | 63.322236 |
| Only removals to zero | 721 | 342 | 2,736 | 2.491974 | 1.269053 | 63.313817 |
| Only nonzero decrements | 10 | 15 | 130 | 2.316706 | 1.261795 | 63.518686 |

These are fixed-distance counterfactuals, not BD-rates or candidate policies.
The four-removal case reproduces the local damage despite slightly improving
the whole-image SSIM score. Keeping those four recovers nearly all of the max
regression while preserving 340 of 344 saved bytes. The remaining whole-image
SSIM and 3-norm changes still need to be judged across the full ladder.

The following measurements use sRGB-weighted luma from the native-decoded
8-bit PNG, weights 0.2126/0.7152/0.0722. They are local diagnostics, not a
Butteraugli surrogate. Contrast ratio is decoded/source standard deviation;
gain is covariance divided by source variance. Gradient error sums squared
horizontal and vertical edge differences against the source.

| Window centered at the peak | Control contrast ratio | Trial ratio | Control gain | Trial gain | Gradient error change |
| --- | ---: | ---: | ---: | ---: | ---: |
| 16x16 | 0.798728 | 0.789998 | 0.647585 | 0.624929 | +10.940% |
| 32x32 | 0.831506 | 0.824122 | 0.685621 | 0.677249 | +1.863% |
| 64x64 | 0.982338 | 0.981744 | 0.965430 | 0.964658 | +1.290% |

The four-removal intervention reproduces all 16x16 and 32x32 luma measurements
of the full trial exactly. The outside-only intervention preserves the
control's measurements in those windows. The much smaller change in the
64x64 window shows why a large-area average can miss this local loss.

## Individual removals and interactions

All 15 nonempty subsets of the four local changes are encoded and scored.
The table lists each removal alone and the complete set. Frequency coordinates
use the 32x32 transform's natural coefficient layout.

| Removal | Token change | Proxy bits saved | Actual color bits saved | Native BA max change |
| --- | --- | ---: | ---: | ---: |
| (u=28, v=1) | -1 to 0 | 3 | 0 | +0.109% |
| (u=30, v=3) | -1 to 0 | 3 | 0 | +0.738% |
| (u=27, v=16) | +1 to 0 | 3 | 16 | 0.000% |
| (u=8, v=27) | +1 to 0 | 3 | 0 | +5.543% |
| All four | as above | 12 | 32 | +7.566% |

The fourth removal is a poor local trade even before combining it with the
others. Its zero cost is confirmed before byte padding, not inferred from
file length. Both distortion and rate are non-additive: removing the first
two together leaves the global maximum unchanged, while combining the second
and fourth raises it 8.596%. Adding their individual percentages would not
predict either result. Full maps and metrics remain in the raw artifacts.

A further 30 single-change probes include all ten nonzero decrements and 20
changes sampled at uniform positions in the complete change list. Of these,
21 save zero actual color bits. The other nine save 16-238 bits, even though
the scalar proxy assigns only 1.170 or 3 bits each. These are finite-stream
marginal costs under normal model adaptation, not intrinsic costs that can be
assigned to each coefficient and added independently.

## Actual entropy cost

The audit now exposes the writer's existing final-frame color-bit count in
`encodeTransplant`. It includes serialized color sections before byte padding
and excludes alpha. Container, frame/TOC overhead and padded section byte
sizes are recorded separately. No encoder decisions or public codec source
change to collect this measurement.

For im26-2004, the control uses 369,925 color bits and the complete trial
367,171, a saving of 2,754. The proxy predicts 2,174.699. The AC group payloads
shrink by 362 bytes, while HF global grows by 18 bytes, leaving the observed
344-byte file saving. LF global and DC sections are byte-identical.

Bitstream inspection confirms unchanged coefficient orders in the inspected
cases. The baseline signals 13 histograms, the full trial 14, and the ten
nonzero decrements 12. Context maps and models change. Untouched groups can
therefore change size too. The nonzero-only case shrinks HF global by 27 bytes
but grows total AC payload by 12 bytes, producing its 15-byte saving. This
explains why an isolated magnitude proxy misses large discontinuities.

The audit also re-encodes both endpoints on all 16 fixed screen photos at
full-lab distance 1.85. All 32 endpoint hashes match their saved artifacts.
This is a one-distance diagnostic, not a new quality screen or full lab.

| Development photo | Changed coefficients | Proxy bits saved | Actual color bits saved | File bytes saved |
| --- | ---: | ---: | ---: | ---: |
| im26-1002 | 94 | 278.340 | 339 | 43 |
| im26-1026 | 6 | 18.000 | 69 | 8 |
| im26-1052 | 20 | 60.000 | 87 | 11 |
| im26-1210 | 78 | 218.680 | -54 | -7 |
| im26-1610 | 8 | 24.000 | 122 | 15 |
| im26-1622 | 25 | 75.000 | 120 | 15 |
| im26-1626 | 1 | 3.000 | -13 | -2 |
| im26-1634 | 8 | 24.000 | 96 | 11 |
| im26-2002 | 2 | 6.000 | 28 | 3 |
| im26-2004 | 731 | 2174.699 | 2754 | 344 |
| im26-2012 | 0 | 0.000 | 0 | 0 |
| im26-3000 | 18 | 52.170 | 120 | 14 |
| im26-3012 | 100 | 296.340 | 407 | 51 |
| im26-3014 | 0 | 0.000 | 0 | 0 |
| im26-3306 | 249 | 747.000 | 1204 | 151 |
| im26-3312 | 0 | 0.000 | 0 | 0 |

The total proxy saving is 3,977.229 bits versus 5,279 actual color bits.
More seriously, the sign is wrong on im26-1210 and im26-1626. On im26-1626,
one removal grows HF global from 2,646 to 2,723 bits and changes nine
histograms to ten. On im26-1210, HF global shrinks but AC payload grows more;
LF global also changes. DC sections and coefficient orders stay fixed in both.
These results rule out treating the proxy as an actual marginal rate.

The contrast diagnostic also needs validation before it becomes a decision
rule. On im26-1002, the 16x16 gradient error around the trial's peak grows
3.621%, while native Butteraugli max improves 0.256%. A local gradient cap
would reject that beneficial max change. The im26-2004 causal result does
not establish a general replacement for the native perceptual metric.

## Retained state and next step

The rounding mode is removed again; its original archive remains
`DISPLAY-EXPERIMENT.patch`. Retained changes are the offline audit, tests and
benchmark result field for the existing bit counter. No joint RD policy is
implemented. No speed, quality, memory, bundle or promotion claim follows
from the manually chosen local interventions.

Retained full-development BD-rate is unchanged:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | -8.003% | -5.030% | -5.582% |
| jSquash | -8.474% | +0.227% | +2.571% |

Prior speed qualification remains 2.635783x jSquash on crops and 1.698729x on
the 13 MP original (41.894s); the prior 21 MP encode finishes while jSquash
aborts. These are carried-forward results, not new timing measurements.
Managed peaks remain 8,760,382 / 59,139,199 / 91,010,461 bytes for crops /
13 MP / 21 MP, below the 137,514,476 ceiling. Bundles remain
614,941/687,773 bytes with zero runtime dependencies. The two frozen holdout
SSIM guards remain unresolved. Main is unchanged.

Next hypotheses:

1. Evaluate a frozen-context rate estimate against these exact marginal
   measurements, including the two wrong-sign cases. Separately measure the
   benefit and cost of refreshing global histograms after a batch.
2. Test whether small-window contrast and gradient loss predicts local max
   changes across development interventions. Do not turn this one region into
   a hard-coded encoder exception or equate squared error with Butteraugli.
3. Only then test a joint local RD rule that accounts for neighboring
   coefficients and filtering, with the normal quality and speed gates.

## Reproduction and validation

Raw root: `.tmp/jpegxl-lossy-lab/local-rate-20261028/`. `bit-audit/audit.json`
contains the nine cohort interventions; `bit-marginal/audit.json` contains
15 local subsets and 30 individual changes; `screen/` contains 16 endpoint
pairs. Every row retains streams, native PNGs, raw distance maps and metrics.
`models.json` and `negative-models.json` inspect the signaled coding models.
Earlier byte-only passes are retained separately in `audit/` and `marginal/`.
There are 90 native-scored outputs in the final bit-count and endpoint passes,
plus 58 earlier byte-only confirmation outputs. Counts include repeated
control endpoints. Lab entries LL-989 through LL-994 record the findings.

```sh
# In the research checkout, temporarily restore the rejected mode for the audit.
git apply benchmark/jpegxl/lossy-lab/DISPLAY-EXPERIMENT.patch
node benchmark/jpegxl/lossy-lab/audit-local-rate.ts fresh-output/cohorts
node benchmark/jpegxl/lossy-lab/audit-local-rate.ts fresh-output/marginal marginal
node benchmark/jpegxl/lossy-lab/audit-local-rate.ts fresh-output/im26-1626 endpoints im26-1626
# Repeat endpoints for the fixed screen IDs; the command enforces development inputs.
```

The recorded endpoint byte checks require the prior full-lab artifacts.
The helper uses full-frame buffers for offline diagnostics; they are not
encoder memory or speed measurements. PFM row order and extent validation,
contrast cancellation, multi-group section accounting and the bit counter
have focused tests.

Validation: `VITEST_MAX_WORKERS=4 npm run check` passes, exit 0, with
4,187 tests passed and three existing skips; 332 files pass and one is skipped.
Test phase 495.00s; full command 535.62s. Chromium, Firefox and WebKit decision
fixtures all pass. Focused diagnostics have seven passing tests including the
previous display trace. Type checking, archive application and diff whitespace
checks pass. Logs and check status are under the raw root. No public codec
source, holdout, promotion or main merge changes.
