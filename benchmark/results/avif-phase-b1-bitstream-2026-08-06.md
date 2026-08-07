# AVIF Phase B1 bitstream compatibility

Recorded August 6, 2026 on Node.js 24.16.0 and an Intel Core i7-10700.

## Scope

This milestone validates first-party, dependency-free AVIF item extraction and
AV1 sequence inspection. It does not decode entropy-coded tiles or reconstruct
pixels.

The parser handles:

- version 0-2 `iloc` tables with bounded 32-bit or 64-bit fields;
- absolute file extents and `idat`-relative extents;
- payloads split across multiple extents;
- direct AV1 primary items, grid tile references, and alpha auxiliary items;
- AV1 low-overhead OBU headers, 32-bit LEB128 sizes, and sequence headers; and
- profile, level, tier, bit depth, monochrome, chroma, color, feature, and
  operating-point fields needed by the decoder.

## Result

Command:

```sh
/usr/bin/time -v npm run bench:avif:inspect
```

| Measurement | Result |
| --- | ---: |
| Files inspected | 25/25 |
| Unique AV1-coded items | 35 |
| Grid inputs | 1 |
| Alpha-bearing inputs | 6 |
| Aggregate wall time | 0.22 s |
| Aggregate peak RSS | 83,880 KiB (81.9 MiB) |

The corpus includes ordinary `mdat`, `idat`, progressive multi-extent item
storage, 8/10/12-bit streams, 4:0:0/4:2:0/4:2:2/4:4:4 chroma, alpha, and a
five-tile grid.

Three older libavif 4:2:2 fixtures advertise 4:4:4 in their `av1C` records.
Their AV1 sequence headers correctly identify 4:2:2. PureJsImage reports the
configuration mismatch but continues using the sequence header as the decoder
truth. This is intentional compatibility behavior, not a failed inspection.

## Next decoder boundary

Phase B2 starts the restricted 8-bit Main Profile 4:2:0 still decoder: frame
header syntax, tile layout, symbol decoding, intra prediction, inverse
transforms, and bounded YUV reconstruction. The first pixel milestone will be
measured separately for correctness, wall time, and peak RSS.
