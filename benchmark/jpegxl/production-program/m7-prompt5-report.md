# JPEG XL lossy qualification, September 23

Implementation revision: `4c23be521aaad656a56fe8e01258639168fb01ae`. Previous encoder revision: `dd59fde0092d163243255de44dcd89ec325b5beb`. This work improves large, pale documents at effort 7. Lossless remains qualified under the [prior report](m7-prompt4-report.md). Lossy remains Experimental.

The [evaluation protocol](m7-evaluation-protocol.json) and [approved 2 MP amendment](m7-bounded-quality-protocol.json) set the targets. The 120 development and 120 observed holdout source families remain separate. The eight original-size cases, HDR and alpha expansion, and public 12 MP runtime workflow remain separate checks. The observed holdout was already inspected during tuning; it is regression evidence, with no claim of unseen generalization.

## Retained change and measured result

Native libjxl's two original brochure streams at distance 3 grow from 243,762 to 670,599 bytes and from 149,228 to 736,428 bytes when its patch generator is disabled. The normal streams contain 3,579 and 5,663 patch placements. This [patch control](m7-prompt5-diagnostics.json) identifies a concrete coding gap while keeping normal libjxl output as the reference. The encoder now tries a first-party, step-4 quantized Modular stream after its existing VarDCT stream for sRGB RGB8 images of at least 8 MP at effort 7, distance at least 2, with at least 80% near-white sampled pixels. It keeps Modular only when it saves at least 20% of the bytes. A bounded optional-search failure returns the already encoded VarDCT stream. Other depths, color signaling, alpha, efforts and smaller images retain their prior paths.

The [fixed eight original-size replay](m7-prompt5-original-size.json) has 16 first-party points, at distances 1 and 3. All 16 decode with pinned native libjxl, pinned Rust and the repository decoder. Thirteen outputs, including the original 12 MP photograph and the distance-1 document points, have their prior encoded hashes and scores. The other three are below. The native distance-3 byte count is a same-setting diagnostic; equal distance does not establish equal quality. The scores give the quality comparison for these individual streams.

| Original-size case, effort 7 distance 3 | Before bytes | After bytes | Pinned native bytes | SSIMULACRA2 before → after | Butteraugli before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| im26-5034, development brochure | 796,979 | **481,225** | 243,762 | 84.811 → **88.500** | 2.514 → **0.919** |
| im26-5052, development brochure | 883,563 | **409,211** | 149,228 | 84.970 → **89.884** | 2.034 → **0.396** |
| im26-5337, observed holdout table | 303,942 | **180,010** | 217,853 | 84.454 → **89.429** | 2.428 → **1.830** |

Native, Rust and repository decoded pixels agree exactly for the three changed streams. Same-coordinate original-size text and table crops showed no new defect in visual review. The observed table had already been inspected and is regression evidence. The two development brochures remain larger than normal native output even after this improvement. The optional search also adds cost: three single cold effort-7 diagnostics took 23.82, 22.40 and 16.91 seconds with 120.5–135.5 MB managed peaks. These are not paired speed claims. The [optimization log](../../optimization-log.md) records rejected larger quantization steps, a smaller effort-5 candidate, neighboring classes, and a 100 MB budget fallback.

The approved [2 MP development matrix](m7-prompt2-quality-development.json), [observed holdout matrix](m7-prompt2-quality-holdout.json) and [artifact manifest](m7-prompt2-artifacts.json) remain valid for quality and size: every capped source is below this selector's 8 MP threshold, so source pixels, settings, encoded artifacts and decoder/reference versions are unchanged. No new capped timing is claimed. The measured SSIMULACRA2 70/80/90 and Butteraugli 1/2 brackets remain within the 1.35 median and 1.60 p90 libjxl size limits in both splits; the largest measured worst is 1.669, below 2. The missing SSIMULACRA2 brackets remain missing: development 57/120, 112/120 and 106/120; observed holdout 65/120, 114/120 and 112/120 at 70, 80 and 90. Both Butteraugli coordinates have 120/120 brackets in each split. The bracketed photograph median at SSIMULACRA2 70 remains 0.888 development and 0.889 observed holdout versus JPEG, with unbracketed photographs still visible in the raw reports. The [extra development probes](m7-prompt5-diagnostics.json) are exploratory and do not amend the approved matrix.

The change cannot enter the prior [HDR/alpha development](m7-expansion-quality-development-integrated054.json) or [observed holdout](m7-expansion-quality-holdout-integrated054.json) checks. Their native-light HDR scores, headroom 1/2/4 display views, declared black/white transparency backgrounds, retained visual outliers, and [exact default alpha decodes](m7-prompt3-alpha-conformance.json) remain the applicable evidence. The visual quality gaps are unresolved. A capped photograph result does not establish original-size HDR, transparency or screenshot quality.

## Runtime, correctness and target decision

Fresh [21-pair original 12 MP effort-1 measurements](m7-prompt5-runtime-paired.json) give median first-party/native core ratios of **5.608 cold** and **6.957 warm**, each below 8. The effort-1 output hash is unchanged. Fresh [public effort-3 measurements](m7-prompt5-public-effort3.json) give two cold encode-and-output times of 4.574 and 4.633 seconds and two warm times of 4.645 and 4.484 seconds, all below 20 seconds on the reference host. The runtime reports include input, oracle, output and harness hashes and keep cold and warm separate. These timings do not qualify other hosts.

| Reviewed target | Result | Evidence |
| --- | --- | --- |
| 2 MP matched-quality size: median ≤1.35, p90 ≤1.60, no unexplained worst above 2 | **Pass on measured brackets** | Both original source splits meet the size bounds; largest measured worst 1.669. Approved capped artifacts are unchanged. |
| Complete SSIMULACRA2 70/80/90 matched-quality coverage | **Fail** | Missing brackets remain in both splits, with counts above. No extrapolated pass. |
| Bracketed photograph JPEG median below 1 at SSIMULACRA2 70 | **Pass on measured brackets** | Development 0.888; observed holdout 0.889. Missing photo brackets remain. |
| Original-size text/screenshot/gradient quality and compression | **Fail overall** | Three large document points improve, but the two development brochures remain larger than normal native output. Existing text-edge, texture and gradient visual outliers remain. Only the fixed eight originals were replayed. |
| HDR and alpha semantics and visual quality | **Pass for checked semantics; fail for complete quality** | Default lossy alpha remains exact; established black/white, native-light and headroom views remain scored. Prior visual outliers remain. |
| Effort-1 paired median ≤8× native | **Pass** | Fresh 21-pair medians: 5.608 cold and 6.957 warm. |
| Original 12 MP public effort-3 ≤20 s | **Pass** | Fresh two cold and two warm runs: 4.484–4.645 s. |
| Final conformance and resource checks | **Pass** | [39/39 current expected conformance cases](m7-prompt5-conformance.json), [24/24 resource cases](m7-prompt5-resource.json), no raw exception or ownership leak. The conformance report's historical baseline flag reflects older expected-unsupported cases that now pass. |
| Stable lossy promotion | **Fail** | Complete matched-quality brackets and original-size HDR, alpha and visual quality gates have not passed. Lossy remains Experimental. |

The implementation passed `npm run check` with 3,194 passing tests and three skips, `npm run browser:check`, and a focused real Chromium selector test after the codec change. Measured specialized JPEG XL and core-plus-JPEG XL bundles are 532,888 and 444,817 bytes, within their 533,000 and 445,000-byte ceilings. The [evidence index](m7-prompt5-evidence-index.json) records source, protocol, input, artifact, report and oracle hashes. No Stable promotion, version change or release is part of this result.
