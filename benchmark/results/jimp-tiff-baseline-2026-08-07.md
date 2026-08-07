# Benchmark result

Created: 2026-08-07T04:51:53.203Z

Profile: `tiff`

Environment: Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs, Node v24.16.0, linux/x64

| Engine | Workflow | Status | Median wall | p95 wall | Median peak RSS | Output |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| jimp | tiff-metadata-large | passed | 145.2 ms | 148.7 ms | 254.4 MiB | 0.0 MiB |
| jimp | tiff-large-resize-jpeg | passed | 638.8 ms | 646.6 ms | 318.5 MiB | 0.1 MiB |
| jimp | tiff-rgb-png | passed | 5.5 ms | 5.5 ms | 95.2 MiB | 0.0 MiB |
| jimp | tiff-gray8-png | passed | 4.7 ms | 4.8 ms | 95.2 MiB | 0.0 MiB |
| jimp | tiff-bilevel-png | passed | 3.5 ms | 3.5 ms | 95.2 MiB | 0.0 MiB |
| jimp | tiff-palette8-png | passed | 5.1 ms | 5.1 ms | 95.5 MiB | 0.0 MiB |
| jimp | tiff-packbits-planar-alpha-png | failed | - ms | - ms | - MiB | - MiB |
| jimp | tiff-deflate-png | failed | - ms | - ms | - MiB | - MiB |
| jimp | tiff-lzw-single-strip-resize | passed | 726.8 ms | 731.4 ms | 283.7 MiB | 0.1 MiB |
| jimp | png-to-tiff | passed | 103.4 ms | 104.4 ms | 136.4 MiB | 2.2 MiB |

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside the timed region.
