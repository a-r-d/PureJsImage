# Optimization attempt log

This is the durable, checked-in history of performance experiments. The raw
seven-pair measurements remain under `.tmp/hillclimb/`; this file records the
hypothesis, evidence, result, and disposition so a later campaign does not
repeat a dead end without new evidence.

## Current state

- Primary workload: `png-resize-1000` — 4000x3000 RGBA PNG to 1000px PNG 6.
  Official 522 vs Sharp 263 ms. Goal is end-to-end speed.
- Profile: `#decodeTypeScript` ~45% (unfilter + per-pixel `convertRow`), CRC-32 ~10%,
  resize ~12%.
- Retained `PNG-001`: indexed CRC-32. 15-trial 562 → 527 ms (−6.29%).
- Retained `PNG-003`: memcpy 8-bit RGBA `convertRow`. 15-trial 537 → 416 ms
  (−22.52% vs original HEAD), 14/15 pairs faster, paired MAD 1.04%.
- Retained `PNG-015/016`: generalize adaptive-filter prefix/body scoring to remove RGBA boundary
  branches and the redundant RGB-only kernel. 15-trial 437 → 433 ms (−0.82%), paired median
  −1.03%, 12/15 pairs faster, RSS −0.62%.
- Retained `PNG-017/018`: use a 256-entry filtered-magnitude lookup. The cumulative 15-trial
  stack is 438 → 432 ms (−1.35%), paired median −1.06%, 13/15 pairs faster, RSS −0.05%.
- `PNG-008` reached −6.07% but was superseded because its fully unrolled kernel exceeded the core
  bundle ceiling.
- Versus Sharp (~263 ms), the final stack's latest paired candidate median is ~432 ms (~1.6×).
- Neighbor `stress-100mp-downscale`: 2653 → 1391 ms (−47.58%), RSS −1.55%, exact
  signatures. Artifact `.tmp/hillclimb/2026-08-19T13-08-00-007Z/`.
- Neighbor `png-alpha-resize`: 79.89 → 72.99 ms (−8.63%), RSS −0.07%.
  Artifact `.tmp/hillclimb/2026-08-19T13-10-50-434Z/`.
- Neighbor `jpeg-to-png`: 483.46 → 479.43 ms (−0.83%), RSS −0.98%. CRC-only
  effect. Artifact `.tmp/hillclimb/2026-08-19T13-10-00-061Z/`.
- Imazen PNG: 176 images, 162 pass / 14 rejected-safely / 0 failures.
  Artifact `.tmp/imazen-png-final/`.

- Reverted `PNG-002` RGBA8 unfilter; incremental vs PNG-001 was noise.
- Progressive `jpeg-progressive-resize-1200` JPEG-039/040/041 did not retain.
  Entropy is ~365 ms across 10 scans; refine micro-opts did not pay.
- Prior JPEG northstar / resize-1200 / AVIF retained stacks are unchanged.



## JPEG resize-1200 campaign

- Workload: `jpeg-resize-1200` — tundra 4000x3000 4:2:2 JPEG, resize 1200x900,
  JPEG 80. Goal is end-to-end speed versus Sharp (official 777 vs 72 ms).
- Scale 2 is selected (2000x1500 decode). Profile put `inverseDctReduced`
  first (~25%), then `resizedBlocks` (~20%), then YCbCr render and Huffman.
- Retained `JPEG-031`: unroll the scale-2 4x4 IDCT. 714 → 568 ms (−20.38%).
  Exact hash.
- Retained `JPEG-032`: 4:2:2 YCbCr render skips vertical chroma bilinear
  (chroma V already equals max). Incremental ~568 → 557 ms. RSS +4.12% vs
  HEAD, under the 5% reject.
- Neighbor `jpeg-crop-resize` on the full stack: exact hash, 627 → 515 ms
  (−17.95%).
- Retained `JPEG-036`: unroll the encoder DCT in `quantize`. Incremental
  557 → 543 ms. Exact hash. Versus Sharp (~72 ms) the primary is ~543 ms
  (~7.5×).
- Retained `JPEG-037`: fuse the 8-bit AC Huffman prefix into
  `decodeBlockLimited` instead of calling `decodeHuffman` per coefficient.
  550 → 511 ms (−7.01%) versus committed HEAD. Exact hash.
- Versus Sharp (~72 ms) the primary is now ~511 ms (~7.1×).
- Neighbor `jpeg-crop-resize` after JPEG-037: exact hash, 516 → 497 ms (−3.85%).
- Neighbor `northstar-photo-pipeline` after JPEG-037: exact hash, 778 → 752 ms
  (−3.35%).

## AVIF fox-resize campaign

- Workload: `avif-fox-resize-jpeg` — 1204x800 profile0 4:2:0 AVIF, resize 800,
  JPEG 80. Goal is end-to-end speed versus Sharp (official 802 vs 49 ms, ~16×).
- Retained `AVIF-014`: 8-bit SGR `boxFilter`. 828 → 769 ms (−7.11%).
- Rejected `AVIF-015`: prefix-from-CDEF on 4x4 interiors was noise vs 014.
- Retained `AVIF-016`: restore 8-bit unit-width × 4-row tiles. 838 → 646 ms
  (−22.91%) vs HEAD, exact hash, 7/7 pairs faster. High-bit stays 4-wide
  because Int32 prefix squares overflow on wide 10/12-bit windows.
- Retained `AVIF-020`: Wiener interior from CDEF. Incremental ~646 → 638 ms.
- Retained `AVIF-021`: 8-row 8-bit restoration bands. 15-trial 835 → 623 ms
  (−25.36% vs HEAD), 15/15 pairs faster.
- Versus Sharp (~49 ms) the primary is now ~623 ms (~12.7×). Need ~490 ms
  for a 10× gap.
- Retained `AVIF-024` + `AVIF-026`: reuse inverse-transform residual scratch and
  skip all-zero 1D rows/columns. 621 → 589 ms (−5.12%) versus committed HEAD.
  Versus Sharp the primary is now ~589 ms (~12.0×).
- Retained `AVIF-028` + `AVIF-029`: non-allocating equiprobable bits and skip-zero
  dequant. 585 → 561 ms (−4.15%) versus committed HEAD. Versus Sharp the primary
  is now ~561 ms (~11.4×).
- Retained `AVIF-031`: interior 4:2:0 chroma upsample. Stack 591 → 548 ms (−7.20%)
  versus committed HEAD. Versus Sharp the primary is now ~548 ms (~11.2×).
- Retained `AVIF-034`: integer `1 << bits` arithmetic-coder renormalize. Stack
  581 → 537 ms (−7.57%) versus committed HEAD. Versus Sharp ~537 ms (~11.0×).
- Retained `AVIF-036`: integer `clampByte` in YUV convert. Stack 588 → 518 ms
  (−11.80%) versus committed HEAD. Versus Sharp ~518 ms (~10.6×).
- Retained `AVIF-037`: hoist SGR prefix-row bases. Stack 589 → 514 ms (−12.74%).
  Versus Sharp ~514 ms (~10.5×).
- Retained `AVIF-042`: inline 8-bit 4:2:0 YUV convert with hoisted range/matrix
  scales. Stack 588 → 500 ms (−15.06%). Versus Sharp ~500 ms (~10.2×). Need
  ~490 ms for a 10× gap.
- Neighbor `avif-fox-full-png` on AVIF-028–031: 844 → 812 ms (−3.77%), exact hash.
  Artifact `.tmp/hillclimb/2026-08-17T22-49-04-952Z/comparison.md`.
- Neighbor `avif-fox-full-png` on AVIF-028–034: 773 → 713 ms (−7.78%), exact hash.
  Artifact `.tmp/hillclimb/2026-08-17T23-01-37-377Z/comparison.md`.
- Neighbor `avif-fox-full-png` on AVIF-028–037: 766 → 707 ms (−7.72%), exact hash.
  Artifact `.tmp/hillclimb/2026-08-17T23-08-40-580Z/comparison.md`.
- Neighbor `avif-fox-full-png` on AVIF-028–037+042: 766 → 680 ms (−11.26%), exact hash.
  Artifact `.tmp/hillclimb/2026-08-17T23-46-21-550Z/comparison.md`.
- Neighbor `avif-fox-full-png` on AVIF-028+029: 795 → 765 ms (−3.73%), exact hash.
  Artifact `.tmp/hillclimb/2026-08-17T22-43-51-426Z/comparison.md`.
- Neighbor `avif-fox-full-png` on AVIF-024+026: 810 → 812 ms (+0.22%), exact hash.
  Artifact `.tmp/hillclimb/2026-08-17T22-31-22-115Z/comparison.md`.
- Neighbor `avif-fox-full-png` on AVIF-014+016+020+021: 983 → 810 ms (−17.56%),
  exact hash. Artifact `.tmp/hillclimb/2026-08-17T22-06-20-423Z/comparison.md`.
- Handoff: `fixtures:avif:post-filters` matched dav1d/libaom YUV hashes (tolerance 0),
  including fox. Imazen AVIF survey 36/36 decoded, max RGB error 2, min PSNR
  52.21 dB (`.tmp/imazen-avif-042/`). Color, high-bit, q-matrix, tiles, and
  common-photo oracles passed. 162 focused AVIF tests passed.

## Northstar scaled-decode campaign

