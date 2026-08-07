# Benchmark result

Created: 2026-08-07T18:02:15.947Z

Profile: `smoke`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | jpeg-resize-1200 | passed | 1401.5 ms | 1413.1 ms | 105.8 MiB | 0.4 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.

## Comparison with the prior warm JPEG baseline

The matching 2026-08-06 warm run measured 1782.5 ms, 104.6 MiB absolute peak
RSS, and a 454,476-byte output. This run is 21.4% faster and produces a 14.7%
smaller 387,880-byte JPEG. Absolute peak RSS is 1.2 MiB higher at 105.8 MiB;
both runs remain in the same 128 MiB Lambda memory tier.

## Isolated encoder probe

`npm run bench:jpeg:encode -- <sampling>` encodes the same deterministic
2048x1536 RGB image at quality 80 after two warmups and measures five samples.
It independently decodes the result with `jpeg-js` before reporting success.

| Sampling | Median wall | Throughput | Peak RSS | Output | PSNR |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4:2:0 | 244.6 ms | 12.86 MP/s | 100.7 MiB | 1,492,375 bytes | 18.44 dB |
| 4:4:4 | 433.4 ms | 7.26 MP/s | 115.4 MiB | 2,660,990 bytes | 25.68 dB |

The pre-change 4:4:4-only probe took 580.3 ms and produced 2,660,990 bytes.
The explicit 4:4:4 path is now 25.3% faster from the bit-writer, Huffman, and
allocation changes. The new default 4:2:0 path is 57.9% faster and 43.9%
smaller on this deliberately high-frequency input; its lower PSNR records the
expected chroma-quality tradeoff rather than hiding it.
