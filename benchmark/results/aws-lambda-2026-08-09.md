# AWS Lambda benchmark — 2026-08-09

Measured 2026-08-09T04:50:53.569Z in `us-east-1` with Node.js 22 on x86_64. Each cell is the median of 3 verified cold execution environments and 3 immediately paired warm invocations. A configuration nonce forces each cold environment; the handler log stream verifies warm reuse.

Inputs are the pinned 4000x3000 JPEG and deterministic 4000x3000 RGBA PNG corpus fixtures. Each workflow resizes to 1024x768 and validates the encoded format and dimensions. Operation timing excludes fixture reads and output metadata validation; AWS duration includes the complete handler. Cold total is AWS Duration + Init Duration. Max memory is the largest AWS REPORT value across cold and warm samples.

This initial memory-tier experiment embedded both fixtures in the Lambda code ZIP, so its initialization values include a roughly 5.4 MB compressed deployment package. The later ARM64/WASM experiment stages fixtures as separate S3 objects and reduced the deployed code ZIP to 98,517 bytes.

| Memory MiB | Workflow | Cold init ms | Cold duration ms | Cold total ms | Cold operation ms | Warm duration ms | Warm operation ms | Max used MiB | Output bytes |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 256 | jpeg-resize-png | 196.4 | 11497.4 | 11689.2 | 11318.3 | 9911.8 | 9821.9 | 123 | 1,780,541 |
| 256 | jpeg-resize-webp | 196.1 | 12030.5 | 12223.8 | 11878.9 | 10670.5 | 10601.1 | 121 | 289,470 |
| 256 | png-resize-jpeg | 192.8 | 12868.7 | 13076.7 | 12482.1 | 10451.3 | 10339.2 | 146 | 185,517 |
| 256 | png-resize-webp | 199.0 | 12629.1 | 12828.1 | 12260.3 | 10465.3 | 10323.5 | 156 | 877,960 |
| 512 | jpeg-resize-png | 182.1 | 5388.4 | 5570.5 | 5305.5 | 4783.9 | 4758.4 | 123 | 1,780,541 |
| 512 | jpeg-resize-webp | 202.6 | 6100.3 | 6302.9 | 6023.0 | 5271.2 | 5261.4 | 122 | 289,470 |
| 512 | png-resize-jpeg | 198.4 | 6095.5 | 6295.0 | 5917.2 | 5082.4 | 5038.2 | 148 | 185,517 |
| 512 | png-resize-webp | 196.9 | 6145.7 | 6342.3 | 5945.2 | 5234.0 | 5179.2 | 153 | 877,960 |
| 1024 | jpeg-resize-png | 192.4 | 2727.5 | 2910.7 | 2683.4 | 2410.1 | 2387.9 | 123 | 1,780,541 |
| 1024 | jpeg-resize-webp | 202.2 | 2919.9 | 3136.8 | 2893.3 | 2541.7 | 2532.9 | 120 | 289,470 |
| 1024 | png-resize-jpeg | 190.6 | 3000.3 | 3203.4 | 2916.6 | 2472.1 | 2447.4 | 148 | 185,517 |
| 1024 | png-resize-webp | 185.9 | 2894.3 | 3077.3 | 2805.8 | 2501.0 | 2481.7 | 155 | 877,960 |
