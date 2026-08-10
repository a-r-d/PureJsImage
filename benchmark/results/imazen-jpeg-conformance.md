# Imazen JPEG conformance baseline

This baseline validates complete decode, in-memory PNG encode, PNG reopen, dimensions, and process robustness. It does not claim exact pixel parity or full standards compliance.

## Summary

| Outcome | Count |
| --- | ---: |
| pass | 39 |
| unsupported | 2 |
| decode-failure | 0 |
| invalid-output | 0 |
| rejected-safely | 167 |
| accepted | 46 |
| raw-exception | 0 |
| timeout | 0 |
| process-crash | 0 |
| out-of-memory | 0 |

## Results by upstream category or feature

| Category | Total | Outcomes |
| --- | ---: | --- |
| crash-repro/jpeg-decoder | 15 | rejected-safely: 7, accepted: 8 |
| crash-repro/jpeg-decoder-257 | 27 | rejected-safely: 27 |
| crash-repro/libjpeg-turbo | 6 | rejected-safely: 3, accepted: 3 |
| crash-repro/zune-jpeg | 29 | rejected-safely: 7, accepted: 22 |
| invalid | 116 | rejected-safely: 104, accepted: 12 |
| non-conformant/extraneous-data | 1 | rejected-safely: 1 |
| non-conformant/marker-quirks | 1 | accepted: 1 |
| non-conformant/metadata-quirks | 5 | rejected-safely: 5 |
| non-conformant/progressive-quirks | 1 | rejected-safely: 1 |
| non-conformant/truncated | 12 | rejected-safely: 12 |
| valid | 41 | pass: 39, unsupported: 2 |

## Crashes, timeouts, raw exceptions, invalid output, and memory failures

None.

## Unsupported features by error code

| Error code | Count | Files |
| --- | ---: | --- |
| UNSUPPORTED_OPERATION | 2 | `jpeg-conformance/valid/testimgari.jpg`<br>`jpeg-conformance/valid/testorig12.jpg` |

## Decode failures by likely root cause

None.

## Reproduction

- PureJsImage commit: `e7a6044e5967c1ed1ea127c45fd7f415a03ba4a9`
- codec-corpus commit: `28205bbc5cf40364d012c462240ba28143373d67`
- Node/platform: `v24.16.0` on `linux-x64`
- Command: `npm run corpus:imazen -- --corpus ../codec-corpus --format jpeg --output benchmark/results --timeout-ms 30000 --memory-mb 512 --concurrency 2`

## Prioritized punch list

1. Review 46 accepted invalid or decoder-dependent input(s) without treating acceptance alone as a vulnerability.
2. Confirm the public unsupported boundary for 2 valid input(s) before considering feature work.
