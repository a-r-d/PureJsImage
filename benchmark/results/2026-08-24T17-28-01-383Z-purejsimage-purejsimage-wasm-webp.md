# Benchmark result

Created: 2026-08-24T17:28:01.383Z

Profile: `webp`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.16.0 (workspace) | pure-javascript |
| purejsimage-wasm | 0.16.0 (workspace WASM) | webassembly |

Resize workflows use each engine’s public default kernel. PureJsImage and Sharp use Lanczos 3; Jimp uses bilinear. Cross-kernel timings are default-experience comparisons, not matched-quality comparisons.

## Compatibility

| Engine | Workflow | Status | Detail |
| --- | --- | --- | --- |
| purejsimage | webp-metadata-large | pass | - |
| purejsimage | webp-large-resize-jpeg | pass | - |
| purejsimage | webp-memory-lossy-resize-jpeg | pass | - |
| purejsimage | webp-memory-lossless-resize-jpeg | pass | - |
| purejsimage | webp-lossy-photo-png | pass | - |
| purejsimage | webp-lossy-photo-crop-resize | pass | - |
| purejsimage | webp-lossless-alpha-png | pass | - |
| purejsimage | webp-lossless-odd-png | pass | - |
| purejsimage | webp-lossy-alpha-png | pass | - |
| purejsimage | jpeg-to-webp-lossy | pass | - |
| purejsimage | png-to-webp-lossless | pass | - |
| purejsimage | odd-rgba-to-webp-lossless | pass | - |
| purejsimage | logo-to-webp-lossy | pass | - |
| purejsimage-wasm | webp-metadata-large | pass | - |
| purejsimage-wasm | webp-large-resize-jpeg | pass | - |
| purejsimage-wasm | webp-memory-lossy-resize-jpeg | pass | - |
| purejsimage-wasm | webp-memory-lossless-resize-jpeg | pass | - |
| purejsimage-wasm | webp-lossy-photo-png | pass | - |
| purejsimage-wasm | webp-lossy-photo-crop-resize | pass | - |
| purejsimage-wasm | webp-lossless-alpha-png | pass | - |
| purejsimage-wasm | webp-lossless-odd-png | pass | - |
| purejsimage-wasm | webp-lossy-alpha-png | pass | - |
| purejsimage-wasm | jpeg-to-webp-lossy | pass | - |
| purejsimage-wasm | png-to-webp-lossless | pass | - |
| purejsimage-wasm | odd-rgba-to-webp-lossless | pass | - |
| purejsimage-wasm | logo-to-webp-lossy | pass | - |

