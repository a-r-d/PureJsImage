# Chroma DC reconstruction audit, 2026-11-03

The aligned encoder subtracts original luma before rounding blue DC. Decoding
adds reconstructed luma, so blue inherits luma quantization error. A scalar
model that instead subtracts reconstructed luma lowers blue DC squared error
by 9.85-15.61% on nine fixed development points. This audit predates candidate
encoding. The subsequent [approved trial](DC-CHROMA-REPORT.md) regressed on the
screen and was rejected; its perceptual result does not follow the scalar gain.

Base: `904e753e5e90bc8e90981476b832267b66e62f39`, research branch
`jxl-libjxl-ports`. The preceding single alignment configuration is complete
and rejected for promotion. Two holdout SSIM guards remain, worst +10.579530%
against +8.05%. This audit reads only saved development streams and their
previously captured source DC planes.

## Evidence

The fixed cohort is im26-2004, im26-3012 and im26-3312 at distances 0.45, 1.85
and 7.5. Source-plane hashes match the earlier reconstruction audit. The own
streams use DC correlation factors X=0 and B=1. The decoder reconstructs each
chroma DC sample as its quantized residual plus reconstructed luma times that
factor. Current blue residuals were rounded after subtracting original luma.

The audit decomposes blue error into residual rounding, propagated luma error
and their cross term. The sum matches decoded error. A nearest-rounding model
then uses the same luma integers, DC steps and source values, with reconstructed
luma subtraction. It changes no X values and changes each affected blue integer
by at most one.

| Development image | Distance 0.45: modeled/current B error | Distance 1.85 | Distance 7.5 |
| --- | ---: | ---: | ---: |
| im26-2004 | 0.900249 | 0.898233 | 0.897228 |
| im26-3012 | 0.898391 | 0.901456 | 0.899089 |
| im26-3312 | 0.846985 | 0.843911 | 0.874293 |

Current blue error reaches 0.664322 nominal DC steps. The model bounds it at
half a step. Between 316 and 730 of 4,096 blue integers change per point. These
are squared errors on the DC grid, not perceptual metrics or BD-rate. Float32
source capture limits interpretation near rounding boundaries.

libjxl v0.12.0 `lib/jxl/enc_modular.cc`, `AddVarDCTDC`, subtracts reconstructed
luma before chroma rounding in its linear, weighted and gradient paths. That
file and LICENSE exactly match commit
`a7a9c787341cf703dede03c2009fa460cae5e5df` in the pinned archive. The earlier
nonlinear DC experiment also changed physical allocation, precision and
rounding, so its regression does not isolate this remaining difference.

## Prepared proposal

[DC-CHROMA-PROPOSAL.patch](DC-CHROMA-PROPOSAL.patch) applies incrementally to
the frozen [DC alignment experiment](DC-WIRE-EXPERIMENT.patch). It adds the
named, attributed scalar module `libjxl-dc-correlation-port.ts` and calls it
from the strategy writer. The caller quantizes Y first, retains at most 64
original luma DC values, restores B from B-Y and removes reconstructed luma
before existing nearest rounding. It preserves the aligned physical steps,
smoothing off, selector, AC and entropy decisions. Scratch is 512 bytes per
rewrite, independent of image size; runtime cost is unmeasured.

The scalar helper passes 21 checks, including both signs of a blue rounding
boundary. Strict TypeScript passed for the audit, helper and caller before
candidate encoding.
The two-file proposal reconstructs exactly in a scratch directory. The initial
audit typecheck required explicit numeric/array annotations; no codec behavior
changed in that harness repair. Source and full license verification pass, and
the existing notices remain included in the npm package and docs site.

Aaron approved one fixed chroma DC quality configuration after reviewing this
proposal, renewing the exhausted allowance under LOSSY_STEERING.md section 9.
The separate trial is under `dc-chroma-20261103`; this audit has no candidate
quality result. The trial report records its completed screen and rejection.
Every quality, speed, memory and promotion gate stays unchanged,
with no sweep or peer maps.

Raw evidence is under `.tmp/jpegxl-lossy-lab/dc-chroma-audit-20261103/`.
The companion JSON records the full decomposition, tests and proposal receipt.
Remaining alternatives are predictor-aware DC rounding with fixed allocation
and estimating fixed-tree histogram clustering costs. Neither has a new
measured quality benefit or trial authorization.

Fresh `VITEST_MAX_WORKERS=4 npm run check` passes 340 test files and 4,229 tests,
with one file and three tests skipped, including static and browser build
checks. It ended at 2026-11-03T23:55:56.167Z. Source, tests, package metadata
and active lab TypeScript remain unchanged.
