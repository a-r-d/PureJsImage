# JPEG XL remaining encoder targets, September 23

Implementation revision: `8925ce52fa06b2112310f60ccbe7f639eba0fdd1`. Previous encoder revision: `2643604888dc8ad58322a3756d5aade68af066b4`. M7 implementation was already locally complete under its approved profile. This run improves two measured targets and keeps lossy encoding Experimental.

The [evaluation protocol](m7-evaluation-protocol.json) and [approved 2 MP amendment](m7-bounded-quality-protocol.json) set the targets. The original 120 development and 120 observed holdout families remain separate. The observed holdout was inspected during tuning and is regression evidence, not an unseen generalization test. The fixed eight original-size sources, native RGBA8 artwork, and derived PQ16 HDR are separate strata. Every difficult case remains in the reports.

## Retained changes and before/after measurements

A CPU profile of the original 12 MP effort-1 RGB8 case identified XYB filling as a hot path. The aligned sRGB path now uses a bounded interpolated cube-root table at effort 1. Other dimensions, color types, depths, transfers and efforts retain their existing conversion. The original output SHA-256 changed from `76e8c8b48e231e56fdf58badc6d87449bd48082d54a7477313abe0db5b9f1ad5` to `ac05ab039f1cd595263aa19ba15ec235e4d3f13660738dc197497c9450227989`; native and Rust decoders agree within one RGB8 level across all 36 million samples. SSIMULACRA2 for the original photograph moved from 87.0063 to 87.0368. This is a measured local result, not a general quality gain.

The effort-7 multi-group lossless search now compares three hybrid integer token configurations on its selected residual plan. It retains the smallest encoded group, including the former choice. It does not replace RGB under zero alpha. Fresh pinned native and Rust decoding confirms exact source samples for all 240 SDR cases and all 24 HDR/artwork expansion cases. The [optimization log](../../optimization-log.md) records rejected palette and squeeze probes. They were not retained.

| Measurement | Before | After | Target result |
| --- | ---: | ---: | --- |
| Development lossless median / p90 / worst vs pinned libjxl | 1.153636 / 1.367369 / 1.673511 | 1.153636 / 1.367369 / 1.673256 | Pass |
| Observed holdout lossless median / p90 / worst | 1.167859 / 1.409225 / 1.675691 | 1.167843 / **1.399516** / 1.675691 | Pass, with 0.000484 p90 margin |
| Total first-party bytes saved across both 120-case splits | Baseline | 175,283 bytes; zero case-size regressions | Exact decoding passed |
| Native RGBA8 artwork median / p90 | 1.290606 / 1.482599 | Identical encoded streams and ratios | **Fail** 1.25 / 1.40 |
| Derived PQ16 HDR median / p90 | 1.170711 / 1.327709 | Identical encoded streams and ratios | Pass |
| Seven isolated warm effort-1 core samples, median | 2039.910 ms | 1773.740 ms | Development diagnostic, about 13% shorter |
| Paired original 12 MP effort-1 cold / warm core ratio | 6.661× / 8.067× on prior exact commit | **5.646× / 7.067×** in 21 pairs each | Both pass 8× |
| Original 12 MP public effort-3 cold / warm | 4.504 / 4.523 s | 4.504 / 4.572 s | Both pass 20 s; variation is not attributed to the effort-1 path |

The development and holdout [lossless reports](m7-prompt3-lossless-development.json) and [holdout report](m7-prompt3-lossless-holdout.json) record each input pixel hash, encoded hash, byte ratio, and exact independent decoder result. The [24-case expansion](m7-prompt3-lossless-expansion.json) preserves native precision, alpha, and invisible RGB. The old large-image regression's 65.8% median byte reduction remains above its 25% minimum: the previous group encoding remains a candidate, and no new group or whole-image size regression occurred in the full 240-case replay.

The [paired runtime report](m7-prompt3-runtime-commit-run1.json) retains all 84 alternating core measurements, source hashes, input hash and pinned native tool hash. Cold and warm are separate. The ratios compare encoder-core boundaries, not process duration. The [public workflow report](m7-prompt3-public-effort3.json) records the original 12 MP file workflow and RSS. The [decoding receipt](m7-prompt3-runtime-decoding.json) checks both measured effort streams with native libjxl, Rust, and the repository decoder. These timings apply to the recorded reference host only.

## Lossy quality and remaining gaps

