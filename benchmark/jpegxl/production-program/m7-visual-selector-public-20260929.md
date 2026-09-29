# M7 public lossy selector follow-up

Implementation commit: `d06a7dc1a3c01e9483683459df7e91298e16f27e`. This is a retained encoder improvement on PR #37. Lossy remains Experimental. The previous [visual-defect qualification](m7-visual-defects-final.md) remains the last complete 2 MP matrix. This follow-up uses its pinned original-size inputs and a small development diagnostic. The observed screenshot and table are regression evidence, not unseen sources.

## Change

The effort-7 opaque sRGB RGB8 encoder can try a second first-party VarDCT strategy at distances 1 through 4 for images from 262,144 through 12,000,000 pixels. The alternate block cost balances weighted squared XYB error with an AC rate estimate. The estimate now includes zero coefficients through the final nonzero scan position. The public encoder compares the complete encoded byte lengths and selects the alternate only when it saves at least 1%. It retains the DCT8 fallback and the existing screenshot and document candidates. A working-memory limit stops the alternate attempt and keeps the primary stream.

The pinned libjxl `enc_ac_strategy.cc` informed the use of an entropy proxy and reconstruction error in transform choice. No libjxl implementation was copied. The original conservative strategy remains the default for direct VarDCT encoding, effort 1/3, progressive output, grayscale, RGBA, HDR, and other distances or dimensions. Lossless and exact JPEG paths are unchanged. The extra complete encode costs time at eligible effort-7 settings; this follow-up does not qualify that runtime cost.

The [small development trial](visual-selector-public-20260929/development-small.json) measured eight 1024-pixel-edge derivatives at distances 1, 2, and 3. Seven of 24 alternate points would meet the public 1% byte-saving gate. The map and table points generally improved both external metrics. Photo and sunset alternates grew in bytes and therefore fall back in the public path. The trial is diagnostic and uses inspected development families.

## Original-size results

All rows are effort 7 with pinned RGB8 pixels. SSIMULACRA2 rises with quality; Butteraugli falls with quality. The new first-party streams in the [map](visual-selector-public-20260929/map-original.json), [screenshot](visual-selector-public-20260929/screenshot-original.json), and [table](visual-selector-public-20260929/table-original.json) raw reports passed native libjxl, pinned Rust, and repository decoding, with at most one RGB8 sample of difference between decoders. The raw reports record input, stream, decoded, implementation, harness, and tool SHA-256 values. Each ran under a 3 GiB process-tree limit with zero swap: [map](visual-selector-public-20260929/map-receipt.json), [screenshot](visual-selector-public-20260929/screenshot-receipt.json), [table](visual-selector-public-20260929/table-receipt.json).

| Source and distance | Bytes, before → after | SSIMULACRA2, before → after | Butteraugli, before → after | Decision |
| --- | ---: | ---: | ---: | --- |
| Map `im26-5032`, 1 | 532,212 → 507,673 | 85.654 → 85.919 | 1.468 → 1.203 | Smaller and better on both scores. |
| Map `im26-5032`, 3 | 381,974 → 372,086 | 83.077 → 83.328 | 2.204 → 2.039 | Smaller and better on both scores; faint local halo still needs review. |
| Screenshot `im26-8160`, 1 | 272,113 → 262,537 | 87.716 → 87.768 | 1.498 → 1.294 | Smaller and better on both scores. |
| Screenshot `im26-8160`, 3 | 178,857 → 178,857 | 83.614 → 83.614 | 2.284 → 2.284 | Identical qualified stream; the registered distance-3 defect remains open. |
| Table `im26-5337`, 1 | 393,588 → 382,817 | 88.407 → 88.288 | 1.219 → 1.184 | 2.7% smaller with a 0.119 SSIMULACRA2 cost and a Butteraugli gain. Retained as a measured tradeoff. |
| Table `im26-5337`, 3 | 180,010 → 180,010 | 89.429 → 89.429 | 1.830 → 1.830 | Identical qualified stream. |

