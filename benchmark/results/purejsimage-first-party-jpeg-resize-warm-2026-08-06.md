# Benchmark result

Created: 2026-08-07T00:45:06.441Z

Profile: `smoke`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | jpeg-resize-1200 | passed | 1391.6 ms | 1429.1 ms | 594.6 MiB | 0.4 MiB |
| purejsimage | jpeg-resize-1200 | passed | 1782.5 ms | 1784.8 ms | 104.6 MiB | 0.4 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
