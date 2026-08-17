# Optimization attempt log

This is the durable, checked-in history of performance experiments. The raw
seven-pair measurements remain under `.tmp/hillclimb/`; this file records the
hypothesis, evidence, result, and disposition so a later campaign does not
repeat a dead end without new evidence.

## Current state

- Primary workload: `northstar-photo-pipeline` — 6000x4000 JPEG, center crop,
  resize to 1200x900, JPEG quality 80.
- Goal: end-to-end speed. The default material threshold is 3% speed or 5%
  peak-RSS improvement, with correctness and protected metrics unchanged.
- Current baseline: `4496dff` (`perf(jpeg): accelerate entropy Huffman decoding`),
  retaining the IDCT change from `932270e`, the marker-safe entropy and
  8-bit-prefix Huffman changes from `JPEG-007`, and the unrolled IDCT kernel
  retained by `JPEG-019`.
- All measurements below passed support, correctness, operation-signature,
  environment, fixture, and protected-output checks. `outputBytes` stayed at
  zero percent delta in every comparison.
- CPU samples in `.tmp/cpu-northstar-2/` put `inverseDct`, `decodeHuffman`,
  `applyRgbIcc`, `decodeBaselineJpeg`, `renderYcbcrRows`, and `resizedBlocks`
  among the sampled hot functions. The next useful experiment should remove
  meaningful work or fuse stages, rather than repeat accessor aliases.

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

The selected workload is `webp-large-resize-jpeg`: a 1600x2000 lossy WebP
decoded, resized to 800x1000, and encoded as JPEG quality 80. It is the
decode-heavy WebP workload admitted by the existing `web-codecs` hillclimb
profile. The 4000x3000 lossy pressure decode was used for additional CPU
profiling.

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

Measurement artifacts:

- WEBP-000: `.tmp/hillclimb/2026-08-17T01-21-53-187Z/comparison.md`
- WEBP-001: `.tmp/hillclimb/2026-08-17T01-25-34-767Z/comparison.md`
- WEBP-002: `.tmp/hillclimb/2026-08-17T01-30-20-291Z/comparison.md`
- WEBP-003: `.tmp/hillclimb/2026-08-17T01-36-23-174Z/comparison.md`
- WEBP-004: `.tmp/hillclimb/2026-08-17T01-39-45-067Z/comparison.md`
- WEBP-005: `.tmp/hillclimb/2026-08-17T01-44-35-970Z/comparison.md`
- WEBP-006: `.tmp/hillclimb/2026-08-17T01-48-03-807Z/comparison.md`
- WEBP-007: `.tmp/hillclimb/2026-08-17T02-29-22-647Z/comparison.md`
- WEBP-008: `.tmp/hillclimb/2026-08-17T02-38-09-800Z/comparison.md`

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
