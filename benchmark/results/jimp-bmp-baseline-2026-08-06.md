# Benchmark result

Created: 2026-08-07T02:46:19.694Z

Profile: `bmp`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | bmp-metadata-large | passed | 239.1 ms | 242.6 ms | 173.7 MiB | 0.0 MiB |
| jimp | bmp-large-resize-jpeg | passed | 719.0 ms | 727.0 ms | 262.2 MiB | 0.1 MiB |
| jimp | bmp-pal1-png | passed | 7.5 ms | 7.5 ms | 93.1 MiB | 0.0 MiB |
| jimp | bmp-pal4-png | failed | - ms | - ms | - MiB | - MiB |
| jimp | bmp-rle4-png | failed | - ms | - ms | - MiB | - MiB |
| jimp | bmp-rle8-png | failed | - ms | - ms | - MiB | - MiB |
| jimp | bmp-top-down-crop-resize | passed | 14.8 ms | 14.8 ms | 96.5 MiB | 0.0 MiB |
| jimp | bmp-padding-odd-png | passed | 8.7 ms | 9.3 ms | 93.2 MiB | 0.0 MiB |
| jimp | bmp-os2-png | failed | - ms | - ms | - MiB | - MiB |
| jimp | bmp-v5-png | passed | 8.9 ms | 10.5 ms | 96.5 MiB | 0.0 MiB |
| jimp | bmp-rgb16-555-png | failed | - ms | - ms | - MiB | - MiB |
| jimp | bmp-rgb16-565-png | failed | - ms | - ms | - MiB | - MiB |
| jimp | bmp-rgb32-bitfields-png | passed | 8.7 ms | 8.8 ms | 96.6 MiB | 0.0 MiB |
| jimp | bmp-rgba32-v5-png | failed | - ms | - ms | - MiB | - MiB |
| jimp | bmp-rgb24-crop-resize-jpeg | passed | 52.3 ms | 56.2 ms | 120.9 MiB | 0.0 MiB |
| jimp | jpeg-to-bmp | passed | 586.7 ms | 606.4 ms | 292.5 MiB | 1.8 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
