# PureJsImage roadmap

PureJsImage is building a broad suite of first-party image codecs around one
portable image and raster-processing model. The implementation has three
complementary layers:

1. a permanent, first-party reference engine written in strict TypeScript;
2. optional per-codec accelerators written in Rust and compiled to WebAssembly;
   and
3. an optional future WebGPU compute backend for sufficiently large, parallel
   pixel workloads.

The TypeScript reference comes first and remains supported permanently. It
defines format behavior, safety limits, capability boundaries, conformance
fixtures, memory expectations, and the fallback available in every supported
runtime. Rust/WASM and future compute implementations accelerate that contract;
they do not become separate products or requirements for basic functionality.

Every codec follows the same durable lifecycle: implement a coherent first-party
subset, publish its checked capability contract, validate it against permanent
conformance and hostile-input corpora, make execution bounded where the format
permits it, add practical encode or broader decode depth, and introduce optional
acceleration only when measurements justify the added implementation.

## North star

For common image workflows, PureJsImage should be:

- fast enough for production JavaScript services;
- low-memory enough to reduce practical AWS Lambda memory tiers and OOM risk;
- portable across Node.js, modern browsers, and other capable JavaScript
  runtimes without native addons or external binaries;
- explicit about unsupported input instead of returning plausible corruption;
- broad enough to cover many real image codecs and basic transformations; and
- able to opt into substantially faster WASM or WebGPU execution without
  changing the application-facing pipeline; and
- able to select acceleration per operation and workload from measured total
  cost, rather than assuming that the most specialized available backend is
  always fastest.

## Permanent foundation: strict TypeScript reference engine

This is the project's permanent implementation layer, not a phase that ends
when accelerators arrive.

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
JPEG 2000, AVIF, and HEIF/HEIC, with capability depth documented separately
for each codec. CUR and JPEG XL have tracked implementation plans. JPEG 2000's
first decode subset is available; bounded reduced-resolution and region decode
remain roadmap work.

HEIF/HEIC must remain experimental and explicitly imported from
`purejsimage/codecs/experimental/heic`. It is intentionally excluded from the
root package, `allCodecs`, and automatic demo registration; its patent and
licensing notice is part of the permanent codec contract.

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

Native sample precision is now part of the ordinary pipeline contract. Crop,
flip, EXIF orientation, and quarter turns preserve every fixed-width
interleaved pixel format byte for byte. Resize operates directly on priority
16-bit and float32 formats, and 16-bit PNG can remain native through supported
transforms and PNG output. Precision reduction uses `convertPixelFormat()` or
an encoder-attributed terminal conversion. Next work in this area is planar
YUV transform support, high-depth arbitrary-angle rotation, and reducing the
compact retained state needed by Adam7 decode.

Execution evidence is now an explicit package entry. Summary and trace sessions distinguish
logical reads from physical range transfers, expose ordinary pipeline plans, record analysis
providers and tile-runtime cache ownership, and report only PureJsImage-managed bytes. Raster X-Ray
uses this API in a browser worker. Shared scientific reader, document, dataset, plane, series,
source-block, and conversion boundaries emit compact block dependencies for OME-Zarr, WSI, and Geo
without replacing their useful format-specific counters.

Phase 3 is in progress. The flagship now has an explicit 4D-STEM analysis bundle, a deterministic
processed MIB acquisition, a linked browser workspace, and a generated generic browser reader
catalog with bounded probing. Remaining work is limited to final validation and release-authorized
hardening. The detailed acceptance checklist lives in
`docs/architecture/flagship-scientific-explorer.md`.

### 4. Make the reference engine fast and measurable

- Prefer TypedArrays, monomorphic kernels, reusable scratch buffers, and
  precomputed coefficients in hot loops.
- Track wall time, throughput, peak RSS, external memory, output correctness,
  and lossy quality/size where relevant.
- Pin real phone, camera, browser, editor, and adversarial fixtures.
- Treat a fast invalid output as a failed benchmark.

### 5. Keep every runtime boundary explicit

