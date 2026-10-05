# JPEG XL histogram calculation, October 3, 2026

The private lossless predictor refinement still produces the same four smaller
files after precomputing hybrid-integer constants. Both full public bundles fit
their existing size ceilings. The confirmation fails the original cost limits. This candidate is rejected for adoption. Its sources and measurements remain preserved for diagnosis.

The production codec retains the qualified implementation. Its 4000 by 3000
photo is already 6,220,181 bytes at effort 7, compared with 6,899,188 bytes for
jSquash and 6,648,964 bytes for wasm-vips. The original 15.4 MB photo gap is closed.
Overall compression parity remains open.

## Exact output and arithmetic

The six histogram trials used to calculate the same powers for every residual.
The private candidate calculates five scalar constants once per trial. It adds
no backing buffer. The generic packed-integer function preserves input validation.
The coding choices, training, memory limits, and complete previous-group retry
remain the same as the guarded refinement.

| Input | Retained file | Private candidate | Bytes saved |
| --- | ---: | ---: | ---: |
| im26-1416, 1024 by 768 | 649,404 | 648,383 | 1,021 |
| im26-2018 | 613,268 | 612,152 | 1,116 |
| Red dither | 617,106 | 615,996 | 1,110 |
| 513-pixel crop | 227,797 | 227,749 | 48 |

All eight source-control files preserve the earlier complete hashes and managed
memory peaks. Native and Rust decoding checks 50,339,840 original samples;
source public decoding checks another 25,169,920 samples, including alpha and
color behind transparent pixels. These source controls are separate from the
packaged timing test, which uses only the 1024 by 768 photo.

The arithmetic proof checks 1,840,177 exact packed values and 36 invalid-input
errors. It exhausts 0 through 65,535 under all six production histogram modes,
tests power boundaries across valid partitions, and samples the full unsigned
32-bit range. It does not exhaust every possible 32-bit value.

## Package size

The first-party error helper shares the JPEG XL prefix. All 1367 literal messages
and 156 cases for twelve interpolated messages preserve their class, name, code,
and complete text.

| Public target | Retained bytes | Private candidate | Existing ceiling | Headroom |
| --- | ---: | ---: | ---: | ---: |
| Core and JPEG XL | 540,978 | 540,969 | 541,000 | 31 |
| JPEG XL specialized | 613,578 | 612,866 | 614,000 | 1,134 |

The core bundle retains all 15 exports and the specialized bundle all 14. The
earlier literal-only package is preserved as a failed measurement: its core
bundle was 541,057 bytes, 57 bytes over the same ceiling. Sharing the remaining
interpolated prefixes recovered 88 core bytes and 96 specialized bytes.

## Isolated cost confirmation

Fifteen fresh alternating pairs compare the actual built public encoders on the
pinned 1024 by 768 RGBA photo. Each of the 30 fresh processes performs one cold
and one warm complete encode. Every file matches its independently validated
hash, and every encoder closes its owned buffers. Explicit garbage collection
settles the ArrayBuffer baseline to the input plus at most 512 KiB before each
encode. RSS measures the absolute process peak.

The original cost limit requires both the paired median and the 95% bootstrap
upper bound to be at most 5% for each metric. Positive values mean added cost.

| Metric | Paired median | 95% bootstrap upper | Existing limit |
| --- | ---: | ---: | --- |
| Cold runtime | 6.329% | 7.359% | Fail |
| Warm runtime | 3.608% | 7.909% | Fail |
| Cumulative peak RSS | -6.369% | -1.356% | Pass |
| Cold peak RSS | -7.170% | -4.111% | Pass |

The confirmation fails the original cost limits. This candidate is rejected for adoption. Its sources and measurements remain preserved for diagnosis.

The separate three-pair pilot had 2.316% median cold overhead and a 5.901% upper
bound, so it also failed the preliminary cold limit. Those observations are
preserved separately and are never pooled into the fifteen-pair confirmation.

## Remaining work

The private refinement still needs broader working-memory controls, input cost
coverage, compatibility fixtures, real browser checks, and complete public
comparison matrices before adoption. The earlier natural memory sweep retains
its failed coverage gate for a later histogram-search limit; injected recovery
is recorded separately. This turn does not add a general memory guarantee.

The retained lossy comparison still has 13 unresolved cases. At SSIMULACRA2 80,
the adequately matched photo remains about 4.5% larger than wasm-vips. This
lossless predictor experiment does not resolve those cases.

Evidence:

- [Exact source controls](results/token-precomputed-controls.json)
- [Rejected literal-only package](results/token-precomputed-package-controls.json)
- [Full public package measurements](results/token-precomputed-dynamic-package-controls.json)
- [Separate three-pair pilot](results/token-precomputed-cost-pilot.json)
- [Fresh fifteen-pair confirmation](results/token-precomputed-cost-confirmation.json)
- [Independent audit of both cost cohorts](results/token-precomputed-paired-audit.json)
