# Benchmark result

Created: 2026-08-16T17:51:41.269Z

Profile: `web-codecs`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.10.0 (workspace) | pure-javascript |
| purejsimage-wasm | 0.10.0 (workspace WASM) | webassembly |
| jimp | 1.6.0 | pure-javascript |
| sharp | 0.35.3 | native |
| sharp-single-thread | 0.35.3 | native-single-thread |
| image-js | 1.7.0 | pure-javascript |
| jsquash | avif 2.1.1; jpeg 1.6.0; png 3.1.1; webp 1.5.0; resize 2.1.1 | webassembly |

Resize workflows use each engine’s public default kernel. PureJsImage and Sharp use Lanczos 3; Jimp uses bilinear. Cross-kernel timings are default-experience comparisons, not matched-quality comparisons.

## Compatibility

| Engine | Workflow | Status | Detail |
| --- | --- | --- | --- |
| purejsimage | avif-fox-resize-jpeg | pass | - |
| purejsimage-wasm | avif-fox-resize-jpeg | pass | - |
| jimp | avif-fox-resize-jpeg | unsupported | Jimp 1.6.0 has no AVIF decoder |
| sharp | avif-fox-resize-jpeg | pass | - |
| sharp-single-thread | avif-fox-resize-jpeg | pass | - |
| image-js | avif-fox-resize-jpeg | unsupported | image-js 1.7.0 has no AVIF decoder |
| jsquash | avif-fox-resize-jpeg | pass | - |

## Performance on workflows supported by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | External | ArrayBuffer | Source read | Max decoded block | Quality | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| - | No workflow passed for every selected engine | - | - | - | - | - | - | - | - | - | - | - |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 78.2 ms | 104.0 MiB | 1.6 ms (pass) | 860.0 ms (pass) | 4.8 MiB | 1 |
| purejsimage-wasm | 80.9 ms | 110.1 MiB | 1.6 ms (pass) | 808.7 ms (pass) | 4.8 MiB | 1 |
| jimp | 66.7 ms | 93.9 MiB | 2650.8 ms (pass) | 1423.8 ms (pass) | 29.3 MiB | 70 |
| sharp | 28.4 ms | 94.9 MiB | 1.9 ms (pass) | 70.9 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 27.6 ms | 95.0 MiB | 2.0 ms (pass) | 69.4 ms (pass) | 18.9 MiB | 6 |
| image-js | 168.8 ms | 103.2 MiB | 2718.8 ms (pass) | 1048.4 ms (pass) | 17.0 MiB | 46 |
| jsquash | 12.7 ms | 86.8 MiB | - ms (unsupported) | 1479.3 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