| ID | Timestamp (UTC) | Hypothesis / change | Wall median base → candidate (ms) | Speed Δ | Peak RSS Δ | Verdict | Disposition |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| JPEG-024-ctl | 2026-08-17 18:47 | No-change control on `northstar-photo-pipeline`. | 2820.34 → 2819.14 | -0.04% | +0.21% | neutral | Control. |
| JPEG-024 | 2026-08-17 18:50 | Snap unaligned decoder crops to a containing scale-aligned box so scaled IDCT can run. Northstar `x=333` now decodes 332,0,5336x4000 at scale 4. | 2856.75 → 1181.11 | **-58.66%** | -4.85% | material | Retained. Runner rejected bitstream hash and +0.45% outputBytes; pixel samples passed ±8. |
| JPEG-025 | 2026-08-17 19:25 | Skip unused AC store/`receiveAndExtend` after the last zigzag the reduced IDCT reads; consume remaining Huffman with `skipBits`. Scale 4 last zz=4; non-reconstruct blocks decode DC only. | 1161.75 → 1044.85 | **-10.06%** | -2.60% | material | Retained. Exact northstar hash/outputBytes; pinned scaled fixture pixels matched. |
| JPEG-026 | 2026-08-17 19:29 | Fuse leftover-AC Huffman+extra into one `skipBits` on the 8-bit prefix path. | 1158.96 → 1019.44 | **-12.04%** vs HEAD (~−2.4% vs JPEG-025) | -4.09% | promising | Retained. Exact hash. Incremental hot-loop win on `skipRemainingAc`. |
| JPEG-027 | 2026-08-17 19:32 | Unroll scale-4 `inverseDct2` to four dequantized products and eight basis multiplies, no row workspace. | 1167.17 → 855.67 | **-26.69%** vs HEAD (~−16% vs JPEG-026) | -3.39% | material | Retained. 15/15-trial run; exact hash; first 7-trial was noisy (host load). |
| JPEG-028 | 2026-08-17 19:38 | Return from `indexJpegEntropy` at the first restart MCU past the crop target instead of scanning to EOI. | 1181.80 → 832.13 | **-29.59%** vs HEAD (~−2.7% vs JPEG-027) | -4.30% | promising | Retained. Exact hash; 15/15 pairs faster; runner incomparable (base CV 42%). |
| JPEG-029 | 2026-08-17 19:43 | Move leftover-AC skip onto `JpegEntropyReader` with per-call `tryFill`/`skip` closures. | 1151.76 → 928.85 | **-19.35%** vs HEAD (slower than JPEG-028) | +0.31% | rejected | Replaced in place; closures allocated on every block. |
| JPEG-029b | 2026-08-17 19:44 | Same reader-local leftover-AC skip, fully inlined, no closures. | 1149.29 → 802.10 | **-30.21%** vs HEAD (~−3.6% vs JPEG-028) | -0.46% | material | Retained. Exact hash; candidate MAD 3.33 ms. |
| JPEG-030 | 2026-08-17 20:15 | Specialize `decodeBlockScale4` / `decodeBlockDcOnly` instead of one limited decoder. | 1164.43 → 804.09 | **-30.95%** vs HEAD (~0% vs JPEG-029b) | -3.29% | neutral | Reverted. First attempt also broke scale-8 DC writes. |
| JPEG-031 | 2026-08-17 20:28 | Unroll scale-2 `inverseDct4` to 16 dequantized products and a fixed 4x4 transform; remove unused `inverseDctReduced`. | 713.81 → 568.32 | **-20.38%** | -0.56% | material | Retained. Exact hash on `jpeg-resize-1200`. |
| JPEG-032 | 2026-08-17 20:30 | Skip vertical chroma bilinear when chroma V equals max (4:2:2). Horizontal mix only. | 710.07 → 557.46 | **-21.49%** vs HEAD (~−1.9% vs JPEG-031) | +4.12% | promising | Retained. Exact hash. Tundra is 4:2:2. |
| JPEG-033 | 2026-08-17 20:32 | Reuse one chroma pair across two luma pixels when 4:2:2 X weights match. | 708.75 → 561.65 | **-20.76%** vs HEAD (slower than JPEG-032) | +2.13% | rejected | Reverted. Extra per-pixel branch outweighed the skipped mix. |
| JPEG-034 | 2026-08-17 20:38 | Specialize RGB8 vertical resize accumulation with a 3-channel inner loop. | 731.05 → 564.45 | **-22.79%** vs HEAD (slower than JPEG-032 557 ms) | +4.48% | rejected | Reverted. Duplicated loop did not beat the generic accumulate. |
| JPEG-035 | 2026-08-17 20:39 | Fast-path `writeContent` for rgb8→rgb8 without gray/alpha branches. | 710.20 → 553.98 | **-22.00%** vs HEAD (~0% vs JPEG-032) | +3.52% | rejected | Reverted. Within noise of JPEG-032 and grows the core resize path. |
| JPEG-036 | 2026-08-17 20:41 | Unroll both separable passes of the JPEG encoder DCT in `quantize`. | 714.66 → 542.80 | **-24.05%** vs HEAD (~−2.6% vs JPEG-032) | +3.31% | promising | Retained. Exact hash; candidate MAD 2.31 ms. |
| JPEG-037 | 2026-08-17 21:06 | Fuse 8-bit AC Huffman prefix decode into `decodeBlockLimited`. | 549.69 → 511.14 | **-7.01%** | +0.18% | material | Retained. Exact hash versus committed 031–036 stack. |
| JPEG-038 | 2026-08-17 21:10 | Skip zero frequency rows in unrolled `inverseDct4`. | 566.71 → 520.68 | **-8.12%** vs HEAD (slower than JPEG-037 511 ms) | +2.29% | rejected | Reverted. Row-zero branches cost more than the skipped multiplies. |
| JPEG-039 | 2026-08-19 12:43 | Inline progressive AC refine without `Math.abs`/`setCoefficient`; extra undefined checks. | 772.42 → 787.56 | +1.96% | +0.09% RSS | rejected | Reverted. 5/7 pairs slower; paired median +7.43%. Artifact `.tmp/hillclimb/2026-08-19T12-42-35-919Z/comparison.md`. |
| JPEG-040 | 2026-08-19 12:46 | Replace `2 ** successiveLow` with `1 << successiveLow` in progressive first scans. | 764.36 → 782.70 | +2.40% | -0.58% | neutral | Reverted. Paired median +0.01%; 3/7 faster. Artifact `.tmp/hillclimb/2026-08-19T12-45-48-261Z/comparison.md`. |
| JPEG-041 | 2026-08-19 12:53 | Localize progressive AC-refine Huffman/bit IO on `JpegEntropyReader`. | 747.06 → 740.84 | -0.83% | -0.37% | inconclusive | Reverted. Paired median -1.67%, 4/7 faster, paired CV 314%. Large kernel, not retainable. Artifact `.tmp/hillclimb/2026-08-19T12-52-54-787Z/comparison.md`. |

## PNG resize-1000 campaign

