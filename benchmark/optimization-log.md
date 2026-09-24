# Optimization attempt log

This is the durable, checked-in history of performance experiments. The raw
seven-pair measurements remain under `.tmp/hillclimb/`; this file records the
hypothesis, evidence, result, and disposition so a later campaign does not
repeat a dead end without new evidence.

## Current state

- TIFF campaign 2026-08-25 (`tiff-large-resize-jpeg`): retained TIFF-001 identity-resample
  bypass, TIFF-002 prefetch span-copy removal, TIFF-003 uncompressed segment aliasing,
  TIFF-005 unrolled rgb8 factor-4 box-shrink kernels, TIFF-006 block-direct box shrink.
  Cumulative 68.29 → 37.51 ms (−45.08%), peak RSS 280 → 214 MiB (−23.68%), byte-identical
  output. Neighbors: `png-resize-1000` −8.84%, `webp-large-resize-jpeg` −7.68%,
  `stress-100mp-downscale` and `png-alpha-resize` neutral. See the TIFF large-resize
  campaign section at the bottom of this file.

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

## JPEG XL Modular encoder campaign

The 2026-09-03 campaign used exact native-sample decode as a mandatory correctness guard. Early
five-class measurements were used to reject or retain individual coding tools. The final decision
used 156 deterministic legal cases across the 12 M2 classes and pinned libjxl 0.12.0.

| ID | Hypothesis / change | Evidence | Verdict | Disposition |
| --- | --- | --- | --- | --- |
| JXLMOD-001 | Replace one fixed prefix model with ANS, per-channel fixed predictor selection, and channel contexts. | The line-art case fell from 13,405 to 523 bytes, but the five-case median was still 4.597 times libjxl effort 7. | promising | Retained as the adaptive foundation. |
| JXLMOD-002 | Add an ordinary exact palette for low-color RGB and RGBA images. | Line art fell from 523 to 386 bytes. The five-case libjxl median improved to 3.860. | promising | Retained. |
| JXLMOD-003 | Repeatedly squeeze all channels before entropy coding. | Median PNG ratio regressed to 1.768 and median time ratio rose to 43.76. | rejected | Reworked into bounded candidates chosen against unsqueezed output. |
| JXLMOD-004 | Use only same-value LZ77 matches. | It did not solve structured residual runs and was superseded by general hash matching. | rejected | Replaced. |
| JXLMOD-005 | Add exact delta palettes for repeated predictor residual tuples. | Five-case median PNG ratio improved to 0.944 and the gradient case fell to 1,299 bytes. | material | Retained. |
| JXLMOD-006 | Add bounded hash-based LZ77 match search. | Five-case median PNG ratio improved to 0.764 and the photo-like case fell to about 217 KiB. | material | Retained. |
| JXLMOD-007 | Compare raw and reversible-color candidates. | Five-case median PNG ratio improved to 0.686; photo-like and noise output fell to about 65 KiB and 138 KiB. | material | Retained despite higher effort-7 analysis time. |
| JXLMOD-008 | Keep four bounded match histories and encode common row distances with JPEG XL special distance codes. | The five-case effort-7 PNG p90 reached 1.109. | material | Retained for effort 7. |
| JXLMOD-009 | Serialize long zero-frequency histogram runs with the JPEG XL repeat symbol. | The line-art case fell from 327 to 202 bytes and the fixed five-class size gates passed except its small-sample p90. | material | Retained. |
| JXLMOD-010 | Reuse one predictor tree when clustered transformed planes share a model. | The line-art case fell from 202 to 199 bytes without changing decoded samples. | promising | Retained. |
| JXLMOD-011 | Keep the effort-1 residual traversal monomorphic and compare its prefix section with a simple ANS section using a fixed reversible color transform. | On the exact implementation revision across 156 cases, median size was 1.0354 times libjxl effort 1 and median wall time was 2.2434 times libjxl effort 1. | material | Retained. |
| JXLMOD-012 | Add default weighted prediction and bounded horizontal, vertical, and multi-channel squeeze candidates at higher efforts. | The 163-case four-decoder matrix remained exact after the change. Final extended compression and performance reruns are recorded in the M2 evidence reports. | material | Retained only with unsqueezed and no-LZ candidates available. |
| JXLMOD-013 | 2026-09-08: extend effort 3/5/7 to multi-group images with frame-wide RCT and group-local predictor trees, ANS, and optional LZ77. Baseline profiling identified residual/bit writing; the old path ignored higher effort above 1024 pixels. | `old-faithful-6000x4000`, base `2d931aa3b1617561aed770e73d53dcfabeb8b236`, dirty candidate in `src/codecs/jpegxl-modular-encode.ts`. E7: 81,000,337 → 25,339,824 bytes (1.08219 times libjxl E7), 7,103 → 140,600 ms; managed peak 157,247,248 → 336,471,797 bytes. E1 bytes and hash unchanged. Independent native pixels exact; 12 boundary/native checks and 4 transparent-color tests pass. Raw `.tmp/jpegxl-m7/baseline/profile.log` and `.tmp/jpegxl-m7/adaptive-001.log`. The old harness path label is stale for this candidate. One trial per revision; MAD and paired win rate unavailable. Whole-worker RSS includes oracle work and is not isolated encoder RSS. | inconclusive | Compression improvement is substantial, but runtime and memory regress. Keep as an unfinished M7 capability experiment while profiling and reducing search cost; no performance or M7 promotion claim. |
| JXLMOD-014 | 2026-09-08: share the selected predictors between plain and LZ77 group candidates. New profile attributes 116 seconds to scoring, residual traversal, and fixed prediction. | Same 24 MP input and original base as 013; dirty stack in `.tmp/jpegxl-m7/adaptive-014.patch`. Isolated `measure-m7-lossless.ts` sample: 81,320 ms encode/output, 25,339,824 bytes, identical output SHA-256 `b6f2457ca8301d017ffe6366fa68ad53afa9ee160b1784bc41590ca19182d708`, managed peak unchanged at 336,471,797 bytes. Four focused tests pass. Raw `.tmp/jpegxl-m7/adaptive-014.json`. Single sample; MAD/win rate unavailable. Earlier worker includes other codecs, so its RSS is not comparable to this isolated sample. | promising | Retained: removes one identical predictor search per LZ77 candidate without changing encoded bytes. Final paired timing remains required. |
| JXLMOD-015 | 2026-09-08: score fixed predictors using deterministic samples spread across each group, capped at 4096/8192/16384 samples per plane for effort 3/5/7. Full residual coding remains exact. | Same 24 MP input and base as 013. Isolated E7 sample: 23,565 ms, down from 81,320 ms in 014. Output bytes/hash unchanged; libjxl output pixels byte-identical to the independently verified 013 decode. Managed peak unchanged; isolated peak RSS 671,277,056 bytes. Raw `.tmp/jpegxl-m7/adaptive-015.json`. One trial per stack; paired statistics unavailable. | promising | Retained for broader development tests and paired confirmation. Predictor sampling can change compressed size on other images; preserve every size regression. |
| JXLMOD-016 | 2026-09-08: bound multi-group LZ77 match-cache capacity to 65536/262144 slots for E5/E7, evict colliding hashes, and size token scratch to original residual count (a match consumes at least three residuals and emits two tokens). | Same 24 MP input/base as 013. Isolated E7: 22,528 ms, 25,339,824 bytes with the same native-verified output hash. Managed peak 336,471,797 → 157,708,158 bytes; process peak RSS 671,277,056 → 411,058,176 bytes versus 015. 28 focused allocation/exactness tests and 12 native boundary checks pass. Raw `.tmp/jpegxl-m7/adaptive-016.json`. Single timing sample, no paired statistics. | promising | Retained: deterministic bounded scratch reduction, with unchanged output on this photo. Confirm size effects of cache eviction on the development corpus and retain misses. |
| JXLMOD-017 | 2026-09-08: compare the best fixed predictor with stateful weighted prediction in bounded full-width bands, warming state before scoring interior bands. Also exercise newly added cooperative checkpoints and group-selection evidence. | Same 24 MP input/base as 013. E7: 25,041,584 bytes (1.18% below 016), 41,933 ms; managed peak 157,470,279 bytes. Twelve groups select weighted prediction on some channels; no group selects LZ77. Native decoded PPM is byte-identical to the original exact reference. Raw `.tmp/jpegxl-m7/adaptive-017.json`; four focused tests and 12 native boundary checks pass. One timing sample, no paired statistics. | inconclusive | Keep as an unfinished weighted-search experiment. Compression improves, but runtime regresses. Next remove duplicate stateful residual reconstruction between plain/LZ77 candidates before deciding the policy. |
| JXLMOD-018 | 2026-09-08: build one group residual plan and reuse it across plain and LZ77 token plans. | Same 24 MP input/base as 013. E7: 31,497 ms versus 41,933 ms in 017; identical 25,041,584-byte output and SHA-256 `2d1761eb74265462a5d04263dcc80efc36a7736f12a53d63b08ba6e08525931a`. Managed peak 157,470,017 bytes. 23 focused exactness/budget/cancellation tests and 48 native boundary checks pass, now including 8/10/12/16-bit and transparent native samples. Raw `.tmp/jpegxl-m7/adaptive-018.json`. Single sample, paired statistics pending. | promising | Retained: removes duplicate weighted reconstruction without altering either candidate. Broader weighted-policy and final paired evaluation remain open. |
| JXLMOD-019 | 2026-09-08: return already exact-sized token/context arrays instead of copying their entire contents before entropy writing. | Same 24 MP input/base as 013. Output hash/bytes identical to 018; E7 single sample 30,450 ms, managed peak 156,578,878 bytes. Raw `.tmp/jpegxl-m7/adaptive-019.json`. No paired timing conclusion. Every plain plan deterministically avoids one complete token/context copy, six bytes per source residual. | promising | Retained for the direct copy reduction; runtime change needs paired confirmation. Full follow-up exactness and ownership checks remain required. |
| JXLMOD-020 | 2026-09-08: compare group-local ordinary/delta palettes against untransformed candidates, then support independently valid local transforms in the decoder with restored-plane budget admission. | 48/48 native libjxl and 48/48 independent jxl-rs checks preserve exact 8/10/12/16-bit samples, with 84 groups selecting a palette; 16 own-decoder cases pass. Pinned oxide defaults: 12 exact, 16 sample mismatches, 20 decode failures, all retained in `.tmp/jpegxl-m7/independent-palette-defaults.json`. Its source uses color count alone for palette width; libjxl uses color plus delta count. Four additional oxide mismatches are signed 16-bit alpha and are being checked with its wide-buffer option. Photo remains 25,041,584 bytes with identical hash; E7 34,351 ms and 156,578,878 managed peak bytes, raw `.tmp/jpegxl-m7/adaptive-020.json`. Single timing sample. | inconclusive | Retained as unfinished M7 palette capability work. Photo search overhead and oxide interoperability limits remain visible; no full-corpus or performance promotion claim. |
| JXLMOD-021 | 2026-09-08: replace the nine-bit prefix fallback for overdeep Huffman trees with bounded frequency regularization, retaining short codes for common symbols. This addresses the baseline profile's large residual/bit-writing cost without changing effort-1 predictor selection. | Same 24 MP input/base as 013. E1: 81,000,337 → 43,968,755 bytes, managed peak 157,247,248 → 118,117,749 bytes; isolated time 6,332 ms. Native decoded pixels are byte-identical to the baseline. Nine entropy tests pass, including extreme skew and all rare symbols; 48 libjxl/jxl-rs depth/boundary checks pass. Raw `.tmp/jpegxl-m7/adaptive-021-e1.json`. Single timing sample; no speed claim. | promising | Retained for deterministic byte and working-memory reduction. Effort-1 stays a fixed-left fast path; its compressed bytes change as permitted by M7. Full regression/paired measurements pending. |
| JXLMOD-022 | 2026-09-08: write validated 0-32-bit fields with bounded shifts and byte stores, replacing repeated division, powers and per-byte iteration in the profiled bit-writing hotspot. | Same 24 MP input/base as 013. E1 candidate: 3,847 ms, identical 43,968,755-byte output to 021. Original baseline measured through the same isolated worker: 6,279 ms, 81,000,337 bytes, peak RSS 499,027,968 bytes; candidate peak RSS 388,136,960 bytes. 26 bitstream/depth tests pass, including every field width and bit alignment. Raw `.tmp/jpegxl-m7/adaptive-022-e1.json` and `.tmp/jpegxl-m7/baseline-isolated-e1.json`. Single samples, paired confirmation pending. | promising | Retained for paired evaluation. No input validation was removed; native exactness follows from identical encoded output to 021. |
| JXLMOD-023 | 2026-09-08: compare a group-local Squeeze candidate at efforts 5/7, retaining the sizes of every attempted raw, palette and Squeeze candidate. | All 16 own-decoder boundary cases and 48 libjxl/jxl-rs checks pass; no Squeeze candidate wins on those narrow procedural cases. Same 24 MP source/base as 013: unchanged 25,041,584-byte output and native-verified hash, 58,604 ms encode/output, peak RSS 446,660,608 bytes. Raw `.tmp/jpegxl-m7/adaptive-023.json`. | rejected | Unconditional Squeeze search adds substantial photo cost without a size gain. Keep the valid tool available while evaluating a bounded selection policy on development photos, graphics and scans; do not promote this unconditional policy. |

Final effort-7 results on 156 cases were 0.8901 median, 1.2921 p90, and 1.7349 worst
size ratio to pinned libjxl effort 7 before the final exact-head rerun. Median output was 0.6023 of
PNG, 89.74% of files were no larger than PNG, every image-class median was at most 1.2581 times PNG,
and median wall time was 7.3197 times libjxl effort 7. The tracked final reports live under
`benchmark/results/jpegxl-m2-*`.

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

## JPEG Rust/WASM SIMD campaign - 2026-08-24

The campaign used the explicit Rust/WASM artifacts and retained the TypeScript
codec as the correctness oracle. Decoder output had to remain byte-identical.
Encoder AAN changes had to keep scalar-AAN and SIMD-AAN byte-identical, stay
within 0.05 dB decoded PSNR and 1% output size of the matrix-DCT reference, and
show a measured gain.

| ID | Hypothesis / change | Representative result | Verdict | Disposition |
| --- | --- | --- | --- | --- |
| JPEG-WASM-001 | Skip the full IDCT for DC-only blocks. | Tundra 396.62 -> 391.24 ms (-1.36%); Earthrise 115.45 -> 102.48 ms (-11.2%). Exact RGB hashes. | material on low-entropy input | Retained. |
| JPEG-WASM-002 | Convert four YCbCr pixels with `f32x4` instead of two with `f64x2`. | Tundra 395.84 -> 395.32 ms (-0.13%). Exact RGB hash. | neutral | Reverted. Lane extraction and interleaved stores consumed the arithmetic gain. |
| JPEG-WASM-003 | Use an `f32x4` basis-matrix IDCT. | Spot check 394.20 -> 365.67 ms, but output SHA-256 changed. | invalid | Reverted before timing acceptance. |
| JPEG-WASM-004 | Precompute AAN reciprocal quantization factors and multiply instead of dividing each coefficient. | 2048x1536 high-entropy 4:2:0 SIMD 85.72 -> 74.41 ms (-13.2%). Output hash unchanged. | material | Retained. |
| JPEG-WASM-005 | Keep AAN samples and planes in f32 and fill four RGB pixels with explicit SIMD. | Three worker medians 71.45 -> 68.53 ms (-4.1%) on 2048x1536 high-entropy 4:2:0. Output hash unchanged. | material | Retained. |
| JPEG-WASM-006 | Downsample four chroma outputs with explicit SIMD shuffles and sums. | Three worker medians 70.41 -> 70.55 ms (+0.2%). Output hash unchanged. | neutral | Reverted. |
| JPEG-WASM-007 | Composite four RGBA pixels and produce RGB/luma planes with integer and f32 SIMD. | 2048x1536 high-entropy 4:2:0 75.46 -> 65.48 ms (-13.2%). Output hash unchanged. | material | Retained. |

The refreshed full encoder matrix separates algorithm and SIMD effects with a
scalar AAN control. At 1024x768, scalar AAN reduced matrix-DCT time by
19.5%-22.0%, while SIMD reduced the same AAN path by another 4.2%-11.4%.
At 2048x1536 4:2:0, SIMD reduced scalar-AAN time by 19.5% on low-entropy input
and 14.4% on high-entropy input. Scalar-AAN and SIMD-AAN hashes matched in
every benchmark group.

Retained implementation cleanup removed the unused `simd_basis` and
`simd_intermediate` arrays. The build now emits a benchmark-only scalar AAN
artifact under `benchmark/.tmp/wasm/` so future reports cannot conflate the
AAN algorithm change with SIMD lane speedup.

Evidence:

- Encoder matrix: `benchmark/results/jpeg-wasm-encoder-2026-08-24.json` and
  `benchmark/results/jpeg-wasm-encoder-2026-08-24.md`
- Decoder matrix: `benchmark/results/jpeg-wasm-decoder-simd-2026-08-24.json`
  and `benchmark/results/jpeg-wasm-decoder-simd-2026-08-24.md`
- Seven-pair `purejsimage-wasm` decoder workflow: `jpeg-to-png` 254.10 ->
  239.76 ms (-5.64%), peak RSS -0.46%, exact correctness and protected
  metrics. Artifact: `.tmp/hillclimb/2026-08-24T15-43-18-379Z/comparison.md`.
- Seven-pair `purejsimage-wasm` encoder workflow: `png-to-jpeg` 16.80 ->
  12.67 ms (-24.58%), peak RSS -0.35%, exact correctness and protected
  metrics. Artifact: `.tmp/hillclimb/2026-08-24T15-44-10-400Z/comparison.md`.
- Focused correctness: `npx vitest run tests/wasm-jpeg.test.ts`

## WebP Rust/WASM campaign - 2026-08-24

