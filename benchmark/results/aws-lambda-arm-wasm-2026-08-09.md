# AWS Lambda ARM64 and JPEG WASM experiment — 2026-08-09

Measured 2026-08-09T05:51:03.589Z in `us-east-1` with Node.js 22 at 512 MiB. Each cell is the median of 3 verified cold execution environments and 3 immediately paired warm invocations. The x86_64 and ARM64 functions use the same JavaScript bundle and WebAssembly module.

The architecture comparison uses the pinned 4000x3000 JPEG and deterministic 4000x3000 RGBA PNG fixtures, resized to 1024x768. The WASM experiment resizes the JPEG to 3000x2250 so the planner requests full-resolution decode and the JPEG accelerator is eligible. A WASM sample is rejected unless the module instantiates exactly once during the cold operation and is reused by the paired warm operation. All accepted outputs have identical SHA-256 values across architectures and engines.

JPEG WASM artifact: 21,100 bytes raw, 5,160 bytes gzip, 4,363 bytes Brotli.

The deployed code ZIP was 98,517 bytes. The 14,160,578 bytes of pinned input fixtures were staged as separate S3 objects, fetched before `operationMs`, and deleted with the benchmark stack.

## Architecture comparison — JavaScript reference

| Workflow | x86 cold total ms | ARM cold total ms | x86 warm operation ms | ARM warm operation ms | x86 max MiB | ARM max MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| jpeg-resize-png | 6677.6 | 6566.5 | 5021.5 | 4721.2 | 168 | 168 |
| jpeg-resize-webp | 6870.4 | 7095.4 | 5140.9 | 4886.2 | 158 | 162 |
| png-resize-jpeg | 7861.8 | 8270.0 | 5421.4 | 5560.2 | 194 | 201 |
| png-resize-webp | 7383.5 | 8399.7 | 5346.9 | 5748.2 | 189 | 190 |

## JPEG WASM experiment — full-resolution decode

| Architecture | Workflow | Engine | Cold total ms | Cold operation ms | Warm operation ms | Max used MiB | WASM load ms | WASM memory MiB |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| x86_64 | jpeg-resize-3000-png | javascript | 16589.5 | 15404.9 | 14437.7 | 171 | 0.00 | 0.0 |
| x86_64 | jpeg-resize-3000-png | wasm-jpeg | 15337.5 | 14243.8 | 13201.0 | 178 | 118.52 | 6.0 |
| x86_64 | jpeg-resize-3000-webp | javascript | 16416.7 | 15325.8 | 13900.4 | 182 | 0.00 | 0.0 |
| x86_64 | jpeg-resize-3000-webp | wasm-jpeg | 14829.5 | 13802.7 | 12601.8 | 185 | 119.52 | 6.0 |
| arm64 | jpeg-resize-3000-png | javascript | 15722.4 | 14560.6 | 13623.6 | 198 | 0.00 | 0.0 |
| arm64 | jpeg-resize-3000-png | wasm-jpeg | 13882.2 | 12743.0 | 11461.9 | 197 | 37.84 | 6.0 |
| arm64 | jpeg-resize-3000-webp | javascript | 16065.0 | 14947.2 | 13604.4 | 198 | 0.00 | 0.0 |
| arm64 | jpeg-resize-3000-webp | wasm-jpeg | 10202.6 | 9148.9 | 8160.3 | 205 | 57.41 | 6.0 |

Operation timing includes all JS/WASM input and output copies. AWS duration includes fixture reads, operation, and output validation. Cold total is AWS Duration + Init Duration. Maximum memory is the largest AWS REPORT value across cold and warm samples.
