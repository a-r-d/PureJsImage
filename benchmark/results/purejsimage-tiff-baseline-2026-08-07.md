# Benchmark result

Created: 2026-08-07T04:57:08.685Z

Profile: `tiff`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| purejsimage | tiff-metadata-large | passed | 0.3 ms | 0.3 ms | 119.6 MiB | 0.0 MiB |
| purejsimage | tiff-large-resize-jpeg | passed | 686.0 ms | 722.9 ms | 164.3 MiB | 0.1 MiB |
| purejsimage | tiff-rgb-png | passed | 6.9 ms | 6.9 ms | 92.1 MiB | 0.0 MiB |
| purejsimage | tiff-gray8-png | passed | 5.1 ms | 5.2 ms | 87.2 MiB | 0.0 MiB |
| purejsimage | tiff-bilevel-png | passed | 3.9 ms | 5.6 ms | 87.5 MiB | 0.0 MiB |
| purejsimage | tiff-palette8-png | passed | 7.3 ms | 7.4 ms | 88.9 MiB | 0.0 MiB |
| purejsimage | tiff-packbits-planar-alpha-png | passed | 3.1 ms | 4.3 ms | 86.7 MiB | 0.0 MiB |
| purejsimage | tiff-deflate-png | passed | 22.0 ms | 22.1 ms | 97.2 MiB | 0.0 MiB |
| purejsimage | tiff-lzw-single-strip-resize | passed | 583.8 ms | 606.7 ms | 114.0 MiB | 0.0 MiB |
| purejsimage | png-to-tiff | passed | 21.7 ms | 21.8 ms | 103.7 MiB | 2.2 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
