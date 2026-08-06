# Benchmark result

Created: 2026-08-06T23:35:53.007Z

Profile: `standard`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | png-crop-roundtrip | passed | 49.5 ms | 52.4 ms | 136.4 MiB | 0.0 MiB |
| purejsimage | png-crop-roundtrip | passed | 20.8 ms | 24.1 ms | 97.3 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
