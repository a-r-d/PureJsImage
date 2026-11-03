# DC reconstruction audit, 2026-11-03

The encoder quantizes DC with an unrounded custom matrix, but writes that matrix
as half-precision values. The decoder therefore uses different DC steps. This
affects the frozen development-selected AC 1.25 mode as well as the rejected
nonlinear DC mode. A two-file correction is prepared for review. Its effect on
perceptual quality, bitrate and the promotion gates has not been measured.

Research base: `ec3ecc99793e618cfadcadbb1a5723e358120851`, branch
`jxl-libjxl-ports`. No active source or public encoder behavior changes in this
checkpoint. The approved coupled DC quality configuration is already exhausted.

## Scope and measurements

The fixed development audit cohort is im26-2004, im26-3012 and im26-3312, each at
distances 0.45, 1.85 and 7.5. Nine instrumented repetitions of the frozen coupled
DC configuration reproduce the saved native-valid streams exactly. Observers
capture the source DC grid before quantization and the existing transform
conversion. Saved AC 1.25 and nonlinear streams provide the comparison data.
There is no new quality configuration, metric scoring or holdout access.

DC conversion roundtrips have maximum absolute error 1.110223e-15. Storing the
captured source grid as Float32 adds at most 2.980233e-8 on this cohort. Observed
transform IDs are 0, 1, 2, 4, 5, 6, 7, 10 and 11. Thirty horizontal/vertical
scale checks agree with libjxl's Float32 tables; six source files match the
pinned v0.12.0 archive exactly. These checks do not identify a transform scale
or orientation error in the sampled paths.

Normative smoothing increases luma DC squared error in all nine samples, by
1.0093x to 2.7108x. Both transform boundaries and interiors are affected; image
edges are unchanged. These are DC-grid errors, not perceptual scores.

## Serialized matrix mismatch

The quantizer uses `invGlobal * dcQuantization[channel] / quantDc` before
`writeLfGlobal` serializes each custom matrix entry as `F16(value * 128)`.
Decoding divides the rounded value by 128. The sampled native streams instead
use exactly representable matrix entries `[1/4096, 1/512, 1/256]`.

For the same saved AC 1.25 DC integers, the table compares squared error using
the actual decoded step with squared error using the quantizer's intended step.
It isolates serialization's contribution without re-encoding a candidate.

| Development image | Distance 0.45 | Distance 1.85 | Distance 7.5 |
| --- | ---: | ---: | ---: |
| im26-2004 | 1.569385x | 1.017235x | 1.001072x |
| im26-3012 | 1.518745x | 1.006705x | 0.999702x |
| im26-3312 | 7.403490x | 1.155411x | 1.005404x |

At im26-3312 distance 0.45, serialization adds a mean luma DC shift of
-0.725454 nominal steps and a maximum absolute shift of 0.731258 steps. The
nonlinear mode has a smaller -0.362726 mean shift at that point. Small relative
step differences accumulate when large DC integers multiply the step. Error
cancellation means serialization does not increase every channel's error.

The observer stores Float32 DC whereas the older AC 1.25 path rounds its
Float64 grid. The small capture error above limits this numerical comparison.
Chroma coupling and display filtering are not evaluated by the scalar model.

## Prepared correction and validation

[DC-WIRE-ALIGNMENT-PROPOSAL.patch](DC-WIRE-ALIGNMENT-PROPOSAL.patch) is an
incremental patch against the frozen
[AC 1.25 archive](BLOCK-ALLOCATION-AC125-EXPERIMENT.patch), not the active branch.
It adds a first-party helper that rounds the three matrix entries with our
existing F16 writer and reader. The writer then uses those exact values for DC
quantization. This preserves the emitted matrix bytes, AC decisions, smoothing
off, existing DC rounding, entropy selection and allocation policy.

The helper passes nine invalid-input checks, three exactly representable matrix
checks and all nine standard ladder points. All 27 ladder matrix entries match
the saved decoder values; serialization is unchanged and rounding is idempotent.
Its isolated managed allocation peaks at 12 bytes and returns to zero. This is
a helper check, not an encode memory or speed result.

Scalar nearest luma rounding on the captured 36,864 cells stays within half a
signaled step and never increases squared error. At im26-3312 distance 0.45 its
modeled error ratio is 0.135188. No candidate stream has been encoded with the
proposal, so this is not a measured pixel-quality or BD-rate improvement.

The two-file proposal and seven-script diagnostic archive reconstruct exactly.
Strict TypeScript and the frozen prototype integrity checks pass. Initial audit
preflight checks compared Buffer/Uint8Array and Int32Array/Uint8Array prototypes
instead of numeric contents. The first-party harness now compares indexed
values and rejects mismatches; these were harness errors, not codec findings.
Fresh `VITEST_MAX_WORKERS=4 npm run check` passes 340 test files and 4,229 tests,
with one file and three tests skipped, including the static and browser build
checks. It ended at 2026-11-03T23:10:22.092Z. The receipt is in the companion JSON.

## Reproduction and next decision

Raw observations and source DC planes are under
`.tmp/jpegxl-lossy-lab/dc-reconstruction-audit-20261103/`.
[DC-RECONSTRUCTION-AUDIT.json](DC-RECONSTRUCTION-AUDIT.json) records source hashes,
all numerical results, helper checks, archive receipts and validation status.
[DC-RECONSTRUCTION-AUDIT.patch](DC-RECONSTRUCTION-AUDIT.patch) preserves the
diagnostic scripts. Apply it in a scratch checkout with the previous coupled
prototype reconstructed, then run:

```sh
node benchmark/jpegxl/lossy-lab/prepare-dc-reconstruction-audit.ts benchmark/jpegxl/lossy-lab/dc-reconstruction-observer.ts
node benchmark/jpegxl/lossy-lab/audit-dc-reconstruction.ts
node benchmark/jpegxl/lossy-lab/audit-dc-matrix.ts ac125
node benchmark/jpegxl/lossy-lab/audit-dc-matrix.ts nonlinear
node benchmark/jpegxl/lossy-lab/verify-dc-source-scales.ts
node benchmark/jpegxl/lossy-lab/verify-dc-wire-matrix.ts
```

Aaron approved one fixed serialization-alignment trial on development-selected
AC 1.25 after reviewing this proposal. This renews the completed one-configuration
limit under LOSSY_STEERING.md section 9. Keep every quality, speed, memory and
promotion gate unchanged, with no sweep or peer maps. Results belong to the
separate DC alignment experiment; this audit contains no candidate result.
Subsequent hypotheses are fixed-DC histogram clustering and the source/DC
preconditioning difference; neither is authorized as another quality trial.

The last actual full development result remains the rejected coupled DC mode:
vips +5.077/+1.686/-0.599%, jSquash +4.019/+6.409/+8.169% in SSIM/3-norm/max
order. Frozen AC 1.25 still fails two aggregate-reported holdout SSIM guards,
worst +10.568972%. The branch is not ready to merge.
