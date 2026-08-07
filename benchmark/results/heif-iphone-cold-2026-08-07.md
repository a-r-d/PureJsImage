# Benchmark result

Created: 2026-08-07T16:23:24.947Z

Profile: `heif`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | heif-iphone-metadata | passed | 32.3 ms | 32.6 ms | 89.0 MiB | 0.0 MiB |
| purejsimage | heif-iphone-full-png | passed | 11510.1 ms | 11738.5 ms | 326.5 MiB | 12.8 MiB |
| purejsimage | heif-iphone-resize-jpeg | passed | 8080.0 ms | 8490.2 ms | 189.8 MiB | 0.3 MiB |
| purejsimage | heif-iphone-crop-resize-png | passed | 8922.5 ms | 9086.0 ms | 164.0 MiB | 0.9 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
