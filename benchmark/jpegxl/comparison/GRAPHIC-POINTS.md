# JPEG XL graphic compression, October 6, 2026

## Quick answer

The current public encoder produces smaller files with better scores on both
SSIMULACRA2 and Butteraugli than all six sampled jSquash and wasm-vips graphic
points selected at targets 70, 80 and 90. This is direct point dominance on the
pinned opaque `im26-5034-diagnostic` graphic. The original missing interpolation
brackets and 13 adequate/11 unresolved totals remain unchanged.

## Current measured points

| PureJsImage distance | Bytes | SSIMULACRA2 | Butteraugli |
| --- | ---: | ---: | ---: |
| 1 | 37,051 | 100 | 0 |
| 8 | 14,055 | 84.39014 | 4.82033 |
| 16 | 12,138 | 70.39877 | 9.86752 |

Distance 1 preserves every original sample. The other two settings quantize
eligible artwork colors while preserving the existing flat-color anchors and
exact alpha. This recheck adds evidence for existing production behavior;
it does not introduce another encoder change.

For each target and peer, select the smallest of its original measured files
that reaches that SSIMULACRA2 target. A current PureJsImage point must then have
no more bytes, no lower SSIMULACRA2, and no higher Butteraugli than that actual
peer point. All three conditions are checked together.

| Target | Peer | Peer bytes | PureJsImage bytes | Smaller by |
| --- | --- | ---: | ---: | ---: |
| 70 | jSquash | 19,997 | 14,055 | 29.71% |
| 80 | jSquash | 25,580 | 14,055 | 45.05% |
| 90 | jSquash | 52,189 | 37,051 | 29.01% |
| 70 | wasm-vips | 28,364 | 14,055 | 50.45% |
| 80 | wasm-vips | 30,254 | 14,055 | 53.54% |
| 90 | wasm-vips | 101,076 | 37,051 | 63.34% |

The first two targets use the score-84.39 point. Target 90 uses the exact point,
whose Butteraugli score is also better. None of these statements interpolates
a missing bracket or claims a universal quality or compression lead.

## Evidence and cost

[Production controls](results/graphic-point-production-controls.json) record
three fresh production encodes, six rehashed frozen peer files and 18 fresh
complete native/Rust grids. All original alpha remains exact, caller storage
stays unchanged, and encoder ownership closes. Both metrics reproduce every
selected frozen peer coordinate exactly. The input samples, original peer
domains, package versions and source identity remain pinned.

The raw producer incorrectly named the generic peer search coordinate
`distance` for jSquash. The publication preserves that raw report, reconstructs
its measured harness to the exact original hash, and records each wrapper's
actual public `quality` or `distance` option. All 55 physical pins are rehashed.
This corrects labels without relabeling measurements as newly run.

The full study takes 15 minutes 28 seconds and peaks at 993.1 MiB process memory
in the bounded service. Individual PureJsImage encodes take about 227, 344 and
343 seconds; managed backing-buffer peaks are about 134 MiB. These are
diagnostic timings. This study makes no speed or memory parity claim.

## Reproduction

With the original inputs and pinned development oracles prepared:

```sh
node benchmark/jpegxl/comparison/verify-graphic-compression.ts .tmp/graphic-compression.json
```

Raw streams, grids and tools remain ignored. The current photo comparison is
recorded separately in [PHOTO-PARITY.md](PHOTO-PARITY.md).
