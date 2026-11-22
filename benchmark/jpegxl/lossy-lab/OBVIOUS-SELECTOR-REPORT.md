# Simple selector work, 2026-11-16 UTC

Retain two first-party development-selector changes: unroll fixed eight-pixel copies and replace the repeated DC row division with an equivalent extent comparison. The branch remains `jxl-libjxl-ports`; this round changes no production source or public decisions. All earlier uncommitted work is preserved.

Twenty-one alternating complete-encoder pairs after three warmup pairs give 0.959927x on im26-3012 and 0.977781x on im26-3312, with 15/21 and 16/21 faster pairs. Photo MAD is 0.067239 and texture MAD 0.024538. Median elapsed times change from 882.609 to 849.758ms and 848.645 to 829.789ms. These are two photographic workloads, not a new absolute crop/original qualification.

| Experiment | Pairs per crop | Photo ratio (wins) | Texture ratio (wins) | Decision |
| --- | ---: | ---: | ---: | --- |
| rounding-prepare | 7 | 1.014944 (3/7) | 1.020799 (2/7) | rejected |
| dc-extent | 7 | 0.938995 (6/7) | 0.977898 (5/7) | initial |
| dc-extent-confirm | 21 | 1.008627 (10/21) | 0.976470 (16/21) | conditional component |
| magnitude-table | 7 | 1.015533 (3/7) | 1.045820 (2/7) | rejected |
| tiny-statistics | 7 | 0.997458 (4/7) | 0.988324 (4/7) | neutral; rejected |
| row-copy | 7 | 0.985986 (4/7) | 0.964208 (4/7) | initial |
| row-copy-confirm | 21 | 0.968755 (16/21) | 1.003706 (10/21) | conditional component |
| natural-rows vs copy | 7 | 1.026484 (3/7) | 0.979078 (5/7) | rejected |
| combined | 21 | 0.959927 (15/21) | 0.977781 (16/21) | retained |

Setup, source preparation, selection and the final entropy writer are inside each timed encode. No benchmark, test, profile or native scoring overlaps. Initial seven-pair impressions and longer confirmations are both recorded. The square-root table, unused rounding preparation, tiny-only statistics branch and larger row traversal are rejected. Neither retained change adds storage.

All 576 fresh outputs across 64 development photos and nine fixed distances match the saved native-valid regularized-half streams exactly. Every complete byte count, including maps and entropy, and every managed peak also matches. Maximum managed allocation is 9,235,833 bytes. This also covers the three historical near-flat textures; their pixels and boundaries are unchanged.

The following full-development BD-rates are reused from those identical native-scored streams. No quality improvement or fresh perceptual calculation is claimed. Existing partial-band omissions remain in the JSON.

| Reference | SSIMULACRA2 | Butteraugli 3-norm | Butteraugli max |
| --- | ---: | ---: | ---: |
| vips | -8.205% | -5.199% | -5.631% |
| jsquash | -8.726% | -0.012% | 2.408% |
| Session control | 0.000% | 0.000% | 0.000% |

Fresh memory probes use three isolated processes per variant and cold/warm state, with identical imports and absolute Linux VmHWM including input and warmups. Initial unequal-import probes remain diagnostic. No post-warm subtraction or inherited resourceUsage high-water defines a peak.

| Crop | State | Base peak bytes | Candidate peak bytes | Ratio |
| --- | --- | ---: | ---: | ---: |
| im26-3012 | cold | 160079872 | 154042368 | 0.962284 |
| im26-3012 | warm | 206499840 | 200089600 | 0.968958 |
| im26-3312 | cold | 156651520 | 157351936 | 1.004471 |
| im26-3312 | warm | 197767168 | 198094848 | 1.001657 |

The seven independent source patches, including the retained combination, restore exactly against the session snapshot. Headers preserve the existing source attribution; no new third-party code, constant or table is ported. Full libjxl license text remains in the npm/docs notices. Runtime dependencies remain zero.

Fresh package checks confirm unchanged minified JPEG XL bundle sizes of 614,969 bytes for the codec and 687,801 bytes for the specialized entry, under 615,000/690,000-byte ceilings.

Validation: fresh `VITEST_MAX_WORKERS=4 npm run check` exits 0 with no signal: 4,245 tests and 345 files pass; three tests and one file skip. Full check takes 546.980s, Vitest 505.90s. All build, browser, types, lint, format, documentation and comparison gates pass. Ninety focused cases, three Chromium/Firefox/WebKit fixtures, strict experimental types and seven archive restorations pass independently. No benchmark/profile/scoring overlaps the repository check.

The holdout stays closed. The last separate predictor-DC attempt still fails two SSIM guards, worst +11.202599% against +8.05%; the current regularized mode has prior guard failures too. This speed work does not repair either result. Public peer forcing still needs source separation before any merge. No commit, push, main merge or release.

Next: incremental final-context rate, useful coupled proposals with displayed-error protection, then public-source separation when promotion is justified.

Raw receipts: `.tmp/jpegxl-lossy-lab/obvious-selector-20261116`. [Structured report](OBVIOUS-SELECTOR-REPORT.json). [Independent patches](OBVIOUS-SELECTOR-EXPERIMENT.patch).
