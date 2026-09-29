# JPEG XL local contrast and visual-defect qualification

This work starts at `bacfb0a189e2a8946f03e78d0bef6e773b2356a2` on PR #37. It addresses the four remaining items in the [finite visual register](m7-recovery-stage-a.md), after the retained [transform selector](m7-visual-selector-public-20260929.md). The implementation is [`89395abd17027257d2b2d073abcd12a77c1622c2`](https://github.com/a-r-d/PureJsImage/commit/89395abd17027257d2b2d073abcd12a77c1622c2). The [evidence index](visual-contrast-20260929/evidence-index.json) links raw reports, input/artifact hashes, source hashes, independent decoders and final gate receipts. All final local gates passed.

## Implementation

At effort 7, RGB blocks receive one bounded quantizer refinement before transform selection. It has full strength at distances 2 through 4 and fades across distances 1 to 2 and 4 to 5. The encoder compares its existing reconstructed AC error with source variance in each decorrelated XYB channel. A relative error above 0.04 can raise the local quantizer, up to 8. Small absolute variance floors avoid spending bits on tiny residuals. Transform selection then measures alternatives at the refined quantizer. This is a local signal rule, with no source identifiers, image-class list, or external metric in production.

The reconstruction calculation already accounts for JPEG XL's normative quantization bias. Two initial nearest-reconstruction rounding trials produced small SSIMULACRA2 gains but added bytes and worsened Butteraugli on neighboring photos. They were rejected. Refining luma alone restored sunset grain but worsened HDR Butteraugli. Including color-channel error corrected that disagreement. The [small diagnostic reports and rejected patches](visual-contrast-20260929/) preserve all four trials, all 24 points per trial, independent decoder results, source hashes, and zero-swap receipts. The primary development objective was recovery of local contrast, with complete-image Butteraugli, size, and visible-artifact guardrails. No candidate was retained on a tiny interpolated rate advantage.

Pinned libjxl 0.12.0's `enc_adaptive_quantization.cc`, `enc_group.cc`, and `enc_ac_strategy.cc` informed the method: choose quantization using reconstructed error and local signal characteristics before judging transforms. Their hashes are retained in the evidence index. Production code is first-party TypeScript. No native code, WASM, runtime dependency, new public option, or extra full-image buffer was added.

Effort 1/3/5, distances at most 1 or at least 5, grayscale, alpha-bearing forward blocks, lossless samples including invisible RGB, and exact JPEG reconstruction keep their existing paths. The public RGB8 selector can still choose its cheaper transform or screenshot patch stream. Progressive output uses the same refined coefficients. Native precision, color signaling, coefficient-range rejection, and production memory limits are preserved.

## Four registered visual decisions

The table uses complete originals at effort 7, distance 3. Higher SSIMULACRA2 and lower Butteraugli are better. HDR uses the existing PQ16 input, native-light checks, and headroom 1/2/4 display mappings. These before/after numeric-distance comparisons establish the effect of the change; matched-quality compression is evaluated separately below.

