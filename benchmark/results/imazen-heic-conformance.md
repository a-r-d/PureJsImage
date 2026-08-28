# Imazen HEIC conformance baseline

This baseline validates complete decode, in-memory PNG encode, PNG reopen, dimensions, and process robustness. It does not claim exact pixel parity or full standards compliance.

## Summary

| Outcome | Count |
| --- | ---: |
| pass | 129 |
| unsupported | 25 |
| decode-failure | 0 |
| invalid-output | 0 |
| rejected-safely | 12 |
| accepted | 1 |
| raw-exception | 0 |
| timeout | 0 |
| process-crash | 0 |
| out-of-memory | 0 |

## Results by upstream category or feature

| Category | Total | Outcomes |
| --- | ---: | --- |
| edge-cases/edge-cases | 5 | rejected-safely: 5 |
| invalid/invalid | 8 | rejected-safely: 7, accepted: 1 |
| valid/device-exif | 4 | pass: 4 |
| valid/libheif-examples | 2 | pass: 1, unsupported: 1 |
| valid/nokia-alpha | 2 | pass: 2 |
| valid/nokia-grid | 5 | pass: 5 |
| valid/nokia-miaf | 7 | pass: 4, unsupported: 3 |
| valid/nokia-multilayer | 5 | pass: 1, unsupported: 4 |
| valid/nokia-sequence | 10 | unsupported: 10 |
| valid/nokia-still | 34 | pass: 29, unsupported: 5 |
| valid/uncompressed | 85 | pass: 83, unsupported: 2 |

## Crashes, timeouts, raw exceptions, invalid output, and memory failures

None.

## Unsupported features by error code

| Error code | Count | Files |
| --- | ---: | --- |
| UNSUPPORTED_OPERATION | 25 | `heic-conformance/valid/libheif-testdata/lightning_mini.heif`<br>`heic-conformance/valid/libheif-testdata/rgb_generic_compressed_brotli.heif`<br>`heic-conformance/valid/libheif-testdata/rgb_generic_compressed_zlib_rows.heif`<br>`heic-conformance/valid/nokia-conformance/C001.heic`<br>`heic-conformance/valid/nokia-conformance/C026.heic`<br>`heic-conformance/valid/nokia-conformance/C027.heic`<br>`heic-conformance/valid/nokia-conformance/C028.heic`<br>`heic-conformance/valid/nokia-conformance/C029.heic`<br>`heic-conformance/valid/nokia-conformance/C030.heic`<br>`heic-conformance/valid/nokia-conformance/C031.heic`<br>`heic-conformance/valid/nokia-conformance/C032.heic`<br>`heic-conformance/valid/nokia-conformance/C036.heic`<br>`heic-conformance/valid/nokia-conformance/C037.heic`<br>`heic-conformance/valid/nokia-conformance/C038.heic`<br>`heic-conformance/valid/nokia-conformance/C041.heic`<br>`heic-conformance/valid/nokia-conformance/C044.heic`<br>`heic-conformance/valid/nokia-conformance/C046.heic`<br>`heic-conformance/valid/nokia-conformance/C048.heic`<br>`heic-conformance/valid/nokia-conformance/MIAF002.heic`<br>`heic-conformance/valid/nokia-conformance/MIAF005.heic`<br>`heic-conformance/valid/nokia-conformance/MIAF006.heic`<br>`heic-conformance/valid/nokia-conformance/multilayer001.heic`<br>`heic-conformance/valid/nokia-conformance/multilayer002.heic`<br>`heic-conformance/valid/nokia-conformance/multilayer004.heic`<br>`heic-conformance/valid/nokia-conformance/multilayer005.heic` |

## Decode failures by likely root cause

None.

## Reproduction

- PureJsImage commit: `3a1b9936037b308181840a8db65cf4476e70e737-dirty`
- codec-corpus commit: `28205bbc5cf40364d012c462240ba28143373d67`
- Node/platform: `v24.16.0` on `linux-x64`
- Command: `npm run corpus:imazen -- --corpus <corpus-path> --format heic --output <output-path> --timeout-ms 30000 --memory-mb 512 --concurrency 2`

## Prioritized punch list

1. Review 1 accepted invalid or decoder-dependent input(s) without treating acceptance alone as a vulnerability.
2. Confirm the public unsupported boundary for 25 valid input(s) before considering feature work.
