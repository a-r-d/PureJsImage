# JPEG XL lossy screenshot patch qualification, September 24

Implementation revision: `30d72d1a88a33e156fc6ed053c308d7268f4188d`. Lossy encoding remains Experimental. The [evidence index](m7-prompt9-evidence-index.json) records the implementation, source, input, encoded stream, decoder, report, check and bounded-run hashes. The [development](m7-prompt9-quality-development.json) and [observed holdout](m7-prompt9-quality-holdout.json) reports retain all 120 sources in each approved 2 MP split. The [fixed original-size replay](m7-prompt9-original-size-replay.json) retains all eight sources at distances 1 and 3.

## Implementation and scope

The [investigation](m7-prompt9-investigation.md) profiled representative screenshots and a gradient against pinned libjxl 0.12.0. Native patch controls saved 9.80% on a development screenshot and 14.39% on the previously observed original screenshot. The pinned source in `enc_heuristics.cc` and `enc_patch_dictionary.cc` searches flat seeds and small foreground regions before choosing a VarDCT display with a Modular patch reference. Our earlier Modular-display probe was too large for this class. The retained first-party TypeScript implementation instead tries a flat-background patch atlas followed by a VarDCT display, and keeps it only when it saves at least 0.5% of bytes. It does not copy libjxl code or add a runtime dependency.

The selector applies to opaque sRGB RGB8 screenshots at effort 7, distance 2 through 4, and 0.26 through 4 MP. It does not enter lossless, transparent, HDR, other precision, effort-1/3, or larger original-size paths. The patch rectangles reconstruct chosen foreground pixels from the reference atlas. A focused test checks the public encode/decode path and preserves its input; a real Chromium test checks browser parity. The [optimization log](../../optimization-log.md) records the tested alternatives and selection cost.

## Measured before and after

Every approved capped source was scanned under a bounded 3 GiB, zero-swap run. Four development sources and two observed holdout sources met the selector. Their distance-2 and distance-3 first-party artifacts were freshly encoded, scored and checked by pinned native libjxl, pinned Rust, and the repository decoder. All 12 changed streams are smaller by 0.55% through 16.79%, and SSIMULACRA2 rises on all 12. Butteraugli is unchanged or improves on 10. It worsens on development `im26-8140` at distance 3 (2.6255 to 2.7027) and observed holdout `im26-8468` at distance 3 (3.01594 to 3.07362). All three decoders agree within one RGB8 level on the changed streams. The [raw point scores](m7-prompt9-evidence-index.json) link each source, artifact and decoder receipt.

The reports use the approved six-distance, at-most-2 MP sRGB matrix with its original family split and preprocessing. The previous complete per-case reports reconstruct the published baseline summaries exactly. Only the 12 changed first-party points were overlaid. The other 1,428 first-party points and pinned reference points keep their previous artifacts and scores because their source pixels, settings, tool versions, decoder policy and gated encoder paths are unchanged. No new timing is inferred from those scores.

| Bracketed matched-quality result against pinned libjxl | Before | After | Reviewed bound |
| --- | ---: | ---: | ---: |
| Development SSIMULACRA2 80 median / p90 | 1.0147 / 1.2165 | 1.0147 / 1.2142 | 1.35 / 1.60 |
| Development SSIMULACRA2 80 worst | 1.6480 | 1.5018 | No unexplained value above 2 |
| Observed holdout SSIMULACRA2 80 median / p90 | 1.0093 / 1.2249 | 1.0093 / 1.2249 | 1.35 / 1.60 |
| Observed holdout SSIMULACRA2 80 worst | 1.4302 | 1.3942 | No unexplained value above 2 |
| Development screenshot SSIMULACRA2 80 p90 | 1.6480 | 1.3953 | Class result retained |
| Observed holdout screenshot SSIMULACRA2 80 p90 | 1.4302 | 1.3942 | Class result retained |
| Development Butteraugli 2 p90 | 1.3014 | 1.2882 | 1.60 |

The largest measured worst across the reported bands remains the observed holdout Butteraugli-2 ratio of 1.6687. Bracket counts do not change: development SSIMULACRA2 70/80/90 has 57/112/106 of 120 sources, and observed holdout has 65/114/112. Butteraugli 1/2 has 120/120 in each split. The [bracket audit](m7-prompt8-bracket-audit.json) identifies missing native reference endpoints as well as first-party misses. The missing cases remain in the result files. These measured ratios cannot establish a complete matched-quality pass.

