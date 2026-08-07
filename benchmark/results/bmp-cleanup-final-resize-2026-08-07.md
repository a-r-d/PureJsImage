# Benchmark result

Created: 2026-08-07T19:19:47.943Z

Profile: `bmp`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | bmp-large-resize-jpeg | passed | 149.1 ms | 152.1 ms | 153.1 MiB | 0.1 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
