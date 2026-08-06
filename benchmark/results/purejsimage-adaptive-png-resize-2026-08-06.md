# Benchmark result

Created: 2026-08-06T23:53:37.226Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | png-resize-1000 | passed | 944.3 ms | 1105.8 ms | 301.4 MiB | 0.7 MiB |
| purejsimage | png-resize-1000 | passed | 794.8 ms | 819.3 ms | 138.0 MiB | 0.1 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