| Registered case | Before to candidate | Visual decision |
| --- | --- | --- |
| Sunset `im26-1416`, 4000×3000 | 607,348 to 851,453 bytes; SSIMULACRA2 80.092 to 85.185; Butteraugli 2.052 to 1.518 | Closed for the registered contour and grain defects. [Sun](visual-contrast-20260929/sunset-sun.png) and [grain](visual-contrast-20260929/sunset-grain.png) show recovered fine texture and a cleaner contour without new banding or a contour halo. |
| Screenshot `im26-8160`, 1920×1080 | 178,857 to 201,346 bytes; SSIMULACRA2 83.614 to 85.404; Butteraugli 2.284 to 2.086 | Closed for the registered header/photo defects. The [header](visual-contrast-20260929/screenshot-header.png) retains its source shadow without objectionable added ringing; the [photo](visual-contrast-20260929/screenshot-photo.png) recovers hand, paper, and lettering detail. The reference/display patch structure remains, and all three decoders agree on the composed output. |
| Map `im26-5032`, 2590×3209 | 372,086 to 414,426 bytes; SSIMULACRA2 83.328 to 84.556; Butteraugli 2.039 to 1.695 | Closed for the registered halo/label defects. The [crop](visual-contrast-20260929/map.png) has cleaner colored boundaries and readable labels without the previous obvious pale edge contamination. |
| PQ16 overpass, 2048×1024 | 188,979 to 263,988 bytes; native-light RMSE 0.027198 to 0.021326. Headroom 1/2/4 SSIMULACRA2 75.910/80.140/83.686 to 84.414/87.214/89.299; Butteraugli 2.886/2.350/1.854 to 1.969/1.653/1.454 | Closed for the registered cable and texture defects. [Cable](visual-contrast-20260929/hdr-cable-headroom-2.png), [pavement](visual-contrast-20260929/hdr-texture-headroom-2.png), and [foliage](visual-contrast-20260929/hdr-foliage-headroom-2.png) recover local detail. All three headroom views are retained. No new clipping or color discontinuity was observed in these regions. |

Each PNG is lossless, with source/before/after panels at 1:1. Its adjacent `.png.json` records the actual decoded artifact, pixel hashes, source-space rectangle, and rendering conditions. The [crop command](../prepare-m7-visual-crop.ts) does no resampling or color conversion. The HDR views are the declared display mappings, not a physical HDR-monitor assessment. Native-light maximum error also falls from 8.819725 to 7.434836 in the declared units. The previously documented night-building highlight clipping belongs to its fixed display mapping.

These decisions apply the register's concrete expected corrections. Pixel identity with an uncompressed source is not a lossy acceptance criterion. Residual texture loss at lower quality settings remains normal lossy behavior; new reproducible banding, clipping, halos, or color/alpha errors would be new defects with specific artifacts. The previously resolved transparent icon remains visible-color exact with exact alpha.

## Frozen qualification

The contrast candidate was frozen before the approved 2 MP matrix. A later bounded HDR refinement exposed a quality step at its distance-window boundary. The final candidate adds a taper only at fractional distances between 1 and 2 and between 4 and 5. All six approved matrix settings keep exactly the previous quantizer decisions: the factor is one at 2 and 3, and refinement remains disabled at 0.25, 0.5, 1 and 5. The original matrix and raw artifacts are retained; final-source development and original-size byte replays, full HDR grids and affected fractional-distance checks establish the reuse boundary. The original 120 development and 120 observed source-family assignments remain intact. The observed families were inspected during tuning and remain regression evidence. Eight additional upstream validate/test families were selected after freezing, excluding the original families and all families already named in local artifact paths. The [selection](m7-visual-validation-selection.json) records code and metadata hashes. No unused eligible texture family remained, so the small supplement does not claim unseen texture-class coverage. The supplement was not used for tuning. It was unobserved at the first freeze; after the boundary correction it is retained as regression evidence, with no claim that it remains unseen for the final candidate.

The capped evaluator now measures `jpegxlCodec.createEncoder`, including public transform and patch selection, for every first-party point. Earlier direct-backend matrices and public screenshot overlays remain historical evidence. Unchanged comparator scores are reused only after input pixels, settings, artifact hashes, metric tools, and preprocessing match. First-party cache reuse requires current implementation identity or fresh encoded-byte validation. New timings come from new runs.

The observed run was resumed from saved checkpoints after an incomplete older cache caused unnecessary comparator encodes. Both receipts and all completed results are retained. No source was removed. The approved [evaluation protocol](m7-evaluation-protocol.json), [2 MP amendment](m7-bounded-quality-protocol.json), and [Stage A clarification](m7-recovery-stage-a.md) remain authoritative. Missing brackets and tested-reference limits are not comparison passes, and lossless points are not substituted into lossy-only curves.