- Keep codecs, pipeline planning, limits, and hot pixel kernels independent of
  Node globals and built-in modules.
- Preserve the established Node.js path, Buffer, zlib, and temporary-file
  adapters without adding browser checks to hot loops.
- Support browser File/Blob, ArrayBuffer, Uint8Array, Blob output,
  CompressionStream, and origin-private temporary storage through an explicit
  browser entry point.
- Use a strictly bounded memory fallback when browser private storage is
  unavailable, and fail explicitly above that bound.
- Gate releases on a browser bundle with no Node built-ins plus real-browser
  decode, transform, and encode coverage.

### Reference-engine maturity signal

A reference codec is mature when its common subset has pinned conformance
coverage, useful pipeline integration, explicit unsupported boundaries, hostile-
input coverage, and a measured memory class. Reference implementations continue
to deepen after optional accelerators begin.

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

The default `purejsimage` package retains a zero-runtime-dependency strict
TypeScript reference engine. The explicitly imported JPEG and PNG accelerators
now establish the provider boundary, lifecycle, fallback behavior, and
differential conformance pattern for later codecs.

### Ongoing delivery order

1. Keep the shipped JPEG and PNG accelerators aligned with their reference
   codecs, permanent fixtures, browser behavior, and memory contracts.
2. Extend acceleration to another mature codec only after a representative
   workload demonstrates a meaningful practical gain.
3. Apply the model to computationally heavy AVIF and HEIF/HEIC paths as their
   first-party reference subsets mature.
4. Give mature reference codecs optional Rust/WASM paths in order of measured
   workload impact rather than specification size.
5. Consider WASM SIMD and threads only after the single-threaded provider and
   memory model are stable.

## Phase 3: optional WebGPU acceleration for large jobs

WebGPU is a long-term compute backend for large, regular workloads. It is not a
replacement codec implementation and is not the next step for every operation.
Parsing, validation, codec control flow, and the portable fallback remain in the
TypeScript or optional WASM layers.

### Explicit opt-in and capability probing

The WebGPU backend will use a separate import and explicit registration. The
following is illustrative rather than a committed package or API name:

```ts
import { createImageLibrary } from 'purejsimage'
import { webGpuAccelerator } from 'purejsimage/accelerators/webgpu'

const images = createImageLibrary({ accelerators: [webGpuAccelerator] })
```

Importing `purejsimage`, `purejsimage/browser`, or a codec entry must never load,
bundle, initialize, or download WebGPU support. Applications that do not opt in
must retain exactly the reference-engine behavior and dependency graph.

In browsers, the provider can probe the standard entry point, request an
adapter, inspect its features and limits, and request a device. A missing entry
point, a `null` adapter, insufficient limits, a failed device request, or a lost
device means that the provider cannot serve that job. WebGPU is exposed only in
secure contexts, including worker contexts, so availability must be discovered
where the work will actually run.

```ts
async function requestWebGpuDevice(): Promise<GPUDevice | null> {
  if (!("gpu" in navigator)) return null

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return null

  // Check adapter.features and adapter.limits for the requested kernels first.
  return adapter.requestDevice()
}
```

The final provider interface will keep environment probing outside the planner
and hot loops. Conceptually, it must answer three separate questions:

1. Is this backend present and usable?
2. Can it express this exact operation with the required limits and semantics?
3. Is it expected to beat the other registered backends for this particular
   job after setup, transfer, dispatch, and readback costs?

Declining a job is normal provider behavior, not an error and not a reason to
weaken the operation.

### Selection is progressive, not a fixed ranking

The planner will choose a backend per operation or fused operation group. It
will not blindly prefer `WebGPU > WASM > JavaScript`:

```text
registered and available?
        |
        no  -> try the next equivalent backend
        |
       yes
        v
exact semantics and limits supported?
        |
        no  -> try the next equivalent backend
        |
       yes
        v
estimated total cost and memory are better?
        |
        no  -> use WASM or optimized JavaScript
        |
       yes
        v
use WebGPU for this operation group
```