| ID | Timestamp (UTC) | Hypothesis / change | Wall median base → candidate (ms) | Speed Δ | Peak RSS Δ | Verdict | Disposition |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| PNG-001 | 2026-08-19 12:58 | Indexed `updateCrc32` loop instead of `for-of` over `Uint8Array`. | 562.10 → 526.74 | **-6.29%** | +3.53% | material | Retained. 15/15-trial; 12/15 pairs faster; paired median −7.06%; exact outputBytes 43059. 7-trial was −1.48% / 5/7. Artifacts `.tmp/hillclimb/2026-08-19T12-56-59-749Z/` and `.tmp/hillclimb/2026-08-19T12-57-56-662Z/`. |
| PNG-002 | 2026-08-19 13:02 | Specialize RGBA8 unfilter and inline Paeth without `Math.abs`. | 555.91 → 533.02 | -4.12% vs HEAD | -0.24% | inconclusive | Reverted. Incremental vs PNG-001 (~527 ms) was noise; 15-trial base CV 18.7% from a 990 ms outlier. Artifact `.tmp/hillclimb/2026-08-19T13-01-44-856Z/`. |
| PNG-003 | 2026-08-19 13:05 | `convertRow` memcpy for 8-bit RGBA without tRNS. | 536.57 → 415.76 | **-22.52%** | +0.22% | material | Retained on PNG-001. 14/15 pairs faster; paired median −22.52%; exact outputBytes. 7-trial incomparable (candidate CV 11.9%) then 15-trial accepted. Artifacts `.tmp/hillclimb/2026-08-19T13-04-25-604Z/` and `.tmp/hillclimb/2026-08-19T13-05-21-086Z/`. |
| PNG-004 | 2026-08-20 01:25 | No-change control at `1621ad3` after re-profiling the committed PNG-001/003 stack. | 450.37 → 468.16 | +3.95% | +0.10% | inconclusive | Control; no source change. Base CV 17.12%, candidate CV 7.86%, paired median +0.45% with 3/7 candidate-faster pairs. Correctness and outputBytes matched. Artifact `.tmp/hillclimb/2026-08-20T01-25-01-614Z/`. |
| PNG-005 | 2026-08-20 01:27 | Express Paeth distances directly as `up-upperLeft`, `left-upperLeft`, and `left+up-2*upperLeft` to remove the shared prediction temporary. | 448.16 → 447.91 | -0.06% | +0.18% | neutral | Reverted. Paired median −0.13%, 4/7 pairs faster; base/candidate CV 0.81%/0.83%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-26-43-137Z/`. |
| PNG-006 | 2026-08-20 01:29 | Unroll filter-type 2 reconstruction four bytes at a time when `filterBytesPerPixel === 4`. | 443.40 → 452.62 | +2.08% | +0.42% | inconclusive | Retained only for confirmation. Host outliers drove base/candidate CV to 33.34%/18.33%; paired median +0.87%, 3/7 pairs faster, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-28-19-127Z/`. |
| PNG-007 | 2026-08-20 01:31 | Confirm PNG-006 with 15 paired trials. | 438.10 → 439.10 | +0.23% | +0.03% | neutral | Reverted. Two base outliers kept base CV at 14.13%, but the robust paired median was only −0.18% with 9/15 pairs faster, below the promising range; candidate CV 2.66%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-29-34-597Z/`. |
| PNG-008 | 2026-08-20 01:33 | Unroll exact factor-4 RGBA box-shrink accumulation in `src/resize.ts`, preserving premultiplied sums and final rounding. | 437.66 → 411.08 | **-6.07%** | -0.15% | material | Superseded after the final size gate: the fully unrolled kernel exceeded the 61,440-byte core API ceiling by 360 bytes. Paired median −5.68%, 7/7 pairs faster; base/candidate CV 1.29%/1.55%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-32-47-404Z/`. |
| PNG-009 | 2026-08-20 01:36 | Confirm the cumulative PNG-008 stack with 15 paired trials. | 444.86 → 417.51 | **-6.15%** | +0.11% | inconclusive | Retained based on PNG-008. The direction confirmed in 14/15 pairs with paired median −5.56% and exact outputBytes, but one 681 ms candidate outlier raised candidate CV to 15.14%, so the runner correctly marked this confirmation incomparable. Artifact `.tmp/hillclimb/2026-08-20T01-34-10-493Z/`. |
| PNG-010 | 2026-08-20 01:37 | Validate PNG-008 on neighboring `png-alpha-resize`, whose 1200→800 ratio does not select the factor-4 path. | 76.76 → 77.08 | +0.42% | +0.01% | neutral | Validation only; retained stack unchanged. Paired median +0.48%, 2/7 pairs faster; base/candidate CV 1.19%/1.30%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-36-15-652Z/`. |
| PNG-011 | 2026-08-20 01:39 | Validate PNG-008 on neighboring `stress-100mp-downscale`, which selects the adjacent factor-8 path. | 1263.33 → 1317.80 | +4.31% | +0.61% | neutral | Retained only pending a 15-pair regression guard. Paired median +2.65%, 2/7 pairs faster; base/candidate CV 5.53%/2.86%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-37-08-391Z/`. |
| PNG-012 | 2026-08-20 01:42 | Confirm PNG-011's factor-8 neighboring regression guard with 15 paired trials. | 1277.37 → 1273.07 | -0.34% | -0.01% | neutral | Validation passed; retained PNG-008. Paired median −0.93%, 9/15 pairs faster; base/candidate CV 3.21%/1.71%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-39-09-085Z/`. |
| PNG-013 | 2026-08-20 01:51 | Replace per-pixel `sourceX * 4` in RGBA box shrink with one streaming byte offset, keeping the generic partial-group path and bundle ceiling. | 444.92 → 440.70 | -0.95% | -0.17% | promising | Retained conditionally for 15-pair confirmation. Paired median −0.95%, 5/7 pairs faster; base/candidate CV 2.59%/1.57%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-49-48-784Z/`. |
| PNG-014 | 2026-08-20 01:53 | Confirm PNG-013 with 15 paired trials. | 439.25 → 439.43 | +0.04% | +0.04% | neutral | Reverted. Paired median −0.62%, only 8/15 pairs faster; base/candidate CV 3.54%/8.48%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-51-15-965Z/`. |
| PNG-015 | 2026-08-20 01:56 | Generalize the adaptive-filter prefix/body split so RGBA scoring avoids per-byte `index >= bytesPerPixel` branches, then remove the redundant RGB-only kernel. | 434.45 → 429.81 | -1.07% | -0.08% | promising | Retained conditionally for 15-pair confirmation. Paired median −0.83%, 6/7 pairs faster; base/candidate CV 0.61%/1.44%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-54-42-913Z/`. |
| PNG-016 | 2026-08-20 01:58 | Confirm PNG-015 with 15 paired trials. | 436.79 → 433.22 | -0.82% | -0.62% | promising | Retained. Paired median −1.03%, 12/15 pairs faster; base/candidate CV 2.12%/0.92%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-55-52-331Z/`. |
| PNG-017 | 2026-08-20 02:00 | Add a 256-entry filtered-residual magnitude lookup on the retained PNG-015/016 stack. | 438.14 → 431.89 | -1.43% | -0.69% | promising | Retained conditionally for 15-pair cumulative confirmation. Paired median −1.91%, 7/7 pairs faster; base/candidate CV 5.45%/0.37%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-58-38-026Z/`. |
| PNG-018 | 2026-08-20 02:02 | Confirm the cumulative PNG-015–017 stack with 15 paired trials. | 438.16 → 432.26 | -1.35% | -0.05% | promising | Retained. Paired median −1.06%, 13/15 pairs faster; base/candidate CV 1.58%/9.02% (one 592 ms candidate outlier), exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T01-59-54-761Z/`. |
| PNG-019 | 2026-08-20 02:04 | Unroll `updateCrc32` four bytes at a time on the retained PNG-015–018 stack. | 443.44 → 439.97 | -0.78% | +0.37% | neutral | Reverted. The cumulative result weakened versus PNG-018 despite a paired median of −0.78% and 6/7 faster pairs; exact outputBytes, base/candidate CV 0.75%/0.83%. Artifact `.tmp/hillclimb/2026-08-20T02-02-34-377Z/`. |
| PNG-020 | 2026-08-20 02:05 | Replace exact nonnegative `/ 2` floors in Average-filter scoring with unsigned shifts on the retained PNG-015–018 stack. | 442.40 → 437.56 | -1.09% | +0.37% | neutral | Reverted. All 7 pairs favored the candidate, but paired median −1.03% was indistinguishable from retained PNG-018 and the cumulative median weakened; exact outputBytes, base/candidate CV 0.95%/0.58%. Artifact `.tmp/hillclimb/2026-08-20T02-04-08-261Z/`. |
| PNG-021 | 2026-08-20 02:07 | Validate the final PNG-015–018 stack on neighboring `png-alpha-resize`. | 77.34 → 77.39 | +0.07% | -0.04% | neutral | Validation passed; retained stack unchanged. Paired median −0.66%, 4/7 pairs faster; base/candidate CV 1.04%/0.90%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T02-05-50-552Z/`. |
| PNG-022 | 2026-08-20 02:08 | Validate the final PNG-015–018 stack on neighboring `jpeg-to-png`. | 411.30 → 416.72 | +1.32% | +0.16% | neutral | Retained only pending a 15-pair regression guard. Paired median +1.66%, 2/7 pairs faster; base/candidate CV 1.31%/1.28%, exact outputBytes. Artifact `.tmp/hillclimb/2026-08-20T02-07-09-100Z/`. |
| PNG-023 | 2026-08-20 02:10 | Confirm PNG-022's `jpeg-to-png` neighboring regression guard with 15 paired trials. | 414.93 → 417.84 | +0.70% | -0.44% | neutral | Validation passed; retained final stack. Paired median +0.51%, 6/15 pairs faster; base/candidate CV 2.09%/1.62%, exact outputBytes, well below the 5% regression guard. Artifact `.tmp/hillclimb/2026-08-20T02-08-20-360Z/`. |







Measurement artifacts:

- JPEG-024 control: `.tmp/hillclimb/2026-08-17T18-47-17-238Z/comparison.md`
- JPEG-024: `.tmp/hillclimb/2026-08-17T18-50-18-324Z/comparison.md`
- Neighbor `jpeg-resize-1200`: `.tmp/hillclimb/2026-08-17T18-52-16-709Z/comparison.md` (exact hash, +2.54%)
- Neighbor `jpeg-crop-resize`: `.tmp/hillclimb/2026-08-17T18-53-20-053Z/comparison.md` (exact hash; scale 4 still too small)
- JPEG-025: `.tmp/hillclimb/2026-08-17T19-25-44-854Z/comparison.md`
- JPEG-026: `.tmp/hillclimb/2026-08-17T19-29-12-975Z/comparison.md`
- JPEG-027 noisy 7-trial: `.tmp/hillclimb/2026-08-17T19-30-58-190Z/comparison.md`
- JPEG-027 15-trial: `.tmp/hillclimb/2026-08-17T19-32-56-923Z/comparison.md`
- JPEG-028 7-trial: `.tmp/hillclimb/2026-08-17T19-36-52-749Z/comparison.md`
- JPEG-028 15-trial: `.tmp/hillclimb/2026-08-17T19-38-12-205Z/comparison.md`
- Neighbor `jpeg-resize-1200` (025–028): `.tmp/hillclimb/2026-08-17T19-41-05-146Z/comparison.md`
- JPEG-029 closures: `.tmp/hillclimb/2026-08-17T19-43-10-930Z/comparison.md`
- JPEG-029b: `.tmp/hillclimb/2026-08-17T19-44-35-360Z/comparison.md`
- Neighbor `jpeg-crop-resize`: `.tmp/hillclimb/2026-08-17T19-45-47-087Z/comparison.md`
- Neighbor `jpeg-resize-1200` (full stack): `.tmp/hillclimb/2026-08-17T19-47-14-989Z/comparison.md`
- Imazen JPEG: `.tmp/imazen-jpeg-025/imazen-jpeg-conformance.md`
- JPEG-030: `.tmp/hillclimb/2026-08-17T20-15-21-834Z/comparison.md`
- JPEG-031: `.tmp/hillclimb/2026-08-17T20-28-36-634Z/comparison.md`
- JPEG-032: `.tmp/hillclimb/2026-08-17T20-30-52-595Z/comparison.md`
- JPEG-033: `.tmp/hillclimb/2026-08-17T20-32-28-603Z/comparison.md`
- JPEG-034: `.tmp/hillclimb/2026-08-17T20-38-10-149Z/comparison.md`
- JPEG-035: `.tmp/hillclimb/2026-08-17T20-39-58-332Z/comparison.md`
- JPEG-036: `.tmp/hillclimb/2026-08-17T20-41-56-533Z/comparison.md`
- Imazen JPEG (031–036): `.tmp/imazen-jpeg-031/imazen-jpeg-conformance.md`
- Neighbor `jpeg-crop-resize` (031–036): `.tmp/hillclimb/2026-08-17T20-43-20-143Z/comparison.md`
- JPEG-037: `.tmp/hillclimb/2026-08-17T21-06-35-912Z/comparison.md`
- Neighbor `jpeg-crop-resize` after JPEG-037: `.tmp/hillclimb/2026-08-17T21-07-54-845Z/comparison.md`
- JPEG-038: `.tmp/hillclimb/2026-08-17T21-10-15-222Z/comparison.md`
- Neighbor `northstar-photo-pipeline` after JPEG-037: `.tmp/hillclimb/2026-08-17T21-11-36-435Z/comparison.md`
- Imazen JPEG (037): `.tmp/imazen-jpeg-037/imazen-jpeg-conformance.md`
- Neighbor `jpeg-crop-resize`: `.tmp/hillclimb/2026-08-17T20-33-45-188Z/comparison.md`
- Profiles: `.tmp/cpu-northstar-speed/`

## JPEG speed campaign

| ID | Timestamp (UTC) | Hypothesis / change | Wall median base → candidate (ms) | Speed Δ | Paired speed Δ | Peak RSS Δ | Verdict | Disposition |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| JPEG-001 | 2026-08-16 22:41 | Use typed-array coefficient reads and precompute IDCT basis offsets in `src/codecs/jpeg-baseline.ts`. | 3509.43 → 3391.38 | -3.36% | -3.15% | -1.01% | accepted | Retained in `932270e`. |
| JPEG-002 | 2026-08-16 23:49 | Hoist YCbCr row offsets and read the component planes directly in `renderYcbcrRows`. | 3407.84 → 3379.95 | -0.82% | -0.25% | +0.12% | neutral | Reverted; below threshold and slightly higher RSS. |
| JPEG-003 | 2026-08-16 23:52 | Alias Huffman table arrays and use direct typed-array reads in `decodeHuffman`. | 3397.82 → 3319.98 | -2.29% | -3.15% | -0.31% | neutral | Reverted; promising paired samples, but the seven-trial median stayed below 3%. |
| JPEG-004 | 2026-08-16 23:56 | Alias RGB ICC matrix/curve arrays in the per-pixel ICC loop. | 3435.44 → 3457.35 | +0.64% | +0.88% | -0.67% | neutral | Reverted; slower for the speed goal. |
| JPEG-005 | 2026-08-17 00:10 | Combine the retained IDCT change with the YCbCr and Huffman candidates. | 3380.69 → 3343.78 | -1.09% | -2.04% | +0.25% | neutral | Reverted; cumulative result still missed 3% and regressed RSS. |
| JPEG-006 | 2026-08-17 00:24 | Fuse matrix-ICC conversion into YCbCr rendering to remove the second RGB traversal. | 3661.07 → 3928.86 | +7.31% | +9.76% | +2.30% | rejected | Reverted; per-pixel writer calls cost more than the removed pass. |
| JPEG-007 | 2026-08-17 00:36 | Add marker-safe buffered entropy lookahead and 8-bit-prefix Huffman tables in `src/codecs/jpeg-baseline.ts` and `src/codecs/jpeg-source.ts`. | 3350.26 → 2911.43 | -13.10% | -13.09% | -1.03% | accepted | Retained in `4496dff`; exact output and protected metrics matched. |
| JPEG-008 | 2026-08-17 01:09 | No-change control: compare the skill-only `HEAD` against `origin/main`. | 3028.76 → 2992.38 | -1.20% | -1.16% | -0.23% | neutral | Control; no source changes retained. |
| JPEG-009 | 2026-08-17 01:13 | Precompute exact `red+green` ICC matrix contribution pairs to reduce per-pixel lookup work in `src/codecs/icc.ts`. | 2996.98 → 3003.67 | +0.22% | +2.01% | +1.17% | neutral | Reverted; correctness matched, but the table allocation and lookup path were slower and noisier. |
| JPEG-010 | 2026-08-17 01:18 | Expand the JPEG canonical Huffman prefix table from 8 to 12 bits in `src/codecs/jpeg-baseline.ts`. | 2988.11 → 3079.25 | +3.05% | -1.52% | +0.24% | inconclusive | Seven-pair run was noisy (base CV 8.95%, paired MAD 3.25 percentage points); retained pending 15-pair confirmation. |
| JPEG-011 | 2026-08-17 01:20 | Confirm `JPEG-010` with 15 paired trials. | 3304.67 → 3467.21 | +4.92% | +2.10% | +0.45% | rejected | Reverted; 11/15 pairs were slower, so the larger prefix table is a credible regression despite matching correctness and protected metrics. |
| JPEG-012 | 2026-08-17 01:27 | Add a DC-only baseline IDCT fast path that fills constant blocks without the second transform pass. | 3200.62 → 3312.37 | +3.49% | +0.54% | -1.29% | neutral | Reverted; the branch and fill path outweighed the rare arithmetic savings. |
| JPEG-013 | 2026-08-17 01:31 | Add single-accumulator fast paths for JPEG `readBits` and `skipBits` in the in-memory and source readers. | 3340.31 → 3352.79 | +0.37% | +2.72% | +0.05% | neutral | Reverted; 5/7 pairs were slower and the general loop was not a measurable bottleneck. |
| JPEG-014 | 2026-08-17 01:35 | Replace ICC `Math.min`/`Math.max` clamping with equivalent bounds branches in `encodeLinear`. | 3404.87 → 3473.36 | +2.01% | +2.30% | -0.01% | neutral | Reverted; the existing clamp form is faster on V8 for this workload. |
| JPEG-015 | 2026-08-17 01:42 | Use a guarded `Uint32Array` workspace for exact RGB/RGBA box-shrink sums in `src/resize.ts`. | 3487.67 → 3525.18 | +1.08% | +2.95% | -0.45% | neutral | Reverted; the smaller integer workspace did not overcome its extra selection/type cost. |
| JPEG-016 | 2026-08-17 01:46 | Use direct contiguous source offsets for the full-resolution YCbCr render branch, avoiding three redundant x-index lookups. | 3433.80 → 3397.29 | -1.06% | -0.49% | -1.22% | neutral | Reverted; the paired median was effectively unchanged and far below the material speed threshold. |
| JPEG-017 | 2026-08-17 01:50 | Remove the baseline decoder’s recycled-plane `fill(0)` pass after each MCU row. | 2971.39 → 3065.96 | +3.18% | +1.21% | -1.31% | rejected | Reverted; stale-plane avoidance is cheaper than the slower reuse path on this workload. |
| JPEG-018 | 2026-08-17 01:56 | Precompute per-component `quantization × IDCT basis` tables to remove repeated dequantization multiplies in `inverseDct`. | 3080.10 → 3078.49 | -0.05% | +0.25% | +0.28% | neutral | Reverted; the extra table footprint canceled the arithmetic saving. |
| JPEG-019 | 2026-08-17 02:00 | Unroll the fixed eight horizontal IDCT output accumulations while preserving coefficient order and arithmetic. | 3151.41 → 3053.53 | -3.11% | -2.89% | +0.10% | material | Retained; exact output/protected metrics matched and 6/7 paired trials favored the candidate. |
| JPEG-020 | 2026-08-17 02:03 | Confirm `JPEG-019` with 15 paired trials. | 3011.58 → 2917.01 | -3.14% | -3.14% | -0.58% | inconclusive | Retained provisionally; 13/15 pairs favored the candidate and the median remained material, but two extreme slow pairs exceeded the runner’s 10% CV comparability guard. |
| JPEG-021 | 2026-08-17 02:08 | Validate retained `JPEG-019` on neighboring `jpeg-resize-1200`. | 804.19 → 854.49 | +6.25% | +3.02% | -0.38% | inconclusive | Kept provisionally; the neighbor is noisy (paired CV 271%) and the candidate-specific unrolled scale-1 kernel needs a higher-sample check before being discarded. |
| JPEG-022 | 2026-08-17 02:10 | Confirm neighboring `jpeg-resize-1200` with 15 paired trials. | 811.37 → 822.00 | +1.31% | +0.30% | -0.28% | inconclusive | No cross-workload speed win, but the paired median was near zero with 504% CV; keep the primary-specific kernel and validate a same-source crop/resize neighbor. |
| JPEG-023 | 2026-08-17 02:13 | Validate retained `JPEG-019` on same-source `jpeg-crop-resize`. | 748.81 → 727.77 | -2.81% | -0.25% | +0.31% | neutral | Reconfirmed correctness and a noisy directional speed benefit, but the paired median stayed below the promising threshold; no additional change retained. |

Measurement artifacts:

- JPEG-001: `.tmp/hillclimb/2026-08-16T22-41-31-478Z/comparison.md`
- JPEG-002: `.tmp/hillclimb/2026-08-16T23-49-48-970Z/comparison.md`
- JPEG-003: `.tmp/hillclimb/2026-08-16T23-52-34-648Z/comparison.md`
- JPEG-004: `.tmp/hillclimb/2026-08-16T23-56-20-601Z/comparison.md`
- JPEG-005: `.tmp/hillclimb/2026-08-17T00-10-26-156Z/comparison.md`
- JPEG-006: `.tmp/hillclimb/2026-08-17T00-24-28-306Z/comparison.md`
- JPEG-007: `.tmp/hillclimb/2026-08-17T00-36-30-485Z/comparison.md`
- JPEG-008: `.tmp/hillclimb/2026-08-17T01-09-41-480Z/comparison.md`
- JPEG-009: `.tmp/hillclimb/2026-08-17T01-13-59-577Z/comparison.md`
- JPEG-010: `.tmp/hillclimb/2026-08-17T01-18-11-586Z/comparison.md`
- JPEG-011: `.tmp/hillclimb/2026-08-17T01-20-41-864Z/comparison.md`
- JPEG-012: `.tmp/hillclimb/2026-08-17T01-27-17-605Z/comparison.md`
- JPEG-013: `.tmp/hillclimb/2026-08-17T01-31-01-748Z/comparison.md`
- JPEG-014: `.tmp/hillclimb/2026-08-17T01-35-01-265Z/comparison.md`
- JPEG-015: `.tmp/hillclimb/2026-08-17T01-42-31-014Z/comparison.md`
- JPEG-016: `.tmp/hillclimb/2026-08-17T01-46-26-709Z/comparison.md`
- JPEG-017: `.tmp/hillclimb/2026-08-17T01-50-14-878Z/comparison.md`
- JPEG-018: `.tmp/hillclimb/2026-08-17T01-56-29-204Z/comparison.md`
- JPEG-019: `.tmp/hillclimb/2026-08-17T02-00-49-091Z/comparison.md`
- JPEG-020: `.tmp/hillclimb/2026-08-17T02-03-09-738Z/comparison.md`
- JPEG-021: `.tmp/hillclimb/2026-08-17T02-08-08-687Z/comparison.md`
- JPEG-022: `.tmp/hillclimb/2026-08-17T02-10-01-060Z/comparison.md`
- JPEG-023: `.tmp/hillclimb/2026-08-17T02-13-10-755Z/comparison.md`

## Retained-stack validation

- JPEG corpus: `.tmp/hillclimb/jpeg-corpus-2026-08-17-escalated/` — 254
  images, 39 pass, 2 unsupported, 167 safely rejected, 46 accepted, and 0
  decode failures, raw exceptions, timeouts, process crashes, or OOM results.

## WebP speed campaign

The selected official hillclimb workload is `webp-large-resize-jpeg`: a
1600x2000 lossy WebP decoded, resized to 800x1000, and encoded as JPEG
quality 80. After WEBP-011 that VP8 path is mostly resize/JPEG-bound, so
WEBP-018 moved to the larger `webp-memory-lossless-resize-jpeg`
4000x3000 lossless decode (not in `web-codecs`). Official e2e remains
the correctness/RSS gate; decode-only timings isolate the VP8L kernel.

| ID | Timestamp (UTC) | Hypothesis / change | Wall median base → candidate (ms) | Speed Δ | Paired speed Δ | Peak RSS Δ | Verdict | Disposition |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| WEBP-000 | 2026-08-17 01:21 | No-change control: compare clean `4496dff` against itself. | 619.59 → 626.32 | +1.09% | +0.22% | -1.43% | neutral | Control; no source change. |
| WEBP-001 | 2026-08-17 01:25 | Reuse one `Int32Array(25 * 16)` coefficient buffer across VP8 macroblocks in `src/codecs/vp8.ts`. | 506.44 → 496.85 | -1.89% | -1.63% | -0.42% | neutral | Reverted; correct and slightly faster, but below the 3% material threshold with higher candidate MAD. |
| WEBP-002 | 2026-08-17 01:30 | Unroll all VP8 4x4 intra prediction modes to remove per-block arrays and closure calls in `predictBlock`. | 715.59 → 497.92 | -30.42% | -24.97% | +20.72% | rejected | Reverted; peak RSS regression exceeded the 5% protected limit and candidate CV exceeded 10%. |
| WEBP-003 | 2026-08-17 01:36 | Reuse typed scratch arrays and remove per-block prediction arrays/closure calls while retaining the prediction loops. | 653.07 → 534.21 | -18.20% | -20.41% | +19.61% | rejected | Reverted; stable peak RSS regression exceeded the 5% protected limit. |
| WEBP-004 | 2026-08-17 01:39 | Pack loop-filter parameters and replace fixed `[4, 8, 12]` edge arrays with direct calls. | 591.39 → 595.99 | +0.78% | -1.23% | +2.11% | neutral | Reverted; below the 3% material speed threshold. |
| WEBP-005 | 2026-08-17 01:44 | Reuse typed top/left/diagonal neighbor scratch in `predictBlock` while preserving the existing prediction loops. | 589.69 → 498.31 | -15.50% | -16.75% | +11.25% | rejected | Reverted; the speed win came with an 11.25% peak-RSS regression. |
| WEBP-006 | 2026-08-17 01:48 | Hoist conversion row bases and reuse each 4:2:0 chroma sample for its two luma pixels in `convertVp8Rows`. | 632.99 → 591.63 | -6.53% | -3.11% | +0.40% | accepted | Retained; primary and lossless pressure paths passed with a negligible RSS change. |
| WEBP-007 | 2026-08-17 02:29 | Rewrite `predictBlock` with local neighbor samples and direct stores, without reused scratch buffers. | 491.35 → 389.42 | -20.75% | n/a | +15.01% | rejected | Reverted; exact output, but peak RSS exceeded the 5% protected limit. |
| WEBP-008 | 2026-08-17 02:38 | Keep the allocation-free `predictBlock` rewrite and reuse one coefficient buffer plus Walsh temps across macroblocks. | 489.88 → 380.49 | -22.33% | -23.21% | +3.27% | accepted | Retained; the reused buffers kept the live set inside the RSS gate. |
| WEBP-009 | 2026-08-17 02:54 | Replace private BooleanDecoder fields with locals inside `bit()` and pass an explicit 128-probability for signs. | 381.67 → 377.46 | -1.10% | -2.07% | +0.02% | inconclusive | Reverted; 5/7 pairs were faster but paired CV was 227% and two pairs were slower. |
| WEBP-010 | 2026-08-17 02:57 | Replace `Math.max`/`Math.min` clamps in `clampByte` and `saturateInt8` with direct branches. | 385.40 → 375.81 | -2.49% | -3.56% | -0.55% | promising | Retained; 6/7 pairs favored the candidate and paired median cleared 3%. |
| WEBP-011 | 2026-08-17 02:58 | Inline VP8 loop-filter threshold, common, and macroblock kernels in `filterNormalEdge`, stacked on WEBP-010. | 380.46 → 358.88 | -5.67% | -5.76% | +0.91% | material | Retained; 7/7 pairs faster, exact output, RSS +0.91%. |
| WEBP-012 | 2026-08-17 02:59 | Precompute 8-bit YUV-to-RGB multiply tables in `yuvToArgb`. | 374.50 → 355.58 | -5.05% | -5.67% | +3.85% | neutral | Reverted; no incremental gain over WEBP-011 and higher RSS. |
| WEBP-013 | 2026-08-17 03:08 | Fast-path `inverseDctAdd` for all-zero and DC-only 4x4 residuals. | 363.29 → 362.16 | -0.31% | -1.45% | +0.29% | neutral | Reverted; scanning every block canceled most of the skipped-IDCT saving. |
| WEBP-014 | 2026-08-17 03:10 | Precompute VP8 coefficient probability offsets in `decodeCoefficientBlock`. | 370.62 → 360.50 | -2.73% | -0.87% | -0.15% | inconclusive | Reverted; 5/7 pairs faster but two pairs were 5–10% slower. |
| WEBP-015 | 2026-08-17 03:12 | Specialize `filterNormalEdge` for adjacent (`step === 1`) pixels. | 367.89 → 360.06 | -2.13% | -2.51% | +0.62% | inconclusive | Reverted; 4/7 pairs faster and three pairs were slower. |
| WEBP-016 | 2026-08-17 03:13 | Skip `inverseDctAdd` using a decode-time residual bitmask; unroll `[3,7,11]` predictor copies. | 359.88 → 354.42 | -1.52% | -2.48% | -0.45% | inconclusive | Reverted; 7-trial looked promising but 15-trial median was +2.18% and noisy. |
| WEBP-017 | 2026-08-17 03:17 | Share 4:2:0 chroma matrix products across two luma pixels in `convertVp8Rows`. | 360.79 → 381.48 | +5.73% | n/a | +3.71% | rejected | Reverted; slower than calling `yuvToArgb` twice. |
| WEBP-018 | 2026-08-17 03:35 | VP8L: reuse two scanline buffers, drop per-pixel `%`, reuse predictor previous via `.set()`, specialize mode-11 `select` + packed byte add. | 722.68 → 428.53 | -40.70% | n/a | mixed / ~0% | material | Retained; 4000x3000 decode-only, exact e2e hash, Imazen 223/2/0. |
| WEBP-019 | 2026-08-17 08:49 | Hoist uniform predictor mode; dedicated mode-11 `inversePredictorSelectRow` without per-pixel mode-table lookup. | 445.99 → 414.39 | -7.09% | n/a | n/a | promising | Retained; 4K fixture is 100% mode 11. |
| WEBP-020 | 2026-08-17 08:51 | Inline color-cache inserts and copy backward-reference runs without calling `write()` per pixel. | 414.39 → 279.11 | -32.65% | n/a | n/a | material | Retained; post-019 profile had `write` at 27.8%. |
| WEBP-021 | 2026-08-17 08:52 | Specialize packed-ARGB→RGBA unpack when there is no extra alpha plane. | 279.11 → 260.36 | -6.72% | n/a | n/a | promising | Retained; decode() was 14.6% of the post-019 profile. |
| WEBP-022 | 2026-08-17 08:53 | Hoist a uniform color-transform kernel / skip identity color transform. | 260.36 → 256.67 | -1.42% | n/a | n/a | neutral | Reverted; within noise and the 4K color transform is not uniform. |
| WEBP-023 | 2026-08-17 08:54 | Packed subtract-green without `pack`/`channel`. | 260.36 → 291.94 | +12.13% | n/a | n/a | rejected | Reverted; slower and noisier. |
| WEBP-024 | 2026-08-17 08:55 | Skip per-symbol meta-group lookup when `groupCount === 1`. | 260.36 → 291.82 | +12.08% | n/a | n/a | rejected | Reverted; extra branch did not pay. |
| WEBP-025 | 2026-08-17 08:56 | Inline `inverseColorRow` arithmetic and drop `pack`/`channel`. | n/a | n/a | n/a | n/a | inconclusive | Reverted; measurement collided with host load ~38. |

## WebP lossy encode campaign

Official `web-codecs` hillclimb cannot select an encode-to-WebP
workload. Isolated 1200x900 RGB → WebP quality 80 encode of the tundra
frame is the speed kernel; bitstream SHA-256 must stay
`863189a52dc302ff68a9007b2d124f88b6a9603e03d782173782a6806e7211ff`.
`jpeg-to-webp-lossy` pixel samples were updated to the current Lanczos
source and remain the family correctness/RSS gate.

| ID | Timestamp (UTC) | Hypothesis / change | Wall median base → candidate (ms) | Speed Δ | Verdict | Disposition |
| --- | --- | --- | ---: | ---: | --- | --- |
| WEBP-ENC-001 | 2026-08-17 09:23 | Precompute clamped Y and finalized chroma planes; unroll 4x4 residual gathers in `encodeVp8`. | 126.06 → 50.16 | -60.21% | material | Retained; exact bitstream, 31/31 webp tests. |
| WEBP-ENC-002 | 2026-08-17 09:24 | Specialize RGB8 RGB→YUV in `LossyWebpEncoder.write()` without per-pixel format/alpha branches. | 51.86 → 43.22 | -16.66% | material | Retained; exact bitstream. |
| WEBP-ENC-003 | 2026-08-17 09:25 | Integer-only `quantize` without `Math.floor`/`Math.abs`/`Math.min`. | 43.22 → 63.67 | +47.3% | rejected | Reverted; exact bitstream but slower. |
| WEBP-ENC-004 | 2026-08-17 10:20 | Specialize luma DC prediction as `predictDc4` without a generic size loop. | ~47 → 43.78 | ~-7% | promising | Retained; exact bitstream. |
| WEBP-ENC-005 | 2026-08-17 10:24 | Compute DC predictors without filling the plane; add the predictor in a dedicated inverse DCT. | 43.78 → 34.74 | -20.65% | material | Retained; exact bitstream. The previous fill was overwritten by reconstruction. |
| WEBP-ENC-006 | 2026-08-17 10:25 | Fuse dequantization into the inverse DCT first pass. | 34.74 → 36.19 | +4.2% | rejected | Reverted; extra multiplies in IDCT cost more than the removed reconstruct pass. |
| WEBP-ENC-007 | 2026-08-17 10:26 | Drop RGB8 Y/U/V clamps that are in-range for 8-bit BT.601. | 34.74 → 34.60 | -0.4% | neutral | Reverted; exact bitstream, within noise. |
| WEBP-ENC-008 | 2026-08-17 10:27 | Skip the EOB zero-scan in `writeCoefficientBlock` when `checkEnd` is false. | 34.74 → 35.56 | +2.4% | rejected | Reverted; extra branch on the common path. |
| WEBP-ENC-009 | 2026-08-17 10:28 | Process two RGB8 pixels per iteration and share the chroma bucket. | 34.74 → 35.10 | +1.0% | neutral | Reverted; superseded by ENC-016. |
| WEBP-ENC-010 | 2026-08-17 10:31 | Skip reconstruct/IDCT when the quantized 4x4 is all zero (96% of tundra q80 blocks). | 34.74 → 38.61 | +11.1% | rejected | Reverted; the extra scan/fill/branch in the MB loop outweighed skipped IDCT. |
| WEBP-ENC-011 | 2026-08-17 10:33 | Fast-path all-zero coefficient blocks to a single EOB bit. | 34.74 → 38.81 | +11.7% | rejected | Reverted; the existing first-iteration scan already emits one EOB. |
| WEBP-ENC-012 | 2026-08-17 10:34 | Replace RGB→YUV multiplies with 256-entry contribution tables. | 34.74 → 43.35 | +24.8% | rejected | Reverted; lookups slower than the integer multiplies. |
| WEBP-ENC-013 | 2026-08-17 10:35 | `BooleanEncoder.zeros()` with local range/bottom for 16 keyframe block-mode bits. | 34.74 → 34.97 | +0.7% | neutral | Reverted; header bits are not the bottleneck. |
| WEBP-ENC-014 | 2026-08-17 10:36 | Even-size `finalizeChroma` uses `(sum + 2) >> 2` instead of `Math.round(sum / 4)`. | 34.74 → 32.55 / 34.00 | -2% to -6% | promising | Retained; exact bitstream. Still used for gray/RGBA. |
| WEBP-ENC-015 | 2026-08-17 10:37 | Split DC/AC in `quantize` and hoist `ac / 2`. | 34.00 → 33.61 | -1.1% | neutral | Reverted; within noise. |
| WEBP-ENC-016 | 2026-08-17 10:39 | RGB8 2x2 write finalizes chroma into `Uint8` planes and skips the extra pass. | 34.00 → 31.03 / 32.57 | -4% to -9% | promising | Retained; exact bitstream, 37/37 webp tests. |

Handoff: Imazen WebP corpus stayed 223 pass / 2 unsupported / 0
decode failures. `npm run check` passed (133 files, 1564 tests).

## WebP lossless encode campaign

Official `web-codecs` hillclimb cannot select an encode-to-WebP
workload. Isolated 1200x480 RGBA → lossless WebP (default effort 4) of
`transparent-logo-1200x480.png` is the speed kernel; bitstream SHA-256
must stay `29ddceecce1e7134a23ef349f2260923c426cb6e6f11831e19d01078af0442d9`
(408 bytes). `png-to-webp-lossless` remains the family correctness gate.

| ID | Timestamp (UTC) | Hypothesis / change | Wall median base → candidate (ms) | Speed Δ | Verdict | Disposition |
| --- | --- | ---: | ---: | ---: | --- | --- |
| WEBP-LLENC-001 | 2026-08-17 11:07 | Ring-buffer LZ77 hash table: O(1) insert instead of shifting 16 candidates. | 165.68 → 142.72 | -13.86% | material | Retained; exact bitstream, newest-first tie-break preserved. |
| WEBP-LLENC-002 | 2026-08-17 11:09 | Record LZ77 tokens once; build spatial histograms and emit bits from the stream. | 142.72 → 101.49 | -28.89% | material | Retained; exact bitstream. Removed two rematch passes. |
| WEBP-LLENC-003 | 2026-08-17 11:10 | Unroll `matchLength` four pixels at a time. | 101.49 → 106.91 | +5.3% | rejected | Reverted; extra branches lost. |
| WEBP-LLENC-004 | 2026-08-17 11:11 | Specialize RGBA8 `write()` without per-pixel channel branches. | 101.49 → 103.68 | +2.2% | neutral | Reverted; within noise. |
| WEBP-LLENC-005 | 2026-08-17 11:11 | Skip the color-transform cost pass when it cannot win. | 101.49 → 250.28 | +146% | rejected | Reverted; noisy and slower; early-out did not pay. |
| WEBP-LLENC-006 | 2026-08-17 11:12 | Score color-cache sizes 8/9/10 in one pixel scan. | 101.49 → 100.17 | -1.3% | promising | Retained; exact bitstream, one-third the cache scans. |

Neighbor `odd-rgba-257x193` isolated encode: 4.74 ms, hash
`4159b433761cae56d0d61aa95f32bf6d791ae610a756960a93a079ec51251e11`.
Handoff: Imazen WebP corpus stayed 223 pass / 2 unsupported / 0 decode
failures. `npm run check` passed (133 files, 1565 tests).

## AVIF speed campaign

Official workload: `avif-fox-resize-jpeg` — 1204x800 profile0 4:2:0 AVIF
decoded, resized to 800px, JPEG quality 80. Goal is end-to-end speed.
CPU samples put `boxFilter` (35%), `restoreWienerBlock` (9%), and
`round2` among the hottest functions before this campaign.

| ID | Timestamp (UTC) | Hypothesis / change | Wall median base → candidate (ms) | Speed Δ | Peak RSS Δ | Verdict | Disposition |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| AVIF-001 | 2026-08-17 11:43 | Gather each SGR 4x4 window once; box-filter from the local buffer. | 1427.12 → 1209.91 | -15.22% | +0.28% | material | Retained; 15-trial accepted, exact correctness/output bytes. |
| AVIF-002 | 2026-08-17 11:45 | Skip `round2` when bit-depth shift is 0 in `boxFilter`. | 1922.48 → 1268.32 | noisy | -0.13% | neutral | Reverted; 7-trial base CV exceeded 10% and no incremental win over AVIF-001. |
| AVIF-003 | 2026-08-17 11:48 | Prefix-sum SGR box sums/squares on the gathered window. | 1428.54 → 1161.68 | -18.68% | -0.10% | material | Retained; 15-trial accepted on the AVIF-001 stack. |
| AVIF-004 | 2026-08-17 11:51 | Gather a 10x10 window for Wiener 7-tap filtering. | 1429.29 → 1122.23 | -21.48% | -0.34% | material | Retained; 15-trial accepted on the AVIF-001+003 stack. Neighbor `avif-fox-full-png` 1591.88 → 1287.02 (−19.15%). |
| AVIF-005 | 2026-08-17 16:08 | Build SGR prefix sums once per block instead of once per box-filter pass. | 1126.17 → 1086.82 | -3.49% | +0.15% | material | Retained; 7-trial accepted vs `5cfa0e6`, exact hashes. |
| AVIF-006 | 2026-08-17 16:10 | Unroll Wiener 7-tap horizontal and vertical filters from the gathered window. | 1122.57 → 1061.15 | -5.47% | +0.56% | material | Retained on the AVIF-005 stack; 7-trial accepted vs `5cfa0e6`, exact hashes. |
| AVIF-007 | 2026-08-17 16:15 | Copy interior CDEF windows without `sourceSample` clipping; require plane and stripe bounds. | 1133.10 → 1028.32 | -9.25% | -0.39% | material | Retained on the AVIF-005+006 stack; 162 AVIF decode tests passed after a first-pass plane-end clip miss. |
| AVIF-008 | 2026-08-17 16:17 | Unroll SGR 3x3 a/b blend; specialize pass-0 odd/even rows and pass-1 weights. | 1125.44 → 968.89 | -13.91% | +0.26% | material | Retained on the AVIF-005–007 stack; photo and high-bit hashes matched. |
| AVIF-009 | 2026-08-17 16:20 | Specialize 8-bit SGR prefix variance; inline `round2` for shifts 12 and 20. | 1121.34 → 971.26 | -13.38% | +0.62% | neutral | Reverted; no incremental win over AVIF-008 (968.89 ms) and candidate MAD jumped to 33 ms. |
| AVIF-010 | 2026-08-17 16:30 | Reuse 1D transform, dequant, intermediate, and column scratch buffers. | 1134.79 → 867.14 | -23.59% | -0.42% | material | Retained; isolated 7-trial accepted. First run was incomparable under concurrent tests (−25.63%). 162+256 AVIF tests passed after fixing column `input.length`. |
| AVIF-011 | 2026-08-17 16:32 | Specialize 4:2:0 chroma upsample and hoist plane pointers in `av1ToRgbaRegion`. | 1127.48 → 828.65 | -26.50% | -0.73% | material | Retained on the AVIF-005–008+010 stack; photo hashes matched. |
| AVIF-012 | 2026-08-17 16:35 | Specialize 8-bit Wiener 7-tap rounding and clamping. | 1141.81 → 802.34 | -29.73% | +0.87% | material | Retained; photo and high-bit restoration hashes matched. Neighbor `avif-fox-full-png` 1312.74 → 987.77 (−24.76%). |
| AVIF-013 | 2026-08-17 16:37 | Copy interior restoration windows with `TypedArray.set()`. | 1134.64 → 923.45 | -18.61% | +0.82% | rejected | Reverted; per-row `subarray`/`set` allocations lost ~120 ms versus AVIF-012. |
| AVIF-014 | 2026-08-17 21:26 | Specialize 8-bit SGR `boxFilter`: drop bit-depth rounding and inline `round2` as shifts. | 827.92 → 769.02 | **-7.11%** | -0.69% | material | Retained. Exact hash. |
| AVIF-015 | 2026-08-17 21:28 | Build SGR prefixes from the CDEF plane for interior 4x4 blocks; skip the Int32 window copy. | 838.04 → 765.76 | **-8.62%** vs HEAD (~0% vs AVIF-014) | -0.09% | rejected | Reverted. Incremental vs AVIF-014 was noise (MAD 17.5 ms). |
| AVIF-016 | 2026-08-17 21:38 | Restore 8-bit SGR/Wiener as unit-width × 4-row tiles instead of 4x4. High-bit stays 4-wide so Int32 prefix squares do not overflow. | 838.46 → 646.38 | **-22.91%** | +1.25% | material | Retained on AVIF-014. Exact hash, 7/7 pairs faster. First 12-bit draft overflowed prefix squares; capped high-bit tiles. |
| AVIF-017 | 2026-08-17 21:48 | Replace `boxFilter8` `a`-from-`z` division with a 256-entry LUT. | 799.78 → 639.02 | **-20.10%** vs HEAD (~0% vs AVIF-016 646 ms) | -0.79% | neutral | Reverted. Incremental vs 016 was noise (candidate 639 vs 646, MAD ~10 ms). |
| AVIF-018 | 2026-08-17 21:52 | Inline 8-bit 4:2:0 YUV convert; hoist range/matrix scales out of the per-pixel closure. | 885.16 → 684.69 | **-22.65%** vs HEAD (~0% vs AVIF-016; noisy) | +2.54% | neutral | Reverted. Base MAD 25 ms; incremental vs 016 not credible. |
| AVIF-019 | 2026-08-17 21:54 | Retry prefix-from-CDEF on unit-width 8-bit interiors (windows ~26× larger than AVIF-015). | 815.60 → 678.27 | incomparable | -0.51% | inconclusive | Reverted. Host CV >10%; incremental vs 016 (646 ms) not shown. |
| AVIF-020 | 2026-08-17 21:57 | Wiener 8-bit interior: 7-tap from CDEF, skip the Int32 window gather. | 789.84 → 638.45 | **-19.17%** vs HEAD (~−1.2% vs AVIF-016) | -1.10% | promising | Retained. Exact hash, candidate MAD 5.4 ms. Deterministic copy skip. |
| AVIF-021 | 2026-08-17 22:01 | Restore 8-bit frames in 8-row bands (12-bit stays 4-row so prefix squares fit Int32). | 834.62 → 622.96 | **-25.36%** vs HEAD (~−2.4% vs AVIF-020) | -0.84% | promising | Retained. 15-trial, 15/15 pairs faster, paired MAD 1.49%. Runner incomparable from two host-load outliers. Exact hash. |
| AVIF-022 | 2026-08-17 22:07 | Restore 8-bit frames in 32-row bands. | n/a | n/a | n/a | rejected | Reverted. 32-row tiles cross the AV1 stripe boundary at luma row 56 and apply the wrong stripe pad. 8-row is the largest power-of-two that stays inside a stripe. |
| AVIF-023 | 2026-08-17 22:22 | Restore 8-bit frames in stripe-aligned bands (56 then 64), clipped to unit rows. | 634.14 → 623.46 | **-1.68%** | -0.40% | neutral | Reverted. 4/7 pairs faster; candidate MAD 21 ms. Extra stripe/unit logic did not beat 8-row. |
| AVIF-024 | 2026-08-17 22:24 | Reuse a 4096-int residual scratch in `inverseTransform` instead of allocating per TU. | 617.22 → 611.48 | **-0.93%** | -0.22% | promising | Retained. Exact hash, 5/7 pairs faster, candidate MAD 2.2 ms. Deterministic allocation cut. |
| AVIF-025 | 2026-08-17 22:26 | Reuse coefficient Int32 scratch in the entropy reader; fill(0) each TU. | 613.52 → 612.92 | **-0.10%** | -0.35% | neutral | Reverted. fill(0) cancelled the allocation win. |
| AVIF-026 | 2026-08-17 22:27 | Skip inverse 1D transforms on all-zero rows and columns. | 620.87 → 589.07 | **-5.12%** | +1.98% | material | Retained on AVIF-024. Exact hash, 7/7 pairs faster, paired MAD 1.43%. |
| AVIF-027 | 2026-08-17 22:30 | Specialize 8-bit SGR final blend: shift-11 rounding and hoist plane pointers. | 620.12 → 599.68 | **-3.30%** vs HEAD (slower than AVIF-026 589 ms) | +1.79% | neutral | Reverted. No incremental win over the zero-row skip. |
| AVIF-028 | 2026-08-17 22:40 | Decode equiprobable bits without allocating a throwaway 50/50 CDF. | 580.04 → 574.62 | **-0.93%** | +1.14% | promising | Retained. Exact hash, 6/7 pairs faster, paired median −2.31%. |
| AVIF-029 | 2026-08-17 22:41 | Skip full dequant math for zero coefficients; write 0 and continue. | 585.36 → 561.05 | **-4.15%** | -0.72% | material | Retained on AVIF-028. Exact hash, 6/7 pairs faster, paired median −5.41%. |
| AVIF-030 | 2026-08-17 22:42 | Hoist YUV range scales out of `convert` (multiply instead of per-pixel fullRange branches). | 592.30 → 561.55 | **-5.19%** vs HEAD (~0% vs AVIF-029) | +0.07% | neutral | Reverted. Incremental vs 029 (561 ms) was noise. |
| AVIF-031 | 2026-08-17 22:47 | Interior 4:2:0 chroma upsample without edge clips. | 590.57 → 548.03 | **-7.20%** | -0.56% | material | Retained on AVIF-028+029. Exact hash, 7/7 pairs faster, candidate MAD 5.8 ms. |
| AVIF-032 | 2026-08-17 22:48 | Replace `Math.log2` `floorLog2` with `31 - Math.clz32`. | 637.16 → 598.78 | **-6.02%** vs HEAD (slower than AVIF-031 548 ms) | +1.33% | rejected | Reverted. No incremental win; noisier candidate (MAD 20.6 ms). |
| AVIF-033 | 2026-08-17 22:57 | Reuse intra above/left/neighbor/filter-edge scratch buffers. | 610.96 → 626.34 | **+2.52%** | -0.97% | rejected | Reverted. Noisy (MAD 30–54 ms) and slower than allocating per block. |
| AVIF-034 | 2026-08-17 23:00 | Replace `2 ** bits` renormalize in the arithmetic coder with `1 << bits`. | 581.38 → 537.38 | **-7.57%** | -0.01% | material | Retained on AVIF-028–031. Exact hash, 7/7 pairs faster, candidate MAD 4.2 ms. |
| AVIF-035 | 2026-08-17 23:05 | Batch `#readRaw` by consuming leftover bits in the current byte. | 586.25 → 536.54 | **-8.48%** vs HEAD (~0% vs AVIF-034) | -0.20% | neutral | Reverted. Incremental vs 034 (537 ms) was noise. |
| AVIF-036 | 2026-08-17 23:06 | Integer `clampByte` via `(value + 0.5) | 0` instead of `Math.round`. | 587.54 → 518.20 | **-11.80%** | -0.04% | material | Retained on AVIF-028–034. Exact hash, 7/7 pairs faster, candidate MAD 4.2 ms. |
| AVIF-037 | 2026-08-17 23:07 | Hoist `boxFilter8` prefix-row bases out of the column loop. | 588.87 → 513.83 | **-12.74%** | +0.84% | promising | Retained on AVIF-036. Exact hash. Incremental ~518 → 514 ms. |
| AVIF-038 | 2026-08-17 23:37 | Replace 8-bit Wiener `Math.floor` rounding with arithmetic shifts. | 609.32 → 526.23 | **-13.64%** vs HEAD (~0% vs AVIF-037 514 ms) | -0.40% | neutral | Reverted. Incremental vs 037 was noise (526 vs 514, MAD 8 ms). |
| AVIF-039 | 2026-08-17 23:38 | Inline `filterSample` edge reads; drop the per-edge closure. | 597.70 → 522.12 | **-12.65%** vs HEAD (~0% vs AVIF-037 514 ms) | +0.22% | neutral | Reverted. Incremental vs 037 was noise (522 vs 514, MAD 5.8 ms). |
| AVIF-040 | 2026-08-17 23:41 | Specialize rgba8 resize write and 4-wide vertical accumulate. | 603.89 → 528.91 | **-12.42%** vs HEAD (slower than AVIF-037 514 ms) | -1.06% | rejected | Reverted. No incremental win; candidate MAD 11 ms. |
| AVIF-041 | 2026-08-17 23:43 | Replace inverse-transform `roundedShift` `Math.floor`/`2**` with arithmetic shifts. | 589.20 → 514.49 | **-12.68%** vs HEAD (~0% vs AVIF-037 514 ms) | +1.24% | neutral | Reverted. Incremental vs 037 was noise. |
| AVIF-042 | 2026-08-17 23:44 | Inline 8-bit 4:2:0 YUV convert; hoist range/matrix scales; drop per-pixel `convert()`. | 588.10 → 499.53 | **-15.06%** | +0.85% | material | Retained on AVIF-028–037. Exact hash, 7/7 pairs faster, candidate MAD 2.7 ms. Incremental ~514 → 500 ms. |
| AVIF-043 | 2026-08-17 23:47 | Constant `n`/`oneOverN` and integer `a` in `boxFilter8`. | 581.08 → 493.18 | **-15.13%** vs HEAD (~0% vs AVIF-042 500 ms) | +1.23% | neutral | Reverted. Incremental vs 042 was host drift (relative −15.13% vs −15.06%). |
| AVIF-044 | 2026-08-18 00:13 | Specialize interior 8-bit 4:2:0 rows; hoist chroma row bases and vertical weights. | 589.88 → 502.51 | **-14.81%** vs HEAD (slower than AVIF-042 500 ms) | +1.27% | rejected | Reverted. Extra row splitting did not beat the 042 convert loop. |
| AVIF-045 | 2026-08-18 00:14 | Build 8-bit interior SGR prefixes from CDEF; skip the Int32 window copy. | 588.08 → 507.75 | **-13.66%** vs HEAD (slower than AVIF-042 500 ms) | -0.72% | rejected | Reverted. Same miss as AVIF-015/019; boxFilter8 still dominates restoration. |
| AVIF-046 | 2026-08-18 00:16 | Replace inverse-DCT `Math.log2` and bit-reverse loops with length LUTs. | 584.50 → 519.62 | **-11.10%** vs HEAD (slower than AVIF-042 500 ms) | +0.68% | rejected | Reverted. Noisy (MAD 16–17 ms) and no incremental win. |

