# JPEG WASM encoder benchmark — 2026-08-24

Correctness gate: scalar WASM output is byte-identical to the TypeScript reference. Scalar and SIMD AAN outputs are byte-identical to each other. The alternative AAN FDCT must remain within 0.05 dB decoded PSNR and 1% output size for every matching workload before timings are accepted.

- Source revision: 865611a4dfdf0b49db0c8fc67fc01386c1a0b91c (dirty working tree with the reviewed WASM changes).
- Scalar artifact: 38034 bytes (6688 gzip, 5429 brotli).
- Scalar AAN control artifact: 31283 bytes (6264 gzip, 5125 brotli).
- SIMD artifact: 46266 bytes (8991 gzip, 7282 brotli).
- On 1024x768 high-entropy mode coverage, scalar WASM reduced warm time by 26.1%-30.8% versus TypeScript. Scalar AAN then changed matrix-DCT time by 17.2%-24.5%. SIMD changed the same AAN algorithm by 20.8%-25.2%.
- On 2048x1536 4:2:0, SIMD reduced scalar AAN warm time by -2.0% for low entropy and 24.1% for high entropy.
- Cold SIMD remained faster than TypeScript at every measured size. The production selector uses a conservative 65,536-pixel minimum based on the 256x256 result (4.88 ms versus 9.72 ms).
- The SIMD artifact adds 8232 raw bytes and 2303 gzip bytes over scalar.
- Warm rows report the median of five measured encodes after two warmups. Cold rows include lazy module read, compile, instantiate, and the first encode.
- Peak RSS is the absolute process high-water mark minus the pre-measurement baseline. WASM memory is the linear-memory high-water mark.

