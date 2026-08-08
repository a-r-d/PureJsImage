# Repository rules

## Before handing off changes

- Run `npm run check`.
- Run the narrowest relevant benchmark or fixture verification when changing benchmark code.
- Keep every implementation and test dependency in `devDependencies`. The published package must have
  no runtime dependency tree.
- Production codecs and processing code must be implemented in this repository. Do not bundle,
  vendor, copy, or runtime-import a third-party implementation to disguise a dependency as local
  package contents. Dev dependencies may be used only as test or benchmark oracles.

## Releases

- When preparing, verifying, publishing, or auditing a release, follow the `release-purejsimage`
  repository skill in `.agents/skills/release-purejsimage/SKILL.md`.
- Only release manager Aaron Decker (`a-r-d`) publishes releases. Do not infer permission to change
  versions, create tags, push release commits, publish to npm, or create GitHub releases.
- Never request, expose, or store release credentials or npm one-time passwords.

## Code style

- Write all source, benchmark, script, and test code in TypeScript with strict mode enabled.
- Never use `any`. Prefer narrow, clearly defined types, literal types, and discriminated unions over
  broad object shapes.
- Treat external input as `unknown` and narrow it with runtime checks. Do not bypass type safety with
  unchecked assertions or suppression comments.
- Prefer the smallest direct implementation that clearly solves the current problem.
- Use a few straightforward lines instead of introducing speculative layers, factories, or generic
  abstractions.
- Add an abstraction when it removes real repetition or enforces a real invariant, not because it may
  become useful later.
- Keep functions focused and data flow obvious. Avoid clever compression that makes code harder to
  review.
- In image-processing hot paths, minimize allocations, buffer copies, full-image materialization, and
  repeated pixel passes.
- Do not add features solely for API breadth. Optimize the workflows in the project specification and
  benchmark suite.

## Runtime portability

- PureJsImage must support both Node.js and modern browsers. Treat browser support as a release
  requirement for the shared codec, pipeline, transform, source, sink, and public API behavior—not
  as a best-effort compatibility layer.
- Keep the portable module graph free of Node built-ins, Node-only globals, and Node-only public
  types. Do not use `node:*`, `Buffer`, filesystem paths, or Node streams in modules reachable from
  `purejsimage/browser` or the codec entry points.
- Put Node path, Buffer, zlib, and temporary-file behavior behind the Node platform adapters. Put
  browser File/Blob, Uint8Array/Blob output, CompressionStream, and origin-private storage behavior
  behind the browser adapters. Do not duplicate codec or pixel-processing implementations between
  runtimes.
- Browsers cannot open arbitrary local path strings. Browser inputs should use File/Blob,
  ArrayBuffer, Uint8Array, fetched bytes, or an explicit `ImageSource`; browser outputs should use
  Uint8Array, Blob, or an explicit `ImageSink`.
- Resolve runtime capabilities and select adapters before entering codec or pixel hot loops. Never
  add repeated environment detection, polymorphic runtime branching, or platform lookups inside
  per-pixel, per-row, per-coefficient, or entropy loops.
- Feature-detect browser primitives such as CompressionStream and OPFS. Any fallback must be
  bounded, documented, and tested; when a safe bounded fallback is unavailable, throw an explicit
  `ImageError` instead of silently allocating a source-sized bitmap or loading a polyfill.
- Preserve existing Node performance and memory behavior when adding browser support. Browser
  portability work must not replace a bounded Node path with a generic full-frame implementation.
- For changes to public APIs, codecs, transforms, compression, sources, sinks, packaging, or runtime
  adapters, run `npm run browser:check` and add focused browser coverage. Changes to browser runtime
  behavior must also be exercised in a real modern browser, while `npm run check` remains the full
  handoff gate.

## Lambda memory northstar

- The original production problem behind PureJsImage is Jimp's high peak memory in AWS Lambda image
  workflows. Reducing Lambda memory requirements, allocation pressure, and out-of-memory risk is a
  primary product goal, not a secondary optimization.
- A JPEG downscale must not be considered solved merely because it is faster than Jimp. Common
  baseline-JPEG resize pipelines should decode and retain bounded MCU rows or another bounded working
  set instead of a full source-resolution RGB or RGBA bitmap.
- Avoid duplicate full-frame buffers at codec boundaries. Push crop and resize requirements into the
  decoder wherever the format permits it, and release source rows as soon as they cannot contribute
  to output.
- A full-frame codec fallback must be explicit, documented, and benchmarked separately. It must not
  silently define the memory behavior of the primary Lambda workflow.
- Progressive JPEG is a distinct memory class: later scans require earlier DCT coefficients, but the
  decoder should retain compact coefficient storage rather than a full RGB or RGBA frame and should
  reconstruct final pixels in bounded rows.
- AVIF is a first-party codec goal. `@stacksjs/ts-avif`, libavif, libaom, dav1d, rav1e, SVT-AV1,
  browsers, and system tools may be used only as development oracles; never copy, vendor, or
  runtime-import their implementations.
- Design AVIF around YUV planes, tiles, superblocks, and bounded reconstruction buffers. Do not make
  a source-sized RGBA bitmap the default decoder/resize/encoder boundary. Any unavoidable full-frame
  state must be compact, explicit, separately benchmarked, and justified by AV1 dependencies.
- Treat ISOBMFF and AV1 bitstreams as hostile input. Validate nested box extents, item/property
  associations, integer arithmetic, allocation dimensions, tile boundaries, and entropy reads before
  allocating or indexing.
- Measure absolute peak RSS in isolated processes for both cold and warm executions. Ensure warmup
  allocations have actually been reclaimed before using a post-warmup baseline, and record external
  and ArrayBuffer memory when diagnosing retained pages.