A small resize will usually stay on optimized JavaScript because GPU setup and
copies can dominate its useful work. A large resize followed by color
conversion and sharpening is a stronger candidate because kernels can be fused
or chained while intermediates remain on the device. The initial selection
model will use conservative thresholds measured per operation and validated on
representative devices. It can become a calibrated cost model only after the
benchmark corpus contains enough evidence.

The intended progression is therefore workload-dependent, for example:

| Workload shape | Likely first candidate | Reason |
| --- | --- | --- |
| Tiny image or metadata-only operation | optimized JavaScript | lowest startup and transfer cost |
| Medium compute-heavy codec or transform work | WASM, when registered | predictable CPU acceleration and portable fallback |
| Large, regular, preferably fused pixel work | WebGPU, when registered and profitable | enough parallel work to amortize setup and transfers |

These are planning rules, not hardcoded size guarantees. Benchmarks will set
and revise the actual crossover points.

### Initial GPU scope

The best first candidates are regular, massively parallel kernels with stable
memory access:

- resize and resampling;
- convolution, blur, sharpen, and similar neighborhood filters;
- color conversion, including RGB/YUV transforms;
- tone mapping;
- alpha compositing, premultiplication, and flattening; and
- selected transform or in-loop filter kernels whose codec semantics are
  already stable in the reference implementation.

The initial GPU backend will not attempt to move an entire codec to the GPU.
The following work remains a poor first fit:

- metadata, TIFF directory, JPEG marker, or ISOBMFF box parsing;
- input validation and allocation policy;
- branch-heavy entropy decoding and codec control flow;
- operations whose exact semantics cannot be reproduced by the GPU kernel; and
- small images that cannot amortize initialization and transfer cost.

An eventual mixed pipeline may therefore parse and entropy-decode in
TypeScript/WASM, run a large transform/filter/color group on WebGPU, and return
to TypeScript/WASM for remaining codec work and encoding.

### Memory rules for GPU work

WebGPU must advance the low-memory north star, not merely reduce elapsed time.
The planner must account for CPU staging buffers, GPU buffers or textures,
intermediate resources, and readback buffers together.

- Never select WebGPU when it requires a source-sized RGBA materialization that
  an equivalent bounded JavaScript or WASM path avoids.
- Prefer tiled or striped uploads, bounded staging buffers, and fused kernels
  that keep intermediates on the device.
- Check adapter and device limits before allocating or dispatching.
- Reuse device resources where doing so is bounded and does not retain
  source-sized state between jobs.
- Include transfer and accelerator memory in benchmarks; a lower JavaScript
  heap measurement alone is not a memory win.
- Re-plan from the original input after device loss only when no output has
  been committed and the fallback remains within the caller's memory and work
  limits. Otherwise fail explicitly.

Correctness remains the entry gate. GPU results must pass the same structural,
pixel, alpha, orientation, color, and lossy-quality validation as the reference
path before their timing counts. Numeric tolerances must be operation-specific
and justified; a visually plausible result is not sufficient.

### Runtime policy

**Browsers.** The first WebGPU provider should target the standard browser API
and be usable from workers. It must probe features and limits, handle adapter
and device loss, and fall back without changing the requested workflow.

**Node.js.** The core provider contract must not depend on Node having a built-in
WebGPU API. Current Node.js documentation describes a partial `navigator` but
does not expose `navigator.gpu`. A future standard Node API, or a separately
reviewed explicit host adapter, can implement the same provider boundary without
changing codecs or the pipeline API. No third-party processing implementation
will be copied, vendored, or smuggled into production code through that adapter.

**AWS Lambda.** The documented standard Lambda architectures are `arm64` and
`x86_64`, so the supported Lambda plan remains optimized JavaScript with
optional WASM. If no usable GPU provider is explicitly registered, probing is
skipped or declines and the planner continues on CPU without treating that as a
failure.

### Delivery plan

1. Generalize the optional provider contract around explicit registration,
   capability discovery, operation support, memory ownership, and clean
   decline/fallback behavior. Do not expose speculative public names yet.
2. Add backend-neutral correctness and benchmark cases that compare JavaScript,
   WASM, and GPU candidates against the same pinned inputs and validation.
