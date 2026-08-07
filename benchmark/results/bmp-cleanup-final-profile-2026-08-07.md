# Benchmark result

Created: 2026-08-07T19:19:58.840Z

Profile: `bmp`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | bmp-metadata-large | passed | 0.2 ms | 0.2 ms | 121.0 MiB | 0.0 MiB |
| purejsimage | bmp-large-resize-jpeg | passed | 149.4 ms | 149.7 ms | 148.1 MiB | 0.1 MiB |
| purejsimage | bmp-pal1-png | passed | 2.3 ms | 4.0 ms | 90.9 MiB | 0.0 MiB |
| purejsimage | bmp-pal4-png | passed | 2.5 ms | 2.5 ms | 90.9 MiB | 0.0 MiB |
| purejsimage | bmp-rle4-png | passed | 2.7 ms | 2.8 ms | 90.5 MiB | 0.0 MiB |
| purejsimage | bmp-rle8-png | passed | 2.6 ms | 2.8 ms | 87.7 MiB | 0.0 MiB |
| purejsimage | bmp-top-down-crop-resize | passed | 8.6 ms | 8.8 ms | 92.6 MiB | 0.0 MiB |
| purejsimage | bmp-padding-odd-png | passed | 2.4 ms | 2.6 ms | 90.9 MiB | 0.0 MiB |
| purejsimage | bmp-os2-png | passed | 2.5 ms | 2.5 ms | 91.0 MiB | 0.0 MiB |
| purejsimage | bmp-v5-png | passed | 2.5 ms | 2.5 ms | 87.7 MiB | 0.0 MiB |
| purejsimage | bmp-rgb16-555-png | passed | 2.7 ms | 2.7 ms | 91.1 MiB | 0.0 MiB |
| purejsimage | bmp-rgb16-565-png | passed | 1.7 ms | 1.7 ms | 91.1 MiB | 0.0 MiB |
| purejsimage | bmp-rgb32-bitfields-png | passed | 1.7 ms | 1.8 ms | 87.9 MiB | 0.0 MiB |
| purejsimage | bmp-rgba32-v5-png | passed | 2.1 ms | 2.2 ms | 91.1 MiB | 0.0 MiB |
| purejsimage | bmp-rgb24-crop-resize-jpeg | passed | 17.7 ms | 18.1 ms | 95.8 MiB | 0.0 MiB |
| purejsimage | jpeg-to-bmp | passed | 231.2 ms | 247.6 ms | 113.3 MiB | 1.8 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
