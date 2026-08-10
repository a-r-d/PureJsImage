# Imazen GIF conformance baseline

This baseline validates complete decode, in-memory PNG encode, PNG reopen, dimensions, and process robustness. It does not claim exact pixel parity or full standards compliance.

## Summary

| Outcome | Count |
| --- | ---: |
| pass | 32 |
| unsupported | 0 |
| decode-failure | 0 |
| invalid-output | 0 |
| rejected-safely | 7 |
| accepted | 0 |
| raw-exception | 0 |
| timeout | 0 |
| process-crash | 0 |
| out-of-memory | 0 |

## Results by upstream category or feature

| Category | Total | Outcomes |
| --- | ---: | --- |
| edge-cases/color-tables | 1 | pass: 1 |
| edge-cases/extensions | 2 | pass: 2 |
| edge-cases/static | 1 | pass: 1 |
| invalid/static | 7 | rejected-safely: 7 |
| valid/animation | 3 | pass: 3 |
| valid/color-tables | 3 | pass: 3 |
| valid/disposal | 4 | pass: 4 |
| valid/frame-geometry | 2 | pass: 2 |
| valid/interlacing | 1 | pass: 1 |
| valid/looping | 4 | pass: 4 |
| valid/static | 5 | pass: 5 |
| valid/timing | 4 | pass: 4 |
| valid/transparency | 2 | pass: 2 |

## Crashes, timeouts, raw exceptions, invalid output, and memory failures

None.

## Unsupported features by error code

None.

## Decode failures by likely root cause

None.

## Reproduction

- PureJsImage commit: `e12e46471cbeac610a779ff926edd9b35ff14c1a`
- codec-corpus commit: `28205bbc5cf40364d012c462240ba28143373d67`
- Node/platform: `v24.16.0` on `linux-x64`
- Command: `npm run corpus:imazen -- --corpus ../codec-corpus --format gif --output benchmark/results --timeout-ms 30000 --memory-mb 512 --concurrency 2`

## Prioritized punch list

1. Add independent pixel-oracle comparison before making exact-correctness claims.