The retained optional module accelerates bounded VP8 YUV row conversion, VP8 input conversion to
YUV420 blocks, and VP8L predictor, color, and subtract-green transforms. JavaScript still owns the
RIFF container, entropy coding, validation, metadata, and row or block orchestration. Scalar and
SIMD artifacts use the same ABI and fall back to the TypeScript operation on load or kernel failure.
The existing paired-row TypeScript `rgb8` input conversion remains selected because a five-sample
end-to-end trial measured it at 563.8 ms versus 584.0 ms through WASM. Lossy `rgba8` and `gray8`
inputs remain eligible for WASM.

The correctness gate forced each artifact separately with one-pixel thresholds across all 225
Imazen WebP files. Both variants produced 223 exact pixel and deterministic encode-byte matches and
the same 2 structured unsupported results as the TypeScript reference. Every file ran in an
isolated process with a 30-second timeout and 512 MiB heap limit. The reference corpus also matched
all 225 checked-in baseline records.

The three-sample isolated end-to-end profile passed all 13 workflows. Representative median wall
changes were:

| Workflow | TypeScript | WASM SIMD | Change |
| --- | ---: | ---: | ---: |
| 1600x2000 lossy WebP resize to JPEG | 338.7 ms | 306.0 ms | -9.7% |
| 4000x3000 lossy memory resize | 782.5 ms | 743.3 ms | -5.0% |
| 4000x3000 lossless memory resize | 602.3 ms | 595.1 ms | -1.2% |
| Lossy photo decode to PNG | 169.6 ms | 152.9 ms | -9.8% |
| Lossy alpha decode to PNG | 107.4 ms | 90.5 ms | -15.7% |
| Lossless alpha decode to PNG | 50.8 ms | 45.5 ms | -10.5% |
| PNG to lossless WebP | 123.4 ms | 110.8 ms | -10.2% |
| RGBA logo to lossy WebP | 65.7 ms | 50.2 ms | -23.6% |

Before the SIMD hillclimb, the scalar artifact was 8,091 bytes and 3,319 gzip bytes. The SIMD artifact was 9,544 bytes and 3,895
gzip bytes. Package import was 83.2 ms for TypeScript and 85.5 ms for the WASM engine; RSS after
import was 110.1 and 110.4 MiB. The general startup probe measures the combined optional WASM
engine, so it is not a WebP-only cold-instantiation microbenchmark.

Evidence:

- End-to-end profile:
  `benchmark/results/2026-08-24T17-28-01-383Z-purejsimage-purejsimage-wasm-webp.json`
- Readable report:
  `benchmark/results/2026-08-24T17-28-01-383Z-purejsimage-purejsimage-wasm-webp.md`
- Forced corpus commands: `npm run corpus:imazen:webp-wasm -- --corpus ../codec-corpus --variant
  scalar` and the same command with `--variant simd`

### WebP Rust/WASM SIMD hillclimb

The incremental baseline is the uncommitted, validated WebP accelerator snapshot represented by
temporary commit object `6a62c0e6c46d4042bdd2938a6a538361d8ad7a1e`. This object exists only so the
paired runner can compare later dirty experiments against the exact pre-hillclimb tree. It does not
move the branch or the working index.

| ID | Timestamp (UTC) | Hypothesis / change | Wall median base -> candidate (ms) | Paired speed delta | Peak RSS delta | Verdict | Disposition |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| WEBP-WASM-001 | 2026-08-24 17:37 | No-change seven-pair control on `webp-large-resize-jpeg` using the SIMD-enabled WASM engine. | 310.09 -> 306.91 (-1.03%) | -0.31%, 4/7 candidate pairs faster | -0.25% | neutral | Control only. Candidate MAD was 5.25 ms versus 2.09 ms for the base; use paired evidence and confirmation for small later gains. Artifact: `.tmp/hillclimb/2026-08-24T17-37-41-189Z/comparison.md`. |
| WEBP-WASM-002 | 2026-08-24 17:40 | Convert four VP8 YUV pixels per `i32x4` SIMD operation while retaining the exact fixed-point formula and scalar tail. | 303.40 -> 302.83 (-0.19%) | -2.09%, 4/7 candidate pairs faster | +2.78% | neutral | Reverted. Correct output, but the median was inside control noise, candidate MAD rose to 6.08 ms, SIMD artifact size grew from 9,544 to 10,919 bytes, and RSS increased. Artifact: `.tmp/hillclimb/2026-08-24T17-40-08-081Z/comparison.md`. |
| WEBP-WASM-003 | 2026-08-24 17:43 | Replace `TypedArray.from` result copies with same-type constructor copies at the JS/WASM boundary. | 307.87 -> 312.64 (+1.55%) | +1.18%, 3/7 candidate pairs faster | +2.14% | rejected | Reverted. Exact output, but both runtime and RSS moved in the wrong direction and candidate MAD rose to 9.70 ms. Artifact: `.tmp/hillclimb/2026-08-24T17-43-27-520Z/comparison.md`. |
| WEBP-WASM-004 | 2026-08-24 17:44 | No-change control on the small `webp-lossless-alpha-png` workflow. | 48.50 -> 46.18 (-4.79%) | -3.04%, 5/7 candidate pairs faster | -0.19% | inconclusive | Control only. Identical code crossed the material threshold, demonstrating that this 120k-pixel end-to-end workflow is too noisy for incremental VP8L decisions without a larger fixture or more trials. Artifact: `.tmp/hillclimb/2026-08-24T17-44-32-056Z/comparison.md`. |
| WEBP-WASM-005 | 2026-08-24 17:47 | No-change control on the 4000x3000 `webp-memory-lossless-resize-jpeg` workflow. | 620.75 -> 613.34 (-1.19%) | -1.76%, 6/7 candidate pairs faster | +0.14% | neutral | Control only. This larger workflow has a more useful roughly 1% median noise floor for VP8L experiments. Artifact: `.tmp/hillclimb/2026-08-24T17-47-12-906Z/comparison.md`. |
| WEBP-WASM-006 | 2026-08-24 17:49 | Vectorize four VP8L color-transform pixels when the transform block size permits, preserving exact signed-byte arithmetic and scalar tails. | 603.95 -> 581.61 (-3.70%) | -3.01%, 5/7 candidate pairs faster | +0.18% | material | Retained. Exact output; candidate CV 2.22%. SIMD artifact grew from 9,544 to 10,280 bytes. Artifact: `.tmp/hillclimb/2026-08-24T17-49-34-488Z/comparison.md`. |
| WEBP-WASM-007 | 2026-08-24 17:54 | Fuse the common inverse color -> predictor -> subtract-green row sequence into one WASM boundary call. | n/a | n/a | n/a | rejected | First draft rejected before timing. Scalar and SIMD agreed with each other but not the TypeScript hash because it saved predictor history after subtract-green instead of immediately after prediction. Correct reference hash `d06797de8b764c392270ae7eee6eca0b16aa745bd9ae0124776602641e82a998` was restored before measurement. |
| WEBP-WASM-008 | 2026-08-24 18:02 | Correct fused VP8L inverse row ABI returns the pre-subtract-green predictor state separately, reducing three calls and seven row copies to one call and three row copies. | 634.42 -> 576.05 (-9.20% cumulative) | -8.90%, 7/7 candidate pairs faster | +0.90% | material | Retained with WEBP-WASM-006. Exact scalar/SIMD/reference hash and all 10 accelerator tests passed. Compared with the color-only 581.61 ms median, fusion contributes roughly another 1% on this host snapshot; the deterministic boundary-copy reduction is larger than RSS noise. Artifacts: `.tmp/hillclimb/2026-08-24T18-02-54-401Z/comparison.md`. |
| WEBP-WASM-009 | 2026-08-24 18:04 | Detect uniform VP8L predictor mode 11 once per mode row and run a dedicated select loop without per-pixel table lookup or 14-way dispatch. | 617.90 -> 518.50 (-16.09% cumulative) | -15.29%, 7/7 candidate pairs faster | -2.00% | material | Retained. Exact 4000x3000 scalar/SIMD/reference hash; candidate CV 1.59%. Artifact: `.tmp/hillclimb/2026-08-24T18-04-43-447Z/comparison.md`. |
| WEBP-WASM-010 | 2026-08-24 18:06 | Compute the four mode-11 channel distances with byte-lane SIMD and pairwise horizontal sums. | 629.13 -> 520.02 (-17.34% cumulative) | -17.80%, 7/7 versus the original base | -1.51% | neutral | Reverted. Candidate median was slower than the retained WEBP-WASM-009 stack (520.02 versus 518.50 ms), so the apparently larger cumulative delta came from a slower base sample rather than an incremental win. Artifact: `.tmp/hillclimb/2026-08-24T18-06-39-662Z/comparison.md`. |
| WEBP-WASM-011 | 2026-08-24 18:09 | Process two VP8 Y pixels together and reuse their shared 4:2:0 chroma loads and matrix products. | 319.24 -> 312.31 (-2.17%) at 7 pairs; 307.51 -> 313.96 (+2.10%) at 15 pairs | -0.48%, 8/15 candidate pairs faster in confirmation | +1.21% | rejected | Reverted. The first run was promising at 6/7 wins, but confirmation had 12.35% candidate CV, a slower candidate median, and only a negligible paired gain. Artifacts: `.tmp/hillclimb/2026-08-24T18-08-54-981Z/comparison.md`, `.tmp/hillclimb/2026-08-24T18-09-41-034Z/comparison.md`. |
| WEBP-WASM-012 | 2026-08-24 18:12 | Measure the retained SIMD color transform on `png-to-webp-lossless` before a forward-predictor experiment. | 114.09 -> 110.72 (-2.95% cumulative) | -4.31%, 6/7 candidate pairs faster | -0.05% | promising | Retained stack control. Candidate CV 1.29%; no additional source change. Artifact: `.tmp/hillclimb/2026-08-24T18-12-10-013Z/comparison.md`. |
| WEBP-WASM-013 | 2026-08-24 18:13 | SIMD forward predictor for first-row or uniform-left mode using four packed `u8x16_sub` residuals. | 115.53 -> 115.31 (-0.19% cumulative) | +0.61%, 2/7 candidate pairs faster | +0.11% | neutral | Reverted. Exact scalar/SIMD bitstreams, but it did not improve the representative PNG-to-lossless-WebP workflow and grew the SIMD artifact. Artifact: `.tmp/hillclimb/2026-08-24T18-13-37-872Z/comparison.md`. |

Final retained state: the seven-pair 4000x3000 lossless WebP comparison improved from 617.90 to
518.50 ms (-16.09%), with 7/7 candidate pairs faster, exact output, and a 2.00% peak RSS reduction.
The final 13-workflow profile reports 605.6 to 529.6 ms (-12.5%) for that workflow. The scalar
artifact is 9,329 bytes, 3,800 gzip bytes, and 3,238 Brotli bytes. The SIMD artifact is 11,845
bytes, 4,667 gzip bytes, and 3,955 Brotli bytes. Forced scalar and SIMD Imazen corpus runs each
accepted all 225 inputs: 223 decodes passed and two expected structured errors matched.

## Node temporary storage comparison - 2026-08-24

Seven alternating isolated-process pairs compared the filesystem-backed Node temporary store with
the bounded 1 MiB-chunk memory store. Both modes received the same deterministic streamed RGBA
blocks. Full output SHA-256 hashes, dimensions, row counts, and byte counts matched in every pair.
The benchmark included EXIF orientation 6, where temporary storage is the main cost, and arbitrary
17-degree rotation, where interpolation also contributes substantial work.

| Workload | Tile spool | File wall | Memory wall | Memory speed change | File peak RSS | Memory peak RSS | Memory RSS change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Orientation 6, 1024x768 RGBA | 3.00 MiB | 78.67 ms | 59.32 ms | -24.6% | 88.74 MiB | 94.46 MiB | +5.71 MiB |
| Orientation 6, 2048x1536 RGBA | 12.00 MiB | 265.70 ms | 190.64 ms | -28.3% | 89.91 MiB | 110.61 MiB | +20.70 MiB |
| Orientation 6, 4000x3000 RGBA | 45.90 MiB | 820.48 ms | 654.72 ms | -20.2% | 90.90 MiB | 147.69 MiB | +56.79 MiB |
| Rotate 17 degrees, 1024x768 RGBA | 3.00 MiB | 274.46 ms | 207.79 ms | -24.3% | 95.80 MiB | 104.89 MiB | +9.09 MiB |
| Rotate 17 degrees, 2048x1536 RGBA | 12.00 MiB | 905.70 ms | 667.65 ms | -26.3% | 102.86 MiB | 116.00 MiB | +13.14 MiB |

The host mounted `/tmp` as `tmpfs`. The spool therefore remained RAM-backed but outside process
RSS. For example, the 12 MP orientation row used a 45.90 MiB tmpfs file, so its rough combined live
RAM was about 136.80 MiB before filesystem metadata, versus 147.69 MiB for the memory-store process.
The process-RSS reduction is still useful where that metric sets the runtime limit, but it must not
be presented as an equal reduction in total host memory on tmpfs systems.

Verdict: retain the guarded file store as an explicit opt-in rather than remove it. It materially
reduces large-transform process RSS, while memory is safer across runtimes and materially faster in
all measured rows. The default policy therefore uses lazy chunked memory without the previous 64
MiB Node ceiling. Opt-in file setup and later write failures fall back to memory. Local harness:
`.tmp/temporary-storage-benchmark/{run.ts,worker.ts}`.

## JPEG XL M3 common VarDCT campaign - 2026-09-04

Workload: common static 8-bit sRGB VarDCT decode, with pinned `djxl` output checks after each retained
change. CPU profiles first identified EPF, AC coefficient allocation, Gaborish, adaptive DC
smoothing, and inverse transforms as the main costs. The initial 300-file checkpoint had a 576 ms
median and a 13.312x median ratio to pinned single-threaded `djxl`.

| ID | Hypothesis / change | Representative result | Verdict |
| --- | --- | --- | --- |
| JXLM3-001 | Store ANS alias fields in typed arrays and bypass LZ77 bookkeeping for streams that disable LZ77. | The 1 MP DCT8 development case moved from about 380 ms to about 290-326 ms warm. | Retained. |
| JXLM3-002 | Inline the ANS token body into the no-LZ77 public read method. | One progressive libjxl case produced maximum error 255 and RMSE 74.254. | Reverted before the full matrix. |
| JXLM3-003 | Cache weighted horizontal and vertical differences for EPF stage 1. | The checked DCT8 development case reached 331 ms warm and all 19 generated fixtures stayed within the oracle gate. | Retained. |
| JXLM3-004 | Process EPF stage 0 by candidate with one reusable difference map, and skip restoration work on band-edge rows that cannot affect emitted rows. | The slow progressive 1 MP probe moved from about 1.12 seconds to 0.78 seconds warm. | Retained. |
| JXLM3-005 | Replace per-block coefficient buffers with one bounded typed-array arena per channel and local group offsets. | The checked 1 MP DCT8 probe moved from 335 ms to 274 ms warm. | Retained. |
| JXLM3-006 | Remove per-pixel temporary arrays from adaptive DC smoothing and use fixed channel locals. | The diverse-strategy 1 MP probe moved from 323 ms to 301 ms warm. | Retained. |
| JXLM3-007 | Cache the complete DC context plane once instead of deriving it inside each AC-group decode. | Repeated development measurements did not show a stable gain. | Reverted. |
| JXLM3-008 | Rewrite Gaborish as two separable-looking horizontal terms followed by a vertical combine. | The checked warm probe regressed from about 308 ms to 321 ms. | Reverted. The exact 3x3 kernel remains direct. |
| JXLM3-009 | Specialize the four-neighbor EPF stage 2 kernel and remove coordinate dispatch from interior pixels. | The slow progressive probe moved from 774 ms to 652 ms warm. | Retained. |

Final evidence: 299 of 300 real-photo files decoded, one failed explicitly as unsupported, and no
file produced incorrect output. The final median was 351.397 ms and 8.963x pinned `djxl`. Repeated
DCT8 medians were 2.194 seconds at 12.008 MP and 4.696 seconds at 24.003 MP. Normalized time per
megapixel changed by 1.071x while group count increased from 195 to 391. The 24 MP corpus case
reported 193,274,053 managed bytes.

## TIFF large-resize campaign - 2026-08-25

Workload: `tiff-large-resize-jpeg` — 4000x3000 uncompressed stripped RGB TIFF (32-row
strips), resize to 1000x750, JPEG quality 80. Goal is end-to-end speed. This is the
TIFF representative in the hillclimb `web-codecs` profile; the TIFF family had no prior
campaign. CPU profile of the official pipeline: resize box-shrink `accumulateBoxRow`
~36%, `resizedBlocks` vertical accumulate ~9%, JPEG encoder `quantize` ~11% (already
campaigned), `writeBoxRow` ~5%, `writeContent` ~4%, TIFF `prefetch`/`decode`/
`decodeSegment` ~9%. Peak ArrayBuffer diagnostics showed ~174 MiB of buffer churn for
the 36 MiB source: prefetch span copy + per-segment cache slice + uncompressed
`Uint8Array.from` + block conversion outputs.

