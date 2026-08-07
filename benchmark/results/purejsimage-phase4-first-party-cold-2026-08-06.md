# Benchmark result

Created: 2026-08-07T00:56:55.022Z

Profile: `phase4`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | jpeg-resize-1200 | passed | 1471.2 ms | 1523.5 ms | 588.7 MiB | 0.4 MiB |
| jimp | northstar-photo-pipeline | passed | 4077.8 ms | 4080.7 ms | 1112.4 MiB | 0.2 MiB |
| jimp | jpeg-crop-resize | passed | 3043.1 ms | 3164.5 ms | 1190.3 MiB | 0.1 MiB |
| jimp | jpeg-to-png | passed | 720.9 ms | 745.3 ms | 252.2 MiB | 2.0 MiB |
| jimp | png-to-jpeg | passed | 211.2 ms | 224.3 ms | 143.4 MiB | 0.0 MiB |
| jimp | auto-orient-6 | passed | 601.4 ms | 607.6 ms | 193.7 MiB | 0.4 MiB |
| jimp | png-gray16-to-jpeg | passed | 17.3 ms | 17.5 ms | 107.8 MiB | 0.0 MiB |
| jimp | tooldesk-upload-jpeg-1024 | passed | 1498.7 ms | 1523.2 ms | 601.6 MiB | 0.3 MiB |
| jimp | tooldesk-upload-png-2048 | passed | 2022.2 ms | 2044.9 ms | 298.7 MiB | 0.7 MiB |
| jimp | tooldesk-logo-jpeg | passed | 999.4 ms | 1020.4 ms | 425.4 MiB | 0.1 MiB |
| jimp | tiny-transparent-convert | passed | 16.1 ms | 16.6 ms | 117.2 MiB | 0.0 MiB |
| jimp | high-entropy-png-to-jpeg | passed | 1414.3 ms | 1430.2 ms | 377.0 MiB | 5.6 MiB |
| purejsimage | jpeg-resize-1200 | passed | 1829.6 ms | 1995.0 ms | 95.7 MiB | 0.4 MiB |
| purejsimage | northstar-photo-pipeline | passed | 4859.4 ms | 4928.3 ms | 121.5 MiB | 0.3 MiB |
| purejsimage | jpeg-crop-resize | passed | 4155.0 ms | 4249.0 ms | 110.9 MiB | 0.1 MiB |
| purejsimage | jpeg-to-png | passed | 725.1 ms | 727.3 ms | 93.9 MiB | 1.6 MiB |
| purejsimage | png-to-jpeg | passed | 105.2 ms | 105.6 ms | 110.5 MiB | 0.0 MiB |
| purejsimage | auto-orient-6 | passed | 694.9 ms | 697.4 ms | 92.8 MiB | 0.4 MiB |
| purejsimage | png-gray16-to-jpeg | passed | 22.8 ms | 23.2 ms | 83.9 MiB | 0.0 MiB |
| purejsimage | tooldesk-upload-jpeg-1024 | passed | 1707.6 ms | 1710.0 ms | 96.8 MiB | 0.3 MiB |
| purejsimage | tooldesk-upload-png-2048 | passed | 1314.4 ms | 1327.2 ms | 108.9 MiB | 0.7 MiB |
| purejsimage | tooldesk-logo-jpeg | passed | 1437.6 ms | 1441.9 ms | 99.9 MiB | 0.1 MiB |
| purejsimage | tiny-transparent-convert | passed | 21.8 ms | 23.6 ms | 86.9 MiB | 0.0 MiB |
| purejsimage | high-entropy-png-to-jpeg | passed | 1393.4 ms | 1407.3 ms | 130.5 MiB | 5.6 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
