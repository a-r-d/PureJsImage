# JPEG XL HDR and transparency follow-up, September 24

Implementation revision: `bafa169bdd3df9aa22fcca28fbe4d4d05e98f5e9`. This is an encoder handoff, not a release or a Stable promotion. The six previously inspected transparent holdout families remain regression evidence. The [evidence index](m7-hdr-alpha-followup-evidence-index.json) links source, input, stream, raw-report and tool hashes. The [development](m7-hdr-alpha-followup-development.json) and [observed](m7-hdr-alpha-followup-observed.json) summaries retain every source and point, including missing brackets.

## Retained transparency change

At effort 7, lossy sRGB RGBA8 now uses the finer local AC quantizer in every block. The existing moderate color DC steps, adaptive LF smoothing, exact alpha coding, and replacement of color under fully transparent samples remain in place. Opaque, HDR, lossless and other alpha paths do not enter this condition. The change addresses colored-edge ringing that the previous luminance-only local quantizer missed.

Both six-family alpha grids ran at original 512×512 size, all six JXL distances and all declared black/white composites. Each split has 144 measured points and zero failures. All 36 first-party streams per split match pinned native and Rust decoders within one RGB8 level, match the repository decoder within one level, and preserve every alpha sample exactly. Development used a bounded 3 GiB, zero-swap process tree with a 542.6 MB peak; observed regression used the same bound with a 574.9 MB peak. Identical development output hashes permitted metric reuse from the earlier candidate run, while every final stream was decoded again.

At equal distance 3, median stream size rises 9.31% in development and 8.72% in observed regression. Median black/white SSIMULACRA2 gains are 2.16 and 2.29; median Butteraugli changes are -0.587 and -0.515. Every distance-3 family improves both metrics on both backgrounds. These equal-distance scores describe the visible change; compression decisions use matched quality. The table gives first-party/native byte ratios at matched quality. Each row has all six families bracketed.

| Split and background | SSIMULACRA2 90 median/p90 before | After | Butteraugli 2 median/p90 before | After |
| --- | ---: | ---: | ---: | ---: |
| Development, black | 1.113/1.199 | 1.104/1.204 | 1.235/1.310 | 1.176/1.279 |
| Development, white | 1.094/1.201 | 1.092/1.213 | 1.229/1.345 | 1.164/1.316 |
| Observed, black | 1.088/1.201 | 1.088/1.189 | 1.164/1.303 | 1.161/1.339 |
| Observed, white | 1.099/1.248 | 1.083/1.231 | 1.165/1.303 | 1.133/1.339 |

The observed Butteraugli-2 p90 rises to 1.339 even as its median improves; that tradeoff remains in the results. No matched SSIMULACRA2 70/80 summary is available on these tested curves. The missing target pairs remain explicit in the linked `unmatched` records. The observed `noto-1f3a8` distance-3 black composite improves from SSIMULACRA2 85.954 and Butteraugli 2.968 to 88.105 and 2.355 at 16,181 to 17,598 bytes. Its colored edges are cleaner in the 1:1 black and white views, but still show some ringing against the source and pinned native output. The visible defect is improved, not closed.

An isolated ten-sample warm core probe on `noto-1f338` moves from 312.5 to 320.3 ms median, and `noto-1f3a8` from 321.5 to 339.9 ms. The 3 GiB zero-swap process-tree peaks are 103.2 MB for the baseline probe and 91.4 MB for the candidate probe; those single-run peaks do not establish a memory gain. Managed encoder peaks change from 5.19 to 5.21 MB and 5.25 to 5.32 MB. These are effort-7 alpha diagnostics, not new effort-1 or public effort-3 timings. Raw receipts are `.tmp/jpegxl-m7/alpha-time-{baseline,candidate}.json` and `.tmp/jpegxl-m7/bounded-runs/alpha-time-{baseline,candidate}.json`.

## HDR decision

The HDR path was profiled on the original 2048×1024 `polyhaven-pedestrian_overpass` and a complete development HDR neighbor, with native-light error and headroom 1/2/4 scores. Uniform finer AC quantization reduces the overpass native-light RMSE from 0.02968 to 0.02346 and improves all display scores, but expands the distance-3 stream from 184,972 to 226,900 bytes. The old distance-2 stream is 233,772 bytes at similar display quality. An activity-limited variant still adds 11% bytes without a demonstrated matched-quality gain. PQ restoration adds 0.9% bytes and raises overpass SSIMULACRA2 by 0.87–1.16, but slips Butteraugli by 0.017–0.026 on two development-neighbor views. The 1:1 cable crop shows only a small visible change. These HDR candidates were reverted.

The final overpass stream is byte identical to the pinned prior HDR stream, SHA-256 `3069b3c1e95b6b8033d9184a29281e47f55cd97b5bfaaa4e7fa2119eb65777c1`. The [fresh independent decode](../../../.tmp/jpegxl-m7/hdr-holdout-alpha-q6-final/polyhaven-pedestrian_overpass/distance-3/report.json) passes PQ16 metadata, native/Rust pixel agreement, repository native-light decoding, and all three display views. Prior complete HDR development and observed reports remain applicable to that unchanged path. Cable roughness and texture smoothing at distance 3 remain open. The night-building clipping recorded in the earlier visual report belongs to the fixed display mapping, not the encoder.

## Qualification and scope

| Target | Result |
| --- | --- |
| Exact default lossy alpha and independent decoding | Pass on all 72 final first-party alpha streams. |
| Transparent matched-quality size on black and white | Pass on six measured Butteraugli-2 and SSIMULACRA2-90 pairs per split and background; highest listed p90 is 1.339, below 1.60. Missing 70/80 pairs remain unresolved. |
| Transparent visual edges | Improved at distance 3 on all 12 families; residual ringing remains on the inspected icon. |
| HDR native depth, color and display semantics | Pass on the fresh unchanged overpass stream and prior complete HDR grids. |
| HDR cable and texture defect | Open. No HDR candidate retained. |
| Approved opaque 2 MP lossy size, fixed eight originals, lossless and exact JPEG | Unchanged encoder paths; the prior reports remain the evidence. No new qualification is claimed from a capped image. |
| Effort-1 and original 12 MP effort-3 runtime | Unchanged paths; prior reference-host measurements remain applicable. Effort-7 alpha has the measured local cost above. |
| Conformance, resources and browser | [39/39 conformance](m7-hdr-alpha-followup-conformance.json), [24/24 resource cases](m7-hdr-alpha-followup-resource.json), the focused unit test and Chromium/Firefox/WebKit lossy RGBA8 parity pass. |
| Stable lossy scope | Not justified. HDR and colored-edge visual defects remain, and the quality-band coverage and other gaps in the [Stage A decision](m7-recovery-stage-a.md) are still visible. |

The JPEG XL specialized and core-plus-JPEG XL minified bundles each grow by 3 bytes, to 542,881/454,826 bytes. Both remain below their existing 543,000/455,000 ceilings. The generated package metrics and README size line were refreshed. No other budget, version or capability status changed.
