# Benchmark result

Created: 2026-11-25T02:42:04.827Z

Profile: `web-codecs`

Environment: Linux 7.0.0-43-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.18.0 (workspace) | pure-javascript |
| purejsimage-wasm | 0.18.0 (workspace WASM) | webassembly |
| jimp | 1.7.0 | pure-javascript |
| sharp | 0.35.5 | native |
| sharp-single-thread | 0.35.5 | native-single-thread |
| image-js | 1.7.0 | pure-javascript |
| imagescript | 4.0.0 | pure-javascript |
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
| purejsimage | lambda-twilio-mms-jpeg-1024 | pass | - |
| purejsimage | avif-fox-metadata | pass | - |
| purejsimage | avif-fox-full-png | pass | - |
| purejsimage | avif-fox-resize-jpeg | pass | - |
| purejsimage | avif-fox-crop-resize-jpeg | pass | - |
| purejsimage | jpeg-to-avif | pass | - |
| purejsimage | jpeg-progressive-resize-1200 | pass | - |
| purejsimage | tiff-large-resize-jpeg | pass | - |
| purejsimage | webp-large-resize-jpeg | pass | - |
| purejsimage | webp-lossless-alpha-png | pass | - |
| purejsimage | jpeg-to-webp-lossy | pass | - |
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
| purejsimage-wasm | lambda-twilio-mms-jpeg-1024 | pass | - |
| purejsimage-wasm | avif-fox-metadata | pass | - |
| purejsimage-wasm | avif-fox-full-png | pass | - |
| purejsimage-wasm | avif-fox-resize-jpeg | pass | - |
| purejsimage-wasm | avif-fox-crop-resize-jpeg | pass | - |
| purejsimage-wasm | jpeg-to-avif | pass | - |
| purejsimage-wasm | jpeg-progressive-resize-1200 | pass | - |
| purejsimage-wasm | tiff-large-resize-jpeg | pass | - |
| purejsimage-wasm | webp-large-resize-jpeg | pass | - |
| purejsimage-wasm | webp-lossless-alpha-png | pass | - |
| purejsimage-wasm | jpeg-to-webp-lossy | pass | - |
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
| jimp | lambda-twilio-mms-jpeg-1024 | pass | - |
| jimp | avif-fox-metadata | unsupported | Jimp 1.7.0 has no AVIF decoder |
| jimp | avif-fox-full-png | unsupported | Jimp 1.7.0 has no AVIF decoder |
| jimp | avif-fox-resize-jpeg | unsupported | Jimp 1.7.0 has no AVIF decoder |
| jimp | avif-fox-crop-resize-jpeg | unsupported | Jimp 1.7.0 has no AVIF decoder |
| jimp | jpeg-to-avif | unsupported | Jimp 1.7.0 has no AVIF encoder |
| jimp | jpeg-progressive-resize-1200 | pass | - |
| jimp | tiff-large-resize-jpeg | pass | - |
| jimp | webp-large-resize-jpeg | unsupported | Jimp 1.7.0 has no WebP decoder |
| jimp | webp-lossless-alpha-png | unsupported | Jimp 1.7.0 has no WebP decoder |
| jimp | jpeg-to-webp-lossy | unsupported | Jimp 1.7.0 has no WebP encoder |
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
| sharp | lambda-twilio-mms-jpeg-1024 | pass | - |
| sharp | avif-fox-metadata | pass | - |
| sharp | avif-fox-full-png | pass | - |
| sharp | avif-fox-resize-jpeg | pass | - |
| sharp | avif-fox-crop-resize-jpeg | pass | - |
| sharp | jpeg-to-avif | pass | - |
| sharp | jpeg-progressive-resize-1200 | pass | - |
| sharp | tiff-large-resize-jpeg | pass | - |
| sharp | webp-large-resize-jpeg | pass | - |
| sharp | webp-lossless-alpha-png | pass | - |
| sharp | jpeg-to-webp-lossy | pass | - |
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
| sharp-single-thread | lambda-twilio-mms-jpeg-1024 | pass | - |
| sharp-single-thread | avif-fox-metadata | pass | - |
| sharp-single-thread | avif-fox-full-png | pass | - |
| sharp-single-thread | avif-fox-resize-jpeg | pass | - |
| sharp-single-thread | avif-fox-crop-resize-jpeg | pass | - |
| sharp-single-thread | jpeg-to-avif | pass | - |
| sharp-single-thread | jpeg-progressive-resize-1200 | pass | - |
| sharp-single-thread | tiff-large-resize-jpeg | pass | - |
| sharp-single-thread | webp-large-resize-jpeg | pass | - |
| sharp-single-thread | webp-lossless-alpha-png | pass | - |
| sharp-single-thread | jpeg-to-webp-lossy | pass | - |
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
| image-js | lambda-twilio-mms-jpeg-1024 | pass | - |
| image-js | avif-fox-metadata | unsupported | image-js 1.7.0 has no AVIF decoder |
| image-js | avif-fox-full-png | unsupported | image-js 1.7.0 has no AVIF decoder |
| image-js | avif-fox-resize-jpeg | unsupported | image-js 1.7.0 has no AVIF decoder |
| image-js | avif-fox-crop-resize-jpeg | unsupported | image-js 1.7.0 has no AVIF decoder |
| image-js | jpeg-to-avif | unsupported | image-js 1.7.0 has no AVIF encoder |
| image-js | jpeg-progressive-resize-1200 | pass | - |
| image-js | tiff-large-resize-jpeg | pass | - |
| image-js | webp-large-resize-jpeg | unsupported | image-js has no WebP decoder |
| image-js | webp-lossless-alpha-png | unsupported | image-js has no WebP decoder |
| image-js | jpeg-to-webp-lossy | unsupported | image-js has no WebP encoder |
| image-js | stress-100mp-downscale | pass | - |
| imagescript | metadata-jpeg-large | pass | - |
| imagescript | jpeg-resize-1200 | pass | - |
| imagescript | northstar-photo-pipeline | pass | - |
| imagescript | jpeg-crop-resize | pass | - |
| imagescript | png-resize-1000 | pass | - |
| imagescript | png-alpha-resize | pass | - |
| imagescript | jpeg-to-png | pass | - |
| imagescript | png-to-jpeg | pass | - |
| imagescript | auto-orient-6 | pass | - |
| imagescript | lambda-twilio-mms-jpeg-1024 | pass | - |
| imagescript | avif-fox-metadata | pass | - |
| imagescript | avif-fox-full-png | pass | - |
| imagescript | avif-fox-resize-jpeg | pass | - |
| imagescript | avif-fox-crop-resize-jpeg | pass | - |
| imagescript | jpeg-to-avif | pass | - |
| imagescript | jpeg-progressive-resize-1200 | pass | - |
| imagescript | tiff-large-resize-jpeg | pass | - |
| imagescript | webp-large-resize-jpeg | pass | - |
| imagescript | webp-lossless-alpha-png | pass | - |
| imagescript | jpeg-to-webp-lossy | pass | - |
| imagescript | stress-100mp-downscale | pass | - |
| jsquash | metadata-jpeg-large | unsupported | jSquash has no metadata inspection API; decoding all pixels would not be equivalent |
| jsquash | jpeg-resize-1200 | pass | - |
| jsquash | northstar-photo-pipeline | unsupported | jSquash has no public operation for the workflow's exact crop coordinates |
| jsquash | jpeg-crop-resize | unsupported | jSquash has no public operation for the workflow's exact crop coordinates |
| jsquash | png-resize-1000 | pass | - |
| jsquash | png-alpha-resize | pass | - |
| jsquash | jpeg-to-png | pass | - |
| jsquash | png-to-jpeg | unsupported | jSquash has no public operation for flattening alpha onto an explicit background |
| jsquash | auto-orient-6 | pass | - |
| jsquash | lambda-twilio-mms-jpeg-1024 | pass | - |
| jsquash | avif-fox-metadata | unsupported | jSquash has no metadata inspection API; decoding all AVIF pixels would not be equivalent |
| jsquash | avif-fox-full-png | pass | - |
| jsquash | avif-fox-resize-jpeg | pass | - |
| jsquash | avif-fox-crop-resize-jpeg | unsupported | jSquash has no public operation for the workflow's exact crop coordinates |
| jsquash | jpeg-to-avif | pass | - |
| jsquash | jpeg-progressive-resize-1200 | pass | - |
| jsquash | tiff-large-resize-jpeg | unsupported | jSquash has no TIFF decoder |
| jsquash | webp-large-resize-jpeg | pass | - |
| jsquash | webp-lossless-alpha-png | pass | - |
| jsquash | jpeg-to-webp-lossy | pass | - |
| jsquash | stress-100mp-downscale | pass | - |

