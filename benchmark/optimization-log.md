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
- Current baseline: `932270e` (`small jpeg optimization`), the retained IDCT
  typed-array change in `src/codecs/jpeg-baseline.ts`.
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
| JPEG-007 | 2026-08-17 00:36 | Add marker-safe buffered entropy lookahead and 8-bit-prefix Huffman tables in `src/codecs/jpeg-baseline.ts` and `src/codecs/jpeg-source.ts`. | 3350.26 → 2911.43 | -13.10% | -13.09% | -1.03% | accepted | Retained in the working tree; exact output and protected metrics matched. |

Measurement artifacts:

- JPEG-001: `.tmp/hillclimb/2026-08-16T22-41-31-478Z/comparison.md`
- JPEG-002: `.tmp/hillclimb/2026-08-16T23-49-48-970Z/comparison.md`
- JPEG-003: `.tmp/hillclimb/2026-08-16T23-52-34-648Z/comparison.md`
- JPEG-004: `.tmp/hillclimb/2026-08-16T23-56-20-601Z/comparison.md`
- JPEG-005: `.tmp/hillclimb/2026-08-17T00-10-26-156Z/comparison.md`
- JPEG-006: `.tmp/hillclimb/2026-08-17T00-24-28-306Z/comparison.md`
- JPEG-007: `.tmp/hillclimb/2026-08-17T00-36-30-485Z/comparison.md`

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

Measurement artifacts:

- WEBP-000: `.tmp/hillclimb/2026-08-17T01-21-53-187Z/comparison.md`
- WEBP-001: `.tmp/hillclimb/2026-08-17T01-25-34-767Z/comparison.md`
- WEBP-002: `.tmp/hillclimb/2026-08-17T01-30-20-291Z/comparison.md`
- WEBP-003: `.tmp/hillclimb/2026-08-17T01-36-23-174Z/comparison.md`
- WEBP-004: `.tmp/hillclimb/2026-08-17T01-39-45-067Z/comparison.md`
- WEBP-005: `.tmp/hillclimb/2026-08-17T01-44-35-970Z/comparison.md`
- WEBP-006: `.tmp/hillclimb/2026-08-17T01-48-03-807Z/comparison.md`

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
`convertVp8Rows` in the WebP VP8 decode path. The retained change removes
repeated row-base and chroma-index work without adding a working-set buffer;
future decoder work should preserve that memory boundary and resolve the
known lossy pressure-fixture mismatch before using that fixture as a gate.

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
