# JPEG XL transparent lossless qualification, September 23

Implementation revision: `49f3c25611210c4f04dd3f8907e5be8e28781317`. Previous qualified revision: `8925ce52fa06b2112310f60ccbe7f639eba0fdd1`. This change closes the combined native RGBA8 artwork size miss under the [M7 evaluation protocol](m7-evaluation-protocol.json). Lossy encoding remains Experimental.

## Change and measured result

For a single-group RGBA8 image of at most 262,144 pixels at lossless effort 7, the encoder now measures three palette orders in addition to its existing first-seen order. The orders group colors by luminance, Morton RGB code, or hue. It retains the smallest encoded stream. This search does not change any source RGB or alpha sample, including RGB under zero alpha. Other formats, lossy mode, and efforts 1, 3 and 5 keep their previous path.

The [raw 24-case expansion report](m7-prompt4-lossless-expansion.json) has the same original source families, source pixels, settings, pinned native reference, and development/observed-holdout split as the [previous report](m7-prompt3-lossless-expansion.json). All 12 RGBA8 artwork cases and 12 derived PQ16 HDR cases decoded exactly through pinned libjxl, pinned Rust, and the repository decoder. The seven improved artwork cases saved 5,729 bytes together; five retained their former encoded bytes. No artwork case grew. The 12 HDR streams are byte-identical to the previous revision.

| Native RGBA8 artwork, 12 families | Before | After | Reviewed bound |
| --- | ---: | ---: | ---: |
| Median first-party / pinned libjxl bytes | 1.290606 | **1.233412** | ≤1.25 |
| P90 ratio, nearest rank | 1.482599 | **1.317121** | ≤1.40 |
| Worst ratio | 1.588141 | **1.548490** | No unexplained case above 1.75 |
| Total first-party bytes | 160,286 | **154,557** | Smaller is better |
| Exact decoded samples | 12/12 | **12/12** | 12/12 |

The six development cases have median/p90 1.238376/1.548490 after this change; the six observed holdout cases have 1.231290/1.317121. At six cases, nearest-rank p90 is the worst case. The development face remains at 1.548490, below the 1.75 worst-case bound. The reviewed artwork median/p90 decision uses the full 12-family stratum. Both source splits remain visible, and the observed holdout was inspected while tuning. It is regression evidence, not an unseen generalization test.

The [representative cost report](m7-prompt4-palette-cost.json) records three post-warmup effort-7 timings per variant. Rainbow encoding rose from 1.086 s to 4.356 s median while shrinking from 6,390 to 5,494 bytes; managed peak rose from 11.09 to 12.17 MB. Robot encoding rose from 4.597 s to 7.283 s while shrinking from 12,001 to 10,252 bytes; managed peak rose from 26.43 to 26.46 MB. These are directional local measurements from diagnostic baseline code, with the baseline run first. Effort-7 artwork time is a real cost of the additional size search. The effort-1 and original 12 MP effort-3 runtime targets use unchanged paths; no new timing is claimed for them.

## Target decision

| Reviewed target | Result | Evidence |
| --- | --- | --- |
| 120 development and 120 observed-holdout SDR lossless median ≤1.25, p90 ≤1.40, worst ≤1.75 | **Pass, prior evidence applies** | The approved SDR evaluator feeds RGB8 only. Its source pixels, settings, encoded path, and three-decoder exactness are unchanged; [prior raw reports](m7-prompt3-lossless-development.json) and [observed holdout](m7-prompt3-lossless-holdout.json) remain 1.154/1.367 and 1.168/1.399516 median/p90. |
| Native transparent RGBA8 lossless size and exact samples | **Pass** | Combined artwork median/p90 1.233412/1.317121; worst 1.548490; 12/12 exact in all three decoders, including invisible RGB. |
| Derived PQ16 lossless size and exact samples | **Pass, byte-identical** | Median/p90 1.170711/1.327709; all 12 streams match the previous encoded hashes and decode exactly. These are derived PQ16 examples, not native integer-depth captures. |
| Old large-image lossless improvement ≥25% | **Pass, prior evidence applies** | The old RGB8 grouped path is unchanged; the [prior report](m7-pr35-lossless-regression.json) records 65.8% median reduction. |
| Effort-1 paired median ≤8× native; original 12 MP public effort-3 ≤20 s | **Prior pass, unchanged paths** | The [prior exact-commit runtime reports](m7-prompt3-runtime-commit-run1.json) and [public effort-3 report](m7-prompt3-public-effort3.json) recorded 7.067× warm and 4.572 s warm. These were not re-timed on this revision. |
| Matched-quality and original-size lossy promotion | **Fail, unchanged** | Missing SSIMULACRA2 brackets, retained original-size brochure/text outliers, and HDR/alpha quality gaps remain in the [prior target report](m7-prompt3-report.md). Lossy stays Experimental. |
| Final conformance and resource gates | **Pass** | Clean implementation revision: [39/39 conformance](m7-prompt4-conformance.json), [24/24 resource cases](m7-prompt4-resource.json), no raw exception or ownership leak. |

The full `npm run check` passed 3,193 tests with three skipped. The focused real Chromium lossless palette test passed. Measured bundles are 444,233 bytes for core plus JPEG XL and 532,304 bytes for the specialized JPEG XL entry, within the updated 444,500 and 532,500-byte ceilings. The [evidence index](m7-prompt4-evidence-index.json) links source, input, artifact, report, and oracle hashes. No Stable lossy promotion, version change, or release is part of this result.
