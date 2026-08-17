# Benchmark result

Created: 2026-08-17T17:24:44.463Z

Profile: `web-codecs`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.11.0 (workspace) | pure-javascript |
| purejsimage-wasm | 0.11.0 (workspace WASM) | webassembly |
| jimp | 1.6.0 | pure-javascript |
| sharp | 0.35.3 | native |
| sharp-single-thread | 0.35.3 | native-single-thread |
| image-js | 1.7.0 | pure-javascript |
| jsquash | avif 2.1.1; jpeg 1.6.0; png 3.1.1; webp 1.5.0; resize 2.1.1 | webassembly |

Resize workflows use each engine’s public default kernel. PureJsImage and Sharp use Lanczos 3; Jimp uses bilinear. Cross-kernel timings are default-experience comparisons, not matched-quality comparisons.

## Compatibility

| Engine | Workflow | Status | Detail |
| --- | --- | --- | --- |
| purejsimage | metadata-jpeg-large | pass | - |
| purejsimage | jpeg-resize-1200 | pass | - |
| purejsimage | northstar-photo-pipeline | pass | - |
| purejsimage | jpeg-crop-resize | pass | - |
| purejsimage | png-resize-1000 | pass | - |
| purejsimage | png-alpha-resize | pass | - |
| purejsimage | jpeg-to-png | pass | - |
| purejsimage | png-to-jpeg | pass | - |
| purejsimage | auto-orient-6 | pass | - |
| purejsimage | avif-fox-metadata | pass | - |
| purejsimage | avif-fox-full-png | pass | - |
| purejsimage | avif-fox-resize-jpeg | pass | - |
| purejsimage | tiff-large-resize-jpeg | pass | - |
| purejsimage | webp-large-resize-jpeg | pass | - |
| purejsimage | stress-100mp-downscale | pass | - |
| purejsimage-wasm | metadata-jpeg-large | pass | - |
| purejsimage-wasm | jpeg-resize-1200 | pass | - |
| purejsimage-wasm | northstar-photo-pipeline | pass | - |
| purejsimage-wasm | jpeg-crop-resize | pass | - |
| purejsimage-wasm | png-resize-1000 | pass | - |
| purejsimage-wasm | png-alpha-resize | pass | - |
| purejsimage-wasm | jpeg-to-png | pass | - |
| purejsimage-wasm | png-to-jpeg | pass | - |
| purejsimage-wasm | auto-orient-6 | pass | - |
| purejsimage-wasm | avif-fox-metadata | pass | - |
| purejsimage-wasm | avif-fox-full-png | pass | - |
| purejsimage-wasm | avif-fox-resize-jpeg | pass | - |
| purejsimage-wasm | tiff-large-resize-jpeg | pass | - |
| purejsimage-wasm | webp-large-resize-jpeg | pass | - |
| purejsimage-wasm | stress-100mp-downscale | pass | - |
| jimp | metadata-jpeg-large | pass | - |
| jimp | jpeg-resize-1200 | pass | - |
| jimp | northstar-photo-pipeline | pass | - |
| jimp | jpeg-crop-resize | pass | - |
| jimp | png-resize-1000 | pass | - |
| jimp | png-alpha-resize | pass | - |
| jimp | jpeg-to-png | pass | - |
| jimp | png-to-jpeg | pass | - |
| jimp | auto-orient-6 | pass | - |
| jimp | avif-fox-metadata | unsupported | Jimp 1.6.0 has no AVIF decoder |
| jimp | avif-fox-full-png | unsupported | Jimp 1.6.0 has no AVIF decoder |
| jimp | avif-fox-resize-jpeg | unsupported | Jimp 1.6.0 has no AVIF decoder |
| jimp | tiff-large-resize-jpeg | pass | - |
| jimp | webp-large-resize-jpeg | unsupported | Jimp 1.6.0 has no WebP decoder |
| jimp | stress-100mp-downscale | pass | - |
| sharp | metadata-jpeg-large | pass | - |
| sharp | jpeg-resize-1200 | pass | - |
| sharp | northstar-photo-pipeline | pass | - |
| sharp | jpeg-crop-resize | pass | - |
| sharp | png-resize-1000 | pass | - |
| sharp | png-alpha-resize | pass | - |
| sharp | jpeg-to-png | pass | - |
| sharp | png-to-jpeg | pass | - |
| sharp | auto-orient-6 | pass | - |
| sharp | avif-fox-metadata | pass | - |
| sharp | avif-fox-full-png | pass | - |
| sharp | avif-fox-resize-jpeg | pass | - |
| sharp | tiff-large-resize-jpeg | pass | - |
| sharp | webp-large-resize-jpeg | pass | - |
| sharp | stress-100mp-downscale | pass | - |
| sharp-single-thread | metadata-jpeg-large | pass | - |
| sharp-single-thread | jpeg-resize-1200 | pass | - |
| sharp-single-thread | northstar-photo-pipeline | pass | - |
| sharp-single-thread | jpeg-crop-resize | pass | - |
| sharp-single-thread | png-resize-1000 | pass | - |
| sharp-single-thread | png-alpha-resize | pass | - |
| sharp-single-thread | jpeg-to-png | pass | - |
| sharp-single-thread | png-to-jpeg | pass | - |
| sharp-single-thread | auto-orient-6 | pass | - |
| sharp-single-thread | avif-fox-metadata | pass | - |
| sharp-single-thread | avif-fox-full-png | pass | - |
| sharp-single-thread | avif-fox-resize-jpeg | pass | - |
| sharp-single-thread | tiff-large-resize-jpeg | pass | - |
| sharp-single-thread | webp-large-resize-jpeg | pass | - |
| sharp-single-thread | stress-100mp-downscale | pass | - |
| image-js | metadata-jpeg-large | pass | - |
| image-js | jpeg-resize-1200 | pass | - |
| image-js | northstar-photo-pipeline | pass | - |
| image-js | jpeg-crop-resize | pass | - |
| image-js | png-resize-1000 | pass | - |
| image-js | png-alpha-resize | pass | - |
| image-js | jpeg-to-png | pass | - |
| image-js | png-to-jpeg | unsupported | image-js cannot flatten transparent pixels onto an explicit background through its image API |
| image-js | auto-orient-6 | unsupported | image-js does not expose EXIF auto-orientation through its image API |
| image-js | avif-fox-metadata | unsupported | image-js 1.7.0 has no AVIF decoder |
| image-js | avif-fox-full-png | unsupported | image-js 1.7.0 has no AVIF decoder |
| image-js | avif-fox-resize-jpeg | unsupported | image-js 1.7.0 has no AVIF decoder |
| image-js | tiff-large-resize-jpeg | pass | - |
| image-js | webp-large-resize-jpeg | unsupported | image-js has no WebP decoder |
| image-js | stress-100mp-downscale | pass | - |
| jsquash | metadata-jpeg-large | unsupported | jSquash has no metadata inspection API; decoding all pixels would not be equivalent |
| jsquash | jpeg-resize-1200 | pass | - |
| jsquash | northstar-photo-pipeline | unsupported | jSquash has no public operation for the workflow's exact crop coordinates |
| jsquash | jpeg-crop-resize | unsupported | jSquash has no public operation for the workflow's exact crop coordinates |
| jsquash | png-resize-1000 | pass | - |
| jsquash | png-alpha-resize | pass | - |
| jsquash | jpeg-to-png | pass | - |
| jsquash | png-to-jpeg | unsupported | jSquash has no public operation for flattening alpha onto an explicit background |
| jsquash | auto-orient-6 | pass | - |
| jsquash | avif-fox-metadata | unsupported | jSquash has no metadata inspection API; decoding all AVIF pixels would not be equivalent |
| jsquash | avif-fox-full-png | pass | - |
| jsquash | avif-fox-resize-jpeg | pass | - |
| jsquash | tiff-large-resize-jpeg | unsupported | jSquash has no TIFF decoder |
| jsquash | webp-large-resize-jpeg | pass | - |
| jsquash | stress-100mp-downscale | pass | - |

