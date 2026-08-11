# Benchmark result

Created: 2026-08-10T22:28:44.831Z

Profile: `tiff`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| jimp | 1.6.0 | pure-javascript |

Resize workflows use each engine’s public default kernel. PureJsImage and Sharp use Lanczos 3; Jimp uses bilinear. Cross-kernel timings are default-experience comparisons, not matched-quality comparisons.

## Compatibility

| Engine | Workflow | Status | Detail |
| --- | --- | --- | --- |
| jimp | tiff-metadata-large | pass | - |
| jimp | tiff-large-raw | unsupported | Jimp has no streaming raw-decode benchmark path |
| jimp | tiff-region-raw | unsupported | Jimp has no streaming raw-decode benchmark path |
| jimp | tiff-bigtiff-rgb16-raw | unsupported | Jimp has no streaming raw-decode benchmark path |
| jimp | tiff-cmyk8-planar-raw | unsupported | Jimp has no streaming raw-decode benchmark path |
| jimp | tiff-packed12-strip-raw | unsupported | Jimp has no streaming raw-decode benchmark path |
| jimp | tiff-packed12-tile-raw | unsupported | Jimp has no streaming raw-decode benchmark path |
| jimp | tiff-cielab8-strip-raw | unsupported | Jimp has no streaming raw-decode benchmark path |
| jimp | tiff-fillorder6-strip-raw | unsupported | Jimp has no streaming raw-decode benchmark path |
| jimp | tiff-large-resize-jpeg | pass | - |
| jimp | tiff-rgb-png | pass | - |
| jimp | tiff-gray8-png | pass | - |
| jimp | tiff-bilevel-png | pass | - |
| jimp | tiff-palette8-png | invalid output | Warmup output failed: pixel (156, 150) red: expected 170 +/- 0, got 171; pixel (156, 150) green: expected 207 +/- 0, got 208 |
| jimp | tiff-packbits-planar-alpha-png | invalid output | Warmup output failed: corner alpha: expected 0, got 255; pixel (0, 0) alpha: expected 0 +/- 0, got 255; pixel (40, 40) alpha: expected 152 +/- 0, got 255; pixel (63, 63) alpha: expected 0 +/- 0, got 255 |
| jimp | tiff-deflate-png | invalid output | Warmup output failed: pixel (499, 499) red: expected 181 +/- 0, got 0; pixel (499, 499) green: expected 181 +/- 0, got 0; pixel (499, 499) blue: expected 181 +/- 0, got 0 |
| jimp | tiff-lzw-single-strip-resize | pass | - |
| jimp | png-to-tiff | pass | - |

## Performance on workflows supported by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | External | ArrayBuffer | Source read | Max decoded block | Quality | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| jimp | tiff-metadata-large | 150.4 ms | 190.1 ms | 169.0 ms | 289.8 MiB | 157.2 MiB | 204.0 MiB | 194.6 MiB | - MiB | - MiB | - | 0.0 MiB |
| jimp | tiff-large-resize-jpeg | 663.0 ms | 701.2 ms | 771.3 ms | 372.1 MiB | 161.1 MiB | 160.3 MiB | 151.0 MiB | - MiB | - MiB | - | 0.1 MiB |
| jimp | tiff-rgb-png | 5.0 ms | 7.6 ms | 6.0 ms | 99.8 MiB | 0.9 MiB | 10.9 MiB | 1.6 MiB | - MiB | - MiB | - | 0.0 MiB |
| jimp | tiff-gray8-png | 4.2 ms | 4.2 ms | 4.5 ms | 98.5 MiB | 0.7 MiB | 10.7 MiB | 1.4 MiB | - MiB | - MiB | - | 0.0 MiB |
| jimp | tiff-bilevel-png | 3.5 ms | 3.8 ms | 3.7 ms | 97.2 MiB | 0.9 MiB | 10.3 MiB | 1.0 MiB | - MiB | - MiB | - | 0.0 MiB |
| jimp | tiff-lzw-single-strip-resize | 753.2 ms | 779.0 ms | 857.3 ms | 284.8 MiB | 189.4 MiB | 159.5 MiB | 150.2 MiB | - MiB | - MiB | - | 0.1 MiB |
| jimp | png-to-tiff | 97.3 ms | 102.4 ms | 111.1 ms | 152.8 MiB | 0.8 MiB | 27.0 MiB | 17.7 MiB | - MiB | - MiB | - | 2.2 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| jimp | 61.5 ms | 93.5 MiB | 2471.2 ms (pass) | 1385.7 ms (pass) | 29.3 MiB | 70 |

Installed footprint includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
