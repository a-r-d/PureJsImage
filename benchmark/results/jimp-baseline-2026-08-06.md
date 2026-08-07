# Jimp 1.6.0 baseline

Recorded: 2026-08-06T23:07:16.885Z

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

Workflow success: 23/23

| Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | ---: | ---: | ---: | ---: |
| metadata-jpeg-large | passed | 5285.1 ms | 5650.0 ms | 1184.0 MiB | 0.0 MiB |
| jpeg-resize-1200 | passed | 1461.9 ms | 1511.1 ms | 593.8 MiB | 0.4 MiB |
| northstar-photo-pipeline | passed | 3708.4 ms | 3755.5 ms | 1187.3 MiB | 0.2 MiB |
| jpeg-crop-resize | passed | 2943.2 ms | 3066.0 ms | 1196.6 MiB | 0.1 MiB |
| png-resize-1000 | passed | 871.5 ms | 888.5 ms | 298.6 MiB | 0.7 MiB |
| png-alpha-resize | passed | 74.1 ms | 74.2 ms | 136.7 MiB | 0.0 MiB |
| jpeg-to-png | passed | 676.9 ms | 694.3 ms | 262.6 MiB | 2.0 MiB |
| png-to-jpeg | passed | 209.2 ms | 212.8 ms | 178.5 MiB | 0.0 MiB |
| auto-orient-6 | passed | 642.5 ms | 667.6 ms | 253.3 MiB | 0.4 MiB |
| gif-first-frame-png | passed | 4.6 ms | 4.9 ms | 95.0 MiB | 0.0 MiB |
| png-palette-roundtrip | passed | 1.5 ms | 1.5 ms | 92.5 MiB | 0.0 MiB |
| png-gray16-to-jpeg | passed | 8.0 ms | 8.4 ms | 126.5 MiB | 0.0 MiB |
| lambda-twilio-mms-jpeg-1024 | passed | 1392.1 ms | 1444.7 ms | 609.6 MiB | 0.3 MiB |
| lambda-user-upload-png-2048 | passed | 1973.6 ms | 2009.1 ms | 337.8 MiB | 0.7 MiB |
| lambda-twilio-mms-gif-no-enlarge | passed | 106.3 ms | 119.3 ms | 154.0 MiB | 0.0 MiB |
| lambda-logo-jpeg | passed | 863.3 ms | 865.6 ms | 437.4 MiB | 0.1 MiB |
| lambda-logo-png | passed | 41.5 ms | 43.0 ms | 124.8 MiB | 0.0 MiB |
| lambda-logo-gif | passed | 21.6 ms | 21.9 ms | 96.1 MiB | 0.0 MiB |
| odd-dimensions-resize | passed | 13.4 ms | 14.7 ms | 100.8 MiB | 0.0 MiB |
| tiny-transparent-convert | passed | 5.6 ms | 5.7 ms | 124.7 MiB | 0.0 MiB |
| high-entropy-png-to-jpeg | passed | 1450.3 ms | 1469.2 ms | 430.9 MiB | 5.6 MiB |
| batch-100-thumbnails | passed | 72694.2 ms | 73966.7 ms | 603.8 MiB | 1.7 MiB |
| stress-100mp-downscale | passed | 3709.6 ms | 3725.0 ms | 1272.1 MiB | 0.3 MiB |

## Win condition

PureJsImage wins a workflow only when its output passes the same validation and its median wall time is lower than this Jimp baseline. Peak RSS is the primary memory comparison. Unsupported or invalid output is a failed workflow regardless of timing.

Input file reads, process startup, warmups, and output validation are outside the timed region. Each sample runs in an isolated process. Standard cases use one untimed warmup and three measured samples; batch and stress cases use two measured samples without a warmup.
