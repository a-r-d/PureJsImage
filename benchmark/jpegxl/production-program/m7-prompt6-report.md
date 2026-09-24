# JPEG XL lossy alpha qualification, September 23

Implementation revision: `65c8a7ffb3c3308a41d09d9bba21890249555f12`. The earlier encoder revision is `7845fd1ff37352a6d8cfa8edbdb1def38373c945`. Lossy remains Experimental. Lossless remains qualified under the [lossless report](m7-prompt4-report.md).

The [evaluation protocol](m7-evaluation-protocol.json) and [approved 2 MP amendment](m7-bounded-quality-protocol.json) retain the original 120 development and 120 observed holdout source-family splits, SSIMULACRA2 70/80/90, Butteraugli 1/2, and the separate original-size, HDR and transparency checks. The six transparent observed-holdout families had already been inspected in earlier work. Their new results are regression evidence, with no unseen generalization claim.

## Retained change and alpha measurements

Effort-7 lossy RGBA8 with sRGB color signaling now uses less precise color DC steps and the JPEG XL adaptive LF smoothing flag. Alpha remains exact. Other efforts, opaque images, HDR/native precision, color signaling, and lossless output retain their previous paths. The [optimization log](../../optimization-log.md) records three rejected AC/transform tests, the unsmoothed alpha control, and the visual check. At equal distance the new stream may have a different quality score; only bracketed matched-quality sizes count toward the ratios below.

The [development alpha report](m7-prompt6-alpha-development.json) and [observed-holdout alpha report](m7-prompt6-alpha-observed-holdout.json) retain all 144 points per split, input and artifact hashes, decoder and metric tool hashes, both declared black/white composite scores, and every missing bracket. Each split has zero evaluation failures. All first-party streams pass pinned native libjxl, pinned Rust, and repository decoding within one RGB8 level, with zero alpha error. The bounded runs peak at 548.7 and 562.1 MB, with zero swap. They are serial quality checks, with no encoder speed claim.

The table shows median / p90 first-party byte ratios to pinned libjxl at matched quality, across the six transparent families in each split. `0/6` means no native matched bracket, so no ratio is reported. Every one of the 36 common matched-quality native-reference coordinates per split improves from the previous encoder.

| Split and background | SSIMULACRA2 90, before → after | Butteraugli 1, before → after | Butteraugli 2, before → after | SSIMULACRA2 70 / 80 bracket count after |
| --- | --- | --- | --- | --- |
| Development, black | 1.127 / 1.365 → **1.113 / 1.199** | 1.206 / 1.360 → **1.129 / 1.259** | 1.313 / 1.534 → **1.235 / 1.310** | 0/6, 1/6 |
| Development, white | 1.106 / 1.364 → **1.094 / 1.201** | 1.191 / 1.349 → **1.118 / 1.259** | 1.313 / 1.575 → **1.229 / 1.345** | 0/6, 1/6 |
| Observed holdout, black | 1.137 / 1.250 → **1.088 / 1.201** | 1.106 / 1.348 → **1.065 / 1.291** | 1.232 / 1.385 → **1.164 / 1.303** | 0/6, 0/6 |
| Observed holdout, white | 1.143 / 1.299 → **1.099 / 1.248** | 1.075 / 1.348 → **1.026 / 1.291** | 1.233 / 1.385 → **1.165 / 1.303** | 0/6, 0/6 |

The alpha improvement does not settle the remaining text-edge, gradient, texture, or HDR visual outliers. The [prior visual review](m7-prompt5-report.md) remains applicable to those unchanged paths. The observed holdout cannot support a new generalization claim because it has been used for regression review.

## Reused evidence and target decision

