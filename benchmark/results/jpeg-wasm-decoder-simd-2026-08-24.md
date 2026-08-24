# JPEG WASM decoder SIMD benchmark - 2026-08-24

The current scalar and SIMD artifacts decoded the pinned `benchmark/corpus/files/tundra-4000x3000.jpg` fixture to the exact TypeScript RGB SHA-256 `f63be628feb9f3a0b6b6be517c8f7b238f082bf46f1fb889de0b56fb7af161fc`.

- Source revision: `67f5c4bda1775b1c07119be679922f23f1f77988`, with the reviewed WASM changes in a dirty working tree.
- Fixture: 4,768,216 bytes, 4000x3000, SHA-256 `af55711534d744a385a805d7c0ff20c7e32c19f9fb886b468b078af24ddb8ab6`.
- Warm TypeScript: 768.03 ms.
- Warm scalar WASM: 456.15 ms, 40.6% faster than TypeScript.
- Warm SIMD WASM: 391.56 ms, 14.2% faster than scalar WASM and 49.0% faster than TypeScript.
- Cold TypeScript: 770.69 ms.
- Cold scalar WASM: 473.99 ms.
- Cold SIMD WASM: 416.23 ms, 12.2% faster than scalar WASM and 46.0% faster than TypeScript.
- Linear-memory high-water mark: 5.125 MiB for the bounded compressed input, row planes, and output row.
- Input plus bounded-row output copies: 1.30 ms.
- Scalar artifact: 31,516 bytes raw, 7,762 gzip, 6,540 brotli.
- SIMD artifact: 31,366 bytes raw, 7,861 gzip, 6,696 brotli.
- Median cold instantiation: 0.25 ms scalar and 0.29 ms SIMD.

The primary rows are medians of three isolated processes. Warm processes perform two unmeasured decodes before collection. Cold processes include lazy file read, compilation, instantiation, input copy, and the first decode. The SIMD artifact uses explicit `simd128` f64 IDCT accumulation, paired chroma sampling, and two-pixel YCbCr conversion. Progressive and unsupported inputs retain the TypeScript fallback.

Machine-readable results: `jpeg-wasm-decoder-simd-2026-08-24.json`.
