# Exact selector kernels and the regularized finalist

The speed blocker is resolved for the frozen regularized selector. The candidate
still fails promotion: two of nine admitted holdout SSIM guards fail, worst
+12.173% against main. Its peer averages pass. Keep the work on `jxl-libjxl-ports`;
public encoder behavior and main are unchanged.

Base: `04006588243f9a1ec6baf7fe294bf2da16f3a77a`, 2026-11-03. Aaron reopened work
toward merge readiness with the existing gates. The [JSON report](KERNEL-QUALIFICATION-REPORT.json)
preserves timings, coverage, memory receipts and aggregate results. Raw artifacts
are in `.tmp/jpegxl-lossy-lab/selector-kernels-20261103/`.

## Retained speed changes

Fresh profiles identified forward transforms, inverse transforms and inverse
Gaborish among the main costs. LL-1075 batches four forward frequencies using the
same mirrored input pairs. LL-1076 unrolls the existing 25 inverse-Gaborish taps.
Each accumulation retains its original order. Neither change adds buffers,
weights, decisions or runtime dependencies. The inverse-column-pair trial
LL-1074 was inconclusive and is archived separately in
[KERNEL-INVERSE-PAIR.patch](KERNEL-INVERSE-PAIR.patch).

LL-1077 confirms the combined changes against both the frozen quality prototype
and the unchanged control. Final results use 21 rotating triplets per crop,
three warmups and all samples, including outliers.

| Development crop | Candidate / frozen prototype | Faster pairs | Ratio MAD | Candidate / control |
| --- | ---: | ---: | ---: | ---: |
| im26-3012 | 0.888354 | 18/21 | 0.040688 | 0.989093 |
| im26-3312 | 0.912274 | 19/21 | 0.046373 | 0.943527 |

Both control ratios pass the existing 1.016124 allowance. Separate quadruplet
confirmation measured Gaborish's incremental ratios at 0.943199/0.942860, with
15/21 and 18/21 faster pairs. All 576 fresh development outputs equal the saved
native-valid regularized outputs byte for byte. Managed peaks do not increase;
the development maximum is 9,235,833 bytes.

## Quality and entry qualification

Percentages below are mean per-image BD-rates. Negative is better. Development
scores come from the frozen full lab, with fresh exact-stream verification;
holdout scores are from the new 567-output run on 63 photos. Both use the fixed
nine-distance ladder and existing coverage rules.

| Set / reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| Development / vips | -8.205% | -5.199% | -5.631% |
| Development / jSquash | -8.726% | -0.012% | +2.408% |
| Development / control | -0.258% | -0.186% | -0.039% |
| Holdout / vips | -6.106% | -3.672% | -3.307% |
| Holdout / jSquash | -6.607% | +1.551% | +2.296% |
| Holdout / main | -5.498% | -8.198% | -8.394% |

The holdout vips mean is -4.362%, below +2%, with every metric below +5%.
Nevertheless, two admitted SSIM guards exceed 8.05%, worst +12.173%, compared
with the previous frozen worst +11.617%. Nine holdout SSIM comparisons have full
band coverage; zero 3-norm comparisons span the full required band. Missing band
coverage does not establish a per-image pass. Only aggregate results were read;
no holdout identities or individual curves guided the next experiment.

| Fresh isolated workload | Own encode | Own / jSquash | Managed peak |
| --- | ---: | ---: | ---: |
| 64 crops, median | 1.110 s | 2.293470 | 8,746,026 bytes |
| 13 MP original | 37.722 s | 1.465347 | 59,135,103 bytes |
| 21 MP original | 60.358 s | Unavailable: jSquash aborts | 90,873,245 bytes |

All 192 crop engine jobs were fresh. Both own originals finish, decode natively
and score successfully. Managed memory stays below 137,514,476 bytes. The JSON
also records encode-receipt and post-scoring process RSS separately; neither is
a substitute for the managed ledger. Concurrent quality timings are excluded
from speed claims.

## Validation and remaining work

The 110 focused kernel/selector tests, 12 promotion-selection tests, strict
TypeScript checks and Chromium/Firefox/WebKit development fixtures pass.
The full repository check passes: 4,229 tests, three existing skips, and all
static, package and browser-build gates. JPEG XL codec/specialized bundles remain
614,969/687,801 bytes and the package has no runtime dependencies.

The exact kernels remain in the research implementation. The regularized mode
is an explicit development option; it is not promoted. Full watch/scale,
independent-decoder promotion checks, public integration and removal or exclusion
of peer-forcing hooks remain pending. The subsequent cell-local structural
weighting screen (LL-1079) regresses all three averages and is rejected.
LL-1080 tests overlapping windows in a separate development prototype. The
holdout remains closed to tuning.