The effort-7 lossy color path did not change. All 16 freshly encoded first-party points on the fixed eight original-size sources match the previous encoded bytes, decoded hashes, SSIMULACRA2 scores, and Butteraugli scores. They were checked against native, Rust, and repository decoders. Their 16 pinned native reference points retain the same source pixels, settings, and tool hashes. The [original-size report](m7-prompt3-original-size.json) keeps all eight sources and both distances. The prior [2 MP development](m7-prompt2-quality-development.json), [observed holdout](m7-prompt2-quality-holdout.json), and [artifact manifest](m7-prompt2-artifacts.json) remain the approved lossy matrix; no new 2 MP timing or quality gain is claimed. The encoder's changed fast path is effort 1, while the scored quality matrix is effort 7.

Bracketed capped SSIMULACRA2 70/80/90 and Butteraugli 1/2 coordinates remain within the 1.35 median / 1.60 p90 libjxl size bounds; the worst capped ratio remains 1.669, below 2. Missing SSIMULACRA2 brackets remain missing. The bracketed photograph JPEG median at SSIMULACRA2 70 remains below 1 in both source splits, but the missing photo brackets remain visible. Equal encoder distance does not establish equal quality.

Original-size brochure im26-5034 and im26-5052 remain outliers. At distance 3, the former is 796,979 bytes vs 243,762 native and the latter 883,563 vs 149,228 native, with different quality scores. Native uses a small Modular reference frame followed by a VarDCT patch frame; this encoder writes one VarDCT frame. This is a concrete coding gap, and these cases are retained. Existing visual review continues to record text-edge ringing, texture smoothing, gradient roughness and HDR/alpha outliers. The unchanged [HDR/alpha development](m7-expansion-quality-development-integrated054.json) and [observed holdout](m7-expansion-quality-holdout-integrated054.json) reports score the declared black/white alpha backgrounds and native-light/headroom 1/2/4 HDR views. Exact default lossy alpha was reconfirmed in [18 independent alpha decodes](m7-prompt3-alpha-conformance.json). A capped photograph result does not establish full-resolution HDR, transparency or screenshot quality.

## Target decision

| Reviewed target | Result | Evidence |
| --- | --- | --- |
| Lossless SDR median ≤1.25, p90 ≤1.40, worst ≤1.75 | **Pass** | Development 1.154 / 1.367 / 1.673; observed holdout 1.168 / 1.399516 / 1.676; 240/240 exact |
| Old large-image lossless reduction ≥25% | **Pass** | Prior 65.8% median reduction preserved by retaining the old per-group candidate |
| Derived PQ16 lossless size and exact samples | **Pass** | 1.171 / 1.328; 12/12 exact |
| Native transparent RGBA8 lossless size | **Fail** | 1.291 / 1.483 exceeds 1.25 / 1.40; 12/12 exact including RGB under zero alpha |
| 2 MP bracketed lossy size vs libjxl | **Pass on measured brackets** | Both splits within 1.35 / 1.60; capped worst 1.669 |
| Complete matched-quality and original-size lossy coverage | **Fail** | Missing SSIMULACRA2 brackets; original brochure patch outliers; only eight original-size sources |
| Bracketed photo size vs JPEG at SSIMULACRA2 70 | **Pass on measured brackets** | Median 0.888 development / 0.889 observed holdout; missing brackets retained |
| Declared alpha and HDR semantic checks | **Pass for checked views** | Exact default alpha; black/white composites and native-light/headroom views retained; broader quality gap remains |
| Effort-1 paired cold and warm median ≤8× native | **Pass** | 5.646× cold and 7.067× warm, 21 pairs each |
| Original 12 MP public effort-3 ≤20 s | **Pass** | 4.504 s cold and 4.572 s warm |
| Final conformance and resource gates | **Pass** | 39/39 current expected cases; 24/24 resource cases, no raw exception or ownership leak |

The [evidence index](m7-prompt3-evidence-index.json) records report, input, artifact, source and tool hashes. The [clean-checkout conformance](m7-prompt3-conformance.json) and [resource report](m7-prompt3-resource.json) run on the implementation commit above. The full repository check passed 3,192 tests with three skipped; real Chromium JPEG XL pipeline and workbench coverage passed 29/29. The specialized JPEG XL bundle is 530,910 bytes under the revised 531,000-byte ceiling, and core plus JPEG XL is 442,839 under 443,000. Lossy remains Experimental because the complete matched-quality, original-size class, transparent lossless, and HDR/alpha quality requirements remain unmet. No Stable promotion or release is claimed.
