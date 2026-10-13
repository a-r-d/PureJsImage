# JPEG XL campaign summary

Promoted source a49a70f9, fingerprint 1224c8a8. The campaign ends under the owner decision.

The first-party JavaScript encoder passes promotion against prior main and meets the approved speed entry limits. Overall compression parity remains open. The final photo ladder and reserved holdout both miss the wasm-vips SSIMULACRA2 and Butteraugli 3-norm mean targets.

| Metric | Final development / jSquash | Final development / vips | Holdout / jSquash | Holdout / vips |
| --- | ---: | ---: | ---: | ---: |
| SSIMULACRA2 | -1.08% | +1.18% | -1.37% | +0.39% |
| Butteraugli 3-norm | +15.60% | +9.87% | +10.40% | +7.47% |
| Butteraugli max | +15.63% | +6.63% | +13.46% | +7.55% |

Negative BD-rate means fewer bytes at equal measured quality. Development uses 64 photos and eleven distances; holdout uses 63 photos and nine distances, inspected only in aggregate. Non-photo images are reported separately. Both peers are pinned: jSquash 1.3.0 and wasm-vips 0.0.19 with libjxl 0.12.0. Inputs are prepared eight-bit RGB/RGBA.

These are measured-overlap means. Full-band counts stay visible in the detailed reports; zero 3-norm full-band admissions do not establish coverage or parity. The holdout targets remain 0% SSIMULACRA2 against both peers, +5% 3-norm and +8% max against vips. The +20% per-image aspiration is not met on measured overlaps.

Fresh isolated effort-7 medians are 2.916x jSquash on crops and 2.544x on nine matched originals. The 13 MP ratio is 2.270x; the 21 MP encode takes 77.345 seconds, with jSquash unavailable there. Presets are own/vips distance 2 and jSquash quality 80; scoring is excluded.

All 90 watch and 20 scale points fit the unchanged 137,514,476-byte managed ceiling. Maximum: 136,508,774 bytes. The 12 MP allocation repair saves 42,806,175 managed bytes with identical output. Encoder-managed storage, encoder RSS and scorer-tree memory remain separate.

Slow effort 9 keeps the five complete-alternative searches. Its one untuned screen validates all 80 own streams in both independent decoders. Declared-preset median time is 12.463x our effort 7 and 11.624x jSquash effort 9. Its separate quality-matched BD-rate table is in EFFORT9.md.

The correctness repair passes 4,000 tests, 1,775 browser compatibility checks and 6 isolated photo checks. Minified bundles are 611,664 core and 684,484 specialized bytes; the ceilings stay unchanged.

Failed compression ideas and their measured tradeoffs remain in FINAL-REPORT.md. If Aaron reopens compression work, the ranked ideas are reconstructed block/channel diagnosis at matched bytes, a bounded closed-loop refinement pass, then transform selection using final spatial error. Further tuning is cancelled for this campaign.

See FINAL-REPORT.md for complete evidence and limits, FINAL-PHOTOS.md and FINAL-SECONDARY.md for the separate final ladders, and FINAL-CAMPAIGN.json for aggregates and artifact hashes.
