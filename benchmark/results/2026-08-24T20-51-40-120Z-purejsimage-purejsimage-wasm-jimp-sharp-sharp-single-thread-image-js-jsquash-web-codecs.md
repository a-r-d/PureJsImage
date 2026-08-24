# Benchmark result

Created: 2026-08-24T20:51:40.120Z

Profile: `web-codecs`

Environment: Linux 6.17.0-41-generic, x64, Node v24.16.0, Intel(R) Core(TM) i7-10700 CPU @ 2.90GHz, 16 logical CPUs

## Engine versions

| Engine | Version | Implementation |
| --- | --- | --- |
| purejsimage | 0.16.0 (workspace) | pure-javascript |
| purejsimage-wasm | 0.16.0 (workspace WASM) | webassembly |
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
| purejsimage | jpeg-resize-1200 | 518.2 ms | 521.6 ms | 614.7 ms | 171.5 MiB | 9.8 MiB | 35.3 MiB | 25.9 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage | png-resize-1000 | 397.7 ms | 411.6 ms | 639.1 ms | 184.8 MiB | 1.8 MiB | 34.9 MiB | 25.3 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage | png-alpha-resize | 65.7 ms | 73.4 ms | 90.8 ms | 142.8 MiB | 4.0 MiB | 23.4 MiB | 13.8 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage | jpeg-to-png | 448.1 ms | 489.1 ms | 559.6 ms | 228.1 MiB | 55.1 MiB | 94.1 MiB | 84.8 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage | lambda-twilio-mms-jpeg-1024 | 520.6 ms | 547.3 ms | 608.9 ms | 139.6 MiB | 4.7 MiB | 18.5 MiB | 9.1 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage | jpeg-progressive-resize-1200 | 787.5 ms | 799.3 ms | 995.1 ms | 201.6 MiB | 40.2 MiB | 67.0 MiB | 57.6 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage | stress-100mp-downscale | 1297.5 ms | 1307.0 ms | 2109.6 ms | 199.8 MiB | 62.3 MiB | 50.8 MiB | 41.2 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-resize-1200 | 473.7 ms | 481.3 ms | 554.7 ms | 171.2 MiB | 10.2 MiB | 35.7 MiB | 25.8 MiB | - MiB | - MiB | 30.02 dB | 0.3 MiB |
| purejsimage-wasm | png-resize-1000 | 435.3 ms | 465.4 ms | 622.3 ms | 200.3 MiB | 10.0 MiB | 36.9 MiB | 25.6 MiB | - MiB | - MiB | exact | 0.0 MiB |
| purejsimage-wasm | png-alpha-resize | 65.3 ms | 66.3 ms | 97.2 ms | 143.9 MiB | 3.0 MiB | 17.1 MiB | 6.6 MiB | - MiB | - MiB | 48.39 dB | 0.0 MiB |
| purejsimage-wasm | jpeg-to-png | 256.0 ms | 287.8 ms | 295.4 ms | 203.1 MiB | 36.1 MiB | 79.2 MiB | 68.3 MiB | - MiB | - MiB | 56.21 dB | 1.6 MiB |
| purejsimage-wasm | lambda-twilio-mms-jpeg-1024 | 467.3 ms | 482.7 ms | 561.7 ms | 142.7 MiB | 3.8 MiB | 18.9 MiB | 9.1 MiB | - MiB | - MiB | - | 0.2 MiB |
| purejsimage-wasm | jpeg-progressive-resize-1200 | 687.9 ms | 692.3 ms | 859.5 ms | 202.7 MiB | 41.4 MiB | 68.4 MiB | 54.4 MiB | - MiB | - MiB | 30.18 dB | 0.3 MiB |
| purejsimage-wasm | stress-100mp-downscale | 1364.8 ms | 1423.3 ms | 2200.8 ms | 207.4 MiB | 72.4 MiB | 55.7 MiB | 42.9 MiB | - MiB | - MiB | 57.84 dB | 0.0 MiB |
| jimp | jpeg-resize-1200 | 1455.8 ms | 1480.5 ms | 1682.1 ms | 595.5 MiB | 175.4 MiB | 51.5 MiB | 42.1 MiB | - MiB | - MiB | 32.60 dB | 0.4 MiB |
| jimp | png-resize-1000 | 891.1 ms | 908.6 ms | 996.3 ms | 302.5 MiB | 141.3 MiB | 37.9 MiB | 28.5 MiB | - MiB | - MiB | 76.83 dB | 0.7 MiB |
| jimp | png-alpha-resize | 73.5 ms | 79.9 ms | 125.9 ms | 126.1 MiB | 7.9 MiB | 26.3 MiB | 16.9 MiB | - MiB | - MiB | 98.86 dB | 0.0 MiB |
| jimp | jpeg-to-png | 665.4 ms | 669.3 ms | 737.4 ms | 327.6 MiB | 98.2 MiB | 125.7 MiB | 116.2 MiB | - MiB | - MiB | exact | 2.0 MiB |
| jimp | lambda-twilio-mms-jpeg-1024 | 1413.3 ms | 1445.6 ms | 1637.9 ms | 621.7 MiB | 162.2 MiB | 181.7 MiB | 172.3 MiB | - MiB | - MiB | - | 0.3 MiB |
| jimp | jpeg-progressive-resize-1200 | 1581.5 ms | 1590.2 ms | 1803.0 ms | 550.3 MiB | 193.9 MiB | 45.1 MiB | 35.7 MiB | - MiB | - MiB | 32.76 dB | 0.4 MiB |
| jimp | stress-100mp-downscale | 3921.8 ms | 4011.6 ms | 4087.6 ms | 1276.1 MiB | 1163.4 MiB | 52.2 MiB | 37.5 MiB | - MiB | - MiB | exact | 0.3 MiB |
| sharp | jpeg-resize-1200 | 70.2 ms | 70.3 ms | 78.6 ms | 167.8 MiB | 22.7 MiB | 30.7 MiB | 20.6 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp | png-resize-1000 | 269.4 ms | 275.7 ms | 311.8 ms | 171.7 MiB | 42.2 MiB | 42.3 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp | png-alpha-resize | 12.2 ms | 12.3 ms | 13.4 ms | 118.3 MiB | 9.0 MiB | 13.6 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp | jpeg-to-png | 66.4 ms | 70.5 ms | 76.1 ms | 198.2 MiB | 82.6 MiB | 92.9 MiB | 57.6 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp | lambda-twilio-mms-jpeg-1024 | 68.2 ms | 68.7 ms | 74.8 ms | 131.4 MiB | 15.1 MiB | 15.0 MiB | 5.0 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp | jpeg-progressive-resize-1200 | 140.7 ms | 147.1 ms | 148.9 ms | 233.4 MiB | 59.3 MiB | 28.9 MiB | 18.7 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp | stress-100mp-downscale | 712.8 ms | 724.1 ms | 749.1 ms | 218.2 MiB | 103.7 MiB | 48.4 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| sharp-single-thread | jpeg-resize-1200 | 73.3 ms | 74.4 ms | 81.9 ms | 167.0 MiB | 20.6 MiB | 24.1 MiB | 14.0 MiB | - MiB | - MiB | 30.15 dB | 0.3 MiB |
| sharp-single-thread | png-resize-1000 | 269.9 ms | 283.7 ms | 318.2 ms | 170.9 MiB | 41.7 MiB | 42.3 MiB | 27.9 MiB | - MiB | - MiB | 41.11 dB | 2.5 MiB |
| sharp-single-thread | png-alpha-resize | 11.7 ms | 12.7 ms | 12.8 ms | 117.8 MiB | 9.1 MiB | 13.6 MiB | 4.0 MiB | - MiB | - MiB | 47.43 dB | 0.0 MiB |
| sharp-single-thread | jpeg-to-png | 63.5 ms | 65.8 ms | 72.5 ms | 197.2 MiB | 81.4 MiB | 88.2 MiB | 74.1 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| sharp-single-thread | lambda-twilio-mms-jpeg-1024 | 69.1 ms | 77.7 ms | 76.3 ms | 130.9 MiB | 14.9 MiB | 15.0 MiB | 5.0 MiB | - MiB | - MiB | - | 0.2 MiB |
| sharp-single-thread | jpeg-progressive-resize-1200 | 143.2 ms | 143.5 ms | 152.0 ms | 232.8 MiB | 58.6 MiB | 28.9 MiB | 18.7 MiB | - MiB | - MiB | 30.29 dB | 0.3 MiB |
| sharp-single-thread | stress-100mp-downscale | 707.1 ms | 723.1 ms | 743.4 ms | 218.0 MiB | 103.4 MiB | 48.4 MiB | 37.4 MiB | - MiB | - MiB | 54.63 dB | 1.5 MiB |
| image-js | jpeg-resize-1200 | 1092.0 ms | 1139.9 ms | 1266.7 ms | 549.1 MiB | 120.4 MiB | 151.1 MiB | 141.6 MiB | - MiB | - MiB | 20.36 dB | 0.4 MiB |
| image-js | png-resize-1000 | 732.3 ms | 739.7 ms | 871.5 ms | 290.5 MiB | 143.1 MiB | 55.1 MiB | 45.7 MiB | - MiB | - MiB | 23.46 dB | 1.6 MiB |
| image-js | png-alpha-resize | 81.3 ms | 82.0 ms | 143.9 ms | 129.9 MiB | 7.0 MiB | 19.1 MiB | 9.6 MiB | - MiB | - MiB | 31.94 dB | 0.0 MiB |
| image-js | jpeg-to-png | 1300.8 ms | 1622.6 ms | 1281.2 ms | 377.2 MiB | 163.0 MiB | 195.7 MiB | 78.7 MiB | - MiB | - MiB | exact | 2.4 MiB |
| image-js | lambda-twilio-mms-jpeg-1024 | 1272.3 ms | 1541.6 ms | 1442.6 ms | 577.2 MiB | 128.0 MiB | 126.3 MiB | 116.9 MiB | - MiB | - MiB | - | 0.3 MiB |
| image-js | jpeg-progressive-resize-1200 | 1225.3 ms | 2159.8 ms | 1408.2 ms | 523.8 MiB | 179.9 MiB | 141.7 MiB | 132.3 MiB | - MiB | - MiB | 20.34 dB | 0.4 MiB |
| image-js | stress-100mp-downscale | 1907.3 ms | 1949.3 ms | 2202.3 ms | 1276.4 MiB | 1149.9 MiB | 64.3 MiB | 54.8 MiB | - MiB | - MiB | 31.63 dB | 1.2 MiB |
| jsquash | jpeg-resize-1200 | 1114.4 ms | 1120.9 ms | 1122.2 ms | 609.3 MiB | 50.5 MiB | 468.4 MiB | 73.6 MiB | - MiB | - MiB | 28.65 dB | 0.3 MiB |
| jsquash | png-resize-1000 | 822.6 ms | 826.9 ms | 822.9 ms | 526.8 MiB | 55.0 MiB | 395.3 MiB | 38.0 MiB | - MiB | - MiB | 36.67 dB | 1.4 MiB |
| jsquash | png-alpha-resize | 63.6 ms | 71.3 ms | 69.6 ms | 131.3 MiB | 0.8 MiB | 46.3 MiB | 8.9 MiB | - MiB | - MiB | 47.73 dB | 0.2 MiB |
| jsquash | jpeg-to-png | 94.2 ms | 103.9 ms | 95.4 ms | 293.0 MiB | 91.3 MiB | 211.4 MiB | 95.5 MiB | - MiB | - MiB | 55.05 dB | 2.3 MiB |
| jsquash | lambda-twilio-mms-jpeg-1024 | 971.7 ms | 993.4 ms | 983.3 ms | 558.7 MiB | 46.8 MiB | 478.6 MiB | 104.5 MiB | - MiB | - MiB | - | 0.2 MiB |
| jsquash | jpeg-progressive-resize-1200 | 1180.9 ms | 1312.3 ms | 1194.5 ms | 636.6 MiB | 50.6 MiB | 495.5 MiB | 70.0 MiB | - MiB | - MiB | 28.71 dB | 0.3 MiB |
| jsquash | stress-100mp-downscale | 6937.0 ms | 6942.4 ms | 7051.8 ms | 3002.1 MiB | 2879.1 MiB | 2545.2 MiB | 49.2 MiB | - MiB | - MiB | 40.26 dB | 1.1 MiB |

