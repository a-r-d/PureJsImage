# JPEG WASM acceleration plan

This document tracks performance work for the optional first-party Rust/WASM JPEG decoder and
encoder. The TypeScript codec remains the portable reference and default production path. Each WASM
codec is an explicitly imported accelerator and must preserve the same public behavior, safety
limits, metadata, errors, fixture coverage, and bounded-memory design.

The current scalar WASM decoder is a successful foundation, not the final performance target. On the
pinned 4000x3000 baseline JPEG benchmark it reduced complete warm decode time from 1120.1 ms to
666.7 ms, a 40.5% improvement, while producing the exact reference RGB hash. JavaScript-to-WASM copy
cost was 0.82 ms, so the remaining opportunity is inside the codec rather than at the module boundary.
See `benchmark/results/jpeg-wasm-decoder-2026-08-08.md` for the reproducible baseline.

## Delivery order

The encoder is the next implementation priority. Decoder SIMD follows after the encoder has a
measured scalar WASM path and the encoder's best SIMD opportunities have been evaluated.

1. Add benchmark-only stage timing to the current scalar decoder. This is a short measurement
   checkpoint, not a new decoder optimization phase.
2. Freeze decoder performance work temporarily and implement a separate row-bounded scalar WASM
   encoder for common baseline JPEG output.
3. Profile the scalar encoder and optimize its measured hot stages, including SIMD where it produces
   a meaningful complete-encode improvement.
4. Return to decoder SIMD using the recorded decoder stage measurements.
5. Benchmark complete decode, transform, and encode workflows before deciding whether further work
   belongs in the decoder, encoder, or pipeline boundary.

This order broadens acceleration to the complete JPEG pipeline before pursuing a less certain
incremental decoder gain. Encoding also contains regular numeric work such as RGB-to-YCbCr conversion,
chroma downsampling, FDCT, and quantization that is more naturally SIMD-friendly than serial Huffman
decoding.

## Performance objective

Accelerate both common baseline decoding and encoding without weakening portability or turning the
TypeScript and scalar WASM implementations into neglected fallbacks. An implementation is worth
shipping only when representative complete workloads improve meaningfully after module loading,
copies, output validation, and fallback behavior are included.

The encoder target will be set after its scalar WASM baseline and stage profile exist. When decoder
SIMD resumes, its initial target is at least a further 20% reduction in warm complete-decode time on
the pinned large baseline workloads. These are investigation targets, not promised results. A smaller
gain should ship only if it is consistent across representative inputs and has negligible size,
cold-start, and memory costs.

## Current architecture to preserve

- JavaScript owns input handling, JPEG inspection, request planning, accelerator selection, limits,
  output sinks, registration, and fallback.
- Rust owns baseline entropy decode, dequantization, IDCT, chroma upsampling, color conversion, and
  bounded-row RGB production for decoding. For encoding, Rust owns color conversion, chroma
  downsampling, FDCT, quantization, entropy coding, and compressed chunk production.
- One decoder session performs the expensive work without per-pixel or per-block calls across the
  JavaScript/WASM boundary.
- One encoder session accepts useful row or MCU-row work units and returns compressed chunks without
  per-pixel or per-block boundary calls.
- Compressed input is copied once and decoded output is copied in bounded MCU rows. No source-sized
  RGB or RGBA frame is materialized.
- Encoder input and compressed output remain streaming and bounded. A WASM encoder must not retain a
  source-sized RGB, YCbCr, or coefficient frame for baseline output.
- Decoder and encoder are separate artifacts so applications do not pay package or initialization
  costs for a direction they did not import.
- Unsupported, unhelpful, unavailable, or busy accelerator cases return to the TypeScript reference
  path without changing public behavior.

## Phase 0: decoder measurement checkpoint

- [ ] Add a benchmark-only instrumented build that separates entropy decode, dequantization and
  IDCT, chroma upsampling, color conversion and packing, and row-copy time.
