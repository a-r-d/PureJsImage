# JPEG WASM encoder benchmark — 2026-08-24

Correctness gate: scalar WASM output is byte-identical to the TypeScript reference. Scalar and SIMD AAN outputs are byte-identical to each other. The alternative AAN FDCT must remain within 0.05 dB decoded PSNR and 1% output size for every matching workload before timings are accepted.

- Source revision: 67f5c4bda1775b1c07119be679922f23f1f77988 (dirty working tree with the reviewed WASM changes).
- Scalar artifact: 39265 bytes (7170 gzip, 5674 brotli).
- Scalar AAN control artifact: 31243 bytes (6243 gzip, 5132 brotli).
- SIMD artifact: 46190 bytes (8964 gzip, 7310 brotli).
- On 1024x768 high-entropy mode coverage, scalar WASM reduced warm time by 47.7%-52.1% versus TypeScript. Scalar AAN then changed matrix-DCT time by 19.5%-22.0%. SIMD changed the same AAN algorithm by 4.2%-11.4%.
- On 2048x1536 4:2:0, SIMD reduced scalar AAN warm time by 19.5% for low entropy and 14.4% for high entropy.
- Cold SIMD remained faster than TypeScript at every measured size. The production selector uses a conservative 65,536-pixel minimum based on the 256x256 result (4.56 ms versus 9.68 ms).
- The SIMD artifact adds 6925 raw bytes and 1794 gzip bytes over scalar.
- Warm rows report the median of five measured encodes after two warmups. Cold rows include lazy module read, compile, instantiate, and the first encode.
- Peak RSS is the absolute process high-water mark minus the pre-measurement baseline. WASM memory is the linear-memory high-water mark.

