# Benchmark result

Created: 2026-08-06T23:47:53.585Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | png-crop-resize-roundtrip | passed | 664.3 ms | 667.3 ms | 292.3 MiB | 0.2 MiB |
| purejsimage | png-crop-resize-roundtrip | passed | 405.4 ms | 415.3 ms | 127.1 MiB | 0.6 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
