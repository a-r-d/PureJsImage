# Benchmark result

Created: 2026-08-06T23:53:55.564Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | png-alpha-resize | passed | 84.6 ms | 146.9 ms | 139.5 MiB | 0.0 MiB |
| purejsimage | png-alpha-resize | passed | 49.7 ms | 58.5 ms | 111.7 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
