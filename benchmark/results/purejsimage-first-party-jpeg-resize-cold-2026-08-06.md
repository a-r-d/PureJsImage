# Benchmark result

Created: 2026-08-07T00:44:28.409Z

Profile: `smoke`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | jpeg-resize-1200 | passed | 1496.4 ms | 1592.4 ms | 586.4 MiB | 0.4 MiB |
| purejsimage | jpeg-resize-1200 | passed | 1761.8 ms | 1786.0 ms | 96.1 MiB | 0.4 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
