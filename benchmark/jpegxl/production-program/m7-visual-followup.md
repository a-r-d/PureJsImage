# JPEG XL lossy visual-defect follow-up, September 28

Implementation revision: `090e644d4b951410c675edce1ba0e36ae60a3681`. Lossy encoding remains Experimental. This change addresses the five finite review cases in the [Stage A register](m7-recovery-stage-a.md). The [evidence index](m7-visual-followup-evidence-index.json) records source pixels, stream and report hashes, independent decoding, tool identities, checks and bounded-run receipts. The original development and observed source-family splits are unchanged. The observed sources were inspected during tuning and are regression evidence, not unseen validation.

## Retained encoder changes

Effort-7 sRGB RGB8 uses a finer AC quantizer in active blocks at distances 2 through 4. Effort-7 sRGB RGBA8 uses a finer AC quantizer with the existing moderate color DC treatment and exact alpha. Effort-7 PQ RGB uses a finer AC quantizer only in bright active blocks. These measured changes leave lossless, exact JPEG reconstruction, effort 1/3, and non-PQ high-depth paths outside their conditions. Native depth and color signaling are preserved.

The table uses complete original images at effort 7, distance 3. SSIMULACRA2 is higher-is-better and Butteraugli is lower-is-better. The linked 1:1 crops show source, previous stream, and candidate stream from left to right. Crops are diagnostic views; rates and scores come from complete images.

| Registered defect | Previous to candidate | Visual decision |
| --- | --- | --- |
| Sunset `im26-1416`, sun contour and sky grain | 469,910 to 579,477 bytes; SSIMULACRA2 76.200 to 79.773; Butteraugli 2.416 to 2.179. [Sun](visual-defects/visual-sdrq5-gradient-sun.webp), [grain](visual-defects/visual-sdrq5-gradient-grain.webp). | Improved contour and detail. Some grain difference remains visible at 1:1. |
| Screenshot `im26-8160`, header edge and embedded photo | Public two-frame patch stream 154,440 to 167,421 bytes; SSIMULACRA2 79.967 to 81.794; Butteraugli 3.100 to 2.521. [Crop](visual-defects/screen-finepatch-triptych.webp). | Improved edge and texture while retaining the patch path. Residual header ringing and photo smoothing remain. |
| Map `im26-5032`, colored lines and pale labels | 346,917 to 360,422 bytes; SSIMULACRA2 80.871 to 82.203; Butteraugli 3.586 to 2.524. [Crop](visual-defects/visual-sdrq5-map.webp). | Labels and line edges improve. A faint local halo remains. |
| Transparent icon `noto-1f3a8`, colored boundaries | 17,598 to 18,224 bytes; black SSIMULACRA2 88.105 to 88.897, white 87.880 to 88.604; Butteraugli 2.355 to 2.162 on both backgrounds. [Black](visual-defects/alpha-q7-triptych-black.webp), [white](visual-defects/alpha-q7-triptych-white.webp). | Colored edges improve on both declared backgrounds. Alpha remains sample-exact. Residual color-edge roughness remains. |
| PQ16 overpass, cables and local texture | 184,972 to 188,613 bytes; native-light RMSE 0.02968 to 0.02720. At display headroom 1/2/4, SSIMULACRA2 rises 75.623/79.898/83.409 to 75.864/80.111/83.663; Butteraugli falls 3.240/2.768/2.321 to 2.991/2.471/1.881. [Cable](visual-defects/overpass-brightq5-cable.webp), [texture](visual-defects/overpass-brightq5-texture.webp). | Native-light and all three mapped views improve. Cable roughness and smoothed texture are still visible at 1:1. The separate night-building highlight clipping belongs to the fixed display mapping. |

All five new streams decode in pinned native libjxl and Rust. RGB8 streams differ by at most one sample between independent decoders; the PQ16 overpass differs by less than 0.00007 in native-light output. The repository decoder agrees on the checked streams. The icon preserves every alpha sample. The [full public eight-original replay](../../../.tmp/jpegxl-m7/visual-final-public-20260928-visual-final-20260928/report.json) passed all 16 points under an 8 GiB, zero-swap bound. All eight distance-1 streams and the three distance-3 Modular document streams retain their previous hashes. The direct VarDCT replay is a backend diagnostic and is not used as the public brochure result.

## Complete affected qualification

