# Benchmark result

Created: 2026-08-07T19:11:29.496Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | high-entropy-png-to-jpeg | passed | 552.5 ms | 604.8 ms | 143.5 MiB | 2.7 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
