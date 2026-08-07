# Benchmark result

Created: 2026-08-07T01:09:18.458Z

Profile: `phase5`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | jpeg-to-png | passed | 722.5 ms | 734.4 ms | 251.5 MiB | 2.0 MiB |
| jimp | png-to-jpeg | passed | 208.5 ms | 213.6 ms | 143.8 MiB | 0.0 MiB |
| jimp | gif-first-frame-png | passed | 11.1 ms | 11.9 ms | 94.7 MiB | 0.0 MiB |
| jimp | lambda-twilio-mms-gif-no-enlarge | passed | 103.5 ms | 108.1 ms | 130.9 MiB | 0.0 MiB |
| jimp | lambda-logo-gif | passed | 27.5 ms | 28.2 ms | 94.9 MiB | 0.0 MiB |
| purejsimage | jpeg-to-png | passed | 722.3 ms | 771.7 ms | 93.5 MiB | 1.6 MiB |
| purejsimage | png-to-jpeg | passed | 107.3 ms | 121.1 ms | 111.0 MiB | 0.0 MiB |
| purejsimage | gif-first-frame-png | passed | 24.1 ms | 26.6 ms | 83.8 MiB | 0.0 MiB |
| purejsimage | lambda-twilio-mms-gif-no-enlarge | passed | 80.5 ms | 83.9 ms | 97.5 MiB | 0.0 MiB |
| purejsimage | lambda-logo-gif | passed | 39.2 ms | 44.3 ms | 86.9 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
