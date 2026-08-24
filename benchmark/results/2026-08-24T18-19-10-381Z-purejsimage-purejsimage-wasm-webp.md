# Benchmark result

Created: 2026-08-24T18:19:10.381Z

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
| purejsimage | webp-metadata-large | 0.1 ms | 0.1 ms | 0.2 ms | 116.8 MiB | 0.7 MiB | 10.2 MiB | 0.8 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | webp-large-resize-jpeg | 362.8 ms | 368.7 ms | 465.8 ms | 169.5 MiB | 4.9 MiB | 38.5 MiB | 12.4 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-memory-lossy-resize-jpeg | 809.2 ms | 809.2 ms | 980.3 ms | 191.6 MiB | 74.6 MiB | 32.1 MiB | 14.4 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-memory-lossless-resize-jpeg | 605.6 ms | 628.3 ms | 708.4 ms | 188.0 MiB | 71.3 MiB | 21.0 MiB | 11.7 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-lossy-photo-png | 174.2 ms | 183.5 ms | 235.2 ms | 156.3 MiB | 4.4 MiB | 33.9 MiB | 24.5 MiB | - MiB | - MiB | - | 1.3 MiB |
| purejsimage | webp-lossy-photo-crop-resize | 87.9 ms | 89.8 ms | 144.9 ms | 134.1 MiB | 4.6 MiB | 18.8 MiB | 9.4 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | webp-lossless-alpha-png | 50.7 ms | 55.6 ms | 77.2 ms | 126.4 MiB | 3.1 MiB | 14.1 MiB | 4.7 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage | webp-lossless-odd-png | 44.1 ms | 45.0 ms | 84.1 ms | 132.7 MiB | 2.8 MiB | 14.6 MiB | 5.2 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | webp-lossy-alpha-png | 103.5 ms | 104.6 ms | 191.7 ms | 139.9 MiB | 2.3 MiB | 23.2 MiB | 13.8 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage | jpeg-to-webp-lossy | 544.8 ms | 555.6 ms | 680.4 ms | 153.5 MiB | 6.1 MiB | 15.8 MiB | 6.0 MiB | - MiB | - MiB | - | 0.4 MiB |
| purejsimage | png-to-webp-lossless | 126.0 ms | 134.4 ms | 202.8 ms | 148.9 MiB | 8.7 MiB | 21.1 MiB | 11.5 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | odd-rgba-to-webp-lossless | 57.2 ms | 69.4 ms | 109.2 ms | 142.6 MiB | 1.5 MiB | 15.5 MiB | 5.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage | logo-to-webp-lossy | 65.0 ms | 67.0 ms | 117.4 ms | 136.6 MiB | 2.8 MiB | 12.1 MiB | 1.9 MiB | - MiB | - MiB | - | 0.6 MiB |
| purejsimage-wasm | webp-metadata-large | 0.1 ms | 0.1 ms | 0.1 ms | 118.2 MiB | 0.6 MiB | 10.2 MiB | 0.8 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | webp-large-resize-jpeg | 301.6 ms | 302.6 ms | 387.3 ms | 167.2 MiB | 3.7 MiB | 35.4 MiB | 25.2 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-memory-lossy-resize-jpeg | 761.2 ms | 799.3 ms | 894.4 ms | 188.1 MiB | 72.7 MiB | 33.2 MiB | 14.0 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-memory-lossless-resize-jpeg | 529.6 ms | 596.1 ms | 625.2 ms | 197.0 MiB | 80.3 MiB | 67.2 MiB | 56.0 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-lossy-photo-png | 156.8 ms | 160.8 ms | 205.7 ms | 154.5 MiB | 1.7 MiB | 34.7 MiB | 24.5 MiB | - MiB | - MiB | - | 1.3 MiB |
| purejsimage-wasm | webp-lossy-photo-crop-resize | 71.3 ms | 73.4 ms | 117.8 ms | 134.3 MiB | 3.5 MiB | 19.4 MiB | 9.4 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | webp-lossless-alpha-png | 44.7 ms | 46.9 ms | 67.4 ms | 124.6 MiB | 3.3 MiB | 14.7 MiB | 4.7 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | webp-lossless-odd-png | 42.0 ms | 42.7 ms | 62.4 ms | 126.7 MiB | 4.4 MiB | 15.2 MiB | 5.2 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | webp-lossy-alpha-png | 96.3 ms | 98.3 ms | 166.4 ms | 141.5 MiB | 2.1 MiB | 28.8 MiB | 18.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage-wasm | jpeg-to-webp-lossy | 563.3 ms | 571.4 ms | 697.0 ms | 156.1 MiB | 5.7 MiB | 15.8 MiB | 6.0 MiB | - MiB | - MiB | - | 0.4 MiB |
| purejsimage-wasm | png-to-webp-lossless | 113.4 ms | 118.6 ms | 183.4 ms | 153.0 MiB | 4.7 MiB | 10.6 MiB | 0.2 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | odd-rgba-to-webp-lossless | 49.8 ms | 52.7 ms | 91.8 ms | 143.7 MiB | 2.1 MiB | 15.8 MiB | 5.9 MiB | - MiB | - MiB | - | 0.0 MiB |
| purejsimage-wasm | logo-to-webp-lossy | 53.2 ms | 54.7 ms | 108.1 ms | 145.8 MiB | 5.5 MiB | 21.9 MiB | 10.7 MiB | - MiB | - MiB | - | 0.6 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 83.5 ms | 110.1 MiB | 2.0 ms (pass) | 530.0 ms (pass) | 6.3 MiB | 1 |
| purejsimage-wasm | 90.2 ms | 109.8 MiB | 1.7 ms (pass) | 476.7 ms (pass) | 6.3 MiB | 1 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
