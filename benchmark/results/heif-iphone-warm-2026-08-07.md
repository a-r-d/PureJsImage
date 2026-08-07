# Benchmark result

Created: 2026-08-07T16:26:26.815Z

Profile: `heif`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | heif-iphone-metadata | passed | 2.2 ms | 2.2 ms | 89.5 MiB | 0.0 MiB |
| purejsimage | heif-iphone-full-png | passed | 11513.7 ms | 11650.8 ms | 430.4 MiB | 12.8 MiB |
| purejsimage | heif-iphone-resize-jpeg | passed | 8141.6 ms | 8177.1 ms | 241.5 MiB | 0.3 MiB |
| purejsimage | heif-iphone-crop-resize-png | passed | 8529.4 ms | 8648.2 ms | 219.8 MiB | 0.9 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