| Dimensions | Mode | Entropy | Profile | Engine | ms | MP/s | peak RSS Δ MiB | WASM MiB | output bytes | PSNR dB |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 1024x768 | gray | high | warm | javascript | 33.89 | 23.20 | 12.7 | 0.0 | 475818 | 30.491 |
| 1024x768 | gray | high | warm | scalar | 16.22 | 48.49 | 11.1 | 0.3 | 475818 | 30.491 |
| 1024x768 | gray | high | warm | aan | 12.65 | 62.18 | 11.0 | 0.3 | 475841 | 30.491 |
| 1024x768 | gray | high | warm | simd | 11.75 | 66.93 | 11.5 | 0.3 | 475841 | 30.491 |
| 1024x768 | 420 | high | warm | javascript | 51.07 | 15.40 | 32.6 | 0.0 | 523668 | 12.801 |
| 1024x768 | 420 | high | warm | scalar | 24.54 | 32.05 | 26.5 | 0.4 | 523668 | 12.801 |
| 1024x768 | 420 | high | warm | aan | 19.76 | 39.80 | 29.3 | 0.4 | 523668 | 12.801 |
| 1024x768 | 420 | high | warm | simd | 17.51 | 44.92 | 28.7 | 0.4 | 523668 | 12.801 |
| 1024x768 | 422 | high | warm | javascript | 63.63 | 12.36 | 35.3 | 0.0 | 693443 | 14.422 |
| 1024x768 | 422 | high | warm | scalar | 31.72 | 24.79 | 35.2 | 0.4 | 693443 | 14.422 |
| 1024x768 | 422 | high | warm | aan | 25.52 | 30.81 | 35.4 | 0.4 | 693443 | 14.422 |
| 1024x768 | 422 | high | warm | simd | 23.37 | 33.65 | 35.0 | 0.4 | 693443 | 14.422 |
| 1024x768 | 444 | high | warm | javascript | 91.85 | 8.56 | 31.9 | 0.0 | 1093916 | 24.136 |
| 1024x768 | 444 | high | warm | scalar | 48.01 | 16.38 | 33.3 | 0.4 | 1093916 | 24.136 |
| 1024x768 | 444 | high | warm | aan | 37.42 | 21.01 | 33.4 | 0.4 | 1093916 | 24.136 |
| 1024x768 | 444 | high | warm | simd | 35.85 | 21.93 | 33.7 | 0.4 | 1093916 | 24.136 |
| 2048x1536 | 420 | low | warm | javascript | 137.52 | 22.87 | 74.9 | 0.0 | 507307 | 27.284 |
| 2048x1536 | 420 | low | warm | scalar | 66.29 | 47.46 | 73.9 | 0.7 | 507307 | 27.284 |
| 2048x1536 | 420 | low | warm | aan | 44.98 | 69.94 | 74.5 | 0.7 | 507307 | 27.284 |
| 2048x1536 | 420 | low | warm | simd | 36.19 | 86.93 | 74.2 | 0.7 | 507307 | 27.284 |
| 2048x1536 | 420 | high | warm | javascript | 189.70 | 16.58 | 79.3 | 0.0 | 2094834 | 12.795 |
| 2048x1536 | 420 | high | warm | scalar | 98.88 | 31.81 | 91.4 | 0.7 | 2094834 | 12.795 |
| 2048x1536 | 420 | high | warm | aan | 82.34 | 38.21 | 90.6 | 0.7 | 2094834 | 12.795 |
| 2048x1536 | 420 | high | warm | simd | 70.47 | 44.64 | 91.4 | 0.7 | 2094834 | 12.795 |
| 64x64 | 420 | high | cold | javascript | 3.51 | 1.17 | 0.4 | 0.0 | 3359 | 12.788 |
| 64x64 | 420 | high | cold | scalar | 2.53 | 1.62 | 0.2 | 0.3 | 3359 | 12.788 |
| 64x64 | 420 | high | cold | aan | 2.26 | 1.81 | 0.7 | 0.3 | 3359 | 12.788 |
| 64x64 | 420 | high | cold | simd | 2.68 | 1.53 | 0.4 | 0.3 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | javascript | 0.80 | 5.13 | 0.7 | 0.0 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | scalar | 0.27 | 15.10 | 0.4 | 0.3 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | aan | 0.22 | 18.24 | 0.4 | 0.3 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | simd | 0.20 | 20.23 | 0.3 | 0.3 | 3359 | 12.788 |
| 128x128 | 420 | high | cold | javascript | 5.18 | 3.16 | 0.5 | 0.0 | 11548 | 12.776 |
| 128x128 | 420 | high | cold | scalar | 3.26 | 5.02 | 0.5 | 0.3 | 11548 | 12.776 |
| 128x128 | 420 | high | cold | aan | 2.83 | 5.79 | 0.1 | 0.3 | 11548 | 12.776 |
| 128x128 | 420 | high | cold | simd | 3.12 | 5.25 | 0.8 | 0.3 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | javascript | 1.39 | 11.77 | 0.7 | 0.0 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | scalar | 0.67 | 24.36 | 0.3 | 0.3 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | aan | 0.50 | 32.62 | 0.4 | 0.3 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | simd | 0.47 | 34.54 | 0.5 | 0.3 | 11548 | 12.776 |
| 256x256 | 420 | high | cold | javascript | 9.68 | 6.77 | 1.0 | 0.0 | 44195 | 12.790 |
| 256x256 | 420 | high | cold | scalar | 4.78 | 13.71 | 0.5 | 0.3 | 44195 | 12.790 |
| 256x256 | 420 | high | cold | aan | 5.12 | 12.80 | 0.8 | 0.3 | 44195 | 12.790 |
| 256x256 | 420 | high | cold | simd | 4.56 | 14.39 | 0.9 | 0.3 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | javascript | 4.18 | 15.68 | 0.8 | 0.0 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | scalar | 2.07 | 31.71 | 0.7 | 0.3 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | aan | 1.69 | 38.85 | 0.8 | 0.3 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | simd | 1.59 | 41.13 | 0.9 | 0.3 | 44195 | 12.790 |
| 512x512 | 420 | high | cold | javascript | 23.02 | 11.39 | 6.5 | 0.0 | 175058 | 12.796 |
| 512x512 | 420 | high | cold | scalar | 14.29 | 18.34 | 6.9 | 0.4 | 175058 | 12.796 |
| 512x512 | 420 | high | cold | aan | 10.06 | 26.06 | 7.4 | 0.4 | 175058 | 12.796 |
| 512x512 | 420 | high | cold | simd | 9.28 | 28.26 | 7.0 | 0.4 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | javascript | 17.36 | 15.10 | 8.0 | 0.0 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | scalar | 8.21 | 31.95 | 7.2 | 0.4 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | aan | 6.69 | 39.19 | 7.3 | 0.4 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | simd | 5.93 | 44.24 | 7.1 | 0.4 | 175058 | 12.796 |
| 1024x1024 | 420 | high | cold | javascript | 74.86 | 14.01 | 35.0 | 0.0 | 697826 | 12.800 |
| 1024x1024 | 420 | high | cold | scalar | 34.80 | 30.13 | 35.3 | 0.4 | 697826 | 12.800 |
| 1024x1024 | 420 | high | cold | aan | 29.00 | 36.16 | 35.4 | 0.4 | 697826 | 12.800 |
| 1024x1024 | 420 | high | cold | simd | 26.83 | 39.09 | 34.8 | 0.4 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | javascript | 64.61 | 16.23 | 34.4 | 0.0 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | scalar | 33.57 | 31.24 | 34.2 | 0.4 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | aan | 27.88 | 37.61 | 34.2 | 0.4 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | simd | 23.74 | 44.17 | 34.2 | 0.4 | 697826 | 12.800 |
