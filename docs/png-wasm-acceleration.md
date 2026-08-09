# PNG WASM acceleration plan

This document tracks the optional first-party Rust/WASM PNG decoder and encoder accelerator. The
TypeScript codec remains the portable reference and default path. Applications must explicitly import
and register the accelerator; the root package and PNG codec entry must not load WASM.

## Current architecture

JavaScript owns PNG parsing, chunk ordering and CRC validation, metadata and color policy, limits,
pipeline planning, runtime selection, and output sinks. Platform adapters already provide native
streaming zlib through `DecompressionStream`, Node `zlib`, or browser `CompressionStream`.

The remaining TypeScript hot path is row processing:

- decode assembles inflated scanlines, reverses filters 0-4, expands samples, applies palette and
  transparency rules, and emits bounded 32-row pixel blocks;
- encode scores all five filters for every row, emits the selected filtered bytes, and passes them to
  the runtime deflater;
- both directions keep only bounded rows rather than a source-sized bitmap.

The first acceleration boundary therefore keeps platform zlib and moves common scanline work into
WASM in sizeable row batches. This is smaller and safer than writing a new DEFLATE implementation
before measurements prove that native compression is the bottleneck. If complete-workload results do
not show a large benefit, stage measurements—not architectural preference—will decide whether to add
a first-party streaming inflate/deflate core.

## Performance objective

The initial acceptance target is at least a 30% reduction in warm complete decode time and warm
complete encode time on representative 2048x1536 or larger 8-bit PNG workloads, including all
JavaScript/WASM copies and native compression. Output must be exact before timing counts.

The measurement matrix must also report:

- scalar and SIMD WASM separately from the TypeScript reference;
- cold load, compile, and instantiate time;
- warm wall time and throughput;
- absolute peak RSS and WASM linear-memory high-water mark;
- raw, gzip, and Brotli artifact size;
- input and output copy cost where it is measurable;
- exact decoded pixel hashes and byte-identical encoded output when the same platform deflater is
  used.

The 30% target is an investigation gate, not a public compatibility promise. A smaller gain is not a
successful accelerator merely because an isolated kernel is faster.

## Delivery plan

### Phase 0: establish isolated baselines

- Add isolated decode and encode workers rather than using resize or cross-codec proxies.
- Use deterministic low-entropy and high-entropy gray8, rgb8, and rgba8 images at representative
  dimensions.
- Produce decode fixtures with the TypeScript reference, then require every engine to return the same
  pixel hash.
- Require scalar and SIMD encoding to produce the same PNG bytes as TypeScript and independently
  decode those bytes before accepting timing.
- Record cold and warm runs, RSS, WASM memory, initialization, artifact size, and compressed size.

### Phase 1: bounded scalar scanline core

- Add an explicit PNG acceleration provider boundary without changing `pngCodec` default behavior.
- Keep parsing, metadata, color management, CRC, zlib, limits, and sink backpressure in JavaScript.
- Implement a dependency-free `no_std` Rust module with a narrow pointer/length/dimension/status ABI.
- Decode non-interlaced 8-bit color types 0, 2, and 6 by reversing filters and returning bounded
  gray8, rgb8, or rgba8 row blocks directly.
- Encode ordered full-width gray8, rgb8, and rgba8 blocks by selecting and emitting filters 0-4 in
  bounded batches.
- Reuse WASM memory and previous-row storage. Never materialize a source-sized bitmap or inflated
  frame.
- Fall back before consuming input for palette, sub-byte, 16-bit, transparency-key, Adam7, APNG
  frames, crop, unsupported metadata semantics, small images, unavailable WASM, or a busy cached
  instance.
- Preserve typed PNG errors after acceleration has consumed input; never switch implementations
  mid-stream.

### Phase 2: SIMD and measured iteration

- Build scalar and `simd128` artifacts with one ABI and independent tests.
- Prefer SIMD once during lazy module selection and fall back to scalar when loading or validation
  fails.
- Profile complete decode and encode first. Optimize only measured row kernels, keeping scalar tails
  and the scalar artifact as correctness references.
- Specialize filter reversal and adaptive scoring by bytes per pixel before hot loops.
- Reduce copies only where ownership remains explicit and runtime zlib input/output lifetimes stay
  valid.
- Re-run the full matrix after every meaningful kernel or boundary change. Keep a change only when
  complete-workload performance improves.
- If both directions miss the target after row-kernel and copy optimization, measure zlib and CRC
  shares. Implement first-party bounded streaming DEFLATE only if those measurements show enough
  recoverable time to justify its safety and maintenance cost.

### Phase 3: integration and release evidence

- Add focused Node tests for scalar, SIMD, exact parity, selection thresholds, fallback, concurrency,
  malformed filters, unavailable modules, and lease release.
- Exercise SIMD selection and scalar fallback in a real Chromium browser.
- Add the shared `purejsimage/accelerators/wasm/png` package export for Node.js and browser
  resolution. Keep the default root, browser, all-codec, and PNG codec module graphs WASM-free.
- Include checked-in ready-to-run scalar and SIMD artifacts; users must not need Rust or a
  postinstall build.
