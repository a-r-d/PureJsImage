# Reusing prepared transform inputs

The regularized standalone JPEG XL selector can reuse the pixels it already
loaded for the initial DCT8 score. On both development crops, this cuts the
selector's source block reads and copied samples by 30%. Complete encode time
is effectively unchanged, and fresh process memory passes the existing guard.
The change applies only to the development encoder on `jxl-libjxl-ports`. The
historical holdout SSIM guard failures still block merge.

The three trials start from `b455a551`. Profiles of the existing policies put
source preparation and selection at roughly 0.50–0.68 seconds within 0.72–0.96
second profiled encodes. Scoring and forward and inverse transforms dominate.
The named regularized detail function accounts for about 12 and 18 milliseconds
of self time across three profiled encodes of the photo and texture, respectively.
This sample does not separate inlined work or measure the complete cost of the
detail term. The profiles guide work selection and the paired runs measure speed.

## Three exact-output trials

On each crop the initial audit visits 22,784 candidates. Exactly 12,288 repeat
the preceding source origin and extent, all in the small-transform menu. That
menu starts with DCT8 and evaluates other transforms over the same 8×8 block.
Transforms write coefficients to separate arrays. The final trial lets the
caller reuse the already prepared planes and reads the raw maximum quantizer
directly from the field cell. It adds no storage and keeps the same rounding
state handling and score arithmetic.

Ratios are the median of alternating pairs of complete encodes, after three
warmup pairs. All timing comparisons preserve the saved complete streams and
managed peaks. MAD is the median absolute deviation of the paired ratios.

| Trial | Pairs per crop | Photo ratio / MAD / faster | Texture ratio / MAD / faster | Decision |
| --- | ---: | --- | --- | --- |
| LL-1204, remember source coordinates and extent | 7 | 1.038350 / 0.062412 / 2 | 0.986285 / 0.037869 / 4 | Archive |
| LL-1205, reuse named by the caller, with stored quantizer | 7 | 1.028547 / 0.048794 / 3 | 0.991920 / 0.046247 / 5 | Archive |
| LL-1206, reuse named by the caller, with direct field read | 7 | 1.035602 / 0.105975 / 1 | 1.013544 / 0.018491 / 2 | Initial screen |
| LL-1206, fixed confirmation | 21 | 0.998569 / 0.045306 / 11 | 0.996808 / 0.010906 / 13 | Neutral timing |
| LL-1207, integrated source and reference switch | 21 | 1.013652 / 0.048325 / 9 | 1.002768 / 0.059715 / 9 | Neutral timing |

The integrated median elapsed times are 811.634 to 818.810 ms for the photo and
812.121 to 801.989 ms for the texture. Separate medians can move differently
from paired ratios. None of the three trials demonstrates a repeatable elapsed
time improvement. The final one qualifies for retention through measured copy
reduction and passing protected metrics. It reduces 40,960 source reads to
28,672 and 7,864,320 Float32 samples copied to 5,505,024 on each crop. This counts
work inside the selector. The 30% does not describe total encoder traffic.

## Protected memory and correctness

Three fresh processes per crop, variant and state record absolute Linux VmHWM.
Each comparison uses the same imports, writer and warmups. The unchanged
regression limit is 1.05×. All four cells pass in both implementations.

| Implementation | Photo cold / warm | Texture cold / warm |
| --- | --- | --- |
| Private prototype | 0.921812 / 1.009384 | 1.008979 / 1.026127 |
| Integrated development selector | 0.996886 / 1.017134 | 1.010080 / 0.984177 |

Each private trial passes 24 thin, odd and tile-edge pairs. The integrated change
passes 94 focused tests and the decision transplant fixture in Chromium, Firefox
and WebKit. All 17 generated experiment modules reproduce, and all 31 files
restore from the archive. All 576 development streams, byte counts and managed
peaks match the saved references. Peak managed memory is 9,233,504 bytes.
`VITEST_MAX_WORKERS=4 npm run check` passes with 4,249 tests and 346 files
passing, plus three tests and one file skipped. All static and browser build
checks pass. The full command takes 580.461 seconds.

## Quality and merge status

Previously scored regularized development results, including the existing
partial-band omissions, remain the comparison baseline:

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| wasm-vips | −8.205% | −5.199% | −5.631% |
| jSquash | −8.726% | −0.012% | +2.408% |

This round adds no quality policy. The two historical holdout SSIM failures
remain unresolved. A quality repair still needs development qualification and
the full promotion path. The holdout stays closed. Original-image speed and
memory were not measured here. The managed original ceiling remains
137,514,476 bytes. The published codec does not import the development selector.
The earlier peer-forcing hooks in `src` still require package isolation.
The emitted package graph confirms that the exported JPEG XL entries reach
the forced-input branches in `jpegxl-vardct-encode.js` and the geometry overrides
in `jpegxl-jpeg-encode.js`. The internal decision declaration is also emitted.
The audit records both files and their field names so the same boundary can be
checked after separation.

The original replay commit is already on `main`. Restoring `main` would keep
the hooks. A scratch build starts from the writer before that commit and adds
the retained centroid reuse and cost-only ANS tables. The Modular patch applies
as written. The coefficient writer needs the four cost-only calls adapted to
its original signature. Four public Node codec fixtures match the current
streams exactly, including an odd multigroup image with and without progressive
output. This is a feasible starting point for separation. It still needs a lab
path that preserves decision replay and a full package and correctness check.

The next priorities are an independent development quality repair using measured
rate and displayed error, controlling the complete cost of candidate evaluation,
and separating peer forcing from the published package before promotion.

## Reproduction

See [paired samples and receipts](SELECTOR-SOURCE-REPORT.json) and the
[experiment archive](SELECTOR-SOURCE-EXPERIMENT.patch). The source generators
for the private trials read `b455a551`. Run them in order with the pinned crop
fixtures and saved control streams. Run `make-prototype.ts`, `make-directed.ts`,
`make-direct-field.ts` and `make-counts.ts` against that base. Run `audit.ts`,
`counts.ts` and the paired runners with the recorded development crop IDs.
The integrated timing and parity runners require the retained source patch.
The separate package check uses the built `dist` tree. Run `package-boundary.ts`,
`package-separation-preflight.ts` and `package-smoke.ts` to reproduce the audit
and the four public codec comparisons.
Run CPU profiles, timings, process memory and full checks in separate sessions.
Raw CPU profiles and the full parity rows stay under
`.tmp/jpegxl-lossy-lab/selector-source-20261118/`.
