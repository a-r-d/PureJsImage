# AVIF bounded row output — 2026-08-09

## Scope

This measurement compares commit `6a05e95`'s source-sized RGBA and restoration-output behavior with the bounded row-output change on the same host. It is evidence for the memory refactor, not a package-wide performance claim.

The change:

- converts requested color regions directly from retained YUV state into ordered 32-row RGBA blocks;
- applies straight or premultiplied alpha while producing each block;
- synchronizes compatible aligned filter-free alpha through a second bounded reconstruction ring before block composition;
- composes opaque grids one contributing tile row at a time;
- writes loop-restoration results through three delayed 4-row luma bands instead of a second full padded YUV output; and
- keeps the existing full padded reconstruction planes and one full CDEF source/output pair when CDEF is active.

## Method

Run:

```sh
npm run bench:avif:memory -- --label bounded-row-output \
  --output benchmark/results/avif-memory-row-output-2026-08-09.json
```

`benchmark/avif/run-memory.ts` launches three isolated cold Node.js processes per scenario with `--expose-gc`. Each worker retains the compressed input, performs five GC/event-loop settling turns, then records:

- absolute peak RSS from `process.resourceUsage().maxRSS`;
- sampled RSS, `external`, and `arrayBuffers` after decoder creation and every public output block;
- wall time; and
- an encoded or decoded output checksum.

The deterministic 1024x768 no-filter, deblock, alpha, and 2x2 grid inputs are regenerated with libavif 1.3.0/libaom 3.12.1. Permanent checksum-pinned Kodak and Fox fixtures cover CDEF, restoration, and downscale. Every run must reproduce its expected output SHA-256.

Environment: Node.js 24.16.0, Linux x64, libavif 1.3.0, libaom 3.12.1, dav1d 1.5.1.

Raw runs:

- `benchmark/results/avif-memory-baseline-2026-08-09.json`
- `benchmark/results/avif-memory-row-output-2026-08-09.json`
- `benchmark/results/avif-memory-bounded-context-rings-2026-08-09.json`
- `benchmark/results/avif-memory-bounded-alpha-rings-2026-08-09.json`
- `benchmark/results/avif-memory-scaling-2026-08-09.json`

## Median results

| Scenario | Absolute RSS before | Absolute RSS after | ArrayBuffer delta before | ArrayBuffer delta after | ArrayBuffer change | Wall-time change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| no filters | 112.04 MiB | 108.66 MiB | 11.96 MiB | 8.96 MiB | -25.1% | +1.3% |
| deblock | 113.54 MiB | 110.62 MiB | 11.95 MiB | 8.95 MiB | -25.1% | +13.4% |
| CDEF | 111.91 MiB | 108.59 MiB | 5.78 MiB | 3.82 MiB | -34.0% | +13.2% |
| restoration | 114.58 MiB | 111.65 MiB | 8.73 MiB | 6.78 MiB | -22.3% | +10.6% |
| alpha | 112.34 MiB | 109.50 MiB | 12.20 MiB | 9.20 MiB | -24.6% | +25.8% |
| grid | 113.91 MiB | 111.62 MiB | 9.56 MiB | 9.27 MiB | -3.1% | +22.4% |
| downscale | 115.21 MiB | 118.44 MiB | 7.60 MiB | 6.71 MiB | -11.8% | -0.3% |

The sampled ArrayBuffer high-water delta fell in every scenario. Absolute median RSS fell in six of seven scenarios; the 1-megapixel downscale RSS increased by 3.23 MiB despite a 0.89 MiB ArrayBuffer reduction, so this run does not establish a downscale RSS improvement. Alpha and grid wall time regressed materially and remain optimization targets. No throughput claim is made.

## Filter-free reconstruction follow-up

Compatible opaque, single-item, filter-free frames now keep reconstructed YUV,
prediction, palette, transform, and coefficient contexts in reusable
two-superblock rings. A finalized superblock band is copied before its ring
storage is reused, and RGBA conversion still emits at most 32 rows per public
block. The bounded path rejects the coded payload plus its conservatively
estimated live working state above 64 MiB.

