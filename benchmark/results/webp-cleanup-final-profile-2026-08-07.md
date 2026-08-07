# Benchmark result

Created: 2026-08-07T19:37:41.146Z

Profile: `webp`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | webp-metadata-large | passed | 0.2 ms | 0.2 ms | 89.4 MiB | 0.0 MiB |
| purejsimage | webp-large-resize-jpeg | passed | 519.4 ms | 538.8 ms | 166.6 MiB | 0.1 MiB |
| purejsimage | webp-lossy-photo-png | passed | 215.6 ms | 222.9 ms | 139.6 MiB | 1.3 MiB |
| purejsimage | webp-lossy-photo-crop-resize | passed | 98.8 ms | 128.5 ms | 118.0 MiB | 0.0 MiB |
| purejsimage | webp-lossless-alpha-png | passed | 48.4 ms | 52.1 ms | 97.6 MiB | 0.1 MiB |
| purejsimage | webp-lossless-odd-png | passed | 34.9 ms | 35.6 ms | 97.2 MiB | 0.0 MiB |
| purejsimage | webp-lossy-alpha-png | passed | 163.0 ms | 183.5 ms | 134.3 MiB | 0.2 MiB |
| purejsimage | jpeg-to-webp-lossy | passed | 965.4 ms | 986.0 ms | 112.2 MiB | 0.4 MiB |
| purejsimage | png-to-webp-lossless | passed | 50.0 ms | 55.9 ms | 107.5 MiB | 2.2 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
