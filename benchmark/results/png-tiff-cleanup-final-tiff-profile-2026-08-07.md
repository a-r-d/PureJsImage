# Benchmark result

Created: 2026-08-07T19:13:20.434Z

Profile: `tiff`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | tiff-metadata-large | passed | 0.4 ms | 0.4 ms | 120.9 MiB | 0.0 MiB |
| purejsimage | tiff-large-resize-jpeg | passed | 124.0 ms | 130.2 ms | 132.3 MiB | 0.1 MiB |
| purejsimage | tiff-rgb-png | passed | 3.7 ms | 3.8 ms | 93.2 MiB | 0.0 MiB |
| purejsimage | tiff-gray8-png | passed | 2.8 ms | 2.8 ms | 91.6 MiB | 0.0 MiB |
| purejsimage | tiff-bilevel-png | passed | 4.6 ms | 5.2 ms | 90.8 MiB | 0.0 MiB |
| purejsimage | tiff-palette8-png | passed | 7.5 ms | 7.7 ms | 93.9 MiB | 0.0 MiB |
| purejsimage | tiff-packbits-planar-alpha-png | passed | 3.1 ms | 3.7 ms | 87.5 MiB | 0.0 MiB |
| purejsimage | tiff-deflate-png | passed | 11.3 ms | 11.5 ms | 95.6 MiB | 0.0 MiB |
| purejsimage | tiff-lzw-single-strip-resize | passed | 499.1 ms | 502.6 ms | 111.4 MiB | 0.0 MiB |
| purejsimage | png-to-tiff | passed | 16.1 ms | 16.4 ms | 106.1 MiB | 2.2 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
