# Benchmark result

Created: 2026-08-08T15:23:40.526Z

Profile: `transforms-comparable`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | transform-quarter-turn-jpeg | passed | 2051.8 ms | 2128.6 ms | 608.9 MiB | 0.7 MiB |
| jimp | transform-crop-after-resize-jpeg | passed | 1433.7 ms | 1469.0 ms | 583.5 MiB | 0.1 MiB |
| jimp | transform-flip-flop-jpeg | passed | 70.2 ms | 80.9 ms | 153.2 MiB | 0.0 MiB |
| purejsimage | transform-quarter-turn-jpeg | passed | 1795.3 ms | 1823.0 ms | 175.4 MiB | 0.6 MiB |
| purejsimage | transform-crop-after-resize-jpeg | passed | 952.4 ms | 1017.5 ms | 121.1 MiB | 0.1 MiB |
| purejsimage | transform-flip-flop-jpeg | passed | 22.4 ms | 22.7 ms | 100.7 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