- Prefer improvements that lower the Lambda memory tier needed by realistic concurrent workloads.
  Small percentage wins are useful, but they do not satisfy the northstar when peak memory still
  scales with the source bitmap.

## Tests and benchmarks

- Add or update a focused test for every behavior change and regression fix.
- Test public behavior and important edge cases rather than implementation details.
- Correct output is required before performance counts. Unsupported or invalid output is a failed
  benchmark, regardless of speed.
- Treat benchmark changes as measurement changes: keep inputs pinned, workflows reproducible, and
  comparisons equivalent across engines.


## Performance Rules for PureJsImage

The initial and reference implementation of every codec must remain first-party pure JavaScript:
no native addons, WASM, external binaries, or runtime-specific image libraries in the core or
reference codecs. Optimize these TypeScript implementations as real production paths; they define
portable behavior, provide the always-available fallback, and must not become neglected compatibility
stubs after accelerators exist.

Performance work should prioritize doing less work, reducing memory traffic, and producing JIT-friendly JavaScript.

### Hot-path rules

For pixel, codec, resize, color-conversion, entropy, transform, and compression kernels:

* Use TypedArrays (`Uint8Array`, `Uint16Array`, `Int16Array`, `Uint32Array`, `Float32Array`) rather than normal JS arrays.
* Keep hot functions monomorphic. A kernel should receive predictable argument types on every call.
* Prefer specialized kernels such as `resizeRGBA8Bilinear()` over one generic function containing format/depth/channel branches inside the pixel loop.
* Resolve format, bit depth, alpha, interpolation mode, etc. before entering the hot loop.
* Do not allocate objects, arrays, closures, or temporary buffers inside per-pixel/per-coefficient loops.
* Do not use callbacks such as `map`, `forEach`, or per-pixel visitor functions internally.
* Prefer simple indexed `for` loops.
* Minimize branches inside hot loops.
* Reuse scratch buffers and TypedArrays instead of repeatedly allocating them.
* Use `subarray()`, `.set()`, and other bulk TypedArray operations when they outperform manual copying.
* Avoid unnecessary Buffer/Uint8Array/ArrayBuffer conversions or copies.
* Keep intermediate working sets small and cache-friendly.

### Math optimizations

* Precompute values that repeat across pixels.
* Resize kernels must precompute source indices and interpolation/filter coefficients rather than recalculating them for every row.
* Use lookup tables for expensive functions when the input domain is small, especially 8-bit values.
* Consider fixed-point/integer arithmetic for pixel math, resampling, transforms, and codecs when it benchmarks faster and remains sufficiently accurate.
* Do not assume integer math is faster than floating point. Benchmark both.
* Use separable algorithms where possible, e.g. horizontal + vertical filtering rather than NxN 2D filtering.
* Prefer ring buffers or small row buffers over complete intermediate images.

### Pipeline optimizations

Before micro-optimizing arithmetic:

1. Avoid decoding or processing pixels that cannot affect the output.
2. Push crops/regions toward the decoder where possible.
3. Exploit codec-native reduced-resolution or region decoding when available.
4. Fuse compatible operations into one pixel traversal.
5. Avoid unnecessary RGB/YUV/colorspace conversions.
6. Avoid full-image materialization unless required by the codec or operation.
7. Reuse buffers.
8. Then optimize the actual kernel.

Example:

```text
Bad:
decode full image
→ crop copy
→ resize full intermediate
→ grayscale pass
→ RGB→YUV pass

Better:
decode only useful rows/region
→ resize using precomputed coefficients
→ fuse grayscale/colorspace conversion
→ feed encoder directly
```

### JIT considerations

Write hot JavaScript so V8 can optimize it easily:

* stable argument types
* stable TypedArray types
* simple numeric locals
* predictable control flow
* no polymorphic object shapes
* no abstraction layers inside pixel loops
* no dynamically changing value types

Some duplication between specialized kernels is acceptable when it measurably improves performance.

Do not refactor specialized hot kernels into generic abstractions merely to reduce code duplication.

### Memory and GC

Reducing GC pressure is a primary performance goal.

Avoid creating temporary garbage during image processing.

Where practical:

```text
allocate once
→ reuse many times
→ release/recycle
```

rather than:

```text
allocate
→ process
→ abandon
→ repeat
```

Full bitmap allocation is an explicit fallback, not the default execution model.

### Parallelism

Do not add worker-thread complexity yet. Current target workloads are small Lambda functions and single-threaded execution should be optimized first.

Architecture should not prevent future parallel execution, but workers are not a current optimization target.

### Benchmark requirement

Never assume an optimization is faster.

For meaningful hot-path changes, benchmark before and after using representative images and record:

* wall-clock time
* throughput
* peak RSS / memory
* allocations where practical
* output correctness
* output quality/size for lossy codecs

Prefer a simpler implementation unless the more complex implementation demonstrates a meaningful measured improvement.

The guiding rule is:

> Make JavaScript do less work before trying to make individual JavaScript instructions faster.

## Rust / WASM

* After a pure-JavaScript reference codec is stable, build an equivalent optional Rust/WASM
  implementation for it. The long-term goal is an optional WASM implementation of every mature
  codec, without replacing its TypeScript reference.
* WASM codecs and accelerators must use distinct explicit imports and registration. The root
  `purejsimage` entrypoint, default codec paths, and pure-JavaScript codec entries must never load,
  bundle, download, or silently select WASM.
* The default package remains a zero-runtime-dependency pure-JavaScript implementation. Applications
  that do not explicitly opt into WASM must behave exactly as they do before accelerators exist.
* Optional WASM implementations must preserve the same API, limits, errors, metadata behavior,
  conformance fixtures, and bounded-memory goals as their TypeScript references.
* When adding or modifying Rust/WASM code, follow the `rust-wasm` repo skill.