Measurement artifacts:

- AVIF-001 7-trial: `.tmp/hillclimb/2026-08-17T15-41-43-152Z/comparison.md`
- AVIF-001 15-trial: `.tmp/hillclimb/2026-08-17T15-43-03-589Z/comparison.md`
- AVIF-002: `.tmp/hillclimb/2026-08-17T15-45-52-676Z/comparison.md`
- AVIF-003: `.tmp/hillclimb/2026-08-17T15-48-30-460Z/comparison.md`
- AVIF-004: `.tmp/hillclimb/2026-08-17T15-51-39-465Z/comparison.md`
- Neighbor `avif-fox-full-png`: `.tmp/hillclimb/2026-08-17T15-53-50-785Z/comparison.md`
- AVIF-005: `.tmp/hillclimb/2026-08-17T16-08-13-195Z/comparison.md`
- AVIF-006: `.tmp/hillclimb/2026-08-17T16-10-54-258Z/comparison.md`
- AVIF-007: `.tmp/hillclimb/2026-08-17T16-15-01-472Z/comparison.md`
- AVIF-008: `.tmp/hillclimb/2026-08-17T16-17-29-006Z/comparison.md`
- AVIF-009: `.tmp/hillclimb/2026-08-17T16-20-24-483Z/comparison.md`
- AVIF-010 noisy: `.tmp/hillclimb/2026-08-17T16-28-57-134Z/comparison.md`
- AVIF-010 isolated: `.tmp/hillclimb/2026-08-17T16-30-03-218Z/comparison.md`
- AVIF-011: `.tmp/hillclimb/2026-08-17T16-32-50-283Z/comparison.md`
- AVIF-012: `.tmp/hillclimb/2026-08-17T16-35-10-828Z/comparison.md`
- Neighbor `avif-fox-full-png` after AVIF-012: `.tmp/hillclimb/2026-08-17T16-36-16-232Z/comparison.md`
- AVIF-013: `.tmp/hillclimb/2026-08-17T16-37-42-282Z/comparison.md`
- AVIF-014: `.tmp/hillclimb/2026-08-17T21-26-52-491Z/comparison.md`
- AVIF-015: `.tmp/hillclimb/2026-08-17T21-28-50-632Z/comparison.md`
- AVIF-016: `.tmp/hillclimb/2026-08-17T21-38-47-182Z/comparison.md`
- AVIF-017: `.tmp/hillclimb/2026-08-17T21-48-02-138Z/comparison.md`
- AVIF-018: `.tmp/hillclimb/2026-08-17T21-52-09-456Z/comparison.md`
- AVIF-019: `.tmp/hillclimb/2026-08-17T21-54-28-613Z/comparison.md`
- AVIF-020: `.tmp/hillclimb/2026-08-17T21-57-08-537Z/comparison.md`
- AVIF-021 7-trial: `.tmp/hillclimb/2026-08-17T22-00-45-800Z/comparison.md`
- AVIF-023: `.tmp/hillclimb/2026-08-17T22-22-57-089Z/comparison.md`
- AVIF-024: `.tmp/hillclimb/2026-08-17T22-24-29-719Z/comparison.md`
- AVIF-025: `.tmp/hillclimb/2026-08-17T22-26-18-591Z/comparison.md`
- AVIF-026: `.tmp/hillclimb/2026-08-17T22-27-43-703Z/comparison.md`
- AVIF-027: `.tmp/hillclimb/2026-08-17T22-30-24-283Z/comparison.md`
- AVIF-028: `.tmp/hillclimb/2026-08-17T22-40-21-590Z/comparison.md`
- AVIF-029: `.tmp/hillclimb/2026-08-17T22-41-34-205Z/comparison.md`
- AVIF-030: `.tmp/hillclimb/2026-08-17T22-42-43-186Z/comparison.md`
- AVIF-031: `.tmp/hillclimb/2026-08-17T22-47-00-731Z/comparison.md`
- AVIF-032: `.tmp/hillclimb/2026-08-17T22-48-10-220Z/comparison.md`
- AVIF-033: `.tmp/hillclimb/2026-08-17T22-57-49-182Z/comparison.md`
- AVIF-034: `.tmp/hillclimb/2026-08-17T23-00-34-304Z/comparison.md`
- AVIF-035: `.tmp/hillclimb/2026-08-17T23-05-02-394Z/comparison.md`
- AVIF-036: `.tmp/hillclimb/2026-08-17T23-06-39-424Z/comparison.md`
- AVIF-037: `.tmp/hillclimb/2026-08-17T23-07-48-855Z/comparison.md`
- AVIF-038: `.tmp/hillclimb/2026-08-17T23-37-08-094Z/comparison.md`
- AVIF-039: `.tmp/hillclimb/2026-08-17T23-38-53-701Z/comparison.md`
- AVIF-040: `.tmp/hillclimb/2026-08-17T23-41-05-986Z/comparison.md`
- AVIF-041: `.tmp/hillclimb/2026-08-17T23-43-00-862Z/comparison.md`
- AVIF-042: `.tmp/hillclimb/2026-08-17T23-44-34-361Z/comparison.md`
- AVIF-043: `.tmp/hillclimb/2026-08-17T23-47-19-429Z/comparison.md`
- AVIF-044: `.tmp/hillclimb/2026-08-18T00-13-24-768Z/comparison.md`
- AVIF-045: `.tmp/hillclimb/2026-08-18T00-14-58-317Z/comparison.md`
- AVIF-046: `.tmp/hillclimb/2026-08-18T00-16-35-003Z/comparison.md`
- AVIF-021 15-trial: `.tmp/hillclimb/2026-08-17T22-01-57-921Z/comparison.md`
- Profiles: `.tmp/cpu-avif/`

