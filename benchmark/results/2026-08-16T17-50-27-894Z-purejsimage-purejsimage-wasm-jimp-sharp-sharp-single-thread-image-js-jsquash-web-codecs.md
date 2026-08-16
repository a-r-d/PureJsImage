# Benchmark result

Created: 2026-08-16T17:50:27.894Z

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
| purejsimage | avif-fox-metadata | pass | - |
| purejsimage-wasm | avif-fox-metadata | pass | - |
| jimp | avif-fox-metadata | unsupported | Jimp 1.6.0 has no AVIF decoder |
| sharp | avif-fox-metadata | invalid output | format: expected avif, got heif |
| sharp-single-thread | avif-fox-metadata | invalid output | format: expected avif, got heif |
| image-js | avif-fox-metadata | unsupported | image-js 1.7.0 has no AVIF decoder |
| jsquash | avif-fox-metadata | unsupported | jSquash has no metadata inspection API; decoding all AVIF pixels would not be equivalent |

## Performance on workflows supported by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | External | ArrayBuffer | Source read | Max decoded block | Quality | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| - | No workflow passed for every selected engine | - | - | - | - | - | - | - | - | - | - | - |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 77.1 ms | 103.8 MiB | 1.8 ms (pass) | 890.1 ms (pass) | 4.8 MiB | 1 |
| purejsimage-wasm | 78.9 ms | 110.3 MiB | 1.7 ms (pass) | 832.2 ms (pass) | 4.8 MiB | 1 |
| jimp | 63.3 ms | 93.9 MiB | 2598.7 ms (pass) | 1325.7 ms (pass) | 29.3 MiB | 70 |
| sharp | 27.0 ms | 94.9 MiB | 1.9 ms (pass) | 68.0 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 27.0 ms | 94.9 MiB | 1.9 ms (pass) | 70.1 ms (pass) | 18.9 MiB | 6 |
| image-js | 166.3 ms | 103.8 MiB | 2613.9 ms (pass) | 1078.7 ms (pass) | 17.0 MiB | 46 |
| jsquash | 12.3 ms | 86.5 MiB | - ms (unsupported) | 1466.4 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
