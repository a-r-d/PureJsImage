# HDR Surgery validation and benchmark, 2026-08-31

## Environment

- PureJsImage branch: `codex/hdr-surgery`
- starting revision: `e183ef9532e706f7975ff3c75abecfbc00c5ba09`
- Node.js: `v24.16.0`
- fixture registry: `benchmark/hdr-surgery/fixture-manifest.json`
- benchmark command: `npm run bench:hdr-surgery`
- measurement time: `2026-08-31T04:18:52.680Z`
- process model: one isolated Node.js process per workload

Times and RSS values are one validation run on this machine. The transformed-render time is the
median of three isolated runs. These values are implementation evidence, not general performance
promises.

## Selected results

| Workload | Wall time | First adapted block | Absolute peak RSS | Source bytes | Output bytes | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Inspect 24 MP JPEG | 6.28 ms | n/a | 117,817,344 | 32,776 | 0 | 6,000 by 4,000; zero decoded pixels |
| Render 12 MP at 1x | 2,894.65 ms | 53.88 ms | 148,721,664 | 650,271 | 144,000,000 | maximum linear value 1.000000 |
| Render 12 MP at 2x | 2,839.30 ms | 52.06 ms | 147,120,128 | 650,271 | 144,000,000 | maximum linear value 2.015625 |
| Render 12 MP at 8x | 2,890.58 ms | 55.48 ms | 144,846,848 | 650,271 | 144,000,000 | maximum linear value 8.109375 |
| Flip and render 24 MP | 9,191.39 ms | 2,433.80 ms | 324,534,272 | 1,290,820 | 288,000,000 | measured bounded Float32 blocks |
| Crop and resize 24 MP | 1,468.93 ms | n/a | 286,859,264 | 1,290,820 | 391,539 | explicit full-frame transform fallback |
| Quarter-turn and resize 24 MP | 2,613.72 ms | n/a | 285,315,072 | 1,290,820 | 382,310 | explicit full-frame transform fallback |
| JPEG re-encode | 36.66 ms | n/a | 120,516,608 | 8,567 | 9,703 | deterministic dual JPEG |
| Bit-preserving repack | 13.81 ms | n/a | 118,403,072 | 8,567 | 8,567 | zero decoded pixels |
| AVIF generic selected-boost decode | 267.61 ms | n/a | 129,286,144 | 122,961 | 1,440,000 | exact ISO model selected |
| Constrained gain-map AVIF encode | 43.51 ms | n/a | 120,840,192 | 8,567 | 3,378 | inspector and decoder pass |

The 24 MP inspection used six reads and touched 32,772 unique bytes from the 1,169,698-byte source.
It did not entropy-decode either JPEG and did not use a full-frame fallback. The transformed render
used six reads, requested 1,290,820 bytes, and touched all 1,169,698 unique source bytes.

## Measured materialization accounting

These values come from the live `HdrMaterializationBudget` tracker. They are not calculated from
expected array sizes.

| Workload | Tracker peak | Retained after completion | Largest Float32 output block | Encoded artifact peak | Full adapted Float32 image |
| --- | ---: | ---: | ---: | ---: | --- |
| Flip and render 24 MP | 145,500,000 | 73,500,000 | 2,304,000 | 0 | no |
| Crop and resize 24 MP | 109,500,000 | 3,307,500 | 0 | 1,173,364 | no |
| Quarter-turn and resize 24 MP | 145,500,000 | 2,940,000 | 0 | 1,145,677 | no |
| JPEG re-encode | 204,256 | 176,400 | 0 | 27,856 | no |
| Gain-map AVIF encode | 183,312 | 7,056 | 0 | 6,756 | no |

Each retained value equals the final base and gain-map raster bytes. Render blocks, aligned maps,
encoded chunks, assembly staging, and final-copy reservations returned to zero. Focused tests also
cover smaller later operation limits, final allocation and copy failures, encoder abort, cancellation,
early iterator return, double release, and repeated rendering and encoding.

The transformed 24 MP linear output SHA-256 is
`5b3a267cc3cd8b6c03b8d0d2ff362ca9bd56c74c13a9b722db7271b4bfcbda61`.

## Gain-map density

| Case | Source base pixels | Source map pixels | Output base pixels | Output map pixels | Density ratio | Dimensions |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Co-prime crop | 59,653 | 3,634 | 58,645 | 3,634 | 1.017188 | 317 by 185; map 79 by 46 |
| 1,200 by 675 resize | 57,600 | 3,600 | 810,000 | 50,700 | 1.001481 | map 300 by 169 |

