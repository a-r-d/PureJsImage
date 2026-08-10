# Benchmark result

Created: 2026-08-10T03:47:06.443Z

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
| purejsimage | tiff-metadata-large | 2.4 ms | 2.5 ms | 2.6 ms | 133.2 MiB | 0.6 MiB | 43.7 MiB | 34.5 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-large-raw | 77.8 ms | 89.6 ms | 79.0 ms | 162.9 MiB | 30.5 MiB | 78.1 MiB | 68.8 MiB | 34.3 MiB | 0.4 MiB | - | 34.3 MiB |
| purejsimage | tiff-region-raw | 8.1 ms | 8.3 ms | 8.7 ms | 133.3 MiB | 1.1 MiB | 45.9 MiB | 36.6 MiB | 8.8 MiB | 0.1 MiB | - | 2.1 MiB |
| purejsimage | tiff-large-resize-jpeg | 150.6 ms | 152.4 ms | 202.8 ms | 162.7 MiB | 30.0 MiB | 64.2 MiB | 40.8 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | tiff-rgb-png | 14.6 ms | 15.0 ms | 26.6 ms | 97.2 MiB | 1.6 MiB | 10.2 MiB | 0.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-gray8-png | 11.1 ms | 11.2 ms | 15.3 ms | 96.4 MiB | 1.3 MiB | 9.7 MiB | 0.5 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-bilevel-png | 13.0 ms | 13.0 ms | 20.9 ms | 99.3 MiB | 1.6 MiB | 9.7 MiB | 0.4 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-palette8-png | 17.9 ms | 19.9 ms | 38.0 ms | 100.7 MiB | 2.9 MiB | 10.2 MiB | 0.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-packbits-planar-alpha-png | 9.7 ms | 10.0 ms | 15.7 ms | 99.5 MiB | 2.3 MiB | 9.6 MiB | 0.3 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-deflate-png | 34.6 ms | 39.9 ms | 49.9 ms | 99.1 MiB | 3.8 MiB | 13.1 MiB | 3.6 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-lzw-single-strip-resize | 964.4 ms | 971.5 ms | 1095.3 ms | 131.3 MiB | 33.0 MiB | 23.2 MiB | 13.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | png-to-tiff | 34.4 ms | 34.4 ms | 52.9 ms | 110.0 MiB | 12.0 MiB | 25.0 MiB | 15.6 MiB | - MiB | - MiB | - | 2.2 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 46.9 ms | 93.5 MiB | 1.5 ms (pass) | 890.1 ms (pass) | 1.8 MiB | 1 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