Measurement artifacts:

- WEBP-LLENC isolated timer: `.tmp/time-webp-lossless-encode.ts`
- WEBP-LLENC profiles: `.tmp/cpu-webp-llenc/`

Measurement artifacts:

- WEBP-ENC isolated timer: `.tmp/time-webp-lossy-encode.ts`
- Official `jpeg-to-webp-lossy` pre-existing invalid sample: `.tmp/webp-enc-base/jpeg-to-webp.md`
- WEBP-000: `.tmp/hillclimb/2026-08-17T01-21-53-187Z/comparison.md`
- WEBP-001: `.tmp/hillclimb/2026-08-17T01-25-34-767Z/comparison.md`
- WEBP-002: `.tmp/hillclimb/2026-08-17T01-30-20-291Z/comparison.md`
- WEBP-003: `.tmp/hillclimb/2026-08-17T01-36-23-174Z/comparison.md`
- WEBP-004: `.tmp/hillclimb/2026-08-17T01-39-45-067Z/comparison.md`
- WEBP-005: `.tmp/hillclimb/2026-08-17T01-44-35-970Z/comparison.md`
- WEBP-006: `.tmp/hillclimb/2026-08-17T01-48-03-807Z/comparison.md`
- WEBP-007: `.tmp/hillclimb/2026-08-17T02-29-22-647Z/comparison.md`
- WEBP-008: `.tmp/hillclimb/2026-08-17T02-38-09-800Z/comparison.md`
- WEBP-009: `.tmp/hillclimb/2026-08-17T02-54-58-462Z/comparison.md`
- WEBP-010: `.tmp/hillclimb/2026-08-17T02-57-09-012Z/comparison.md`
- WEBP-011: `.tmp/hillclimb/2026-08-17T02-58-27-936Z/comparison.md`
- WEBP-012: `.tmp/hillclimb/2026-08-17T02-59-48-180Z/comparison.md`
- WEBP-013: `.tmp/hillclimb/2026-08-17T03-08-47-173Z/comparison.md`
- WEBP-014: `.tmp/hillclimb/2026-08-17T03-10-35-631Z/comparison.md`
- WEBP-015: `.tmp/hillclimb/2026-08-17T03-12-13-178Z/comparison.md`
- WEBP-016: `.tmp/hillclimb/2026-08-17T03-13-56-165Z/comparison.md`
- WEBP-016b: `.tmp/hillclimb/2026-08-17T03-14-43-140Z/comparison.md`
- WEBP-017: `.tmp/hillclimb/2026-08-17T03-17-07-159Z/comparison.md`
- WEBP-018 decode-only: `.tmp/time-webp-decode.ts` vs `.tmp/hillclimb/webp-018-base/dist`
- WEBP-018 4K e2e: `.tmp/webp-018-candidate/memory-lossless.md` and `.tmp/webp-018-pairs/`
- WEBP-018 Imazen: `.tmp/imazen-webp-018/imazen-webp-conformance.md`
- WEBP-018 VP8 no-regression: `.tmp/hillclimb/2026-08-17T03-34-46-947Z/comparison.md`
- WEBP-019–021 Imazen: `.tmp/imazen-webp-019/imazen-webp-conformance.md`
- WEBP-021 4K e2e: `.tmp/webp-021-e2e/memory-lossless.md`

