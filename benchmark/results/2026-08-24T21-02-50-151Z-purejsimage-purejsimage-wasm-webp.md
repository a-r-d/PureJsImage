# Benchmark result

Created: 2026-08-24T21:02:50.151Z

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
| purejsimage | webp-metadata-large | 0.1 ms | 0.2 ms | 0.2 ms | 117.8 MiB | 0.8 MiB | 10.2 MiB | 0.8 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | webp-large-resize-jpeg | 342.7 ms | 346.2 ms | 441.0 ms | 169.2 MiB | 6.8 MiB | 38.5 MiB | 29.1 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-memory-lossy-resize-jpeg | 805.9 ms | 814.6 ms | 973.8 ms | 190.6 MiB | 73.9 MiB | 21.3 MiB | 11.9 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-memory-lossless-resize-jpeg | 598.1 ms | 603.0 ms | 710.1 ms | 204.4 MiB | 88.6 MiB | 76.9 MiB | 67.5 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-lossy-photo-png | 173.3 ms | 177.9 ms | 232.6 ms | 154.9 MiB | 2.5 MiB | 33.9 MiB | 24.5 MiB | - MiB | - MiB | - | 1.3 MiB |
| purejsimage | webp-lossy-photo-crop-resize | 93.7 ms | 97.8 ms | 156.4 ms | 135.7 MiB | 5.0 MiB | 18.8 MiB | 9.4 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | webp-lossless-alpha-png | 51.6 ms | 52.5 ms | 77.1 ms | 127.6 MiB | 2.2 MiB | 14.1 MiB | 4.7 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-lossless-odd-png | 44.6 ms | 45.0 ms | 84.4 ms | 132.2 MiB | 3.8 MiB | 14.6 MiB | 5.2 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | webp-lossy-alpha-png | 109.9 ms | 118.6 ms | 208.3 ms | 140.1 MiB | 1.6 MiB | 23.3 MiB | 13.9 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage | jpeg-to-webp-lossy | 576.4 ms | 578.8 ms | 708.8 ms | 154.1 MiB | 6.8 MiB | 15.8 MiB | 6.0 MiB | - MiB | - MiB | - | 0.4 MiB |
| purejsimage | png-to-webp-lossless | 130.5 ms | 134.0 ms | 209.7 ms | 150.4 MiB | 6.7 MiB | 21.1 MiB | 11.5 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | odd-rgba-to-webp-lossless | 54.2 ms | 54.4 ms | 108.3 ms | 142.6 MiB | 2.2 MiB | 15.5 MiB | 5.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | logo-to-webp-lossy | 63.2 ms | 71.4 ms | 112.7 ms | 137.2 MiB | 2.4 MiB | 12.1 MiB | 1.9 MiB | - MiB | - MiB | - | 0.6 MiB |
| purejsimage-wasm | webp-metadata-large | 0.1 ms | 0.1 ms | 0.1 ms | 118.4 MiB | 1.0 MiB | 10.2 MiB | 0.8 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | webp-large-resize-jpeg | 309.5 ms | 360.4 ms | 400.2 ms | 169.0 MiB | 4.1 MiB | 34.6 MiB | 24.4 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-memory-lossy-resize-jpeg | 768.8 ms | 870.1 ms | 941.6 ms | 189.7 MiB | 74.3 MiB | 33.2 MiB | 14.0 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-memory-lossless-resize-jpeg | 519.5 ms | 535.8 ms | 610.7 ms | 195.2 MiB | 78.8 MiB | 66.8 MiB | 56.7 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-lossy-photo-png | 159.1 ms | 164.9 ms | 215.9 ms | 156.3 MiB | 4.3 MiB | 34.7 MiB | 24.5 MiB | - MiB | - MiB | - | 1.3 MiB |
| purejsimage-wasm | webp-lossy-photo-crop-resize | 70.4 ms | 72.9 ms | 114.7 ms | 135.8 MiB | 5.3 MiB | 19.4 MiB | 9.4 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | webp-lossless-alpha-png | 45.6 ms | 48.6 ms | 69.0 ms | 123.8 MiB | 1.3 MiB | 14.7 MiB | 4.7 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-lossless-odd-png | 44.1 ms | 49.8 ms | 65.5 ms | 126.4 MiB | 2.2 MiB | 15.2 MiB | 5.2 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | webp-lossy-alpha-png | 96.7 ms | 102.7 ms | 163.0 ms | 142.0 MiB | 2.8 MiB | 28.8 MiB | 18.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage-wasm | jpeg-to-webp-lossy | 547.8 ms | 548.4 ms | 672.7 ms | 157.6 MiB | 6.4 MiB | 15.8 MiB | 6.0 MiB | - MiB | - MiB | - | 0.4 MiB |
| purejsimage-wasm | png-to-webp-lossless | 117.4 ms | 126.4 ms | 185.2 ms | 153.5 MiB | 7.4 MiB | 10.6 MiB | 0.2 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | odd-rgba-to-webp-lossless | 53.2 ms | 53.4 ms | 88.9 ms | 142.9 MiB | 1.3 MiB | 15.8 MiB | 5.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | logo-to-webp-lossy | 55.1 ms | 55.2 ms | 117.8 ms | 150.5 MiB | 9.2 MiB | 21.9 MiB | 10.7 MiB | - MiB | - MiB | - | 0.6 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 82.9 ms | 109.8 MiB | 1.7 ms (pass) | 504.7 ms (pass) | 6.3 MiB | 1 |
| purejsimage-wasm | 86.0 ms | 110.1 MiB | 1.7 ms (pass) | 484.9 ms (pass) | 6.3 MiB | 1 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