## Capped matched-quality results

Both approved 120-source matrices completed with zero failed or missing sources. All 7,200 raw encoder points, settings, pixel/stream/decoder hashes and reuse records are preserved in the [compressed raw reports](visual-contrast-20260929/capped-raw-reports.json.gz). The [development](visual-contrast-20260929/quality-development.json) and [observed regression](visual-contrast-20260929/quality-observed.json) summaries retain all comparators and class strata.

| Split | Target | Bracketed / 120 | Median / p90 / worst bytes relative to libjxl |
| --- | --- | ---: | --- |
| development | ssimulacra2 70 | 57 | 1.058 / 1.176 / 1.295 |
| development | ssimulacra2 80 | 112 | 1.051 / 1.241 / 1.510 |
| development | ssimulacra2 90 | 106 | 0.976 / 1.040 / 1.121 |
| development | butteraugli 1 | 120 | 1.090 / 1.176 / 1.388 |
| development | butteraugli 2 | 120 | 1.136 / 1.275 / 1.451 |
| observed | ssimulacra2 70 | 65 | 1.072 / 1.189 / 1.421 |
| observed | ssimulacra2 80 | 114 | 1.048 / 1.242 / 1.439 |
| observed | ssimulacra2 90 | 112 | 0.977 / 1.048 / 1.359 |
| observed | butteraugli 1 | 120 | 1.101 / 1.197 / 1.521 |
| observed | butteraugli 2 | 120 | 1.131 / 1.265 / 1.608 |

The reviewed median/p90 limits of 1.35/1.60 and unexplained-worst limit of 2 pass on measured comparisons. Photo-only mozjpeg medians also remain below 1: development 0.911/0.844/0.806 for SSIMULACRA2 70/80/90, observed 0.915/0.861/0.746. Photo Butteraugli 1/2 medians are 0.815/0.698 and 0.780/0.723. High-quality JPEG brackets are sparse, including only one development photo at Butteraugli 1. Every reported class with a measured JPEG median remains below 1. Empty class/target cells remain empty.

The [target classifier](visual-contrast-20260929/classification.json) retains all 720 source/SSIMULACRA2-target comparisons: 80 have adequate nearby brackets, 618 have insufficient sampling, and 22 have a reference maximum below the requested target under this six-point configuration. Sixteen of those 22 also have a first-party maximum below target. There are no unsupported or execution/correctness-failure rows. The exclusive first-party-only target-miss count is zero; it does not erase those 16 overlapping misses. A three-score interval is the existing diagnostic for deciding small rate differences, not an all-source promotion gate. Grid maxima are not proven codec ceilings. Historical high-quality controls and all missing brackets remain visible; no extrapolation or lossless point substitution establishes a pass.

## HDR and alpha qualification

Both complete original-size HDR grids passed 36 settings each with zero failed encodes or independent decodes. The [development](visual-contrast-20260929/hdr-alpha-development.json) and [observed](visual-contrast-20260929/hdr-alpha-holdout.json) summaries retain native-light checks and all headroom 1/2/4 comparisons. The [raw HDR reports](visual-contrast-20260929/hdr-raw-reports.json.gz) preserve every point, source, stream and tool identity. The development grid's largest measured median/p90 ratios are 1.214/1.493. The observed grid's largest p90 is 1.451.

The observed headroom-1 SSIMULACRA2-70 grid median is 1.3596, slightly above 1.35. Its first-party endpoints span roughly 17 to 22 score units, so that coarse interpolation is retained as a grid miss, superseded for the final aggregate decision by the nearby measurements below. The reusable `refine-m7-hdr-target.ts` command measures at most four additional points per engine and original family, keeps nondominated measured points, reports nonmonotonicity, checks artifact/tool/source identities, and stops at a three-score bracket or its configured limit. It refines every observed HDR family at this target and does not change the frozen encoder. The final decision below includes these controls and every unresolved interval.