### WEBP-018 large lossless decode

4000x3000 lossless CPU profiles put `inversePredictorRow` (16.5%),
`write` (11.5%), and `predictor` (8.4%) at the top of the e2e. Every
interior pixel on `webp-gradient-lossless-4000x3000` uses predictor
mode 11 (`select`). The change reuses two VP8L row buffers, replaces
`position % width` / `position % history.length` with running `x`/`y`
and a power-of-two history mask, copies the previous predictor row
with `.set()` instead of `Uint32Array.from`, and specializes the
interior loop for mode 11 plus packed wrapping byte adds.

Warm decode-only medians on that fixture, confirmed in both run
orders: 722.68 ms → 428.53 ms (−40.70%). The smaller
`webp-lossless-tux-386x395` decode was 17.21 ms → 14.88 ms (−13.5%).
Official `webp-memory-lossless-resize-jpeg` output SHA-256 stayed
`f9d79a42a22bba80718a4143b38e8789befe965890f6c016c0f6684eb884ebef`.
Cold e2e 4K resize+JPEG is too noisy to headline (resize still large);
decode-only is the kernel measurement. Isolated official hillclimb on
`webp-large-resize-jpeg` stayed neutral (356.65 → 361.29 ms, +1.30%
speed, +2.24% RSS) with matching correctness. Imazen WebP corpus
remained 223 pass / 2 unsupported / 0 failures.

