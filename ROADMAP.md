# PureJsImage roadmap

PureJsImage is building two complementary implementation layers around one
public image-processing model:

1. a portable, first-party reference engine written in strict TypeScript; and
2. optional per-codec accelerators written in Rust and compiled to WebAssembly.

The TypeScript engine comes first. It defines behavior, safety limits,
correctness fixtures, memory expectations, and the fallback available in every
supported runtime. Rust/WASM implementations follow that reference instead of
becoming a separate product or a requirement for basic functionality.

## North star

For common image workflows, PureJsImage should be:

- fast enough for production JavaScript services;
- low-memory enough to reduce practical AWS Lambda memory tiers and OOM risk;
- portable across runtimes without native addons or external binaries;
- explicit about unsupported input instead of returning plausible corruption;
- broad enough to cover many real image codecs and basic transformations; and
- able to opt into substantially faster Rust/WASM codecs without changing the
  application-facing pipeline.

## Phase 1: pure TypeScript reference engine

This is the current phase.

### 1. Harden the shared pipeline

- Preserve lazy execution, bounded reads, strict limits, and immutable
  pipelines.
- Keep codec registration modular so applications ship only the formats they
  accept.
- Avoid full-frame RGB/RGBA materialization whenever codec structure permits a
  bounded row, MCU, strip, tile, or superblock working set.
- Keep malformed and hostile input handling part of the normal conformance
  suite.

### 2. Build broad codec coverage

Current practical implementations cover PNG, JPEG, GIF, WebP, BMP, TIFF,
AVIF, and HEIF/HEIC, with capability depth documented separately for each
codec. ICO/CUR, JPEG 2000, and JPEG XL already have tracked implementation
plans.

The goal is not to claim an entire specification prematurely. Each codec
should first provide a useful, coherent subset for common files, fail
explicitly outside that subset, and expand against pinned real-world fixtures.

### 3. Complete the basic transform layer

- Metadata inspection without unnecessary pixel decoding
- EXIF orientation and safe auto-orientation
- Crop and region propagation toward decoders
- Nearest, bilinear, bicubic, and Lanczos resize paths
- Alpha flattening and common color-space conversion
- Practical encoders and quality controls where the format permits them

Transforms should be fused or pushed into codecs when that reduces decoded
work, copies, or peak memory.

### 4. Make the reference engine fast and measurable

- Prefer TypedArrays, monomorphic kernels, reusable scratch buffers, and
  precomputed coefficients in hot loops.
- Track wall time, throughput, peak RSS, external memory, output correctness,
  and lossy quality/size where relevant.
- Pin real phone, camera, browser, editor, and adversarial fixtures.
- Treat a fast invalid output as a failed benchmark.

### Phase 1 exit signal

Phase 1 is mature when the common subset of each tracked codec has pinned
conformance coverage, useful basic transforms, explicit unsupported boundaries,
and a measured low-memory path. Reference implementations will continue to
improve after optional accelerators begin.

## Phase 2: optional Rust/WASM codec acceleration

After a codec has a stable TypeScript reference and conformance corpus, it can
gain a Rust implementation compiled to WebAssembly.

### Provider contract

Each accelerator must:

- be explicitly installed and registered by the application;
- preserve the public codec and pipeline contracts;
- use the same input limits, error categories, metadata semantics, and output
  validation as the TypeScript reference;
- pass the same permanent fixture corpus and differential tests;
- remain optional, with no implicit network fetch or runtime download; and
- fall back cleanly to the TypeScript implementation when it is not loaded.

The default `purejsimage` package will retain a zero-runtime-dependency pure-JS
core. Packaging and provider names will be chosen when the first accelerator
contract is implemented rather than being guessed in advance.

### Delivery order

1. Define the provider boundary, lifecycle, memory ownership, and differential
   conformance harness.
2. Accelerate the highest-volume mature codecs first, expected to begin with
   JPEG, PNG, and WebP.
3. Apply the model to computationally heavy AVIF and HEIF/HEIC paths as their
   reference subsets mature.
4. Give every mature reference codec an optional Rust/WASM path, prioritized by
   measured workload impact rather than specification size.
5. Consider WASM SIMD and threads only after the single-threaded provider and
   memory model are stable.

## Invariants across both phases

- The TypeScript implementation remains readable, first-party, and usable.
- Optional acceleration never weakens hostile-input validation.
- No codec silently switches implementations or downloads code.
- Correctness and bounded memory come before throughput claims.
- Specialized fast paths may coexist when benchmarks justify them.
- Compatibility claims must point to pinned fixtures and reproducible tests.

## Near-term priorities

- Continue lowering peak memory in common JPEG, PNG, WebP, AVIF, and HEIF
  resize pipelines.
- Expand real-world compatibility at each documented codec boundary.
- Finish practical missing encode/decode subsets before widening APIs.
- Keep bundle-size, correctness, and isolated-process memory measurements
  reproducible in the repository.
- Design the optional provider interface only after the corresponding
  TypeScript codec behavior is stable enough to serve as its oracle.