The public [alpha development](visual-contrast-20260929/alpha-public-development.json) and [observed alpha](visual-contrast-20260929/alpha-public-holdout.json) checks passed all 72 settings, including fresh native, Rust and repository decodes and black/white composites. All 72 encoded hashes match the previously qualified public outputs. Modular selections are 29/36 and 35/36 respectively; those preserve visible RGB and every alpha sample exactly. The remaining eight VarDCT streams preserve exact alpha. Their [raw reports](visual-contrast-20260929/alpha-raw-reports.json.gz) retain straight-color diagnostics and both background scores. Exact Modular selections remain separate from lossy-only quality curves. The unchanged direct-VarDCT alpha comparison evidence is retained in the HDR/alpha summaries above.

## Frozen new-family supplement

The eight post-freeze selections completed all 96 points with no encode, decode or metric failures. The [raw results](visual-contrast-20260929/validation-raw.json) and [summary](visual-contrast-20260929/validation-summary.json) retain every selection and missing comparison. This is a small family-disjoint RGB8 check capped at 2 MP. It makes no new original-size, HDR, transparency or texture-class claim.

| Target | Bracketed / 8 | Median / p90 / worst ratio to libjxl |
| --- | ---: | --- |
| SSIMULACRA2 70 | 5 | 1.040 / 1.123 / 1.123 |
| SSIMULACRA2 80 | 5 | 1.000 / 1.064 / 1.064 |
| SSIMULACRA2 90 | 8 | 0.976 / 1.196 / 1.196 |
| Butteraugli 1 | 8 | 1.101 / 1.278 / 1.278 |
| Butteraugli 2 | 8 | 1.157 / 1.251 / 1.251 |

The later boundary correction was driven by the observed HDR diagnostic, not these results. These eight families now remain regression evidence for the final candidate; no fresh generalization claim is made. The six absent lower-band comparisons remain missing and are not counted as passes.

## Complete originals and neighboring classes

The [fixed eight originals](visual-contrast-20260929/originals-final.json) passed all 16 first-party coordinates with native, Rust and repository decoding. Their full-quality run used the approved 8 GiB process envelope and peaked at 4 GiB with zero swap. The [map supplement](visual-contrast-20260929/map-final.json) passed both settings. All four registered defect streams reproduce the candidate artifact hashes from the earlier original-size probes.

The [native-original reuse audit](visual-contrast-20260929/native-original-reuse.json) checks all 16 stored native streams and decoded RGB8 hashes against the pinned tool binaries and current source pixels, dimensions and settings before reusing their quality scores. It makes no new timing claim. These eight originals remain a finite supplement, not an all-source full-resolution compression claim.

At distance 3, the other photo `im26-1030` improves SSIMULACRA2 82.571 to 84.253 and Butteraugli 1.936 to 1.633, with 751,812 to 912,808 bytes. The observed city photo `im26-1009` improves 83.414 to 85.318 and 1.932 to 1.569, with 2,286,581 to 2,597,868 bytes. The interior `im26-1221` improves 81.546 to 84.129 and 2.107 to 1.783, with 2,088,631 to 2,410,723 bytes. The three document/table distance-3 artifacts remain byte-identical. Native-scale source/before/after center crops and their sidecars are retained beside the registered defect crops; they show no new visible edge, color or texture defect in those regions.

The initial nine focused Node/browser checks passed in Chromium, Firefox and WebKit: ordinary and progressive local contrast, plus the public rate-distortion selector. The deterministic 129×65 texture test improves source RMSE from 3.362 to 2.796 and recovered contrast from 0.745 to 0.825. Its two source-quality unit tests exercise odd dimensions and both output modes; two additional tests cover the corrected distance boundaries. The independent small-fixture and final HDR/alpha browser checks are recorded with the final gates below.

## Distance-boundary correction

