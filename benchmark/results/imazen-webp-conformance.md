# Imazen WEBP conformance baseline

This baseline validates complete decode, in-memory PNG encode, PNG reopen, dimensions, and process robustness. It does not claim exact pixel parity or full standards compliance.

## Summary

| Outcome | Count |
| --- | ---: |
| pass | 223 |
| unsupported | 2 |
| decode-failure | 0 |
| invalid-output | 0 |
| rejected-safely | 0 |
| accepted | 0 |
| raw-exception | 0 |
| timeout | 0 |
| process-crash | 0 |
| out-of-memory | 0 |

## Results by upstream category or feature

| Category | Total | Outcomes |
| --- | ---: | --- |
| valid/animation | 1 | unsupported: 1 |
| valid/extended-container | 1 | unsupported: 1 |
| valid/generated-checker-vp8 | 72 | pass: 72 |
| valid/generated-gradient-vp8 | 72 | pass: 72 |
| valid/generated-noise-vp8 | 72 | pass: 72 |
| valid/lossless-vp8l | 3 | pass: 3 |
| valid/lossy-alpha | 1 | pass: 1 |
| valid/lossy-grayscale-vp8 | 1 | pass: 1 |
| valid/lossy-vp8 | 1 | pass: 1 |
| valid/metadata | 1 | pass: 1 |

## Crashes, timeouts, raw exceptions, invalid output, and memory failures

None.

## Unsupported features by error code

| Error code | Count | Files |
| --- | ---: | --- |
| UNSUPPORTED_OPERATION | 2 | `webp-conformance/valid/advertises_rgba_but_frames_are_rgb.webp`<br>`webp-conformance/valid/anim.webp` |

## Decode failures by likely root cause

None.

## Reproduction

- PureJsImage commit: `e12e46471cbeac610a779ff926edd9b35ff14c1a`
- codec-corpus commit: `28205bbc5cf40364d012c462240ba28143373d67`
- Node/platform: `v24.16.0` on `linux-x64`
- Command: `npm run corpus:imazen -- --corpus ../codec-corpus --format webp --output benchmark/results --timeout-ms 30000 --memory-mb 512 --concurrency 2`

## Prioritized punch list

1. Confirm the public unsupported boundary for 2 valid input(s) before considering feature work.
