# JPEG XL lossy transform investigation, September 24

Implementation revision: `d3a8976bfe72f6bd45bf33a5339754d71c1af293`. No production codec change was retained. Lossy remains Experimental. This is a small development diagnostic on eight at-most-1024-pixel derivatives at effort 7 and distances 1, 2, and 3. It does not replace the approved 2 MP qualification or the fixed original-size checks. The previous [target table](m7-prompt9-report.md) and [reference ceiling audit](m7-prompt10-report.md) remain the qualification result.

## Adaptive quantization probes

The current encoder uses two block quantizer values, 4 and 6. Pinned libjxl measures local XYB activity and applies finer block-level adjustments. I tested two isolated first-party changes against the same development inputs. All 24 streams for each variant decoded through pinned native libjxl and Rust with at most one RGB8-level difference. The repository decoder also agreed within one level.

| Variant | Median byte change at equal encoder distance | Median SSIMULACRA2 change | Median Butteraugli change | Decision |
| --- | ---: | ---: | ---: | --- |
| Every block uses value 6 | +16.74% | +2.229 | -0.4083 | Rejected. Quality improves, but bytes rise substantially. |
| Value 6 on low local-Laplacian blocks | +1.614% | +0.229 | 0.0000 | Rejected. Butteraugli worsens on 11 of 24 points and sampled matched-quality size slips. |

At distance 3, the first probe changes gradient derivative `im26-1416` from 47,245 to 58,870 bytes and SSIMULACRA2 from 79.000 to 83.754. The neighboring photo `im26-1030` changes from 74,229 to 90,222 bytes and from 79.268 to 83.895. The low-Laplacian probe changes the gradient to 50,461 bytes and 80.017, while the photo becomes 76,479 bytes and 80.473. Its Butteraugli result for the photo slips from 2.59012 to 2.59278. Equal-distance figures show the mechanism and are not matched-quality claims. Both probes were reverted.

Raw first-party reports and 3 GiB, zero-swap receipts are under `.tmp/jpegxl-m7/diagnostic-prompt13-aq-{base,all6,mask8}/report.json` and `.tmp/jpegxl-m7/bounded-runs/prompt13-aq-{base,all6,mask8}.json`. Their report SHA-256 values, in that order, are `e7a036adbccfb9b3941dd0f1fbbce10dfb2bc3b24671d3d0af78440af0f52740`, `2deb7ae18d3935baa79739fa2eeac82773908c81815eb6e136853426f1e741e6`, and `9aca77b45b21d3fae417adc392fc2118265fc008367caebb92e4dea83447fe0b`.

## Pinned native strategy profile

I decoded the pinned native and first-party distance-3 streams for the same 1024×768 gradient and photo derivatives. Temporary instrumentation counted the first block of each decoded transform, then was removed. Weighted by each transform's covered blocks, native libjxl uses transforms larger than 8×8 on 11,864 of 12,288 gradient blocks (96.5%) and 10,368 of 12,288 photo blocks (84.4%). The first-party encoder uses none; it chooses DCT8, Hornuss, or an 8×8 split transform. Libjxl uses DCT16×16, DCT32×32, DCT64×64, and rectangular larger transforms on these inputs. The native gradient has 78 DCT64×64 placements covering 4,992 blocks. The native photo has 89 covering 5,696 blocks.

| Derivative, encoder | Large-transform covered blocks | DCT8 first blocks | DCT64×64 first blocks |
| --- | ---: | ---: | ---: |
| `im26-1416`, pinned libjxl | 11,864 / 12,288 | 261 | 78 |
| `im26-1416`, PureJsImage | 0 / 12,288 | 11,857 | 0 |
| `im26-1030`, pinned libjxl | 10,368 / 12,288 | 1,129 | 89 |
| `im26-1030`, PureJsImage | 0 / 12,288 | 11,874 | 0 |

The four encoded stream SHA-256 values are `aad79eda73f60ed5b806869be8c2ef31f8de20f340726ee7a92ba401ef01bdc1` (native gradient), `e195de46c05d5a0c8c92c6cf0d060a381d935278bb1e99382ff795394320b030` (first-party gradient), `638786dc2180a04a0a1bdb3b3e7dde2af4e2ab27c80b32a295a3760f95286c11` (native photo), and `cb1519619e008976eea1670742507649cc7bb7885c47579e174f70eb6e4d3edc` (first-party photo). Raw profile: `.tmp/jpegxl-m7/prompt13-strategy-profile.log`, SHA-256 `b2d33bae2970be61f7d21c12442d2458f3df3aa6abfbda03cd2681588ecabd29`; bounded receipt: `.tmp/jpegxl-m7/bounded-runs/prompt13-strategy-profile.json`, SHA-256 `c69d437c514ab36017ff1fe7eff01e1090398b3bbb9c2e99e8fce81b0a8fbcfe`.

## Next implementation target

Start with a bounded DCT16×16 prototype on development images. A correct larger-transform stream needs all of these pieces together: a strategy map that records the first block and coverage, the matching low-frequency/DC representation, a 256-coefficient forward transform and quantization, and strategy-aware AC ordering and entropy contexts. The current AC writer assumes 64 coefficients at every block, so simply selecting strategy 4 would produce invalid output. First require independent native and Rust decoding, exact alpha, native precision, and no regression in neighboring photo, text, and effort settings. Then compare size at bracketed SSIMULACRA2 and Butteraugli quality. Add DCT32 and DCT64 only if the DCT16 path measures well.

After a final codec change, rerun the affected approved 2 MP matrix, the fixed eight original-size checks, and the relevant HDR/alpha/resource/conformance checks. Keep the observed holdout as regression evidence. The pinned native SSIMULACRA2-90 ceiling still prevents a complete high-band bracket on ten sources; a reviewed measurement decision remains necessary for that separate gate. No target or status changed in this investigation.
