# Imazen PNG conformance baseline

This baseline validates complete decode, in-memory PNG encode, PNG reopen, dimensions, and process robustness. It does not claim exact pixel parity or full standards compliance.

## Summary

| Outcome | Count |
| --- | ---: |
| pass | 162 |
| unsupported | 0 |
| decode-failure | 0 |
| invalid-output | 0 |
| rejected-safely | 14 |
| accepted | 0 |
| raw-exception | 0 |
| timeout | 0 |
| process-crash | 0 |
| out-of-memory | 0 |

## Results by upstream category or feature

| Category | Total | Outcomes |
| --- | ---: | --- |
| invalid/ascii_transfer_cr | 1 | rejected-safely: 1 |
| invalid/ascii_transfer_lf | 1 | rejected-safely: 1 |
| invalid/checksum_error | 1 | rejected-safely: 1 |
| invalid/ihdr_checksum | 1 | rejected-safely: 1 |
| invalid/invalid_bit_depth | 3 | rejected-safely: 3 |
| invalid/invalid_color_type | 2 | rejected-safely: 2 |
| invalid/invalid_signature | 4 | rejected-safely: 4 |
| invalid/missing_idat | 1 | rejected-safely: 1 |
| valid/ancillary-chunks | 14 | pass: 14 |
| valid/background-information | 8 | pass: 8 |
| valid/basic-color-types-and-bit-depths | 15 | pass: 15 |
| valid/chunk-ordering-and-idat | 8 | pass: 8 |
| valid/filtering | 11 | pass: 11 |
| valid/gamma-and-color-information | 26 | pass: 26 |
| valid/image-dimensions-and-interlacing | 36 | pass: 36 |
| valid/interlacing | 15 | pass: 15 |
| valid/palettes | 6 | pass: 6 |
| valid/physical-dimensions | 4 | pass: 4 |
| valid/suite-overview | 1 | pass: 1 |
| valid/transparency | 14 | pass: 14 |
| valid/zlib-compression | 4 | pass: 4 |

## Crashes, timeouts, raw exceptions, invalid output, and memory failures

None.

## Unsupported features by error code

None.

## Decode failures by likely root cause

None.

## Reproduction

- PureJsImage commit: `e7a6044e5967c1ed1ea127c45fd7f415a03ba4a9`
- codec-corpus commit: `28205bbc5cf40364d012c462240ba28143373d67`
- Node/platform: `v24.16.0` on `linux-x64`
- Command: `npm run corpus:imazen -- --corpus ../codec-corpus --format png --output benchmark/results --timeout-ms 30000 --memory-mb 512 --concurrency 2`

## Prioritized punch list

1. Add independent pixel-oracle comparison before making exact-correctness claims.
