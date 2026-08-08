---

name: rust-wasm
description: Use when adding or modifying Rust/WebAssembly codecs, SIMD kernels, WASM acceleration, or JS/WASM integration in PureJsImage.
------------------------------------------------------------------------------------------------------------------------------------------

# Rust / WASM

Use Rust/WASM only when it materially improves codec compatibility, throughput, or memory use.

## Architecture

* WASM is optional and explicitly imported. Never load or bundle it from the root `purejsimage` entrypoint or a pure-JS codec.
* Production Rust must live in this repository. Do not wrap, vendor, or compile third-party codec implementations such as libavif, libaom, libjpeg, libwebp, or OpenJPEG.
* Prefer `wasm32-unknown-unknown`; avoid WASI and OS dependencies.
* JavaScript owns I/O, pipeline planning, codec registration, validation, and orchestration. Rust owns expensive numeric/codec work.

## JS/WASM boundary

* Keep the ABI narrow: pointers, lengths, dimensions, strides, enums, numeric options, and status codes.
* Never cross the WASM boundary per pixel or coefficient. Pass blocks, rows, planes, tiles, or complete codec work units.
* Avoid unnecessary JS ↔ WASM copies. Reuse WASM memory and scratch buffers where practical.
* WASM does not justify full-frame RGBA materialization. Preserve PureJsImage's bounded-memory architecture.

## Rust performance

* Preallocate and reuse buffers.
* Do not allocate inside hot pixel/codec loops.
* Prefer contiguous cache-friendly memory.
* Precompute repeated coefficients and lookup tables.
* Fuse operations when it reduces memory traffic.
* Preserve native YUV/plane representations when possible.
* Use SIMD where benchmarks show a meaningful end-to-end win.
* Keep scalar/reference tests for SIMD implementations.

## Size and Lambda cold starts

WASM module size and initialization time are product constraints.

For every WASM implementation measure:

* `.wasm` size
* compressed package-size delta
* cold load/compile/instantiate time
* warm runtime
* peak RSS
* WASM memory high-water mark
* JS/WASM copy overhead

Prefer small purpose-built modules. Split decode and encode when doing so materially reduces package size.

Instantiate lazily and cache the instance at module scope for warm Lambda reuse.

Users must never need Rust, Cargo, wasm-opt, native libraries, or a postinstall compilation step. Publish ready-to-run `.wasm` files.

## Safety

Treat input as hostile.

Validate offsets, lengths, dimensions, arithmetic overflow, allocation sizes, block/tile bounds, bitstream reads, and output capacities in Rust even if TypeScript already validates them.

Minimize `unsafe`. Document and test any required `unsafe` block.

Return explicit error/status values rather than using panics as the normal JS-facing error path.

## Acceptance rule

Do not introduce WASM merely because a kernel benchmark is faster.

Compare complete workloads including cold start, package size, memory, copies, output correctness, output quality, and warm execution.

Keep the JS implementation when WASM does not provide a meaningful practical improvement.