| ID | Timestamp (UTC) | Hypothesis / change | Wall median base → candidate (ms) | Speed Δ | Peak RSS Δ | Verdict | Disposition |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| TIFF-000 | 2026-08-25 04:36 | No-change control: clean `origin/main` against itself. | 68.32 → 68.71 | +0.56% | +7.08% | inconclusive | Control; runner printed rejected on RSS jitter alone (control RSS MAD 10-16 MiB on a ~290 MiB median). Speed MAD 0.29/0.74 ms. Artifact `.tmp/hillclimb/2026-08-25T04-36-23-267Z/`. |
| TIFF-001 | 2026-08-25 04:38 | Skip the Lanczos resample stage when the box shrink lands exactly on the requested geometry (scale-1 axes collapse to single weight-1.0 samples under the 1e-12 cutoff, so the stage is byte-exact identity). | 67.98 → 57.97 | **-14.73%** | +10.25% | promising | Retained pending RSS diagnosis. 7/7 pairs faster; output JPEG SHA-256 byte-identical to base. Candidate RSS consistently ~+30 MiB (MAD ~1-2 MiB): isolated diagnostics show identical decode allocations but peak ArrayBuffers 132.9 → 174.3 MiB because the faster run garbage-collects less often. Follow-up experiments target the underlying TIFF copy churn. Artifact `.tmp/hillclimb/2026-08-25T04-38-15-180Z/`. |
| TIFF-002 | 2026-08-25 04:43 | Drop the intermediate whole-span `Uint8Array.from` copy in the TIFF encoded-segment `prefetch`; the per-segment `slice` already copies into cache-owned buffers. | 67.57 → 52.88 | **-21.73%** | **-11.67%** | material | Retained (cumulative with TIFF-001 vs origin/main). 7/7 pairs faster, paired median -22.41% (MAD 0.16%); candidate RSS 243-253 MiB vs base 256-295 MiB. 79 TIFF tests passed. Artifact `.tmp/hillclimb/2026-08-25T04-43-47-963Z/`. |
| TIFF-003 | 2026-08-25 04:44 | Return the cache-owned buffer directly for uncompressed TIFF segments; copy only when fill-order reversal or a predictor mutates in place. | 67.81 → 51.24 | **-24.43%** | **-19.07%** | material | Retained (cumulative 001+002+003 vs origin/main). 7/7 pairs faster, paired median -25.29%; RSS 268 → 217 MiB. 92 TIFF+resize tests passed. Artifact `.tmp/hillclimb/2026-08-25T04-44-52-559Z/`. |
| TIFF-004 | 2026-08-25 04:47 | Generic integer box-shrink accumulate (Uint32 sums, running offsets, dynamic inner trip count) behind a `factorX * factorY <= 65536` guard. | 68.49 → 51.26 | -25.15% cumulative (~0% vs TIFF-003 stack) | -23.60% | neutral | Reverted. Candidate median 51.26 vs prior stack 51.24 ms; warm loop unchanged. Micro-benchmark showed the generic int loop is slower than the Float64 loop (20.7 vs 15.0 ms/image); the win needs a constant trip count. Artifact `.tmp/hillclimb/2026-08-25T04-47-14-453Z/`, micro `.tmp/profile/box-micro.mjs`. |
| TIFF-005 | 2026-08-25 04:51 | Specialized monomorphic rgb8 factor-4 box-shrink kernels: fully unrolled 12-byte accumulate into Uint32 sums plus a matching write kernel. Micro-benchmark 14.8 → 11.6 ms/image vs the generic float kernel; generic/polymorphic variants regressed. | 67.59 → 38.07 | **-43.68%** | **-22.87%** | material | Retained (cumulative 001+002+003+005 vs origin/main). 7/7 pairs faster; output JPEG SHA-256 byte-identical; 92 TIFF+resize tests passed. Artifact `.tmp/hillclimb/2026-08-25T04-51-09-670Z/`. |
| TIFF-006 | 2026-08-25 04:53 | Iterate input blocks directly in `boxShrinkBlocks` and process rows synchronously, removing the per-row async iterator (one microtask hop per source row). | 68.29 → 37.51 | **-45.08%** | **-23.68%** | promising | Retained (cumulative vs origin/main). Incremental vs TIFF-005 stack ~-1.5% (candidate medians 38.07 → 37.51, MAD 0.16 both runs); 7/7 pairs faster vs base; 104 resize+TIFF+PNG tests passed. Artifact `.tmp/hillclimb/2026-08-25T04-53-40-533Z/`. |

### TIFF campaign validation and current state

- Cumulative retained stack (TIFF-001+002+003+005+006) vs `origin/main` a54e645:
  `tiff-large-resize-jpeg` wall median 68.29 → 37.51 ms (**-45.08%**), paired median
  -45.07% (7/7 pairs), peak RSS 280 → 214 MiB (**-23.68%**). Output JPEG SHA-256 is
  byte-identical to base. Artifact `.tmp/hillclimb/2026-08-25T04-53-40-533Z/`.
- Neighbor `png-resize-1000`: 250.5 → 228.3 ms (-8.84%), RSS -3.87%, 7/7 pairs,
  accepted; the identity-resample bypass also applies to the rgba8 factor-4 shrink.
  Artifact `.tmp/hillclimb/2026-08-25T04-57-10-096Z/`.
- Neighbor `stress-100mp-downscale`: 665.0 → 663.6 ms (-0.22%), RSS +0.10%, neutral;
  its factor-8 shrink stays on the unchanged generic float kernels.
  Artifact `.tmp/hillclimb/2026-08-25T04-57-39-115Z/`.
- Neighbor `webp-large-resize-jpeg`: 192.6 → 177.8 ms (-7.68%), RSS -0.41%, 7/7
  pairs, accepted; 1600x2000 → 800 is an exact factor-2 shrink, so the bypass applies.
  Artifact `.tmp/hillclimb/2026-08-25T04-58-33-103Z/`.
- Neighbor `png-alpha-resize`: 34.9 → 34.8 ms (-0.24%), RSS -0.44%, neutral.
  Artifact `.tmp/hillclimb/2026-08-25T04-58-50-387Z/`.
- Imazen TIFF corpus: 154 files, 148 pass / 2 unsupported / 4 rejected-safely, zero
  decode failures, invalid outputs, raw exceptions, timeouts, crashes, or OOM. Per-file
  outcomes identical between base and candidate runs (`.tmp/imazen-tiff-base/`,
  `.tmp/imazen-tiff-large-resize/`).
- Focused tests added: exact rgb8/rgba8 integral box averages through the bypass,
  group straddling across input blocks with release accounting, truncated-source
  errors, and repeat uncompressed TIFF strip decodes without copying or source
  mutation.
- Remaining profile after the stack: `accumulateBoxRowRgb8x4` ~19%, JPEG encoder
  `quantize` ~28% combined (already covered by the JPEG campaign, JPEG-036),
  TIFF `prefetch`/`decode` ~8%. No untried credible TIFF hotspot above ~5% remains
  for this workload.

## JPEG XL M7 forward encoder

Base: `2d931aa3b1617561aed770e73d53dcfabeb8b236`. This base has no forward pixel-to-VarDCT encoder, so initial implementation timings are not speedup claims. The shared entropy writer remains first-party; JPEG inputs and reconstruction are tested separately.

| ID | Hypothesis | Evidence | Decision |
| --- | --- | --- | --- |
| JXLENC-001 | Direct RGB8-to-XYB, mean-normalized forward DCT8, custom quantization, compact DC planes, one reusable AC group, existing local entropy kernels and accounted scratch establish an independent forward path. | Eighteen procedural cases pass libjxl and jxl-rs. 51 forward/shared JPEG tests pass. Exploratory 12 MP Old Faithful rendition: 5,582,465 bytes, 7,964.83 ms open/encode/output, 16,777,608 managed peak bytes, RSS 257,966,080 bytes. SSIMULACRA2 85.9534, Butteraugli 1.5795; native/Rust pixels differ by at most one 8-bit level. Raw `.tmp/jpegxl-m7/forward-001.json` and metric files. | Keep as an internal conformance foundation. It lacks public effort selection, alpha, adaptive quantization, CFL, progressive writing and alternate transforms. The 4000x3000 Sharp Lanczos3 fit-fill rendition is exploratory and excluded from the frozen real-asset promotion cohort. No matched-quality or paired timing claim. |
| JXLENC-002 | Predict blue XYB from luminance with a unit global correlation and encode its residual in both DC and AC. | Same exploratory input as 001. 3,500,733 bytes, 6,988.26 ms open/encode/output, RSS 224,661,504 bytes. SSIMULACRA2 85.9356, Butteraugli 1.5577. 18 independent conformance cases and 51 forward/shared JPEG tests pass. Raw `.tmp/jpegxl-m7/forward-002.json` and metric files. | Retained for development evaluation: 37.29% fewer bytes at nearly unchanged metrics on this photo. Single timing sample; no paired performance or corpus claim. |
| JXLENC-003 | Replace simple radial quantization with the default DCT8 distance bands, represented by finer raw tables and a subnormal half-float scale. | 56 own/shared/progressive tests pass, but 15 of 18 required jxl-rs/libjxl comparisons fail by up to 84 8-bit levels. Own decoder agrees with libjxl within one level on the diagnostic; jxl-rs high-precision mode does not repair it. All misses retained in `.tmp/jpegxl-m7/forward-003-failed-oracles.json`. Performance measurement was not run after conformance failure. | Rejected. Use the format default quantization signaling and integer global/block scales next, avoiding the failed raw-table interoperability case. Do not weaken independent tolerances. |
| JXLENC-004 | Signal the format default DCT8 matrices with integer global/block scales instead of the rejected subnormal raw-table representation. Share unchanged default weights with the decoder. | All 18 independent conformance cases and 51 forward/shared JPEG tests pass. Same exploratory 12 MP source: 3,371,003 bytes, 6,621.98 ms open/encode/output, RSS 220,610,560 bytes, SSIMULACRA2 85.6256, Butteraugli 1.4386. Raw `.tmp/jpegxl-m7/forward-004.json`. | Retained for development evaluation. Independent agreement is restored; full corpus and matched quality curves remain required. |

JXLMOD-024: Replace unconditional full-group Squeeze with a 128x32 center-sample comparison for groups above 16384 pixels. E3 probe entropy avoids LZ77 overhead; require 2% sample size savings before the full candidate. On the same 24 MP regression: 25041584 bytes, 31317.15 ms encode/output, 156578878 managed peak bytes, 0/24 probes request full search. Output hash 2d1761eb74265462a5d04263dcc80efc36a7736f12a53d63b08ba6e08525931a. Sixteen boundary tests pass. Keep as an unfinished policy pending varied development sources; no paired timing or full-corpus claim. Raw .tmp/jpegxl-m7/adaptive-024.json.
| JXLENC-005 | Add tile-local CFL decisions and a block quantization map from local variation; effort controls histogram search. Preserve exact alpha through shared Modular coding. | 18 RGB and 12 alpha independent cases pass; 54 forward/shared tests pass. Same 12 MP regression: 3091023 bytes, 6670.75 ms, SSIMULACRA2 83.8423. Raw .tmp/jpegxl-m7/forward-005.json. | Inconclusive. Equal-distance size improves but quality falls; do not treat the byte reduction as a matched-quality win. Separate CFL and quantization policy effects next and retain the calibration miss. |
| JXLENC-006 | Remove the coarse quantization branch for high-activity blocks while retaining local CFL and finer smooth-block quantization. | Same exploratory 12 MP source: 3,340,932 bytes, 6,708.07 ms open/encode/output, managed peak 16,121,508 bytes, RSS 246,972,416 bytes. SSIMULACRA2 85.7727 and Butteraugli 1.4260. Raw `.tmp/jpegxl-m7/forward-006.json` and metric files. | Retain for development evaluation. Quality recovers relative to 005, with slightly better scores and size than 004 on this photo. One timing sample, no paired performance or full-corpus claim. |

JXLMOD-025 (2026-09-08): The frozen 120-source SDR development baseline completed with 101 independently exact outputs and 19 failures. Verified-only median/p90/worst size ratios were 1.195632/1.535918/2.066721 versus libjxl E7; these do not pass the full gate. Failure tracing found an LZ77 match spanning channel planes beyond the packed hybrid token's 32-bit extra-bit capacity. Split matches at 1,048,576 samples. An isolated-copy repair encodes the failing NOAA im26-5310 scan to 190,882 bytes; libjxl and jxl-rs both reproduce SHA256 c8e40da981b7d8c9264010e46a11069c231dd5e222cd81933fd9f460cd8a6e40 exactly. Applied the repair and added single/multi-group long-run regressions. All 66 focused API, forward and lossless tests pass. Retained as a correctness fix; concurrent diagnostic time is not a speed claim. Full baseline results are retained in `benchmark/jpegxl/production-program/m7-lossless-development-baseline.json`; repaired corpus rerun remains required.

JXLENC-007 (2026-09-08): Functional checkpoint after native-depth/color/progressive support and group candidate reuse. On the same exploratory 12 MP RGB source, current effort 3 emits 3,340,932 bytes in 6,943.58 ms open/encode/output with 16,121,508 managed peak bytes. Two-pass output emits 3,576,668 bytes in 8,144.01 ms with 16,900,027 managed peak bytes. Both are single isolated measurements, not paired speedup claims or frozen-corpus qualification. Raw `.tmp/jpegxl-m7/forward-007.json` and `forward-007-progressive.json`. The prior coarse high-activity quantization experiment remains rejected; the current policy keeps finer smooth-block quantization. Independent depth/color/pass evidence is recorded separately. The two-source lossy development curve run was interrupted after 18 and 19 points while repairing the lossless corpus failure; partial results and their source fingerprint remain under `.tmp/jpegxl-m7/lossy-development/`, without promotion claims.

JXLMOD-025 verification: The repaired full development run verifies all 120/120 images exactly with both libjxl and jxl-rs, with zero failures. Median/p90/worst ratios are 1.207027/1.640840/2.066721. The median target passes, while tail-size targets remain unmet. Complete protocol, source fingerprints and outcomes are retained in `benchmark/jpegxl/production-program/m7-lossless-development-bounded-lz.json`. Concurrent elapsed times are not isolated speed evidence.

JXLMOD-026 (2026-09-08): Separate LZ77 distance symbols from the first residual histogram in an isolated source copy. On frozen development brochure im26-5032 (2590x3209), bytes fall from 1,063,365 to 1,045,528 (1.68%). Both libjxl and jxl-rs reproduce raw RGB SHA256 174ee1511bea6b681ab4863a6a2d18ee828777631549791f16d845b76b623a97 exactly. Candidate encoded SHA256 d33d298829a955e9d5bbe8a9c3a626e7a066966e380480876d77b9c7840d2e0f; managed peak 89,136,351 bytes. Raw `.tmp/jpegxl-m7/histogram-distance-5032.json`. Concurrent timing is not comparable. Promising size result, not retained in production pending representative comparisons. This alone does not close the brochure outlier.

JXLMOD-027 (2026-09-08): Add a bounded three-way signed-gradient Modular context candidate to effort 5/7 raw groups with at most four channels. Reuse residual values and selected predictors; compare actual plain/LZ bytes against the channel-only candidate. On development brochure im26-5032, 1,063,365 bytes becomes 883,537 (16.91% smaller; ratio 1.717213 versus libjxl). On texture im26-2400, 14,047,256 becomes 13,525,003 (3.72% smaller); screenshot im26-8444 retains 399,024 bytes. Brochure and texture both decode exactly in libjxl and jxl-rs; the signed-gradient procedural regression also agrees exactly. Brochure single core times were 6224.93 ms control and 9125.23 ms candidate, with managed peak 89,153,224 versus 95,594,195 bytes. This is a compression feature with additional effort-5/7 search cost, not a speedup; effort 1/3 paths remain unchanged. Forty-five lossless/memory tests pass, including bounded 24 MP effort-7 storage and cancellation. Candidate retained for full development evaluation, with tail-size and isolated performance gates still open. Raw `.tmp/jpegxl-m7/gradient-context-{5032,2400,8444}.json` and `gradient-control-5032.json`. The distance-histogram experiment 026 remains separate and unretained.

M7 verification correction (2026-09-08): Review found that `verify-m7-forward-depth.ts --progressive` previously changed the output directory without forwarding the progressive option. Its earlier 24-case progressive claim and cache-equality comparison were duplicate single-pass checks and are superseded. The harness now forwards the option and asserts the encoded pass count before invoking either oracle. It also covers independently stored 8/10/12-bit color with 16-bit alpha. All 30 actual progressive cases pass libjxl and jxl-rs in `.tmp/jpegxl-m7/forward-depth-verified-mode-progressive-oracle/report.json`. The original artifacts remain available; no failed evidence was overwritten. The separate color harness already forwarded progressive correctly. Eight new generated RGB intermediate-stage checks compare full/half-resolution first-pass pixels against native djxl in `.tmp/jpegxl-m7/forward-stage-oracle/report.json`.

JXLENC-008 (2026-09-08): Prototype first-party forward Hornuss coding in an isolated source copy with per-block strategy signaling and the repository decoder's format-default quantization tables. All 18 procedural RGB cases pass both libjxl and jxl-rs agreement. Forced Hornuss on the 1025x65 smooth-wave diagnostic at distance 1 scores only 63.2528 SSIMULACRA2, so it is not a global DCT8 replacement. No performance claim under concurrent corpus work. Keep the prototype as a legal candidate foundation for measured selection; not retained in production. Artifacts `.tmp/jpegxl-m7/forward-hornuss-oracle/report.json` and `hornuss-forced.json`.

JXLENC-009 (2026-09-08): Add first-party separable 4x8 half-block transforms in both orientations to the isolated strategy prototype. All 18 RGB cases pass independently when strategy 12 is forced, and all 18 pass with strategy 13 forced. Shared serializer block metadata carries the strategy; coefficient count, natural order and channel context mapping stay valid for these 64-coefficient tools. This verifies signaling and reconstruction only, not a useful selection policy or matched-quality gain. Artifacts `.tmp/jpegxl-m7/forward-dct-halves-oracle/report.json` and `forward-dct-halves-transposed-oracle/report.json`. No production retention yet.

JXLMOD-027 full development verification: 120/120 exact in both libjxl and jxl-rs, zero failures. Median/p90/worst ratios are 1.158737/1.403420/1.959187. This improves the repaired baseline's 1.207027/1.640840/2.066721, but p90 and worst still miss their targets. Complete outcomes and source hashes are retained in `benchmark/jpegxl/production-program/m7-lossless-development-gradient-context.json`.

JXLENC-010 (2026-09-08): Prototype bounded strategy choice using estimated token cost and per-channel quantized reconstruction error, with DCT8 retained unless a candidate reduces cost without increasing estimated error. On development brochure im26-5032, bytes fell 550,086 to 545,842 but actual quality regressed severely: SSIMULACRA2 85.3144 to 22.8379, Butteraugli 1.6720 to 85.0885, RGB RMSE 1.3699 to 12.8720. Reject this candidate. Independent decoder agreement was insufficient to prove the forward mapping. Diagnosis found the two rectangular strategy identifiers reversed relative to the format/decoder dispatch. The forward/inverse mathematical kernels individually round-trip within 1.2e-7, but the prototype mapped them to the wrong IDs. Both the earlier forced-rectangle source errors and this selection failure remain retained. Fix the mapping next; do not lower quality thresholds. Artifacts `.tmp/jpegxl-m7/strategy-{control,search}-5032.*`.

