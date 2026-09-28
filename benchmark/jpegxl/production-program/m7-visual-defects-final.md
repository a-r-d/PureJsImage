# M7 lossy visual-defect follow-up

Final implementation revision: `55c1d74b2ced4f5bd85afb57580be04a427c4c15`, retaining the edge implementation from `df9bbd3d47c3947775763e52eecc42556ca0e785`. This report measures the public JPEG XL encoder after the earlier [visual review](m7-visual-followup.md). Lossy remains Experimental. The original 120 development and 120 observed source-family splits are intact. The observed families were inspected during tuning, so their results are regression evidence. No unseen-source generalization claim is made.

The [M7 evaluation protocol](m7-evaluation-protocol.json) and [2 MP amendment](m7-bounded-quality-protocol.json) define the thresholds, score bands, source treatment, and fixed eight original-size cases. Matched-quality ratios use measured, bracketed points. Missing brackets are never extrapolated into passes. The native RGB8 high-band ceiling established in the [Stage A classification](m7-recovery-classification.json) remains a tested-settings limit, not a PureJsImage comparison pass or failure.

## Retained implementation

At effort 7 and distances 2 through 4, opaque sRGB RGB8 blocks with a clear XYB Y gradient receive finer AC quantization. PQ RGB blocks use that extra precision only on thin active edges. The public lossy encoder also tries a first-party Modular stream for sRGB RGBA8 artwork at most 262,144 pixels with at most 2,048 distinct visible RGBA colors. It chooses Modular only when it saves at least 5% against VarDCT. The Modular choice preserves every alpha sample and visible RGB sample; lossy mode can normalize RGB under zero alpha. Pixel-lossless mode still preserves color under zero alpha. The previous screenshot patch selector remains active. Effort 1/3, lossless, exact JPEG reconstruction, native precision, and color signaling are outside these changes.

Small fixed diagnostics were used to choose the edge conditions. The [eight-image diagnostic](m7-visual-defects-small-diagnostic.json) and complete originals below confirm the direction. Broader PQ refinement, a texture-only SDR rule, and alpha chroma-gradient refinement were rejected after measured byte or Butteraugli regressions. The opaque RGB8 and PQ paths were frozen before the 2 MP and HDR qualification. A later full-suite regression found that a smooth, high-color RGBA image also selected Modular in nonprogressive mode. The bounded visible-color condition corrected that class boundary. Both complete transparency grids were rerun on the final source; all 72 public first-party stream hashes are identical to the earlier independently scored streams. The RGB8 and PQ paths cannot enter the new RGBA-only condition, so their source pixels, settings, encoded artifacts, decoders, and quality measurements remain applicable.

## Five registered visual defects

All figures below are effort 7, distance 3. The SDR figures use complete original-size RGB8 images. HDR uses native-light RGB and the established headroom 1/2/4 display views. Transparency uses straight RGBA8 and the declared black and white backgrounds. The linked images show source, previous stream, and final stream at 1:1 in that order.

