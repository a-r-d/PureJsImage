# Benchmark result

Created: 2026-08-07T19:23:54.433Z

Profile: `webp`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | webp-metadata-large | passed | 0.2 ms | 0.3 ms | 89.8 MiB | 0.0 MiB |
| purejsimage | webp-large-resize-jpeg | passed | 1413.5 ms | 1446.2 ms | 164.9 MiB | 0.1 MiB |
| purejsimage | webp-lossy-photo-png | passed | 228.3 ms | 229.2 ms | 142.0 MiB | 1.3 MiB |
| purejsimage | webp-lossy-photo-crop-resize | passed | 107.3 ms | 111.8 ms | 116.0 MiB | 0.0 MiB |
| purejsimage | webp-lossless-alpha-png | passed | 48.9 ms | 53.3 ms | 97.8 MiB | 0.1 MiB |
| purejsimage | webp-lossless-odd-png | passed | 39.3 ms | 44.9 ms | 97.8 MiB | 0.0 MiB |
| purejsimage | webp-lossy-alpha-png | passed | 223.7 ms | 224.8 ms | 135.7 MiB | 0.2 MiB |
| purejsimage | jpeg-to-webp-lossy | passed | 1296.6 ms | 1321.5 ms | 153.4 MiB | 0.4 MiB |
| purejsimage | png-to-webp-lossless | passed | 97.8 ms | 124.8 ms | 110.8 MiB | 2.2 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
