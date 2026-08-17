# Optimization attempt log

This is the durable, checked-in history of performance experiments. The raw
seven-pair measurements remain under `.tmp/hillclimb/`; this file records the
hypothesis, evidence, result, and disposition so a later campaign does not
repeat a dead end without new evidence.

## Current state

- Primary workload: `northstar-photo-pipeline` — 6000x4000 JPEG, center crop
  5334x4000, resize 1200x900, JPEG 80. Goal is end-to-end speed versus Sharp
  (official 2882 vs 439 ms).
- Old-Faithful is 4:4:4 YCbCr with ICC. The crop origin `x=333` blocked every
  scaled-IDCT denominator, so the decoder rebuilt the full crop at scale 1.
- Retained `JPEG-024`: snap an unaligned crop to a containing aligned box so
  scale 4 can run. Hillclimb rejected the bitstream hash / +0.45% outputBytes,
  which is expected. Official pixel samples stayed inside tolerance 8.
- Retained `JPEG-025`: skip unused AC store/extend after the last zigzag the
  reduced IDCT reads (zz 4 at scale 4). Exact northstar bitstream hash and
  pinned scaled-fixture hashes matched.
- Retained `JPEG-026`: fuse leftover-AC Huffman `skipBits` on the 8-bit prefix
  path. Incremental ~2.4% on top of JPEG-025.
- Retained `JPEG-027`: unroll the scale-4 2x2 IDCT. 15-trial median 1167 → 856 ms
  versus JPEG-024 HEAD (−26.69%). Candidate MAD 2.54 ms; exact hash.
- Retained `JPEG-028`: stop entropy restart indexing once the next restart MCU
  is past the crop target. Old-Faithful DRI=750, target MCU ~40, so the
  previous 17 MiB scan returned after the first RST. Incremental ~856 → 832 ms.
- Rejected `JPEG-029` closures: per-block `tryFill`/`skip` closures in
  `JpegEntropyReader.skipRemainingAc` slowed northstar 832 → 929 ms.
- Retained `JPEG-029`: same reader-local leftover-AC skip, fully inlined.
  1149 → 802 ms versus JPEG-024 HEAD (−30.21%).
- Neighbor `jpeg-resize-1200` on the full stack: exact hash, 703 → 714 ms
  (+1.57%, below the 5% reject). Scale 2 keeps most AC, so leftover skip is small.
- Neighbor `jpeg-crop-resize` on the full stack: exact hash, 727 → 629 ms
  (−13.50%). Scale 2 last zz=24 plus early entropy-index return.
- Validation (JPEG-025–029b): Imazen JPEG 254/254 matches the published
  baseline (39 pass, 2 unsupported, 167 rejected-safely, 46 accepted, 0
  failures). `npm run fixtures:jpeg`, `browser:check`, typecheck, and 1587
  tests passed. Core API stayed 60.0 KiB.
- Rejected `JPEG-030`: specialized `decodeBlockScale4`/`decodeBlockDcOnly`.
  1164 → 804 ms versus HEAD, indistinguishable from JPEG-029b's 802 ms.

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