JXLMOD-028 (2026-09-08): Extend the existing bounded gradient-context candidate to palette index planes. The remaining patent outlier im26-6026 selected palette coding in its large groups, so the prior raw-only guard prevented conditional index modeling. On this 2320x3408 development scan, bytes fall from 107,528 to 91,849 (14.58%). Both libjxl and jxl-rs reproduce source RGB SHA256 475994b5d32a655a5bf9b32040139c2d6e6b3208648bd6fe1b80d387cc19b343 exactly. A procedural two-color case selects both the palette and gradient context. Retain for broader validation; no timing claim under concurrent corpus work. Raw `.tmp/jpegxl-m7/palette-context-6026.json`.

JXLENC-011 (2026-09-08): Correct the rectangular strategy IDs in the isolated prototype and repeat the prior rejected brochure comparison. Candidate 545,859 bytes versus DCT8-only 550,086. SSIMULACRA2 improves 85.3144 to 85.6540, Butteraugli 1.6720 to 1.4681, and RGB RMSE 1.3699 to 1.2342. All 18 adaptive procedural interoperability cases pass; source-quality comparison now agrees with the reconstruction-error policy. Promising on this development scan, pending representative quality curves and integration. Forced rectangular checks from 009 establish only decoder agreement and are superseded as forward-quality evidence. Raw `.tmp/jpegxl-m7/strategy-fixed-5032.*`.

JXLMOD-029 (2026-09-08): Require both transformed planes to be small before clustering a two-plane single-group model, instead of clustering whenever either plane is small. The im26-8444 screenshot output remains exactly 399,024 bytes, with identical encoded hash and 211,009,006 managed peak bytes. Neutral on the diagnostic; not retained. Raw `.tmp/jpegxl-m7/palette-clustering-8444.json`. Next inspect single-group context selection directly.

JXLMOD-030 (2026-09-08): Add the same gradient-context candidate to eligible single-group effort-5/7 search, preserving the original plain/LZ candidates and choosing actual encoded size. On the 1024x768 development screenshot im26-8444, bytes fall from 399,024 to 352,561 (11.64%), bringing its libjxl size ratio from 1.547570 to 1.367367. Both independent decoders reproduce RGB SHA256 b90fd25755f30b72d6879f25bdac989c8fe30921c0f090a76225eb12fc0abffb exactly. Retain for complete validation. This adds search cost and increases measured managed peak from 211,009,006 to 216,512,854 bytes; the pre-existing large single-group LZ cache remains a separate memory target. No isolated speed claim. Raw `.tmp/jpegxl-m7/single-context-8444.json`.

JXLENC-012 (2026-09-08): Prototype symmetric input pairs in the forward DCT8 row and column kernels in an isolated source copy. The current 12 MP effort-1 profile attributes 37.74% of samples to AC group filling and 23.35% to XYB conversion. All 18 independent procedural cases pass. Frozen photo im26-1030 remains byte-identical at 2,026,935 bytes, SHA256 48717379e889d8e17d847c7a7b37fb9b3811f0a50c9212e0ab2d20523e4057b6, with unchanged 9,988,793 managed peak bytes. Profiled baseline core 5676.31 ms and unprofiled candidate 4800.33 ms are concurrent single samples with unequal instrumentation, so they are not a speedup comparison. Inconclusive pending isolated paired timing; not retained in production. Artifacts `.tmp/jpegxl-m7/forward-e1.cpuprofile`, `forward-e1-profile.json`, `dct-pairs-1030.json` and `forward-dct-pairs-oracle/report.json`.

JXLMOD-031 (2026-09-08): Apply the existing bounded group LZ77 cache to single-group search. The 0.8 MP im26-8444 screenshot previously retained 216,512,854 managed bytes. An isolated candidate keeps exactly the same 352,561 encoded bytes and SHA256 57b9e4389587d1a0d7c76bd796d2ffdf8a32011cde2bb9d0afb8489f79af4edc while reducing managed peak to 53,984,031 bytes. On the other single-group development image im26-5012, output remains byte-identical at 281,297 bytes and managed peak falls from 115,625,677 to 36,988,021 bytes. The screenshot output was independently verified in 030; byte identity preserves that evidence. Retained for full regression validation. Concurrent single times and process RSS are observational, not a paired runtime claim. Artifacts `.tmp/jpegxl-m7/single-cache-{8444,5012}.json` and `single-cache-control-5012.json`.

JXLENC-013 (2026-09-08): Enable format-default Gaborish restoration in an isolated forward-writer copy on the frozen 12 MP food image im26-1638 at distance 3 and effort 7. Encoded size stays 943,412 bytes. Native and Rust decoders agree within one RGB8 level (RMSE 0.0541). Butteraugli improves 2.81519 to 2.46667, while SSIMULACRA2 declines 77.14134 to 76.87506. This is a metric tradeoff, not a global restoration win. Do not retain unconditional Gaborish. Keep both outputs and raw metrics in `.tmp/jpegxl-m7/gabor-1638-d3-comparison.json`; concurrent times are observational. Next test edge-preserving restoration scaled by the existing quantization map.

JXLENC-014 (2026-09-08): Prototype two edge-preserving restoration iterations with sharpness 3 and sigma derived from the actual global/block quantization scales. On the same im26-1638 distance-3 effort-7 diagnostic, SSIMULACRA2 improves 77.14134 to 77.83866 and Butteraugli improves 2.81519 to 2.77336. Native/Rust maximum difference is one RGB8 level, RMSE 0.05396. Promising on this source, not retained as an unconditional setting. Next replace constant sharpness with a bounded policy based on measured quantization residuals and test text/high-quality cases. Raw `.tmp/jpegxl-m7/epf-1638-d3-comparison.json`; concurrent timings are not a speed claim.

JXLENC-015 (2026-09-08): Set each block's EPF sharpness from the selected transform's measured luminance quantization RMS, scaled into the decoder's 255-unit filtering domain and its normative global/block sigma relationship. Eighteen independent procedural cases pass libjxl and jxl-rs. On im26-1638 at distance 3, SSIMULACRA2 improves from the unfiltered 77.14134 to 78.27455 and Butteraugli from 2.81519 to 2.56838, exceeding the constant-sharpness candidate on both metrics. The text brochure has zero sharpness in 109,650 of 130,248 blocks, yet the variable sharpness map adds about 10.6 KB. Its constant-strength diagnostic leaves decoded pixels and metrics unchanged. Promising residual policy, still isolated. Next omit frame restoration when fewer than half of blocks have a nonzero requested strength, avoiding metadata cost on mostly exact flat/text regions. Artifacts `.tmp/jpegxl-m7/epf-residual-1638-d3-metrics.json`, `epf-residual-5032-d1.json`, `epf-5032-d1-metrics.json`, and `forward-epf-residual-oracle/report.json`.

JXLENC-016 (2026-09-08): Omit EPF when fewer than half of blocks request nonzero residual-derived strength. The brochure returns byte-for-byte to the unfiltered 545,859-byte stream, avoiding an ineffective metadata map. However, on high-quality im26-1030 at distance 1, SSIMULACRA2 falls 86.98179 to 86.91027 and Butteraugli increases 1.21823 to 1.25961. Reject the all-distance policy; do not retain it in production. The distance-3 food benefit remains useful evidence for coarse quantization. Next restrict this candidate to distance 2 or above and test another coarse photo. Artifacts `.tmp/jpegxl-m7/epf-policy-5032-d1.json` and `epf-policy-1030-d1-comparison.json`.

JXLENC-017 (2026-09-08): Check the residual-driven EPF candidate on the second photo at distance 3 before adopting a coarse-distance guard. On im26-1030, SSIMULACRA2 improves 79.61796 to 80.04987, while Butteraugli worsens 2.58029 to 2.62195. This remains a metric tradeoff; no production retention or unconditional restoration claim. Inspection of the unfiltered distance-1 streams identifies a larger rate opportunity: own LF sections occupy 441,919 of 1,589,435 bytes, versus native 210,746 of 1,066,707. Own DC steps are uniformly 0.0000610, while the independently read native stream uses 0.000184/0.001473/0.002946 for X/Y/B. Next test channel-specific DC precision before further restoration tuning. Artifacts `.tmp/jpegxl-m7/epf-policy-1030-d3-comparison.json` and `dc-precision-inspection.json`.

JXLMOD-031 complete development and expansion verification: All 120 SDR development images are exact in both independent decoders. Median/p90/worst ratios 1.158737/1.392048/1.728176 pass the SDR development thresholds. The five original large-photo/screenshot regressions achieve 65.797% median byte reduction from merged revision d157a8dc; all nine original cases remain exact. However, all 24 exact expansion examples expose remaining compression gaps: the 12 derived PQ16 examples have median/worst 1.925726/2.299523 and the 12 RGBA8 artworks 2.323349/3.131331. These failures remain part of qualification. Original splits are preserved, but observed expansion results become regression evidence for subsequent tuning. Reports `m7-lossless-development-single-cache.json`, `m7-pr35-lossless-regression.json` and `m7-lossless-expansion-baseline.json` retain results and provenance. No overall compression or Stable promotion claim.

JXLENC-018 (2026-09-08): In an isolated copy, use DC steps proportional to half the format-default X/Y/B weights: 1/8192, 1/1024 and 1/512 times effective distance. All 18 procedural independent cases pass. On im26-1030 at distance 1 and effort 7, bytes fall from the current strategy-enabled baseline's 1,624,986 to 1,445,201 (11.06%), while SSIMULACRA2 declines 86.98179 to 86.28504 and Butteraugli rises 1.21823 to 1.23843. This is an equal-distance rate/quality tradeoff, not a matched-quality pass. Keep isolated pending curve comparison. Next test the format's adaptive LF smoothing with the changed DC precision. Raw `.tmp/jpegxl-m7/dc-precision-1030-d1.json`, `dc-precision-1030-d1-metrics.json` and `forward-dc-precision-oracle/report.json`.

JXLENC-019 (2026-09-08): Enable adaptive LF smoothing with the isolated channel-specific DC precision from 018. All 18 independent procedural cases pass. On im26-1030 at distance 1 and effort 7, output is 1,445,200 bytes, SSIMULACRA2 86.24687 and Butteraugli 1.23273. Relative to 018 this slightly improves Butteraugli and reduces SSIMULACRA2. Inconclusive for matched quality; not retained. Raw `.tmp/jpegxl-m7/dc-smoothing-1030-d1.json` and `forward-dc-smoothing-oracle/report.json`.

JXLMOD-032 (2026-09-08): Raise the palette candidate limit from 256 to 1024 colors in an isolated copy after counting 751 colors in development artwork noto-1f600 and 340 in noto-1f3b8. Exact output verified by own decoder, libjxl and jxl-rs on both. Size falls from 62,403 to 35,487 bytes on the face and 37,839 to 15,724 on the guitar; native ratios become 1.588141 and 1.301225. Promising compression result, not yet retained. The existing palette builder allocates per-pixel strings and arrays, so replace it with a bounded typed dictionary before broader testing. Artifacts `.tmp/jpegxl-m7/lossless-expansion-palette-1024-{face,guitar}/report.json`. No isolated runtime claim.

JXLMOD-033 (2026-09-08): Replace the per-pixel string/array palette lookup with accounted Int32 color storage and a 2048-slot typed dictionary, capped at 64 probes per pixel with exact collision comparisons. Preserve first-seen palette order. Development noto-1f600 remains byte-identical to 032 at 35,487 bytes, SHA256 7df886bce6db417fde676be3a9d8aebbd911a44ae7ab9623a147ed8cfea65b42, exact in all three decoders. Deterministic removal of per-pixel temporary allocations; no measured speed claim. Candidate currently under focused regression checks. Next retain the previous 256-color encoding as an actual-byte fallback and verify all expansion examples. Raw `.tmp/jpegxl-m7/lossless-expansion-typed-palette-033-face/report.json`.

JXLENC-020 (2026-09-08): In an isolated effort-1 forward copy, sample eight evenly spaced AC groups instead of traversing all groups for prefix statistics, with a positive floor for every validated entropy token. Eighteen independent procedural cases pass. On 12 MP im26-1030, 2,026,935 bytes becomes 2,031,154 (0.208% larger); single core time 3,715.75 ms is observational under concurrent corpus load. Reject for this optimization campaign because output bytes increase; no production retention or paired speed claim. Preserve `.tmp/jpegxl-m7/e1-statistics-1030.json` and `forward-e1-statistics-oracle/report.json`. Return to the byte-identical symmetric DCT candidate from 012 for paired measurement.

JXLMOD-034 (2026-09-08): Compare expanded single-group palettes against the former 256-color encoding decision, including its RCT/Squeeze alternatives. The recursion is bounded to one fallback. All 24 expansion cases decode exactly in all three decoders. RGBA8 median/p90/worst ratios improve from 2.323349/3.000813/3.131331 to 1.389099/1.610034/1.968677. All 12 PQ16 ratios remain unchanged. Retain bounded palette expansion for further validation, without an overall size-gate pass. Four 16-bit palette-boundary tests pass; the earlier typed-dictionary checkpoint passes all 50 focused lossless/memory tests. Runtime and final whole-tree checks remain separate. Raw `.tmp/jpegxl-m7/lossless-expansion-typed-palette-fallback-034/report.json`.

JXLENC-021 (2026-09-08): Seven alternating-order fresh-process pairs confirm the symmetric DCT8 kernel from 012 on frozen 12 MP im26-1030, effort 1 and distance 1. Core median/MAD are 6350.66/176.81 ms control and 5115.76/235.51 ms candidate; median paired reduction 18.684%, all seven pairs win. CV is 3.97%/5.26%. Every output has the same independently verified 2,026,935 bytes and SHA256 48717379e889d8e17d847c7a7b37fb9b3811f0a50c9212e0ab2d20523e4057b6; managed peak stays 9,988,793 bytes. Median RSS is 161,079,296/160,587,776, with no material memory change. Retain as a promising material kernel gain pending neighboring workload confirmation. Other corpus workers remained active on the host, so these pairs are not the isolated public cold/warm gate. Source is the same retained stack plus only the symmetric DCT kernel; no forward encoder exists at original M7 base 2d931aa. Artifacts `.tmp/jpegxl-m7/pair-dct-021{,-summary}.json`.

JXLENC-022 (2026-09-08): Public compiled-package cold/warm diagnostics on frozen 12 MP im26-1030 pass warmup output identity and return managed live bytes to zero. Effort-3 total open/stage/encode/file-output samples are 8396.07 and 8390.06 ms, managed peak 50,234,487 bytes; these are observational under concurrent corpus and check load. Native effort-1 uint8 benchmark warm core is 12/33.9053685 = 0.353926 seconds, while own effort-1 remains several seconds. The 8x reference-machine gate is not established and remains open. A first launch during package rebuilding failed module resolution before measurement; rerunning after the build succeeded. Preserve `.tmp/jpegxl-m7/runtime-034.json`, `runtime-034.log`, `runtime-034-built.log` and `native-runtime-034.log`. Next address the measured transparent-image rate gap: alpha currently shares its histogram with DC/metadata despite its mostly zero residuals.

JXLENC-023 (2026-09-08): Use a local Modular tree and alpha-only ANS histogram for forward effort 3/5/7 alpha groups, leaving exact-JPEG and effort 1 unchanged. Exclude those alpha residuals from the shared DC histogram. All 18 independent procedural alpha cases pass. All six noto-1f600 distance points preserve identical independently decoded RGBA hashes. Distance-1 bytes fall from 33,541 to 30,730 (8.38%); distance-5 from 21,812 to 19,415 (10.99%). Promising, isolated pending complete neighboring alpha/depth/progressive validation; no runtime claim. Artifacts `.tmp/jpegxl-m7/forward-local-alpha-oracle/report.json` and `alpha-development-local-alpha-023/noto-1f600/report.json`. Next combine the unchanged-pixel alpha repair with format-default DC precision and adaptive LF smoothing as a separate rate/quality experiment.

JXLENC-024 (2026-09-08): Isolated format-default X/Y/B DC precision plus adaptive LF smoothing, on top of local alpha histograms, reduces matched bytes on development noto-1f600. At black-composite SSIMULACRA2 90, bytes interpolate from 29,293.72 (023) to 25,946.98; at Butteraugli 1, from 34,494.51 to 29,891.17. Independent RGBA agreement and exact alpha pass at all six distances. Both remain above native (16,187.23 and 19,461.96 bytes). Promising single-family rate/quality change, not retained without broader curves. Raw `.tmp/jpegxl-m7/alpha-dc-024-matched.jsonl` and `alpha-development-alpha-dc-024/noto-1f600/report.json`. Next isolate local DC/metadata entropy models while preserving the existing quantized samples.

JXLENC-025 (2026-09-08): Separate local DC and metadata histograms for grouped forward effort 3/5/7, on top of isolated local alpha coding. On frozen 12 MP im26-1030 effort 7 distance 1, 1,624,986 bytes becomes 1,579,264 (2.81% smaller). Native decoded RGB is identical, SHA256 965c31f083b12284de39770994cfeeb0b6f146fdc2152388f68f9ebf89395f5d; Rust agrees within one level. All 18 procedural independent cases pass. Promising, isolated; concurrent timings do not establish performance. Next separate channel distributions within these local streams. Artifacts `.tmp/jpegxl-m7/local-dc-025-{control-1030,1030,comparison}.json`.

JXLENC-026 (2026-09-08): Split local Modular streams by channel, reusing the repository channel-tree writer and mapping leaf contexts to per-channel ANS histograms. On 12 MP im26-1030, bytes fall from 1,579,264 (025) to 1,539,064; cumulative reduction from the current 1,624,986-byte forward baseline is 5.288%. Independently decoded RGB remains identical; Rust differs by at most one level. All 18 forward procedural and 30 effort-3 native-depth progressive cases pass. The effort-7 claim was corrected after auditing the command flag; see the correction below. Retain conditionally after neighboring confirmation; no isolated runtime claim from single samples. Artifacts `.tmp/jpegxl-m7/local-channel-026-{1030,comparison}.json` and `local-channel-026-e3-depth-oracle/report.json`. The depth harness reused its normal output directory during this diagnostic; its completed outputs were copied to the unique 026 directory, and the original directory now reflects this newer validation rather than the previous checkpoint.

