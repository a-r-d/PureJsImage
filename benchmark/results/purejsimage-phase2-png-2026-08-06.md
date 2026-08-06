# Benchmark result

Created: 2026-08-06T23:35:03.155Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | png-palette-roundtrip | passed | 1.1 ms | 1.3 ms | 92.5 MiB | 0.0 MiB |
| purejsimage | png-palette-roundtrip | passed | 1.1 ms | 1.4 ms | 86.1 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
