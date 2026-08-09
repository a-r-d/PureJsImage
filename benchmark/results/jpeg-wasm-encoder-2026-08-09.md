# JPEG WASM encoder benchmark — 2026-08-09

Correctness gate: scalar WASM output is byte-identical to the TypeScript reference. The alternative SIMD AAN FDCT must remain within 0.05 dB decoded PSNR and 1% output size for every matching workload before timings are accepted.

- Scalar artifact: 32881 bytes (6245 gzip, 5243 brotli).
- SIMD artifact: 39997 bytes (7397 gzip, 6173 brotli).
- On 1024x768 high-entropy mode coverage, scalar WASM reduced warm time by 56.5%-61.8% versus TypeScript. SIMD reduced scalar time by another 9.4%-10.5%.
- On 2048x1536 4:2:0, SIMD reduced scalar warm time by 12.7% for low entropy and 10.0% for high entropy.
- Cold SIMD remained faster than TypeScript at every measured size. The production selector uses a conservative 65,536-pixel minimum based on the 256x256 result (5.52 ms versus 10.18 ms).
- The SIMD artifact adds 7116 raw bytes and 1152 gzip bytes over scalar.
- Warm rows report the median of five measured encodes after two warmups. Cold rows include lazy module read, compile, instantiate, and the first encode.
- Peak RSS is the absolute process high-water mark minus the pre-measurement baseline. WASM memory is the linear-memory high-water mark.

| Dimensions | Mode | Entropy | Profile | Engine | ms | MP/s | peak RSS Δ MiB | WASM MiB | output bytes | PSNR dB |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 1024x768 | gray | high | warm | javascript | 44.82 | 17.54 | 14.1 | 0.0 | 475818 | 30.491 |
| 1024x768 | gray | high | warm | scalar | 17.41 | 45.17 | 12.3 | 1.2 | 475818 | 30.491 |
| 1024x768 | gray | high | warm | simd | 15.78 | 49.85 | 12.5 | 1.2 | 475853 | 30.490 |
| 1024x768 | 420 | high | warm | javascript | 63.49 | 12.39 | 26.3 | 0.0 | 523668 | 12.801 |
| 1024x768 | 420 | high | warm | scalar | 27.60 | 28.49 | 23.2 | 1.3 | 523668 | 12.801 |
| 1024x768 | 420 | high | warm | simd | 24.86 | 31.63 | 22.8 | 1.3 | 523668 | 12.801 |
| 1024x768 | 422 | high | warm | javascript | 84.01 | 9.36 | 31.0 | 0.0 | 693443 | 14.422 |
| 1024x768 | 422 | high | warm | scalar | 36.54 | 21.52 | 30.1 | 1.3 | 693443 | 14.422 |
| 1024x768 | 422 | high | warm | simd | 32.71 | 24.04 | 29.8 | 1.3 | 693443 | 14.422 |
| 1024x768 | 444 | high | warm | javascript | 122.35 | 6.43 | 35.5 | 0.0 | 1093916 | 24.136 |
| 1024x768 | 444 | high | warm | scalar | 58.28 | 13.49 | 34.5 | 1.3 | 1093916 | 24.136 |
| 1024x768 | 444 | high | warm | simd | 52.41 | 15.01 | 34.8 | 1.3 | 1093916 | 24.136 |
| 2048x1536 | 420 | low | warm | javascript | 213.11 | 14.76 | 76.6 | 0.0 | 507307 | 27.284 |
| 2048x1536 | 420 | low | warm | scalar | 72.97 | 43.11 | 75.4 | 1.6 | 507307 | 27.284 |
| 2048x1536 | 420 | low | warm | simd | 63.69 | 49.39 | 75.8 | 1.6 | 507307 | 27.284 |
| 2048x1536 | 420 | high | warm | javascript | 267.76 | 11.75 | 92.0 | 0.0 | 2094834 | 12.795 |
| 2048x1536 | 420 | high | warm | scalar | 110.81 | 28.39 | 92.8 | 1.6 | 2094834 | 12.795 |
| 2048x1536 | 420 | high | warm | simd | 99.74 | 31.54 | 92.1 | 1.6 | 2094834 | 12.795 |
| 64x64 | 420 | high | cold | javascript | 3.24 | 1.26 | 1.6 | 0.0 | 3359 | 12.788 |
| 64x64 | 420 | high | cold | scalar | 2.51 | 1.63 | 0.7 | 1.1 | 3359 | 12.788 |
| 64x64 | 420 | high | cold | simd | 2.51 | 1.63 | 0.8 | 1.1 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | javascript | 0.85 | 4.83 | 1.2 | 0.0 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | scalar | 0.29 | 14.12 | 0.9 | 1.1 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | simd | 0.27 | 15.38 | 1.2 | 1.1 | 3359 | 12.788 |
| 128x128 | 420 | high | cold | javascript | 5.16 | 3.17 | 1.8 | 0.0 | 11548 | 12.776 |
| 128x128 | 420 | high | cold | scalar | 3.01 | 5.44 | 1.9 | 1.1 | 11548 | 12.776 |
| 128x128 | 420 | high | cold | simd | 3.19 | 5.14 | 1.6 | 1.1 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | javascript | 1.76 | 9.31 | 1.5 | 0.0 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | scalar | 0.63 | 25.91 | 1.6 | 1.1 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | simd | 0.59 | 28.01 | 1.7 | 1.1 | 11548 | 12.776 |
| 256x256 | 420 | high | cold | javascript | 10.18 | 6.44 | 2.1 | 0.0 | 44195 | 12.790 |
| 256x256 | 420 | high | cold | scalar | 5.14 | 12.75 | 1.8 | 1.2 | 44195 | 12.790 |
| 256x256 | 420 | high | cold | simd | 5.52 | 11.87 | 1.6 | 1.2 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | javascript | 5.12 | 12.79 | 1.7 | 0.0 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | scalar | 2.36 | 27.75 | 1.9 | 1.2 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | simd | 2.13 | 30.72 | 1.8 | 1.2 | 44195 | 12.790 |
| 512x512 | 420 | high | cold | javascript | 25.65 | 10.22 | 8.7 | 0.0 | 175058 | 12.796 |
| 512x512 | 420 | high | cold | scalar | 12.49 | 20.98 | 8.2 | 1.3 | 175058 | 12.796 |
| 512x512 | 420 | high | cold | simd | 11.47 | 22.86 | 8.1 | 1.3 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | javascript | 20.56 | 12.75 | 9.3 | 0.0 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | scalar | 9.22 | 28.44 | 9.1 | 1.3 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | simd | 8.36 | 31.36 | 10.1 | 1.3 | 175058 | 12.796 |
| 1024x1024 | 420 | high | cold | javascript | 85.39 | 12.28 | 37.2 | 0.0 | 697826 | 12.800 |
| 1024x1024 | 420 | high | cold | scalar | 39.46 | 26.57 | 36.7 | 1.3 | 697826 | 12.800 |
| 1024x1024 | 420 | high | cold | simd | 36.53 | 28.71 | 36.8 | 1.3 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | javascript | 89.28 | 11.74 | 31.9 | 0.0 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | scalar | 37.00 | 28.34 | 31.9 | 1.3 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | simd | 33.13 | 31.65 | 31.6 | 1.3 | 697826 | 12.800 |
