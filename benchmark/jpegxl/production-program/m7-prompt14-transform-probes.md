# JPEG XL lossy larger-transform probes, September 24

Base implementation: `2ebb6aa305eb3c11164cf2e2c0293569d65e9fc7`. No codec change was retained. Lossy remains Experimental. The pinned native strategy profile in the [previous investigation](m7-prompt13-transform-investigation.md) led to bounded DCT16×16 and DCT64×64 prototypes. The prototype changed strategy-map packing, DC reconstruction, AC coefficient ordering and quantization together. It produced valid streams but failed the protected matched-quality comparison. The source changes were reverted.

## Development diagnostic

The small development set contains eight at-most-1024-pixel derivatives, effort 7, distances 1, 2 and 3. Every run kept all 24 cases. Across the eight DCT16/DCT64 quantizer variants and the three DCT64 edge-threshold variants, every measured stream passed pinned native libjxl, pinned Rust and repository decoding within one RGB8 level. All bounded runs had zero swap. The first DCT16 prototype used the old 8×8 DC averages and lost substantial quality. Reconstructing each covered block's DC from the larger transform removed that error.

| Candidate | Matched Butteraugli-2 result on the eight derivatives | Decision |
| --- | --- | --- |
| DCT16, default quantizer 4 | Median candidate/base size 1.077; gradient 1.046, photo 1.265 | Rejected |
| DCT16, quantizer 3 / 5 / 6 | Median 1.128 / 1.008 / 1.023 | Rejected |
| DCT64, default quantizer 4 | Gradient 1.016, photo 1.352 | Rejected |
| DCT64, quantizer 5 / 6 | Gradient 1.034 / 1.058; photo 1.172 / 1.033 | Rejected |
| DCT64, sharp-edge exclusion at RGB step 40 / 25 / 20 | Gradient 1.008 / 1.000 / 1.000; photo 0.993 / 0.996 / 0.998 | Original-size check required |

The raw Butteraugli maps show that broad DCT64 selection lowered error across many smooth tiles but added high-error regions near sharp photo edges. A selector that excludes tiles with an adjacent RGB step of at least 25 improved both development gradient and photo at matched SSIMULACRA2 80: candidate/base size 0.970 and 0.963. Its matched Butteraugli-2 ratios were 1.000 and 0.996. Neighboring photographic derivatives `im26-2018` and `im26-2400` had Butteraugli-2 ratios of 1.002 each. This was a promising small diagnostic, not promotion evidence.

The [complete edge-25 development report](m7-prompt14-development-probe.json) retains all 24 points, input and stream hashes, tool hashes, independent-decoder differences and both quality scores. Its SHA-256 is `f08145c0ce6ace53f3af9b9b1eb16a5bcc55ab9645b011da66acd468140a274f`. The other raw reports and bounded receipts remain under `.tmp/jpegxl-m7/diagnostic-prompt14-*` and `.tmp/jpegxl-m7/bounded-runs/prompt14-*`. Rejected prototype diffs are under `.tmp/jpegxl-m7/prompt14-dct16-prototype.patch` and `.tmp/jpegxl-m7/prompt14-dct64-edge25-prototype.patch`; the latter SHA-256 is `ac4f2ad251e2e875d3366ea05c1aa2a4f4e3e7b20b07035ee6364df409272a6f`.

## Preselected original-size check

The edge-25 candidate was then tested on the preselected 4000×3000 development photo `im26-1030` and gradient `im26-1416`, at distances 1 and 3. These input pixels have the same SHA-256 values as the [fixed eight-original baseline](m7-prompt9-original-size-replay.json): `b3c60e917faaab9843ac2429921cc1e7d7195105cc958ea671e12db225a4066a` for the photo and `dbf8702fd6c6c24aea9839f84dc48985f055489963ad3f4b4545a8c69ea491ef` for the gradient. All four new streams passed native, Rust and repository decoding within one RGB8 level. The [distance-1](m7-prompt14-original-d1-probe.json) and [distance-3](m7-prompt14-original-d3-probe.json) raw reports retain hashes, scores and decoder results.

| Original-size source | Distance-3 bytes, before → candidate | Distance-3 SSIMULACRA2, before → candidate | Matched SSIMULACRA2-80 size | Matched Butteraugli-2 size |
| --- | ---: | ---: | ---: | ---: |
| Photo `im26-1030` | 582,061 → 594,595 | 79.877 → 79.860 | 1.023 | 0.980 |
| Gradient `im26-1416` | 469,910 → 491,908 | 76.200 → 77.141 | 0.975 | 1.031 |

The original-size photo gives up 2.3% at matched SSIMULACRA2 80. The gradient gives up 3.1% at matched Butteraugli 2. Both protected quality views matter, so the selector was rejected. No eight-original or approved 2 MP qualification was run on this unretained implementation.

The first original-size metric job was stopped by its 3 GiB process-tree limit while scoring the photo. Its failed receipt remains at `.tmp/jpegxl-m7/bounded-runs/prompt14-original-edge25.json`. The two 8 GiB reruns completed with zero swap; the distance-3 process tree peaked at 3.1 GiB. These are bounded probe measurements, not new encoder timing claims.

## Qualification result and next work

| Reviewed item | Result |
| --- | --- |
| Independent decoding of the temporary larger-transform streams | Pass on the tested development and two original-size sources |
| Matched-quality size improvement without neighboring or original-size regression | Fail; no transform change retained |
| Approved 2 MP lossy size and original-size visual targets | Unchanged from the [previous target table](m7-prompt9-report.md) |
| Complete SSIMULACRA2-90 native brackets | Fail unchanged for the ten cases at the [pinned native lossy floor](m7-prompt10-report.md) |
| Stable lossy promotion | Fail; remains Experimental |

Next, profile the high-error edge and texture regions in the original photo and gradient with the existing raw Butteraugli maps, then test a local restoration or quantization change against those regions. Keep the complete source split and both quality metrics. The 12 MP result shows that a win on capped derivatives cannot qualify the original-size visual target.

`VITEST_MAX_WORKERS=2 npm run check` passed on the reverted codec revision: 3,200 tests passed with three existing skips. The log is `.tmp/jpegxl-m7/prompt14-npm-check.log`, SHA-256 `639e995ce8b0e3b3f569937ece9d2ab7a9b5620441b33f58fc2109ed16019318`. The gate includes browser checks, size checks and the repository tests. No final conformance/resource rerun is claimed for an unretained codec candidate.
