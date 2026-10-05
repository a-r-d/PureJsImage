# JPEG XL histogram counting, October 3, 2026

The private lossless predictor refinement still produces the same four smaller
files with a simpler histogram calculation. Both public bundles fit their existing
size ceilings. The candidate fails the original cost limits and is rejected for adoption. Its evidence remains preserved for diagnosis.
Production remains the qualified implementation. Overall compression parity remains open.

The qualified 4000 by 3000 photo is already 6,220,181 bytes at effort 7, compared
with 6,899,188 for jSquash and 6,648,964 for wasm-vips. The original 15.4 MB photo
gap is closed. Remaining lossless gaps and the lossy comparison still need work.

## What changed

Histogram trials consume only the token and number of extra bits. The candidate
omits calculation of the discarded extra-bit payload in that loop, precomputes
the mode constants once, and keeps the original full serializer for writing bytes.
It adds no buffer and preserves the coding choices, training, working limits and
complete previous-group retry. The calculation is directly in its single caller.

The fresh profile covers 29,282 samples. The complete histogram-trial phase accounts
for 2.155% of samples, with the full helper inside that phase accounting for 0.338%.
These are sample shares, not a prediction of removable work or measured speed.

| Input | Retained file | Private candidate | Bytes saved |
| --- | ---: | ---: | ---: |
| im26-1416, 1024 by 768 | 649,404 | 648,383 | 1,021 |
| im26-2018 | 613,268 | 612,152 | 1,116 |
| Red dither | 617,106 | 615,996 | 1,110 |
| 513-pixel crop | 227,797 | 227,749 | 48 |

All eight source-control files retain their hashes, managed memory peaks and closed
allocations. Native and Rust decoding checks 50,339,840 original samples; public
decoding checks a separate 25,169,920 samples, including alpha and hidden color.
The arithmetic proof covers 1,840,177 full packed values, another 1,840,177 consumed
token/count comparisons and 36 invalid-input errors. It exhausts 16-bit values in
six modes and samples the full 32-bit range; it does not exhaust every 32-bit value.

## Public package controls

First-party helpers share repeated JPEG XL error prefixes. All 1367 original
literal errors, 156 cases for twelve interpolated messages and 81 additional
unsupported-operation errors preserve their class, name, code and complete text.
The core bundle retains all fifteen exports and the specialized bundle all fourteen.

| Public target | Candidate bytes | Existing ceiling | Headroom |
| --- | ---: | ---: | ---: |
| JPEG XL specialized | 612,418 | 614,000 | 1,582 |
| Core and JPEG XL | 540,612 | 541,000 | 388 |

The separate count helper exceeded the core ceiling by 97 bytes. Inlining reduced
the miss to 59 bytes. Sharing unsupported-operation prefixes then brought both
targets under their original limits. Failed measurements remain separate.

## Isolated cost confirmation

Fifteen fresh alternating pairs compare the actual built public encoders on the
pinned 1024 by 768 RGBA photo. All thirty processes perform a cold and a warm
complete encode and preserve the independently validated file hashes and owned
memory peaks. Explicit garbage collection settles the ArrayBuffer baseline to
the input plus at most 512 KiB before each encode. RSS is the absolute process peak.

Both the paired median and the 95% bootstrap upper bound must stay at or below 5%
for every protected metric. Positive values indicate added cost.

| Metric | Paired median | 95% bootstrap upper | Existing limit |
| --- | ---: | ---: | --- |
| Cold runtime | 4.519% | 5.474% | Fail |
| Warm runtime | 3.322% | 5.752% | Fail |
| Cumulative peak RSS | -5.422% | -1.761% | Pass |
| Cold peak RSS | -5.747% | 0.996% | Pass |

The candidate fails the original cost limits and is rejected for adoption. Its evidence remains preserved for diagnosis. The separate three-pair pilot is preserved and is never pooled into
the fifteen-pair confirmation. The earlier full-payload candidate remains rejected
for its 6.329% cold median and 7.359% upper bound, with a 7.909% warm upper bound.

## Remaining boundaries

This experiment has not changed production. Broader working-memory recovery,
input costs, compatibility fixtures, real browser checks and full public matrices
remain necessary before adoption. The earlier natural recovery sweep retains its
failed coverage gate; injected recovery is separate. No general memory guarantee
follows from these nominal controls.

The retained lossy comparison has 13 unresolved cases. The adequately matched
photo at SSIMULACRA2 80 remains about 4.5% larger than wasm-vips. This lossless
experiment does not resolve those comparisons or establish overall parity.

Evidence:

- [Current profile details](results/token-precomputed-profile-details.json)
- [Exact inline source controls](results/token-inline-controls.json)
- [Failed core package](results/token-inline-package-controls.json)
- [Complete public package controls](results/token-inline-funded-package-controls.json)
- [Separate three-pair pilot](results/token-inline-cost-pilot.json)
- [Fresh fifteen-pair confirmation](results/token-inline-cost-confirmation.json)
- [Independent raw-observation audit](results/token-inline-paired-audit.json)
