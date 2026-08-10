# AVIF bounded row output — 2026-08-09

## Scope

This measurement compares commit `6a05e95`'s source-sized RGBA and restoration-output behavior with the bounded row-output change on the same host. It is evidence for the memory refactor, not a package-wide performance claim.

The change:

- converts requested color regions directly from retained YUV state into ordered 32-row RGBA blocks;
- applies straight or premultiplied alpha while producing each block;
- synchronizes compatible aligned filter-free alpha through a second bounded reconstruction ring before block composition;
- composes opaque grids one contributing tile row at a time;
- writes loop-restoration results through three delayed 4-row luma bands while
  retaining only deblocked stripe-boundary rows;
- applies CDEF in place through reusable source windows and delayed 8-row output bands;
- applies the 64 MiB aggregate working-set limit to bounded and full-frame fallback paths; and
- box-filters compatible full-aperture resize input directly from bounded YUV rows.

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
- `benchmark/results/avif-memory-bounded-cdef-bands-2026-08-09.json`
- `benchmark/results/avif-memory-scaling-yuv-resize-2026-08-09.json`

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

## Bounded CDEF and aggregate limits

CDEF now snapshots at most a 12-row luma source window and delays one 8-row
output band instead of cloning every padded YUV plane. Loop restoration retains
only the deblocked rows needed at 64-row stripe boundaries while continuing to
write through delayed 4-row bands. Against the `bounded-context-rings` capture,
the CDEF fixture's median sampled ArrayBuffer delta fell from 3.82 MiB to
3.25 MiB (-14.7%); median wall time moved from 425.198 ms to 445.918 ms
(+4.9%). All three runs reproduced
`b10ee50244d047f22a35e99fb288882ac1a223605c2b62be393a484a06eb0ba0`.
The full-frame compatibility paths and grid tile rows now receive the same
conservative 64 MiB coded-payload plus estimated-working-state check as bounded
single-item decode.

## Source-dimension and direct-YUV resize scaling

Run:

```sh
npm run bench:avif:memory:scaling -- \
  --output benchmark/results/avif-memory-scaling-yuv-resize-2026-08-09.json
```

The scaling probe generates one-tile, lossless, full-range YUV 4:4:4 inputs at
512x384, 1024x768, and 2048x1536. It compares full padded reconstruction and
bounded row reconstruction for both full-size output and 4x box-filtered
downscale. Three isolated cold processes run per mode and dimension. Each full
and bounded pair must reproduce the same independently calculated RGBA SHA-256.

| Source | Full-frame scaled ArrayBuffer delta | Bounded-row scaled ArrayBuffer delta | Full-frame scaled RSS delta | Bounded-row scaled RSS delta |
| --- | ---: | ---: | ---: | ---: |
| 512x384 | 1.45 MiB | 1.13 MiB | 8.18 MiB | 8.18 MiB |
| 1024x768 | 5.78 MiB | 4.41 MiB | 12.18 MiB | 12.18 MiB |
| 2048x1536 | 23.07 MiB | 9.67 MiB | 36.56 MiB | 17.56 MiB |

At 2048x1536, direct bounded-YUV downscale reduced the sampled ArrayBuffer
delta by 58.1%, the RSS delta by 52.0%, and absolute peak RSS by 19.38 MiB
relative to full reconstruction of the same scaled output. Median wall time was
2.7% higher. The full-size 2048x1536 bounded path used a 16.06 MiB median
ArrayBuffer delta versus 34.32 MiB for full reconstruction. The path remains
width-, compressed-payload-, and decoder-state-dependent, and the 80% Lambda
memory-reduction target is not met.

## Correctness gates

- `npx vitest run tests/av1.test.ts tests/av1-post-filter.test.ts tests/avif.test.ts tests/lossy-codec-quality.test.ts`: focused AVIF/AV1 suite passed.
- `npm run fixtures:avif:post-filters`: all five fixtures matched agreeing dav1d/libaom native YUV byte-for-byte.
- Every isolated staged memory run matched its pinned encoded or RGBA checksum.
- All 36 isolated source-scaling runs matched the full-size or independently calculated 4x-scaled RGBA checksum shared by their full-reconstruction and bounded counterparts.
- The bounded alpha fixture matched Sharp/libavif RGBA exactly in Node.js and its pinned portable output in Chromium.

## Remaining memory boundary

Compatible opaque filter-free single-item decode and aligned filter-free alpha
decode are reconstruction- and context-ring-bounded. Their full-aperture 2x,
4x, and 8x downscale paths box-filter YUV before emitting reduced RGBA blocks.
Post-filtered images, rotated-alpha images, and grids retain their documented
full-frame YUV compatibility paths, although CDEF and restoration no longer add
a second full padded YUV frame. Coded item payloads are still materialized
contiguously. The isolated-process RSS signal remains much noisier than
deterministic ArrayBuffer accounting, and the 80% Lambda memory-reduction
target is not met.
