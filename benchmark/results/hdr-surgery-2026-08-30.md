# HDR Surgery validation and benchmark, 2026-08-30

## Environment

- PureJsImage branch: `codex/hdr-surgery`
- starting revision: `c840f92e43e6c71ab63acc160009330034c331fe`
- Node.js: `v24.16.0`
- fixture registry: `benchmark/hdr-surgery/fixture-manifest.json`
- benchmark command: `npm run bench:hdr-surgery`
- process model: one isolated Node.js process per workload

Times and RSS values are one validation run. They are evidence for this implementation and machine,
not general performance promises.

## Selected results

| Workload | Wall time | Absolute peak RSS | Source bytes | Output bytes | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Inspect 24 MP JPEG | 5.73 ms | 116,293,632 | 32,776 | 0 | 6,000 by 4,000; zero decoded pixels |
| Render 12 MP at 1x | 2,964.06 ms | 191,520,768 | 650,271 | 144,000,000 | maximum linear value 1.000000 |
| Render 12 MP at 2x | 2,804.69 ms | 192,622,592 | 650,271 | 144,000,000 | maximum linear value 2.015625 |
| Render 12 MP at 8x | 2,811.45 ms | 191,901,696 | 650,271 | 144,000,000 | maximum linear value 8.109375 |
| Crop and resize 24 MP | 1,396.92 ms | 288,157,696 | 1,290,820 | 390,937 | explicit full-frame fallback |
| Quarter-turn and resize 24 MP | 2,627.40 ms | 283,418,624 | 1,290,820 | 381,708 | explicit full-frame fallback |
| JPEG re-encode | 33.74 ms | 120,614,912 | 8,567 | 9,101 | deterministic dual JPEG |
| Bit-preserving repack | 13.52 ms | 117,338,112 | 8,567 | 8,567 | zero decoded pixels |
| AVIF generic selected-boost decode | 252.56 ms | 129,294,336 | 122,961 | 1,440,000 | exact ISO model selected |
| Constrained gain-map AVIF encode | 41.80 ms | 121,368,576 | 8,567 | 3,378 | inspector and decoder pass |

The 24 MP inspection touched 32,772 unique bytes in six reads from a 1,169,698-byte source. It did
not entropy-decode either JPEG and did not use a full-frame fallback.

The bit-preserving repack output SHA-256 is
`1485792c7ef0327902c44796713074ca1672abb02c9d55294300244760e0281d`, equal to the source fixture.
The copied primary and gain-map child codestreams are byte exact.

Evidence off, summary, and trace produced the same maximum-linear output hash
`a2ce6049ea8749b1e245345e6ea43a76e4ecf0cf63710c79c1680650175b06a6`. Their observed wall times
were 46.39 ms, 47.41 ms, and 47.29 ms. This single run does not claim a stable overhead percentage.

## Independent oracles

`PUREJSIMAGE_LIBULTRAHDR_APP=<pinned-v2-binary> npm run fixtures:hdr-surgery:oracles` used:

- google/libultrahdr v2.0.0 at commit
  `b2aacb366e1542cfc29605cb0d8a0ebd06bb07f8`;
- `avifgainmaputil` 1.3.0 with libaom 3.12.1 and dav1d 1.5.1.

libultrahdr accepted the generated dual-metadata JPEG and reported matching gain-map fields. Its
linear RGBA16F decode of the analytic constant-map fixture agreed with PureJsImage at maximum
absolute error 0.017571 and RMSE 0.001608. The gate permits maximum error 0.08 and RMSE 0.012 to
cover the independent JPEG decoders and half-float output.

`avifgainmaputil printmetadata` accepted the generated gain-map AVIF and reported the exact base
headroom, alternate headroom, minimum, maximum, offsets, gamma, and base-color-space flag.
`avifgainmaputil tonemap --headroom 3` produced a valid PNG.

## Memory boundary

Untransformed JPEG and AVIF selected-boost rendering remains a bounded-row path. The paired
transform and re-encode workloads are an explicit full-frame fallback with a caller-controlled
`maxMaterializedBytes` limit. The 24 MP transform workloads report a maximum managed raster of
72,000,000 bytes and do not retain a source-sized decoded RGBA pair.
