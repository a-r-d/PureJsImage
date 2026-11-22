# Saved-development DC coding audit, 2026-11-03

The fixed weighted-predictor tree does not recover the predictor trial's added
rate. Even with existing first-party histogram sharing, its complete local DC
color stream is larger at all 80 development screen points. The current
residual coder is already close to ideal entropy for its chosen contexts and
tokens. These results do not justify another fixed-tree image trial.

This audit follows the rejected fixed predictor trial at research checkpoint
`cfd2cac820adb99c96c55de3520a05b985791136`. It reads 80 saved aligned streams and
80 saved predictor streams. It emits DC color substreams for exact cost and
integer checks, but no candidate images or perceptual scores. No peer decisions
or holdout files are read. Active source and public behavior stay unchanged.

## Measured coding costs

Each mode contains 983,040 DC samples. The existing decoder observes the
predictor actually used for every symbol, including all Modular transforms.
The fixed-tree alternatives operate on the exact decoded DC integers and
round-trip through the active first-party decoder. All 320 integer-plane
comparisons and ending-bit-position checks pass. The 160 observed raw plane
sets also match the assembled decoder after extra-precision normalization.

| Saved mode | Current DC bits | Fixed tree, separate histograms | Fixed tree, shared histograms | Shared-tree smaller points |
| --- | ---: | ---: | ---: | ---: |
| Aligned | 2,835,849 | 3,325,070 | 2,976,097 | 0/80 |
| Predictor | 3,275,864 | 3,840,466 | 3,471,355 | 0/80 |

Shared histograms reduce the fixed tree from 34 histograms to 3-7 for aligned
and 3-8 for predictor. The resulting increases are 140,248 and 195,491 bits,
equivalent to 0.615516% and 0.841709% of the original whole-file sizes.
These are DC cost contributions, not exact whole-file size changes or BD-rates.
TOC changes and final byte padding are excluded. Existing global sections
remain paid and unchanged, and the full local tree and model cost is included.
This does not test sharing one global tree over multiple DC groups.

On predictor streams, the shared fixed tree saves 26,491 header bits but adds
221,982 residual bits. The original encoder uses weighted prediction for
74.925537% of actual symbols, compared with 36.139832% for aligned. Replacing
its mixed predictions with all-weighted prediction increases residual cost.
Every observed stream has default weighted-predictor parameters, a local tree
and no LZ77 or DC color transforms. The earlier leaf-presence count was not a
symbol-use measurement.

## Entropy accounting

For each observed histogram, the audit computes empirical zero-order token
entropy and adds the unchanged hybrid-integer extra bits. This ideal benchmark
excludes finite coder state. It does not bound other predictors, context
partitions or token configurations and is not an implementable saving claim.

| Saved mode | Actual residual bits | Ideal residual bits | Difference as original file size |
| --- | ---: | ---: | ---: |
| Aligned | 2,715,533 | 2,713,284.544 | 0.009868% |
| Predictor | 3,090,246 | 3,087,873.311 | 0.010216% |

Improving ANS probability precision with the current tokens and histograms has
little room to recover the previous 1.931233% file growth. Even deleting every
local DC header in the predictor streams would save only 0.799200% of their
file size, and a real encoder still needs those models. A larger gain needs a
different residual distribution, context partition, token mapping or allocation.
The all-weighted fixed tree tested here moves in the wrong direction.

## Source, reproduction and verification

[DC-CODING-AUDIT.patch](DC-CODING-AUDIT.patch) reconstructs three files exactly:
the first-party preparation and cost scripts, plus the previously attributed
`libjxl-fixed-dc-port.ts`. The port is reused without behavioral changes from
`DC-COMPLETION-EXPERIMENT.patch`. Its source is libjxl v0.12.0
`lib/jxl/modular/encoding/enc_encoding.cc`, commit
`a7a9c787341cf703dede03c2009fa460cae5e5df`. Source and LICENSE match the pinned
archive. The module's BSD-3 header, package notice and docs notice remain intact.
Histogram sharing, prediction, entropy writing and decoding are first-party.

In a scratch checkout at the recorded base with the saved streams available,
apply the audit patch, then run:

```sh
node benchmark/jpegxl/lossy-lab/prepare-dc-coding-audit.ts
node benchmark/jpegxl/lossy-lab/audit-dc-coding.ts
```

The preparer writes decoder and clustering inspection copies below the ignored
audit directory. It exports existing functions and adds a residual observer;
no reconstruction arithmetic changes. Strict experimental TypeScript passes.
Raw input hashes, exact bit counts, source hashes and archive checks are in
[DC-CODING-AUDIT.json](DC-CODING-AUDIT.json). Diagnostic execution times are not
isolated encoder benchmarks and establish no speed or memory improvement.

The preceding `VITEST_MAX_WORKERS=4 npm run check` passed 340 files and 4,229
tests, with one file and three tests skipped, including package and browser
build checks. That result is carried forward: active source, tests, package
metadata and executable lab TypeScript remain identical. This follow-up adds
only archived scripts and reports. Its focused checks cover all new diagnostics.

## Disposition

Zero new image configurations, zero new holdout attempts and zero retained or
promoted changes. The approved fixed predictor trial remains rejected: two
aggregate-reported holdout SSIM guards fail, worst +11.202599% against +8.05%.
There are no full-band Butteraugli 3-norm admissions. Speed and managed-memory
entry passed for that trial, but promotion is stopped and main is untouched.

Remaining hypotheses, ranked by possible quality benefit rather than a measured
gain: displayed DC/AC error interaction at selected transforms; mixed-predictor
contexts and hybrid tokens; exact predictor execution speed if a quality mode
earns further work. Their upside is unmeasured. Current-model ANS precision and
the tested fixed tree are ruled out as useful next trials. The one-configuration
renewal is exhausted under LOSSY_STEERING section 9; another encoder trial
requires an owner decision and must keep every existing gate.