| Case | Previous to final | Current visual decision |
| --- | --- | --- |
| Sunset `im26-1416`, sun contour and sky grain | 579,477 to 607,348 bytes; SSIMULACRA2 79.773 to 80.092; Butteraugli 2.179 to 2.052. [Sun](visual-defects/visual-edge-sunset-sun.webp), [grain](visual-defects/visual-edge-sunset-grain.webp). | Sun contour improves. Fine sky grain remains softened. Open. |
| Screenshot `im26-8160`, header edge and embedded photo | 167,421 to 178,857 bytes; SSIMULACRA2 81.794 to 83.614; Butteraugli 2.521 to 2.284. [Crop](visual-defects/visual-edge-screen-detail.webp). | Header and photo improve. Slight ringing and smoothing remain. Open. |
| Map `im26-5032`, colored lines and pale labels | 360,422 to 381,974 bytes; SSIMULACRA2 82.203 to 83.077; Butteraugli 2.524 to 2.204. [Crop](visual-defects/visual-edge-map-triptych.webp). | Lines and labels improve. A faint local halo remains. Open. |
| Transparent icon `noto-1f3a8`, color boundaries | 18,224 to 11,692 bytes; black/white SSIMULACRA2 88.897/88.604 to 100/100; Butteraugli 2.162 to 0 on both backgrounds. | The public stream is visible-color exact with sample-exact alpha. Resolved for this registered icon. |
| PQ16 overpass, cables and local texture | 188,613 to 188,979 bytes; native-light RMSE remains 0.02720; headroom 1/2/4 SSIMULACRA2 75.864/80.111/83.663 to 75.910/80.140/83.686; Butteraugli 2.991/2.471/1.881 to 2.886/2.350/1.854. [Cable crop](visual-defects/visual-thinedge3-hdr-cable.webp). | Thin cable edges improve slightly. Local texture smoothing remains. Open. |

The [fixed eight original-size report](m7-visual-defects-original-size.json) contains all 16 first-party coordinates. All 16 decoded in native libjxl, Rust, and the repository decoder. The eight distance-1 streams and three distance-3 Modular document streams retain their previous hashes. Four other distance-3 photographs and the screenshot gained quality with more bytes. The separately registered [map original](m7-visual-defects-map-original.json) also decoded in all three decoders. The [public capped screenshot points](m7-visual-defects-public-screenshot.json) measure the actual patch selector on the six previously inspected screenshot families. These are not a new unseen split.

## Matched-quality size

The [development](m7-visual-defects-quality-development.json) and [observed regression](m7-visual-defects-quality-observed.json) reports retain all 120 sources per split, five engines, and fixed settings. Changed first-party streams were freshly encoded, independently decoded, and scored. Identical comparator artifacts were reused only after source pixels, settings, tools, and decoded hashes were checked. The reported 2 MP ratios include the measured public screenshot selector points. These concurrent runs do not qualify encoding time.

| Split and target | Bracketed pairs | Median / p90 / worst ratio to libjxl |
| --- | ---: | ---: |
| Development SSIMULACRA2 70 | 57/120 | 1.051 / 1.150 / 1.290 |
| Development SSIMULACRA2 80 | 112/120 | 1.022 / 1.218 / 1.504 |
| Development SSIMULACRA2 90 | 106/120 | 0.976 / 1.043 / 1.121 |
| Development Butteraugli 1 / 2 | 120/120 each | 1.113 / 1.210 / 1.394; 1.115 / 1.269 / 1.457 |
| Observed SSIMULACRA2 70 | 65/120 | 1.065 / 1.184 / 1.411 |
| Observed SSIMULACRA2 80 | 114/120 | 1.024 / 1.232 / 1.429 |
| Observed SSIMULACRA2 90 | 112/120 | 0.977 / 1.048 / 1.435 |
| Observed Butteraugli 1 / 2 | 120/120 each | 1.117 / 1.221 / 1.521; 1.131 / 1.274 / 1.626 |

All measured libjxl rows meet the reviewed median 1.35, p90 1.60, and unexplained worst 2.00 bounds. The measured mozjpeg medians remain below 1 at each reported band, but some bands have few brackets. The public screenshot SSIMULACRA2-80 class p90 is 1.461 development and 1.429 observed, up from 1.440 and 1.419 in the previous candidate. The added edge precision has a real size cost. The complete summary JSON preserves class rows, other comparators, every missing pair, and all outliers.

## HDR and transparency

