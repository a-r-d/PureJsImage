# Benchmark result

Created: 2026-08-18T01:10:00.015Z

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
| jimp | avif-fox-metadata | unsupported | Jimp 1.6.0 has no AVIF decoder |
| jimp | avif-fox-full-png | unsupported | Jimp 1.6.0 has no AVIF decoder |
| jimp | avif-fox-resize-jpeg | unsupported | Jimp 1.6.0 has no AVIF decoder |
| jimp | avif-fox-crop-resize-jpeg | unsupported | Jimp 1.6.0 has no AVIF decoder |
| jimp | jpeg-to-avif | unsupported | Jimp 1.6.0 has no AVIF encoder |
| jimp | jpeg-progressive-resize-1200 | pass | - |
| jimp | tiff-large-resize-jpeg | pass | - |
| jimp | webp-large-resize-jpeg | unsupported | Jimp 1.6.0 has no WebP decoder |
| jimp | webp-lossless-alpha-png | unsupported | Jimp 1.6.0 has no WebP decoder |
| jimp | jpeg-to-webp-lossy | unsupported | Jimp 1.6.0 has no WebP encoder |
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
| purejsimage | jpeg-resize-1200 | 497.2 ms | 500.7 ms | 588.6 ms | 169.0 MiB | 13.3 MiB | 35.3 MiB | 25.9 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 521.6 ms | 527.0 ms | 778.7 ms | 196.2 MiB | 6.5 MiB | 37.2 MiB | 27.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 74.5 ms | 89.0 ms | 118.9 ms | 141.1 MiB | 3.7 MiB | 15.8 MiB | 6.2 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 444.5 ms | 445.4 ms | 546.3 ms | 229.1 MiB | 57.7 MiB | 94.2 MiB | 84.8 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | lambda-twilio-mms-jpeg-1024 | 494.5 ms | 498.3 ms | 582.9 ms | 142.1 MiB | 4.8 MiB | 18.5 MiB | 9.1 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage | jpeg-progressive-resize-1200 | 757.5 ms | 759.0 ms | 947.6 ms | 202.1 MiB | 40.8 MiB | 63.8 MiB | 54.4 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage | stress-100mp-downscale | 2386.0 ms | 2409.9 ms | 3191.0 ms | 208.6 MiB | 71.1 MiB | 52.0 MiB | 42.4 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 462.7 ms | 478.2 ms | 535.8 ms | 169.7 MiB | 15.9 MiB | 36.6 MiB | 25.8 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 443.8 ms | 462.4 ms | 647.7 ms | 197.7 MiB | 6.7 MiB | 38.6 MiB | 25.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 74.6 ms | 75.5 ms | 114.7 ms | 143.0 MiB | 2.9 MiB | 18.7 MiB | 6.4 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 259.2 ms | 279.2 ms | 291.9 ms | 206.5 MiB | 56.2 MiB | 80.9 MiB | 68.3 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | lambda-twilio-mms-jpeg-1024 | 495.1 ms | 580.5 ms | 599.9 ms | 143.7 MiB | 6.4 MiB | 19.8 MiB | 9.1 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage-wasm | jpeg-progressive-resize-1200 | 661.3 ms | 699.5 ms | 833.0 ms | 201.6 MiB | 44.6 MiB | 67.4 MiB | 56.6 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1281.4 ms | 1306.0 ms | 2041.3 ms | 212.8 MiB | 75.6 MiB | 57.4 MiB | 43.0 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1401.1 ms | 1444.8 ms | 1617.1 ms | 597.8 MiB | 173.7 MiB | 51.5 MiB | 42.1 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 870.5 ms | 871.7 ms | 962.5 ms | 309.0 MiB | 147.0 MiB | 37.9 MiB | 28.5 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 73.9 ms | 74.8 ms | 118.3 ms | 137.7 MiB | 10.5 MiB | 26.3 MiB | 16.9 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 665.0 ms | 685.9 ms | 781.4 ms | 330.0 MiB | 129.8 MiB | 125.7 MiB | 116.2 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | lambda-twilio-mms-jpeg-1024 | 1379.3 ms | 1406.1 ms | 1582.3 ms | 601.8 MiB | 164.8 MiB | 181.7 MiB | 172.3 MiB | - MiB | - MiB | - | 0.3 MiB |
| jimp | jpeg-progressive-resize-1200 | 1551.4 ms | 1590.9 ms | 1771.9 ms | 550.9 MiB | 194.2 MiB | 45.1 MiB | 35.7 MiB | - MiB | - MiB | 32.76 dB | 0.4 MiB |
| jimp | stress-100mp-downscale | 3800.4 ms | 3906.4 ms | 3938.8 ms | 1260.7 MiB | 1147.7 MiB | 52.2 MiB | 37.5 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 68.3 ms | 69.2 ms | 76.2 ms | 173.2 MiB | 28.1 MiB | 30.7 MiB | 20.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 263.1 ms | 264.6 ms | 304.5 ms | 173.2 MiB | 41.5 MiB | 42.3 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 11.7 ms | 11.8 ms | 12.9 ms | 118.6 MiB | 9.0 MiB | 13.6 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 62.1 ms | 62.5 ms | 70.7 ms | 198.6 MiB | 83.2 MiB | 92.9 MiB | 74.1 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | lambda-twilio-mms-jpeg-1024 | 66.5 ms | 67.5 ms | 72.1 ms | 134.8 MiB | 15.1 MiB | 15.0 MiB | 5.0 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp | jpeg-progressive-resize-1200 | 137.6 ms | 140.0 ms | 146.2 ms | 233.5 MiB | 60.3 MiB | 28.9 MiB | 18.7 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp | stress-100mp-downscale | 685.8 ms | 727.3 ms | 723.7 ms | 218.4 MiB | 100.3 MiB | 48.4 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 70.5 ms | 72.8 ms | 78.3 ms | 172.8 MiB | 28.2 MiB | 30.7 MiB | 20.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 267.6 ms | 293.4 ms | 308.7 ms | 173.1 MiB | 41.8 MiB | 42.3 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.7 ms | 11.9 ms | 12.8 ms | 118.7 MiB | 9.2 MiB | 13.6 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 62.7 ms | 64.6 ms | 71.4 ms | 198.9 MiB | 83.5 MiB | 92.9 MiB | 78.7 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | lambda-twilio-mms-jpeg-1024 | 66.7 ms | 67.4 ms | 73.1 ms | 134.4 MiB | 14.9 MiB | 15.0 MiB | 5.0 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp-single-thread | jpeg-progressive-resize-1200 | 137.9 ms | 141.4 ms | 146.6 ms | 233.1 MiB | 60.8 MiB | 28.9 MiB | 18.7 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 705.0 ms | 875.7 ms | 747.2 ms | 218.6 MiB | 100.7 MiB | 48.4 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1022.1 ms | 1027.8 ms | 1186.8 ms | 571.0 MiB | 112.2 MiB | 151.1 MiB | 141.6 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 722.6 ms | 734.8 ms | 857.8 ms | 291.2 MiB | 142.9 MiB | 55.2 MiB | 45.7 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 80.6 ms | 81.3 ms | 137.8 ms | 129.2 MiB | 16.6 MiB | 22.3 MiB | 12.8 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 683.6 ms | 686.1 ms | 780.1 ms | 398.2 MiB | 183.8 MiB | 195.7 MiB | 78.7 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | lambda-twilio-mms-jpeg-1024 | 949.1 ms | 950.7 ms | 1123.1 ms | 579.8 MiB | 127.8 MiB | 126.4 MiB | 116.9 MiB | - MiB | - MiB | - | 0.3 MiB |
| image-js | jpeg-progressive-resize-1200 | 1166.7 ms | 1172.0 ms | 1328.0 ms | 524.8 MiB | 179.8 MiB | 141.7 MiB | 132.3 MiB | - MiB | - MiB | 20.34 dB | 0.4 MiB |
| image-js | stress-100mp-downscale | 1898.5 ms | 1953.3 ms | 2205.9 ms | 1274.8 MiB | 1147.4 MiB | 64.3 MiB | 54.8 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1102.8 ms | 1122.8 ms | 1114.3 ms | 605.4 MiB | 46.5 MiB | 468.4 MiB | 73.6 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 825.5 ms | 837.8 ms | 825.8 ms | 525.2 MiB | 55.1 MiB | 395.3 MiB | 38.0 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 63.9 ms | 65.1 ms | 70.1 ms | 131.4 MiB | 0.7 MiB | 46.3 MiB | 8.9 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 90.5 ms | 91.3 ms | 91.5 ms | 293.3 MiB | 90.8 MiB | 211.4 MiB | 95.5 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | lambda-twilio-mms-jpeg-1024 | 949.2 ms | 962.8 ms | 960.2 ms | 558.9 MiB | 46.6 MiB | 478.6 MiB | 104.5 MiB | - MiB | - MiB | - | 0.2 MiB |
| jsquash | jpeg-progressive-resize-1200 | 1156.9 ms | 1166.6 ms | 1171.0 ms | 637.2 MiB | 50.7 MiB | 495.5 MiB | 70.0 MiB | - MiB | - MiB | 28.71 dB | 0.3 MiB |
| jsquash | stress-100mp-downscale | 6872.2 ms | 6960.4 ms | 6995.8 ms | 3006.2 MiB | 2878.8 MiB | 2545.2 MiB | 53.0 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 75.7 ms | 110.0 MiB | 1.5 ms (pass) | 497.7 ms (pass) | 5.0 MiB | 1 |
| purejsimage-wasm | 81.9 ms | 111.2 MiB | 1.7 ms (pass) | 465.5 ms (pass) | 5.0 MiB | 1 |
| jimp | 59.8 ms | 94.1 MiB | 2495.0 ms (pass) | 1405.9 ms (pass) | 29.3 MiB | 70 |
| sharp | 27.4 ms | 95.6 MiB | 1.7 ms (pass) | 67.2 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 26.8 ms | 95.1 MiB | 1.7 ms (pass) | 67.1 ms (pass) | 18.9 MiB | 6 |
| image-js | 161.2 ms | 103.7 MiB | 2560.8 ms (pass) | 1035.4 ms (pass) | 17.0 MiB | 46 |
| jsquash | 13.5 ms | 86.6 MiB | - ms (unsupported) | 1455.6 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
