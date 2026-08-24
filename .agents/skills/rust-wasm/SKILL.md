---
name: rust-wasm
description: Use when adding or modifying Rust/WebAssembly codecs, SIMD kernels, WASM acceleration, or JS/WASM integration in PureJsImage.
---

# Rust / WASM

PureJsImage first implements and optimizes every codec as a first-party pure-JavaScript reference.
Each mature codec will then gain an equivalent optional Rust/WASM implementation. The accelerator
must not replace, weaken, or make the TypeScript reference non-production-quality.

## Architecture

* WASM is optional and explicitly imported and registered. Never load, bundle, download, or silently
  select it from the root `purejsimage` entrypoint, a default codec path, or a pure-JS codec.
* Applications that do not explicitly opt in must retain the zero-runtime-dependency pure-JavaScript
  behavior.
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

## Validation

Build every changed artifact before testing it:

```sh
npm run wasm:build:jpeg
npm run wasm:build:png
```

Run the reference JPEG and PNG validation corpora into ignored directories so historical reports
remain unchanged:

```sh
npm run corpus:imazen -- --corpus ../codec-corpus --format jpeg --output benchmark/.tmp/imazen-reference-jpeg --baseline benchmark/results --timeout-ms 30000 --memory-mb 512 --concurrency 2
npm run corpus:imazen -- --corpus ../codec-corpus --format png --output benchmark/.tmp/imazen-reference-png --baseline benchmark/results --timeout-ms 30000 --memory-mb 512 --concurrency 2
```

These commands currently register the plain TypeScript codecs in
`scripts/validate-imazen-worker.ts`; they do not exercise a WASM accelerator. Use them to protect
the reference codec and fallback behavior, never as evidence that scalar or SIMD WASM ran. The
Imazen workflow verifies decode, PNG encode and reopen, dimensions, and process safety. It does not
prove exact pixel parity.

Run the forced scalar and SIMD lanes for every accelerated web codec:

```sh
for format in jpeg png webp; do
  for variant in scalar simd; do
    npm run corpus:imazen:wasm -- --corpus ../codec-corpus --format "$format" --variant "$variant" --output "benchmark/.tmp/imazen-$format-wasm-$variant" --timeout-ms 30000 --memory-mb 512 --concurrency 2
  done
done
```

The JPEG and PNG lanes require the selected WASM kernel for each input inside that accelerator's
documented subset and record expected reference fallback outside it. Every successful input is
decoded exactly against TypeScript and encoded through the forced WASM encoder. Scalar JPEG and
PNG encoding require deterministic byte parity. SIMD JPEG encoding uses the benchmark's AAN gate:
decoded PSNR must stay within 0.05 dB and output size within 1% of the TypeScript encoder. The WebP
lane requires the selected WASM decoder and encoder for each supported still image.

A WASM corpus lane must:

* explicitly register scalar and SIMD loaders in separate runs;
* set `minimumPixels: 1` and `minimumEncodePixels: 1` so small corpus files do not silently skip
  WASM;
* count or otherwise assert loader and accelerator use for every eligible operation;
* compare exact decoded pixels or hashes with the TypeScript reference for supported valid inputs;
* compare metadata, dimensions, output bytes where deterministic, structured errors, and strict and
  tolerant decoding behavior;
* preserve isolated per-file time and memory limits; and
* fail on unexpected fallback, traps, crashes, timeouts, out-of-memory failures, raw exceptions,
  invalid output, or a valid-file behavior change.

Do not rely on the public accelerator's automatic selection for this gate because it may choose
SIMD or transparently fall back. If the repository has no reusable corpus runner with explicit
engine selection and accelerator-use assertions, add one or report the missing coverage. Do not
claim full WASM corpus validation from an ad hoc run that cannot prove which path executed.

Pass `--baseline benchmark/results` to make the Imazen CLI fail when a generated report differs
from the checked-in baseline per file. The comparison includes outcome, last completed stage,
structured error code, diagnostic, child exit code, and signal. Without `--baseline`, the CLI only
writes reports. Do not rely only on aggregate totals. Compare current WASM with the previous WASM
artifact as well as the TypeScript reference: safe acceptance differences for invalid or flexible
inputs may be established tolerant behavior, but must remain explicit.

If every isolated corpus record reports `process-crash` at `start`, check whether the sandbox blocked
child Node processes. Rerun with child-process permission before attributing the result to a codec.

After corpus validation, run focused WASM tests, real-browser scalar/SIMD selection and fallback
coverage, then the full repository gate:

```sh
npx vitest run tests/wasm-jpeg.test.ts tests/wasm-png.test.ts
npx playwright test browser-tests/compatibility.pw.ts --grep 'JPEG|PNG'
npm run check
```

## Acceptance rule

Do not introduce WASM merely because a kernel benchmark is faster.

Compare complete workloads including cold start, package size, memory, copies, output correctness, output quality, and warm execution.

Keep the JS implementation when WASM does not provide a meaningful practical improvement.