3. Prototype browser WebGPU with one large resize and one fused
   resize/color/alpha workflow. Measure cold initialization, warm execution,
   upload, dispatch, readback, CPU time, and total memory separately.
4. Establish conservative, operation-specific crossover thresholds. Keep CPU
   selected below the measured break-even point.
5. Add bounded tiling and resource reuse before broadening kernel coverage.
6. Expand to convolution, tone mapping, and selected codec-adjacent filters only
   where the reference semantics and conformance corpus are already stable.
7. Evaluate a Node provider only when its runtime boundary, deployment cost,
   and portability can be documented without changing the default package.

### Phase 3 exit signal

The first WebGPU phase is mature when at least one large real-world workflow is
measurably faster end to end, stays within an explicitly measured total memory
budget, passes the same permanent output validation as the reference path, and
falls back cleanly on browsers and runtimes without a usable adapter.

Platform assumptions in this section are based on the current
[WebGPU specification](https://gpuweb.github.io/gpuweb/),
[Node.js globals documentation](https://nodejs.org/api/globals.html), and
[AWS Lambda architecture documentation](https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html).
They must be rechecked when implementation begins.

## Invariants across every backend

- The TypeScript implementation remains readable, first-party, and usable.
- Optional acceleration never weakens hostile-input validation.
- No codec or operation silently loads, bundles, downloads, or registers an
  accelerator.
- Backend selection preserves exact operation order and semantics; an
  accelerator must decline rather than approximate an unsupported workflow.
- Correctness and bounded memory come before throughput claims.
- Specialized fast paths may coexist when benchmarks justify them.
- Compatibility claims must point to pinned fixtures and reproducible tests.

## Near-term priorities

### Application-platform status

Shipped groundwork now includes labeled-axis `ScientificDataset` descriptors, portable
`RasterBlock` reads, one-time native `NumericTile` conversion, explicit scientific reader
registries, JSON-safe operation/value descriptors, separate executable providers, trusted local
extension bundles, versioned analysis graphs and migrations, source identities and provenance,
immutable workspace commands, calibrated ROI geometry/sampling, bounded result types, a lazy tile
runtime, and the initial strict TypeScript scientific operations. All application entries are
explicit subpaths; the ordinary image pipeline remains separate.

The following remain deliberately deferred:

- explicitly registered WASM operation providers and WebGPU providers, selected by measured total
  setup, transfer, compute, readback, and memory cost rather than backend rank;
- a permissioned Worker or iframe RPC host for untrusted extensions—the current registry is trusted
  in-process code and is not a sandbox;
- FFT and frequency-domain transforms, registration, segmentation, crystallographic indexing,
  phase identification, and other materials-specific algorithms;
- mutable dirty-region painting/editing and its generation/invalidation policy;
- cloud storage, authentication, collaboration, comments, and server-side workspace services; and
- a package-owned viewport policy or application persistence envelope unless multiple real clients
  demonstrate a reusable contract.

- Deepen real-world decode compatibility at every checked codec boundary,
  especially the active AVIF, JPEG 2000, TIFF, WebP, and experimental HEIF
  subsets.
- Finish practical missing encode subsets after their decoder and pixel
  contracts are stable; AVIF's constrained first-party encoder remains a major
  planned milestone.
- Continue lowering peak memory in common JPEG, PNG, WebP, AVIF, and HEIF
  resize pipelines without hiding source-sized fallbacks.
- Expand TIFF, OME-TIFF, GeoTIFF/COG, whole-slide, and N-channel raster depth
  through the shared source, profile, and raster APIs.
- Keep bundle-size, correctness, independent conformance, and isolated-process
  memory measurements reproducible in the repository.
- Preserve real Chromium, Firefox, and WebKit coverage for shared browser
  behavior.
- Extend the optional accelerator suite beyond JPEG and PNG only when a stable
  TypeScript reference and measured workload justify it.
- Preserve backend-neutral operation plans so later WASM and WebGPU providers
  can decline, accept, or fuse work without changing public pipeline semantics.