| Dimensions | Mode | Entropy | Profile | Engine | ms | MP/s | peak RSS Δ MiB | WASM MiB | output bytes | PSNR dB |
|---|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 1024x768 | gray | high | warm | javascript | 32.13 | 24.48 | 12.4 | 0.0 | 475818 | 30.491 |
| 1024x768 | gray | high | warm | scalar | 23.28 | 33.79 | 11.7 | 0.3 | 475818 | 30.491 |
| 1024x768 | gray | high | warm | aan | 17.58 | 44.73 | 11.3 | 0.3 | 475841 | 30.491 |
| 1024x768 | gray | high | warm | simd | 13.93 | 56.45 | 11.0 | 0.3 | 475841 | 30.491 |
| 1024x768 | 420 | high | warm | javascript | 49.17 | 15.99 | 32.8 | 0.0 | 523668 | 12.801 |
| 1024x768 | 420 | high | warm | scalar | 34.02 | 23.12 | 29.1 | 0.4 | 523668 | 12.801 |
| 1024x768 | 420 | high | warm | aan | 26.67 | 29.48 | 29.0 | 0.4 | 523668 | 12.801 |
| 1024x768 | 420 | high | warm | simd | 20.04 | 39.24 | 26.5 | 0.4 | 523668 | 12.801 |
| 1024x768 | 422 | high | warm | javascript | 62.81 | 12.52 | 34.9 | 0.0 | 693443 | 14.422 |
| 1024x768 | 422 | high | warm | scalar | 45.88 | 17.14 | 34.8 | 0.4 | 693443 | 14.422 |
| 1024x768 | 422 | high | warm | aan | 37.99 | 20.70 | 34.5 | 0.4 | 693443 | 14.422 |
| 1024x768 | 422 | high | warm | simd | 28.41 | 27.69 | 35.2 | 0.4 | 693443 | 14.422 |
| 1024x768 | 444 | high | warm | javascript | 90.85 | 8.66 | 34.1 | 0.0 | 1093916 | 24.136 |
| 1024x768 | 444 | high | warm | scalar | 67.17 | 11.71 | 33.5 | 0.4 | 1093916 | 24.136 |
| 1024x768 | 444 | high | warm | aan | 53.54 | 14.69 | 31.6 | 0.4 | 1093916 | 24.136 |
| 1024x768 | 444 | high | warm | simd | 41.33 | 19.03 | 31.0 | 0.4 | 1093916 | 24.136 |
| 2048x1536 | 420 | low | warm | javascript | 139.16 | 22.61 | 74.7 | 0.0 | 507307 | 27.284 |
| 2048x1536 | 420 | low | warm | scalar | 66.89 | 47.03 | 74.5 | 0.7 | 507307 | 27.284 |
| 2048x1536 | 420 | low | warm | aan | 45.59 | 68.99 | 74.3 | 0.7 | 507307 | 27.284 |
| 2048x1536 | 420 | low | warm | simd | 46.51 | 67.63 | 74.0 | 0.7 | 507307 | 27.284 |
| 2048x1536 | 420 | high | warm | javascript | 189.37 | 16.61 | 90.8 | 0.0 | 2094834 | 12.795 |
| 2048x1536 | 420 | high | warm | scalar | 135.01 | 23.30 | 91.8 | 0.7 | 2094834 | 12.795 |
| 2048x1536 | 420 | high | warm | aan | 105.05 | 29.95 | 91.3 | 0.7 | 2094834 | 12.795 |
| 2048x1536 | 420 | high | warm | simd | 79.75 | 39.45 | 91.1 | 0.7 | 2094834 | 12.795 |
| 64x64 | 420 | high | cold | javascript | 3.30 | 1.24 | 0.4 | 0.0 | 3359 | 12.788 |
| 64x64 | 420 | high | cold | scalar | 2.40 | 1.70 | 0.3 | 0.3 | 3359 | 12.788 |
| 64x64 | 420 | high | cold | aan | 2.52 | 1.62 | 0.4 | 0.3 | 3359 | 12.788 |
| 64x64 | 420 | high | cold | simd | 2.59 | 1.58 | 0.4 | 0.3 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | javascript | 0.85 | 4.82 | 0.4 | 0.0 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | scalar | 0.31 | 13.07 | 0.5 | 0.3 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | aan | 0.27 | 15.26 | 0.7 | 0.3 | 3359 | 12.788 |
| 64x64 | 420 | high | warm | simd | 0.21 | 19.23 | 0.4 | 0.3 | 3359 | 12.788 |
| 128x128 | 420 | high | cold | javascript | 5.27 | 3.11 | 0.6 | 0.0 | 11548 | 12.776 |
| 128x128 | 420 | high | cold | scalar | 3.25 | 5.04 | 0.5 | 0.3 | 11548 | 12.776 |
| 128x128 | 420 | high | cold | aan | 3.18 | 5.14 | 0.7 | 0.3 | 11548 | 12.776 |
| 128x128 | 420 | high | cold | simd | 3.15 | 5.20 | 0.5 | 0.3 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | javascript | 1.30 | 12.61 | 0.5 | 0.0 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | scalar | 0.77 | 21.20 | 0.4 | 0.3 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | aan | 0.64 | 25.51 | 0.1 | 0.3 | 11548 | 12.776 |
| 128x128 | 420 | high | warm | simd | 0.51 | 32.41 | 0.8 | 0.3 | 11548 | 12.776 |
| 256x256 | 420 | high | cold | javascript | 9.72 | 6.74 | 0.8 | 0.0 | 44195 | 12.790 |
| 256x256 | 420 | high | cold | scalar | 5.66 | 11.58 | 0.8 | 0.3 | 44195 | 12.790 |
| 256x256 | 420 | high | cold | aan | 4.90 | 13.38 | 0.7 | 0.3 | 44195 | 12.790 |
| 256x256 | 420 | high | cold | simd | 4.88 | 13.43 | 0.7 | 0.3 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | javascript | 4.36 | 15.04 | 0.9 | 0.0 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | scalar | 2.97 | 22.09 | 0.7 | 0.3 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | aan | 2.31 | 28.39 | 0.7 | 0.3 | 44195 | 12.790 |
| 256x256 | 420 | high | warm | simd | 1.82 | 35.92 | 0.9 | 0.3 | 44195 | 12.790 |
| 512x512 | 420 | high | cold | javascript | 23.92 | 10.96 | 7.3 | 0.0 | 175058 | 12.796 |
| 512x512 | 420 | high | cold | scalar | 14.36 | 18.25 | 7.4 | 0.4 | 175058 | 12.796 |
| 512x512 | 420 | high | cold | aan | 11.94 | 21.96 | 7.2 | 0.4 | 175058 | 12.796 |
| 512x512 | 420 | high | cold | simd | 10.03 | 26.15 | 7.4 | 0.4 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | javascript | 16.99 | 15.43 | 7.9 | 0.0 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | scalar | 11.52 | 22.76 | 7.4 | 0.4 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | aan | 9.01 | 29.08 | 7.3 | 0.4 | 175058 | 12.796 |
| 512x512 | 420 | high | warm | simd | 6.88 | 38.09 | 7.4 | 0.4 | 175058 | 12.796 |
| 1024x1024 | 420 | high | cold | javascript | 72.83 | 14.40 | 35.4 | 0.0 | 697826 | 12.800 |
| 1024x1024 | 420 | high | cold | scalar | 49.62 | 21.13 | 35.3 | 0.4 | 697826 | 12.800 |
| 1024x1024 | 420 | high | cold | aan | 38.78 | 27.04 | 35.5 | 0.4 | 697826 | 12.800 |
| 1024x1024 | 420 | high | cold | simd | 29.84 | 35.14 | 35.3 | 0.4 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | javascript | 65.90 | 15.91 | 34.2 | 0.0 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | scalar | 47.05 | 22.29 | 34.3 | 0.4 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | aan | 35.52 | 29.52 | 34.1 | 0.4 | 697826 | 12.800 |
| 1024x1024 | 420 | high | warm | simd | 29.63 | 35.39 | 31.1 | 0.4 | 697826 | 12.800 |