## Performance on workflows supported by every selected engine

| Engine | Workflow | Median wall | p95 wall | Median CPU | Peak RSS | Peak RSS delta | External | ArrayBuffer | Source read | Max decoded block | Quality | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | jpeg-resize-1200 | 505.2 ms | 509.6 ms | 606.8 ms | 144.1 MiB | 4.4 MiB | 18.9 MiB | 9.5 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 345.9 ms | 392.8 ms | 539.9 ms | 178.7 MiB | 1.9 MiB | 20.2 MiB | 10.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 64.5 ms | 64.9 ms | 93.8 ms | 140.3 MiB | 4.6 MiB | 18.7 MiB | 9.1 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 240.5 ms | 251.9 ms | 324.3 ms | 143.7 MiB | 2.9 MiB | 15.5 MiB | 6.1 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | lambda-twilio-mms-jpeg-1024 | 495.2 ms | 506.1 ms | 590.2 ms | 142.0 MiB | 4.3 MiB | 17.8 MiB | 8.4 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage | jpeg-progressive-resize-1200 | 565.0 ms | 570.1 ms | 714.1 ms | 181.8 MiB | 38.5 MiB | 51.5 MiB | 42.1 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage | stress-100mp-downscale | 1268.3 ms | 1283.3 ms | 2082.0 ms | 205.9 MiB | 71.0 MiB | 31.5 MiB | 21.9 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 510.1 ms | 535.9 ms | 591.2 ms | 143.6 MiB | 4.1 MiB | 19.4 MiB | 9.5 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 383.3 ms | 385.1 ms | 531.7 ms | 187.9 MiB | 1.4 MiB | 22.2 MiB | 11.0 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 63.2 ms | 64.3 ms | 85.2 ms | 140.3 MiB | 4.6 MiB | 21.8 MiB | 11.3 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 234.3 ms | 238.5 ms | 261.8 ms | 140.1 MiB | 1.3 MiB | 15.4 MiB | 4.5 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | lambda-twilio-mms-jpeg-1024 | 457.0 ms | 458.4 ms | 540.6 ms | 141.7 MiB | 3.7 MiB | 18.2 MiB | 8.4 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage-wasm | jpeg-progressive-resize-1200 | 576.5 ms | 577.8 ms | 722.1 ms | 179.2 MiB | 40.2 MiB | 52.0 MiB | 42.1 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1399.2 ms | 1593.4 ms | 2305.3 ms | 207.3 MiB | 72.1 MiB | 36.4 MiB | 23.7 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1344.4 ms | 1357.6 ms | 1572.4 ms | 630.2 MiB | 168.5 MiB | 27.5 MiB | 17.8 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 872.4 ms | 891.4 ms | 965.8 ms | 314.7 MiB | 143.0 MiB | 124.8 MiB | 115.1 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 69.5 ms | 70.7 ms | 101.9 ms | 137.7 MiB | 6.7 MiB | 27.8 MiB | 18.1 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 639.6 ms | 640.5 ms | 720.5 ms | 300.3 MiB | 77.8 MiB | 109.0 MiB | 99.3 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | lambda-twilio-mms-jpeg-1024 | 1344.0 ms | 1348.9 ms | 1555.8 ms | 605.9 MiB | 140.1 MiB | 131.1 MiB | 121.5 MiB | - MiB | - MiB | - | 0.3 MiB |
| jimp | jpeg-progressive-resize-1200 | 1490.8 ms | 1491.3 ms | 1741.7 ms | 546.0 MiB | 193.5 MiB | 21.1 MiB | 11.4 MiB | - MiB | - MiB | 32.76 dB | 0.4 MiB |
| jimp | stress-100mp-downscale | 3740.6 ms | 3750.8 ms | 3911.2 ms | 1287.8 MiB | 1162.4 MiB | 578.2 MiB | 568.6 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 68.5 ms | 75.7 ms | 76.7 ms | 141.2 MiB | 16.7 MiB | 14.4 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 258.4 ms | 273.0 ms | 301.7 ms | 177.5 MiB | 37.0 MiB | 21.0 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 12.3 ms | 12.6 ms | 13.8 ms | 120.9 MiB | 8.7 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 65.5 ms | 68.3 ms | 74.3 ms | 122.9 MiB | 10.3 MiB | 12.1 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | lambda-twilio-mms-jpeg-1024 | 67.7 ms | 73.7 ms | 73.7 ms | 137.4 MiB | 15.0 MiB | 14.3 MiB | 4.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp | jpeg-progressive-resize-1200 | 138.5 ms | 139.0 ms | 146.8 ms | 207.9 MiB | 51.1 MiB | 12.6 MiB | 2.8 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp | stress-100mp-downscale | 645.9 ms | 652.6 ms | 683.6 ms | 205.0 MiB | 83.6 MiB | 28.7 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 67.9 ms | 68.2 ms | 76.1 ms | 141.7 MiB | 16.9 MiB | 14.4 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 258.8 ms | 259.1 ms | 301.8 ms | 180.3 MiB | 36.9 MiB | 21.0 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.7 ms | 11.8 ms | 12.7 ms | 124.3 MiB | 8.9 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 61.9 ms | 62.8 ms | 70.4 ms | 126.8 MiB | 10.2 MiB | 12.1 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | lambda-twilio-mms-jpeg-1024 | 65.5 ms | 65.7 ms | 71.4 ms | 137.4 MiB | 15.0 MiB | 14.3 MiB | 4.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp-single-thread | jpeg-progressive-resize-1200 | 137.3 ms | 138.4 ms | 145.8 ms | 207.5 MiB | 50.8 MiB | 12.6 MiB | 2.8 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 641.5 ms | 655.1 ms | 677.4 ms | 204.8 MiB | 83.6 MiB | 28.7 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 983.3 ms | 994.9 ms | 1180.9 ms | 579.3 MiB | 115.4 MiB | 126.6 MiB | 117.2 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 744.1 ms | 816.8 ms | 878.5 ms | 292.8 MiB | 155.9 MiB | 35.8 MiB | 26.3 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 79.8 ms | 82.2 ms | 133.2 ms | 134.9 MiB | 5.8 MiB | 22.3 MiB | 12.8 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 690.8 ms | 694.6 ms | 792.4 ms | 322.5 MiB | 95.5 MiB | 95.9 MiB | 86.4 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | lambda-twilio-mms-jpeg-1024 | 940.7 ms | 941.7 ms | 1134.2 ms | 582.4 MiB | 126.9 MiB | 125.4 MiB | 115.9 MiB | - MiB | - MiB | - | 0.3 MiB |
| image-js | jpeg-progressive-resize-1200 | 1160.5 ms | 1214.9 ms | 1344.9 ms | 516.8 MiB | 167.8 MiB | 117.3 MiB | 107.8 MiB | - MiB | - MiB | 20.34 dB | 0.4 MiB |
| image-js | stress-100mp-downscale | 1957.3 ms | 1989.4 ms | 2292.2 ms | 1281.3 MiB | 1147.6 MiB | 45.3 MiB | 35.9 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| imagescript | jpeg-resize-1200 | 558.8 ms | 591.5 ms | 658.0 ms | 211.4 MiB | 96.7 MiB | 70.6 MiB | 61.0 MiB | - MiB | - MiB | 30.19 dB | 0.3 MiB |
| imagescript | png-resize-1000 | 493.7 ms | 494.5 ms | 555.7 ms | 299.5 MiB | 141.9 MiB | 71.5 MiB | 61.9 MiB | - MiB | - MiB | 34.54 dB | 0.1 MiB |
| imagescript | png-alpha-resize | 35.0 ms | 35.1 ms | 54.7 ms | 119.9 MiB | 4.2 MiB | 25.0 MiB | 15.4 MiB | - MiB | - MiB | 47.19 dB | 0.0 MiB |
| imagescript | jpeg-to-png | 479.1 ms | 505.0 ms | 552.8 ms | 179.7 MiB | 21.5 MiB | 76.6 MiB | 67.0 MiB | - MiB | - MiB | 55.05 dB | 1.6 MiB |
| imagescript | lambda-twilio-mms-jpeg-1024 | 504.2 ms | 506.5 ms | 595.8 ms | 205.9 MiB | 90.0 MiB | 91.4 MiB | 81.7 MiB | - MiB | - MiB | - | 0.2 MiB |
| imagescript | jpeg-progressive-resize-1200 | 723.4 ms | 736.9 ms | 841.9 ms | 212.0 MiB | 93.7 MiB | 68.7 MiB | 59.1 MiB | - MiB | - MiB | 30.24 dB | 0.3 MiB |
| imagescript | stress-100mp-downscale | 1206.3 ms | 1241.8 ms | 1357.9 ms | 1268.3 MiB | 1144.3 MiB | 419.9 MiB | 410.3 MiB | - MiB | - MiB | 53.28 dB | 0.0 MiB |
| jsquash | jpeg-resize-1200 | 1091.8 ms | 1109.0 ms | 1102.7 ms | 586.3 MiB | 47.4 MiB | 499.9 MiB | 105.1 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 819.5 ms | 820.7 ms | 819.9 ms | 519.6 MiB | 46.5 MiB | 425.4 MiB | 68.0 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 63.3 ms | 63.5 ms | 69.4 ms | 134.6 MiB | 0.8 MiB | 40.8 MiB | 3.4 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 89.6 ms | 90.0 ms | 90.7 ms | 206.1 MiB | 22.7 MiB | 116.4 MiB | 46.9 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | lambda-twilio-mms-jpeg-1024 | 952.9 ms | 964.0 ms | 963.7 ms | 566.3 MiB | 46.8 MiB | 478.0 MiB | 103.9 MiB | - MiB | - MiB | - | 0.2 MiB |
| jsquash | jpeg-progressive-resize-1200 | 1157.8 ms | 1186.6 ms | 1170.6 ms | 613.1 MiB | 50.6 MiB | 527.0 MiB | 101.4 MiB | - MiB | - MiB | 28.71 dB | 0.3 MiB |
| jsquash | stress-100mp-downscale | 6982.4 ms | 7098.0 ms | 7128.5 ms | 2994.8 MiB | 2863.8 MiB | 2914.0 MiB | 421.9 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 87.1 ms | 110.8 MiB | 1.8 ms (pass) | 489.3 ms (pass) | 8.6 MiB | 1 |
| purejsimage-wasm | 93.5 ms | 111.5 MiB | 1.8 ms (pass) | 480.1 ms (pass) | 8.6 MiB | 1 |
| jimp | 94.4 ms | 97.7 MiB | 2457.9 ms (pass) | 1338.7 ms (pass) | 31.2 MiB | 64 |
| sharp | 26.7 ms | 94.9 MiB | 1.8 ms (pass) | 71.1 ms (pass) | 19.4 MiB | 6 |
| sharp-single-thread | 27.5 ms | 95.1 MiB | 2.1 ms (pass) | 68.5 ms (pass) | 19.4 MiB | 6 |
| image-js | 164.4 ms | 105.8 MiB | 2761.1 ms (pass) | 1104.6 ms (pass) | 17.0 MiB | 46 |
| imagescript | 86.0 ms | 94.9 MiB | 1054.1 ms (pass) | 617.9 ms (pass) | 2.5 MiB | 1 |
| jsquash | 14.1 ms | 86.6 MiB | - ms (unsupported) | 1504.2 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