The planner tests floor, round, and ceiling candidates around the source-density ideal. It keeps the
candidate with the smallest normalized density error that also passes the one-map-pixel aspect
compatibility rule. The co-prime crop no longer expands the map to 317 by 185.

## Output and evidence hashes

- bit-preserving repack:
  `d43c5d798e86266c0cd96664bb028675651101db203dc0fbf5dcb8fe81c7e788`, equal to the source fixture
- JPEG re-encode:
  `66bf95af7f2a119f99246a8cfa5c9fb25649efe6267498c50bac8ecde81d6960`
- constrained gain-map AVIF:
  `ac56d98d5e2606cf65f2a725c57dfe3a0ed3f301697dcba34e50bbfa99713e3c`
- evidence off, summary, and trace:
  `a2ce6049ea8749b1e245345e6ea43a76e4ecf0cf63710c79c1680650175b06a6`

Evidence-off, summary, and trace wall times were 46.95 ms, 49.01 ms, and 48.73 ms. This run does not
claim a stable overhead percentage.

## Independent oracles

The development-only oracle command used:

- google/libultrahdr v2.0.0 at commit
  `b2aacb366e1542cfc29605cb0d8a0ebd06bb07f8`
- ICC iccDEV v2.3.2.3 at commit
  `9f1707e2c42ca7d286fea3dfdf8c08c27d7e43cf`
- Little CMS 2.16
- libavif v1.3.0 at commit `1aadfad932c98c069a1204261b1856f81f3bc199`
- avifgainmaputil 1.3.0 with libaom 3.12.1 and dav1d 1.5.1

iccDEV reported both the standalone and JPEG-embedded profiles valid for ICC version 4.30. Little
CMS opened both profiles, transformed representative sRGB values to XYZ, and returned the mixed
sample `64, 128, 192` within 0.02 encoded units per channel. The profile ID is
`3b1a5e27decd22cd7e4cf5e72976be35`. Its SHA-256 is
`3101ea6d31a871d6611a7fd840aee348c654d46705603d1f2b78aa6f56d2d881`.

libultrahdr accepted the generated dual-metadata JPEG. Its linear RGBA16F decode agreed with the
analytic fixture at maximum absolute error 0.017571 and RMSE 0.001608. The gate allows maximum error
0.08 and RMSE 0.012 for the independent JPEG decoders and half-float output.

avifgainmaputil parsed the 3,355-byte generated AVIF and wrote a 4,103-byte tone-mapped PNG. A tiny
probe compiled against pinned libavif reported `base=1/13/1/full` and `gain=2/2/1/full` for color
primaries, transfer characteristics, matrix coefficients, and range.

## Fixture hashes

- dual JPEG: `d43c5d798e86266c0cd96664bb028675651101db203dc0fbf5dcb8fe81c7e788`
- XMP JPEG: `127a7f2f11d3952354b13a20243ae524ee125cedfd82bd60ae234342cfd06d58`
- ISO JPEG: `f515893c8e09f29a40c8b8193150bd0c05b021b4b012624e2312170034d8f24b`
- RGB progressive JPEG: `2b58e9994df3dd4435911a8d2010f2d012ed470ee96854f7d788ed052f433563`
- odd-scale JPEG: `b34a312dceb37f890ceafc018d20fbe4575a73862bfa03d3cd0b59afd7da886d`
- 12 MP JPEG: `9bb03097800c6403f0c836ec7c5e0e5b6d2666700e6c3bf86e883ffc15435b72`
- 24 MP JPEG: `0662cee228c2d3cd93fb4877c7a69e5dcf863a74bff3193c10a76ae70cbb3d00`
- HDR-base AVIF: `9bf9c6a7606951de07e4079cd63c2cfe379d95139cd99ab9142d8a6ee22d28c7`

## Memory boundary

Untransformed JPEG and AVIF selected-boost rendering remains a bounded-row path. Paired transforms
retain one 8-bit base raster and one smaller encoded map raster. Transformed rendering adds an
aligned map when needed and two bounded Float32 row blocks. JPEG and AVIF encoders retain compressed
artifacts under the same aggregate ledger. A complete source-sized adapted Float32 image is never
allocated.
