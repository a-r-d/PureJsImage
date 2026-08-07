# Benchmark result

Created: 2026-08-07T18:55:10.255Z

Profile: `phase4`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | jpeg-resize-1200 | passed | 893.6 ms | 893.7 ms | 106.4 MiB | 0.4 MiB |
| purejsimage | northstar-photo-pipeline | passed | 3242.5 ms | 3302.1 ms | 118.6 MiB | 0.2 MiB |
| purejsimage | jpeg-crop-resize | passed | 2554.3 ms | 2611.3 ms | 121.3 MiB | 0.1 MiB |
| purejsimage | jpeg-to-png | passed | 408.6 ms | 421.9 ms | 116.8 MiB | 1.6 MiB |
| purejsimage | png-to-jpeg | passed | 59.9 ms | 62.2 ms | 115.1 MiB | 0.0 MiB |
| purejsimage | auto-orient-6 | passed | 387.6 ms | 389.4 ms | 104.5 MiB | 0.4 MiB |
| purejsimage | png-gray16-to-jpeg | passed | 1.5 ms | 1.5 ms | 92.1 MiB | 0.0 MiB |
| purejsimage | lambda-twilio-mms-jpeg-1024 | passed | 852.9 ms | 862.5 ms | 105.3 MiB | 0.3 MiB |
| purejsimage | lambda-user-upload-png-2048 | passed | 1053.8 ms | 1054.9 ms | 140.5 MiB | 0.5 MiB |
| purejsimage | lambda-logo-jpeg | passed | 956.8 ms | 977.7 ms | 103.1 MiB | 0.1 MiB |
| purejsimage | tiny-transparent-convert | passed | 1.2 ms | 1.2 ms | 88.6 MiB | 0.0 MiB |
| purejsimage | high-entropy-png-to-jpeg | passed | 576.2 ms | 600.2 ms | 144.1 MiB | 2.7 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