All 16 streams in the fixed eight-source original-size check were re-encoded on the frozen implementation. Fifteen streams match the previous encoded hashes. The observed 1920×1080 screenshot `im26-8160` at distance 3 falls from 167,981 to 154,440 bytes (8.06%); SSIMULACRA2 rises from 79.5247 to 79.9670 and Butteraugli improves slightly from 3.100129 to 3.099903. Its new SHA-256 is `a654132b1bb373f1a83f0602deca17f5d4dad4d80edda720f7242aa1fcf4ef33`. Native and Rust independent decoding agree within one level, and the repository decoder agrees. A 1:1 crop shows cleaner sidebar text while header ringing and photo texture smoothing remain. The original sunset gradient `im26-1416` remains at SSIMULACRA2 76.200 and Butteraugli 2.416 at distance 3. This eight-source check is an original-size supplement, not a full-resolution corpus result.

Both observed holdout screenshots had been inspected during tuning. They are regression evidence under their original source-family split, with no new unseen-generalization claim. The unchanged original-size sources and difficult cases remain in the replay.

## Target decision

| Reviewed target | Result | Evidence and limit |
| --- | --- | --- |
| Lossless SDR median/p90 at most 1.25/1.40, no unexplained worst above 1.75; old large-image gain | **Pass, unchanged path** | The [lossless target report](m7-prompt4-report.md) and its exact decoded streams apply. The selector does not run in lossless mode. Native RGB, alpha and RGB under zero alpha remain exact. |
| Lossless transparent RGBA8 and derived PQ16 | **Pass, unchanged path** | The [lossless expansion](m7-prompt4-lossless-expansion.json) records 1.2334/1.3171 median/p90 for native RGBA8 artwork, worst 1.5485, and byte-identical exact PQ16 streams. |
| 2 MP lossy matched-quality median/p90 at most 1.35/1.60; no unexplained worst above 2 | **Pass on measured brackets** | Both updated 120-source matrices above; largest measured worst 1.6687. |
| Complete SSIMULACRA2 70/80/90 brackets | **Fail** | The 57/112/106 and 65/114/112 matched counts remain. Additional endpoints are required for both pinned native and first-party gaps. |
| Bracketed photograph JPEG median below 1 at SSIMULACRA2 70 | **Pass on measured brackets, unchanged** | The [previous qualification](m7-prompt8-report.md) records 0.888 development and 0.889 observed holdout. Missing photo brackets remain visible. |
| Original-size text, screenshot and gradient quality and compression | **Fail overall** | Previous brochure gains and this screenshot gain are retained. The gradient and screenshot visual outliers remain, and eight originals do not establish a class-wide pass. |
| Native precision, color signaling and exact default lossy alpha | **Pass on checked cases, unchanged path** | The opaque RGB8 selector cannot enter HDR/alpha paths. Prior [HDR native-light and headroom 1/2/4 scores](m7-expansion-quality-development-integrated054.json) and [transparent black/white composites](m7-prompt6-report.md) remain applicable. |
| Complete HDR and transparency visual quality | **Fail** | Missing transparent brackets and retained HDR/alpha visual outliers in the prior reports. Capped SDR photographs do not establish original-size HDR or transparent quality. |
| Effort-1 paired median at most 8 times pinned native on the reference host | **Pass, unchanged path** | Prior [reference-host runtime evidence](m7-prompt8-report.md) records 5.608× cold and 6.957× warm. No new timing is claimed. |
| Original 12 MP public effort-3 workflow within 20 seconds on the reference host | **Pass, unchanged path** | Prior reference-host cold/warm runs take 4.484–4.645 seconds. No other-host equivalence is claimed. |
| Final conformance and resource gates | **Pass** | Frozen implementation: [39/39 conformance](m7-prompt9-conformance.json), [24/24 resource cases](m7-prompt9-resource.json), no raw exceptions or leaked ownership. |
| Stable lossy promotion | **Fail** | Complete matched-quality brackets and original-size HDR, transparency and visual quality requirements remain open. Lossy stays Experimental. |

The final `npm run check` passed 3,200 tests with three existing skips using two Vitest workers. `npm run browser:check`, the focused real Chromium screenshot test, and `npm run size:check` passed. The measured minified core-plus-JPEG XL and specialized JPEG XL bundles are 454,823 and 542,878 bytes; their ceilings are 455,000 and 543,000 bytes. The [evidence index](m7-prompt9-evidence-index.json) includes the full check log hash, 41 bounded receipts, raw scores, source pixels, encoded hashes and independent decoder outputs. The remaining work is to measure supplementary quality endpoints, repair the retained gradient/HDR/alpha visual outliers, and check genuinely unobserved sources before claiming generalization or Stable status.