The first bounded HDR refinement retained its [raw decision](visual-contrast-20260929/hdr-refinement-before-transition.json). Two comparisons obtained close brackets, but four remained more than ten score units wide after the configured four probes. The cause was a sharp drop when local contrast refinement stopped above distance 4. The final first-party rule tapers its extra quantizer precision across 1 to 2 and 4 to 5. It changes no approved six-point matrix coordinate and does not add an image-class detector.

The [regression evidence](visual-contrast-20260929/transition-regression.json) reproduces both boundaries on the same deterministic colored texture in ordinary and progressive output. The RMSE step from 1.99 to 2.01 falls from 1.234 to 0.027; the step from 3.99 to 4.01 falls from 1.324 to 0.055. Tests require less than 0.1 RMSE difference across these neighboring settings and preserve the original distance-3 source-quality requirements. This is a specific quality-control correction, not a claim that every metric is monotonic on every source. The pre-transition implementation is preserved as a patch against the starting revision.

For grid reuse, both versions skip refinement at 0.25, 0.5, 1 and 5. At 2 and 3 the final strength is exactly one. The current and target quantizers are integers, so adding the rounded positive difference makes exactly the prior update; when the target is no larger, both versions leave the current quantizer unchanged. This identity also holds at distance 4 and is independent of image content. No other production path changed in the taper. Fresh final-source development, complete-original and HDR byte comparisons verify this reasoning on the retained artifacts. The 240-source matrix scores remain the recorded measurements of those unchanged settings, with their original run conditions and missing brackets. They are not presented as a second newly timed matrix.

### Final HDR size decision

The [expanded observed curves](visual-contrast-20260929/hdr-expanded-holdout.json) include every final fixed-grid point and every added control across all three headroom views and both metrics. All reported median/p90/worst ratios pass 1.35/1.60/2. Headroom-4 score 70 remains unbracketed for all six sources. Other missing Butteraugli and lower-band comparisons remain visible. The [raw expanded reports](visual-contrast-20260929/hdr-expanded-holdout-raw.json.gz) retain source, stream, decoder, rendering and tool identities.

For the borderline headroom-1 score-70 row, the final measured frontier gives median/p90/worst 1.291/1.408/1.408. Some intervals remain wider than three scores because quantizer decisions are discrete. The [bounded decision](visual-contrast-20260929/hdr-refinement-final.json) therefore also uses a conservative size bound: charge the first-party encoder the measured endpoint above the target, and charge native libjxl the endpoint below it. Every interpolated ratio lies below that bound on its nondominated curve. The median/p90/worst of these upper bounds are 1.315/1.509/1.509, which pass the unchanged targets. This establishes the aggregate decision without relying on a small favorable interpolation or claiming the wide intervals are adequate for fine rate comparisons. All six families remain in the decision. No further endpoint search is needed for this gate.

The nearby [native map controls](visual-contrast-20260929/native-map.json) retain the metric disagreement: at almost the same SSIMULACRA2 (84.503 native versus 84.556 first-party), native uses 473,862 versus 414,426 bytes but has lower Butteraugli (1.164 versus 1.695). Native distance 1.6 measures Butteraugli 1.722 at 378,701 bytes. Neither score is treated as the single definition of visual quality. The [native overpass control](visual-contrast-20260929/hdr-native-control.json) at distance 1.3 uses 231,608 bytes and measures headroom-1 SSIMULACRA2 84.437 versus 84.414 for the 263,988-byte first-party stream. Their Butteraugli scores are 1.878 and 1.969. At headroom 2 the first-party stream has lower Butteraugli; at headroom 4 native does. These complete-original controls supplement the visual decisions and preserve the disagreements.

## Final source verification, runtime and bundle cost

