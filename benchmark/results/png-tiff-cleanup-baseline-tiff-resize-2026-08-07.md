# Benchmark result

Created: 2026-08-07T19:06:59.298Z

Profile: `tiff`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | tiff-large-resize-jpeg | passed | 574.4 ms | 653.2 ms | 165.8 MiB | 0.1 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
