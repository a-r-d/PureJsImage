# Benchmark result

Created: 2026-08-06T23:46:50.675Z

Profile: `full`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | stress-100mp-downscale | passed | 3777.8 ms | 3797.3 ms | 1273.6 MiB | 0.3 MiB |
| purejsimage | stress-100mp-downscale | passed | 3560.7 ms | 3608.4 ms | 173.6 MiB | 1.4 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
