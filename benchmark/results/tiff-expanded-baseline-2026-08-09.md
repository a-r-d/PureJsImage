# Benchmark result

Created: 2026-08-10T03:44:30.839Z

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
| purejsimage | tiff-metadata-large | 0.4 ms | 0.5 ms | 0.5 ms | 130.5 MiB | 0.9 MiB | 43.7 MiB | 34.5 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-large-raw | 78.5 ms | 85.9 ms | 78.7 ms | 163.2 MiB | 33.2 MiB | 78.1 MiB | 68.8 MiB | 34.3 MiB | 0.4 MiB | - | 34.3 MiB |
| purejsimage | tiff-region-raw | 5.0 ms | 8.5 ms | 5.3 ms | 133.0 MiB | 0.7 MiB | 45.9 MiB | 36.6 MiB | 8.8 MiB | 0.1 MiB | - | 2.1 MiB |
| purejsimage | tiff-large-resize-jpeg | 143.3 ms | 158.1 ms | 184.0 ms | 202.4 MiB | 13.6 MiB | 64.3 MiB | 55.0 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | tiff-rgb-png | 3.3 ms | 4.3 ms | 3.7 ms | 100.3 MiB | 0.8 MiB | 10.2 MiB | 1.0 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-gray8-png | 2.1 ms | 2.5 ms | 2.6 ms | 99.9 MiB | 1.3 MiB | 9.7 MiB | 0.5 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-bilevel-png | 6.7 ms | 7.1 ms | 14.1 ms | 100.5 MiB | 1.5 MiB | 9.7 MiB | 0.4 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-palette8-png | 5.0 ms | 9.4 ms | 8.7 ms | 102.6 MiB | 1.2 MiB | 10.2 MiB | 0.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-packbits-planar-alpha-png | 2.9 ms | 3.5 ms | 8.3 ms | 101.4 MiB | 1.3 MiB | 9.5 MiB | 0.3 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-deflate-png | 11.0 ms | 11.9 ms | 15.0 ms | 105.1 MiB | 1.0 MiB | 13.1 MiB | 3.6 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-lzw-single-strip-resize | 969.0 ms | 989.8 ms | 1104.9 ms | 132.3 MiB | 34.7 MiB | 23.2 MiB | 13.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | png-to-tiff | 16.5 ms | 24.3 ms | 28.9 ms | 126.5 MiB | 1.1 MiB | 27.2 MiB | 17.8 MiB | - MiB | - MiB | - | 2.2 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 45.9 ms | 92.5 MiB | 2.1 ms (pass) | 902.7 ms (pass) | 1.8 MiB | 1 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
