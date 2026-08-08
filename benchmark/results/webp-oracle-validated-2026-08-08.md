# Benchmark result

Created: 2026-08-08T21:42:04.508Z

Profile: `webp`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.6.0 (workspace) | pure-javascript |

PureJsImage, Jimp, and image-js are pure JavaScript. Sharp is a native dependency; `sharp-single-thread` is the same native package configured with `sharp.concurrency(1)` before processing.

## Compatibility

| Engine | Workflow | Status | Detail |
| --- | --- | --- | --- |
| purejsimage | webp-metadata-large | pass | - |
| purejsimage | webp-large-resize-jpeg | pass | - |
| purejsimage | webp-lossy-photo-png | pass | - |
| purejsimage | webp-lossy-photo-crop-resize | pass | - |
| purejsimage | webp-lossless-alpha-png | pass | - |
| purejsimage | webp-lossless-odd-png | pass | - |
| purejsimage | webp-lossy-alpha-png | pass | - |
| purejsimage | jpeg-to-webp-lossy | pass | - |
| purejsimage | png-to-webp-lossless | pass | - |

## Performance on workflows supported equivalently by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | webp-metadata-large | 0.1 ms | 0.1 ms | 0.1 ms | 91.4 MiB | 0.6 MiB | 0.0 MiB |
| purejsimage | webp-large-resize-jpeg | 508.1 ms | 536.5 ms | 663.4 ms | 179.1 MiB | 28.0 MiB | 0.1 MiB |
| purejsimage | webp-lossy-photo-png | 214.5 ms | 216.1 ms | 295.6 ms | 143.1 MiB | 3.4 MiB | 1.3 MiB |
| purejsimage | webp-lossy-photo-crop-resize | 94.0 ms | 96.9 ms | 167.7 ms | 121.6 MiB | 4.2 MiB | 0.0 MiB |
| purejsimage | webp-lossless-alpha-png | 46.9 ms | 50.3 ms | 79.1 ms | 102.2 MiB | 3.2 MiB | 0.1 MiB |
| purejsimage | webp-lossless-odd-png | 38.5 ms | 41.6 ms | 66.8 ms | 103.7 MiB | 2.6 MiB | 0.0 MiB |
| purejsimage | webp-lossy-alpha-png | 175.2 ms | 184.4 ms | 274.1 ms | 151.9 MiB | 25.9 MiB | 0.2 MiB |
| purejsimage | jpeg-to-webp-lossy | 979.6 ms | 983.0 ms | 1082.6 ms | 123.7 MiB | 7.7 MiB | 0.4 MiB |
| purejsimage | png-to-webp-lossless | 56.3 ms | 58.7 ms | 88.4 ms | 114.6 MiB | 3.6 MiB | 2.2 MiB |

## Startup and installed package footprint

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | Installed footprint | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 40.8 ms | 88.6 MiB | 1.4 ms (pass) | 922.1 ms (pass) | 2.5 MiB | 1 |

Installed footprint includes each engine package and the production dependencies present for this platform, including Sharp platform packages. Exact package lists are recorded in JSON.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, and output validation are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Timing comparisons include encoding. Lossy encoders do not share a calibrated quality scale, so output quality and compression efficiency cannot be compared solely because each API received `quality: 80`; that requires a separate matched-quality study.