The [approved 2 MP development](m7-prompt2-quality-development.json) and [observed holdout](m7-prompt2-quality-holdout.json) matrices normalize input to opaque RGB8. The new branch is restricted to RGBA8 at effort 7, so their source pixels, settings, output artifact hashes, decoder and reference versions, and matched scores are unchanged. Their measured size bounds pass: median at most 1.35, p90 at most 1.60, and largest measured worst 1.669 below 2. Missing SSIMULACRA2 brackets remain visible: development 57/120, 112/120, 106/120; observed holdout 65/120, 114/120, 112/120 at bands 70, 80, 90. Butteraugli 1/2 are bracketed 120/120 in both. The [fixed eight original-size checks](m7-prompt5-original-size.json) also use unaffected opaque RGB8 output. They retain all 16 scores and hashes, including the improved but still large brochure cases. The separate [HDR headroom results](m7-expansion-quality-development-integrated054.json) use unchanged native-depth/HDR paths. They remain a quality gap; capped photographs cannot establish original-size HDR or screenshot quality.

The alpha change cannot enter effort-1 or effort-3 paths. Prior [reference-host paired effort-1 timings](m7-prompt5-runtime-paired.json) remain the applicable evidence: cold median 5.608× and warm median 6.957× pinned native, below 8×. The [original 12 MP public effort-3 workflow](m7-prompt5-public-effort3.json) remains at 4.484–4.645 seconds across its recorded cold/warm runs, below 20 seconds. These are reused timings for byte-identical unaffected paths; no new timing or other-host equivalence is claimed.

| Reviewed target | Result | Evidence |
| --- | --- | --- |
| Lossless median/p90 ≤1.25/1.40, no unexplained worst above 1.75, preserve large-image gains | **Pass, unchanged** | [Prior lossless qualification](m7-prompt4-report.md); the new RGBA8 lossy branch cannot enter lossless mode. |
| 2 MP lossy matched-quality median/p90 ≤1.35/1.60, no unexplained worst above 2 | **Pass on measured brackets** | Unchanged approved opaque RGB8 matrices; largest measured worst 1.669. |
| Complete SSIMULACRA2 70/80/90 bracket coverage | **Fail** | Approved 2 MP missing counts above; transparent SSIMULACRA2 70 is 0/6 in both splits and 80 is 1/6 or 0/6. |
| Bracketed photograph JPEG median below 1 at SSIMULACRA2 70 | **Pass on measured brackets** | Unchanged development 0.888 and observed holdout 0.889; unbracketed photographs remain in raw evidence. |
| Original-size text/screenshot/gradient quality and compression | **Fail overall** | [Fixed eight-original report](m7-prompt5-report.md) retains brochure size and visual outliers. |
| HDR and alpha precision, color and exact default alpha | **Pass for checked semantics** | 72 first-party alpha streams among 288 scored points pass native/Rust decoding with exact alpha; prior native-light and headroom 1/2/4 HDR checks unchanged. |
| Complete HDR and transparency visual quality | **Fail** | Transparent size improves, but missing brackets and retained HDR/alpha visual outliers prevent a full quality pass. |
| Effort-1 paired median ≤8× native | **Pass on unchanged path** | Prior reference-host cold 5.608×, warm 6.957×. |
| Original 12 MP public effort-3 ≤20 s | **Pass on unchanged path** | Prior reference-host cold/warm 4.484–4.645 s. |
| Final conformance and resource checks | **Pass** | [39/39 pinned conformance cases](m7-prompt6-conformance.json) and [24/24 resource and ownership cases](m7-prompt6-resource.json), on clean implementation revision `65c8a7f`. |
| Stable lossy promotion | **Fail** | Complete brackets and original-size visual quality requirements remain unmet. Lossy stays Experimental. |

`npm run check` passed with 3,196 tests and three existing skips. `npm run browser:check` passed. The focused lossy RGBA8 parity test passed in Chromium, Firefox and WebKit, and exact-alpha unit tests cover efforts 3, 5 and 7. Measured specialized JPEG XL and core-plus-JPEG XL bundles are 533,065 and 445,002 minified bytes, within the updated 533,100 and 445,100 byte ceilings. The [evidence index](m7-prompt6-evidence-index.json) records the implementation, source, protocol, input, artifact, report and oracle hashes. No Stable promotion, version change or release is claimed.