### WEBP-019–021 follow-ups

Post-018 4K decode-only profiles still spent 27.8% in `write`, 20.1%
in the mode-11 predictor row, 14.6% in ARGB→RGBA `decode`, and 11.9%
in `inverseColorRow`. The retained follow-ups hoist a uniform mode-11
kernel, copy backward-reference runs without a per-pixel `write()`
call, and specialize the no-alpha unpack loop.

Quiet incremental decode-only medians on the 4000x3000 lossless
fixture: 445.99 → 414.39 → 279.11 → 260.36 ms. Stacked on WEBP-018
that is 722.68 → 260.36 ms (−64.0%). Tux after WEBP-021 was 12.83 ms
versus 14.88 ms after WEBP-018. Official 4K e2e SHA-256 stayed
`f9d79a42a22bba80718a4143b38e8789befe965890f6c016c0f6684eb884ebef`.
Imazen WebP corpus remained 223 pass / 2 unsupported / 0 failures.

Uniform color-transform, packed subtract-green, single Huffman-group,
and inlined color-row follow-ups were reverted. Remaining decode time
is mostly `inversePredictorSelectRow`, `inverseColorRow`, residual
entropy/`write` of literals, and resize if measured end-to-end.

### WEBP-011 neighboring validation

The retained clamp plus inlined loop-filter stack passed the lossless
pressure resize and gallery lossy photograph paths. Imazen WebP corpus
remained 223 pass / 2 unsupported / 0 failures, matching the pre-change
baseline. Artifacts:

- Lossless pressure: `.tmp/webp-neighbor-lossless-011/memory-lossless.md`
- Gallery photo: `.tmp/webp-neighbor-photo-011/photo-png.md`
- Imazen corpus: `.tmp/imazen-webp-hillclimb/imazen-webp-conformance.md`

### WEBP-006 neighboring validation

The candidate passed the lossless pressure resize in three runs (median
1258.0 ms; output SHA-256 `f9d79a42a22bba80718a4143b38e8789befe965890f6c016c0f6684eb884ebef`).
The lossy pressure resize reported blue 200 instead of 174 ± 24, but the
unchanged base revision produced the same result, so this is a pre-existing
fixture/baseline mismatch rather than a candidate regression. Artifacts:

- Lossy pressure validation: `.tmp/webp-neighbor-lossy/memory-lossy.md`
- Clean-base lossy reproduction: `.tmp/webp-baseline-neighbor-lossy/baseline-lossy.md`
- Lossless pressure validation: `.tmp/webp-neighbor-lossless/memory-lossless.md`

CPU profiles under `.tmp/cpu-webp-large/` and `.tmp/cpu-webp-pressure/` put
`predictBlock`, `decodeCoefficientBlock`, `inverseDctAdd`,
`filterNormalEdge`, `filterCommon`, `applyLoopFilterRow`, and
`convertVp8Rows` in the WebP VP8 decode path. WEBP-006 removed repeated
row-base and chroma-index work. WEBP-007 showed that an allocation-free
`predictBlock` is about 21% faster but lets per-macroblock coefficient
arrays accumulate and raise peak RSS. WEBP-008 keeps that prediction
rewrite and reuses one coefficient buffer plus Walsh temps, so the live
set stays bounded. Resolve the known lossy pressure-fixture mismatch
before using that fixture as a gate.

WEBP-008 seven-pair run reported wall median 489.88 → 380.49 ms, MAD
3.15 → 7.43 ms, paired median -23.2111% (MAD 0.8215%), peak RSS median
170,389,504 → 175,968,256 bytes (+3.27%), and protected output bytes
unchanged at 126,466. Base and candidate correctness and operation
signatures were identical across all seven trials.

### WEBP-008 neighboring validation

The candidate passed the lossless pressure resize in three runs (median
1110.4 ms; output SHA-256
`f9d79a42a22bba80718a4143b38e8789befe965890f6c016c0f6684eb884ebef`).
It also passed the gallery lossy photograph to PNG path in three runs
(median 174.6 ms). Artifacts:

- Lossless pressure validation: `.tmp/webp-neighbor-lossless/memory-lossless.md`
- Gallery photo validation: `.tmp/webp-neighbor-photo/photo-png.md`

The lossy 4000x3000 pressure fixture still has the pre-existing baseline
mismatch noted under WEBP-006 and was not used as a gate.

All seven-pair measurements used the reusable command:

```sh
npm run bench:hillclimb -- --suite web --workload webp-large-resize-jpeg --goal speed --base-ref origin/main
```

## Controls and repeatability

Two no-change controls help separate benchmark noise from code effects:

| Timestamp (UTC) | Comparison | Wall Δ | Peak RSS Δ | Artifact |
| --- | --- | ---: | ---: | --- |
| 2026-08-16 22:32 | Clean revision against itself | +0.67% | -0.39% | `.tmp/hillclimb/2026-08-16T22-32-52-267Z/comparison.md` |
| 2026-08-16 23:44 | Retained IDCT commit, fresh repeat | -0.38% | -0.14% | `.tmp/hillclimb/2026-08-16T23-44-09-993Z/comparison.md` |

## JPEG-to-PNG campaign

Official workload: `jpeg-to-png` — 2400x2400 baseline 4:2:0 JPEG to PNG 6.
No crop or resize. The executor streams MCU rows into the PNG encoder, but it
did not call `block.release()`, so JPEG's recycled RGB row buffers were never
returned. PNG adaptive filtering and 4:2:0 YCbCr conversion dominate remaining
JS time. Native zlib does not appear in CPU profiles.

| ID | Timestamp (UTC) | Hypothesis / change | Wall median base → candidate (ms) | Speed Δ | Peak RSS Δ | Verdict | Disposition |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| JPEG-PNG-000 | 2026-08-17 18:08 | No-change control: dirty-empty `HEAD` against itself. | 545.68 → 549.48 | +0.70% | +0.27% | neutral | Control; no source change. |
| JPEG-PNG-001 | 2026-08-17 18:10 | Release decoder pixel blocks after `encoder.write()` so JPEG row buffers recycle. | 551.25 → 555.42 | +0.76% | **-6.53%** | material | Retained; RSS MAD tightened 3.7 MiB → 0.6 MiB. Exact output bytes. |
| JPEG-PNG-002 | 2026-08-17 18:13 | Specialize adaptive PNG filter scoring for RGB8 (`bytesPerPixel === 3`). | 549.62 → 530.85 | **-3.42%** | +0.98% | material | Retained on the JPEG-PNG-001 stack; exact filter choice and output bytes. |
| JPEG-PNG-003 | 2026-08-17 18:15 | Skip bilinear luma interpolation when luma sampling is already full resolution (4:2:0 / 4:2:2). | 552.34 → 443.88 | **-19.64%** | +3.02% | material | Retained; 7/7 pairs faster, paired −19.26%. JPEG tests passed. |
| JPEG-PNG-004 | 2026-08-17 18:16 | Reuse one PNG scanline buffer across 32-row chunks. | n/a | n/a | n/a | rejected | Reverted; Node zlib holds the written buffer, so reuse corrupted later rows. |

Measurement artifacts:

- JPEG-PNG-000: `.tmp/hillclimb/2026-08-17T18-08-34-231Z/comparison.md`
- JPEG-PNG-001: `.tmp/hillclimb/2026-08-17T18-10-27-951Z/comparison.md`
- JPEG-PNG-002: `.tmp/hillclimb/2026-08-17T18-13-14-061Z/comparison.md`
- JPEG-PNG-003: `.tmp/hillclimb/2026-08-17T18-15-05-515Z/comparison.md`
- Neighbor `jpeg-resize-1200`: `.tmp/hillclimb/2026-08-17T18-16-50-420Z/comparison.md`
- Profile: `.tmp/cpu-jpeg-png/jpeg-to-png.cpuprofile`

The published-snapshot 10% speed gate now runs only on full official profiles.
Single-workflow hillclimb trials were aborting the base harness when one noisy
sample exceeded the public snapshot.

### JPEG-PNG-003 neighboring validation

The retained stack also passed `jpeg-resize-1200`: wall median 771.08 →
736.46 ms (−4.49%), peak RSS −0.76%. Correctness and protected output bytes
matched.

Imazen JPEG stayed 254 images, 39 pass / 2 unsupported / 167 rejected-safely /
46 accepted, with 0 decode failures, raw exceptions, timeouts, crashes, or OOM.
Imazen PNG stayed 176 images, 162 pass / 14 rejected-safely, with the same zero
failure counts. Artifacts: `.tmp/imazen-jpeg-png/`.

Quiet `jpeg-crop-resize` and `png-resize-1000` neighbors were incomparable
(CV > 10%) but correctness and output bytes matched. Isolated medians were
740.44 → 751.31 ms (+1.47%, RSS +4.17%) and 525.34 → 519.37 ms (−1.14%, RSS
+2.72%). Neither exceeded the 5% protected regression limit.

Reproduction:

```sh
npm run bench:hillclimb -- --suite web --workload jpeg-to-png --goal memory --base-ref HEAD
npm run bench:hillclimb -- --suite web --workload jpeg-to-png --goal speed --base-ref HEAD
```

## Next hypotheses

These are ideas, not measured results yet:

- Fuse decoder-side crop/downscale with the resize path so pixels outside the
  final output do not become intermediate RGB rows.
- Reduce the number of reconstructed JPEG blocks for a downscale by exploiting
  the existing scaled IDCT and the exact output footprint.
- Fuse YCbCr conversion with the first resize traversal, while preserving the
  bounded row pipeline and exact output contract.

JPEG-007 changed the entropy reader state machine rather than the benchmark:
the reader now keeps a bounded bit accumulator, exposes marker-safe lookahead,
and skips short canonical Huffman codes through a precomputed 8-bit prefix
table. The seven-pair run reported wall median 3350.26 → 2911.43 ms, MAD
8.04 → 21.51 ms, paired median -13.0856% (MAD 0.4118%), peak RSS median
195,907,584 → 193,884,160 bytes, and protected output bytes unchanged at
186,059. Base and candidate correctness and operation signatures were
identical across all seven trials.

### JPEG-007 neighboring validation

The same dirty candidate also passed the representative `jpeg-resize-1200`
workload: wall median 840.20 → 748.44 ms (-10.92%), paired median -10.4044%
(MAD 0.5168%), and peak RSS +0.87%. Correctness and protected output bytes
matched in all seven trials. Artifact: `.tmp/hillclimb/2026-08-17T00-39-13-050Z/comparison.md`.

Reproduction command:

```sh
npm run bench:hillclimb -- --suite web --workload jpeg-resize-1200 --goal speed --base-ref origin/main
```

Each new attempt should get the next stable `JPEG-*` ID and an entry here even
when it is rejected or reverted.