The final `bounded-context-rings` run reduced the 1024x768 no-filter scenario's
median sampled ArrayBuffer delta from 11.96 MiB at the baseline to 6.12 MiB
(-48.8%), and from 8.96 MiB after the row-output-only stage to 6.12 MiB
(-31.7%). Median absolute peak RSS moved from 112.04 MiB to 109.29 MiB
(-2.75 MiB), while median wall time moved from 2565.132 ms to 2647.632 ms
(+3.2%). Each run reproduced
`e158dc7c6e2db7e951e0f9de989c9c16dbc852393c5a60068e508476972d2f42`.
No broader throughput or RSS claim is made.

## Aligned alpha follow-up

When compatible filter-free color and monochrome alpha items have the same
orientation, both now reconstruct through synchronized two-superblock rings.
The `bounded-alpha-rings` run reduced the 1024x768 alpha scenario's median
sampled ArrayBuffer delta from 12.20 MiB to 8.06 MiB (-33.9%) and absolute peak
RSS from 112.34 MiB to 111.80 MiB. Median wall time increased from 3056.267 ms
to 3519.075 ms (+15.1%). All three runs reproduced
`07c6b21f6098eb19a7bb5cb4be6e42b23e7ea40019912e70f3ff194be23c5420`.
Rotated alpha and post-filtered color or alpha items retain the full-frame
compatibility fallback.

## Source-dimension scaling

Run:

```sh
npm run bench:avif:memory:scaling -- \
  --output benchmark/results/avif-memory-scaling-2026-08-09.json
```

The scaling probe generates one-tile, lossless, full-range YUV 4:4:4 inputs at
512x384, 1024x768, and 2048x1536. It compares the same filter-free AV1 payload
through full padded reconstruction and the bounded public decoder, with three
isolated cold processes per mode and dimension. Both modes must reproduce the
same lossless RGBA SHA-256.

| Dimensions | Pixels | Full ArrayBuffer delta | Bounded ArrayBuffer delta | Full RSS delta | Bounded RSS delta |
| --- | ---: | ---: | ---: | ---: | ---: |
| 512x384 | 0.20 M | 2.08 MiB | 1.78 MiB | 7.93 MiB | 7.06 MiB |
| 1024x768 | 0.79 M | 8.59 MiB | 6.12 MiB | 15.68 MiB | 15.31 MiB |
| 2048x1536 | 3.15 M | 34.35 MiB | 14.73 MiB | 50.31 MiB | 20.68 MiB |

From 1024x768 to 2048x1536, pixel count quadrupled. The full path's median
sampled ArrayBuffer delta grew 4.00x and median RSS delta grew 3.21x. The
bounded path grew 2.41x and 1.35x respectively. At 2048x1536, bounded decode
reduced the sampled ArrayBuffer delta by 57.1%, the RSS delta by 58.9%, and
absolute peak RSS by 29.64 MiB relative to full reconstruction; median wall
time was 1.3% higher. The bounded path still scales with compressed payload
copies, width-dependent rings, and remaining decoder state, so this is evidence
of improved—not constant—memory scaling.

## Correctness gates

- `npx vitest run tests/av1.test.ts tests/av1-post-filter.test.ts tests/avif.test.ts tests/lossy-codec-quality.test.ts`: 81/81 passed.
- `npm run fixtures:avif:post-filters`: all five fixtures matched agreeing dav1d/libaom native YUV byte-for-byte.
- All 84 isolated scenario runs across the four staged memory captures matched their pinned encoded or RGBA checksum.
- All 18 isolated scaling runs matched the lossless RGBA checksum shared by their full-reconstruction and bounded counterparts.
- The bounded alpha fixture matched Sharp/libavif RGBA exactly in Node.js and its pinned portable output in Chromium.

## Remaining memory boundary

Compatible opaque filter-free single-item decode and aligned filter-free alpha
decode are reconstruction- and context-ring-bounded. Post-filtered images,
rotated-alpha images, and grids retain their documented full-frame YUV fallback;
CDEF retains an additional padded YUV source/output frame. Coded item payloads
are still materialized contiguously. Resize still consumes RGBA blocks rather than YUV
rows. The isolated-process RSS signal remains much noisier than the deterministic
ArrayBuffer accounting, and the 80% Lambda memory-reduction target is not met.
