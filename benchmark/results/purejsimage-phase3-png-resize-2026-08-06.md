# Benchmark result

Created: 2026-08-06T23:45:55.860Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | png-resize-1000 | passed | 868.4 ms | 874.5 ms | 293.3 MiB | 0.7 MiB |
| purejsimage | png-resize-1000 | passed | 638.5 ms | 650.1 ms | 139.5 MiB | 2.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
