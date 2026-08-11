# Benchmark result

Created: 2026-08-10T22:27:45.756Z

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
| purejsimage | tiff-cielab8-strip-raw | pass | - |
| purejsimage | tiff-fillorder6-strip-raw | pass | - |
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
| purejsimage | tiff-metadata-large | 0.4 ms | 0.6 ms | 0.6 ms | 134.4 MiB | 0.8 MiB | 43.7 MiB | 34.5 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-large-raw | 88.2 ms | 102.2 ms | 96.5 ms | 198.4 MiB | 67.2 MiB | 112.4 MiB | 103.1 MiB | 34.3 MiB | 0.4 MiB | - | 34.3 MiB |
| purejsimage | tiff-region-raw | 8.2 ms | 8.5 ms | 8.5 ms | 140.0 MiB | 9.0 MiB | 54.7 MiB | 45.4 MiB | 8.8 MiB | 0.1 MiB | - | 2.1 MiB |
| purejsimage | tiff-bigtiff-rgb16-raw | 238.8 ms | 244.1 ms | 295.9 ms | 134.3 MiB | 6.5 MiB | 18.8 MiB | 9.5 MiB | 4.5 MiB | 0.2 MiB | - | 4.5 MiB |
| purejsimage | tiff-cmyk8-planar-raw | 98.9 ms | 118.5 ms | 153.6 ms | 121.2 MiB | 11.5 MiB | 17.7 MiB | 8.4 MiB | 3.0 MiB | 0.1 MiB | - | 2.3 MiB |
| purejsimage | tiff-packed12-strip-raw | 227.6 ms | 258.0 ms | 269.3 ms | 155.9 MiB | 35.9 MiB | 54.4 MiB | 45.1 MiB | 13.5 MiB | 0.4 MiB | - | 18.0 MiB |
| purejsimage | tiff-packed12-tile-raw | 267.7 ms | 307.7 ms | 311.4 ms | 169.4 MiB | 34.5 MiB | 41.1 MiB | 31.9 MiB | 17.7 MiB | 0.4 MiB | - | 18.1 MiB |
| purejsimage | tiff-cielab8-strip-raw | 270.6 ms | 291.1 ms | 320.8 ms | 131.7 MiB | 5.8 MiB | 19.4 MiB | 10.1 MiB | 9.0 MiB | 0.2 MiB | - | 9.0 MiB |
| purejsimage | tiff-fillorder6-strip-raw | 137.3 ms | 155.7 ms | 190.3 ms | 118.8 MiB | 10.6 MiB | 16.9 MiB | 7.7 MiB | 2.3 MiB | 0.1 MiB | - | 3.0 MiB |
| purejsimage | tiff-large-resize-jpeg | 144.4 ms | 161.3 ms | 194.7 ms | 214.9 MiB | 4.1 MiB | 54.5 MiB | 45.2 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | tiff-rgb-png | 3.5 ms | 4.2 ms | 3.8 ms | 98.9 MiB | 0.8 MiB | 10.3 MiB | 1.0 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-gray8-png | 2.2 ms | 2.9 ms | 2.6 ms | 98.9 MiB | 1.3 MiB | 9.8 MiB | 0.5 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-bilevel-png | 7.4 ms | 8.2 ms | 17.6 ms | 102.4 MiB | 1.4 MiB | 9.7 MiB | 0.4 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-palette8-png | 4.7 ms | 6.0 ms | 6.0 ms | 104.5 MiB | 1.1 MiB | 10.2 MiB | 1.0 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-packbits-planar-alpha-png | 3.1 ms | 3.6 ms | 5.4 ms | 102.2 MiB | 1.3 MiB | 9.6 MiB | 0.3 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-deflate-png | 11.7 ms | 16.9 ms | 16.2 ms | 106.3 MiB | 1.1 MiB | 13.1 MiB | 3.6 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | tiff-lzw-single-strip-resize | 1026.2 ms | 1099.3 ms | 1179.1 ms | 133.0 MiB | 36.7 MiB | 23.2 MiB | 13.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | png-to-tiff | 24.5 ms | 25.3 ms | 29.6 ms | 111.4 MiB | 1.0 MiB | 16.7 MiB | 7.3 MiB | - MiB | - MiB | - | 0.0 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 57.7 ms | 94.9 MiB | 1.6 ms (pass) | 851.4 ms (pass) | 2.3 MiB | 1 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
