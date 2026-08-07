# Benchmark result

Created: 2026-08-07T19:17:13.883Z

Profile: `bmp`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | bmp-metadata-large | passed | 0.2 ms | 0.3 ms | 124.5 MiB | 0.0 MiB |
| purejsimage | bmp-large-resize-jpeg | passed | 177.9 ms | 178.1 ms | 152.8 MiB | 0.1 MiB |
| purejsimage | bmp-pal1-png | passed | 3.4 ms | 3.4 ms | 93.3 MiB | 0.0 MiB |
| purejsimage | bmp-pal4-png | passed | 3.8 ms | 4.1 ms | 93.6 MiB | 0.0 MiB |
| purejsimage | bmp-rle4-png | passed | 3.4 ms | 3.6 ms | 90.7 MiB | 0.0 MiB |
| purejsimage | bmp-rle8-png | passed | 3.5 ms | 3.5 ms | 93.8 MiB | 0.0 MiB |
| purejsimage | bmp-top-down-crop-resize | passed | 8.5 ms | 8.7 ms | 93.0 MiB | 0.0 MiB |
| purejsimage | bmp-padding-odd-png | passed | 2.1 ms | 2.2 ms | 92.8 MiB | 0.0 MiB |
| purejsimage | bmp-os2-png | passed | 3.5 ms | 3.7 ms | 93.8 MiB | 0.0 MiB |
| purejsimage | bmp-v5-png | passed | 3.5 ms | 3.7 ms | 90.3 MiB | 0.0 MiB |
| purejsimage | bmp-rgb16-555-png | passed | 2.6 ms | 2.8 ms | 91.4 MiB | 0.0 MiB |
| purejsimage | bmp-rgb16-565-png | passed | 1.8 ms | 1.8 ms | 91.0 MiB | 0.0 MiB |
| purejsimage | bmp-rgb32-bitfields-png | passed | 1.9 ms | 1.9 ms | 87.8 MiB | 0.0 MiB |
| purejsimage | bmp-rgba32-v5-png | passed | 2.2 ms | 2.2 ms | 90.9 MiB | 0.0 MiB |
| purejsimage | bmp-rgb24-crop-resize-jpeg | passed | 17.7 ms | 17.8 ms | 99.0 MiB | 0.0 MiB |
| purejsimage | jpeg-to-bmp | passed | 215.9 ms | 217.4 ms | 112.2 MiB | 1.8 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
