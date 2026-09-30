# JPEG XL lossy high-band reference ceiling, September 24

Implementation revision: `30d72d1a88a33e156fc6ed053c308d7268f4188d`. The codec is unchanged in this pass. Lossy remains Experimental. The [complete native ceiling report](m7-prompt10-native-ceiling.json) records every source, input, artifact, decoder, metric, tool and bounded-run hash. The [prior target table](m7-prompt9-report.md) remains the overall qualification result.

## Measured high-band limit

The approved 2 MP six-distance matrix has 14 development and eight observed-holdout sources without a pinned-libjxl SSIMULACRA2-90 bracket. The native encoder's `enc_params.h` sets a minimum positive lossy distance of 0.05; its source comment says lower distances are not useful and risk Level 5 limits. Two controls at requested distances 0.05 and 0.02 produced byte-identical native streams. A requested value below the floor therefore does not supply a finer native lossy endpoint for those controls.

All 22 native-missing sources were re-encoded at effort 7, distance 0.05 using the exact normalized pixels and original source-family split. Every stream decoded through pinned native libjxl and pinned Rust with at most one RGB8-level difference. SSIMULACRA2 and Butteraugli were rescored against those pixels. The isolated 3 GiB job completed with zero swap and a 979.7 MB process-tree peak. Twelve sources cross 90. **Ten still score below 90 at the native lossy floor:**

| Split | Source | Approved-grid maximum | Native at distance 0.05 |
| --- | --- | ---: | ---: |
| Development | im26-6834 | 88.839 | 89.789 |
| Development | im26-6800 | 89.055 | 89.712 |
| Development | im26-3312 | 88.932 | 89.748 |
| Development | im26-6832 | 88.623 | 89.824 |
| Development | im26-6094 | 88.441 | 89.380 |
| Development | im26-6822 | 88.882 | 89.858 |
| Development | im26-6030 | 89.062 | 89.947 |
| Development | im26-6830 | 88.990 | 89.879 |
| Observed holdout | im26-6833 | 88.259 | 89.024 |
| Observed holdout | im26-6825 | 87.623 | 88.363 |

The observed holdout was inspected in earlier encoder work and remains regression evidence. No source was excluded. These ten cases cannot obtain a native lossy SSIMULACRA2-90 bracket by adding another positive-distance endpoint to this pinned reference encoder. A lossless stream at distance zero is a different coding mode; it has not been substituted into the lossy curve or treated as an interpolated pass. The approved matrix and missing brackets remain intact. A reviewed change to the qualification method or reference would be required before complete high-band matched-quality coverage could be asserted.

## First-party and gradient diagnostics

A development-only first-party probe scaled the global quantizer to test distances below the existing public minimum of 0.25. At 0.0625, two missing high-band scans crossed 90 and passed native/Rust decoder agreement. Two other sources remained below 90. Attempts at 0.03125 and 0.01 hit the encoder's checked AC coefficient range; a 0.05 retry decoded but still missed 90 on those two sources. The prototype was reverted. The public distance range and encoded artifacts therefore remain unchanged. The failed bounded receipts are retained under `.tmp/jpegxl-m7/bounded-runs/prompt10-bracket-{ultra,mid}.json`, alongside the successful probes. No capability expansion is claimed.

The retained development gradient derivative has 12,124 of 12,288 blocks on the finer current quantizer setting; a neighboring photograph has 12,143 of 12,288. The proposed smooth-block threshold does not explain the gradient miss. A local planarity profile also failed to separate the gradient from the photograph strongly enough for an image-independent selector. No quantizer edit was retained. The original-size gradient and HDR/alpha visual outliers in the [prior report](m7-prompt9-report.md) remain open.

The [completed supplementary SSIMULACRA2-70 report](m7-prompt11-low-endpoints.json) has 187 new points across all 173 previously missing engine/source curves. Every curve now has a measured endpoint below 70; every new stream agrees across pinned native and Rust decoders within one RGB8 level, and the first-party streams agree with the repository decoder within one level. The resumed isolated 3 GiB run completed with zero swap and a 2.5 GiB process-tree peak. Its first phase was stopped after 49 points; the completed report and receipt supersede that partial diagnostic.

These are bracket-coverage measurements, not a completed size qualification. The distance-10 endpoint overshoots badly on some scans: 144 of 173 lower endpoints score below 65, and 23 score below zero. The median quality span between the old distance-5 upper endpoint and the new lower endpoint is 15.62 SSIMULACRA2 points. Closer measured endpoints are needed before drawing a reliable matched-size conclusion at 70. The approved six-distance matrix and original source splits remain unchanged.

## Target decision

| Reviewed target | Result |
| --- | --- |
| Pinned-native SSIMULACRA2-90 bracket on every approved source | **Fail.** Ten sources remain below 90 at the native minimum positive lossy distance. |
| Complete lossy matched-quality 70/80/90 bands | **Fail.** All previously missing 70 curves have supplementary wide brackets, but no 70 size ratio is claimed from them. Higher bands still have missing cases, including the ten native-reference 90 limits. |
| Measured 2 MP lossy size ratios, lossless qualification, and reference-host runtime targets | **Prior results unchanged.** No production codec code or timing path changed. |
| Original-size gradient, screenshot, HDR and transparency visual quality | **Fail overall, unchanged.** The prior outliers remain. |
| Stable lossy promotion | **Fail.** The reference ceiling and other retained quality gaps prevent an honest pass under the reviewed requirements. |

The latest implementation and its [full 2 MP development](m7-prompt9-quality-development.json), [observed holdout](m7-prompt9-quality-holdout.json), and [fixed eight-original](m7-prompt9-original-size-replay.json) evidence remain the qualification baseline. This investigation changes no source code, package version, capability status or runtime claim.