The final-source 12 MP photo `im26-1030` at distance 3 is byte-identical to the previously qualified stream: 751,812 bytes, SHA-256 `aef1699b5e960712035ad7aeee7ebc13d81e3b3bf42daa32ac52bc034532d2af`. The final-source 12 MP sunset `im26-1416` at distance 3 is likewise identical: 607,348 bytes, SHA-256 `93de90e35a049a914b4323cfea75550869bd1a592a2c67dfdeecdedbfe570b9f`. Their [photo](visual-selector-public-20260929/photo-receipt.json) and [sunset](visual-selector-public-20260929/sunset-receipt.json) hash runs used the same pinned inputs and a 3 GiB zero-swap process limit. The earlier independent decoder and quality results apply to these identical artifacts.

A separate deterministic 512×512 sparse-line graphic exercises the public encoder in the unit and real-browser tests. It produces 16,668 bytes instead of 33,356 conservative bytes. Its native-decoded SSIMULACRA2 improves from 82.197 to 88.820 and Butteraugli from 2.534 to 1.623; pinned Rust and native libjxl agree within one RGB8 sample. This is a generated development test, not corpus generalization evidence. The [browser receipt](visual-selector-public-20260929/browser-receipt.json) records a zero-swap run with Chromium, Firefox, and WebKit passing Node/browser parity.

`npm run check` passed with 3,209 tests and three existing skips; the [bounded receipt](visual-selector-public-20260929/full-check-receipt.json) records a 2.1 GiB peak and zero swap. The JPEG XL core-plus-codec bundle grew from 456,008 to 457,171 minified bytes, below its 460,000-byte ceiling. The specialized entry grew from 544,074 to 545,226 bytes, below its 548,000-byte ceiling. The generated package-size and documentation data were refreshed. There is no new runtime dependency.

The clean implementation commit passed [JPEG XL conformance](visual-selector-public-20260929/conformance.json) with 39/39 expectations and [resource checks](visual-selector-public-20260929/resource.json) with 12 fuzz and 12 resource cases. Both reports identify the implementation commit. Their bounded [conformance](visual-selector-public-20260929/conformance-receipt.json) and [resource](visual-selector-public-20260929/resource-receipt.json) receipts recorded zero swap and peaks of 924.3 MiB and 500.3 MiB.

## Qualification boundary

| Target | Current decision |
| --- | --- |
| Public behavior and stream interoperability for this change | Pass on the tested small graphic and original map, screenshot, and table; all changed original streams decoded independently. |
| Lossless, exact JPEG, alpha, HDR, and effort-1/3 behavior | Codec paths are unchanged. Prior qualified artifacts and checks remain the evidence; this follow-up does not claim new coverage. |
| Matched-quality 2 MP size targets | Prior matrix passed on its measured brackets. Changed public RGB8 effort-7 streams need a fresh affected matrix before attributing those target results to this candidate. Missing brackets remain unresolved. |
| Original-size visual defects | Map metrics improve; the known halo needs renewed 1:1 review. Screenshot distance 3, sunset, and HDR defect streams are unchanged. Four registered visual defects have not been closed by this change. |
| Runtime and resources | Effort-1 and effort-3 paths are unchanged. Eligible effort-7 images perform a second encode, so effort-7 timing needs fresh measurement. The tested original runs completed within 3 GiB process-tree memory with zero swap; production encoder memory limits remain enforced. |
| Stable lossy scope | Not justified by this incremental result. Lossy stays Experimental. |

Next qualification should freeze the implementation, rerun the affected approved 2 MP comparisons, the remaining fixed original-size cases, relevant resource/conformance checks, and the declared HDR/alpha views where stream identity cannot justify reuse. The original source-family splits and missing quality brackets remain visible. This follow-up does not change versions or public capability labels.
