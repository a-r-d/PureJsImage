# Benchmark result

Created: 2026-08-07T19:11:31.759Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | png-alpha-resize | passed | 48.2 ms | 59.5 ms | 106.9 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