JXLENC-026 neighboring confirmation: The 8.3 MP im26-5032 text brochure falls from 545,859 to 532,212 bytes (2.50%), with identical native decoded RGB and Rust agreement within one level. Thirty native-depth progressive cases also pass. Retain local alpha, per-stream and per-channel entropy models together for full checks; preserve the DC-precision and restoration experiments outside production. Raw `.tmp/jpegxl-m7/local-channel-026-5032{,-comparison}.json`.

JXLENC-026 harness correction: The initial depth command used `--effort 7`, but this verifier accepts `--effort7`. It therefore exercised effort 3. The initially copied effort-7 directory was an older run and is quarantined as `.tmp/jpegxl-m7/mistaken-copy-original-e7-depth`; it is not 026 evidence. Actual effort-3 output is retained in `local-channel-026-e3-depth-oracle`. Rerun the exact `--effort7` flag into a unique 026 directory before making an effort-7 claim. The earlier statement that the normal effort-7 directory was overwritten was also incorrect; the effort-3 directory was reused.

JXLENC-026 actual effort-7 correction completed: The exact `--effort7 --progressive` command passes all 30 cases, with zero failures, in `.tmp/jpegxl-m7/local-channel-026-depth-e7-progressive-oracle/report.json`. Focused root checks pass 105 tests but the unchanged 24 MP lossless effort-7 memory workload exceeds its 60-second timeout while the new full lossless replay and quality workers run concurrently. Preserve the timeout; repeat that workload after reducing load. The 2996-test full pass predates local entropy integration.

JXLENC-027 (2026-09-08): Profile 012 showed 18.57% idle samples; public checkpoints previously queued a timer for every bounded preparation/group step. Preserve every active/cancellation check but queue a timer at most once per 16 ms of intervening work, plus the initial yield. Seven alternating fresh-process pairs on 12 MP im26-1030 effort 1 preserve identical 2,026,975-byte public streams and managed peak 45,988,801 bytes. Public open/stage/encode/file-output median/MAD is 7642.80/78.40 ms control and 7228.26/84.67 ms candidate; median paired reduction 8.058%, seven of seven wins. CV 2.00%/6.12%; median RSS 204,984,320/204,972,032 bytes. Retain for cancellation and browser validation. Other corpus workers were active, so no isolated reference-machine gate claim. Artifacts `.tmp/jpegxl-m7/pair-checkpoint-027{,-summary}.json`.

JXLENC-028 (2026-09-08): In an isolated forward effort-3/5/7 RGBA path, replace only fully transparent samples with the visible samples mean in the same 8x8 XYB block; fully transparent blocks become uniform. Exact alpha coding and all visible input samples are unchanged. This avoids spending AC bits on invisible sharp edges with only a 64-byte mask. On noto-1f600 distance 1, bytes fall from 29,865 (026) to 23,779 (20.38%); black/white SSIMULACRA2 improves from 91.399/91.195 to 91.601/91.344. All six independent curve points retain exact alpha and native/Rust agreement. Promising single-family result, not yet retained; test the complete transparent development cohort and native-depth boundary before adopting it. Raw `.tmp/jpegxl-m7/alpha-development-invisible-028/noto-1f600/report.json`. Lossless invisible RGB preservation is unchanged.

JXLENC-028 complete development verification: All six transparent families finish all 24 engine/setting points without failures; all 30 correctly invoked effort-7 progressive native-depth cases pass. At SSIMULACRA2 90, black/white median native size ratios improve from 1.629102/1.581692 (026) to 1.127066/1.106304. Butteraugli-1 medians improve from 1.693660/1.695799 to 1.205946/1.190657; Butteraugli-2 medians are 1.313231/1.312799, with worst 1.533809/1.575426. These bracketed development bands meet the size targets; lower unbracketed bands remain missing, not passes. Retain for final validation. Visual review of the actual opaque black composite at native size preserves the face silhouette; the generic RGBA preview exposes hidden RGB, so use the measured composites for visual review. Alpha at the apparent preview step is exactly zero. Raw complete report `.tmp/jpegxl-m7/expansion-quality-invisible-028-complete-summary.json`, depth `invisible-028-depth-e7-progressive-oracle/report.json`, and `invisible-028-face-black-review.png`.

JXLENC-029 (2026-09-08): Cap residual-derived EPF sharpness at 3, enable it only at distance 2 or above, and retain the majority-active-block guard. Eighteen correctly forced effort-7 procedural cases pass. At distance 3, im26-1030 improves SSIMULACRA2 79.61796 to 79.99363 and Butteraugli 2.58029 to 2.55093; im26-1638 improves 77.14134 to 77.86716 and 2.81519 to 2.77336. Native/Rust differences stay within one level. These comparisons use the earlier stored unfiltered controls; repeat fresh controls with the current entropy/DCT stack and broaden to six frozen photo classes before retention. Limit the proposed policy to opaque standard-sRGB inputs so alpha/HDR domains keep their separately evaluated behavior. Artifacts `.tmp/jpegxl-m7/epf-cap-029-{1030,1638,comparison,1638-comparison}.json` and metric text files. An initial food comparison named a nonexistent control and was rerun with the recorded gabor-control stream; the failed command log is preserved.

JXLMOD-034 complete SDR development replay: All 120 images are independently exact after typed palette expansion, with zero failures. Median/p90/worst ratios improve to 1.153636/1.367369/1.673511, satisfying SDR development size targets. The observed holdout replay is underway; no unseen-holdout or HDR lossless promotion. Report `benchmark/jpegxl/production-program/m7-lossless-development-typed-palette.json`. Next inspect whether coarse signed-gradient bins improve the remaining derived-PQ16 residual distributions; existing 8-bit bins distinguish only exact zero from either sign.

JXLMOD-035 (2026-09-08): Isolated coarse signed-gradient bins at -256/+256 fail on the first derived-PQ16 development input before an output can be qualified. The tree-frequency builder counted raw split values, while its prefix writer hybrid-encodes values above 255; the new thresholds exposed that mismatch. Reject this invalid candidate, preserve the failure in `.tmp/jpegxl-m7/lossless-expansion-hdr-gradient-035/report.json`, and count the actual hybrid split tokens before evaluating compression. Production zero-split trees remain unchanged.

JXLENC-030 (2026-09-08): Fresh controls across the first source in six frozen photographic classes confirm the capped, residual-derived two-iteration EPF policy at distance 3. SSIMULACRA2 improves on all six by 0.0392 to 0.5082. Butteraugli improves on four; nature and food increase by 0.00991 and 0.02593. Metadata adds up to 1.66% bytes. This is a restoration feature with a measured rate/quality tradeoff, not a byte-size or speed optimization win. No full-curve or Stable claim. Keep it isolated until progressive-stage and native-depth checks at distance 3 pass; its proposed scope is opaque standard-sRGB gray/RGB at effort 5/7 and distance >=2, with strength from quantization RMS capped at 3 and no filter when most blocks request zero strength. All raw points, exact controls, pins and misses are in `.tmp/jpegxl-m7/epf-six-030/{protocol,report}.json`.

JXLENC-030 restoration conformance: All eight independent first-pass comparisons and all 30 correctly invoked effort-7 native-depth progressive cases pass at distance 3. Retain the bounded opaque-sRGB residual policy as experimental functionality, preserving its two small Butteraugli misses and unfinished whole-curve qualification. Store strengths in Uint8Array (values 0 through 3), one byte per 8x8 block; this uses 562,500 fewer bytes than the diagnostic Int32 map on 12 MP. Recheck byte identity and the final API/browser gates after integration. Artifacts `.tmp/jpegxl-m7/epf-cap-030-stage-e7-oracle/report.json` and `epf-cap-030-depth-e7-progressive-oracle/report.json`.

JXLMOD-036 (2026-09-08): Correct the isolated coarse-gradient tree histogram to count hybrid tokens for split values outside the direct-token range. The qwantani PQ16 diagnostic is exact in all three decoders and decreases from 7,298,712 to 7,191,060 bytes (1.475%). Its native size ratio remains 2.265607, above the target. This isolated result does not justify changing the global gradient policy; not retained. Raw `.tmp/jpegxl-m7/lossless-expansion-hdr-gradient-036/report.json`.

JXLENC-030 integrated verification: The production Uint8 strength map passes 22 focused forward tests, eight independent progressive first-pass comparisons and 30 native-depth progressive comparisons at distance 3. Explicit frame tests cover coarse opaque RGB, fine-distance exclusion and alpha exclusion. Artifacts `.tmp/jpegxl-m7/restoration-focused.log`, `forward-stage-e7-d3-oracle/report.json` and `forward-depth-verified-mode-e7-progressive-d3-oracle/report.json`. Full repository and browser checks remain required after integration.

JXLENC-031 (2026-09-08): Fresh retained-stack profiling attributes 2.62 seconds to XYB conversion, 1.39 seconds to AC preparation and 1.06 seconds to DCT8 on the 12 MP effort-1 photo. Factoring the block scale alone out of coefficient division preserves all 2,026,935 bytes but retains one division per coefficient; the concurrent 8.71-second diagnostic provides no speedup evidence. Not retained. Next precompute the finite per-strategy/per-quantizer reciprocal tables outside the block loops. Raw `forward-e1-retained031.cpuprofile`, `reciprocal-031.json` and `reciprocal-031-baseline.json` under `.tmp/jpegxl-m7`.

JXLENC-032 (2026-09-08): Precompute reciprocal tables for both quantizers and the three weight families, removing per-coefficient division. The 12 MP E1 output remains byte-identical at 2,026,935 bytes; eight progressive-stage and 30 depth checks pass independently. Seven alternating fresh-process pairs give base/candidate medians 5890.09/5763.32 ms, MAD 128.08/128.33 ms, paired median -2.845%, and 5/7 wins. CV is 11.31%/7.34% under concurrent full-test and corpus load. Inconclusive for a small speed gain; not retained. Candidate managed peak increases by 9,216 bytes. Raw `.tmp/jpegxl-m7/pair-reciprocal-032{,-summary}.json`. A quieter confirmation is required before adopting this arithmetic change.

M7 memory incident and recovery (2026-09-08): Kernel logs confirm global OOM killed ChatGPT at 20:20:35 while overlapping development curves, re-encode checks and timing experiments were active. Prior concurrent runtime samples, including cube-root experiment 033, do not establish a speed win. Production retains neither reciprocal-table 032 nor cube-root 033. Recovered 71 complete old-encoder SDR curves and four complete current-encoder curves; incomplete records remain incomplete. All subsequent heavy checks use `run-m7-bounded.ts`: one fixed systemd user unit, MemoryMax=3 GiB for the entire process tree, MemoryHigh=2500 MiB, MemorySwapMax=0, TasksMax=64 and CPUQuota=200%, with at least 8 GiB MemAvailable at admission. The cap was independently read from cgroup files. Recovery typecheck passed at 1.9 GiB peak and zero swap. No relaxation of codec correctness or quality thresholds.

JXLENC-034 (2026-09-08): After the OOM recovery, test group-local HF entropy presets for opaque, non-progressive forward effort 1 with 2 through 256 AC groups. Collect each group histogram and emit its AC section immediately, reusing its quantized coefficients; retain only bounded group scratch, compact histograms and output sections. The frame HF header is serialized after all groups. Large preset maps use ANS for their move-to-front symbols. This directly targets the repeated XYB/DCT work in the retained CPU profile. Isolated candidate only; validate independent pixels, output size, memory and speed before retention. Snapshot `.tmp/jpegxl-m7/local-hf-034-snapshot.json`; production remains unchanged.

JXLENC-034 result: Native pixels are byte-identical to the retained encoder; jxl-rs differs by at most one RGB8 level. Seven capped, sequential fresh-process pairs on 12 MP im26-1030 show base/candidate medians 4173.78/3443.10 ms, MAD 30.14/19.46 ms, paired median -18.189%, 7/7 wins. Output decreases 2,026,935 to 1,911,970 bytes. Reject the current prototype for memory: median RSS rises 161,189,888 to 202,145,792 bytes, and managed peak 9,988,793 to 14,825,981. It remains isolated. Next reuse per-group ANS value, context, packed-value and renormalization buffers. Artifacts `.tmp/jpegxl-m7/pair-local-hf-034{,-summary}.json` and `local-hf-034-comparison.json`.

JXLENC-035 (2026-09-08): Reusing ANS value/context/packed/renormalization buffers preserves the 1,911,970-byte stream and lowers the diagnostic RSS from 203,616,256 to 159,932,416 bytes, with core 3378.61 ms. No paired promotion yet. A flat 1024-square regression stays pixel-identical but increases output 12,444 to 12,628 bytes, so retention is still rejected. The brochure check then failed because its input PPM path was wrong; this is a harness failure, not codec evidence. Correct input is `lossless-development-typed-palette-034-snapshot/im26-5032.ppm`. Next retain an exact global-prefix byte-size floor, including TOC cost, and bypass local models for mostly constant sampled DC to preserve the fast flat-image path. Raw `.tmp/jpegxl-m7/local-hf-035.log`, `local-hf-035-neighbors{.json,.log}`.

JXLENC-036 (2026-09-08): Add exact global-prefix size prediction from per-group symbol counts, including TOC sizes, and retain the smaller byte representation. Mostly constant sampled DC keeps the original path to avoid extra search on flat inputs. Under the 3 GiB envelope, the flat regression remains byte-identical at 12,444 bytes (981/986 ms observational, 109,445,120/109,494,272 RSS). The real brochure decreases 808,316 to 788,138 bytes, with observational core 6121/5117 ms and RSS 145,776,640/143,568,896. Both native comparisons are pixel-identical and Rust agrees within one level. Candidate remains isolated pending strict typing, full depth coverage and paired timing. Artifacts `.tmp/jpegxl-m7/local-hf-036-neighbors{.json,.log}` and per-case comparison JSON.

JXLENC-036 retention: Strict typing and all 30 effort-1 independent native-depth cases pass. Seven sequential capped pairs give base/candidate median 8942.410/7547.561 ms, MAD 70.181/204.488 ms, paired median -16.056%, seven wins, CV 3.197%/2.816%. Output falls from 2,026,935 to 1,911,970 bytes. Median RSS falls from 162,095,104 to 160,808,960 bytes; explicitly tracked scratch and metadata peak rises from 9,988,793 to 15,221,245 bytes. The complete job peaks at 157.1 MiB with zero swap. Absolute times do not establish the native-reference gate. Retain for integrated public regression and memory checks. Raw `.tmp/jpegxl-m7/pair-local-hf-036{,-summary}.json` and `local-hf-036-depth.log`.

JXLENC-037 (2026-09-08): Preserve an isolated balanced-DC precision candidate on the integrated 036 stack for matched-quality evaluation. This follows the still-unresolved 018/024 rate-quality hypothesis; no production change and no acceptance claim. Snapshot `.tmp/jpegxl-m7/balanced-dc-037-evaluation-snapshot.json`. The candidate uses channel steps 1/8192, 1/1024 and 1/512 times effective distance, with the existing smoothing policy.

JXLENC-038 (2026-09-08): Isolate fusion of effort-1 DC accumulation and AC conversion for opaque non-progressive frames with 2 through 256 groups. Initial preparation leaves compact DC planes empty; each group conversion fills those planes while collecting AC entropy, and LF/DC sections are serialized after every group has been visited. No full-frame XYB cache is added. This targets the remaining duplicate pixel conversion while preserving exact coefficients, quantization and section-size fallback. Candidate only; require independent pixels, flat/DC-only regressions, managed-allocation checks, and paired runtime/RSS before retention. Snapshot `.tmp/jpegxl-m7/fused-e1-038-snapshot.json`.

JXLENC-038 retention: All 30 effort-1 native-depth cases and native/Rust photo, flat, and brochure comparisons pass. Every encoded byte matches integrated036. Seven alternating pairs give base/candidate median 3533.600/2673.402 ms, MAD 24.650/54.254 ms, CV 1.093%/2.175%, paired median -22.385%, seven wins. Median RSS falls 161,918,976 to 160,456,704 bytes; managed peak remains 15,221,245 bytes. Flat diagnostic managed peak increases 1,088,397 to 3,502,122 bytes for entropy scratch, while RSS remains approximately 110 MiB and core drops 467 to 307 ms. Retain for full integrated allocation and browser checks. Artifacts `.tmp/jpegxl-m7/pair-fused-e1-038{,-summary}.json` and `fused-e1-038-neighbors.json`.

JXLMOD-039 (2026-09-08): Isolate seven signed-magnitude buckets for the existing left-minus-top-left property, at thresholds -256, -32, -1, 0, 32 and 256. The three-sign model does not distinguish smooth slopes from large edges and may mix residual distributions on native-depth inputs. This diagnostic replaces only the isolated gradient candidate; production is unchanged. Verify exact decoding before measuring its size, and preserve the old sign candidate as an actual-byte floor before any retention. Snapshot `.tmp/jpegxl-m7/gradient-magnitude-039-snapshot.json`.

JXLMOD-039 initial diagnostic failed before output: the existing tree-frequency counter used raw split values, which worked for the old small thresholds but omitted the hybrid token for a 256-magnitude split. Correct only the isolated candidate to count hybrid tokens and retry with a fresh run ID. No invalid stream or failed result is counted as a compression measurement.

JXLENC-040 (2026-09-08): Revisit the OOM-interrupted cube-root hypothesis 033 after the retained single-pass change. The isolated candidate uses an 8,194-entry Float64 table and one Newton step within its finite domain, with Math.cbrt outside the table. The shared module table costs 65,552 bytes outside per-encoder owned scratch and must be included in RSS assessment. Require full numeric-domain audit, independent depth/neighbor output checks and quiet capped paired timing before retention. Snapshot `.tmp/jpegxl-m7/cube-root-040-snapshot.json`; no production change.

