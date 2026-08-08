# Benchmark result

Created: 2026-08-08T04:23:04.350Z

Profile: `ico`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | ico-metadata-mixed | passed | 0.3 ms | 0.4 ms | 92.3 MiB | 0.0 MiB |
| purejsimage | ico-png-primary-png | passed | 7.4 ms | 7.6 ms | 97.7 MiB | 0.0 MiB |
| purejsimage | ico-dib32-alpha-png | passed | 4.0 ms | 4.4 ms | 90.6 MiB | 0.0 MiB |
| purejsimage | ico-dib24-mask-png | passed | 2.4 ms | 3.8 ms | 90.5 MiB | 0.0 MiB |
| purejsimage | ico-favicon-resize-png | passed | 8.7 ms | 11.2 ms | 94.8 MiB | 0.0 MiB |
| purejsimage | ico-dib24-resize-jpeg | passed | 13.9 ms | 16.1 ms | 94.8 MiB | 0.0 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