## Performance on workflows supported by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | External | ArrayBuffer | Source read | Max decoded block | Quality | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | jpeg-resize-1200 | 776.9 ms | 893.7 ms | 891.2 ms | 163.7 MiB | 13.0 MiB | 35.3 MiB | 15.0 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 524.6 ms | 549.1 ms | 777.3 ms | 187.8 MiB | 4.6 MiB | 34.9 MiB | 25.3 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 73.3 ms | 74.8 ms | 109.6 ms | 139.7 MiB | 2.5 MiB | 15.9 MiB | 6.3 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 541.3 ms | 547.4 ms | 674.4 ms | 227.9 MiB | 57.7 MiB | 97.6 MiB | 88.2 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | stress-100mp-downscale | 2371.3 ms | 2386.5 ms | 3194.2 ms | 209.7 MiB | 73.3 MiB | 50.8 MiB | 41.2 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 686.1 ms | 690.2 ms | 759.8 ms | 171.5 MiB | 19.9 MiB | 36.6 MiB | 25.8 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 434.1 ms | 440.9 ms | 621.2 ms | 203.4 MiB | 10.4 MiB | 38.6 MiB | 25.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 62.6 ms | 64.6 ms | 96.0 ms | 142.8 MiB | 3.0 MiB | 18.6 MiB | 6.3 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 248.0 ms | 261.6 ms | 279.6 ms | 214.8 MiB | 51.9 MiB | 100.9 MiB | 88.2 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1339.1 ms | 1343.6 ms | 2146.4 ms | 210.4 MiB | 72.7 MiB | 58.6 MiB | 44.1 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1419.8 ms | 1453.6 ms | 1628.8 ms | 597.4 MiB | 174.4 MiB | 51.5 MiB | 42.1 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 874.1 ms | 877.3 ms | 977.5 ms | 306.5 MiB | 143.9 MiB | 37.9 MiB | 28.5 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 71.9 ms | 72.0 ms | 117.4 ms | 138.1 MiB | 9.8 MiB | 26.3 MiB | 16.9 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 661.6 ms | 663.9 ms | 773.4 ms | 330.2 MiB | 141.4 MiB | 125.7 MiB | 116.2 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | stress-100mp-downscale | 3807.2 ms | 3875.1 ms | 3924.5 ms | 1277.0 MiB | 1163.3 MiB | 52.2 MiB | 37.5 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 72.2 ms | 72.5 ms | 79.9 ms | 173.4 MiB | 28.2 MiB | 30.7 MiB | 14.0 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 303.0 ms | 314.7 ms | 350.9 ms | 172.4 MiB | 41.9 MiB | 42.3 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 11.4 ms | 11.6 ms | 12.6 ms | 118.8 MiB | 9.1 MiB | 13.6 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 65.3 ms | 66.2 ms | 74.0 ms | 199.4 MiB | 83.2 MiB | 92.9 MiB | 57.6 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | stress-100mp-downscale | 707.4 ms | 708.9 ms | 743.4 ms | 218.7 MiB | 100.3 MiB | 48.4 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 67.9 ms | 69.1 ms | 76.1 ms | 173.0 MiB | 28.0 MiB | 30.7 MiB | 20.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 266.1 ms | 268.6 ms | 308.9 ms | 172.5 MiB | 42.1 MiB | 42.3 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.7 ms | 12.0 ms | 12.8 ms | 119.1 MiB | 9.0 MiB | 13.6 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 62.5 ms | 63.1 ms | 71.4 ms | 199.0 MiB | 83.4 MiB | 92.9 MiB | 57.6 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 706.6 ms | 760.1 ms | 746.2 ms | 218.1 MiB | 100.1 MiB | 48.4 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1020.9 ms | 1141.5 ms | 1194.5 ms | 568.1 MiB | 111.8 MiB | 151.1 MiB | 141.6 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 730.5 ms | 733.2 ms | 867.8 ms | 291.3 MiB | 142.3 MiB | 55.2 MiB | 45.7 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 79.3 ms | 81.9 ms | 134.1 ms | 132.8 MiB | 3.9 MiB | 26.3 MiB | 16.8 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 689.1 ms | 693.0 ms | 786.7 ms | 383.8 MiB | 171.1 MiB | 195.7 MiB | 78.7 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | stress-100mp-downscale | 1944.2 ms | 1959.1 ms | 2262.5 ms | 1275.3 MiB | 1148.1 MiB | 64.3 MiB | 54.8 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1104.0 ms | 1116.9 ms | 1115.3 ms | 608.9 MiB | 50.5 MiB | 468.4 MiB | 73.6 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 834.1 ms | 849.7 ms | 834.4 ms | 524.7 MiB | 54.8 MiB | 395.3 MiB | 38.0 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 65.8 ms | 66.0 ms | 72.2 ms | 130.8 MiB | 0.9 MiB | 46.3 MiB | 8.9 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 91.2 ms | 92.5 ms | 91.9 ms | 291.1 MiB | 90.9 MiB | 211.4 MiB | 95.5 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | stress-100mp-downscale | 6819.6 ms | 6833.2 ms | 6944.4 ms | 3013.5 MiB | 2887.3 MiB | 2936.5 MiB | 444.4 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 74.0 ms | 104.8 MiB | 1.6 ms (pass) | 731.3 ms (pass) | 4.8 MiB | 1 |
| purejsimage-wasm | 82.2 ms | 110.8 MiB | 1.7 ms (pass) | 696.6 ms (pass) | 4.8 MiB | 1 |
| jimp | 62.3 ms | 94.1 MiB | 2608.5 ms (pass) | 1354.0 ms (pass) | 29.3 MiB | 70 |
| sharp | 26.0 ms | 95.4 MiB | 1.7 ms (pass) | 66.8 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 27.3 ms | 95.1 MiB | 1.7 ms (pass) | 67.5 ms (pass) | 18.9 MiB | 6 |
| image-js | 165.1 ms | 105.4 MiB | 2576.9 ms (pass) | 988.4 ms (pass) | 17.0 MiB | 46 |
| jsquash | 11.7 ms | 87.3 MiB | - ms (unsupported) | 1449.9 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