JXLMOD-039 token-corrected result: The frozen PQ16 panorama is exact through PureJsImage, libjxl and Rust at 7,174,431 bytes, ratio 2.260367 to native. This is 1.70% smaller than the 7,298,712-byte retained baseline but remains far above target. No full-cohort byte floor or runtime evidence; not retained. Raw `.tmp/jpegxl-m7/lossless-expansion-gradient-magnitude-039-tokenfix/report.json`.

JXLENC-040 numeric audit: All 16,777,216 RGB8 sRGB colors were evaluated through the actual candidate helper and pinned Float32 matrix. Maximum root error is 1.2164e-10; 21,714 colors differ in at least one Float32 XYB plane, with maximum absolute plane change 1.4901e-8. Neighbor encoded streams remain identical and 60 effort-1/effort-7 progressive depth cases pass, but the measured photo diagnostic improves only about 4%, without paired confirmation. The approximation is not established as byte-preserving over the domain. Not retained pending broader quality/size evidence and a repeatable speed gain. Raw `.tmp/jpegxl-m7/cube-root-040-numeric.json` and `cube-root-040-neighbors.json`.

M7 native metric envelope correction (2026-09-08): A pinned 12 MP Butteraugli process plus parent approached 3 GiB and stalled in memory.high reclaim (6m24s wall versus 22s CPU). Stopped deliberately before completion; no curve point was complete. Preserve `balanced-dc-037-interrupted.json` alongside the original launcher receipt, whose successful systemd SIGTERM shutdown was not actual job completion. The launcher now distinguishes killed services. Default checks remain hard-capped at 3 GiB with a 2880 MiB pressure threshold; an explicit 8 GiB metric profile requires 18 GiB MemAvailable, uses a 7.5 GiB threshold, and retains one service and zero swap. No codec budget or quality protocol is relaxed.

JXLENC-037 measured development result: All 24 points across four frozen photo families decode independently and complete the original six-point metric protocol. Most matched bands improve, but im26-1466 SSIMULACRA2 90 increases matched bytes by 1.942%. The uniform balanced-DC candidate is not retained. The successful 8 GiB metric job peaks at 3.4 GiB with zero swap. Raw `.tmp/jpegxl-m7/balanced-dc-037-matched.json` and `lossy-development-balanced-dc-037-large-capped`.

JXLENC-041 (2026-09-08): Evaluate a fixed distance-dependent DC policy using those development measurements. Preserving original precision through distance 0.5 still regresses one matched band by 0.280%; preserving it through distance 1 removes measured regressions on all bracketed bands in these four families. Above distance 1, use balanced precision only for opaque RGB8 sRGB at efforts 3/5/7. This is a single image-independent policy, not per-image selection. Predicted Butteraugli-2 improvements are 7.682% to 16.691%; missing brackets remain missing. Isolated pending exact output verification and broader quality/neighbor checks. Raw `.tmp/jpegxl-m7/balanced-dc-041-coarse-predicted-matched.json`, snapshot `coarse-dc-041-snapshot.json`.

M7 resource launcher smoke: A child deliberately terminating itself with SIGTERM now yields launcher exit 1 and receipt status `terminated`, even though systemd describes the service shutdown as successful. Peak 10 MiB, zero swap. The subsequent normal curve-analysis job returns success. Raw `.tmp/jpegxl-m7/bounded-runs/launcher-sigterm-041.json`.

M7 alpha visual review: Inspected the existing noto-1f600 source, distance 1, and distance 5 on both black and white backgrounds in `.tmp/jpegxl-m7/alpha-visual-review.png`. The alpha boundary remains clean; distance 5 shows visible quantization around mouth and eye details. This is a limited visual observation, not an all-corpus visual or quality pass. The raw transparent PNG preview exposed invisible RGB and was unsuitable for evaluating composited appearance.

JXLENC-041 byte verification: All 24 outputs match the predeclared selected, independently scored artifacts exactly. The serialized job peaks at 260.2 MiB with zero swap and completes in 4m13s. This confirms the four-family curve prediction, but the policy remains isolated pending additional source classes, fractional-distance boundaries, visual review and runtime checks. Raw `.tmp/jpegxl-m7/coarse-dc-041-verification.json`.

JXLENC-042 (2026-09-08): Measure the retained 038 encoder against pinned native effort 1 with seven alternating cold/warm process pairs on the frozen 12 MP source. Compare encoder-core durations only; native whole-process cost includes a decode and must not be compared with the first-party encoder core. Warm native timing omits its first repetition; the first-party warmup verifies output hashes and reclaims ArrayBuffers before measurement. No quality-equivalence claim follows from equal distance. Raw `.tmp/jpegxl-m7/runtime-native-042.json`.

JXLENC-042 result: Seven pairs give median first-party/native core times 2610.047/306.366 ms cold and 2659.225/259.968 ms warm. Paired median ratios 8.575 and 10.164 miss the 8x gate. First-party CV is 5.616% cold and 15.142% warm, so preserve the variability; no promotion. The complete job peaks at 401 MiB with zero swap. Raw `.tmp/jpegxl-m7/runtime-native-042-summary.json`.

JXLENC-043 (2026-09-08): Fresh retained-stack profile attributes 14.07% to the AC visitor, 8.86% to hybrid packing, 17.93% to XYB conversion and 9.96% to DCT8. Group-local entropy visits the same quantized coefficients once for statistics and again to collect values. Store values and contexts in the existing bounded scratch during the statistics visit, then emit them directly after histogram construction. No new allocation or changed token order. Isolated pending exact bytes, independent neighbors, boundary checks and seven paired measurements. Profile `.tmp/jpegxl-m7/retained-043.cpuprofile`; source `/tmp/purejsimage-m7-ac-reuse-043-evaluation`.

JXLENC-044 (2026-09-08): The same AC visitor scans once for the last nonzero coefficient and again to count nonzero coefficients. Count both during the first scan; retain the original token-emission order and every bound check. This removes a repeated coefficient traversal for all AC encodings, including exact JPEG reconstruction. Isolate on top of 043 and require exact byte/decoder coverage plus paired timing before retention. Source `/tmp/purejsimage-m7-ac-count-044-evaluation`.

JXLENC-043 paired confirmation: Median core 2797.511 to 2469.962 ms, paired median -9.865%, seven wins. MAD 155.416/40.189 ms; CV 6.851%/3.236%. Every stream preserves the independently verified hash. The paired job peaks at 180.5 MiB with zero swap. Promising for integration after combined depth/boundary coverage. Raw `.tmp/jpegxl-m7/pair-ac-reuse-043-summary.json`.

JXLENC-045 (2026-09-08): Hybrid token packing is 8.86% of the retained CPU profile. The validated integer domain is 0 through 1,048,695; replace floor(log2) with 31-clz32 for the nonzero integer branches, including the prefix token helper. This is exact throughout that bounded domain and avoids transcendental work. Isolate on 044; require exhaustive domain equivalence, unchanged bytes and paired timing. Source `/tmp/purejsimage-m7-hybrid-log-045-evaluation`.

JXLENC-044 confirmation: Seven pairs preserve exact streams. Median core 2468.198/2407.942 ms; paired median -1.961%, six wins. MAD 35.951/22.413 ms; CV 2.709%/2.885%. This removes a deterministic coefficient read pass; the observed speed gain is small and is not independently declared material. Job peak 158.7 MiB, zero swap. Raw `.tmp/jpegxl-m7/pair-ac-count-044-summary.json`.

JXLENC-045 integer audit: Actual before/after helpers produce identical packed integers, including token and extra bits, for all 1,048,696 supported values under all three production configurations. Every valid split exponent 0..15 and msb/lsb partition also agrees around powers of two 0..20, plus/minus two. Prefix tokens agree throughout the complete value domain. Raw `.tmp/jpegxl-m7/hybrid-log-045-audit.json`.

JXLENC-046 (2026-09-08): Reuse the complete packed hybrid integer collected for group statistics, rather than compute it again for ANS output. Remove the now-unused 786,432-byte raw-value scratch allocation, and calculate the prefix fallback token once for both histograms. Existing context and renormalization buffers remain bounded and reused. Isolate on 045; require exact byte hashes, independently decoded neighbors, memory-budget checks and paired measurements. Source `/tmp/purejsimage-m7-packed-reuse-046-evaluation`.

JXLENC-045 initial timing: Seven pairs give median 2401.929/2380.211 ms and paired median -1.137%, but only four wins. MAD 40.874/50.307 ms, CV 2.861%/3.340%. Exactness passes; speed remains inconclusive. Require 21-pair confirmation before retention.

JXLENC-046 initial timing: Exact stream hashes pass in all seven pairs. Median 2424.258/2468.612 ms and paired median -6.182% disagree because of high variability; only four pairs win, with CV 15.818%/15.275%. Median RSS 162402304/162861056 bytes; the overall tracked peak remains 15221245 bytes despite removal of the later raw-value scratch allocation. Do not claim a speed or peak-memory win from this run. Require a larger confirmation and neighboring checks. Raw `.tmp/jpegxl-m7/pair-packed-reuse-046-summary.json`.

JXLENC-045 expanded confirmation: Twenty-one pairs give median core 2377.737/2340.710 ms, paired median -0.703%, 15 wins. MAD 21.455/17.702 ms; CV 3.638%/1.951%. Median RSS 162799616/163061760 bytes, with unchanged managed peak and every output hash identical. Retain this small, exact two-line arithmetic change conditionally with the stack; it is not a standalone material gain. Raw `.tmp/jpegxl-m7/pair-hybrid-log-045-confirm-summary.json`.

JXLENC-046 independent coverage: All 30 effort-1 native-depth cases pass, and photo/flat/document streams preserve prior bytes. Native pixels are identical and Rust agrees within one level. The serialized job peaks at 363.3 MiB with zero swap. Raw `.tmp/jpegxl-m7/packed-reuse-046-independent.log` and `packed-reuse-046-neighbors.json`.

JXLENC-047 (2026-09-08): The fresh 043 profile still attributes 9.96% to DCT8. Expand only its fixed eight-frequency loops into constant-index operations, preserving every multiplication/addition and Float32 boundary. No factoring or numeric approximation. Isolate on 046; require identical coefficient bits, encoded hashes and a measured benefit sufficient to justify added code. Source `/tmp/purejsimage-m7-dct-unroll-047-evaluation`.

JXLENC-046 expanded confirmation and integration: Twenty-one pairs give median 2334.275/2230.421 ms, paired median -5.299%, 18 wins. MAD 13.567/32.389 ms; CV 6.277%/5.878%. Median RSS 163876864/162914304 bytes; tracked peak stays 15221245 bytes. Retain 043, 044, 045 and 046 together after their independent checks; remove the superseded optional raw-value scratch parameter from the generic AC writer. No new runtime claim until cumulative and native-reference reruns. Raw `.tmp/jpegxl-m7/pair-packed-reuse-046-confirm-summary.json`.

JXLENC-047 coefficient audit: All 640,000 coefficient Float32 bit patterns match the retained transform across 64 unit impulses and 9,936 seeded finite blocks spanning powers of two -8 through 8. No approximation is introduced. Raw `.tmp/jpegxl-m7/dct-unroll-047-audit.json`.

JXLENC-047 result: Seven pairs preserve bytes but show no credible benefit: median 2225.542/2219.976 ms, paired median -0.015%, four wins. Candidate CV rises to 12.712% from 1.202%. The larger fixed-loop source is not retained. Raw `.tmp/jpegxl-m7/pair-dct-unroll-047-summary.json`.

Integrated 046 gates: Full npm run check passes 3014 tests with three existing skips. Its cgroup peak is approximately 2.05 GiB with zero swap; minified entries 454785/399758 stay within the existing ceilings. Seven cumulative pairs versus restoration030 give median 4244.093/2220.989 ms, paired median -47.507%, seven wins, with smaller output and identical independently decoded pixels. Median RSS rises 161705984 to 163618816 bytes, while tracked peak rises 9988793 to 15221245 bytes from bounded local entropy scratch; this is not a peak-memory improvement. Native reference medians are 7.184x cold (pass) and 8.500x warm (miss). Public effort-3 cold/warm workflows measure 4425/4402 ms in single diagnostic samples and emit identical independently valid streams. No overall M7 promotion.

JXLENC-048 (2026-09-08): Inspection of the remaining AC-group profile finds an effort-1 full pixel pass that subtracts zero color-correlation terms from the X/B planes. Effort 1 never populates those correlation maps. Select the existing uncorrelated fill function once before the block loops, preserving the higher-effort path. This removes deterministic zero arithmetic and two plane rewrites per sample without changing quantized coefficients. Isolate on checked046; verify both single/progressive native-depth modes, encoded bytes and paired timing. Source `/tmp/purejsimage-m7-zero-cfl-048-evaluation`.

JXLENC-048 initial result: Encoded bytes match in all seven pairs, but no repeatable speed benefit is established: median 2196.113/2197.993 ms, paired median -0.103%, four wins, candidate CV 10.187%. Keep the one-line candidate isolated; do not use the eliminated zero arithmetic as a speed claim. Raw `.tmp/jpegxl-m7/pair-zero-cfl-048-summary.json`.

JXLENC-049 (2026-09-08): Group-local effort-1 ANS maps every coefficient context to one histogram, yet the visitor still calculates per-coefficient contexts and neighboring nonzero predictions. Select a values-only coefficient loop once per block for this single-model caller; preserve the existing contextual loop for every other caller, all coefficient bounds and token order. Reuse the existing zero-initialized context buffer without writing it. This removes context calculation and three temporary nonzero planes per group; no new allocation. Isolate on checked046, independently of neutral048. Source `/tmp/purejsimage-m7-single-model-049-evaluation`.

JXLENC-049 confirmation: All 21 pairs preserve exact streams; paired median -2.800%, 20 wins, medians 2204.913/2144.383 ms. Candidate MAD is 17.436 ms and CV 3.446%; the control has a large outlier (CV 15.356%) and that raw sample remains recorded. Median RSS decreases 163405824 to 160948224 bytes. All 30 effort-1 native-depth and real neighbor checks pass. Specialized source bundle measures 454972 bytes, within the unchanged 455000 ceiling. Retain conditionally with final integrated checks. Raw `.tmp/jpegxl-m7/pair-single-model-049-confirm-summary.json`.

JXLENC-050 (2026-09-08): The bounded AC visitor guarantees packed signed coefficient values below 8192. Precompute the existing hybrid packing function for that exact domain once per frame, using a tracked 32 KiB Uint32Array, then reuse those integers during group collection and release the table before LF/DC serialization. This targets the remaining repeated token arithmetic with exact values, not an approximation. Remove the now-unused optional raw-value scratch parameter from writeAnsValues; all retained scratch users call the packed writer directly. Isolate on 049; require output hashes, explicit memory/neighbor checks, measured benefit and unchanged bundle ceilings. Source `/tmp/purejsimage-m7-ac-table-050-evaluation`.

JXLENC-050 retention: Seven pairs give median 2156.482/1955.507 ms, paired median -8.694%, seven wins; MAD 17.384/6.146 ms and CV 0.872%/0.716%. Median RSS 160247808/161095680 bytes; tracked peak remains 15221245 bytes. All 30 effort-1 native-depth checks and photo/flat/document native/Rust comparisons pass with identical prior streams. The flat neighbor adds approximately 31 KiB to its lower tracked peak and has neutral observed runtime; other tracked peaks remain unchanged. The specialized source bundle is 454966 bytes, within the unchanged ceiling. Retain 049 and 050 together; 048 remains outside production. Require final full/browser checks and fresh native-reference timing. Raw `.tmp/jpegxl-m7/pair-ac-table-050-summary.json` and `ac-table-050-neighbors.json`.

JXLENC-051 (2026-09-09): User-directed small diagnostic loop replaces exhaustive qualification during development. Eight frozen development sources use four native-scale text/map crops and four photographic derivatives, maximum edge 1024. Native effort-7 controls and three distances run once; candidate loops score 24 first-party outputs with native, Rust and repository decoder checks. Revisit unfinished JXLENC-041 on current integrated054 source. The baseline takes 62.245 seconds and peaks at 958 MiB; candidate takes 39.296 seconds and peaks at 568.1 MiB, zero swap. All outputs pass. Of 34 bracketed comparisons, 33 improve and one NOAA Butteraugli-1.5 comparison regresses 0.0399%. Despite a 3.97% median matched-size reduction, visual review exposes stronger block patterns in sunset gradients and pink color areas. Reject this aggressive DC policy, including the earlier unfinished 041 policy. Retain raw results and visual hashes in `benchmark/jpegxl/production-program/m7-small-diagnostics.json`.

JXLENC-052 (2026-09-09): Test smaller opaque RGB8 sRGB DC steps of 1/16384, 1/4096 and 1/2048 above distance 1 at efforts 3/5/7. Other modes retain original precision. All 24 outputs decode independently; all 34 bracketed comparisons improve, median 2.5656%, range 0.0740% to 14.9272%. The run takes 38.132 seconds and peaks at 570.8 MiB with zero swap. Reviewed text/map and gradient crops avoid the strong extra blocks seen in 051. Retain for the Experimental writer, with five focused smooth-gradient regressions spanning distances 0.999, 1, 1.001, 2 and 3. Original-size runtime/output verification and final repository/browser gates follow. This is a development sample, not full-corpus qualification.

JXLENC-053 (2026-09-09): Add format-defined adaptive DC smoothing to isolated 052. All 24 outputs pass independent decoding, and all 34 bracketed comparisons improve against integrated054. Median reduction 2.5664% is effectively unchanged from 052, with no clear visual advantage in reviewed sunset, pink, text and map crops. Not retained. The run takes 38.238 seconds and peaks at 568.3 MiB with zero swap. Pinned libjxl `enc_adaptive_quantization.cc::InitialQuantDC` and `enc_patch_dictionary.cc::FindBestPatchDictionary` were read for algorithm guidance. Native brochure/table reference-frame patches explain a separate missing encoder tool; DC precision does not close that feature gap.