The final production encoder has SHA-256 `06f16984b99a374f6af9f69079ae24ac7608a0609c5a65fc3d9dbd16d75d2211`. Fresh final-source replays match all 24 development diagnostic streams, all 18 complete-original/map streams, and [all 72 HDR grid streams](visual-contrast-20260929/hdr-final-source-replay.json). The [final HDR raw records](visual-contrast-20260929/hdr-final-source-raw.json.gz) include new independent decodes and explicit metric-reuse provenance.

The [small independent fixture checks](visual-contrast-20260929/fixture-oracles.json) pass all six ordinary/progressive cases at distances 1.5, 3 and 4.5. Native libjxl, Rust jxl-rs and repository output differ by at most one RGB8 sample unit. Source reconstruction errors are measured separately. All **21 final browser checks** pass across Chromium, Firefox and WebKit, covering local contrast, distance transitions, public selection, native PQ16 and exact RGBA8 alpha. The earlier nine-check run remains historical evidence.

The table measures the public 12 MP sunset workflow at effort 7, distance 3, including input staging and output-file writes. Each cell is one isolated run with the same CPU allowance. These are descriptive samples, not a statistical speed claim. Cold and warm mean process codec state; they do not imply eviction of the operating-system file cache. The before revision is the starting commit, built separately. The final stream includes a 40-byte public container around the raw stream in the visual table.

| Measurement | Before | Final candidate |
| --- | ---: | ---: |
| Cold workflow | 18.385 s | 21.439 s |
| Warm workflow | 19.518 s | 21.771 s |
| Encoder-managed peak | 51,567,958 bytes | 51,815,596 bytes |
| Encoded public output | 607,388 bytes | 851,493 bytes |
| Final absolute process peak RSS, cold / warm | See baseline raw records | 273,969,152 / 284,057,600 bytes |

[Before cold](visual-contrast-20260929/runtime-baseline-equivalent-cold.json), [before warm](visual-contrast-20260929/runtime-baseline-equivalent-warm.json), [final cold](visual-contrast-20260929/runtime-final-cold.json), and [final warm](visual-contrast-20260929/runtime-final-warm.json) retain input/output hashes, garbage-collected baselines, ArrayBuffer/external memory and phase timings. Their adjacent receipts record zero swap and process-tree limits. The encoder releases all managed allocations. The 8 GiB allowance for original-size metric subprocesses is separate from encoder-managed memory and process RSS. Effort 7 pays additional time and bytes for the detail correction; the reviewed 20-second original workflow target is effort 3, which passes separately.

The core-plus-JPEG-XL bundle grows from 457,171 to **457,603 bytes (+432)**. The specialized bundle grows from 545,226 to **545,673 bytes (+447)**. Both fit the already approved JPEG XL budgets of 460,000 and 548,000 bytes. No unrelated budget or dependency changed.

## Handoff decision

1. **Implemented behavior and correctness.** The documented static integer gray/RGB/RGBA forward encoder, including optional progressive output, is the qualified Stable scope after the final gates below. Streams retain declared color and native precision. Default lossy alpha stays exact. The first-party TypeScript implementation remains portable and has no runtime dependency tree. Lossless color under zero alpha and exact JPEG reconstruction keep their prior guarantees.
2. **Concrete defects and limits.** The four registered visual corrections are closed on their declared originals and views; the earlier transparent-icon correction remains exact in visible color and alpha. The distance-boundary defect found during qualification is also fixed. The public range remains 0.25 through 25. AC magnitudes above 4095 remain an explicit implementation limit with `UNSUPPORTED_OPERATION`, not a claim about the format's full coefficient range. HLG, custom chromaticities, premultiplied forward alpha, larger DCT/AFV and Gaborish writing remain unsupported. Encoder memory limits are unchanged; the 8 GiB metric-process envelope does not relax them. The documented HDR display-mapping clipping remains a rendering limitation.
3. **Compression and speed.** The measured SDR and expanded HDR ratios pass the existing limits, including the conservative HDR bound. Photo JPEG medians stay below 1 on measured brackets. Effort-1 keeps the unchanged reference-host paired evidence of 5.608 times cold and 6.957 times warm, under 8. Fresh original 12 MP effort-3 timings are 4.759 seconds cold and 4.791 seconds warm, under 20. Effort-7 detail costs more bytes and time; its separate before/after measurements are reported below without claiming a speed win.
4. **Coverage.** Preserve all 240 original families, the fixed eight originals, the map supplement, all HDR/alpha sources, every failed/unsupported/missing classification, and the original/capped distinction. Observed sources and the first-freeze eight-family supplement remain regression evidence for the final candidate. Reference-limited and wide comparisons are neither hidden nor converted into individual passes. The aggregate HDR upper bound is a separate justified decision. No fresh all-class generalization or full-resolution corpus claim is made.
5. **Stable scope.** The explicit decision is Stable for the documented static lossy subset after final repository, browser, conformance and resource gates passed. Lossy animation remains Experimental. This decision changes capability documentation, with no version change or release. Competitive and marketing work is outside this handoff.

