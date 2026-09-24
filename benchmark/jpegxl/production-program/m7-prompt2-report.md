# JPEG XL encoder target qualification, Prompt 2

Implementation revision: 2643604888dc8ad58322a3756d5aade68af066b4. Starting revision: a5f0143bdf0b48e726108ca15099ac4a869fbb0a. M7 was already complete locally under its approved profile. This phase keeps lossy encoding Experimental.

The approved [evaluation protocol](m7-evaluation-protocol.json) and [2 MP amendment](m7-bounded-quality-protocol.json) govern the targets. The 120 development and 120 observed holdout sources keep their original family splits. All 240 SDR sources run at no more than 2 MP for the quality matrix. The fixed eight original-size sources, lossless originals, native RGBA8 artwork, and derived PQ16 HDR remain separate evidence. The observed holdout is regression evidence for this phase.

## Retained implementation and measured effect

A CPU profile of the original 12 MP RGB8 effort-1 workflow put time in XYB filling, AC filling, and DCT8. The retained encoder precomputes fixed effort-1 AC inverse scales and uses an aligned RGB8 XYB path where dimensions permit it. Other dimensions, channel layouts, and efforts use their existing paths. Two palette ideas for the lossless brochure and transparent artwork made no size gain and were reverted. A DCT load cache and an XYB contribution table did not improve the measured hot path and were reverted. The [optimization log](../../optimization-log.md) retains the small development measurements and rejected probes.

| Measure | Before | After | Result |
| --- | ---: | ---: | --- |
| Seven isolated warm own-core samples, median | 2039.910 ms | 1998.253 ms | 2.0% shorter in the development diagnostic; not a paired native gate |
| Original 12 MP effort-1 output SHA-256 | 76e8c8b48e231e56fdf58badc6d87449bd48082d54a7477313abe0db5b9f1ad5 | identical | No encoded-byte or quality change |
| Frozen 2 MP first-party artifacts | Previous M7 scored bytes | 1440/1440 fresh encodes byte-identical | Existing scores reused only after byte, pixel, settings, and tool checks |
| Fixed original-size points | 32 approved M7 points | 32/32 source pixels, bytes, decoded hashes, and scores identical | 16 fresh first-party streams decoded by native libjxl, Rust, and this repository |
| Paired warm effort-1 / native median | 8.085× in seven pairs | 8.067× and 8.142× in two independent 21-pair committed runs; pooled 8.069× | Fails 8× target |
| Original 12 MP public effort-3 | 4.554 s cold, 4.543 s warm | 4.504 s cold, 4.523 s warm | Passes 20 s target; timing variation is not attributed to the effort-1 change |

The earlier development 21-pair warm run measured 7.799×. It preceded a formatting-only source edit. Both runs against the exact committed revision miss the 8× gate, so that earlier pass does not qualify the target. Cold medians on the committed revision are 6.661× and 6.613×. All timing results belong to the recorded reference host; the concurrent 2 MP quality jobs are not speed evidence. Equal encoder distance is not equal perceptual quality.

## Quality and compression

Each 2 MP split has 120/120 complete sources, zero failed cases, 3600/3600 codec points, and 720/720 fresh first-party streams that match the previously scored byte hashes. Native decoding and ordered repository rows agree within one RGB8 level for all first-party points. The [development summary](m7-prompt2-quality-development.json), [holdout summary](m7-prompt2-quality-holdout.json), and [all-source artifact manifest](m7-prompt2-artifacts.json) preserve every source, category, original-source hash, normalized-pixel hash, encoded hash, decoded hash, measured score, and missing bracket. The per-source resumable raw reports and their SHA-256 values are indexed in the artifact manifest.

| Matched coordinate vs libjxl | Development matched / 120, median / p90 | Observed holdout matched / 120, median / p90 |
| --- | ---: | ---: |
| SSIMULACRA2 70 | 57, 1.033 / 1.116 | 65, 1.047 / 1.174 |
| SSIMULACRA2 80 | 112, 1.015 / 1.217 | 114, 1.009 / 1.225 |
| SSIMULACRA2 90 | 106, 0.977 / 1.043 | 112, 0.978 / 1.048 |
| Butteraugli 1 | 120, 1.113 / 1.210 | 120, 1.121 / 1.221 |
| Butteraugli 2 | 120, 1.140 / 1.301 | 120, 1.143 / 1.326 |

