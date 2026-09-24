# JPEG XL lossy gap investigation, September 23

The implementation remains at `1b7e2df0263612a98ee527ee1e91b5fe408ff4c1`. No candidate in this investigation met the retention rule, so the [latest qualification result](m7-prompt6-report.md) and its encoded artifacts are unchanged. Lossy remains Experimental. The [evidence index](m7-prompt7-evidence-index.json) records raw report paths and hashes, source and input hashes, output hashes, and independent decoding results. The raw runs are local under `.tmp/jpegxl-m7/`; they were isolated and bounded. The previously observed holdout is regression evidence.

## Measured candidates

| Area | Before → candidate | Decision |
| --- | --- | --- |
| HDR PQ16 restoration, six development and six observed families | At the common matched-quality coordinates, development had 43 smaller, 13 larger, and 23 equal first-party byte positions; observed holdout had 40 smaller, 10 larger, and 26 equal. The largest regression was 3.06% at Butteraugli 2 in the observed lakeside headroom-4 view. First-party missing brackets rose from 7 to 10 in development and 12 to 13 in observed holdout. All 72 new streams passed independent and repository decoding. | Reverted. Small SSIM gains did not justify the Butteraugli regression or lost brackets. |
| Text-edge AC dead zone on eight small development derivatives | The four text/map distance-3 streams shrank about 2–4%, but SSIMULACRA2 fell by 0.26–0.91 and Butteraugli was mixed. A weaker threshold changed no output. All new streams decoded independently. | Reverted. Smaller equal-distance output did not establish a matched-quality gain. |
| AC entropy histograms, eight small development derivatives | Reducing effort-7 clusters from 96 to 32 enlarged the median stream by 0.70%; raising them to 192 saved only 0.12% at the median. All 48 candidate streams preserved quality scores and passed independent decoding. | Reverted. Neither closes the measured text size gap. |
| Large brochure quantization, original im26-5034 at distance 3 | Coarser step 16 changed 481,225 bytes, SSIMULACRA2 88.500, Butteraugli 0.919 to 431,604 bytes, 86.756, 6.157. Exact lossless output was 518,417 bytes on this brochure and 429,212 on im26-5052, both larger than the current lossy streams. | Reverted. The smaller step-16 stream damages perceptual quality. |
| Large brochure Modular coding, original im26-5034 at distance 3 | Deeper and longer match search reached 460,547 bytes, a 4.30% reduction with the same decoded pixels. Luma palette ordering reached 472,847 bytes, a 1.74% reduction. Both passed native, Rust, and repository decoding. A stronger gradient bucket instead grew the stream to 481,925 bytes. The match search increased isolated service runtime from about 32 to 38 seconds; these serial runs are not paired timing evidence. | Reverted. The added search and cost do not close the roughly 2× original brochure size gap. |

The original brochure's public effort-7 output is a single Modular frame. The pinned libjxl comparator has a Modular reference frame followed by a VarDCT display frame with patch flags. The [earlier controlled native run](../../optimization-log.md) counted 3,579 and 5,663 patch placements for the two development brochures and measured much larger native output with its patch generator disabled. Inspecting only the first native frame would miss this tool. The first-party large-document group profile shows all 15 groups choosing ordinary palettes, 14 using gradient contexts, and 12 using LZ77. These facts point to reference patches as the main remaining brochure coding gap. A first-party patch writer needs measured glyph selection, frame signaling, bounded reference storage, and independent decoding before it can be retained.

Supplemental distance probes on eight small development derivatives show why the frozen six-distance sweep misses many SSIMULACRA2 70 brackets: each tested first-party stream at distance 5 remains above 70. Sparse extensions alone are unreliable because native brochure scores show a sharp cliff between distances 9 and 10. The approved six-distance matrix was not changed or relabeled. The small derivatives and previously observed holdout cannot support a new unseen generalization claim.

## Current qualification

| Requirement | Result after this investigation |
| --- | --- |
| Lossy 2 MP matched-quality median/p90 at most 1.35/1.60 and no unexplained worst above 2 | **Pass on measured brackets**, unchanged. The largest measured worst is 1.669. |
| Complete SSIMULACRA2 70/80/90 brackets | **Fail**, unchanged. Development has 57/120, 112/120, 106/120; observed holdout has 65/120, 114/120, 112/120. |
| Original-size text, screenshot, and gradient quality and compression | **Fail**, unchanged. The brochure output and retained visual outliers remain in the fixed eight-source report. |
| HDR and transparency visual quality | **Fail overall**, unchanged. The HDR candidate above was reverted; prior alpha size gains do not resolve every quality or bracket miss. |
| Effort-1 paired median at most 8× native and original 12 MP effort-3 public workflow within 20 seconds on the reference host | **Pass on the prior frozen implementation**, unchanged. The prior warm paired median is 6.957× and the public workflow stays below 4.65 seconds. No new timing claim is made from the serial diagnostics here. |
| Stable lossy promotion | **Fail**. Lossy stays Experimental. |

The approved [2 MP quality reports](m7-prompt2-report.md), [eight original-size checks](m7-prompt5-original-size.json), and [HDR/alpha expansion report](m7-prompt6-report.md) remain the authoritative qualification. No full matrix rerun is claimed because no codec change was retained.
