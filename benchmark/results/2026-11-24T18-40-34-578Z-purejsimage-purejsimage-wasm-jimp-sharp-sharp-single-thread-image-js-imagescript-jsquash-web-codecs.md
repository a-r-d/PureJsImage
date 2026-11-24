# Benchmark result

Created: 2026-11-24T18:40:34.578Z

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
| purejsimage | jpeg-resize-1200 | 495.7 ms | 499.5 ms | 587.1 ms | 141.1 MiB | 3.2 MiB | 18.9 MiB | 9.5 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 349.5 ms | 349.8 ms | 548.9 ms | 181.0 MiB | 1.3 MiB | 20.1 MiB | 10.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 65.3 ms | 69.9 ms | 90.0 ms | 138.0 MiB | 4.5 MiB | 18.6 MiB | 9.1 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 440.1 ms | 483.8 ms | 544.6 ms | 150.8 MiB | 6.2 MiB | 15.7 MiB | 6.3 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | lambda-twilio-mms-jpeg-1024 | 503.3 ms | 505.9 ms | 615.8 ms | 143.1 MiB | 6.2 MiB | 17.7 MiB | 8.3 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage | jpeg-progressive-resize-1200 | 815.7 ms | 847.6 ms | 1026.9 ms | 181.8 MiB | 37.5 MiB | 51.6 MiB | 42.2 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage | stress-100mp-downscale | 1212.0 ms | 1236.1 ms | 1996.5 ms | 204.2 MiB | 69.5 MiB | 31.5 MiB | 21.9 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 479.9 ms | 483.7 ms | 567.1 ms | 144.5 MiB | 6.9 MiB | 19.3 MiB | 9.4 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 405.4 ms | 411.1 ms | 581.5 ms | 182.0 MiB | 1.5 MiB | 22.1 MiB | 10.9 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 66.5 ms | 75.6 ms | 90.1 ms | 143.2 MiB | 4.6 MiB | 21.8 MiB | 11.2 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 251.4 ms | 251.4 ms | 277.9 ms | 139.7 MiB | 1.2 MiB | 15.4 MiB | 4.5 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | lambda-twilio-mms-jpeg-1024 | 478.7 ms | 543.3 ms | 571.9 ms | 140.4 MiB | 4.4 MiB | 18.2 MiB | 8.3 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage-wasm | jpeg-progressive-resize-1200 | 775.8 ms | 836.6 ms | 962.8 ms | 181.8 MiB | 38.2 MiB | 52.1 MiB | 42.2 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1461.0 ms | 1585.1 ms | 2419.0 ms | 208.3 MiB | 72.2 MiB | 36.4 MiB | 23.6 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1345.8 ms | 1380.3 ms | 1595.5 ms | 630.7 MiB | 170.3 MiB | 27.5 MiB | 17.8 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 999.9 ms | 1004.7 ms | 1137.9 ms | 315.1 MiB | 145.2 MiB | 124.8 MiB | 115.1 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 85.9 ms | 87.5 ms | 139.9 ms | 137.8 MiB | 7.2 MiB | 27.8 MiB | 18.1 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 732.3 ms | 756.1 ms | 827.9 ms | 300.0 MiB | 77.3 MiB | 109.0 MiB | 99.3 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | lambda-twilio-mms-jpeg-1024 | 1462.4 ms | 1492.6 ms | 1747.6 ms | 609.7 MiB | 130.3 MiB | 131.1 MiB | 121.5 MiB | - MiB | - MiB | - | 0.3 MiB |
| jimp | jpeg-progressive-resize-1200 | 1486.2 ms | 1497.5 ms | 1722.1 ms | 560.5 MiB | 165.3 MiB | 21.1 MiB | 11.4 MiB | - MiB | - MiB | 32.76 dB | 0.4 MiB |
| jimp | stress-100mp-downscale | 3811.4 ms | 3864.0 ms | 3943.8 ms | 1288.9 MiB | 1163.9 MiB | 578.2 MiB | 568.6 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 67.5 ms | 68.5 ms | 75.9 ms | 144.5 MiB | 16.7 MiB | 14.4 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 269.3 ms | 270.7 ms | 314.0 ms | 177.1 MiB | 36.7 MiB | 21.0 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 12.0 ms | 12.2 ms | 13.6 ms | 120.8 MiB | 8.6 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 63.6 ms | 65.3 ms | 74.5 ms | 123.5 MiB | 10.2 MiB | 12.1 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | lambda-twilio-mms-jpeg-1024 | 67.5 ms | 69.6 ms | 73.7 ms | 140.6 MiB | 14.8 MiB | 14.3 MiB | 4.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp | jpeg-progressive-resize-1200 | 141.0 ms | 165.7 ms | 148.6 ms | 207.8 MiB | 51.2 MiB | 12.6 MiB | 2.8 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp | stress-100mp-downscale | 650.5 ms | 666.1 ms | 688.5 ms | 207.9 MiB | 83.6 MiB | 28.7 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 68.3 ms | 71.5 ms | 76.9 ms | 140.4 MiB | 16.7 MiB | 14.4 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 269.1 ms | 275.1 ms | 327.9 ms | 177.1 MiB | 36.9 MiB | 21.0 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 12.0 ms | 12.1 ms | 13.2 ms | 120.4 MiB | 8.8 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 63.3 ms | 63.5 ms | 71.7 ms | 123.6 MiB | 10.0 MiB | 12.1 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | lambda-twilio-mms-jpeg-1024 | 67.3 ms | 73.3 ms | 74.0 ms | 137.4 MiB | 14.9 MiB | 14.3 MiB | 4.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp-single-thread | jpeg-progressive-resize-1200 | 143.7 ms | 145.6 ms | 152.3 ms | 208.0 MiB | 51.1 MiB | 12.6 MiB | 2.8 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 696.8 ms | 726.7 ms | 735.0 ms | 202.7 MiB | 83.7 MiB | 28.7 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 973.2 ms | 988.3 ms | 1198.4 ms | 579.8 MiB | 115.7 MiB | 126.6 MiB | 117.2 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 737.3 ms | 741.0 ms | 878.4 ms | 292.6 MiB | 155.7 MiB | 35.8 MiB | 26.3 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 79.7 ms | 82.7 ms | 130.3 ms | 137.0 MiB | 6.8 MiB | 30.7 MiB | 21.3 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 695.1 ms | 727.1 ms | 820.0 ms | 318.9 MiB | 95.7 MiB | 95.9 MiB | 86.4 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | lambda-twilio-mms-jpeg-1024 | 904.1 ms | 907.0 ms | 1090.8 ms | 582.4 MiB | 127.3 MiB | 125.4 MiB | 115.9 MiB | - MiB | - MiB | - | 0.3 MiB |
| image-js | jpeg-progressive-resize-1200 | 1174.2 ms | 1177.9 ms | 1355.9 ms | 517.7 MiB | 169.0 MiB | 117.3 MiB | 107.8 MiB | - MiB | - MiB | 20.34 dB | 0.4 MiB |
| image-js | stress-100mp-downscale | 1953.4 ms | 1997.5 ms | 2261.7 ms | 1280.5 MiB | 1149.3 MiB | 45.3 MiB | 35.9 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| imagescript | jpeg-resize-1200 | 543.3 ms | 565.6 ms | 644.2 ms | 211.4 MiB | 96.8 MiB | 70.6 MiB | 61.0 MiB | - MiB | - MiB | 30.19 dB | 0.3 MiB |
| imagescript | png-resize-1000 | 493.4 ms | 499.8 ms | 551.2 ms | 299.6 MiB | 141.9 MiB | 209.0 MiB | 199.4 MiB | - MiB | - MiB | 34.54 dB | 0.1 MiB |
| imagescript | png-alpha-resize | 36.8 ms | 41.4 ms | 54.5 ms | 119.9 MiB | 4.2 MiB | 25.0 MiB | 15.4 MiB | - MiB | - MiB | 47.19 dB | 0.0 MiB |
| imagescript | jpeg-to-png | 527.3 ms | 537.4 ms | 615.2 ms | 179.7 MiB | 66.4 MiB | 76.6 MiB | 67.0 MiB | - MiB | - MiB | 55.05 dB | 1.6 MiB |
| imagescript | lambda-twilio-mms-jpeg-1024 | 521.1 ms | 607.7 ms | 617.7 ms | 206.0 MiB | 89.6 MiB | 67.8 MiB | 58.2 MiB | - MiB | - MiB | - | 0.2 MiB |
| imagescript | jpeg-progressive-resize-1200 | 746.0 ms | 785.5 ms | 874.1 ms | 213.3 MiB | 94.3 MiB | 68.7 MiB | 59.1 MiB | - MiB | - MiB | 30.24 dB | 0.3 MiB |
| imagescript | stress-100mp-downscale | 1276.1 ms | 1316.0 ms | 1417.7 ms | 1268.4 MiB | 1147.5 MiB | 419.9 MiB | 410.3 MiB | - MiB | - MiB | 53.28 dB | 0.0 MiB |
| jsquash | jpeg-resize-1200 | 1109.3 ms | 1117.3 ms | 1120.4 ms | 586.6 MiB | 50.7 MiB | 499.9 MiB | 105.1 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 823.8 ms | 827.0 ms | 824.1 ms | 518.2 MiB | 46.4 MiB | 425.4 MiB | 68.0 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 64.2 ms | 65.5 ms | 70.4 ms | 135.8 MiB | 0.7 MiB | 40.8 MiB | 3.4 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 89.5 ms | 92.1 ms | 90.6 ms | 207.3 MiB | 22.9 MiB | 116.4 MiB | 46.9 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | lambda-twilio-mms-jpeg-1024 | 967.6 ms | 971.2 ms | 980.4 ms | 566.7 MiB | 46.8 MiB | 478.0 MiB | 103.9 MiB | - MiB | - MiB | - | 0.2 MiB |
| jsquash | jpeg-progressive-resize-1200 | 1176.5 ms | 1269.7 ms | 1191.4 ms | 613.5 MiB | 50.8 MiB | 527.0 MiB | 101.4 MiB | - MiB | - MiB | 28.71 dB | 0.3 MiB |
| jsquash | stress-100mp-downscale | 6884.4 ms | 6985.6 ms | 7022.8 ms | 2998.7 MiB | 2866.1 MiB | 2914.0 MiB | 421.9 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 83.8 ms | 111.4 MiB | 2.2 ms (pass) | 517.0 ms (pass) | 8.6 MiB | 1 |
| purejsimage-wasm | 90.5 ms | 110.3 MiB | 1.8 ms (pass) | 479.2 ms (pass) | 8.6 MiB | 1 |
| jimp | 94.4 ms | 98.0 MiB | 2497.9 ms (pass) | 1392.3 ms (pass) | 31.2 MiB | 64 |
| sharp | 27.0 ms | 94.6 MiB | 1.7 ms (pass) | 67.2 ms (pass) | 19.4 MiB | 6 |
| sharp-single-thread | 26.1 ms | 94.8 MiB | 1.8 ms (pass) | 66.7 ms (pass) | 19.4 MiB | 6 |
| image-js | 155.2 ms | 106.0 MiB | 2446.2 ms (pass) | 1030.7 ms (pass) | 17.0 MiB | 46 |
| imagescript | 83.2 ms | 94.9 MiB | 1044.5 ms (pass) | 572.0 ms (pass) | 2.5 MiB | 1 |
| jsquash | 12.6 ms | 86.9 MiB | - ms (unsupported) | 1430.1 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
