# Rust/WASM baseline JPEG decoder

Measured on 2026-08-08 with Node.js 24.16.0 on the pinned 4000x3000
`tundra-4000x3000.jpg` fixture. Each value is the median of three isolated
processes. Every run produced the same decoded RGB SHA-256
`f63be628feb9f3a0b6b6be517c8f7b238f082bf46f1fb889de0b56fb7af161fc`.

| Engine | Cold decode | Warm decode | Cold peak RSS | Warm peak RSS |
| --- | ---: | ---: | ---: | ---: |
| TypeScript reference | 1140.0 ms | 1120.1 ms | 99.1 MiB | 101.3 MiB |
| Rust/WASM baseline decoder | 700.8 ms | 666.7 ms | 100.6 MiB | 101.1 MiB |

The WASM path improved complete decode by 38.5% cold and 40.5% warm. Cold peak
RSS was 1.5 MiB higher and warm peak RSS was 0.2 MiB lower. It moves baseline
entropy decoding, dequantization, IDCT, chroma upsampling, and RGB conversion
into one WASM session. Output remains bounded to MCU rows rather than a
source-sized RGB frame.

The checked-in module is 21,100 bytes raw, 5,158 bytes with gzip, and 4,363 bytes
with Brotli. Compile and instantiate took a 0.25 ms cold median. Linear memory
reached 6,291,456 bytes for the compressed input copy, sampling maps, two bounded
component-row buffers, and one RGB output row.

The isolated JavaScript-to-WASM input copy took 0.18 ms and the complete 36 MB
of row-output copies took 0.64 ms, for 0.82 ms total copy cost. Both copies are
already included in the complete decode timings above.

The default selector requires at least 1,000,000 pixels and accepts common
full-image, full-resolution, three-component baseline YCbCr input up to 32 MiB.
Crops, reduced-resolution decode, progressive or ICC-transformed input, unsafe
row sizes, concurrent use of the cached instance, and unavailable modules stay
on the TypeScript reference path.

Reproduce with:

```sh
npm run bench:jpeg:wasm
```