JXLENC-052 original-size regression check: Seven alternating fresh-process pairs on original 12 MP im26-1030, effort 3 and distance 3, give core medians 4315.679/4304.676 ms and paired median -0.945%, with four wins. Treat runtime as neutral. Median absolute process peak RSS is 221044736/223117312 bytes; managed peak is 14002296/14002276 bytes. All seven outputs per side are byte-identical and both representative streams pass native, Rust and repository decoding with maximum RGB8 difference one. Bytes are 643970/568912 at equal distance; this original-size check does not establish matched perceptual quality. Three separate native patches-off controls on the diagnostic text crops produce 93607, 82487 and 73354 bytes, compared with unchanged default-native 29302, 44985 and 58904 bytes. Keep these feature-isolation controls separate from the default quality comparator. The first full-check attempt passed three real-browser tests but stopped on stale generated package metrics; refresh those metrics before the final gate. Raw timing, decoding and patch controls are retained in `m7-small-diagnostics.json`.

Integrated050 final validation: All 3014 tests pass with three existing skips; all 72 real-browser workflows pass. The cumulative seven-pair median improves 53.012% versus restoration030 with seven wins, but both sides contain outliers (CV 13.635%/11.814%); retain the raw dispersion rather than claim precision. Original native pairs have a noisy warm result, so a separate 21-pair confirmation measures warm median 1996.288/258.549 ms, paired native ratio 7.789, with 18/21 pairs below 8x and CV 4.047%/1.751%. Cold ratio is 6.592. Public E3 cold/warm totals are 4797/4502 ms, and native/Rust verification passes. These representative local runtime targets pass; the M7 compression and full quality goals remain open.

M7 full-resolution metric profile: Preserve the 3 GiB default and 8 GiB diagnostic profile. Add an explicit 10 GiB cap for the full corpus, which includes approximately 30 MP sources; it requires at least 22 GiB MemAvailable, uses a 9.375 GiB pressure threshold, zero swap and the same single service. The prior 12 MP metric job peaked at 3.4 GiB. The higher profile is for pinned whole-image development metrics, not the portable encoder budget. Admission must fail rather than consume the reserved host margin.


JXLMOD-051 (2026-09-09, prepared; measurements not run): Revisit the seven gradient buckets from JXLMOD-039 as an additional effort-7 candidate, keeping the actual smaller of the existing channel/three-sign models and the seven-bucket model. Limit the new candidate to ordinary planes above 16,384 samples so the old palette and 128x32 Squeeze-probe admission decisions remain unchanged. Generalize the tree writer while preserving its default three-bucket byte sequence, and retain the corrected hybrid-token frequency count for large split thresholds. Production remains integrated-050. Require a differential tree-byte audit, native/Rust exactness, representative development compression, timing and memory evidence before any retention. The active lossy matrix continues alone under its memory cap. Snapshot `/tmp/purejsimage-m7-gradient-floor-051-evaluation`; reproducible patch and hashes `.tmp/jpegxl-m7/gradient-floor-051{.patch,-snapshot.json}`. No performance verdict yet.

JXLMOD-051 initial validation (2026-09-09): Strict type checks and 2,112 differential default-tree cases pass. The qwantani PQ16 development diagnostic is exact through the repository, libjxl and Rust decoders at 7,174,431 bytes, 1.70% below integrated050 and ratio 2.260367 to native. This confirms the seven-bucket candidate remains legal when the previous actual-byte floor is retained. It still misses the compression target, and representative timing and broader-class measurements remain unrun. Keep isolated; no production retention or promotion. Raw `.tmp/jpegxl-m7/gradient-floor-051-tree-audit.json` and `lossless-expansion-gradient-floor-051-pq/report.json`.

JXLMOD-052 (2026-09-09, isolated preparation): The read-only cardinality audit finds only 1,745–3,046 distinct values per channel in three observed PQ16 development inputs. Test group-local sorted scalar palettes followed by RCT on indices, against the existing group candidates. The experimental RGB16 effort-7 route moves global RCT into each local candidate; all other routes stay unchanged. This initial diagnostic is not retained and makes no performance claim. Require native and Rust exactness first, then bounded decoder-chain acceptance, representative size/runtime/memory comparisons and protected-byte checks. Snapshot `/tmp/purejsimage-m7-scalar-palette-052-evaluation`; audit `.tmp/jpegxl-m7/pq-cardinality-audit.json`.

JXLMOD-052 initial validation (2026-09-09): Qwantani, pond bridge and abandoned tiled room are exact through libjxl, jxl-rs and the repository decoder. With the existing three-sign context model allowed on six palette/index planes, output sizes are 4,214,162 / 5,226,627 / 4,741,776 bytes, native ratios 1.327709 / 1.188301 / 1.158783. The earlier four-plane context restriction rejected the first six-plane trial before emission; the bounded six-plane tree extension passes independent decoding. An earlier stream was valid in both external decoders but rejected by the repository transform-chain guard; acceptance now covers only local RCT plus one existing transform, or three scalar palettes with optional index RCT. Full resource-boundary and broader corpus tests remain required. All trials were serial; successful three-case job peaked at 442.9 MiB with zero swap. Preserve `.tmp/jpegxl-m7/scalar-palette-052-initial.{patch,json}` and per-case raw reports. This is a compression-search feature, not a speedup, and remains isolated.

JXLMOD-053 (2026-09-09, prepared only): Three of six frozen alpha development artworks have at most 241 distinct colors, so their joint RGBA palette contains fewer than 1,024 samples. The single-group entropy planner merges such a palette with its full index plane and suppresses the gradient candidate. Test independent per-plane predictors and contexts only for the additional gradient candidate, preserving the existing clustered candidate as an actual-byte floor. This revisits 029 with direct evidence from small-palette artwork rather than its unchanged screenshot. The six-image read-only cardinality audit is `.tmp/jpegxl-m7/alpha-palette-cardinality.json`. Snapshot `/tmp/purejsimage-m7-unclustered-gradient-053-evaluation` derives directly from integrated050; no 052 changes combined, no production retention or measurements yet.

JXLMOD-052 broader development validation (2026-09-09): All six derived PQ16 development sources are exact in all three decoders. Native ratios range from 1.113263 to 1.327709, with development median 1.170711; all six are below 1.40. The cleaned candidate keeps the initial three output sizes unchanged, reuses palette indices across the two RCT choices, releases temporary original planes before entropy search, and limits routing changes to sparse RGB16 effort-7 inputs. Seven focused boundary/allocation tests pass, including exact peak admission and one-byte-below cleanup. Six generated boundary/narrow cases pass both external decoders. The correct configured bundle comparison is `.tmp/jpegxl-m7/scalar-palette-052-bundle-cost-configured.json`: specialized 454,966 to 457,235 bytes; public core+codec 399,939 to 402,211. This adds about 1,955 bytes for palette search/header serialization and 317 for bounded decoder-chain acceptance. Earlier codec diagnostics omitted the snapshot tsconfig and are explicitly superseded. Six fresh 12 MP lossy outputs are byte-identical to integrated050 at all frozen distances. No broad final qualification or production retention yet.

JXLMOD-053 development validation (2026-09-09): All six RGBA8 artworks are exact through all three decoders. Tree, flower and pizza shrink from 13,093 / 10,213 / 14,698 bytes to 10,233 / 7,493 / 11,685; guitar, face and robot remain exactly 15,724 / 35,487 / 12,001 bytes. Retain as a promising compression candidate pending combined corpus/budget/browser gates. Extra effort-5/7 search is explicit; this is not a speedup. Raw `.tmp/jpegxl-m7/lossless-expansion-unclustered-053-*/report.json`.

JXLMOD-054 (2026-09-09, prepared): Combine independently tested 052 scalar palettes and 053 separate palette/index contexts in `/tmp/purejsimage-m7-integrated-054-evaluation`. Run all 24 frozen expansion families with their original splits and exact-sample contracts, plus protected encoding/budget/browser checks before production retention. The lossless holdout was already observed and remains regression evidence. No omitted hard cases, changed quality bands or promotion claim.

JXLMOD-051 decision: Three SDR development probes remain independently exact, but size savings are only 0.410%, 0.024% and 0.106%, while single-sample core time increases about 29–32%. These are exploratory timing samples, not a paired performance estimate. Keep the simpler integrated054 path; 051 remains isolated. Raw `.tmp/jpegxl-m7/gradient051-probes/report.json`.

JXLMOD-054 integration: All 24 frozen lossless expansion families pass exact decoding through the repository, libjxl and Rust. Derived PQ16 median/p90/worst native size ratios are 1.170711/1.327709/1.359242; RGBA8 ratios are 1.290606/1.482599/1.588141. HDR targets pass for this observed expansion; alpha still misses. The job peaks at 940.8 MiB with zero swap. All 76 focused integrated tests pass, including nine scalar-palette fixture and budget cases; that job peaks at 614 MiB. Retain 052 and 053 in production, pending final repository/browser gates. Tracked report `production-program/m7-lossless-expansion-integrated054.json`.

Integrated054 bundle responsibility: Same configured before/after builds measure specialized 454966→457254 bytes (+2288) and core+codec 399939→402230 (+2291). Encoder search/header code accounts for 1971/1974 bytes and the decoder chain guard for 317 bytes. Raise explicit ceilings to 460000/405000 to accommodate this independently verified high-depth compression feature; retain historical baselines 255489/233093. This is an explicit feature cost, not a size improvement. Tracked `production-program/m7-integrated054-bundle-cost.json`; full size gate still required.

M7 qualification amendment (2026-09-09): The user approved a 2 MP matrix across all 240 frozen sources plus eight fixed original-size checks. Preserve the source splits, five codecs, six coordinates, both perceptual metrics, missing brackets and failures. The serial 30-point im26-5012 profile takes 47.530 seconds at 362.3 MiB peak RSS; AVIF encoding takes 30.409 seconds. Reduce normalized pixel work by about 82% across the corpus and run at most eight source workers in one 8 GiB, zero-swap process tree with an eight-core quota. A continuous pool replaces waves; failed workers stop further admissions and active workers finish. Cache reuse requires unchanged source, normalized pixels, dimensions, tools and metric policy, plus the encoder fingerprint or fresh byte identity for first-party output. Eighteen focused scheduler, cache, reporting and worker-failure tests pass. The first capped launcher was terminated before completion; retain its failed receipt and 828 saved points. Resume from validated artifacts with a detached launcher and persistent logs. This changes qualification cost and resolution, not codec quality settings. Final matrix receipts and visual review follow; no all-source original-resolution lossy claim.

M7 capped qualification result (2026-09-09): Both frozen 120-source matrices complete with 7,200 measured points and zero measurement failures. Development and holdout peak at 5.3 and 6.4 GiB respectively, with zero swap. All 1,440 first-party points have inline repository-decoder comparisons in addition to independent decoding. At held-out photo SSIMULACRA2 80, all 63 cases bracket both references: own/libjxl median 0.987089 and p90 1.096392; own/JPEG median 0.827836. Other bands retain missing brackets. Eight fixed original-size cases add 32 successful points, with all 16 first-party streams independently checked. All 32 new visual panels were inspected; mild ringing, texture smoothing, tonal patches and flat-color blocks at distance 3 remain documented. Raw capped and original receipts are retained separately. Lossy remains Experimental; original lossless and warm effort-1 promotion misses remain open.

M7 HF context-map repair (2026-09-09): Final runtime replay exposes a valid 12 MP effort-1 stream with 192 histogram sets and 285,120 contexts that native and Rust decode, but the repository rejects at its generic 65,536-context limit. Add an explicit HF allowance capped at 2,027,520 entries; other entropy paths retain the lower limit. Both count and allowance are validated before allocation. No encoder bytes or scored rasters change. Both runtime streams now agree with native/Rust/repository decoding within one level across all 36 million RGB8 samples each, under 480 MiB peak RSS. Thirty-four focused tests pass, including a licensed real-image regression and admission boundaries. Seventy-eight existing browser workflows and the new 12 MP regression in all three browsers pass. All 39 official conformance dispositions match baseline: 13 pass, 25 expected unsupported, one existing delta-palette failure, zero incorrect output. Full handoff check follows; retain the failed and corrected replay receipts in `m7-hf-context-fix.json`.

## Post-M7 encoder target campaign, 2026-09-23

Base revision: `a5f0143bdf0b48e726108ca15099ac4a869fbb0a`. The target is the original 4000x3000 im26-1030 RGB8 effort-1 lossy encode, with the observed 8.085203 warm/native paired gate miss. A fresh warm CPU profile under the M7 3 GiB process guard attributes most samples to XYB filling, AC group filling and DCT8. The seven-run development medians below are isolated warm samples, not paired proof against the original revision. Each run retained the exact encoded SHA-256 `76e8c8b48e231e56fdf58badc6d87449bd48082d54a7477313abe0db5b9f1ad5`. The pinned M7 runtime harness, rather than the generic hillclimb suite, supplies the native comparator and cold/warm contract.

| ID | Hypothesis and path | Warm core median, MAD (ms) | Decision |
| --- | --- | ---: | --- |
| JXLENC-053 | Precompute fixed effort-1 AC inverse scales in `jpegxl-vardct-encode.ts`. | 2003.963, 26.991 vs base 2039.910, 26.141 | Promising; retained in the final stack. |
| JXLENC-054 | Skip per-pixel edge clamps for divisible RGB8 geometry. | 1973.261, 38.692 cumulative | Promising, but the first version exceeded the existing bundle ceiling; compacted before retention. |
| JXLENC-055 | Cache paired DCT input loads in `jpegxl-vardct-forward-transforms.ts`. | 2013.716, 9.351 cumulative | Neutral; reverted. |
| JXLMOD-055 | Compare delta palette with ordinary palette on the development brochure and Noto face. | im26-5032 stayed 827815 bytes; core 9559 to 10240 ms. Noto face stayed 35487 bytes. | Rejected; reverted. |
| JXLMOD-056 | Sort eligible artwork palette by frequency. | Noto face stayed 35487 bytes and retained its prior encoded hash. | Neutral; reverted. |
| JXLENC-056 | Precompute RGB8 XYB matrix contributions. | 2015.220, 30.953 cumulative | Neutral against 054; reverted. |
| JXLENC-057 | Compact AC selection into one checked loop and specialize aligned RGB8 only. | 1998.253, 12.715 cumulative | Retained; the full check passes, but the native warm-time target remains unmet. |

The two lossless probes used previously observed M7 cases as regression evidence. They do not restore unseen holdout status. Raw samples, CPU profiles, guarded-run receipts and test streams are under `.tmp/jpegxl-m7/prompt2-*`. The retained variant has no measured size or quality change on the final 2 MP replays: 720 new streams in each split match their previous byte hashes. The fixed eight original-size checks match all 32 prior points. The original bundle ceilings remain in force. Two independent 21-pair runs against commit 2643604888dc8ad58322a3756d5aade68af066b4 give warm effort-1/native medians 8.067 and 8.142; pooled median 8.069. The 8-times warm target fails despite the smaller isolated development core median. Cold medians are 6.661 and 6.613; the public effort-3 original 12 MP workflow takes 4.504 seconds cold and 4.523 seconds warm. See production-program/m7-prompt2-report.md and m7-prompt2-evidence-index.json for exact raw reports, artifact hashes and target decisions.

## JPEG XL remaining encoder targets, September 23

JXLENC-058 profiles the original 12 MP RGB8 effort-1 workflow and replaces repeated cube-root calls with a bounded interpolated table only for aligned default sRGB input at effort 1. Seven isolated warm samples have a 1773.740 ms core median versus 2039.910 ms before this probe. The changed stream is 1,911,972 bytes. Pinned native and Rust decoders agree with the repository decoder within one RGB8 level; the scored original photograph changes SSIMULACRA2 from 87.006 to 87.037. An initial 21-pair development run gives a 6.969 warm and 5.942 cold core-time ratio against native libjxl. Final timing must use the frozen source revision. A compact shared-kernel version lost most of the speed gain, so the specialized kernel is retained with a measured increase of less than 1 KB in each JPEG XL bundle entry. Raw development results are under `.tmp/jpegxl-m7/prompt3-fastroot-paired-native.json` and `.tmp/jpegxl-m7/prompt3/`.

JXLMOD-057 profiles the observed NOAA lossless p90 boundary and compares two additional valid hybrid integer encodings for the selected effort-7 group plan. The original encoding remains a candidate, so each group can only keep or reduce its byte count. A single global setting saved at most 3,060 bytes; the per-group choice saves 3,239 bytes, from 470,095 to 466,856. The 1.40 limit for this source is 467,018 bytes. Pinned native decoding reproduces every original RGB sample. Representative neighboring cases change from 673,633 to 671,145 bytes for a brochure, 185,200 to 185,183 for a scan, and remain 12,080,871 for a photograph. The NOAA diagnostic core time rises from 9.698 to 12.286 seconds in separate guarded samples; these are observational, not a paired speed claim. Raw output, group choices, and independent decode are under `.tmp/jpegxl-m7/prompt3/noaa-hybrid-selected2.*`. The observed holdout is regression evidence because it has already been inspected.

Transparent artwork probes did not justify a retained change. Alternative palette orders had mixed size effects, separate alpha coding did not win, hybrid integer changes made the representative Noto streams equal or larger, and forcing large-image squeeze raised the face from 35,487 to 58,484 bytes. A broader predictor sampling budget saved only 9 bytes on the NOAA case while slowing its encode. These probes were reverted. Original-resolution brochure evidence shows libjxl's distance-3 streams use a small Modular reference frame followed by a VarDCT frame with patch flags; the first-party distance-3 encoder currently writes one VarDCT frame. The original text size outliers remain until a measured first-party patch implementation closes that difference.


## JPEG XL lossy large-document campaign, September 23

JXLENC-059 starts from the committed `dd59fde0092d163243255de44dcd89ec325b5beb` encoder and the approved M7 2 MP and original-size quality reports. On two development brochures, pinned libjxl distance-3 output grows from 243,762 to 670,599 bytes and from 149,228 to 736,428 bytes when its patch generator is disabled. Its normal streams carry 3,579 and 5,663 patch placements. This control isolates a large part of the coding gap; the normal native streams remain the comparator. A bounded first-party test quantized RGB8 values to multiples of 2, 4, 8 and 16 before Modular coding. Step 4 gave smaller and higher-quality original-size streams on both development brochures and the previously observed table regression. Step 16 damaged Butteraugli on im26-5034 (6.157) and was rejected. Capped neighboring photo, screenshot and other brochure probes did not justify a broad selector.

