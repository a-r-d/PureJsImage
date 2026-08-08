# Benchmark result

Created: 2026-08-08T15:15:53.414Z

Profile: `transforms`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | transform-quarter-turn-jpeg | passed | 1764.7 ms | 1767.3 ms | 168.0 MiB | 0.6 MiB |
| purejsimage | transform-arbitrary-angle-jpeg | passed | 254.0 ms | 262.1 ms | 140.7 MiB | 0.0 MiB |
| purejsimage | transform-crop-after-resize-jpeg | passed | 944.4 ms | 960.0 ms | 120.4 MiB | 0.1 MiB |
| purejsimage | transform-flip-flop-jpeg | passed | 28.3 ms | 30.0 ms | 100.1 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
