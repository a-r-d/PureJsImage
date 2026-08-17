# Benchmark result

Created: 2026-08-17T16:53:43.390Z

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
| purejsimage | jpeg-resize-1200 | 1680.9 ms | 1698.2 ms | 1772.4 ms | 161.2 MiB | 11.6 MiB | 35.3 MiB | 16.1 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 515.8 ms | 546.0 ms | 764.4 ms | 200.4 MiB | 19.1 MiB | 34.9 MiB | 25.3 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 71.3 ms | 78.4 ms | 105.9 ms | 140.1 MiB | 2.3 MiB | 15.9 MiB | 6.3 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 541.1 ms | 555.6 ms | 677.5 ms | 228.3 MiB | 58.7 MiB | 97.6 MiB | 88.2 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | stress-100mp-downscale | 2333.9 ms | 2390.9 ms | 3104.7 ms | 208.1 MiB | 70.9 MiB | 50.8 MiB | 41.2 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 732.2 ms | 743.6 ms | 805.2 ms | 171.3 MiB | 18.2 MiB | 36.6 MiB | 15.0 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 435.2 ms | 445.4 ms | 610.3 ms | 196.8 MiB | 8.2 MiB | 38.6 MiB | 25.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 62.5 ms | 63.8 ms | 97.6 ms | 144.7 MiB | 2.7 MiB | 18.7 MiB | 6.4 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 252.2 ms | 254.7 ms | 284.0 ms | 212.5 MiB | 50.8 MiB | 100.9 MiB | 88.2 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1353.5 ms | 1385.7 ms | 2222.5 ms | 211.2 MiB | 73.1 MiB | 57.4 MiB | 42.9 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1450.0 ms | 1456.7 ms | 1682.6 ms | 597.1 MiB | 176.5 MiB | 51.5 MiB | 42.1 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 879.9 ms | 881.9 ms | 974.0 ms | 305.2 MiB | 143.5 MiB | 37.9 MiB | 28.5 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 72.8 ms | 78.3 ms | 116.8 ms | 136.5 MiB | 7.1 MiB | 26.3 MiB | 16.9 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 660.1 ms | 662.9 ms | 780.5 ms | 329.5 MiB | 129.6 MiB | 125.7 MiB | 116.2 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | stress-100mp-downscale | 3846.8 ms | 3907.2 ms | 4008.7 ms | 1278.7 MiB | 1162.8 MiB | 52.2 MiB | 37.5 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 71.2 ms | 78.6 ms | 79.6 ms | 172.8 MiB | 28.3 MiB | 30.7 MiB | 20.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 266.7 ms | 279.0 ms | 309.6 ms | 172.7 MiB | 41.8 MiB | 42.3 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 11.7 ms | 11.7 ms | 13.0 ms | 118.6 MiB | 8.9 MiB | 13.6 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 63.4 ms | 69.9 ms | 72.3 ms | 198.8 MiB | 83.4 MiB | 92.9 MiB | 78.7 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | stress-100mp-downscale | 698.9 ms | 703.7 ms | 727.2 ms | 217.9 MiB | 100.4 MiB | 48.4 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 68.8 ms | 69.9 ms | 77.0 ms | 172.3 MiB | 28.1 MiB | 30.7 MiB | 20.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 267.0 ms | 275.4 ms | 310.1 ms | 172.6 MiB | 41.4 MiB | 42.3 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 12.0 ms | 12.3 ms | 13.0 ms | 119.4 MiB | 9.2 MiB | 13.6 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 62.7 ms | 67.3 ms | 71.0 ms | 198.8 MiB | 83.3 MiB | 92.9 MiB | 74.1 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 676.7 ms | 676.9 ms | 710.3 ms | 218.1 MiB | 100.4 MiB | 48.4 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1015.7 ms | 1039.2 ms | 1213.2 ms | 570.2 MiB | 111.6 MiB | 151.1 MiB | 141.6 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 740.0 ms | 749.7 ms | 887.1 ms | 290.3 MiB | 141.3 MiB | 55.2 MiB | 45.7 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 86.8 ms | 88.0 ms | 157.8 ms | 134.9 MiB | 6.7 MiB | 26.3 MiB | 16.8 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 705.6 ms | 718.9 ms | 811.8 ms | 397.5 MiB | 185.0 MiB | 195.7 MiB | 78.7 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | stress-100mp-downscale | 1896.4 ms | 1968.4 ms | 2212.4 ms | 1277.3 MiB | 1149.6 MiB | 64.3 MiB | 54.8 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1101.1 ms | 1101.8 ms | 1114.4 ms | 609.0 MiB | 50.4 MiB | 468.4 MiB | 73.6 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 825.2 ms | 841.1 ms | 834.2 ms | 528.2 MiB | 55.1 MiB | 395.3 MiB | 38.0 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 63.6 ms | 65.7 ms | 69.6 ms | 130.4 MiB | 0.9 MiB | 46.3 MiB | 8.9 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 91.3 ms | 103.0 ms | 92.1 ms | 292.4 MiB | 91.1 MiB | 211.4 MiB | 95.5 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | stress-100mp-downscale | 7042.3 ms | 7076.1 ms | 7170.4 ms | 3011.9 MiB | 2884.7 MiB | 2936.5 MiB | 49.2 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 74.0 ms | 104.9 MiB | 1.6 ms (pass) | 756.0 ms (pass) | 4.8 MiB | 1 |
| purejsimage-wasm | 89.6 ms | 110.8 MiB | 1.6 ms (pass) | 744.0 ms (pass) | 4.8 MiB | 1 |
| jimp | 60.6 ms | 94.1 MiB | 2717.8 ms (pass) | 1368.8 ms (pass) | 29.3 MiB | 70 |
| sharp | 27.1 ms | 95.0 MiB | 2.0 ms (pass) | 69.9 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 29.1 ms | 95.4 MiB | 2.1 ms (pass) | 74.0 ms (pass) | 18.9 MiB | 6 |
| image-js | 156.1 ms | 104.8 MiB | 2696.3 ms (pass) | 1056.4 ms (pass) | 17.0 MiB | 46 |
| jsquash | 12.5 ms | 86.9 MiB | - ms (unsupported) | 1514.7 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