## Startup and npm package size

| Engine | Import | RSS after import | First JPEG metadata | First JPEG resize | npm package (unpacked) | Production packages |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| purejsimage | 82.2 ms | 109.8 MiB | 2.4 ms (pass) | 502.5 ms (pass) | 6.3 MiB | 1 |
| purejsimage-wasm | 82.1 ms | 110.4 MiB | 1.6 ms (pass) | 460.4 ms (pass) | 6.3 MiB | 1 |
| jimp | 62.4 ms | 93.8 MiB | 2565.6 ms (pass) | 1390.1 ms (pass) | 29.3 MiB | 70 |
| sharp | 25.6 ms | 94.9 MiB | 1.7 ms (pass) | 68.0 ms (pass) | 18.9 MiB | 6 |
| sharp-single-thread | 26.1 ms | 95.0 MiB | 1.7 ms (pass) | 66.8 ms (pass) | 18.9 MiB | 6 |
| image-js | 161.6 ms | 106.0 MiB | 2638.8 ms (pass) | 1016.6 ms (pass) | 17.0 MiB | 46 |
| jsquash | 13.5 ms | 86.8 MiB | - ms (unsupported) | 1500.5 ms (pass) | 9.8 MiB | 6 |

The `npm package (unpacked)` value is the byte size after npm extracts what it publishes, not the compressed `.tgz` download size. It includes every package required by an engine and the production dependencies present for this platform, including jSquash codec/resize packages and Sharp platform packages. Exact package lists are recorded in JSON; run `npm pack --dry-run --json` for tarball size.

A timing only counts when output validation passes. Input file reads, worker startup, warmups, output validation, and quality measurement are outside warm workflow timings. Startup measurements use a separate fresh process for each engine.

Quality is premultiplied-RGBA PSNR against an independently decoded exact-area reference. `exact` means every compared channel matched. Resize timings use the engine-default kernels identified above, so cross-kernel rows are default-experience rather than matched-quality comparisons. Lossy encoder quality scales are not calibrated; the quality column makes that difference visible but does not by itself turn equal API quality settings into a matched-quality size study.
