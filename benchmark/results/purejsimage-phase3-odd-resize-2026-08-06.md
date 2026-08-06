# Benchmark result

Created: 2026-08-06T23:46:23.920Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | odd-dimensions-resize | passed | 15.0 ms | 18.0 ms | 104.4 MiB | 0.0 MiB |
| purejsimage | odd-dimensions-resize | passed | 6.2 ms | 10.3 ms | 89.2 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
