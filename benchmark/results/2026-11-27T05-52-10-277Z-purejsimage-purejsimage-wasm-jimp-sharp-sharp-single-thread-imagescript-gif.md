# Benchmark result

Created: 2026-11-27T05:52:10.277Z

Profile: `gif`

Environment: Linux 7.0.0-43-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.18.0 (workspace) | pure-javascript |
| purejsimage-wasm | 0.18.0 (workspace WASM) | webassembly |
| jimp | 1.7.0 | pure-javascript |
| sharp | 0.35.5 | native |
| sharp-single-thread | 0.35.5 | native-single-thread |
| imagescript | 4.0.0 | pure-javascript |

Resize workflows use each engine’s public default kernel. PureJsImage and Sharp use Lanczos 3; Jimp uses bilinear. Cross-kernel timings are default-experience comparisons, not matched-quality comparisons.

## Compatibility

| Engine | Workflow | Status | Detail |
| --- | --- | --- | --- |
| purejsimage | gif-animated-resize | pass | - |
| purejsimage | gif-animated-roundtrip | pass | - |
| purejsimage | gif-sticker-resize | pass | - |
| purejsimage | gif-cc0-resize | pass | - |
| purejsimage | gif-last-frame-png | pass | - |
| purejsimage | jpeg-to-gif | pass | - |
| purejsimage | logo-to-gif | pass | - |
| purejsimage-wasm | gif-animated-resize | pass | - |
| purejsimage-wasm | gif-animated-roundtrip | pass | - |
| purejsimage-wasm | gif-sticker-resize | pass | - |
| purejsimage-wasm | gif-cc0-resize | pass | - |
| purejsimage-wasm | gif-last-frame-png | pass | - |
| purejsimage-wasm | jpeg-to-gif | pass | - |
| purejsimage-wasm | logo-to-gif | pass | - |
| jimp | gif-animated-resize | unsupported | Jimp 1.7.0 decodes only the first GIF frame |
| jimp | gif-animated-roundtrip | unsupported | Jimp 1.7.0 decodes only the first GIF frame |
| jimp | gif-sticker-resize | unsupported | Jimp 1.7.0 decodes only the first GIF frame |
| jimp | gif-cc0-resize | unsupported | Jimp 1.7.0 decodes only the first GIF frame |
| jimp | gif-last-frame-png | unsupported | Jimp 1.7.0 decodes only the first GIF frame |
| jimp | jpeg-to-gif | pass | - |
| jimp | logo-to-gif | pass | - |
| sharp | gif-animated-resize | pass | - |
| sharp | gif-animated-roundtrip | pass | - |
| sharp | gif-sticker-resize | pass | - |
| sharp | gif-cc0-resize | pass | - |
| sharp | gif-last-frame-png | pass | - |
| sharp | jpeg-to-gif | pass | - |
| sharp | logo-to-gif | pass | - |
| sharp-single-thread | gif-animated-resize | pass | - |
| sharp-single-thread | gif-animated-roundtrip | pass | - |
| sharp-single-thread | gif-sticker-resize | pass | - |
| sharp-single-thread | gif-cc0-resize | pass | - |
| sharp-single-thread | gif-last-frame-png | pass | - |
| sharp-single-thread | jpeg-to-gif | pass | - |
| sharp-single-thread | logo-to-gif | pass | - |
| imagescript | gif-animated-resize | pass | - |
| imagescript | gif-animated-roundtrip | pass | - |
| imagescript | gif-sticker-resize | pass | - |
| imagescript | gif-cc0-resize | pass | - |
| imagescript | gif-last-frame-png | pass | - |
| imagescript | jpeg-to-gif | pass | - |
| imagescript | logo-to-gif | pass | - |

## Performance on workflows supported by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | External | ArrayBuffer | Source read | Max decoded block | Quality | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | jpeg-to-gif | 521.1 ms | 542.4 ms | 668.2 ms | 121.6 MiB | 14.1 MiB | 30.1 MiB | 20.6 MiB | - MiB | - MiB | - | 0.5 MiB |
| purejsimage | logo-to-gif | 18.5 ms | 19.3 ms | 36.0 ms | 97.7 MiB | 4.2 MiB | 22.3 MiB | 12.9 MiB | - MiB | - MiB | - | 0.1 MiB |
| purejsimage-wasm | jpeg-to-gif | 244.6 ms | 247.6 ms | 306.9 ms | 116.7 MiB | 10.9 MiB | 31.0 MiB | 20.9 MiB | - MiB | - MiB | - | 0.5 MiB |
| purejsimage-wasm | logo-to-gif | 17.9 ms | 20.4 ms | 34.9 ms | 96.1 MiB | 4.1 MiB | 20.5 MiB | 10.8 MiB | - MiB | - MiB | - | 0.1 MiB |
| jimp | jpeg-to-gif | 5718.0 ms | 5746.6 ms | 6259.2 ms | 662.9 MiB | 399.0 MiB | 29.8 MiB | 20.1 MiB | - MiB | - MiB | - | 0.6 MiB |
| jimp | logo-to-gif | 2185.0 ms | 2185.2 ms | 2366.3 ms | 362.6 MiB | 246.5 MiB | 19.4 MiB | 9.7 MiB | - MiB | - MiB | - | 0.0 MiB |
| sharp | jpeg-to-gif | 958.2 ms | 960.0 ms | 958.5 ms | 151.9 MiB | 32.9 MiB | 14.9 MiB | 4.4 MiB | - MiB | - MiB | - | 0.5 MiB |
| sharp | logo-to-gif | 39.0 ms | 39.4 ms | 39.5 ms | 123.9 MiB | 19.1 MiB | 9.7 MiB | 0.1 MiB | - MiB | - MiB | - | 0.1 MiB |
| sharp-single-thread | jpeg-to-gif | 950.2 ms | 955.6 ms | 951.1 ms | 146.9 MiB | 27.6 MiB | 14.9 MiB | 4.4 MiB | - MiB | - MiB | - | 0.5 MiB |
| sharp-single-thread | logo-to-gif | 39.3 ms | 50.2 ms | 39.8 ms | 124.3 MiB | 19.0 MiB | 9.7 MiB | 0.1 MiB | - MiB | - MiB | - | 0.1 MiB |
| imagescript | jpeg-to-gif | 559.5 ms | 574.3 ms | 706.1 ms | 155.4 MiB | 36.7 MiB | 53.2 MiB | 43.6 MiB | - MiB | - MiB | - | 0.4 MiB |
| imagescript | logo-to-gif | 21.5 ms | 23.4 ms | 40.2 ms | 102.8 MiB | 3.1 MiB | 22.4 MiB | 12.7 MiB | - MiB | - MiB | - | 0.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 25.8 ms | 93.7 MiB | 1.9 ms (pass) | 468.3 ms (pass) | 9.1 MiB | 1 |
| purejsimage-wasm | 31.4 ms | 93.6 MiB | 1.9 ms (pass) | 140.7 ms (pass) | 9.1 MiB | 1 |
| jimp | 90.3 ms | 97.9 MiB | 2330.8 ms (pass) | 1355.5 ms (pass) | 31.2 MiB | 64 |
| sharp | 26.0 ms | 94.7 MiB | 1.7 ms (pass) | 66.9 ms (pass) | 19.4 MiB | 6 |
| sharp-single-thread | 25.2 ms | 94.8 MiB | 1.8 ms (pass) | 67.0 ms (pass) | 19.4 MiB | 6 |
| imagescript | 79.2 ms | 94.9 MiB | 1023.5 ms (pass) | 575.3 ms (pass) | 2.5 MiB | 1 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