The original-size [HDR development](m7-visual-defects-hdr-alpha-development.json) and [HDR observed regression](m7-visual-defects-hdr-alpha-observed.json) summaries include 36 HDR settings per split with zero failed encodes or independent decodes. The final distance-3 PQ streams improve SSIMULACRA2 in all 12 images at headroom 1/2/4; their byte growth is 0.1% to 1.0%. One observed Butteraugli score rises by 0.002, while most are unchanged and the overpass improves. Native-light precision checks remain in each raw report. The highest libjxl matched p90 among reported HDR views is 1.508 in development and 1.435 in observed regression. Missing lower-score brackets, especially headroom-4 SSIMULACRA2 70, remain unbracketed. The known night-building highlight clipping originates in the fixed display mapping.

The public [transparency development](m7-visual-defects-alpha-public-development.json) and [observed regression](m7-visual-defects-alpha-public-observed.json) grids each retain six RGBA8 sources at six first-party distances and both declared backgrounds. They chose Modular at 29/36 and 35/36 settings respectively, with at least 5% savings for every selection. All selected Modular outputs preserve alpha and visible RGB exactly; the retained VarDCT output hashes match the previous direct baseline. Native libjxl, Rust, and repository decoders agree within the recorded tolerances. Modular selections are reported separately and are not inserted into a lossy-only matched-quality curve. The unchanged direct VarDCT transparency quality evidence remains in the [previous report](m7-visual-followup.md).

## Target decision and remaining limits

| Target | Result |
| --- | --- |
| Public stream correctness, color, precision, exact default lossy alpha | Pass on the affected 2 MP, fixed-original, HDR, and transparency checks. |
| Lossless sample preservation, including RGB under zero alpha, and exact JPEG | Unchanged implementation paths; prior [lossless qualification](m7-prompt4-report.md) remains applicable. |
| Measured lossy matched-quality size against libjxl | Pass on the bracketed 2 MP and reported HDR comparisons. Missing brackets are unresolved. |
| Measured JPEG median below 1 | Pass on reported bracketed 2 MP rows; thinly bracketed high bands remain limited evidence. |
| Fixed original-size visual defects | One of five registered cases resolved for its public stream. Four improve but retain visible local differences. No complete visual pass. |
| Reference-host effort-1 paired runtime at most 8 times native and original 12 MP public effort-3 within 20 seconds | Unchanged effort-1/3 paths. Prior [reference-host evidence](m7-prompt9-report.md) records 5.608 times cold, 6.957 times warm, and 4.484 to 4.645 seconds for the 12 MP workflow. No new timing or other-host equivalence is claimed. |
| Browser, conformance, resource, full repository check | `npm run check` passes 3,208 tests with three existing skips. The compact-artwork case passes in Chromium, Firefox, and WebKit. Clean-revision [conformance](m7-visual-defects-conformance.json) passes 39/39 expectations; [resource gates](m7-visual-defects-resource.json) pass 24/24 with zero raw exceptions and leaked ownership. |
| Stable lossy scope | Not justified. Four local visual defects, incomplete brackets, and the existing AC range and API limits remain. Lossy stays Experimental. |

The [evidence index](m7-visual-defects-evidence-index.json) records implementation and source hashes, input and encoded hashes for all five registered cases, report hashes, independent decoder tolerances, the full-check log hash, and the real-browser log hash. The ten [bounded-run receipts](m7-visual-defects-receipts/) retain the hard process-tree limits, zero-swap results, and memory peaks. Raw local report and artifact paths are preserved in the linked summaries and index. The clean conformance and resource runs both identify the exact implementation revision above.

The public distance range remains 0.25 through 25. Out-of-range quantized AC values are rejected rather than clamped; the validated DCT16 backend is still development-only. Ten pinned native RGB8 high-band controls remain below SSIMULACRA2 90 under tested settings. Those reference-limited rows are neither PureJsImage failures nor comparison passes. The JPEG XL core-plus-codec bundle is 456,008 minified bytes and specialized APIs are 544,074 bytes, up 1,002 bytes each from the previous visual follow-up and within the documented JPEG XL-only 460,000/548,000 ceilings. No version, release, Stable promotion, competitive-page content, or capability-label change is made.