Both approved 2 MP RGB8 matrices ran on all 120 families in their original splits, with all five engines and all fixed coordinates. Exact prior comparator artifacts were reused only after source and tool identity checks; changed first-party streams were freshly decoded and scored. Twelve inspected screenshot points were measured through the public patch selector and overlaid on the complete direct-core matrices. [Development](m7-visual-followup-quality-development.json) and [observed regression](m7-visual-followup-quality-observed.json) retain all sources, comparisons and missing brackets. Both runs used 8 GiB bounds and zero swap; neither is a runtime benchmark.

| Matched quality against pinned libjxl | Development median/p90/worst | Observed median/p90/worst | Reviewed bound |
| --- | ---: | ---: | --- |
| SSIMULACRA2 80 | 1.001/1.215/1.502, 112 of 120 matched | 1.002/1.229/1.419, 114 of 120 matched | Median/p90 at most 1.35/1.60; no unexplained worst above 2 |
| Butteraugli 2 | 1.117/1.255/1.467, 120 of 120 matched | 1.143/1.295/1.667, 120 of 120 matched | Same size bounds |

SSIMULACRA2 70/80/90 bracket counts are 57/112/106 in development and 65/114/112 in observed regression, unchanged from the prior report. Butteraugli 1 and 2 have all 120 matched pairs per split. Missing comparisons remain in the linked reports; a reference target not reached under the tested settings is neither a first-party failure nor a pass. The full development and observed screenshot SSIMULACRA2-80 class p90 ratios are 1.440 and 1.419 after the public overlays. The two development brochures and observed table keep their prior public distance-3 hashes. All difficult sources remain in the matrices.

The original-size [HDR/alpha development](m7-visual-followup-hdr-alpha-development.json) and [observed regression](m7-visual-followup-hdr-alpha-observed.json) summaries include six HDR and six transparent families per split. Each split has 36 HDR points and 144 transparent points, zero failures, and independent decoding for every new first-party stream. Native-light checks and headroom 1/2/4 views are retained. For transparent black/white comparisons, all six libjxl pairs per split bracket SSIMULACRA2 90 and Butteraugli 1/2; the highest p90 ratio is 1.294. Lower SSIM targets remain unbracketed on these curves. HDR matched p90 is at most 1.537 across reported libjxl rows, with several missing lower-band comparisons retained. The PQ change improves native-light RMSE on all six development and six observed distance-3 images; one observed headroom-2 Butteraugli score worsens by 0.030 while the other measured views improve or hold. The HDR byte cost at distance 3 is 0.5% to 8.6% across those 12 images.

## Target decision

| Target | Result |
| --- | --- |
| Independently valid streams, exact default lossy alpha, native precision and color | Pass on the new original-size HDR/alpha grids, the 2 MP matrices and the fixed originals. |
| Lossless size and sample preservation, including color under zero alpha; exact JPEG | Unchanged paths. Prior [qualified lossless evidence](m7-prompt4-report.md) remains applicable. |
| Lossy matched-quality size | Pass on measured 2 MP brackets above. Missing brackets remain unresolved. |
| Original-size visual-defect register | Improved on all five inspected cases; residual local artifacts remain in the saved crops. This is not a complete visual-quality pass. |
| Effort-1 paired runtime and original 12 MP public effort-3 workflow | Unchanged paths. Prior reference-host cold/warm evidence remains applicable; no new timing or host equivalence is claimed. |
| Browser, conformance and resources | `npm run check` passed 3,207 tests with three existing skips. The nine focused Chromium/Firefox/WebKit screenshot, alpha and PQ checks passed. [Conformance](m7-visual-followup-conformance.json) passed 39/39 on the clean implementation revision. [Resource gates](m7-visual-followup-resource.json) passed 24/24, zero raw exceptions or leaked ownership. |
| Stable lossy scope | Not justified. Residual 1:1 defects, incomplete quality brackets and the existing resource/API limitations remain documented. Lossy stays Experimental. |

The public lossy distance range remains 0.25 through 25. Quantized AC values outside -4095 through 4095 are rejected rather than clamped; the validated DCT16 backend remains development-only. The ten pinned native RGB8 high-band controls in the [Stage A classification](m7-recovery-classification.json) still do not reach SSIMULACRA2 90 under the tested settings. Other first-party and narrow-bracket misses remain in the reports. None of these comparisons is counted as a pass by extrapolation. A new generalization claim needs sources unobserved after this implementation freeze.

The JPEG XL core-plus-codec and specialized minified bundles are 455,006 and 543,072 bytes, up 180 and 191 bytes from the prior alpha handoff. A 5 KB JPEG XL-only budget amendment allows the measured encoder work; unrelated budgets and package version are unchanged. No release, Stable promotion, competitive-page edit or README capability change is made.