- [ ] Measure baseline grayscale, 4:4:4, 4:2:2, and 4:2:0 images at multiple useful dimensions.
- [ ] Record cold and warm wall time, throughput, absolute peak RSS, WASM memory high-water mark,
  module size, initialization time, and output-copy time.
- [ ] Confirm that the one-megapixel selection threshold remains beneficial with cold module loading
  included; adjust it only from measured crossover data.
- [ ] Keep inputs checksum-pinned and require correct output before accepting any timing.

This phase determines where SIMD work belongs. Huffman entropy decoding is expected to remain scalar
because it is serial and branch-heavy, but that assumption must not substitute for measurement.

After these measurements are recorded, defer decoder optimization until the encoder phases below are
complete.

## Phase 1: scalar WASM encoder

- [ ] Extend the JPEG accelerator provider boundary to support encoding without changing default
  TypeScript codec behavior or implicitly loading WASM.
- [ ] Build a separate scalar encoder artifact with a narrow ABI for dimensions, row strides, pixel
  format, quality, sampling mode, restart configuration, row input, compressed output, and status.
- [ ] Implement the common baseline sequential path first: RGB and RGBA input, native grayscale,
  4:2:0, 4:2:2, and 4:4:4 output, quality 1-100, and bounded baseline output.
- [ ] Preserve row-bounded input conversion and MCU buffering. Reuse scratch planes and output buffers
  rather than accumulating the source image or complete compressed result in WASM memory.
- [ ] Let JavaScript continue to own `ImageSink` writes and backpressure. Transfer useful row batches
  and compressed chunks rather than crossing the boundary per pixel, block, or output byte.
- [ ] Keep progressive output, unsupported pixel formats, unsupported metadata modes, and configurations
  not yet implemented in Rust on the TypeScript encoder.
- [ ] Add provider-neutral encode vectors covering dimensions, sampling, quality, restart markers,
  output validity, decoded pixels, PSNR, metadata behavior, limits, and typed failures.
- [ ] Measure complete cold and warm encoding against the TypeScript reference before accepting the
  scalar Rust path as useful.

## Phase 2: profile and optimize the encoder

- [ ] Add benchmark-only stage timing for input conversion, chroma downsampling, FDCT, quantization,
  Huffman coding, bit writing, and JavaScript/WASM copies.
- [ ] Measure grayscale, 4:4:4, 4:2:2, and 4:2:0 at representative dimensions and entropy levels.
- [ ] Specialize hot kernels by input pixel format and sampling mode before entering row and pixel
  loops.
- [ ] Evaluate SIMD for RGB-to-YCbCr conversion, chroma downsampling, FDCT, and quantization. Keep
  Huffman and bit writing scalar unless profiling demonstrates a structural improvement.
- [ ] Build separate scalar and SIMD encoder artifacts with the same ABI when SIMD produces a material
  end-to-end gain.
- [ ] Preserve byte-identical output where the current floating-point order and rounding permit it.
  Any alternative fixed-point path must meet the explicit decoded-pixel, quality, and output-size
  contract rather than silently changing lossy output.
- [ ] Measure the encoder selection crossover, including cold initialization and copies, before adding
  a minimum-work threshold.

## Phase 3: return to decoder SIMD

Do not begin this phase until the scalar encoder is complete and encoder SIMD has either shipped or
been rejected by complete-workload evidence.

### Introduce a SIMD decoder artifact safely

- [ ] Keep the existing scalar module as the portable WASM fallback.
- [ ] Build a second module with `simd128` enabled and the same ABI, limits, status codes, and output
  contract as the scalar module.
- [ ] Use explicit `core::arch::wasm32` SIMD kernels where auto-vectorization does not produce clear
  generated `v128` instructions and a measured end-to-end improvement.
- [ ] Detect SIMD support once while loading the explicitly registered accelerator. Prefer the SIMD
  artifact when supported and fall back to the scalar artifact when it is not.
