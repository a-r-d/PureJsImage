# Benchmark result

Created: 2026-08-07T02:46:35.029Z

Profile: `bmp`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | bmp-metadata-large | passed | 14.0 ms | 14.4 ms | 117.6 MiB | 0.0 MiB |
| purejsimage | bmp-large-resize-jpeg | passed | 284.1 ms | 286.1 ms | 158.2 MiB | 0.1 MiB |
| purejsimage | bmp-pal1-png | passed | 21.0 ms | 22.7 ms | 89.4 MiB | 0.0 MiB |
| purejsimage | bmp-pal4-png | passed | 21.8 ms | 22.1 ms | 86.4 MiB | 0.0 MiB |
| purejsimage | bmp-rle4-png | passed | 22.2 ms | 25.6 ms | 86.1 MiB | 0.0 MiB |
| purejsimage | bmp-rle8-png | passed | 22.2 ms | 22.4 ms | 89.6 MiB | 0.0 MiB |
| purejsimage | bmp-top-down-crop-resize | passed | 34.1 ms | 39.1 ms | 88.3 MiB | 0.0 MiB |
| purejsimage | bmp-padding-odd-png | passed | 22.6 ms | 24.6 ms | 89.4 MiB | 0.0 MiB |
| purejsimage | bmp-os2-png | passed | 21.1 ms | 21.5 ms | 86.1 MiB | 0.0 MiB |
| purejsimage | bmp-v5-png | passed | 22.3 ms | 24.1 ms | 89.3 MiB | 0.0 MiB |
| purejsimage | bmp-rgb16-555-png | passed | 21.0 ms | 24.0 ms | 87.4 MiB | 0.0 MiB |
| purejsimage | bmp-rgb16-565-png | passed | 20.6 ms | 21.0 ms | 87.4 MiB | 0.0 MiB |
| purejsimage | bmp-rgb32-bitfields-png | passed | 20.4 ms | 21.0 ms | 84.2 MiB | 0.0 MiB |
| purejsimage | bmp-rgba32-v5-png | passed | 21.1 ms | 23.3 ms | 84.2 MiB | 0.0 MiB |
| purejsimage | bmp-rgb24-crop-resize-jpeg | passed | 41.3 ms | 42.8 ms | 90.4 MiB | 0.0 MiB |
| purejsimage | jpeg-to-bmp | passed | 525.9 ms | 526.2 ms | 105.9 MiB | 1.8 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
