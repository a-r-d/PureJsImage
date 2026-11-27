# Benchmark result

Created: 2026-11-27T13:07:40.398Z

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
| purejsimage | jpeg-resize-1200 | 447.4 ms | 471.8 ms | 569.9 ms | 107.9 MiB | 8.0 MiB | 18.1 MiB | 8.6 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 258.9 ms | 259.7 ms | 408.3 ms | 131.4 MiB | 3.6 MiB | 20.0 MiB | 10.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 41.0 ms | 41.0 ms | 76.9 ms | 101.4 MiB | 6.5 MiB | 14.3 MiB | 4.8 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 225.7 ms | 231.1 ms | 304.1 ms | 120.1 MiB | 7.1 MiB | 16.5 MiB | 7.1 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | lambda-twilio-mms-jpeg-1024 | 449.0 ms | 453.4 ms | 534.7 ms | 105.4 MiB | 7.2 MiB | 17.0 MiB | 7.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage | jpeg-progressive-resize-1200 | 565.6 ms | 577.8 ms | 731.4 ms | 139.2 MiB | 42.0 MiB | 49.0 MiB | 39.5 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage | stress-100mp-downscale | 929.0 ms | 934.4 ms | 1341.1 ms | 192.2 MiB | 90.8 MiB | 30.1 MiB | 20.7 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 118.2 ms | 119.3 ms | 119.3 ms | 97.6 MiB | 3.6 MiB | 19.5 MiB | 8.6 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 183.5 ms | 184.9 ms | 280.7 ms | 113.9 MiB | 3.6 MiB | 20.9 MiB | 10.5 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 10.6 ms | 11.0 ms | 17.3 ms | 92.4 MiB | 1.8 MiB | 12.2 MiB | 1.7 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 131.1 ms | 132.0 ms | 164.0 ms | 112.1 MiB | 3.3 MiB | 18.4 MiB | 7.7 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | lambda-twilio-mms-jpeg-1024 | 110.3 ms | 110.4 ms | 111.3 ms | 97.2 MiB | 3.7 MiB | 18.5 MiB | 7.7 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage-wasm | jpeg-progressive-resize-1200 | 223.2 ms | 223.9 ms | 233.9 ms | 132.6 MiB | 39.3 MiB | 52.4 MiB | 41.4 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage-wasm | stress-100mp-downscale | 632.7 ms | 652.6 ms | 1028.1 ms | 140.0 MiB | 36.2 MiB | 31.8 MiB | 21.1 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1361.4 ms | 1416.8 ms | 1671.1 ms | 568.4 MiB | 271.3 MiB | 27.5 MiB | 17.8 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 876.8 ms | 879.5 ms | 991.9 ms | 300.6 MiB | 153.1 MiB | 124.9 MiB | 115.1 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 75.0 ms | 75.6 ms | 119.5 ms | 117.0 MiB | 10.3 MiB | 21.9 MiB | 12.2 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 666.7 ms | 668.9 ms | 777.3 ms | 259.5 MiB | 79.0 MiB | 109.0 MiB | 99.3 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | lambda-twilio-mms-jpeg-1024 | 1429.0 ms | 1436.4 ms | 1765.3 ms | 582.9 MiB | 302.5 MiB | 131.2 MiB | 121.5 MiB | - MiB | - MiB | - | 0.3 MiB |
| jimp | jpeg-progressive-resize-1200 | 1541.7 ms | 1546.6 ms | 1814.0 ms | 496.1 MiB | 242.3 MiB | 21.2 MiB | 11.4 MiB | - MiB | - MiB | 32.76 dB | 0.4 MiB |
| jimp | stress-100mp-downscale | 3784.7 ms | 3802.8 ms | 3919.1 ms | 1273.6 MiB | 1167.1 MiB | 578.3 MiB | 568.6 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 68.1 ms | 68.2 ms | 76.1 ms | 133.8 MiB | 16.6 MiB | 14.8 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 258.2 ms | 258.2 ms | 301.1 ms | 166.5 MiB | 36.5 MiB | 23.5 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 11.7 ms | 11.7 ms | 12.6 ms | 113.4 MiB | 8.7 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 61.5 ms | 61.9 ms | 69.9 ms | 113.2 MiB | 10.1 MiB | 14.5 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | lambda-twilio-mms-jpeg-1024 | 64.8 ms | 65.1 ms | 70.7 ms | 130.1 MiB | 14.8 MiB | 14.6 MiB | 4.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp | jpeg-progressive-resize-1200 | 136.4 ms | 141.2 ms | 144.6 ms | 197.5 MiB | 51.1 MiB | 12.9 MiB | 2.8 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp | stress-100mp-downscale | 637.0 ms | 637.6 ms | 670.9 ms | 194.3 MiB | 83.6 MiB | 28.8 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 68.1 ms | 68.5 ms | 76.4 ms | 131.1 MiB | 16.5 MiB | 14.8 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 257.4 ms | 261.8 ms | 301.3 ms | 167.2 MiB | 36.7 MiB | 23.5 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.6 ms | 11.7 ms | 12.6 ms | 110.7 MiB | 8.7 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 62.2 ms | 66.8 ms | 70.7 ms | 113.1 MiB | 9.6 MiB | 14.5 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | lambda-twilio-mms-jpeg-1024 | 65.0 ms | 65.0 ms | 70.9 ms | 126.9 MiB | 14.7 MiB | 14.6 MiB | 4.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp-single-thread | jpeg-progressive-resize-1200 | 136.8 ms | 137.9 ms | 144.9 ms | 197.5 MiB | 50.6 MiB | 12.9 MiB | 2.8 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 639.8 ms | 649.4 ms | 675.6 ms | 194.0 MiB | 83.6 MiB | 28.8 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1048.4 ms | 1068.5 ms | 1349.3 ms | 560.6 MiB | 259.4 MiB | 126.7 MiB | 117.2 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 718.7 ms | 719.9 ms | 863.8 ms | 279.0 MiB | 157.4 MiB | 35.7 MiB | 26.2 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 78.1 ms | 78.7 ms | 130.9 ms | 118.0 MiB | 6.4 MiB | 22.4 MiB | 12.8 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 682.4 ms | 697.1 ms | 843.0 ms | 291.4 MiB | 120.0 MiB | 95.9 MiB | 86.4 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | lambda-twilio-mms-jpeg-1024 | 970.9 ms | 980.9 ms | 1282.4 ms | 555.7 MiB | 271.3 MiB | 125.4 MiB | 115.9 MiB | - MiB | - MiB | - | 0.3 MiB |
| image-js | jpeg-progressive-resize-1200 | 1160.0 ms | 1163.3 ms | 1371.1 ms | 448.6 MiB | 191.8 MiB | 117.3 MiB | 107.8 MiB | - MiB | - MiB | 20.34 dB | 0.4 MiB |
| image-js | stress-100mp-downscale | 1952.0 ms | 1990.7 ms | 2188.7 ms | 1266.3 MiB | 1154.4 MiB | 45.3 MiB | 35.8 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| imagescript | jpeg-resize-1200 | 530.9 ms | 534.7 ms | 620.0 ms | 201.3 MiB | 100.5 MiB | 98.2 MiB | 88.5 MiB | - MiB | - MiB | 30.19 dB | 0.3 MiB |
| imagescript | png-resize-1000 | 483.3 ms | 487.9 ms | 543.2 ms | 283.7 MiB | 139.5 MiB | 71.6 MiB | 62.0 MiB | - MiB | - MiB | 34.54 dB | 0.1 MiB |
| imagescript | png-alpha-resize | 37.8 ms | 38.3 ms | 68.8 ms | 105.6 MiB | 4.2 MiB | 18.5 MiB | 8.8 MiB | - MiB | - MiB | 47.19 dB | 0.0 MiB |
| imagescript | jpeg-to-png | 476.9 ms | 483.2 ms | 548.5 ms | 161.7 MiB | 25.8 MiB | 76.7 MiB | 67.0 MiB | - MiB | - MiB | 55.05 dB | 1.6 MiB |
| imagescript | lambda-twilio-mms-jpeg-1024 | 506.3 ms | 507.0 ms | 595.1 ms | 194.5 MiB | 92.7 MiB | 67.9 MiB | 58.2 MiB | - MiB | - MiB | - | 0.2 MiB |
| imagescript | jpeg-progressive-resize-1200 | 735.7 ms | 748.2 ms | 842.5 ms | 229.0 MiB | 127.4 MiB | 68.9 MiB | 59.2 MiB | - MiB | - MiB | 30.24 dB | 0.3 MiB |
| imagescript | stress-100mp-downscale | 1241.6 ms | 1262.1 ms | 1376.4 ms | 1261.2 MiB | 1155.8 MiB | 420.0 MiB | 410.3 MiB | - MiB | - MiB | 53.28 dB | 0.0 MiB |
| jsquash | jpeg-resize-1200 | 1094.3 ms | 1126.3 ms | 1105.5 ms | 578.1 MiB | 51.0 MiB | 500.2 MiB | 105.4 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 827.6 ms | 831.8 ms | 827.9 ms | 509.8 MiB | 47.4 MiB | 426.9 MiB | 69.4 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 65.6 ms | 65.9 ms | 71.7 ms | 124.4 MiB | 0.8 MiB | 41.0 MiB | 3.6 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 92.8 ms | 92.8 ms | 93.9 ms | 195.9 MiB | 24.5 MiB | 118.8 MiB | 49.2 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | lambda-twilio-mms-jpeg-1024 | 963.7 ms | 970.7 ms | 973.9 ms | 557.7 MiB | 47.0 MiB | 432.3 MiB | 58.1 MiB | - MiB | - MiB | - | 0.2 MiB |
| jsquash | jpeg-progressive-resize-1200 | 1171.8 ms | 1180.1 ms | 1186.1 ms | 605.3 MiB | 51.1 MiB | 527.3 MiB | 101.7 MiB | - MiB | - MiB | 28.71 dB | 0.3 MiB |
| jsquash | stress-100mp-downscale | 6896.3 ms | 7062.7 ms | 7034.8 ms | 2992.5 MiB | 2872.3 MiB | 2914.1 MiB | 421.9 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 27.6 ms | 93.7 MiB | 1.9 ms (pass) | 484.2 ms (pass) | 9.1 MiB | 1 |
| purejsimage-wasm | 30.8 ms | 94.1 MiB | 1.9 ms (pass) | 140.1 ms (pass) | 9.1 MiB | 1 |
| jimp | 98.4 ms | 98.4 MiB | 2368.9 ms (pass) | 1308.4 ms (pass) | 31.2 MiB | 64 |
| sharp | 27.2 ms | 95.3 MiB | 1.7 ms (pass) | 66.5 ms (pass) | 19.4 MiB | 6 |
| sharp-single-thread | 26.0 ms | 95.4 MiB | 1.8 ms (pass) | 77.3 ms (pass) | 19.4 MiB | 6 |
| image-js | 155.7 ms | 105.6 MiB | 2412.0 ms (pass) | 989.6 ms (pass) | 17.0 MiB | 46 |
| imagescript | 79.6 ms | 95.1 MiB | 1005.1 ms (pass) | 580.5 ms (pass) | 2.5 MiB | 1 |
| jsquash | 13.4 ms | 86.6 MiB | - ms (unsupported) | 1437.3 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