- Record dated benchmark JSON and a human-readable result under `benchmark/results/`.
- Update the Unreleased changelog and public usage documentation without changing PNG capability
  claims: the supported format subset remains the TypeScript reference codec's contract.
- Run the focused tests and benchmark, `npm run browser:check`, real browser coverage, and
  `npm run check`.

## Public integration and fallback boundary

Node.js applications import `createImageLibrary` from `purejsimage`; browser applications import it
from `purejsimage/browser`. Both explicitly import `wasmPngAccelerator` from
`purejsimage/accelerators/wasm/png` and pass it in the library's `accelerators` array. Merely
installing PureJsImage or importing a root, browser, all-codec, or PNG codec entry never loads or
selects WASM.

The accelerator entry also exports `WasmPngAcceleratorOptions` and
`createWasmPngAccelerator(options)`. `minimumPixels` and `minimumEncodePixels` set the independent
decode and encode selection thresholds; both default to 65,536 pixels. `maximumRowBytes` limits the
row size admitted to WASM rather than permitting a source-sized allocation. The loader-neutral
provider bridge exposes `WasmPngInstanceLoader`, `WasmPngInstanceLoaders`,
`createWasmPngAcceleratorWithLoader(loader, options)` for scalar decode integration, and
`createWasmPngAcceleratorWithLoaders(loaders, options)` for independent scalar/SIMD decoder and
encoder loaders.

For decode, the accelerated subset is a full-image, non-interlaced, 8-bit PNG with color type 0, 2,
or 6 and no `tRNS` transparency key. Inflated scanlines cross into WASM in bounded batches and return
as the same ordered 32-row gray8, rgb8, or rgba8 `PixelBlock`s used by the TypeScript decoder. Palette
color, grayscale-plus-alpha, sub-byte and 16-bit samples, `tRNS`, Adam7, APNG frames, crop requests,
unsafe row sizes, unsupported metadata or color semantics, small images, unavailable or invalid
modules, and a busy instance stay on the TypeScript reference.

For encode, WASM performs adaptive filter selection for ordered, full-width gray8, rgb8, and rgba8
blocks in bounded batches. Compression level 0, other pixel layouts, unsafe row sizes, small images,
unavailable or invalid modules, and a busy instance stay on the TypeScript encoder. Selection and
instance leasing happen before inflated input or the output sink is consumed; once an accelerated
operation starts, typed failures are returned rather than changing implementation mid-stream.

JavaScript continues to own PNG parsing, IDAT CRC, metadata and color transforms, limits, sinks, and
the native runtime inflate/deflate streams. Node.js therefore retains `zlib`, while browsers retain
their platform compression streams. WASM receives disjoint input, output, and previous-row regions
and reuses bounded linear memory; it never materializes the complete inflated image or source-sized
pixel frame.

When SIMD is supported and its artifact loads and validates, the lazy selector chooses it once for
that direction. Otherwise it uses the scalar artifact. Decode and encode instances are leased
independently, so one busy or unavailable direction does not consume input or sink state before
falling back.

## Acceptance gate

The accelerator is complete only when all of the following are demonstrated by recorded evidence:

- TypeScript, scalar WASM, and SIMD WASM decode identical pixels for the accelerated subset;
- scalar and SIMD encode valid PNG with reference-equivalent filters and bytes;
- unsupported or unhelpful cases fall back before input or sink state is consumed;
- representative complete warm decode and encode each improve by at least 30%;
- cold initialization, package size, RSS, WASM memory, and copy costs are recorded and acceptable;
- browser and Node explicit imports work while default imports remain WASM-free;
- focused compatibility tests, browser checks, and the repository handoff gate pass.

The 30% thresholds are acceptance targets, not measured results. Timing is accepted only after exact
output validation and must cover the complete operation, including JavaScript/WASM copies and native
inflate or deflate. Passing this gate changes which implementation may execute eligible work; it does
not expand the PNG formats or operations supported by the TypeScript reference.

## Results recorded 2026-08-09

The first bounded-row scalar and SIMD implementations passed exact decode-pixel and encoded-byte
gates across the deterministic benchmark matrix. On 1920x1080 inputs, warm SIMD decode was
28.4%-46.9% faster than TypeScript. Warm SIMD encode was 39.0%-52.2% faster for high-entropy RGB and
RGBA input; smooth-image encode improved by 10.8%-22.2% because native deflate dominates those highly
compressible cases.

The representative high-entropy RGBA workload improved 32.1% for complete decode and 39.0% for
complete encode, satisfying the initial gate in both directions without replacing platform zlib.
Scalar and SIMD artifacts are 3,884 and 7,293 raw bytes; their Brotli sizes are 1,451 and 2,577 bytes.
Large-workload WASM linear-memory high-water marks were 1.44-1.56 MiB, and median initialization was
0.34-0.66 ms. See `benchmark/results/png-wasm-2026-08-09.md` and its machine-readable JSON for the
full cold/warm, RSS, copy-inclusive timing, artifact-hash, and correctness evidence.
