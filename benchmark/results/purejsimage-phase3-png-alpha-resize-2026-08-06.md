# Benchmark result

Created: 2026-08-06T23:46:10.318Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | png-alpha-resize | passed | 68.7 ms | 74.9 ms | 147.7 MiB | 0.0 MiB |
| purejsimage | png-alpha-resize | passed | 38.2 ms | 39.6 ms | 110.2 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
