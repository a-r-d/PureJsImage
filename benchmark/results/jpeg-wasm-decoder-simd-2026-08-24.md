# JPEG WASM decoder benchmark - 2026-08-24

The current scalar and SIMD artifacts decoded the pinned
`benchmark/corpus/files/tundra-4000x3000.jpg` fixture to the exact TypeScript RGB SHA-256
`f63be628feb9f3a0b6b6be517c8f7b238f082bf46f1fb889de0b56fb7af161fc`.

- Source revision: `865611a4dfdf0b49db0c8fc67fc01386c1a0b91c`, with the reviewed changes in a dirty working tree.
- Fixture: 4,768,216 bytes, 4000x3000, SHA-256 `af55711534d744a385a805d7c0ff20c7e32c19f9fb886b468b078af24ddb8ab6`.
- Warm TypeScript: 743.22 ms.
- Warm scalar WASM: 445.44 ms, 40.1% faster than TypeScript.
- Warm SIMD WASM: 388.56 ms, 12.8% faster than scalar WASM and 47.7% faster than TypeScript.
- Cold TypeScript: 751.46 ms.
- Cold scalar WASM: 456.60 ms.
- Cold SIMD WASM: 397.74 ms, 12.9% faster than scalar WASM and 47.1% faster than TypeScript.
- Linear-memory high-water mark: 5.125 MiB for the bounded compressed input, row planes, and output row.
- Input plus bounded-row output copies: 0.81 ms.
- Scalar artifact: 31,735 bytes raw, 7,861 gzip, 6,643 brotli.
- SIMD artifact: 31,585 bytes raw, 7,954 gzip, 6,807 brotli.
- Median warm instantiation: 0.23 ms scalar and 0.22 ms SIMD.

The primary rows are medians of three isolated processes. Warm processes perform two unmeasured
decodes before collection. Cold processes include lazy file read, compilation, instantiation, input
copy, and the first decode. Progressive and unsupported inputs retain the TypeScript fallback.

Machine-readable results: `jpeg-wasm-decoder-simd-2026-08-24.json`.