- [ ] Cache the selected instance for warm Node.js and browser reuse. Do not probe capabilities inside
  pixel, coefficient, row, or entropy loops.
- [ ] Test scalar, SIMD, and TypeScript paths independently so an unsupported SIMD runtime cannot hide
  scalar regressions.

### Optimize measured decoder kernels

Work in benchmark order rather than assuming every numeric stage needs SIMD.

### IDCT and dequantization

- [ ] Separate the common fixed-size interior kernel from sparse, edge, and scalar-tail handling.
- [ ] Evaluate explicit vector processing of multiple IDCT outputs while retaining the current
  accumulation and rounding behavior where exact output parity requires it.
- [ ] Evaluate fixed-point `i16`/`i32` IDCT only against the defined pixel-parity contract. Do not
  accept silent output drift merely because the kernel is faster.
- [ ] Keep coefficient and workspace storage contiguous and reuse all scratch buffers.

### Chroma upsampling and color conversion

- [ ] Select specialized grayscale, 4:4:4, 4:2:2, and 4:2:0 kernels before entering the row loop.
- [ ] Process contiguous groups of pixels with explicit SIMD loads, arithmetic, clamping, narrowing,
  and RGB packing, with scalar handling only for row tails and edges.
- [ ] Reuse precomputed horizontal sampling indices and weights; avoid generic component dispatch and
  repeated pointer calculation inside the pixel loop.
- [ ] Fuse upsampling, YCbCr-to-RGB conversion, clamping, and packing when doing so reduces memory
  traffic without changing pixels.

### Scalar cleanup

- [ ] Retain scalar Huffman decoding unless profiling identifies a concrete structural improvement.
- [ ] Replace avoidable byte-at-a-time buffer clearing or copying when bulk WASM memory operations
  benchmark faster.
- [ ] Remove bounds checks, branches, and helper boundaries from hot loops only when the validated
  memory layout makes the replacement safe and the complete benchmark improves.

## Phase 4: selection and workload coverage

- [ ] Preserve the current exclusions for progressive JPEG, ICC-transformed input, crops, native
  scaled decode, unsupported component layouts, unsafe row sizes, oversized input, and a busy cached
  instance until each path has its own correct accelerated implementation and benchmark evidence.
- [ ] Benchmark the real full JPEG pipeline, including resize workflows, rather than treating raw
  decode speed as the only product result.
- [ ] Benchmark PNG-to-JPEG, JPEG-to-JPEG resize, high-entropy input, and repeated warm Lambda-style
  encoding so encoder acceleration is evaluated in real pipelines rather than only an isolated probe.
- [ ] Keep the selector conservative when decoder-native crop or scaled-IDCT work lets TypeScript do
  substantially less work than a full-resolution WASM decode.
- [ ] Keep the encoder selector conservative when the request is too small to amortize module loading
  and input copies or when the TypeScript encoder can perform less work for an unsupported mode.
- [ ] Treat progressive JPEG as a separate compact-coefficient and bounded-reconstruction project;
  do not add a hidden full-frame WASM fallback.

## Acceptance gate

Each encoder or decoder accelerator is ready to ship only when all of the following are true:

- applicable scalar WASM, SIMD WASM, and TypeScript paths pass the permanent provider-neutral JPEG
  decode or encode parity suite;
- malformed input, limits, metadata, errors, cleanup, and fallback behavior remain equivalent;
- representative complete workloads demonstrate a material repeatable improvement rather than only
  a kernel-level win;
- cold initialization and compressed package-size costs remain small enough for browser and Lambda
  use;
- absolute peak RSS and WASM memory high-water marks preserve the bounded MCU-row architecture;
- real modern browser tests exercise both SIMD selection and scalar fallback; and
- `npm run browser:check` and `npm run check` pass.

Benchmark results belong in dated files under `benchmark/results/`. Published support remains sourced
from `capabilities/manifest.json`; this plan must not be used to claim an unchecked capability.
