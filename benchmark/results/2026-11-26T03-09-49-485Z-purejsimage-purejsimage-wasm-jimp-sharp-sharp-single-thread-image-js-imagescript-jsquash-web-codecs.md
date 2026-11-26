# Benchmark result

Created: 2026-11-26T03:09:49.485Z

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
| purejsimage | jpeg-resize-1200 | 449.2 ms | 463.5 ms | 544.4 ms | 106.6 MiB | 7.7 MiB | 16.9 MiB | 7.5 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 307.8 ms | 308.8 ms | 520.2 ms | 144.4 MiB | 4.9 MiB | 20.3 MiB | 10.7 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 43.4 ms | 44.1 ms | 77.6 ms | 103.2 MiB | 7.0 MiB | 13.4 MiB | 3.8 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 213.5 ms | 219.3 ms | 282.4 ms | 116.3 MiB | 5.5 MiB | 15.8 MiB | 6.4 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | lambda-twilio-mms-jpeg-1024 | 449.2 ms | 458.7 ms | 536.0 ms | 104.1 MiB | 8.8 MiB | 16.0 MiB | 6.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage | jpeg-progressive-resize-1200 | 559.1 ms | 566.1 ms | 716.0 ms | 137.6 MiB | 41.6 MiB | 50.3 MiB | 40.9 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage | stress-100mp-downscale | 1155.7 ms | 1187.3 ms | 1804.4 ms | 170.8 MiB | 64.9 MiB | 31.6 MiB | 22.0 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 250.0 ms | 264.9 ms | 269.6 ms | 101.6 MiB | 6.5 MiB | 19.0 MiB | 8.7 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 282.8 ms | 287.3 ms | 427.7 ms | 141.0 MiB | 4.5 MiB | 21.0 MiB | 10.7 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 40.1 ms | 40.8 ms | 71.6 ms | 100.5 MiB | 7.7 MiB | 13.2 MiB | 2.9 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 119.8 ms | 120.7 ms | 144.5 ms | 106.1 MiB | 3.4 MiB | 15.3 MiB | 4.6 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | lambda-twilio-mms-jpeg-1024 | 249.3 ms | 249.9 ms | 269.2 ms | 100.4 MiB | 6.4 MiB | 18.5 MiB | 8.2 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage-wasm | jpeg-progressive-resize-1200 | 544.0 ms | 548.4 ms | 678.9 ms | 137.2 MiB | 42.3 MiB | 51.4 MiB | 41.5 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1110.3 ms | 1159.6 ms | 1717.2 ms | 153.3 MiB | 47.1 MiB | 32.3 MiB | 21.9 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1355.0 ms | 1450.6 ms | 1660.2 ms | 568.5 MiB | 271.1 MiB | 27.5 MiB | 17.8 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 876.0 ms | 879.5 ms | 992.9 ms | 299.9 MiB | 153.1 MiB | 124.8 MiB | 115.1 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 70.4 ms | 72.7 ms | 114.1 ms | 117.0 MiB | 10.3 MiB | 21.9 MiB | 12.2 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 652.1 ms | 652.9 ms | 750.9 ms | 258.0 MiB | 78.8 MiB | 109.0 MiB | 99.3 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | lambda-twilio-mms-jpeg-1024 | 1408.6 ms | 1439.5 ms | 1762.6 ms | 584.7 MiB | 303.3 MiB | 131.1 MiB | 121.5 MiB | - MiB | - MiB | - | 0.3 MiB |
| jimp | jpeg-progressive-resize-1200 | 1508.6 ms | 1526.5 ms | 1795.3 ms | 495.8 MiB | 242.4 MiB | 21.1 MiB | 11.4 MiB | - MiB | - MiB | 32.76 dB | 0.4 MiB |
| jimp | stress-100mp-downscale | 3714.6 ms | 3733.9 ms | 3888.4 ms | 1276.6 MiB | 1169.0 MiB | 578.2 MiB | 568.6 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 67.5 ms | 68.3 ms | 75.7 ms | 131.0 MiB | 16.8 MiB | 14.7 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 261.8 ms | 262.8 ms | 304.1 ms | 166.8 MiB | 37.0 MiB | 23.4 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 11.7 ms | 11.8 ms | 12.8 ms | 111.7 MiB | 8.6 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 62.7 ms | 66.7 ms | 71.3 ms | 112.4 MiB | 9.8 MiB | 14.5 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | lambda-twilio-mms-jpeg-1024 | 65.5 ms | 65.5 ms | 71.4 ms | 125.7 MiB | 14.8 MiB | 14.5 MiB | 4.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp | jpeg-progressive-resize-1200 | 137.3 ms | 138.1 ms | 145.5 ms | 197.4 MiB | 50.8 MiB | 12.9 MiB | 2.8 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp | stress-100mp-downscale | 629.2 ms | 633.0 ms | 664.2 ms | 197.2 MiB | 83.4 MiB | 28.7 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 67.6 ms | 68.3 ms | 75.8 ms | 130.7 MiB | 16.5 MiB | 14.7 MiB | 4.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 257.9 ms | 262.3 ms | 301.7 ms | 166.0 MiB | 36.7 MiB | 23.4 MiB | 9.0 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.8 ms | 11.9 ms | 12.7 ms | 110.2 MiB | 8.7 MiB | 9.6 MiB | 0.1 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 62.0 ms | 63.9 ms | 70.4 ms | 115.1 MiB | 10.0 MiB | 14.5 MiB | 0.3 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | lambda-twilio-mms-jpeg-1024 | 65.2 ms | 66.7 ms | 71.2 ms | 126.6 MiB | 14.9 MiB | 14.5 MiB | 4.6 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp-single-thread | jpeg-progressive-resize-1200 | 136.8 ms | 138.1 ms | 145.1 ms | 196.6 MiB | 50.8 MiB | 12.9 MiB | 2.8 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 638.8 ms | 639.8 ms | 672.0 ms | 193.8 MiB | 83.6 MiB | 28.7 MiB | 17.7 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1030.7 ms | 1036.2 ms | 1334.8 ms | 561.1 MiB | 259.5 MiB | 126.6 MiB | 117.2 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 728.8 ms | 729.1 ms | 869.0 ms | 280.8 MiB | 160.3 MiB | 35.6 MiB | 26.2 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 78.2 ms | 79.5 ms | 130.1 ms | 116.4 MiB | 7.3 MiB | 22.3 MiB | 12.8 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 672.7 ms | 673.4 ms | 831.9 ms | 297.0 MiB | 125.8 MiB | 111.9 MiB | 102.4 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | lambda-twilio-mms-jpeg-1024 | 981.3 ms | 995.6 ms | 1268.2 ms | 555.6 MiB | 272.1 MiB | 125.4 MiB | 115.9 MiB | - MiB | - MiB | - | 0.3 MiB |
| image-js | jpeg-progressive-resize-1200 | 1133.3 ms | 1188.1 ms | 1375.2 ms | 449.2 MiB | 193.5 MiB | 117.3 MiB | 107.8 MiB | - MiB | - MiB | 20.34 dB | 0.4 MiB |
| image-js | stress-100mp-downscale | 1913.1 ms | 1946.8 ms | 2173.6 ms | 1266.1 MiB | 1153.2 MiB | 45.3 MiB | 35.8 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| imagescript | jpeg-resize-1200 | 525.5 ms | 532.9 ms | 620.0 ms | 199.1 MiB | 94.5 MiB | 70.6 MiB | 61.0 MiB | - MiB | - MiB | 30.19 dB | 0.3 MiB |
| imagescript | png-resize-1000 | 485.3 ms | 486.8 ms | 549.1 ms | 284.7 MiB | 140.6 MiB | 117.5 MiB | 107.8 MiB | - MiB | - MiB | 34.54 dB | 0.1 MiB |
| imagescript | png-alpha-resize | 37.8 ms | 38.4 ms | 68.0 ms | 104.8 MiB | 5.3 MiB | 18.4 MiB | 8.8 MiB | - MiB | - MiB | 47.19 dB | 0.0 MiB |
| imagescript | jpeg-to-png | 479.2 ms | 481.6 ms | 549.3 ms | 161.1 MiB | 24.3 MiB | 76.6 MiB | 67.0 MiB | - MiB | - MiB | 55.05 dB | 1.6 MiB |
| imagescript | lambda-twilio-mms-jpeg-1024 | 500.4 ms | 500.6 ms | 588.6 ms | 193.9 MiB | 92.7 MiB | 91.4 MiB | 81.7 MiB | - MiB | - MiB | - | 0.2 MiB |
| imagescript | jpeg-progressive-resize-1200 | 727.3 ms | 728.6 ms | 836.5 ms | 200.8 MiB | 101.1 MiB | 68.7 MiB | 59.1 MiB | - MiB | - MiB | 30.24 dB | 0.3 MiB |
| imagescript | stress-100mp-downscale | 1220.7 ms | 1228.7 ms | 1358.7 ms | 1262.9 MiB | 1155.9 MiB | 419.9 MiB | 410.3 MiB | - MiB | - MiB | 53.28 dB | 0.0 MiB |
| jsquash | jpeg-resize-1200 | 1107.8 ms | 1117.0 ms | 1117.7 ms | 577.6 MiB | 50.9 MiB | 500.2 MiB | 105.4 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 818.7 ms | 836.5 ms | 818.2 ms | 508.4 MiB | 47.4 MiB | 426.8 MiB | 69.4 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 65.5 ms | 66.4 ms | 71.4 ms | 124.0 MiB | 0.8 MiB | 41.0 MiB | 3.6 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 93.3 ms | 97.7 ms | 94.2 ms | 198.1 MiB | 23.5 MiB | 118.8 MiB | 49.2 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | lambda-twilio-mms-jpeg-1024 | 958.9 ms | 971.6 ms | 969.0 ms | 557.9 MiB | 46.9 MiB | 478.2 MiB | 104.1 MiB | - MiB | - MiB | - | 0.2 MiB |
| jsquash | jpeg-progressive-resize-1200 | 1155.9 ms | 1159.5 ms | 1165.6 ms | 604.9 MiB | 51.1 MiB | 527.3 MiB | 101.7 MiB | - MiB | - MiB | 28.71 dB | 0.3 MiB |
| jsquash | stress-100mp-downscale | 6837.4 ms | 6842.6 ms | 6973.9 ms | 2994.1 MiB | 2870.6 MiB | 2914.0 MiB | 421.9 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 25.0 ms | 94.1 MiB | 1.9 ms (pass) | 477.5 ms (pass) | 8.7 MiB | 1 |
| purejsimage-wasm | 28.2 ms | 94.0 MiB | 1.8 ms (pass) | 272.2 ms (pass) | 8.7 MiB | 1 |
| jimp | 92.1 ms | 98.3 MiB | 2416.5 ms (pass) | 1306.7 ms (pass) | 31.2 MiB | 64 |
| sharp | 26.0 ms | 94.7 MiB | 1.7 ms (pass) | 66.9 ms (pass) | 19.4 MiB | 6 |
| sharp-single-thread | 25.7 ms | 94.9 MiB | 1.7 ms (pass) | 67.0 ms (pass) | 19.4 MiB | 6 |
| image-js | 153.3 ms | 106.3 MiB | 2395.6 ms (pass) | 1003.0 ms (pass) | 17.0 MiB | 46 |
| imagescript | 80.9 ms | 95.3 MiB | 999.4 ms (pass) | 575.8 ms (pass) | 2.5 MiB | 1 |
| jsquash | 13.0 ms | 86.6 MiB | - ms (unsupported) | 1431.6 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
