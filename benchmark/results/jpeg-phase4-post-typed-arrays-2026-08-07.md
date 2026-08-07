# Benchmark result

Created: 2026-08-07T18:24:56.328Z

Profile: `phase4`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | jpeg-resize-1200 | passed | 1395.1 ms | 1420.3 ms | 596.0 MiB | 0.4 MiB |
| jimp | northstar-photo-pipeline | passed | 3762.9 ms | 3772.3 ms | 1188.3 MiB | 0.2 MiB |
| jimp | jpeg-crop-resize | passed | 2868.2 ms | 2931.4 ms | 1197.2 MiB | 0.1 MiB |
| jimp | jpeg-to-png | passed | 661.7 ms | 661.9 ms | 265.4 MiB | 2.0 MiB |
| jimp | png-to-jpeg | passed | 201.7 ms | 203.4 ms | 176.7 MiB | 0.0 MiB |
| jimp | auto-orient-6 | passed | 576.0 ms | 596.1 ms | 253.9 MiB | 0.4 MiB |
| jimp | png-gray16-to-jpeg | passed | 7.2 ms | 10.4 ms | 130.3 MiB | 0.0 MiB |
| jimp | lambda-twilio-mms-jpeg-1024 | passed | 1364.4 ms | 1425.6 ms | 600.6 MiB | 0.3 MiB |
| jimp | lambda-user-upload-png-2048 | passed | 1997.3 ms | 2003.0 ms | 399.6 MiB | 0.7 MiB |
| jimp | lambda-logo-jpeg | passed | 834.5 ms | 834.7 ms | 420.4 MiB | 0.1 MiB |
| jimp | tiny-transparent-convert | passed | 5.7 ms | 6.9 ms | 131.4 MiB | 0.0 MiB |
| jimp | high-entropy-png-to-jpeg | passed | 1400.0 ms | 1405.1 ms | 432.5 MiB | 5.6 MiB |
| purejsimage | jpeg-resize-1200 | passed | 1408.1 ms | 1411.5 ms | 105.9 MiB | 0.4 MiB |
| purejsimage | northstar-photo-pipeline | passed | 4851.9 ms | 4859.4 ms | 145.8 MiB | 0.2 MiB |
| purejsimage | jpeg-crop-resize | passed | 3981.9 ms | 3988.1 ms | 115.8 MiB | 0.1 MiB |
| purejsimage | jpeg-to-png | passed | 522.7 ms | 523.1 ms | 103.4 MiB | 1.6 MiB |
| purejsimage | png-to-jpeg | passed | 58.7 ms | 59.5 ms | 116.0 MiB | 0.0 MiB |
| purejsimage | auto-orient-6 | passed | 423.3 ms | 428.8 ms | 104.2 MiB | 0.4 MiB |
| purejsimage | png-gray16-to-jpeg | passed | 1.4 ms | 1.4 ms | 88.9 MiB | 0.0 MiB |
| purejsimage | lambda-twilio-mms-jpeg-1024 | passed | 1353.6 ms | 1373.8 ms | 105.0 MiB | 0.3 MiB |
| purejsimage | lambda-user-upload-png-2048 | passed | 1049.9 ms | 1054.0 ms | 154.9 MiB | 0.5 MiB |
| purejsimage | lambda-logo-jpeg | passed | 1382.7 ms | 1395.4 ms | 109.7 MiB | 0.1 MiB |
| purejsimage | tiny-transparent-convert | passed | 1.2 ms | 1.3 ms | 88.8 MiB | 0.0 MiB |
| purejsimage | high-entropy-png-to-jpeg | passed | 569.2 ms | 579.0 ms | 143.3 MiB | 2.7 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