These ratios meet the 1.35 median and 1.60 p90 bounds where bracketed. Missing SSIMULACRA2 brackets remain missing, so complete matched-quality qualification fails. The worst capped libjxl ratio is 1.669, below 2; prior original-resolution text and screenshot outliers remain in the [M7 completion ledger](../../../docs/architecture/jpegxl-m6-m10-completion.md) and were not excluded. Among bracketed photograph sources at SSIMULACRA2 70, the JPEG median ratios are 0.888 for 45/64 development sources and 0.889 for 53/63 observed holdout sources; the below-1 size target passes for those brackets, with the missing brackets still visible. The [original-size report](m7-prompt2-original-size.json) retains both text outliers, all eight fixed sources, both distances, both metrics, and three-decoder checks. It does not make the capped matrix an original-resolution result.

The unchanged [lossless development report](m7-lossless-development-integrated054.json) passes at 1.154 median / 1.367 p90, while the unchanged [observed holdout report](m7-lossless-holdout-integrated054.json) fails at 1.168 / 1.409 against the 1.25 / 1.40 limits. No worst exceeds 1.75. The [old large-image regression](m7-pr35-lossless-regression.json) retains a 65.8% median byte reduction, above its 25% minimum. The unchanged [native RGBA8 and derived PQ16 lossless expansion](m7-lossless-expansion-integrated054.json) has exact color and alpha samples through all three decoders, including RGB under zero alpha. Derived PQ16 size passes at 1.171 / 1.328; RGBA8 artwork fails at 1.291 / 1.483. The attempted lossless palette changes were rejected, so these older size and sample measurements remain applicable to the unchanged lossless code path.

The [HDR and alpha development](m7-expansion-quality-development-integrated054.json) and [observed holdout](m7-expansion-quality-holdout-integrated054.json) reports retain native-light HDR checks, headroom 1/2/4 display views, black and white alpha backgrounds, exact default lossy alpha, and every missing bracket. Those effort-7 non-RGB8 paths and their scored artifacts did not change. Focused post-change forward checks also covered lossy alpha, gray/RGB/RGBA at 8/10/12/16-bit depth, and color signaling. Earlier visual reviews retain text-edge ringing, texture smoothing, gradient and alpha roughness, and HDR view findings. No new visual quality gain is claimed from byte-identical streams.

## Target result

| Target | Result | Evidence |
| --- | --- | --- |
| Lossless development size, worst, and exact samples | Pass | 1.154 / 1.367 / 1.674; exact native and repository output |
| Lossless observed holdout size | Fail | p90 1.409 exceeds 1.40 |
| Transparent lossless artwork size | Fail | 1.291 / 1.483 exceeds 1.25 / 1.40 |
| Derived PQ16 lossless size and old large-image reduction | Pass | 1.171 / 1.328; 65.8% large-image reduction |
| Bracketed 2 MP lossy size vs libjxl | Pass on measured brackets | Both split medians and p90 values are within 1.35 / 1.60; no capped worst above 2 |
| Complete lossy quality and original-size class coverage | Fail | Missing SSIMULACRA2 brackets, retained original text outliers, and limited original-resolution scope |
| Bracketed photo size vs JPEG at SSIMULACRA2 70 | Pass on measured brackets | Development 0.888; observed holdout 0.889; incomplete brackets retained |
| Alpha and HDR semantics | Pass for declared checks | Exact default alpha; black/white and native-light/headroom views retained; no broader HDR promotion |
| Effort-1 paired cold median vs native | Pass | 6.661× and 6.613×, each below 8× |
| Effort-1 paired warm median vs native | Fail | 8.067× and 8.142×, each above 8× |
| Original 12 MP public effort-3 within 20 s | Pass | 4.504 s cold and 4.523 s warm |

## Evidence and handoff

The [evidence index](m7-prompt2-evidence-index.json) gives the implementation commit, encoder source hash, SHA-256 for every linked report, and local bounded-run receipts. The [two exact-commit paired raw runs](m7-prompt2-runtime-commit-run1.json) and [second run](m7-prompt2-runtime-commit-run2.json) retain every cold/warm pair, input/output hash, native tool hash, RSS, managed memory, and measurement scope. The [earlier diagnostic run](m7-prompt2-runtime-preformat.json) is retained to show the threshold crossing. The [public workflow report](m7-prompt2-public-effort3.json) and [independent decoder receipt](m7-prompt2-runtime-decoding.json) cover both measured 12 MP streams. The [clean-checkout conformance](m7-prompt2-conformance.json) passed 39/39 cases, and the [resource report](m7-prompt2-resource.json) passed 24/24 with no raw exception or leaked ownership.

The full repository check passed with 3191 tests, three skipped tests, browser static/build checks, lint, formatting, and generated-file checks. Real Chromium JPEG XL pipeline and workbench coverage passed 29/29. The specialized JPEG XL bundle was 529991 bytes within the existing 530000-byte ceiling; core plus codec was 441917 within 442000. The final implementation is frozen at the revision above. Lossy remains Experimental, and no release or Stable promotion is claimed.
