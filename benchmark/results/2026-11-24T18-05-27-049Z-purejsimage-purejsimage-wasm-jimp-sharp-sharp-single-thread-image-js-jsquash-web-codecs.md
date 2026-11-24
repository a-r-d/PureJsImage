# Benchmark result

Created: 2026-11-24T18:05:27.049Z

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
| purejsimage | jpeg-resize-1200 | 496.6 ms | 498.1 ms | 589.4 ms | 142.7 MiB | 5.0 MiB | 18.9 MiB | 9.5 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 361.9 ms | 368.5 ms | 565.4 ms | 187.5 MiB | 1.4 MiB | 54.2 MiB | 10.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 66.7 ms | 77.4 ms | 92.6 ms | 135.8 MiB | 3.2 MiB | 18.6 MiB | 9.1 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 429.3 ms | 439.9 ms | 535.7 ms | 150.1 MiB | 4.8 MiB | 15.5 MiB | 6.1 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | lambda-twilio-mms-jpeg-1024 | 487.5 ms | 499.8 ms | 569.3 ms | 141.9 MiB | 5.5 MiB | 17.7 MiB | 8.3 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage | jpeg-progressive-resize-1200 | 848.6 ms | 857.2 ms | 1106.9 ms | 182.1 MiB | 37.6 MiB | 51.8 MiB | 42.4 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage | stress-100mp-downscale | 1439.4 ms | 1587.8 ms | 2323.5 ms | 205.1 MiB | 71.7 MiB | 31.5 MiB | 21.9 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 461.1 ms | 463.0 ms | 536.1 ms | 141.2 MiB | 4.7 MiB | 19.3 MiB | 9.4 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 399.7 ms | 421.1 ms | 576.2 ms | 185.4 MiB | 1.5 MiB | 24.8 MiB | 10.9 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 64.8 ms | 65.6 ms | 87.7 ms | 139.9 MiB | 4.6 MiB | 21.8 MiB | 11.2 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 244.6 ms | 277.5 ms | 278.0 ms | 139.5 MiB | 1.5 MiB | 15.4 MiB | 4.5 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | lambda-twilio-mms-jpeg-1024 | 462.9 ms | 467.6 ms | 556.6 ms | 137.9 MiB | 3.6 MiB | 18.2 MiB | 8.3 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage-wasm | jpeg-progressive-resize-1200 | 732.5 ms | 753.0 ms | 903.0 ms | 181.5 MiB | 36.9 MiB | 52.1 MiB | 42.2 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1343.5 ms | 1344.7 ms | 2200.6 ms | 207.2 MiB | 69.8 MiB | 36.4 MiB | 23.7 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1369.9 ms | 1399.5 ms | 1621.4 ms | 603.4 MiB | 173.8 MiB | 27.5 MiB | 17.8 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 1110.3 ms | 1126.5 ms | 1223.8 ms | 317.0 MiB | 146.5 MiB | 124.8 MiB | 115.1 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 103.9 ms | 122.9 ms | 156.3 ms | 137.1 MiB | 7.7 MiB | 27.8 MiB | 18.1 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 765.2 ms | 782.1 ms | 869.0 ms | 297.4 MiB | 77.9 MiB | 109.0 MiB | 99.3 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | lambda-twilio-mms-jpeg-1024 | 1439.1 ms | 1486.4 ms | 1676.4 ms | 627.4 MiB | 168.6 MiB | 181.1 MiB | 171.4 MiB | - MiB | - MiB | - | 0.3 MiB |
| jimp | jpeg-progressive-resize-1200 | 1492.5 ms | 1546.4 ms | 1734.4 ms | 560.6 MiB | 165.6 MiB | 21.1 MiB | 11.4 MiB | - MiB | - MiB | 32.76 dB | 0.4 MiB |
| jimp | stress-100mp-downscale | 3911.7 ms | 3989.0 ms | 4107.0 ms | 1288.8 MiB | 1163.9 MiB | 578.2 MiB | 568.6 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 70.5 ms | 89.0 ms | 79.6 ms | 141.7 MiB | 16.5 MiB | 14.4 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 272.2 ms | 301.3 ms | 325.8 ms | 177.5 MiB | 36.8 MiB | 21.0 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 12.1 ms | 15.8 ms | 13.1 ms | 121.1 MiB | 8.8 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 63.2 ms | 79.2 ms | 72.3 ms | 123.4 MiB | 10.1 MiB | 12.1 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | lambda-twilio-mms-jpeg-1024 | 70.9 ms | 72.4 ms | 77.2 ms | 137.3 MiB | 14.8 MiB | 14.3 MiB | 4.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp | jpeg-progressive-resize-1200 | 168.8 ms | 190.8 ms | 178.9 ms | 206.7 MiB | 50.9 MiB | 12.6 MiB | 2.8 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp | stress-100mp-downscale | 701.6 ms | 844.6 ms | 742.4 ms | 204.9 MiB | 83.9 MiB | 28.7 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 68.1 ms | 71.3 ms | 76.4 ms | 140.9 MiB | 16.8 MiB | 14.4 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 259.1 ms | 270.2 ms | 301.7 ms | 177.5 MiB | 36.7 MiB | 21.0 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.7 ms | 12.0 ms | 12.8 ms | 121.2 MiB | 8.6 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 64.3 ms | 68.8 ms | 73.1 ms | 123.7 MiB | 9.8 MiB | 12.1 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | lambda-twilio-mms-jpeg-1024 | 66.1 ms | 67.3 ms | 72.5 ms | 137.9 MiB | 14.8 MiB | 14.3 MiB | 4.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp-single-thread | jpeg-progressive-resize-1200 | 139.7 ms | 139.7 ms | 148.0 ms | 208.1 MiB | 51.2 MiB | 12.6 MiB | 2.8 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 653.0 ms | 657.3 ms | 688.5 ms | 204.8 MiB | 83.7 MiB | 28.7 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1023.5 ms | 1036.4 ms | 1224.3 ms | 580.1 MiB | 117.9 MiB | 126.6 MiB | 117.2 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 736.0 ms | 800.8 ms | 873.9 ms | 291.4 MiB | 154.2 MiB | 35.8 MiB | 26.3 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 81.9 ms | 88.3 ms | 132.3 ms | 129.7 MiB | 11.5 MiB | 18.3 MiB | 8.8 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 693.6 ms | 704.4 ms | 804.2 ms | 316.8 MiB | 87.4 MiB | 95.9 MiB | 86.4 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | lambda-twilio-mms-jpeg-1024 | 919.9 ms | 970.8 ms | 1120.7 ms | 583.6 MiB | 127.0 MiB | 125.4 MiB | 115.9 MiB | - MiB | - MiB | - | 0.3 MiB |
| image-js | jpeg-progressive-resize-1200 | 1160.5 ms | 1162.2 ms | 1339.3 ms | 505.5 MiB | 136.3 MiB | 117.3 MiB | 107.8 MiB | - MiB | - MiB | 20.34 dB | 0.4 MiB |
| image-js | stress-100mp-downscale | 2007.2 ms | 2010.6 ms | 2322.4 ms | 1279.4 MiB | 1151.0 MiB | 45.3 MiB | 35.9 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1110.3 ms | 1116.4 ms | 1121.7 ms | 587.0 MiB | 50.7 MiB | 499.9 MiB | 105.1 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 828.3 ms | 842.2 ms | 828.6 ms | 517.3 MiB | 46.5 MiB | 425.4 MiB | 68.0 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 64.7 ms | 64.9 ms | 71.1 ms | 132.7 MiB | 0.8 MiB | 40.8 MiB | 3.4 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 92.6 ms | 108.5 ms | 93.5 ms | 205.4 MiB | 23.0 MiB | 116.4 MiB | 46.9 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | lambda-twilio-mms-jpeg-1024 | 968.7 ms | 991.4 ms | 981.9 ms | 566.2 MiB | 46.6 MiB | 478.0 MiB | 103.9 MiB | - MiB | - MiB | - | 0.2 MiB |
| jsquash | jpeg-progressive-resize-1200 | 1187.5 ms | 1226.2 ms | 1202.2 ms | 612.7 MiB | 51.1 MiB | 527.0 MiB | 101.4 MiB | - MiB | - MiB | 28.71 dB | 0.3 MiB |
| jsquash | stress-100mp-downscale | 6941.4 ms | 7150.7 ms | 7076.8 ms | 2998.0 MiB | 2868.8 MiB | 2914.0 MiB | 421.9 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 86.4 ms | 111.1 MiB | 1.8 ms (pass) | 511.7 ms (pass) | 8.6 MiB | 1 |
| purejsimage-wasm | 91.1 ms | 110.6 MiB | 1.9 ms (pass) | 485.7 ms (pass) | 8.6 MiB | 1 |
| jimp | 96.3 ms | 98.3 MiB | 2507.6 ms (pass) | 1348.3 ms (pass) | 31.2 MiB | 64 |
| sharp | 28.3 ms | 94.6 MiB | 2.1 ms (pass) | 72.4 ms (pass) | 19.4 MiB | 6 |
| sharp-single-thread | 27.6 ms | 95.4 MiB | 2.0 ms (pass) | 70.3 ms (pass) | 19.4 MiB | 6 |
| image-js | 171.1 ms | 105.8 MiB | 2403.0 ms (pass) | 1060.6 ms (pass) | 17.0 MiB | 46 |
| jsquash | 13.2 ms | 86.7 MiB | - ms (unsupported) | 1480.4 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
