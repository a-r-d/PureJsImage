# Benchmark result

Created: 2026-08-06T23:54:24.340Z

Profile: `full`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | stress-100mp-downscale | passed | 3732.5 ms | 3860.6 ms | 1273.5 MiB | 0.3 MiB |
| purejsimage | stress-100mp-downscale | passed | 3547.5 ms | 3716.1 ms | 173.5 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
