# Benchmark result

Created: 2026-08-07T02:26:09.292Z

Profile: `webp`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | webp-metadata-large | passed | 0.2 ms | 0.2 ms | 87.2 MiB | 0.0 MiB |
| purejsimage | webp-large-resize-jpeg | passed | 1511.8 ms | 1537.2 ms | 185.3 MiB | 0.1 MiB |
| purejsimage | webp-lossy-photo-png | passed | 229.9 ms | 240.2 ms | 139.1 MiB | 1.3 MiB |
| purejsimage | webp-lossy-photo-crop-resize | passed | 144.0 ms | 147.1 ms | 108.4 MiB | 0.0 MiB |
| purejsimage | webp-lossless-alpha-png | passed | 46.6 ms | 47.0 ms | 94.3 MiB | 0.1 MiB |
| purejsimage | webp-lossless-odd-png | passed | 37.6 ms | 40.3 ms | 94.4 MiB | 0.0 MiB |
| purejsimage | webp-lossy-alpha-png | passed | 239.5 ms | 240.2 ms | 132.0 MiB | 0.2 MiB |
| purejsimage | jpeg-to-webp-lossy | passed | 2106.5 ms | 2142.1 ms | 152.9 MiB | 0.4 MiB |
| purejsimage | png-to-webp-lossless | passed | 104.3 ms | 106.8 ms | 107.7 MiB | 2.2 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
