# Imazen BMP conformance baseline

This baseline validates complete decode, in-memory PNG encode, PNG reopen, dimensions, and process robustness. It does not claim exact pixel parity or full standards compliance.

## Summary

| Outcome | Count |
| --- | ---: |
| pass | 68 |
| unsupported | 2 |
| decode-failure | 0 |
| invalid-output | 0 |
| rejected-safely | 27 |
| accepted | 28 |
| raw-exception | 0 |
| timeout | 0 |
| process-crash | 0 |
| out-of-memory | 0 |

## Results by upstream category or feature

| Category | Total | Outcomes |
| --- | ---: | --- |
| invalid/general | 8 | rejected-safely: 8 |
| invalid/indexed-palette | 1 | rejected-safely: 1 |
| invalid/rle | 2 | rejected-safely: 2 |
| non-conformant/bitfields | 4 | accepted: 4 |
| non-conformant/general | 5 | rejected-safely: 2, accepted: 3 |
| non-conformant/indexed-palette | 6 | rejected-safely: 4, accepted: 2 |
| non-conformant/os2 | 7 | rejected-safely: 6, accepted: 1 |
| non-conformant/rgb24 | 6 | rejected-safely: 2, accepted: 4 |
| non-conformant/rgb32 | 4 | accepted: 4 |
| non-conformant/rgba-bitfields | 6 | accepted: 6 |
| non-conformant/rle | 6 | rejected-safely: 2, accepted: 4 |
| valid/bitfields | 10 | pass: 10 |
| valid/general | 4 | pass: 4 |
| valid/indexed-palette | 36 | pass: 34, unsupported: 2 |
| valid/os2 | 2 | pass: 2 |
| valid/rgb24 | 3 | pass: 3 |
| valid/rgb32 | 2 | pass: 2 |
| valid/rgba-bitfields | 6 | pass: 6 |
| valid/rle | 6 | pass: 6 |
| valid/top-down | 1 | pass: 1 |

## Crashes, timeouts, raw exceptions, invalid output, and memory failures

None.

## Unsupported features by error code

| Error code | Count | Files |
| --- | ---: | --- |
| UNSUPPORTED_OPERATION | 2 | `bmp-conformance/valid/pal2.bmp`<br>`bmp-conformance/valid/pal2color.bmp` |

## Decode failures by likely root cause

None.

## Reproduction

- PureJsImage commit: `e12e46471cbeac610a779ff926edd9b35ff14c1a`
- codec-corpus commit: `28205bbc5cf40364d012c462240ba28143373d67`
- Node/platform: `v24.16.0` on `linux-x64`
- Command: `npm run corpus:imazen -- --corpus ../codec-corpus --format bmp --output benchmark/results --timeout-ms 30000 --memory-mb 512 --concurrency 2`

## Prioritized punch list

1. Review 28 accepted invalid or decoder-dependent input(s) without treating acceptance alone as a vulnerability.
2. Confirm the public unsupported boundary for 2 valid input(s) before considering feature work.
