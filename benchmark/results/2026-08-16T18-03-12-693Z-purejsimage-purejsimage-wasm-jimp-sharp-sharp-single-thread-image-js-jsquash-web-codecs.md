# Benchmark result

Created: 2026-08-16T18:03:12.693Z

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
| purejsimage | jpeg-resize-1200 | 817.7 ms | 831.5 ms | 921.7 ms | 162.8 MiB | 13.7 MiB | 35.1 MiB | 15.0 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 514.3 ms | 524.0 ms | 754.5 ms | 193.3 MiB | 10.4 MiB | 34.7 MiB | 25.3 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 70.4 ms | 70.9 ms | 106.8 ms | 140.6 MiB | 3.0 MiB | 15.6 MiB | 6.2 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 550.9 ms | 561.5 ms | 637.0 ms | 242.2 MiB | 71.4 MiB | 97.4 MiB | 88.2 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | stress-100mp-downscale | 2450.9 ms | 2560.5 ms | 3298.0 ms | 210.9 MiB | 76.6 MiB | 50.6 MiB | 41.1 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 782.3 ms | 786.7 ms | 850.5 ms | 168.0 MiB | 16.8 MiB | 36.4 MiB | 15.0 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 458.2 ms | 506.8 ms | 629.6 ms | 201.9 MiB | 9.7 MiB | 38.4 MiB | 25.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 66.8 ms | 75.3 ms | 107.3 ms | 141.9 MiB | 3.4 MiB | 19.3 MiB | 7.2 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 260.0 ms | 277.5 ms | 297.1 ms | 212.4 MiB | 51.0 MiB | 100.7 MiB | 88.2 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1469.2 ms | 1489.1 ms | 2357.3 ms | 211.9 MiB | 74.1 MiB | 57.2 MiB | 42.9 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1400.9 ms | 1410.1 ms | 1610.6 ms | 620.9 MiB | 171.6 MiB | 51.4 MiB | 42.1 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 909.4 ms | 911.7 ms | 1010.9 ms | 305.2 MiB | 143.7 MiB | 37.8 MiB | 28.5 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 76.3 ms | 77.0 ms | 123.8 ms | 131.5 MiB | 3.3 MiB | 26.2 MiB | 16.9 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 675.0 ms | 700.1 ms | 796.2 ms | 329.8 MiB | 129.7 MiB | 149.5 MiB | 140.2 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | stress-100mp-downscale | 3883.4 ms | 4033.1 ms | 4072.1 ms | 1263.7 MiB | 1147.4 MiB | 597.8 MiB | 37.5 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 69.4 ms | 73.4 ms | 77.7 ms | 171.9 MiB | 28.9 MiB | 30.6 MiB | 14.0 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 270.7 ms | 276.9 ms | 314.4 ms | 172.8 MiB | 41.9 MiB | 42.2 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 12.0 ms | 12.9 ms | 13.1 ms | 118.7 MiB | 8.9 MiB | 13.4 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 68.2 ms | 75.9 ms | 77.5 ms | 198.1 MiB | 82.9 MiB | 92.7 MiB | 57.6 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | stress-100mp-downscale | 727.1 ms | 765.1 ms | 762.5 ms | 218.1 MiB | 100.2 MiB | 48.3 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 69.7 ms | 80.1 ms | 78.0 ms | 172.1 MiB | 28.2 MiB | 30.6 MiB | 14.0 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 271.8 ms | 283.7 ms | 318.4 ms | 172.5 MiB | 41.7 MiB | 42.2 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.9 ms | 13.3 ms | 13.3 ms | 118.6 MiB | 9.1 MiB | 13.4 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 62.0 ms | 66.5 ms | 71.2 ms | 197.6 MiB | 82.0 MiB | 88.1 MiB | 74.1 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 727.5 ms | 750.3 ms | 765.1 ms | 218.5 MiB | 100.4 MiB | 48.3 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1060.4 ms | 1071.6 ms | 1259.7 ms | 570.8 MiB | 111.4 MiB | 151.0 MiB | 141.6 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 753.1 ms | 761.4 ms | 900.1 ms | 294.4 MiB | 147.4 MiB | 55.0 MiB | 45.7 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 82.1 ms | 88.9 ms | 150.6 ms | 133.4 MiB | 4.9 MiB | 26.1 MiB | 16.8 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 731.7 ms | 740.9 ms | 848.3 ms | 397.0 MiB | 185.2 MiB | 195.6 MiB | 186.3 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | stress-100mp-downscale | 2000.9 ms | 2046.2 ms | 2342.1 ms | 1276.8 MiB | 1151.1 MiB | 64.2 MiB | 54.8 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1122.8 ms | 1194.6 ms | 1126.9 ms | 609.5 MiB | 50.5 MiB | 468.3 MiB | 73.6 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 847.3 ms | 879.8 ms | 847.7 ms | 525.8 MiB | 55.1 MiB | 395.2 MiB | 38.0 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 65.5 ms | 66.3 ms | 72.6 ms | 130.5 MiB | 1.2 MiB | 46.2 MiB | 8.9 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 91.1 ms | 91.4 ms | 92.3 ms | 291.5 MiB | 90.8 MiB | 211.2 MiB | 95.5 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | stress-100mp-downscale | 6959.6 ms | 7052.1 ms | 7096.9 ms | 3011.3 MiB | 2885.0 MiB | 2936.4 MiB | 49.2 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 83.9 ms | 103.7 MiB | 1.6 ms (pass) | 897.7 ms (pass) | 4.8 MiB | 1 |
| purejsimage-wasm | 86.6 ms | 110.2 MiB | 2.5 ms (pass) | 893.3 ms (pass) | 4.8 MiB | 1 |
| jimp | 66.7 ms | 93.8 MiB | 2895.8 ms (pass) | 1600.6 ms (pass) | 29.3 MiB | 70 |
| sharp | 38.9 ms | 94.9 MiB | 2.0 ms (pass) | 72.5 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 28.9 ms | 94.3 MiB | 2.2 ms (pass) | 69.7 ms (pass) | 18.9 MiB | 6 |
| image-js | 170.5 ms | 103.5 MiB | 2817.8 ms (pass) | 1049.6 ms (pass) | 17.0 MiB | 46 |
| jsquash | 12.8 ms | 86.8 MiB | - ms (unsupported) | 1463.8 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
