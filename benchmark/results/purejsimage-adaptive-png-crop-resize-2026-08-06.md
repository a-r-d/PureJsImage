# Benchmark result

Created: 2026-08-06T23:54:56.676Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | png-crop-resize-roundtrip | passed | 652.3 ms | 652.4 ms | 296.2 MiB | 0.2 MiB |
| purejsimage | png-crop-resize-roundtrip | passed | 395.9 ms | 417.3 ms | 127.4 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
