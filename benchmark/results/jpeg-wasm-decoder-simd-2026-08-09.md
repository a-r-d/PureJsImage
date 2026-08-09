# JPEG WASM decoder SIMD benchmark - 2026-08-09

The SIMD and scalar artifacts decoded the pinned `benchmark/corpus/files/tundra-4000x3000.jpg`
fixture to the exact TypeScript RGB SHA-256
`f63be628feb9f3a0b6b6be517c8f7b238f082bf46f1fb889de0b56fb7af161fc`.

- Fixture: 4,768,216 bytes, 4000x3000, SHA-256
  `af55711534d744a385a805d7c0ff20c7e32c19f9fb886b468b078af24ddb8ab6`.
- Warm scalar WASM: 677.44 ms, 38.8% faster than TypeScript's 1107.66 ms.
- Warm SIMD WASM: 615.38 ms, 9.2% faster than scalar WASM and 44.4% faster than TypeScript.
- Cold SIMD WASM: 621.86 ms, 10.4% faster than scalar WASM and 44.7% faster than TypeScript.
- Cached linear-memory high-water mark: 6.0 MiB for both artifacts.
- Input plus bounded-row output copies: 0.79 ms.
- Scalar artifact: 22,183 bytes raw, 5,535 gzip, 4,683 brotli.
- SIMD artifact: 22,179 bytes raw, 5,723 gzip, 4,907 brotli.
- Median cold instantiation: 0.28 ms scalar and 0.21 ms SIMD.

## Sampling-mode matrix

`encode-probe.ts` generated deterministic 2048x1536 quality-80 inputs for each mode. Every engine
produced the same RGB hash within a mode. These are one isolated warm measurement after two warmups,
used to confirm direction across sampling modes rather than as the primary repeated timing.

| Mode | Fixture bytes | Fixture SHA-256 | TypeScript ms | Scalar ms | SIMD ms | SIMD vs scalar |
|---|---:|---|---:|---:|---:|---:|
| grayscale | 955,325 | `39935c77e927aa8fca0501ff9c808f6fb8427f04cf3e308178a27c373f638d67` | 204.03 | fallback | fallback | n/a |
| 4:2:0 | 1,492,375 | `13a2a32aa988be82a0277c1cb9a650bf888f8fcc3435a64875e8acce6d623b86` | 336.82 | 244.52 | 166.83 | 31.8% faster |
| 4:2:2 | 1,905,174 | `51854eb18bf28184de4f238a146f1a40856589e5fe80edb41d591f4fd4672c5d` | 399.21 | 234.17 | 212.87 | 9.1% faster |
| 4:4:4 | 2,660,990 | `e2863dada8a5692064f2c55fb5afae4a5c549604882f2749d892ba864d6df032` | 387.87 | 313.17 | 264.49 | 15.5% faster |

Grayscale remains an intentional TypeScript fallback and did not instantiate either WASM artifact.
Linear-memory high-water marks scaled with bounded compressed input plus row planes: 2.75 MiB for
4:2:0, 3.125 MiB for 4:2:2, and 3.875 MiB for 4:4:4.

## Cold selection crossover

The same deterministic 4:2:0 generator was measured in three isolated cold processes at each square
dimension. Timings include module file read, compilation, instantiation, input copy, decode, and
bounded output collection. All three engines produced the same RGB hash at every dimension.

| Dimensions | Fixture bytes | Fixture SHA-256 | TypeScript ms | Scalar ms | SIMD ms |
|---|---:|---|---:|---:|---:|
| 128x128 | 8,263 | `22229854908d7287b7eb2a0165a61148467011d3ae7cf546c40cf2233f09f273` | 11.89 | 5.14 | 4.77 |
| 256x256 | 31,671 | `fdc4ce710c7d21fc96c04639dd7f7c2af0066c22a7cd5a1dd001b5ea68a072e9` | 18.28 | 9.17 | 8.23 |
| 512x512 | 124,899 | `a64e735fa4faba8651debc531520ca5e1045b029aa0d3728f58c25ef3b3a3ee3` | 40.39 | 21.13 | 18.89 |
| 1024x1024 | 497,845 | `7e639e5e1831b802015d5bce9f91261b902ea1f6daf850c41f31f74b7fc6a71b` | 117.97 | 68.04 | 60.92 |

The production default remains conservative at 65,536 pixels despite the synthetic 128x128 win.
At the selected 256x256 boundary, cold SIMD reduced complete time by 55.0% versus TypeScript.

The primary 4000x3000 rows are medians of three isolated processes. Warm processes perform two
unmeasured decodes before collection; cold processes include lazy file read, compilation,
instantiation, and the first decode. Peak RSS is the absolute process high-water mark minus the
SIMD artifact uses explicit `simd128` IDCT accumulation and two-pixel YCbCr conversion; unsupported
and progressive inputs retain the TypeScript fallback.

Machine-readable primary-workload results: `jpeg-wasm-decoder-simd-2026-08-09.json`.
