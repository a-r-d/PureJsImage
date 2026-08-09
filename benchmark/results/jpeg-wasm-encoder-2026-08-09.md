# JPEG WASM encoder benchmark — 2026-08-09

Correctness gate: scalar WASM output is byte-identical to the TypeScript reference. The alternative SIMD AAN FDCT must remain within 0.05 dB decoded PSNR and 1% output size for every matching workload before timings are accepted.

- Scalar artifact: 39105 bytes (7037 gzip, 5618 brotli).
- SIMD artifact: 48877 bytes (9035 gzip, 7298 brotli).
- On 1024x768 high-entropy mode coverage, scalar WASM reduced warm time by 61.7%-66.0% versus TypeScript. SIMD reduced scalar time by another 8.1%-10.6%.
- On 2048x1536 4:2:0, SIMD reduced scalar warm time by 15.8% for low entropy and 11.1% for high entropy.
- Cold SIMD remained faster than TypeScript at every measured size. The production selector uses a conservative 65,536-pixel minimum based on the 256x256 result (5.15 ms versus 9.99 ms).
- The SIMD artifact adds 9772 raw bytes and 1998 gzip bytes over scalar.
- Warm rows report the median of five measured encodes after two warmups. Cold rows include lazy module read, compile, instantiate, and the first encode.
- Peak RSS is the absolute process high-water mark minus the pre-measurement baseline. WASM memory is the linear-memory high-water mark.

| Dimensions | Mode | Entropy | Profile | Engine | ms | MP/s | peak RSS Δ MiB | WASM MiB | output bytes | PSNR dB |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 1024x768 | gray | high | warm | javascript | 44.80 | 17.55 | 14.0 | 0.0 | 475818 | 30.491 |
| 1024x768 | gray | high | warm | scalar | 15.23 | 51.65 | 12.3 | 1.2 | 475818 | 30.491 |
| 1024x768 | gray | high | warm | simd | 13.81 | 56.94 | 12.4 | 1.2 | 475853 | 30.490 |
| 1024x768 | 420 | high | warm | javascript | 63.60 | 12.36 | 26.3 | 0.0 | 523668 | 12.801 |
| 1024x768 | 420 | high | warm | scalar | 23.83 | 33.01 | 22.8 | 1.3 | 523668 | 12.801 |
| 1024x768 | 420 | high | warm | simd | 21.29 | 36.93 | 23.6 | 1.3 | 523668 | 12.801 |
| 1024x768 | 422 | high | warm | javascript | 84.14 | 9.35 | 30.9 | 0.0 | 693443 | 14.422 |
| 1024x768 | 422 | high | warm | scalar | 31.09 | 25.29 | 29.1 | 1.3 | 693443 | 14.422 |
| 1024x768 | 422 | high | warm | simd | 28.57 | 27.53 | 30.0 | 1.3 | 693443 | 14.422 |
| 1024x768 | 444 | high | warm | javascript | 119.73 | 6.57 | 34.6 | 0.0 | 1093916 | 24.136 |
| 1024x768 | 444 | high | warm | scalar | 45.85 | 17.15 | 35.1 | 1.3 | 1093916 | 24.136 |
| 1024x768 | 444 | high | warm | simd | 41.49 | 18.95 | 35.4 | 1.3 | 1093916 | 24.136 |
| 2048x1536 | 420 | low | warm | javascript | 214.11 | 14.69 | 75.4 | 0.0 | 507307 | 27.284 |
| 2048x1536 | 420 | low | warm | scalar | 62.23 | 50.55 | 76.4 | 1.6 | 507307 | 27.284 |
| 2048x1536 | 420 | low | warm | simd | 52.36 | 60.07 | 75.4 | 1.6 | 507307 | 27.284 |
| 2048x1536 | 420 | high | warm | javascript | 266.54 | 11.80 | 92.4 | 0.0 | 2094834 | 12.795 |
| 2048x1536 | 420 | high | warm | scalar | 95.05 | 33.10 | 92.3 | 1.6 | 2094834 | 12.795 |
| 2048x1536 | 420 | high | warm | simd | 84.52 | 37.22 | 92.3 | 1.6 | 2094834 | 12.795 |
| 64x64 | 420 | high | cold | javascript | 3.13 | 1.31 | 1.6 | 0.0 | 3359 | 12.788 |
| 64x64 | 420 | high | cold | scalar | 2.31 | 1.78 | 0.6 | 1.1 | 3359 | 12.788 |
| 64x64 | 420 | high | cold | simd | 2.53 | 1.62 | 0.6 | 1.1 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | javascript | 0.88 | 4.65 | 0.8 | 0.0 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | scalar | 0.23 | 17.44 | 0.9 | 1.1 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | simd | 0.23 | 17.61 | 0.8 | 1.1 | 3359 | 12.788 |
| 128x128 | 420 | high | cold | javascript | 5.22 | 3.14 | 1.3 | 0.0 | 11548 | 12.776 |
| 128x128 | 420 | high | cold | scalar | 2.80 | 5.86 | 1.6 | 1.1 | 11548 | 12.776 |
| 128x128 | 420 | high | cold | simd | 3.20 | 5.12 | 1.7 | 1.1 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | javascript | 1.73 | 9.47 | 1.6 | 0.0 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | scalar | 0.57 | 28.63 | 1.5 | 1.1 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | simd | 0.52 | 31.46 | 1.8 | 1.1 | 11548 | 12.776 |
| 256x256 | 420 | high | cold | javascript | 9.99 | 6.56 | 2.1 | 0.0 | 44195 | 12.790 |
| 256x256 | 420 | high | cold | scalar | 4.81 | 13.62 | 2.1 | 1.2 | 44195 | 12.790 |
| 256x256 | 420 | high | cold | simd | 5.15 | 12.72 | 1.8 | 1.2 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | javascript | 5.07 | 12.94 | 2.1 | 0.0 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | scalar | 2.03 | 32.29 | 1.4 | 1.2 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | simd | 1.84 | 35.54 | 1.8 | 1.2 | 44195 | 12.790 |
| 512x512 | 420 | high | cold | javascript | 25.73 | 10.19 | 8.6 | 0.0 | 175058 | 12.796 |
| 512x512 | 420 | high | cold | scalar | 10.90 | 24.05 | 8.1 | 1.3 | 175058 | 12.796 |
| 512x512 | 420 | high | cold | simd | 10.73 | 24.44 | 8.7 | 1.3 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | javascript | 20.43 | 12.83 | 9.8 | 0.0 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | scalar | 8.05 | 32.54 | 9.3 | 1.3 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | simd | 7.13 | 36.75 | 9.1 | 1.3 | 175058 | 12.796 |
| 1024x1024 | 420 | high | cold | javascript | 85.60 | 12.25 | 36.5 | 0.0 | 697826 | 12.800 |
| 1024x1024 | 420 | high | cold | scalar | 34.94 | 30.01 | 36.6 | 1.3 | 697826 | 12.800 |
| 1024x1024 | 420 | high | cold | simd | 31.57 | 33.22 | 37.1 | 1.3 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | javascript | 89.18 | 11.76 | 31.9 | 0.0 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | scalar | 31.79 | 32.99 | 31.9 | 1.3 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | simd | 28.62 | 36.64 | 31.8 | 1.3 | 697826 | 12.800 |
