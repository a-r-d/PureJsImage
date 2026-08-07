# Benchmark result

Created: 2026-08-07T18:52:07.154Z

Profile: `smoke`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | jpeg-resize-1200 | passed | 905.6 ms | 928.0 ms | 106.8 MiB | 0.4 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
