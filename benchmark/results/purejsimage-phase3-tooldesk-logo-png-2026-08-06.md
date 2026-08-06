# Benchmark result

Created: 2026-08-06T23:46:17.305Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | tooldesk-logo-png | passed | 44.2 ms | 57.4 ms | 142.6 MiB | 0.0 MiB |
| purejsimage | tooldesk-logo-png | passed | 25.8 ms | 26.1 ms | 97.7 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
