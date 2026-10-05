# JPEG XL predictor work and package size, October 3, 2026

The predictor experiment now reuses more of the existing encoder work and fits
both current bundle ceilings. It keeps the smaller files from
[ORDINARY-PREDICTORS.md](ORDINARY-PREDICTORS.md). Production remains unchanged;
overall compression parity remains open.

## Reusing residual construction

The first prototype constructed and clustered the sampled model before
replaying pixels to score and reconstruct the refined model. The fused control
collects complete predictor costs during the existing context and residual
pass. It stores weighted residuals in the existing output buffer, then replaces
the values that need the base or gradient predictor. This avoids another
weighted-prediction replay and another group-sized residual buffer.

The selected histograms are compacted in the same tracked count buffer and
passed directly to clustering. This removes the initial clustering pass and
the selected residual recount. Sampled tree partitions, predictor candidates,
leaf and model limits, grouping and color-transform policies stay unchanged.

| Input | Retained ordinary file | Fused file | Bytes saved |
| --- | ---: | ---: | ---: |
| im26-1416 | 649,404 | 648,383 | 1,021 |
| im26-2018 | 613,268 | 612,152 | 1,116 |
| Red dither | 617,106 | 615,996 | 1,110 |
| 513-pixel crop | 227,797 | 227,749 | 48 |

All four complete files are byte-for-byte identical to the preceding raw
refinement. Their branches, leaf contexts and color transforms match the
ordinary baseline. The control records one timing per file. Those observations
do not replace paired cold and warm runtime and RSS checks. Tracked allocation
peaks are close to the baseline and do not establish an RSS improvement.

## Funding the package bytes

The unfunded fused model adds 1,860 bytes to Core + JPEG XL and 1,867 bytes to
the specialized APIs. It exceeds their unchanged ceilings by 1,838 and 1,445
bytes, respectively.

Many first-party error messages repeat the literal prefix `JPEG XL `. A shared
portable helper adds that prefix before calling the existing `invalidInput`
factory. All 1,356 converted calls across the two copied variants retain the
same `ImageError` class, name, code and complete message. The helper executes
only when a corresponding invalid-input branch runs.

| Bundle | Current bytes | Shared error prefix | Prefix and fused model | Existing ceiling | Remaining bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Core + JPEG XL | 540,978 | 536,436 | 538,304 | 541,000 | 2,696 |
| Specialized JPEG XL APIs | 613,578 | 608,347 | 610,215 | 614,000 | 3,785 |

The prefix change saves 4,542 and 5,231 bytes before adding the model. Bundle
settings, public targets and original ceilings remain fixed. All 15 Core +
JPEG XL exports and all 14 specialized exports match the baseline.

An initial package harness incorrectly matched another entry point with the
same filename, dropping specialized exports. Its results are rejected and kept
separately. The corrected harness matches exact resolved codec paths and checks
every public export name before accepting a measurement. The table above uses
only the corrected results.

## Exact validation

The raw and prefix-funded controls contain 16 complete files and 32 independent
native libjxl and Rust grids. A fresh audit rereads 100,679,680 original samples
with zero error, including alpha and hidden RGB. Their bytes also match the
preceding complete physical program profile.

The raw controls verify 25,169,920 samples through the source codec. The funded
controls verify another 25,169,920 samples through the actual built Core +
JPEG XL candidate bundles and their public `jpegxlCodec` factories. Output rows
have complete, nonduplicate pixel coverage. Encoder allocations close after
every encoding. A separate fresh check repeats all 1,356 error comparisons.

Evidence:

- [Raw fused files](results/fused-ordinary-predictor-tree-controls.json).
- [Original bundle-size failure](results/fused-ordinary-package-controls.json).
- [Corrected package and export checks](results/error-prefix-funding-package-controls-retry.json).
- [Funded files and built public decoders](results/funded-fused-predictor-tree-controls.json).
- [Fresh sample, error and package audit](results/funded-fused-predictor-tree-audit.json).

## Remaining adoption work

The raw fused learner still needs a general fallback to the previous complete
encoded learned group. The four inputs above do not prove that selecting the
lowest empirical leaf cost always gives the smallest encoded group.

The next implementation step is to preserve that group fallback while sharing
the full-pixel scoring and residual work. Paired runtime and RSS checks, original
minimum working-memory behavior, browser execution and the complete public
input and quality matrices must then pass. The original 5% paired median and
95% bootstrap upper limits still apply. Production source, qualified public
files and the wider lossless and lossy gaps remain unchanged.