Retain step-4 Modular as an additional effort-7 search only for sRGB RGB8 images of at least 8 million pixels, distance at least 2, no progressive pass, and at least 80% near-white sampled pixels. Keep it only when it is at least 20% smaller than the existing VarDCT result. If the optional search exceeds `maxWorkingBytes` or `maxOutputBytes`, retain the already encoded VarDCT result. This changes only three distance-3 points in the fixed eight original-size replay: im26-5034 796,979 to 481,225 bytes; im26-5052 883,563 to 409,211; im26-5337 303,942 to 180,010. Both SSIMULACRA2 and Butteraugli improve on all three, and libjxl, jxl-rs and the repository decoder agree exactly on their new pixels. All other 13 fixed original-size streams and scores are byte identical to the prior report. Visual review of same-coordinate native-size text and table crops found no new defect. The observed table is regression evidence, with no unseen generalization claim.

The extra search costs time: isolated public effort-7 distance-3 encodes of those three originals took 23.82, 22.40 and 16.91 seconds, respectively, with managed peaks of 135.3, 135.5 and 120.5 MB and zero live managed bytes after finish. These are single cold diagnostics, not paired speed results. An effort-5 Modular candidate was 6–9% larger while shortening its own isolated core by several seconds; it was not retained because size is the target of this path. A generated 8.4 MP white document selected Modular at 190,234 bytes; under a 100 MB managed budget it returned the prior VarDCT stream at 1,802,249 bytes without an ownership leak. The approved 2 MP matrix cannot enter this search, so its scored artifacts remain unchanged. Raw controls, extra SSIMULACRA2 bracket probes, rejected quantization settings, and selected output hashes are in `production-program/m7-prompt5-diagnostics.json` and `production-program/m7-prompt5-original-size.json`.

Final implementation revision `4c23be521aaad656a56fe8e01258639168fb01ae` passes the full repository check (3,194 tests, three skipped), browser check and focused Chromium selector test. Fresh 21-pair effort-1 core medians against pinned native are 5.608 cold and 6.957 warm; two public effort-3 cold and two warm runs stay under 4.65 seconds for encode and output. Final conformance passes 39 current expected cases; resource and ownership checks pass 24/24. The approved 2 MP matched-quality curves still have missing SSIMULACRA2 brackets, and earlier HDR/alpha visual outliers remain. Lossy stays Experimental. See `production-program/m7-prompt5-report.md` for the target table and evidence boundaries.

## JPEG XL lossy visual-quality campaign, September 23

Base revision: `7845fd1ff37352a6d8cfa8edbdb1def38373c945`. Target: effort-7 distance-3 text/rule ringing, with photo, sunset, monochrome and texture neighbors. The small development fixture set is eight pinned 1024-edge derivatives in `.tmp/jpegxl-m7/diagnostic-fixtures-v1`; it is diagnostic evidence, not the approved 2 MP matrix. Baseline `.tmp/jpegxl-m7/diagnostic-prompt6-base/report.json` has 24/24 measured streams with native, Rust and repository decoder agreement within one RGB8 level. No runtime optimization claim is made from these serial quality runs.

JXLENC-060: Test whether finer AC precision on low-activity blocks at effort 7 and distance above 1 reduces the visible text-edge halos. Change the local block quantizer from 6 to 8 for this scope in `jpegxl-vardct-encode.ts`; keep d1 and other modes unchanged. All 24 outputs pass independent and repository decoding. The four text/map distance-3 streams add 169–245 bytes each without a measurable SSIMULACRA2 or Butteraugli change. Across all eight distance-3 cases, all eight grow by 23–245 bytes; the texture case at distance 2 loses 0.0036 SSIMULACRA2. No supported quality gain, so **rejected and reverted**. Raw candidate `.tmp/jpegxl-m7/diagnostic-prompt6-ac8/report.json`; baseline above. Timings are unpaired serial process times and are not used for a speed verdict.

JXLENC-061: Check whether alternate block transforms cause text-edge ringing by measuring effort-7 sRGB RGB8 distance-2/3 output with only DCT8, retaining the same EPF stage and other settings. All 24 streams pass independent and repository decoding, and all eight distance-1 streams stay byte-identical. At distance 3, SSIMULACRA2 falls by 1.799–4.452 on the four text/map cases and by 0.066–0.429 on the four photo/texture neighbors. Butteraugli worsens on the four text/map cases, with only two tiny neighbor improvements. Text cases can also grow by 796–4,850 bytes. **Rejected and reverted**; alternate transforms are valuable on these examples. Raw `.tmp/jpegxl-m7/diagnostic-prompt6-dct8/report.json` versus the same pinned baseline. These serial runs make no paired timing claim.

JXLENC-062: Give the previously coarse 4-quantizer active blocks the same finer 6 setting as low-activity blocks at effort 7, SDR RGB8, distance above 1. All 24 streams pass independent and repository decoding; d1 remains byte-identical. On the 16 d2/d3 points, SSIMULACRA2 improves in all 16 by 1.079–4.755 on the sampled text/photo/texture classes and Butteraugli improves in all 16 by 0.079–0.746. Every changed stream grows in bytes. At 13 common bracketed development coordinates, ten candidate/baseline matched-size ratios are below one and three are above one; the map Butteraugli-2 point rises 1.43%. This is a promising quality-rate tradeoff, not a stable-size pass. Keep the experiment isolated pending a smaller precision step, original-size checks and visual review. Raw `.tmp/jpegxl-m7/diagnostic-prompt6-ac6/report.json` versus the pinned baseline. Serial timing is not performance evidence.

JXLENC-063: Test a smaller 4-to-5 active-block quantizer step at effort-7 SDR RGB8 distance 2/3, against base `7845fd1` on the same eight development derivatives. All 24 outputs decode independently, and d1 is byte-identical. All 16 changed points improve SSIMULACRA2, 13 improve Butteraugli, and each distance-3 stream grows by 3,463–15,409 bytes. At 17 common bracketed coordinates, nine matched-size ratios improve and the median is 0.99924; the photo Butteraugli-2 coordinate grows 11.9%. **Neutral and reverted** because matched quality is essentially unchanged and the photo regression is material. Raw `.tmp/jpegxl-m7/diagnostic-prompt6-ac5/report.json`. The next step is to inspect the block activity distribution before a narrower edge policy; no paired speed claim from these serial quality runs.

JXLENC-064 (2026-09-23): Test coarser channel-specific DC steps for effort-7 lossy RGBA8 sRGB output on the six frozen transparent development families. The color DC steps change from 1/16384 each to 1/8192, 1/1024 and 1/512. Other efforts, opaque paths and native-depth/HDR signaling retain their old steps. The bounded 3 GiB run reports 144/144 measured points, zero independent-decoder failures, exact alpha, 674.9 MB peak and zero swap. On black and white composites, all 36 common matched-quality ratios against pinned libjxl improve. At Butteraugli 2, development p90 changes from 1.5338 to 1.3096 on black and from 1.5754 to 1.3445 on white. The separately observed six-family holdout also has 144/144 points with exact alpha, 664.1 MB peak and zero swap; all 36 common native-reference ratios improve. Its prior inspection makes this regression evidence, not unseen generalization. At equal distance 3, one development smiley shrinks from 17,345 to 14,540 bytes but loses SSIMULACRA2 and Butteraugli quality, with visible tonal patches. Equal distance is not the quality comparison. Raw `.tmp/jpegxl-m7/alpha-development-prompt6-alpha-dc/` and `.tmp/jpegxl-m7/alpha-holdout-prompt6-alpha-holdout-real/`, with their bounded service logs. Retain the DC change only with the separately measured smoothing check below.

JXLENC-065 (2026-09-23): Enable JPEG XL adaptive LF smoothing for that same effort-7 RGBA8 sRGB scope. In the one-family preliminary check it raises distance-3 SSIMULACRA2 from 82.874 to 83.549 at essentially the same 14.54 KB and Butteraugli 2.712, improving the reviewed tonal patches. The complete bounded development and observed-holdout replays each contain 144/144 measured points with zero failures and exact default alpha; peaks are 548.7 and 562.1 MB with zero swap. Against the pre-change encoder, every one of the 36 common matched-quality native-reference coordinates per split improves. At SSIMULACRA2 90, development black/white median ratios change from 1.1271/1.1063 to 1.1126/1.0938; holdout black/white from 1.1374/1.1426 to 1.0880/1.0987. At Butteraugli 2, development black/white p90 becomes 1.3096/1.3446 and holdout 1.3031/1.3029. SSIMULACRA2 70 remains unbracketed for all six transparent families in each split; SSIMULACRA2 80 has only one development black/white native bracket and no holdout native bracket. Retain as an Experimental alpha compression improvement, with no Stable promotion or runtime speed claim. Raw `.tmp/jpegxl-m7/alpha-development-prompt6-alpha-smooth-development/` and `.tmp/jpegxl-m7/alpha-holdout-prompt6-alpha-smooth-holdout/`; summary reports are preserved with the qualification report. The observed holdout remains regression evidence.

## JPEG XL lossy remaining-gap probes, September 23

Base implementation: `1b7e2df0263612a98ee527ee1e91b5fe408ff4c1`. These bounded probes use the current M7 artifacts and do not alter the approved source splits or six-distance matrix. [Prompt 7 report](jpegxl/production-program/m7-prompt7-report.md) and [evidence index](jpegxl/production-program/m7-prompt7-evidence-index.json) give the measured values, raw paths, input and output hashes, and independent decoding results. No codec candidate was retained.

JXLENC-066: Probe sparse EPF restoration on PQ16 effort-7 HDR at six distances across the six frozen development and six previously observed families. All 72 candidate streams pass native, Rust and repository decoding. Common matched-quality byte positions improve in 43/79 development and 40/76 observed coordinates, but Butteraugli 2 at observed lakeside headroom 4 worsens 3.06%, and own missing brackets increase in both splits. **Rejected and reverted.** The observed split is regression evidence. Raw `.tmp/jpegxl-m7/hdr-{development,holdout}-prompt7-hdr-epf-*/`.

JXLENC-067: Profile low-activity blocks and test 0.6 AC dead zones on small development text/map and photo/texture derivatives. The four text/map distance-3 streams shrink about 2–4%, but SSIMULACRA2 falls 0.26–0.91 and Butteraugli is mixed; a flat-block-only threshold leaves every output unchanged. All changed streams decode independently. **Rejected and reverted.** Raw `.tmp/jpegxl-m7/diagnostic-prompt7-{block-profile,flat-deadzone-060,text-edge-deadzone-060}/`.

JXLENC-068: Test 32 and 192 effort-7 AC entropy clusters against 96 on the eight small development derivatives. Median byte changes are +0.70% and -0.12%, with identical decoded quality and valid independent decodes. **Rejected and reverted.** Raw `.tmp/jpegxl-m7/diagnostic-prompt7-hist{32,192}/`.

JXLMOD-058: On original development brochure im26-5034 at distance 3, a step-16 quantized Modular candidate cuts bytes from 481,225 to 431,604 but worsens Butteraugli from 0.919 to 6.157. Exact lossless alternatives for the two brochures are larger than the current step-4 lossy streams. **Rejected and reverted.** Raw `.tmp/jpegxl-m7/prompt7-public-{baseline,step16,lossless,lossless-5052}/`.

JXLMOD-059: On the same original brochure, 16 match histories with a longer search and a longer hash reduce 481,225 to 460,547 bytes while preserving decoded pixels; luma palette ordering reduces it to 472,847. The best match search takes about 38 seconds in a separate bounded service run versus about 32 seconds for the baseline, so this is not a paired speed comparison. A stronger edge-magnitude context grows the stream. **Rejected and reverted** because the coding gap remains large and the search adds work. Group profiling confirms all 15 large-document groups choose ordinary palettes. The full native comparator frame sequence contains a Modular reference and a VarDCT patch-bearing display frame, consistent with the prior 3,579/5,663-placement control. Raw `.tmp/jpegxl-m7/prompt7-public-{groups2,lz16,lzlong,luma,edgebucket8}/`.

## JPEG XL original-document patch dictionary, September 23

Base implementation: `41bfe3a066602e1cac9a5e0d6b66dc717fe89882`. Pinned libjxl's normal brochure streams contain a small Modular reference and a patch-bearing display frame. Disabling its patch generator expands the two original development brochures from 243,762 to 670,599 bytes and from 149,228 to 736,428 bytes. A bounded component profile finds 3,623 and 5,609 byte-identical repeated glyph placements covering 13.37% and 14.32% of their source pixels. The observed table has 4.88% and does not enter the selector. These measurements support a narrow patch implementation; no third-party encoder code is included.

JXLENC-071: Add a first-party repeated-component atlas and patch dictionary for pale, opaque sRGB RGB8 documents of at least 8 MP at effort 7 and distance at least 2. The existing VarDCT/Modular winner remains available, and the two-frame stream wins only when at least 5% smaller. The two original development brochure probes shrink from 481,225 to 235,497 raw codestream bytes and from 409,211 to 79,273 bytes. SSIMULACRA2 rises 88.500 to 88.985 and 89.884 to 90.638; Butteraugli falls 0.919146 to 0.919080 and 0.396495 to 0.396450. Pinned native and Rust decoders produce identical displayed PPM bytes; patched rectangle pixels match the original input exactly, and the remaining step-4 quantization has at most two RGB8 levels of source error. The observed original table falls back to its byte-identical prior stream. This is regression evidence, not unseen holdout. A 256-pixel repeated-glyph fixture passes native browser parity and a bounded repository decode. The optional search is an effort-7 cost, so no runtime speed improvement is claimed. Raw diagnostics: `.tmp/jpegxl-m7/patch-071-{reference,second,table}.log`; the frozen eight-original replay is recorded in the prompt-8 report.

## JPEG XL lossy screenshot and gradient investigation, September 24

Base implementation: `eccd158206a44e6aea50ffdb16eb15617099dbf8`. The [investigation report](jpegxl/production-program/m7-prompt9-investigation.md) and [probe data](jpegxl/production-program/m7-prompt9-probes.json) preserve source and stream hashes, all diagnostic points, native controls and bounded-run receipts. The approved 2 MP matrix and fixed eight original-size qualification remain unchanged. No codec candidate was retained.

JXLENC-072: Remove residual-based EPF restoration in an isolated diagnostic, using the eight fixed development derivatives at effort 7 and distances 1/2/3. All 24 streams decode with pinned native and Rust within one RGB8 level. Eight photo/gradient streams change; SSIMULACRA2 falls in all eight, Butteraugli worsens in seven, and all four text/map cases remain byte-identical at every distance. **Rejected and reverted.** Raw `.tmp/jpegxl-m7/diagnostic-prompt9-noepf-v2/`; 3 GiB zero-swap receipt `.tmp/jpegxl-m7/bounded-runs/prompt9-noepf-v2.json`.

JXLENC-073: Let an alternate block transform win with any estimated token saving instead of the existing two-token margin. All 24 development streams decode independently within one RGB8 level. Bytes increase on 23 of 24 streams, SSIMULACRA2 improves on 16 and regresses on eight, and Butteraugli worsens on five. **Rejected and reverted.** Raw `.tmp/jpegxl-m7/diagnostic-prompt9-strategy0/`; 3 GiB zero-swap receipt `.tmp/jpegxl-m7/bounded-runs/prompt9-strategy0.json`.

JXLENC-074: Read pinned libjxl's patch and quantization flow and measure screenshot patch contribution before changing the writer. Patches save 9.80% on development screenshot `im26-8444` and 14.39% on the previously observed original screenshot `im26-8160` relative to the pinned native patches-off control. Native uses a Modular reference plus VarDCT display. Its patches-off controls pass native/Rust decoding within one RGB8 level. On the observed original, patch-on/off SSIMULACRA2 is 74.572/73.773 and Butteraugli is 3.732/3.597, so the size saving has a Butteraugli tradeoff. Its observed screenshot has 1,576 replace placements covering 2.55%; 1,380/1,436 repeated placements are byte-identical to their group's first source rectangle. A local flat-background exact matcher finds 1.18% coverage on development and 2.01% on observed screenshot. The current step-4 Modular screenshot is 359,181 bytes before patches versus 71,040 VarDCT bytes, so a Modular extension is not retained. The gradient native frame has only 37 tiny placements. **Profile only; no codec change.** Raw `.tmp/jpegxl-m7/prompt9-*`; source-method notes and hashes are in the report. The observed screenshot is regression evidence, with no unseen generalization claim.

JXLENC-075 (2026-09-24): Add a first-party flat-background screenshot search and a VarDCT reference plus patch-bearing VarDCT display at opaque sRGB RGB8 effort 7, distances 2–4, 0.26–4 MP. A size selector keeps the old stream unless the candidate saves at least 0.5%. This follows the measured patch contribution in 074; the pinned libjxl source informed the search method, and no third-party encoder code is bundled. On the approved 2 MP six-distance grid, only four development and two observed-holdout inputs pass the new region eligibility. Their 12 changed distance-2/3 streams shrink 0.55–16.79% and each raises SSIMULACRA2. Native, Rust and repository decoders agree within one RGB8 level. Butteraugli is unchanged or better in ten changed points and worsens in two distance-3 points, which remain in the results. Rebuilding all 120 complete per-case reports per split reproduces the published baseline exactly before overlaying those points. The development SSIMULACRA2-80 native-reference worst improves 1.6480→1.5018; observed worst 1.4302→1.3942. The 70/80/90 bracket counts do not change, so Stable promotion remains unmet. The previously observed original screenshot at distance 3 shrinks 167,981→154,440 bytes and SSIMULACRA2 rises 79.525→79.967; it is regression evidence. The test and real Chromium browser check pass. This optional effort-7 search costs 4,748 bytes in both the specialized and core-plus-JPEG XL minified entries; explicit ceilings move only to 543,000/455,000. Raw `.tmp/jpegxl-m7/prompt9-*` reports and bounded receipts; a final linked qualification report follows the implementation freeze.