## Performance on workflows supported by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | External | ArrayBuffer | Source read | Max decoded block | Quality | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | webp-metadata-large | 0.1 ms | 0.1 ms | 0.1 ms | 117.4 MiB | 0.6 MiB | 10.2 MiB | 0.8 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | webp-large-resize-jpeg | 338.7 ms | 356.5 ms | 435.1 ms | 170.5 MiB | 6.7 MiB | 37.3 MiB | 27.9 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-memory-lossy-resize-jpeg | 782.5 ms | 792.4 ms | 940.7 ms | 179.2 MiB | 62.9 MiB | 32.1 MiB | 22.7 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-memory-lossless-resize-jpeg | 602.3 ms | 604.1 ms | 700.9 ms | 184.2 MiB | 67.3 MiB | 21.0 MiB | 11.7 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-lossy-photo-png | 169.6 ms | 170.9 ms | 225.1 ms | 157.2 MiB | 4.2 MiB | 33.9 MiB | 24.5 MiB | - MiB | - MiB | - | 1.3 MiB |
| purejsimage | webp-lossy-photo-crop-resize | 90.3 ms | 98.8 ms | 149.1 ms | 136.5 MiB | 5.3 MiB | 18.8 MiB | 9.4 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | webp-lossless-alpha-png | 50.8 ms | 51.9 ms | 75.4 ms | 126.9 MiB | 2.1 MiB | 14.1 MiB | 4.7 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-lossless-odd-png | 47.0 ms | 47.6 ms | 80.4 ms | 127.3 MiB | 3.6 MiB | 14.6 MiB | 5.2 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | webp-lossy-alpha-png | 107.4 ms | 108.0 ms | 196.7 ms | 139.8 MiB | 2.1 MiB | 28.0 MiB | 18.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage | jpeg-to-webp-lossy | 557.8 ms | 563.1 ms | 683.7 ms | 150.8 MiB | 6.5 MiB | 15.8 MiB | 6.0 MiB | - MiB | - MiB | - | 0.4 MiB |
| purejsimage | png-to-webp-lossless | 123.4 ms | 132.0 ms | 198.4 ms | 150.4 MiB | 9.3 MiB | 21.1 MiB | 11.5 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | odd-rgba-to-webp-lossless | 54.7 ms | 56.5 ms | 103.0 ms | 142.8 MiB | 1.8 MiB | 15.5 MiB | 5.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | logo-to-webp-lossy | 65.7 ms | 70.0 ms | 116.3 ms | 141.0 MiB | 5.9 MiB | 12.1 MiB | 1.9 MiB | - MiB | - MiB | - | 0.6 MiB |
| purejsimage-wasm | webp-metadata-large | 0.1 ms | 0.1 ms | 0.1 ms | 118.2 MiB | 0.7 MiB | 10.2 MiB | 0.8 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | webp-large-resize-jpeg | 306.0 ms | 311.0 ms | 394.3 ms | 167.2 MiB | 3.6 MiB | 34.7 MiB | 24.5 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-memory-lossy-resize-jpeg | 743.3 ms | 750.5 ms | 880.3 ms | 184.1 MiB | 68.7 MiB | 43.0 MiB | 8.8 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-memory-lossless-resize-jpeg | 595.1 ms | 601.6 ms | 677.2 ms | 199.6 MiB | 81.5 MiB | 71.1 MiB | 11.7 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-lossy-photo-png | 152.9 ms | 154.0 ms | 202.4 ms | 154.0 MiB | 1.5 MiB | 34.7 MiB | 24.5 MiB | - MiB | - MiB | - | 1.3 MiB |
| purejsimage-wasm | webp-lossy-photo-crop-resize | 73.2 ms | 80.7 ms | 115.0 ms | 134.8 MiB | 3.9 MiB | 19.4 MiB | 9.4 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | webp-lossless-alpha-png | 45.5 ms | 46.3 ms | 66.9 ms | 125.1 MiB | 1.8 MiB | 14.7 MiB | 4.7 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-lossless-odd-png | 41.0 ms | 41.7 ms | 61.5 ms | 127.1 MiB | 4.1 MiB | 15.2 MiB | 5.2 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | webp-lossy-alpha-png | 90.5 ms | 90.8 ms | 160.0 ms | 140.0 MiB | 1.5 MiB | 28.8 MiB | 18.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage-wasm | jpeg-to-webp-lossy | 542.8 ms | 544.7 ms | 662.1 ms | 154.4 MiB | 5.4 MiB | 15.8 MiB | 6.0 MiB | - MiB | - MiB | - | 0.4 MiB |
| purejsimage-wasm | png-to-webp-lossless | 110.8 ms | 111.9 ms | 175.9 ms | 152.1 MiB | 6.5 MiB | 10.6 MiB | 0.2 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | odd-rgba-to-webp-lossless | 49.0 ms | 49.2 ms | 90.2 ms | 142.4 MiB | 1.9 MiB | 15.8 MiB | 5.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | logo-to-webp-lossy | 50.2 ms | 50.4 ms | 103.9 ms | 142.7 MiB | 6.0 MiB | 21.9 MiB | 10.7 MiB | - MiB | - MiB | - | 0.6 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 83.2 ms | 110.1 MiB | 1.6 ms (pass) | 499.9 ms (pass) | 6.3 MiB | 1 |
| purejsimage-wasm | 85.5 ms | 110.4 MiB | 1.6 ms (pass) | 459.7 ms (pass) | 6.3 MiB | 1 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
