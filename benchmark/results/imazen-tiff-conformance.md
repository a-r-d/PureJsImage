# Imazen TIFF conformance baseline

This baseline validates complete decode, in-memory PNG encode, PNG reopen, dimensions, and process robustness. It does not claim exact pixel parity or full standards compliance.

## Summary

| Outcome | Count |
| --- | ---: |
| pass | 147 |
| unsupported | 3 |
| decode-failure | 0 |
| invalid-output | 0 |
| rejected-safely | 4 |
| accepted | 0 |
| raw-exception | 0 |
| timeout | 0 |
| process-crash | 0 |
| out-of-memory | 0 |

## Results by upstream category or feature

| Category | Total | Outcomes |
| --- | ---: | --- |
| edge-cases/compression-webp | 1 | pass: 1 |
| edge-cases/general | 4 | pass: 3, unsupported: 1 |
| robustness/compression-lzw | 1 | rejected-safely: 1 |
| robustness/general | 3 | rejected-safely: 3 |
| valid/bigtiff | 3 | pass: 3 |
| valid/compression-ccitt-group3 | 4 | pass: 4 |
| valid/compression-ccitt-group4 | 3 | pass: 3 |
| valid/compression-deflate | 1 | pass: 1 |
| valid/compression-jpeg | 5 | pass: 5 |
| valid/compression-lzw | 9 | pass: 9 |
| valid/compression-old-jpeg | 3 | pass: 3 |
| valid/compression-packbits | 2 | pass: 2 |
| valid/compression-webp | 1 | pass: 1 |
| valid/compression-zstd | 1 | unsupported: 1 |
| valid/floating-point | 9 | pass: 9 |
| valid/general | 63 | pass: 62, unsupported: 1 |
| valid/photometric-cmyk | 8 | pass: 8 |
| valid/photometric-logluv | 3 | pass: 3 |
| valid/photometric-palette | 7 | pass: 7 |
| valid/photometric-ycbcr | 1 | pass: 1 |
| valid/planar | 10 | pass: 10 |
| valid/predictor | 6 | pass: 6 |
| valid/tiled | 6 | pass: 6 |

## Crashes, timeouts, raw exceptions, invalid output, and memory failures

None.

## Unsupported features by error code

| Error code | Count | Files |
| --- | ---: | --- |
| UNSUPPORTED_OPERATION | 3 | `tiff-conformance/edge-cases/geo-5b.tif`<br>`tiff-conformance/valid/int16_zstd.tif`<br>`tiff-conformance/valid/text.tif` |

## Decode failures by likely root cause

None.

## Reproduction

- PureJsImage commit: `16e662c03a6a2de62ddfa721145e240aaadf3b80-dirty`
- codec-corpus commit: `28205bbc5cf40364d012c462240ba28143373d67`
- Node/platform: `v24.16.0` on `linux-x64`
- Command: `npm run corpus:imazen -- --corpus ../codec-corpus --format tiff --output benchmark/results --timeout-ms 30000 --memory-mb 512 --concurrency 2`

## Prioritized punch list

1. Confirm the public unsupported boundary for 3 valid input(s) before considering feature work.