| Target | Qualification result |
| --- | --- |
| First-party stream validity, native color/precision, exact default alpha | Pass in measured SDR, original, HDR and alpha checks; changed streams decoded independently. |
| Four remaining visual defects | Closed against the finite registered criteria, with complete originals and retained 1:1 crops. |
| Lossless/exact JPEG guarantees and prior lossless compression targets | Preserved; unchanged paths and prior [lossless qualification](m7-prompt4-report.md), with full regression checks. |
| SDR lossy/libjxl median ≤1.35, p90 ≤1.60, unexplained worst ≤2 | Pass on measured approved comparisons; missing bands remain unscored. |
| HDR class size targets | Pass on measured views, including score-70 median upper bound 1.315 and p90/worst upper bound 1.509. |
| JPEG median ratio <1 | Pass on measured aggregate and photo/class rows; sparse high-band coverage stays explicit. |
| Reference-host effort-1 paired median ≤8 times native | Pass from unchanged-path reference-host evidence; no new paired timing claimed. |
| Original 12 MP public effort-3 ≤20 seconds | Pass: 4.759 seconds cold, 4.791 seconds warm. |
| Full local check, real browsers, conformance and resource checks | Pass: 3,213 tests with three existing skips; 21 browser checks; 39/39 conformance expectations; 12 fuzz and 12 resource cases. |
| Stable documented static lossy scope | Qualified. Lossy animation remains Experimental; no release or version change. |

## Final local gates

`npm run check` passed with **3,213 tests and three existing skips**, including generated capability/size/documentation checks, documentation build, TypeScript, package types, browser portability, lint and formatting. The [full-check receipt](visual-contrast-20260929/full-check-receipt.json) records a 2.1 GiB process-tree peak and zero swap. The [complete log](visual-contrast-20260929/full-check.log.gz) is retained. Earlier attempts exposed stale generated metrics, formatting in two previous-stage JSON views, and a standalone oracle command placed in the manifest's test-only evidence list; those bookkeeping issues were corrected without changing codec behavior or tolerances. The original previous-stage JSON bytes are retained in compressed copies. The focused encoder suite passes all 37 tests.

Clean implementation commit `89395abd17027257d2b2d073abcd12a77c1622c2` passed [39/39 conformance expectations](visual-contrast-20260929/conformance.json) and [12 fuzz plus 12 resource cases](visual-contrast-20260929/resource.json), with no raw exceptions or leaked managed ownership. The [conformance](visual-contrast-20260929/conformance-receipt.json) and [resource](visual-contrast-20260929/resource-receipt.json) receipts retain their process limits and zero-swap results. These gates ran after the last codec change. The following evidence commit only completes this report and adds the gate records and hash index.

All 21 final real-browser checks and six independent normal/progressive fixture checks passed as recorded above. No CI job was added. Remote pull-request checks remain separate from this local qualification.
