# Benchmark result

Created: 2026-08-10T04:36:47.720Z

Profile: `tiff`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.8.0 (workspace) | pure-javascript |

Resize workflows use each engine’s public default kernel. PureJsImage and Sharp use Lanczos 3; Jimp uses bilinear. Cross-kernel timings are default-experience comparisons, not matched-quality comparisons.

## Compatibility

| Engine | Workflow | Status | Detail |
| --- | --- | --- | --- |
| purejsimage | tiff-metadata-large | pass | - |
| purejsimage | tiff-large-raw | pass | - |
| purejsimage | tiff-region-raw | pass | - |
| purejsimage | tiff-bigtiff-rgb16-raw | pass | - |
| purejsimage | tiff-cmyk8-planar-raw | pass | - |
| purejsimage | tiff-packed12-strip-raw | pass | - |
| purejsimage | tiff-packed12-tile-raw | pass | - |
| purejsimage | tiff-large-resize-jpeg | pass | - |
| purejsimage | tiff-rgb-png | pass | - |
| purejsimage | tiff-gray8-png | pass | - |
| purejsimage | tiff-bilevel-png | pass | - |
| purejsimage | tiff-palette8-png | pass | - |
| purejsimage | tiff-packbits-planar-alpha-png | pass | - |
| purejsimage | tiff-deflate-png | pass | - |
| purejsimage | tiff-lzw-single-strip-resize | pass | - |
| purejsimage | png-to-tiff | pass | - |

## Performance on workflows supported by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | External | ArrayBuffer | Source read | Max decoded block | Quality | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | tiff-metadata-large | 0.3 ms | 0.5 ms | 0.4 ms | 132.9 MiB | 0.9 MiB | 43.7 MiB | 34.5 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-large-raw | 75.1 ms | 78.4 ms | 75.4 ms | 163.0 MiB | 33.2 MiB | 78.1 MiB | 68.8 MiB | 34.3 MiB | 0.4 MiB | - | 34.3 MiB |
| purejsimage | tiff-region-raw | 4.9 ms | 5.1 ms | 5.2 ms | 133.1 MiB | 0.7 MiB | 45.9 MiB | 36.6 MiB | 8.8 MiB | 0.1 MiB | - | 2.1 MiB |
| purejsimage | tiff-bigtiff-rgb16-raw | 230.7 ms | 244.9 ms | 270.3 ms | 127.5 MiB | 5.1 MiB | 18.4 MiB | 9.1 MiB | 4.5 MiB | 0.2 MiB | - | 4.5 MiB |
| purejsimage | tiff-cmyk8-planar-raw | 101.1 ms | 109.7 ms | 143.0 ms | 113.2 MiB | 4.8 MiB | 14.7 MiB | 5.4 MiB | 3.0 MiB | 0.1 MiB | - | 2.3 MiB |
| purejsimage | tiff-packed12-strip-raw | 208.5 ms | 221.1 ms | 238.6 ms | 135.5 MiB | 19.5 MiB | 40.9 MiB | 31.6 MiB | 13.5 MiB | 0.4 MiB | - | 18.0 MiB |
| purejsimage | tiff-packed12-tile-raw | 230.0 ms | 246.3 ms | 257.4 ms | 147.0 MiB | 20.1 MiB | 45.2 MiB | 35.9 MiB | 17.7 MiB | 0.4 MiB | - | 18.1 MiB |
| purejsimage | tiff-large-resize-jpeg | 141.1 ms | 157.7 ms | 178.6 ms | 203.9 MiB | 12.5 MiB | 64.3 MiB | 55.0 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | tiff-rgb-png | 3.3 ms | 3.4 ms | 3.6 ms | 100.2 MiB | 0.7 MiB | 10.2 MiB | 1.0 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-gray8-png | 2.1 ms | 2.2 ms | 2.4 ms | 100.6 MiB | 1.2 MiB | 9.7 MiB | 0.5 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-bilevel-png | 4.4 ms | 10.1 ms | 9.9 ms | 101.0 MiB | 1.1 MiB | 9.7 MiB | 0.4 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-palette8-png | 4.3 ms | 4.5 ms | 4.8 ms | 99.7 MiB | 1.1 MiB | 10.2 MiB | 0.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-packbits-planar-alpha-png | 2.8 ms | 3.7 ms | 4.3 ms | 100.8 MiB | 1.1 MiB | 9.5 MiB | 0.3 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-deflate-png | 11.0 ms | 11.2 ms | 14.7 ms | 105.2 MiB | 1.0 MiB | 13.1 MiB | 3.6 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-lzw-single-strip-resize | 980.0 ms | 1010.8 ms | 1117.2 ms | 133.1 MiB | 35.4 MiB | 23.2 MiB | 13.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | png-to-tiff | 15.9 ms | 17.8 ms | 27.3 ms | 126.5 MiB | 0.9 MiB | 27.2 MiB | 17.8 MiB | - MiB | - MiB | - | 2.2 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 46.9 ms | 94.1 MiB | 1.4 ms (pass) | 860.1 ms (pass) | 1.8 MiB | 1 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
