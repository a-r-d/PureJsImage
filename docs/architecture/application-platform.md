# Application platform architecture

Status: design checkpoint approved on 2026-08-12; all ten implementation slices and the final
merge-hardening fixes are present on the unreleased branch. Publication and any release versioning
remain separately authorized future work.

This document defines a target architecture for scientific web applications built on
PureJsImage. It is deliberately additive. The existing image API, codec registry, and streaming
pixel pipeline remain the ordinary-image path; the application platform grows beside them and
shares only the portable source and block foundations.

PR 6 began from commit `624857e647428378ad1c8ebb2c85db47e476b172` (PureJsImage 0.9.0). File
names below describe the
current layout and likely implementation locations, not promises that every proposed file name is
final.

## Current constraints

The useful seams already present in the codebase are:

- `src/source.ts` defines a portable, abort-aware `ImageSource`. It gives a read buffer a precise
  lifetime, supports source sessions, and has bounded buffering. `src/sources/http-range.ts` adds a
  bounded HTTP range cache with measurable request, fetched-byte, and cache-byte statistics.
- `src/raster.ts` defines `RasterBlock` as canonical big-endian bytes with explicit shape, stride,
  planar layout, sample type, and an optional `release()` callback. Scientific readers already
  converge on that boundary.
- `src/scientific/dataset.ts` defines the sole public `ScientificDataset` model: labeled axes and
  lazy bounded `RasterBlock` plane reads. Explicitly registered FITS, MRC, CBF, GSF, ENVI, and
  OME-TIFF readers expose it through `ScientificDocument`.
- The format readers validate dimensions and source extents, keep sample data lazy, generally bound
  blocks with `maxDecodedBytes`, and propagate read cancellation through both dataset generations.
- Scientific rendering, measurement, spectral math, volume reduction, and classification now
  convert each canonical block once into a native tile before sample loops. Independent range,
  statistics, histogram, and render passes can share an explicitly created PR 8 `TileRuntime` when
  the application chooses to retain native tiles; importing scientific or analysis APIs still
  creates no long-lived cache.
- `src/image-core.ts`, `src/pipeline.ts`, and `src/executor.ts` implement an immutable linear image
  pipeline. The executor pushes eligible crops and JPEG scale selection toward decoders and streams
  `PixelBlock`s to encoders. This behavior is central to `resize().jpeg()` and must not be absorbed
  into a scientific graph rewrite.
- `src/accelerator.ts` already requires explicit accelerator registration at image-library
  construction. An `ImageCodecAccelerator` wraps a whole codec and owns its workload choice. That
  contract is intentionally too coarse for operation-level semantic matching, cost comparison, and
  provenance, so analysis providers should follow its explicit-registration principle without
  reusing its interface.
- The package isolates `purejsimage/scientific`, `purejsimage/scientific/node`,
  `purejsimage/operations`, `purejsimage/extensions`, explicit codecs, and explicit WASM
  accelerators. `tsconfig.browser.json`,
  `scripts/check-browser-build.ts`, package-type checks, project-contract tests, and real browser
  tests enforce important parts of that separation.
- The scientific explorer already runs parsing and rendering in a browser worker, but its messages
  are a demo-specific protocol. It is evidence that the portable APIs work in a browser, not an
  extension sandbox or a general application command API.

## Architectural shape and dependency direction

Dependencies point downward in the following diagram. Imports in the opposite direction are not
allowed.

```text
Application APIs and immutable workspace snapshots
  -> analysis graph, results, provenance, ROIs, commands, tile runtime
    -> operation descriptors, validation, provider contracts, local registries
      -> native NumericTile conversion and optional native tile-source contract
        -> ScientificScientificDataset descriptors and RasterBlock read selections
          -> format readers and portable RasterBlock primitives
            -> ImageSource and platform-specific source adapters
```

The ordinary image path remains separate:

```text
ImageSource -> ImageCodec -> PixelBlock -> current PipelineOperation/executor -> ImageSink
```

These paths may share `ImageSource`, limits, abort helpers, block-lifetime conventions, and small
portable value types. They must not share application state or make codecs understand graph nodes.
In particular:

- codecs and format readers must never import analysis, application, workspace, ROI, or extension
  modules;
- operation providers may consume numeric tiles but must not reach back into a concrete FITS, MRC,
  ENVI, or TIFF reader;
- the graph stores source references and selections, not live `ImageSource`, dataset, provider, GPU,
  or cache objects; and
- application code chooses registries and runtime policy. Importing a package entry must not mutate
  a package-global registry.

This is slightly stricter than describing readers and `ImageSource` as one bottom layer. In the
current code, readers import the `RasterBlock` contract and `ImageSource`, so the actual bottom is
the portable source and block primitives, with concrete readers immediately above them. Preserving
that truthful dependency direction avoids an artificial reader abstraction that the repository
does not need.

## Dataset migration and labeled axes

### Alpha release boundary

PureJsImage is alpha, and the current scientific dataset model has not been included in an actual
release. `MultidimensionalRasterDataset`, `RasterPlaneRequest`, and the current return types of
`openFits`, `openMrc`, `openCbf`, `openGsf`, `openEnvi`, and `openOmeTiff` may therefore be replaced
before the next versioned release when doing so produces a smaller, clearer public API. Do not add
permanent adapters, overloads, or deprecation layers solely to preserve an unreleased contract.

This freedom does not require a simultaneous rewrite of every format. Define the new contract first,
migrate readers in reviewable slices, and use a temporary internal bridge only if it materially
reduces PR risk. Remove that bridge before the release unless it has a demonstrated use independent
of compatibility. Each completed surface may land and be exported as its PR is merged, but all such
contracts remain provisional until the next actual version increment is published.

The release boundary is the hardening point. Before publishing that version, finalize names and
semantics, remove transitional code, document intentional breaks, run package and browser
compatibility gates, and update the version and changelog through the release process. After an API
or persisted graph format ships in that release, later changes follow normal explicit versioning and
migration rules. The existing ordinary-image pipeline and `resize().jpeg()` behavior remain outside
this scientific API freedom and must continue to pass their regression tests throughout.

### `ScientificDataset`

Use the public name `ScientificDataset` with an explicit `schemaVersion: 1`. The model had not been
published before this alpha, so its first serialized contract starts at one and migration-history
suffixes do not become part of consumer type names.

The descriptor describes dimensions as labeled axes instead of assuming every dataset is exactly `X/Y/Z/C/T`.
An axis has a stable ID, semantic kind, length, and optional unit, regular origin/spacing, or an
explicit coordinate vector. Channel descriptions remain first-class metadata rather than being
forced into numeric coordinates. `capabilities.planeReads` declares either arbitrary pairs or the
exact supported ordered pairs; `[x, y]` and `[y, x]` are not assumed equivalent. A read selection
names one supported pair and fixes, ranges, or indexes all other axes; it yields two-dimensional
`RasterBlock`s. That keeps the existing portable
block boundary usable without pretending `RasterBlock` is an arbitrary N-dimensional tensor.

The scientific read contract must include `AbortSignal` and a byte budget in its options. Cancellation must
be threaded through `readExactly()` and `ImageSource.read()` as each reader migrates, rather than
being simulated by an adapter that can only check between blocks. Tests must prove axis mapping,
channel selection, coordinate metadata, block shape, cancellation, and release propagation.

The public PR 1 boundary exposes no fixed-axis dataset or adapter. Internal parser compatibility
code may temporarily adapt an old parser result while each parser moves to native ScientificDataset construction;
that seam is not a package contract or a pattern for new readers. The adapter omits legacy singleton
Z, channel, and time dimensions unless they carry real dataset meaning. `ScientificAxisDescriptor.entries`
carries per-coordinate channel identity, name,
unit, color, and spectral center/FWHM without confusing independently selectable channels with
stored components. Generic measurement and rendering now execute from a resolved two-axis plane and
therefore support arbitrary stable display-axis IDs. Spectral helpers require the spectral axis ID;
volume projection requires the reduction axis ID; neither guesses from position. Labeled slice,
projection, integration, and ratio outputs preserve the surviving axis descriptors and remain lazy
and region-bounded. The ENVI classification renderer remains intentionally format-specific because
its class lookup table is an ENVI reader contract, not generic labeled-axis metadata.

The bridge is not release architecture and is not exported. There is no legacy package entry and no
reverse adapter for applications. Internal compatibility tests protect parser byte behavior only;
all public application and reader examples use labeled axes.

## Portable bytes and native numeric tiles

`RasterBlock` remains the canonical portable byte boundary. Its big-endian representation is stable
across Node.js, browsers, workers, machines, stored fixtures, and future backends. Readers should
continue to emit bounded blocks and should not be rewritten to produce platform-endian arrays merely
for local speed.

Repeated computation uses a separate `NumericTile`. Conversion validates a `RasterBlock` once and
produces a native-endian typed array plus immutable layout metadata: spatial origin, shape, channel
selection, logical sample type, native storage type, strides, and a `release()` operation. The
conversion mapping must be explicit. In particular, `float16` needs lossless expansion to
`Float32Array` until a portable `Float16Array` baseline exists, and `uint64` needs
`BigUint64Array`; it must not silently pass through JavaScript `number` and lose integer precision.
Providers advertise exact support for these logical and storage types.

Tiles are owned resources even though TypedArrays are mutable JavaScript objects. Callers treat tile
contents as read-only, and every consumer must release them exactly once using `try/finally`. A
derived tile either owns a distinct allocation or explicitly retains its input; it may not retain an
input buffer after releasing it.

The permanent source of `NumericTile`s is an adapter over scientific `RasterBlock` reads. A dataset may also
attach an explicit `NumericTileSource` with exact `directSemantics`, allowing a later reader or WASM
backend to produce conforming native tiles directly. `resolveNumericTileSource()` selects that path
only when source type, native type, component count, layout, and requested target support match; it
otherwise returns the adapter. This is an optional fast path, not a second dataset model or a global
provider table. It must preserve the same selection, abort, limits, ownership, sample semantics,
and conformance tests as conversion from canonical blocks.

Generic operations are tile-to-tile or tile-to-result computations. They may request halos or a
bounded reduction state, but they may not call a `readWholePlane()` convenience or concatenate an
unbounded iterable. An operation that fundamentally needs global state must declare its bounded
multi-pass plan and memory formula. If its declared budget cannot be met, planning fails with a
structured issue before execution.

## Operations: data separately from execution

An operation has two distinct public concepts:

- `OperationDescriptor` is JSON-safe data: stable operation ID, semantic version, title,
  input/output kinds, deterministic traits, tile/halo requirements, and a JSON-safe parameter
  schema. Descriptors contain no functions, TypedArrays, class instances, or executable strings.
- `OperationProvider` is trusted executable code. It declares its provider ID and implementation
  version, the exact descriptor versions and semantics it supports, a cost estimate, and an
  execution factory. It is never serialized into a graph.

Parameter schemas should use a documented, project-owned JSON Schema subset sufficient for object,
array, number, integer, boolean, string, enum, required properties, bounds, and defaults. Supporting
an explicit subset keeps validation portable and avoids a runtime dependency. Unknown schema
keywords reject during registration instead of being ignored.

Descriptors and providers are registered into caller-owned instances. A registry constructor takes
an iterable of definitions and freezes the completed snapshot. Duplicate IDs and incompatible
versions reject atomically. There is no package-global mutable singleton, side-effect import, or
hidden auto-registration. Built-in pipeline definitions are an explicitly supplied list.

A permanent strict TypeScript provider defines the reference semantics and portable fallback for
every mature operation. Future WASM and WebGPU providers use distinct explicit imports and explicit
registration, mirroring the successful isolation of codec accelerators. They cannot replace or
weaken the reference implementation.

Provider choice has two phases:

1. Filter by exact semantic support: operation and version, sample/storage types, dimensions,
   layout, no-data and NaN behavior, edge and halo rules, output kind, precision, determinism,
   reproducibility policy, and available budget.
2. Compare an estimated complete cost: setup, host-to-provider transfer, compute, readback, retained
   and peak memory, expected tile reuse, and current cache residency. The cost-model version and the
   measurements used are recorded.

Automatic selection applies caller-supplied `maxRetainedBytes` and `maxPeakWorkingBytes` as hard
constraints before comparing elapsed cost. `OperationCostEstimate` reports retained, peak working,
transfer, and output bytes separately; bytes are not converted into arbitrary time penalties.

There is deliberately no `WebGPU > WASM > JavaScript` priority. TypeScript can win for a small tile,
WASM can win when conversion is already resident, and WebGPU can win only when enough compatible
work amortizes setup, transfer, and readback. A caller policy may exclude a backend or pin one, but
the default planner compares the whole operation.

The existing `ImageCodecAccelerator` remains unchanged. It wraps codecs and owns fallback internally;
an `OperationProvider` participates in graph planning and exposes semantic and cost information.
Making one interface serve both would either break the codec contract or hide the information the
analysis planner needs.

## Analysis graph and runtime

### Graph data

An `AnalysisGraph` is immutable JSON data containing:

- a graph schema version;
- source references and source identities;
- versioned operation nodes with validated JSON parameters;
- typed ports and edges;
- named ROIs with explicit dataset-axis coordinate systems;
- requested result nodes; and
- optional execution policy, including reproducibility requirements and provider pins.

Graphs contain no live results or cache entries. Results are immutable records keyed by graph node,
selection, source identity, operation version, and execution provenance. An ROI is application data,
not a crop operation hidden inside a provider. Pixel/index ROIs and physical-coordinate ROIs are
distinct, and a conversion requires known axis calibration.

Graph JSON has one versioned canonicalization algorithm: reject non-JSON values and non-finite
numbers, normalize omitted optional fields, sort object keys, sort ID-addressed collections by ID,
and preserve order only where the schema says order is semantic. The canonical bytes are suitable
for equality, cache keys, signing, and eventual hashing. They do not by themselves prove that two
providers produce equal numeric results.

During the unreleased alpha implementation, the graph schema, operation versions, canonicalization
algorithm, and their fixtures are provisional and may be rewritten together. The next versioned
release pins their first durable forms. From that release onward, changing one requires a new version
and the explicit migration behavior below.

Parsing validates one graph version exactly. `migrateGraph()` is an explicit operation that returns
a new graph plus a structured migration report. Execution never silently rewrites old parameters,
changes defaults, substitutes a newer operation version, or persists a migration. If a semantic
change cannot be represented mechanically, migration returns an issue requiring a human choice.

### Tile runtime

The tile runtime owns bounded tile scheduling, cache accounting, in-flight deduplication, and release
propagation. Planning stays in the analysis planner, and canonical-byte conversion stays in the
explicit `NumericTileSource` adapter; moving either into the runtime would mix policy or reader
concerns into a cache primitive. A `DerivedTileSource` consumes one exact provider selection already
made for its node; provider choice cannot vary by tile. Every tile request requires an `AbortSignal`; callers that do not need external
cancellation may pass a fresh non-aborted signal. Tile size, cache bytes and entries, key bytes,
queue length, and concurrent executable work have explicit limits. Reader/source-byte limits and
provider/result budgets remain enforced at their owning boundaries and feed the runtime's accounting
when known.

Cancellation stops new admissions, propagates to sources and providers, closes iterators, and
releases cached, in-flight, input, output, and provider resources. Cancellation and failure paths are
tested as strongly as success paths. Concurrency is an input to the scheduler, never an unbounded
`Promise.all()` over tiles.

The public lazy boundary is `TileSource`, not another `ScientificDataset` subtype. The existing
`NumericTileSource` request lacks source runtime identity, cache namespace/generation, priority, and
target layout, all of which are required before a safe cache key can be formed. An explicit
`numericTileSourceToTileSource()` adapter preserves the scientific source contract at the bottom,
while `DerivedTileSource` remains a descriptor-bearing lazy view for application execution. Composite
sources request dependencies through the runtime: the scheduler suspends their current permit while
a dependency runs and reacquires one before provider compute, preventing nested deadlock at a
concurrency limit of one without exposing queue internals.

Cache policy is explicit and local to a runtime instance. Cache keys include source identity
strength, selection, tile coordinates, operation and semantic version, canonical parameters, and
any provider-specific compatibility boundary. The runtime exposes at least hits, misses, admissions,
evictions, current bytes, high-water bytes, conversion bytes/time, and avoided source bytes.
Benchmarks must state tile dimensions, workload, cache budget, cold/warm state, and output
correctness. An optimization is accepted only when those measurements demonstrate the claimed
benefit.

## Reproducibility and source identity

Every operation node pins an operation ID and semantic version. Every result records the chosen
provider ID, provider implementation version, cost-model version, source identity evidence, graph
canonicalization version, and relevant runtime/device facts. Provider selection is therefore
auditable even when it is not pinned in advance.

Source identity uses a ladder so first display does not require reading and hashing a
multi-gigabyte source:

1. **Ephemeral identity:** a caller/session token plus object identity and byte length. It is valid
   only inside that workspace session.
2. **Metadata identity:** a locator with trustworthy metadata such as a strong HTTP ETag and length,
   or a local file handle with size and modification metadata. Weak HTTP validators and file names
   are recorded as weak evidence, not treated as content identity.
3. **Sampled fingerprint:** size plus versioned hashes of declared bounded regions such as headers,
   tails, and selected tiles. This improves collision resistance but is not a full content proof.
4. **Content identity:** a full versioned digest, computed lazily in the background or when a policy
   requires it.

Weak identities must not authorize cross-session or persistent cache reuse. When stronger evidence
arrives, the workspace records an explicit identity refinement and can re-key verified results; it
does not pretend that earlier results were created with the stronger identity.

The reproducibility request and result distinguish four levels:

- **Bit-exact:** the operation contract and selected provider guarantee identical output bytes for
  the recorded inputs and environment constraints.
- **Backend-stable:** the same provider implementation version and relevant runtime/device class are
  expected to repeat, but other conforming providers may differ.
- **Tolerance-based:** comparison uses recorded absolute, relative, and domain-specific tolerances.
- **Provider-pinned:** execution must use the named provider and implementation compatibility range;
  absence is an error rather than permission to fall back.

These dimensions are not a single ascending scale. A provider-pinned floating-point operation may
still be tolerance-based, while a portable integer reference operation may be bit-exact without a
provider pin. The result records both the requested policy and what was actually achieved.

## Application commands, scripts, and agents

UI controls, scripts, trusted plugins, and a future AI agent use the same machine-readable operation
descriptors, graph schema, validation, planner, and command API. There is no AI-only mutation path,
prompt-only operation, hidden registry, `eval`, `Function` constructor, or serialized code.

Commands operate on an immutable `WorkspaceSnapshot`. A command is JSON-safe data such as adding a
node, connecting ports, setting parameters, defining an ROI, or requesting a result. Applying a
command returns either a new snapshot and a structured change record or the unchanged snapshot plus
structured validation issues. Issues include stable codes, severity, JSON paths and graph IDs, and
human-readable messages, so the same response can drive forms, CLI output, plugins, and agent repair.

Graph mutation never executes work. After validating and reviewing a snapshot, the caller explicitly
requests planning and then execution. Execution receives the exact immutable snapshot or canonical
graph digest, an explicit registry and runtime policy, and an `AbortSignal`; it returns structured
progress, provenance, results, warnings, and failure issues. An append-only audit stream can record
commands and execution events without making the graph itself mutable.

### Extension trust boundary

Extension bundles are trusted in-process TypeScript/JavaScript for the first implementation. They
may register descriptors, providers, schemas, and commands only into a registry instance supplied by
the host. The host validates bundle IDs, versions, and declarations, but this is compatibility
validation—not a security sandbox. In-process code has the authority of the host realm.

The bundle descriptor ID is also its ecosystem namespace. Readers use the extension ID followed by
`/`; value types, operations, providers, migrations, and migrated operation IDs use the extension ID
followed by `.`. This keeps one trusted package from contributing unrelated IDs without introducing
a global mutable namespace owner.

A Worker or cross-origin iframe RPC boundary for untrusted extensions is future work. That boundary
will need a structured-clone-safe protocol, capability-scoped source/tile handles, transfer and copy
accounting, cancellation, quotas, timeouts, crash cleanup, and version negotiation. The in-process
registry must not be marketed as safe for untrusted code while that work remains unimplemented.

## Intended package boundaries

The public module graph should develop as follows:

- `purejsimage` and `purejsimage/browser` keep the current ordinary image API and behavior. No
  analysis module is imported from either root.
- `purejsimage/scientific` owns portable `ScientificDataset` descriptors, documents, registries,
  algorithms, and numeric tile contracts/conversion. Concrete readers live in
  `purejsimage/scientific/readers/{gsf,envi,fits,mrc,cbf,ome-tiff}`; the explicit
  `purejsimage/scientific/readers/all` entry is available when an application deliberately wants
  every reader. `purejsimage/scientific/node` remains the place for path-based helpers.
- `purejsimage/operations` exports JSON-safe descriptors and schemas, provider contracts,
  caller-owned registries, and built-in definitions that lower into existing validated pipeline
  constructors. PR 4 supplies provider mechanics and mocks, while PR 5 still owns real strict
  TypeScript scientific operation implementations.
- A future `purejsimage/analysis` entry exports graph parsing/canonicalization/migration, ROIs,
  results and provenance, planning, tile runtime, immutable workspace snapshots, and commands. It
  depends on `operations` and `scientific`, not on concrete readers or Node adapters.
- `purejsimage/extensions` contains trusted bundle composition and keeps those conveniences out of
  `operations` and future `analysis`. It is not a global registry or an implied sandbox. A future
  RPC package can be split again if its transport dependencies would enlarge this entry.

Every new entry receives browser typechecking, a browser bundle traversal that rejects `node:*`,
package export/type checks, and a real browser smoke test. Node-only helpers stay behind explicit
Node subpaths. WASM and WebGPU providers remain explicit optional subpaths and are absent from
default browser bundles.

The current `PipelineOperation` type is not promoted into `purejsimage/operations`. It represents a
linear image-to-encoded-image recipe and includes values such as a `Uint8Array` LUT that are not
JSON-safe. Keeping the names separate avoids implying that persisted analysis graphs can execute
arbitrary image pipeline stages or that changing the new graph engine is necessary to preserve
`resize().jpeg()`.

## Ten-PR implementation runbook

Each PR is independently reviewable and keeps `npm run check` as its final gate. A completed public
surface may be exported in that PR after focused compatibility and browser checks; it does not need
to wait for PR 10. Until the next actual version is published, those new contracts may still change
when the later work demonstrates a cleaner boundary. Proposed new paths are shown to make ownership
concrete; names can change during review without changing the layering.

| PR | Scope | Current files likely to change, plus proposed homes | Compatibility risk | Focused tests | Acceptance gate |
| --- | --- | --- | --- | --- | --- |
| 1 | Define `ScientificDataset` labeled-axis descriptors, replace the unreleased fixed-axis public contract, and migrate the first representative readers. | `src/scientific/dataset.ts`, `src/scientific/index.ts`, selected files under `src/scientific/formats/`; optionally a temporary internal migration bridge. | Current demos and tests must migrate with the intentional break; transitional code could outlive its purpose. | Contract tests using FITS, MRC, ENVI, and an irregular synthetic axis; affected scientific format and demo tests. | The new API is smaller than an adapter-based alternative; migrated readers have no legacy wrapper; temporary bridges are explicitly tracked for removal; `npm run browser:check`; `npm run check`. |
| 2 | Migrate the remaining scientific readers, remove transitional bridges, and require abort- and budget-aware scientific reads. | `src/scientific/formats/{fits,mrc,cbf,gsf,envi}.ts`, `src/scientific/ome-tiff.ts`, `src/scientific/{render,spectral,volume,classification}.ts`, `src/source.ts`, abort/limit helpers. | Partial reads or cancellation could leak blocks; format-specific metadata could be lost during migration. | Focused abort-before-read, abort-during-read, iterator-return, release, metadata, and byte-budget tests for contiguous and strided readers. | All readers use the ScientificDataset contract directly; no compatibility bridge remains; no read continues after observed abort; every yielded/rejected block is released; source-byte cap is enforced; `npm run check`. |
| 3 | Introduce `NumericTile`, validated one-time conversion, explicit caller-owned allocation, and the optional direct native tile-source capability. | `src/scientific/{numeric-tile,render,spectral,volume,classification}.ts`, `src/scientific/index.ts`, focused tests and benchmark. | Endianness, float16 expansion, uint64 precision, planar/interleaved strides, or ownership could change values. | Cross-sample-type golden tests, hostile stride/truncation tests, release-on-error tests, reference-vs-direct-source conformance, existing algorithm result suites. | Canonical block fixtures produce exact native values; no `uint64` number coercion; measured retained-byte bounds; `npm run browser:check`; `npm run check`. |
| 4 | Define JSON-safe operation descriptors and local registries; add provider mechanics, current pipeline lowering, trusted extension composition, and explicit public subpaths without implementing new scientific computation. | New `src/operations/{descriptor,registry,provider,builtins,index}.ts`, `src/extensions/index.ts`, `package.json`, browser/package/size scripts, focused tests, and trust-boundary docs. | Defaults or unknown-key handling could become persisted semantics; provider policy could imply a backend rank; extensions could be mistaken for isolation; ordinary pipeline behavior could drift. | JSON/hostile validation, registry isolation, provider cost/pin/release, IR parity, extension atomicity, strict package-consumer, and browser dependency-graph tests. | Descriptors/manifests contain only data; registries remain local; pipeline IR and fluent APIs remain unchanged; no import-time installation; new entries are browser-portable; `npm run check`. |
| 5 | Define bounded provider-neutral quantitative results, adapt existing scientific measurement without duplicate wrapper scans, and add the explicit analysis entry. | New `src/analysis/{result,scientific,index}.ts`; `src/scientific/render.ts`, scientific exports/tests, package/browser/type/size checks, and result docs. | Typed payload ownership or NaN/unit semantics could be ambiguous; generic adapters could reread planes; large results could be accidentally serialized as JSON. | Synthetic scalar/histogram/profile/table/collection validation, million-row columnar metadata, bounded summaries, legacy/generic differential measurements, cancellation/release, and package-boundary tests. | Result memory is bounded and accounted; legacy and generic outputs share one measurement execution; manifests contain schemas rather than payloads; the analysis entry is browser-portable and explicit; `npm run check`. |
| 6 | Add immutable graph JSON, canonicalization, source identities, explicit migrations, generic planning/execution/provenance, and revisioned commands. | `src/source-identity-contract.ts` and `src/source-identity.ts` beside the bottom-level source contract; new `src/analysis/{graph,canonical-json,migrations,planner,executor,workspace,controller}.ts`; source wrappers, HTTP/File adapters, extension composition, explicit analysis exports, docs, and package/browser checks. Source identity deliberately does not live under `analysis`, because `ImageSource` must not import upward into application code; normalization and hashing are re-exported from the explicit analysis entry so the root size budget stays intact. | Canonical bytes will become durable at release; weak identities could poison persistent caches; command convenience could execute implicitly; provider failures could leak values. | Property-order/hash invariance, graph limits/types/cycles, identity propagation and bounded hashing, migration paths, no-read dry runs, provider policies, releases/cancellation/concurrency, provenance, stale commands, extension atomicity, strict consumer types, and browser dependency checks. | Canonical behavior remains revisable until the release gate; weak identity stays explicitly weak; commands never execute; prepared DAG execution is bounded/cancellable and releases ownership; `npm run browser:check`; `npm run package:types`; `npm run check`. |
| 7 | Define calibrated ROI geometry, tile-local masks, deterministic line sampling plans, built-in ROI value types, and immutable workspace ROI commands. | New `src/analysis/{roi,roi-sampling}.ts`; `src/analysis/{workspace,controller,index}.ts`; operation value-type composition; scientific labeled-axis descriptors; package/browser checks, focused tests, and docs. | Pixel-boundary and pixel-center conventions could be mixed; non-monotonic calibration could be treated as invertible; masks could materialize a whole plane; ROI commands could blur graph mutation and execution. | Geometry/limit/canonical tests, ascending and descending coordinate conversion, 4D fixed indices, partition-invariant tile masks, concave polygons, nearest/bilinear line plans, stale commands, value-type registry isolation, and browser/package checks. | Coordinates and units are explicit; physical inversion rejects unsupported axes; masks stay tile-local; sampling plans read no pixels; commands remain immutable and never execute; `npm run browser:check`; `npm run package:types`; `npm run check`. |
| 8 | Build a bounded local tile runtime, adapt native scientific sources, and execute already planned providers as immutable halo-aware derived sources. | `src/analysis/{tile-runtime,tile-source,index}.ts`, `tests/analysis-tile-{runtime,source}.test.ts`, `benchmark/scientific/run-tile-runtime.ts`, package/type/browser checks, `docs/analysis-tile-runtime.md`, README, and this checklist. Scheduler and LRU mechanics stay private inside `tile-runtime.ts`; splitting files would expose no cleaner boundary at this size. | Double release, nested-scheduler deadlock, retained buffers, starvation, unbounded queues, weak-identity/key collisions, provider-key drift, or halo seams. | True LRU/budget/release, 1,500-task queue stress, cancellation races, in-flight sharing, priority aging, hostile keys/coordinates/accounting, provider fallback/pin/fingerprint, clipped halo partition invariance, dependency release, and queued invalidation. | Byte and concurrency high-water behavior stays within policy; nested reads work at concurrency one; failures and evictions release once; source/derived behavior and provider timing are measurable; package/browser/focused gates and `npm run check`. |
| 9 | Add the first strict TypeScript scientific analysis operations: dataset transforms, ROI-aware reductions, line profiles, threshold, Gaussian blur, capabilities, and data-driven workflows. | New analysis-owned built-in definition/provider modules because these operations depend upward on datasets, tiles, ROIs, results, and graph execution; analysis exports, focused tests, a blur benchmark, docs, and package/browser/size checks. `purejsimage/operations` remains the lower-level descriptor/provider contract and does not import analysis. | Numeric data could be routed through display pixels; transforms could materialize whole datasets; inferred descriptors could read pixels; ROI reductions or halos could vary by tile partition; graph execution could bypass local registries. | Arbitrary-axis/calibration/pushdown, sample-type, integer/no-data, deterministic reduction, ROI partition, line-profile, threshold exactness, blur seam/boundary/tolerance, cancellation/release, graph/provenance, command/capability, extension isolation, and ordinary-pipeline tests. | Every built-in is versioned and explicitly registered with the permanent reference provider; metadata-only inference reads no pixels; execution stays bounded and cancellable through NumericTiles and the tile runtime; the blur benchmark validates output before timing; package/browser/ordinary-image gates and `npm run check`. |
| 10 | Complete release-boundary hardening of the application platform and trusted extension boundary, and prove whole-platform ordinary-image/browser compatibility. | `package.json`, browser/package checks, project-contract tests, `src/index.ts`, `src/browser.ts`, `src/extensions/`, real browser tests, and version/changelog files only during an authorized release. | Provisional subpaths could still pull optional backends into browsers; root bundle or `resize().jpeg()` behavior could drift; contracts could be published prematurely; trust wording could overstate isolation. | Package consumers, bundle graphs, registry isolation, trust-label tests, current pipeline tests, scientific browser smoke, and canonical persisted-contract fixtures. | Transitional code is removed; release contracts and breaks are documented; root/browser exports exclude analysis/backends; existing `resize().jpeg()` and real Chromium scientific workflows pass; `npm run check`. |

New package subpaths and completed capabilities may land incrementally in the PR that makes them
usable. PR 10 is the release-readiness gate, not the first publication point. Repository exports
before that gate are provisional alpha contracts; an actual package release must not occur until the
whole exported surface passes the final browser, package, compatibility, and persisted-contract
checks.

The detailed PR 7 ROI runbook supplied after PR 6 supersedes the earlier coarse allocation of PR 7
to the tile runtime. That runtime moved to PR 8; PR 9 no longer owns the ROI primitives and instead
consumes them through the built-in analysis operations.

The detailed PR 9 built-in-operation runbook supplied after PR 8 supersedes that remaining coarse
persistence/audit allocation. PR 9 now proves the operation system against real scientific work.
The reusable JSON project envelope is specified by
[`docs/contracts/analysis-project-v1.md`](../contracts/analysis-project-v1.md). Full typed result
persistence and append-only audit storage remain intentionally deferred and are not implied by the
in-memory provenance delivered here.

## Decisions and rejected shortcuts

- **Keep `RasterBlock`; add `NumericTile`.** Renaming the existing type to “tile” would blur the
  portable byte contract with native compute ownership and create churn in all readers.
- **Replace the unreleased fixed-axis API cleanly.** Permanent compatibility adapters would preserve
  a contract that has never shipped and make every later call path harder to understand. Temporary
  internal migration code is acceptable only when it keeps reader PRs reviewable and has an explicit
  removal point.
- **Do not turn the image executor into the graph executor.** The current executor contains valuable
  image-specific crop, scaled-decode, orientation, normalization, and encoding logic. A generic DAG
  would make those optimizations less obvious and put stable image behavior at risk.
- **Do not reuse the codec accelerator contract.** Its explicit registration is the right precedent;
  its whole-codec wrapping and internal fallback are the wrong granularity for operation planning.
- **Do not promise transparent reproducibility.** Canonical JSON, versioned operations, and provider
  records make runs auditable. Numeric equivalence still depends on the operation's declared class
  and recorded provider/runtime facts.
- **Do not treat quick source identity as content identity.** Fast first display and durable cache
  reuse are separate goals; the identity ladder must make that distinction visible.
- **Do not call trusted extension registration a sandbox.** Isolation begins only when execution is
  moved behind a capability-limited Worker or iframe protocol and that protocol is tested as a
  security boundary.

## Approved implementation decisions

The maintainer approved the following decisions on 2026-08-12:

1. the `ScientificDataset` public name, `schemaVersion: 1`, labeled-axis selection model, and clean
   replacement of the unreleased fixed-axis dataset contract when that reduces complexity;
2. the `NumericTile` ownership and storage mapping, especially float16 expansion and exact uint64
   handling;
3. separation of analysis operations from both current `PipelineOperation` and
   `ImageCodecAccelerator`;
4. the JSON-schema subset, operation versioning rules, canonical graph format, and explicit migration
   policy, with those contracts becoming durable only at the next versioned release;
5. the source identity ladder and prohibition on persistent reuse under weak identity;
6. the semantic filter and measured total-cost provider policy, including recorded provider and
   implementation versions;
7. the four reproducibility classifications and bit-exact cross-provider claims only when proven by
   conformance tests;
8. caller-owned registries, trusted in-process extension wording, and the Worker/iframe security
   boundary remaining future work;
9. the proposed `scientific`, `operations`, `analysis`, and optional `extensions` package ownership;
   and
10. the ten-PR order, incremental landing of completed exports, freedom to revise unreleased alpha
    contracts between PRs, and final hardening only at the next authorized versioned release.

## Application-platform implementation checklist

This is the authoritative progress log for the application-platform program. Update it in the same
change as the work it tracks. A checked item means its implementation and stated verification are
complete; merging, committing, publishing, or releasing still requires the authorization applicable
to that action.

The detailed PR 1 prompts were supplied after the architecture approval. They originally assumed a
permanent fixed-axis/scientific compatibility period. The later approved alpha policy supersedes that assumption:
the unreleased fixed-axis API may be replaced when that produces cleaner code. Temporary adapters
remain an implementation option, not a compatibility requirement. Preserve the prompts' substantive
parity, metadata, laziness, release, cancellation, and bounded-memory acceptance criteria whichever
migration path is chosen.

### Completed design work

- [x] Prompt 0: inspect the current architecture and write this application-platform checkpoint.
- [x] Record the ten maintainer decisions, including the revised alpha release and incremental export
      policy.
- [x] Add this checklist and the repository-level pointer in `AGENTS.md`.

### PR 1: labeled-axis scientific dataset

- [x] Prompt 1.1: add the ScientificDataset contracts and validation.
  - [x] Re-read `AGENTS.md`, record HEAD/status, and inspect the current dataset, raster, scientific
        algorithm, test, and export surfaces without disturbing user changes.
  - [x] Define `ScientificAxisDescriptor` with stable IDs; names; semantic kinds; positive lengths;
        units; and explicit index, linear, finite numeric lookup, or string-label coordinates.
  - [x] Define `ScientificComponentDescriptor` for samples stored together at one selected
        coordinate, keeping independently selectable spectral bands as axes.
  - [x] Define `ScientificResolutionLevel` without assuming that only X and Y change in a pyramid.
  - [x] Define the JSON-safe `ScientificDatasetDescriptor`, including sample type, components,
        optional levels/no-data, typed metadata, and explicit read capabilities.
  - [x] Define `ScientificPlaneReadRequest` with ordered horizontal/vertical axis IDs, explicit fixed
        selections, optional region/level, and `AbortOptions`-style cancellation.
  - [x] Define lazy `ScientificDataset` reads that return `AsyncIterable<RasterBlock>` and keep graph
        and operation types out of the data-plane PR.
  - [x] Add bounded validators/normalizers for duplicate or empty IDs, hostile lengths, calibration,
        coordinate lengths, levels, components, axes, fixed indices, singleton normalization, and
        selected-level regions.
  - [x] Validate JSON-safe metadata, rejecting unsupported values, cycles, and non-finite numbers
        without repeatedly copying large coordinate storage or overstating nested immutability.
  - [x] Add synthetic X/Y, X/Y/Z, X/Y/channel/time, X/Y/energy, 4D-STEM, nonlinear-coordinate, and
        malformed/request-validation tests.
  - [x] Export only stable scientific types/utilities; add no dependency, codec, Node-only path, global
        registry, or full-frame buffering.
  - [x] Run focused Vitest tests, `npm run typecheck`, `npm run lint`, and `npm run format:check`;
        review `git diff --stat`.
  - Result: 28 ScientificDataset contract tests and 92 affected scientific tests pass; browser and packed-declaration
    checks also pass. The fixed-axis API remains untouched pending Prompt 1.2. The full repository
    check reaches Vitest with 970 passing tests and the same three unrelated AVIF Sharp-oracle hash
    failures recorded before Prompt 1.1; the hostile-source phase is not reached after that failure.

- [x] Prompt 1.2: resolve the old/new dataset migration boundary.
  - [x] Re-read repository instructions and inspect all Prompt 1.1 changes and current status.
  - [x] Choose and document the cleaner migration: temporary lossless adapters or direct replacement
        of the unreleased fixed-axis contract. Do not add a permanent 0.9.x compatibility layer by
        default.
  - [x] If a fixed-axis-to-scientific bridge is useful, preserve X/Y/Z/C/T mapping, calibration, channel and
        spectral metadata, sample/no-data/source metadata, resolution selection, lazy blocks, exact
        coordinates/values, release callbacks, and abort propagation.
  - [x] If a scientific-to-fixed-axis bridge is useful, allow only truthful X/Y plus optional Z/C/T mappings and
        reject arbitrary axes such as scanX/scanY/kx/ky rather than flattening or relabeling them.
  - [x] Provide one internal normalization path only if it removes real duplication; keep conversion
        work outside per-sample hot loops.
  - [x] Add parity tests for uint8, uint16, float32, planar/interleaved layouts, calibration/channel
        metadata, releases, aborts, and unsafe 4D-STEM reverse mapping where an adapter exists.
  - [x] Run focused migration and affected scientific tests, `npm run typecheck`, `npm run lint`, and
        `npm run format:check`; review `git diff --stat` and record any intentional API break.
  - Result: the temporary bridge uses explicit `toScientificDataset()` and
    `toMultidimensionalRasterDataset()` adapters plus one internal dataset-form guard shared by
    algorithm boundaries. fixed-axis-to-scientific keeps the original `RasterBlock` object, data, coordinates,
    layout, and release callback; maps logical channels to typed axis entries; and forwards
    cancellation through the now abort-aware V1 request. Known pyramid geometry must be supplied
    explicitly because V1 does not describe level dimensions. scientific-to-fixed-axis accepts only literal spatial
    `x`/`y`, optional spatial `z`, channel or spectral `channel`, optional `time`, one stored
    component, and metadata representable as a flat string record; richer axes, components, or
    metadata are rejected rather than discarded. The fixed-axis interface is deprecated as a
    temporary alpha bridge, not promised through a permanent 0.9.x window. The 40 focused scientific/adapter
    tests and 176 affected scientific/reader tests pass, as do typecheck, lint, and formatting.

- [x] Prompt 1.3: make existing scientific algorithms labeled-axis aware and close PR 1 scope.
  - [x] Re-read repository instructions and inspect every accumulated PR 1 change before editing.
  - [x] Use thin normalization at algorithm boundaries; do not fork fixed-axis/scientific implementations or make
        hot sample loops polymorphic.
  - [x] Resolve stable axis IDs once for rendering, measurement, statistics, histograms, spectral
        selection/composites/ratios, volume slicing/projection, and classification where applicable.
  - [x] Require explicit semantic axes and precise errors for operations such as reductions; never
        guess an arbitrary dimension's meaning.
  - [x] Preserve physical coordinates and units on derived datasets and preserve bounded streaming
        behavior without new full-frame materialization.
  - [x] Prove shared generic measurement/rendering for X/Y, X/Y/Z with an explicit reduction axis,
        X/Y/energy, and scanX/scanY/kx/ky selections. Prove legacy behavior only if the migration
        decision retains that API.
  - [x] Update this architecture document with the implemented boundary and public documentation
        with a synthetic labeled-axis construction/render example.
  - [x] Run the full scientific test subset, `npm run browser:check`, `npm run package:types`, and
        `npm run check`; fix only failures caused by PR 1 and record unrelated failures separately.
  - [x] Review final `git diff --stat`; document the public scientific API, deferred assumptions, and ordinary
        image-pipeline regression result.
  - Result: render and measurement resolve one scalar plane before entering the existing row scans,
    so legacy and labeled callers share statistics, histograms, range measurement, relief, and pixel
    mapping without polymorphism in sample loops. Labeled spectral selection, rendering, composites,
    integration, and ratios require an explicit spectral-axis ID. Labeled slices preserve the two
    selected axes; projections require an explicit reduction-axis ID and retain only bounded output
    rows and one contributing plane region at a time. ENVI classification stays format-specific
    until `ScientificDataset` has a generic categorical metadata contract. The 180-test scientific/reader subset and
    a 78-test ordinary pipeline/JPEG/PNG subset pass; browser and packed-declaration checks pass. The
    repository-wide check has 984 passing tests and stops on the same three unrelated 12-bit AVIF
    Sharp-oracle hash mismatches from the earlier baseline, so the hostile-source phase is not
    reached.

### PR 2: scientific reader and document registry

- [x] Prompt 2.1: add portable resource, reader, document, probe-budget, and local registry
      contracts.
  - [x] Re-read repository instructions, record HEAD/status, and inspect `ImageSource`, source
        sessions, HTTP range behavior, scientific Node adapters, OME-TIFF, ScientificDatasets, existing
        format opens, exports, and representative tests.
  - [x] Define runtime-neutral `ScientificResource`, normalized companion requests/resolvers, and
        `ScientificOpenContext` for single- and multi-resource formats without filesystem or path
        traversal assumptions in portable code.
  - [x] Define JSON-safe `ScientificReaderDescriptor` data separately from executable
        `ScientificReader` implementations, including bounded probes and explicit open calls.
  - [x] Define `ScientificDocument` with cheap metadata, stable dataset summaries containing
        labeled-axis descriptors, lazy `openDataset(id)`, and an optional explicit close hook.
  - [x] Implement a caller-owned `ScientificReaderRegistry` with immutable enumeration, duplicate
        ID/version rejection, deterministic confidence ordering, explicit-reader selection, and
        clear no-match/ambiguity errors.
  - [x] Implement a session-correct, abort-aware probe-limited `ImageSource` wrapper enforcing total
        bytes and read-count budgets without allowing a probe to consume the full source.
  - [x] Add mock-reader tests for ordering/confidence, ambiguity, duplicates, explicit selection,
        byte/read budgets, cancellation, multi-resource contexts, and summary enumeration without
        pixel reads.
  - [x] Export only stable portable contracts; add no globals, side-effect registration, Node
        built-ins, codecs, plugin/graph APIs, runtime dependencies, or full-frame reads.
  - [x] Run focused tests, typecheck, lint, and formatting; record `git diff --stat` and exact probe
        budget semantics.
  - Result: detection probes readers sequentially in registration order against one shared default
    budget of 32 readers, 32 non-empty reads, 32 companion resolutions, 65,536 logical bytes, and
    16,384 logical bytes per read. Reservations occur before underlying I/O; sources must return the
    exact admitted length; overlapping and repeated reads count again; primary and companion
    resources share the ledger; and zero-length or wholly out-of-range reads do not consume it.
    Explicit reader selection bypasses probing. The 38 focused registry and dataset tests pass with
    typecheck, lint, and formatting.

- [x] Prompt 2.2: adapt GSF, MRC/CCP4, and CBF/imgCIF.
  - [x] Re-read instructions/status and inspect accumulated Prompt 2.1 changes plus each existing
        parser, dataset, fixture, metadata model, and error contract.
  - [x] Add explicitly registered, stable/versioned first-party readers reusing existing parsers and
        dataset implementations without duplicate decoding paths.
  - [x] Use small byte-based probes; treat extensions/media types only as confidence hints that
        cannot override contradictory bytes.
  - [x] Expose one stable lazy ScientificDataset summary per document, preserving calibration, units,
        component/channel/no-data, detector, and typed format metadata.
  - [x] Preserve existing `openGsf`, `openMrc`, and `openCbf` exports and behavior; avoid payload
        decoding during probe and summary listing; propagate release and cancellation.
  - [x] Test extension-free detection, misleading extensions, metadata-only summaries, value parity,
        lazy region reads, malformed/truncated error categories, and one registry containing all
        three readers.
  - [x] Run focused format/registry tests, typecheck, lint, and formatting; record each reader's
        exact maximum probe reads and `git diff --stat`.
  - Result: `purejsimage/gsf`, `purejsimage/mrc`, and `purejsimage/cbf` reuse the existing open
    functions and lazy datasets, enrich their scientific descriptors with typed format metadata, and expose
    one stable dataset each. Extensions and media types only raise an already byte-confirmed match
    from 0.99 to 1. Each probe performs exactly one logical read: GSF reads 26 bytes, MRC reads 8
    bytes at offset 208, and CBF reads at most 64 bytes. The 37 focused adapter, registry, and format
    tests pass with typecheck, lint, and formatting.

- [x] Prompt 2.3: adapt FITS, OME-TIFF, and ENVI without losing rank or companions.
  - [x] Re-read instructions/status and inspect accumulated reader/document contracts and the three
        existing format implementations.
  - [x] Expose every supported FITS image HDU with a stable dataset ID and labeled axes that preserve
        source rank, axis metadata, units, and deterministic fallback IDs without payload decoding.
  - [x] Expose every OME image/series with stable IDs while preserving XYZCT labels, channels,
        calibration, pyramids, and TIFF profile behavior without parsing/decoding every plane.
  - [x] Pair ENVI headers/data through `ScientificCompanionResolver` for header-primary and
        data-primary contexts, with explicit missing/ambiguous errors and no portable filesystem
        assumptions.
  - [x] Preserve ENVI wavelength/FWHM/names/interleave/classification/map metadata as typed values
        and keep existing portable and Node conveniences unchanged.
  - [x] Add browser-neutral in-memory companion tests, Node path tests, multi-HDU/multi-series
        enumeration, arbitrary-rank FITS, stable-ID, lazy-summary, cancellation, and probe-limit
        coverage.
  - [x] Run affected format/registry tests, browser check, typecheck, lint, and formatting; record
        unmappable metadata rather than guessing and review `git diff --stat`.
  - Result: FITS exposes stable `hdu-N` datasets and uses a slice primitive to preserve arbitrary
    NAXIS rank without changing the legacy `openImage()` limit; CTYPE/CUNIT and complete linear WCS
    triples become labeled coordinates, while all original cards remain typed metadata. OME-TIFF
    exposes stable `image-N` datasets and carries common declared SubIFD pyramid geometry into `ScientificDataset`.
    ENVI supports header-primary and named data-primary contexts through role-based companion
    resolution and retains spectral, classification, interleave, and tokenized map-info values.
    No coordinate transform is inferred from incomplete FITS WCS cards, and free-form ENVI map-info
    tail fields remain strings when they are not numeric. The 144 affected tests, typecheck, lint,
    formatting, and browser check pass.

- [x] Prompt 2.4: add the explicit scientific library facade, capability enumeration, adapters,
      docs, and final gate.
  - [x] Re-read instructions/status and inspect every accumulated PR 2 change before editing.
  - [x] Implement `createScientificLibrary({ readers })` with explicit registration, normal or
        explicitly selected opening, frozen JSON-safe capabilities, and iterable composition for
        future trusted bundles.
  - [x] Keep any optional first-party bundle explicit and tree-shakeable; include no experimental
        reader silently and perform no network work or hidden registration on import.
  - [x] Add a Node path-to-context helper and a browser `File` companion resolver behind their
        respective platform boundaries.
  - [x] Update scientific exports, package/type/browser checks, API docs, a concise registry guide,
        and this architecture document.
  - [x] Add an external-style package type test registering a reader subset, opening in-memory
        bytes, enumerating summaries, and lazily opening a ScientificDataset without `src/` imports.
  - [x] Run package types, browser check, the full scientific subset, and `npm run check`; record
        unrelated failures separately.
  - [x] Review final `git diff --stat`, public exports, bundle/tree-shaking implications, and prove
        root/browser imports do not register scientific readers.
  - Result: `createScientificLibrary({ readers })` owns one isolated registry and returns frozen
    JSON-safe reader and resource-pattern capabilities. `createScientificPathContext()` remains in
    `purejsimage/scientific/node`; `createScientificFileContext()` and the File resolver remain in
    `purejsimage/scientific/browser`. Consumers import individual reader entries so bundlers can
    eliminate unselected formats under `sideEffects: false`; an explicit `readers/all` entry exists
    only for applications that deliberately choose the complete reader set.
    Root and browser imports neither reach scientific modules nor register readers. The 229-test
    scientific/format subset, packed external declaration consumer, browser check, typecheck, lint,
    and formatting pass. The normal suite has 1,007 passing tests and only the same three unrelated
    12-bit AVIF Sharp-oracle hash failures. A separate hostile-source invocation reached the same
    unrelated failures; `npm run check` itself stops on them before its hostile-source phase.

### PR 3: native numeric tile layer

- [x] Prompt 3.1: implement `NumericTile` and one-time canonical-byte conversion.
  - [x] Re-read repository instructions, record HEAD/status, and inspect raster validation,
        scientific sample loops, buffer ownership patterns, representative tests, and benchmark
        conventions without disturbing user changes.
  - [x] Define native numeric arrays and tiles with coordinates, dimensions, sample type,
        components, layout, element strides, data, and exactly-once release semantics.
  - [x] Preserve exact `uint64` values, promote `float16` to `Float32Array` by default, and support
        preserve-type or checked explicit target conversion without silent precision loss.
  - [x] Convert canonical big-endian `RasterBlock`s once, with safe byte-sized zero-copy views,
        host endianness detected once, one selected monomorphic kernel per block, correct padding and
        subarray offsets, cancellation, and optional caller-owned reusable storage/allocation.
  - [x] Add exhaustive sample-type, endian, layout, padding, offset, hostile block, precision,
        float16, cancellation, allocation, and release tests.
  - [x] Run focused tests, typecheck, lint, and formatting; record `git diff --stat` and exactly which
        conversions are zero-copy.
  - Result: `NumericTile` uses the native typed-array class for every current sample type, with
    canonical `float16` promoted to `Float32Array` and `uint64` retained in `BigUint64Array`.
    Preserved `uint8` and `int8` are zero-copy when no destination/allocator is requested. Wider
    preserved types are zero-copy only on an aligned big-endian host; the normal little-endian path
    performs one canonical-to-native conversion. Explicit target conversion is checked for range
    and precision. Row/plane padding, unaligned subarrays, hostile lengths, cancellation, reusable
    storage, allocator ownership, and exactly-once releases are covered by the focused suite.

- [x] Prompt 3.2: add `NumericTileSource` and the direct-provider escape hatch.
  - [x] Define a labeled-plane-aligned tile request/source contract and exact declared native tile
        semantics without format checks or global registration.
  - [x] Add a permanent lazy, region-bounded `ScientificDataset` conversion adapter and resolver
        that prefers a semantically exact direct source and otherwise falls back cleanly.
  - [x] Propagate abort signals, source sessions, and releases; convert each block at most once per
        consumer pass; expose only stable low-level contracts and cache-lifetime hooks.
  - [x] Prove direct/fallback metadata and value parity, provider decline/fallback, laziness, and
        identical browser/Node behavior with synthetic tests.
  - [x] Run focused tests, typecheck, browser check, lint, and formatting; document how a future WASM
        reader opts in without application changes.
  - Result: `scientificDatasetToNumericTileSource()` is the permanent conversion path and
    `resolveNumericTileSource()` selects a dataset's local direct source only when its declared
    source/native types, component count, layout, and requested target support match. Unsupported
    target requests fall back before invoking the direct provider. No format checks, registry, or
    cache were added. A future WASM reader attaches the same explicit capability to its dataset;
    application code and selection requests do not change.

- [x] Prompt 3.3: move scientific hot paths to native tiles and benchmark the result.
  - [x] Migrate rendering, spectral, volume, classification, and shared sample hot paths to consume
        native tiles while resolving sample/layout/component/strides once per tile.
  - [x] Preserve public outputs, no-data/non-finite behavior, legacy behavior, bounded cancellation,
        and release ownership; retain Float64 only for numerically sensitive accumulation.
  - [x] Add differential statistics, percentile, histogram, rendering, spectral, ratio, slice,
        projection, tile-shape, and padding tests against canonical behavior.
  - [x] Add and run a correctness-gated focused benchmark reporting conversion, post-conversion
        computation, throughput, and honest retained tile storage without claiming unsupported
        speedups.
  - [x] Document the byte/tile boundary and direct-provider option, run the scientific suite,
        relevant benchmark, browser check, package types, and full repository check, and record any
        justified remaining per-sample `DataView` path.
  - Result: labeled rendering and reductions consume `NumericTileSource`; fixed-axis compatibility
    paths convert their selected `RasterBlock` stream once because the old interleaved-component
    selection cannot be represented as one scientific axis index. Hot loops resolve layout/component
    strides once per tile and retain Float64 only for statistics, reductions, derived output, or the
    three-row relief window. Remaining per-sample `DataView` writes serialize derived datasets back
    to the canonical `RasterBlock` API; `src/raster.ts` retains its ordinary-image portable display
    conversion to avoid a dependency from the byte layer up into scientific tiles. The 229-test
    scientific/format suite and 118-test hostile focused suite pass, as do browser, package-type,
    typecheck, lint, and formatting gates. The correctness-gated 1024x256 uint16 benchmark (30
    measured iterations) recorded 11.633 ms conversion, 16.932 ms post-conversion computation,
    28.565 ms total, 275.315 million samples/second, a 524,288-byte peak live tile, and zero
    allocator-accounted bytes after release; no comparative speedup is claimed. The full suite has
    1,033 passing tests and only the same three unrelated 12-bit AVIF Sharp-oracle hash failures, so
    `npm run check` stops before its repository-wide hostile-source phase.

### PR 4: operation descriptors, providers, and trusted extension bundles

The supplied PR 4 runbook pulls the provider contract forward from the original PR 5 boundary and
trusted bundle composition forward from PR 10. This does not pull actual scientific operation
implementations or release hardening forward: PR 5 still owns the permanent strict TypeScript
reference implementations, and PR 10 still owns final compatibility/security wording and release
gates.

- [x] Prompt 4.1: define JSON-safe value types, ports, parameter schemas, operation descriptors, and
      bounded validation.
  - [x] Re-read instructions, record HEAD/status, and inspect pipeline validation, fluent APIs,
        executor planning, codec/accelerator boundaries, scientific APIs, errors, exports, and tests.
  - [x] Define extensible namespaced/versioned value types and ordered operation ports without a
        closed extension-hostile TypeScript union.
  - [x] Define compact number, integer, boolean, string, enum, object, and bounded-array schemas with
        defaults, required/closed objects, finite/range/length limits, and JSON-safe UI metadata.
  - [x] Define plain-data operation descriptors with stable ID/version, category/tags, ports,
        parameters, execution characteristics, reproducibility class, defaults, and deprecation.
  - [x] Return all safely discoverable structured issues under strict nesting/key/array/value limits;
        reject unknown fields, invalid defaults, duplicate ports, non-JSON values, unsafe versions,
        and non-namespaced extension IDs.
  - [x] Add hostile/schema/extension tests, representative resize and histogram JSON, and run focused
        tests, typecheck, lint, and formatting.

- [x] Prompt 4.2: add immutable caller-owned operation and value-type registries.
  - [x] Keep descriptors plain while definitions own semantic normalization, shape inference, and
        lowering hooks; add no executable pixel/tile work to descriptors.
  - [x] Support exact ID/version lookup, multiple versions, deterministic enumeration, duplicate and
        built-in collision rejection, frozen snapshots, and independent registries.
  - [x] Make bundle composition atomic and bounded by caller-supplied operation/version/schema/byte
        limits; expose JSON-safe descriptor-only capabilities.
  - [x] Test duplicates, versions, ordering, atomic failure, normalization, serialization, limits,
        and registry isolation; run focused/type/lint/format gates.

- [x] Prompt 4.3: add the executable provider contract and conservative runtime selector.
  - [x] Separate provider identity/preparation, exact implementation support, cost estimation,
        execution, output ownership, and provenance fingerprint from descriptors and definitions.
  - [x] Implement explicit async preparation and reference-only, conservative automatic,
        allow-list, and exact-pin policies with deterministic ties and clean unavailable/decline
        fallback.
  - [x] Compare setup, transfer, compute, readback, retained-memory, and confidence rather than
        ranking provider kinds; enforce bit-exact conformance, tolerance recording, and pinned
        failure semantics.
  - [x] Test preparation, decline/fallback, pins, costs, ties, cancellation, failure releases, and
        isolated runtimes; run focused, browser, type, lint, and format gates.

- [x] Prompt 4.4: describe and lower existing fluent operations without rewriting execution.
  - [x] Define built-in descriptors/definitions for orientation/metadata, crop, resize, window, LUT,
        rotate, flip/flop, and every currently supported fluent encoder.
  - [x] Reuse existing validated constructors as the single validation truth and lower definitions to
        the current efficient `PipelineOperation` IR outside hot loops.
  - [x] Preserve every fluent method/overload, error contract, immutable chain, crop/scaled-decode
        pushdown, codec registration, and encoder behavior without requiring a registry.
  - [x] Add machine-readable built-in capabilities plus valid/invalid IR parity, output parity, and a
        no-per-pixel-registry guard; run pipeline/executor tests, relevant benchmark/guard, browser,
        type, lint, and format gates.

- [x] Prompt 4.5: add explicit trusted extension bundles, manifests, public entries, and final gate.
  - [x] Define versioned explicit bundles containing readers, value types/definitions, operation
        definitions, providers, and future migration metadata with atomic cross-registry validation.
  - [x] Reject collisions and API-version mismatch; produce deterministic plain-data manifests for
        extensions, readers, value types, operations, and prepared providers.
  - [x] Require every contribution to remain under its extension ID: dotted IDs use the extension
        ID plus `.`, reader IDs use the extension ID plus `/`, and operation migrations may only
        target operations in that same namespace.
  - [x] Add no discovery, dynamic import, scanning, eval, `Function`, or auto-install behavior;
        document trusted in-process execution and future permissioned Worker/iframe RPC honestly.
  - [x] Add portable `purejsimage/operations` and `purejsimage/extensions` entries, package/browser/
        size/docs/architecture guards, and an external strict consumer composing a representative
        reader, custom value type, operation definition, and reference provider.
  - [x] Run package types, browser check, operation/extension suites, and `npm run check`; report
        public exports, trust boundary, bundle impact, diff stat, and proof default imports install
        nothing.
  - Result: focused operation, extension, pipeline, transform, metadata, and package-contract suites
        pass. Strict packed-package compilation and browser graph checks pass; the default root graph
        contains no operation or extension module. Standalone measured entries are 40.0 KiB minified
        (10.7 KiB gzip) for operations and 40.1 KiB (11.0 KiB gzip) for extensions. The full suite
        has 1,047 passing tests; `npm run check` is blocked only by the same three unrelated expanded
        12-bit AVIF Sharp-oracle hash mismatches recorded by PR 3. A root-owned local npm cache also
        requires the documented isolated-cache environment when running the package-type step on
        this workstation.

### Remaining implementation PRs

### PR 5: generic quantitative result types

The supplied PR 5 replaces the earlier placeholder that assigned this number to strict TypeScript
operation implementations. Defining provider-neutral semantic outputs first is the cleaner
dependency order. The permanent reference implementations remain required, but move to a later
operation PR after their input and result contracts exist.

- [x] Prompt 5.1: define bounded, columnar, provider-neutral result models.
  - [x] Inspect current plane measurements, histograms, percentiles/statistics, spectral and
        classification outputs, operation value types, package boundaries, and representative tests.
  - [x] Define scalar, explicit-edge histogram, multi-series profile, columnar table, and small named
        collection payloads with stable namespaced value type IDs and no provider fields.
  - [x] Separate JSON-safe descriptors/summaries from typed in-memory payloads; support practical
        numeric arrays, bit-packed booleans/validity, bounded UTF-8 strings, and categories.
  - [x] Add strict limits and validation for lengths, rows, monotonic edges, finite/NaN policy,
        units, metadata, category/string sizes, collection breadth/depth, and total retained bytes.
  - [x] Add bounded JSON-safe summaries with schema, units, dimensions, finite ranges, capped
        columnar previews, and explicit memory accounting without base64 or typed-array JSON.
  - [x] Add hostile synthetic and million-row tests proving columnar validation does not allocate
        row objects; run focused type/lint/format gates and document memory formulas.

- [x] Prompt 5.2: adapt existing scientific measurements without breaking callers.
  - [x] Keep `measureScientificPlane()` and `ScientificPlaneMeasurement` source-compatible while
        adding a generic result path and a combined legacy-plus-generic result.
  - [x] Reuse one underlying measurement execution for both wrappers; preserve bounded percentile
        sampling, Welford population deviation, no-data/invalid counts, explicit ranges, and units.
  - [x] Represent histogram edges explicitly and reuse count storage without an unnecessary copy;
        retain the NumericTile scan path, cancellation, and release propagation.
  - [x] Add legacy/generic differential coverage for all statistics, percentiles, histograms,
        no-data, explicit ranges, tiled reads, cancellation/releases, and bounded retained memory.
  - [x] Run affected scientific, browser, type, lint, and format gates; record any previously
        ambiguous legacy field semantics.

- [x] Prompt 5.3: register result value types and finish the public analysis boundary.
  - [x] Add explicit built-in result value-type definitions/registry construction and ensure
        capability manifests contain result schemas but never payloads.
  - [x] Export only results, validators, summaries, memory accounting, and scientific adapters from
        `purejsimage/analysis`; keep graphs, ROIs, tile runtime, and persistence formats out.
  - [x] Add a custom namespaced result extension example that cannot replace built-ins, plus docs
        explaining provider neutrality and why large results are not silently JSON encoded.
  - [x] Update exports, external package compilation, browser graph checks, size reporting, docs,
        and the architecture status/table/checklist.
  - [x] Run package types, browser check, result/scientific suites, and `npm run check`; report public
        exports, measured size, example bounded summary, diff stat, and unrelated failures.

  - Result: `purejsimage/analysis` now exposes five provider-neutral result kinds, strict bounded
        validators, aggregate retained-buffer accounting, capped JSON-safe summaries, explicit local
        value-type registration, and one-execution adapters for legacy and scientific plane
        measurements. Statistics and histograms share a NumericTile pass; direct-tile regression
        coverage confirms the dataset-range/statistics/render workflow now performs three reads and
        releases all nine emitted tiles instead of four reads and twelve releases. The packed strict
        consumer, browser graph, lint, formatting, 111-test scientific/result subset, and 85-test
        hostile-source subset pass. The analysis entry measures 52.8 KiB minified (14.4 KiB gzip,
        13.0 KiB Brotli). The full suite has 1,056 passing tests; `npm run check` remains blocked only
        by the same three unrelated expanded 12-bit AVIF Sharp-oracle hash mismatches recorded by
        PRs 3 and 4.

### PR 6: analysis graph, source identity, provenance, and command API

- [x] Prompt 6.1: add the versioned semantic graph contract.
  - [x] Define graph inputs, exact operation references, named edges/outputs, normalized parameters,
        labels outside semantic hashing, structured issues, and bounded `AnalysisLimits`.
  - [x] Validate exact operation versions, named ports, value-type compatibility, parameters,
        cycles, limits, and stable topological order against an explicit registry.
  - [x] Add canonical JSON and browser-compatible domain-separated SHA-256 hashing; document every
        hashed and excluded field.
  - [x] Test ordering, key-order equivalence, cycles, hostile graph bounds, ports, parameters,
        versions, hashes, types, browser graph, lint, and formatting.

- [x] Prompt 6.2: add a non-blocking source identity ladder.
  - [x] Define strong content, versioned remote, weak local-file, and per-instance session identities
        with explicit strength/stability semantics.
  - [x] Propagate identities through source wrappers; expose immutable HTTP validators; recognize
        browser `File` metadata safely; reuse file stat metadata and accept explicit memory identity.
  - [x] Add opt-in bounded, cancellable, progress-reporting SHA-256 source hashing without full-file
        buffering or a runtime dependency.
  - [x] Test propagation, validators/change detection, File/Blob/Memory/FileSource behavior,
        cancellation, bounded reads, source/browser checks, types, lint, and formatting.

- [x] Prompt 6.3: add explicit migrations and non-executing planning/dry-run APIs.
  - [x] Register exact operation and graph-schema migration steps locally; inspect deterministic
        plans and apply them explicitly with revalidation and rehashing.
  - [x] Reject missing, ambiguous, cyclic, and downgrade paths; compose trusted extension migration
        contributions atomically without silent validation/hash migration.
  - [x] Validate bound inputs, resolve definitions, infer metadata-only shapes, prepare only allowed
        providers, and return deterministic JSON-safe plan costs, identities, warnings, and unknowns.
  - [x] Keep `validateGraph`, `planGraph`, and `dryRun` separate; test provider policies,
        determinism, unresolved estimates, no pixel reads, migration chains, and rehashing.

- [x] Prompt 6.4: add generic orchestration, provenance, immutable commands, and the facade.
  - [x] Execute planned DAGs with bounded concurrency, deterministic dependencies, cancellation,
        contextual failures, no hidden retry, and last-consumer intermediate release.
  - [x] Record graph/input/operation/parameter/provider/library/reproducibility provenance while
        keeping timing and warnings outside semantic graph hashing.
  - [x] Add immutable revisioned workspaces and JSON-safe versioned commands with stale-revision
        checks; command validation/application remains pure and never executes providers.
  - [x] Expose capabilities, operation description, commands, validation, planning, dry-run,
        execution, and cancellation through one runtime-neutral controller; document trusted
        in-process authority and no AI-only privilege.
  - [x] Update analysis/extension/package/browser/docs contracts and run focused suites plus
        `npm run package:types`, `npm run browser:check`, and `npm run check`.

  - Result: `purejsimage/analysis` now exposes bounded canonical graph validation and hashing,
        source identity and opt-in streaming SHA-256, explicit migration plans, metadata-only
        planning/dry runs, generic cancellable DAG execution with provenance, immutable revisioned
        commands, and one controller facade. The unreleased scientific `identityHint` duplicate was
        removed in favor of the source-owned protocol. A lightweight internal identity contract
        keeps ordinary root behavior under its unchanged 60 KiB budget (59.9 KiB measured), while
        normalization, hashing, and the 105.4 KiB analysis graph runtime remain in the explicit
        analysis entry. Strict package types, browser checks, formatting, lint, 90 focused tests,
        and 923 hostile-source tests excluding AVIF pass. The full suite has 1,082 passing tests;
        `npm run check` remains blocked only by the same three unrelated expanded 12-bit AVIF
        Sharp-oracle hash mismatches recorded by PRs 3 through 5.

### PR 7: ROI geometry and sampling

- [x] Prompt 7.1: define versioned ROI geometry and calibrated coordinate conversion.
  - [x] Define JSON-safe point, line segment, polyline, rectangle, ellipse, polygon, and `RoiSet`
        contracts with stable IDs, axis IDs, fixed non-plane indices, coordinate space, and optional
        non-semantic style/label metadata.
  - [x] Normalize and validate geometry against labeled scientific axes with explicit limits for
        ROI count, points, magnitude, nesting, metadata bytes, duplicate IDs, and fixed indices.
  - [x] Implement pixel-center/boundary semantics, exact linear calibration, monotonic ascending or
        descending lookup inversion, unit checks, bounding boxes, plane clipping, and canonical ROI
        JSON.
  - [x] Test every geometry, 4D fixed indices, calibration and unit errors, hostile limits,
        canonical serialization, and pixel-center semantics.

- [x] Prompt 7.2: add tile-local masks and deterministic line sampling plans.
  - [x] Generate bounded tile-local rectangle, ellipse, and even-odd polygon masks with explicit
        origin, dimensions, stride, ownership, clipping, and partition-invariant pixel-center rules.
  - [x] Reject holes and area-mask requests for point/line/polyline geometry; precompute polygon
        scanline state per tile with no per-pixel object allocation.
  - [x] Generate bounded nearest and bilinear line/polyline plans with pixel- or calibrated
        physical-distance spacing, coordinates and units separate from future sampled values, and
        no dataset reads.
  - [x] Test edges on centers, concavity, ellipse boundaries, clipping/off-image cases, tile-size
        invariance, ascending/descending physical axes, interpolation weights, limits, and aborts.

- [x] Prompt 7.3: integrate ROI value types and immutable workspace commands.
  - [x] Register stable built-in ROI and ROI-set value-type descriptors through explicit local
        registry construction and protect core semantics from extension replacement.
  - [x] Extend immutable workspaces and the controller with versioned add/update/remove/replace ROI
        commands, expected-revision checks, structured paths, and JSON-only capability schemas.
  - [x] Test command-only creation/editing, mock operation binding, graph/workspace canonicalization,
        stale and invalid edits, registry isolation, and the absence of implicit execution.
  - [x] Update analysis exports, strict package types, browser checks, documentation, examples, and
        this checklist; explicitly defer brushes, 3D geometry, boolean algebra, collaboration, and
        visual styling systems.

  - Result: `purejsimage/analysis` now exports immutable ROI/ROI-set contracts, calibrated
        coordinate conversion, canonical storage and quantitative JSON, tile-local area masks, and
        deterministic line sampling plans. ROI state is edited through the same revisioned command
        API as graphs; planning validates bound ROI values through explicitly constructed local
        value-type registries, while execution remains a separate call. The 69-test focused
        analysis/operation suite, strict package types, browser checks (1,782,761-byte bundle),
        documentation build, formatting, and lint pass. The root entry remains 59.9 KiB minified;
        the explicit analysis entry is 132.1 KiB. The hostile-source suite excluding AVIF has 949
        passing tests. The full suite has 1,108 passing tests; `npm run check` remains blocked only
        by the same three unrelated expanded 12-bit AVIF Sharp-oracle hash mismatches recorded by
        earlier PRs.

### PR 8: lazy tile runtime, scheduler, and cache

The detailed PR 8 runbook keeps scheduler mechanics behind the public `TileRuntime` and `TileSource`
boundary. Applications need explicit request policy, invalidation, metrics, and ownership—not queue
node manipulation—so lower-level scheduling remains private unless implementation experience proves
an external contract necessary.

- [x] Prompt 8.1: add tile addressing, bounded cache ownership, and shared-request scheduling.
  - [x] Define canonical bounded tile addresses/requests with source identity, axis/fixed-index
        selection, level, region, priority, namespace, and optional target native semantics.
  - [x] Implement a local byte- and entry-bounded true LRU with exact typed-array plus auxiliary
        accounting, source/derived namespaces, explicit invalidation, and exactly-once release.
  - [x] Implement bounded deterministic priority scheduling with FIFO ties, starvation prevention,
        cancellation before/during execution, shared in-flight computation, and per-consumer
        ownership without double release.
  - [x] Stress LRU order/accounting/replacement, isolated runtimes, duplicate requests, partial/all
        cancellation, priorities, starvation, failures, and release behavior.

- [x] Prompt 8.2: add immutable derived tile sources, semantic keys, halos, and generations.
  - [x] Key derived tiles by source runtime identity, node semantic hash, normalized parameters,
        plane/level/region, execution fingerprint, and provider identity where numerics can differ;
        exclude labels and timestamps.
  - [x] Add a lazy `DerivedTileSource` over selected operation implementations that requests only
        bounded source regions, keeps source/derived caches distinct, propagates aborts, and releases
        every input/intermediate/output correctly.
  - [x] Declare parameter-dependent directional halos and boundary mode, clip expanded reads, retain
        only requested output pixels, and prove output is invariant across tile partitions.
  - [x] Add explicit namespace/generation/predicate invalidation for future mutable data without a
        resident dirty buffer, global observer, or hidden event bus.
  - [x] Test provider fingerprints, semantic keys, allowed fallback versus pin behavior, halo
        clipping/seams, cancellation, releases, and generation invalidation.

- [x] Prompt 8.3: add honest runtime metrics, hostile coverage, public APIs, and benchmark evidence.
  - [x] Expose resettable/optional JSON-safe per-runtime metrics for cache, source/derived bytes,
        queue/task states, in-flight requests, requested/produced bytes, provider-reported timing,
        and time to first completed tile, labeling estimates versus measured values.
  - [x] Reject hostile coordinate/dimension/key/queue inputs and test cancellation races, throwing
        providers/releases, source identity changes, and invalidation of queued work.
  - [x] Add a correctness-gated benchmark for uncached first, cached repeat, neighboring, and
        halo-derived tiles; report timings without claiming process peak memory.
  - [x] Export only the stable runtime/source/request/metrics/invalidation contracts from
        `purejsimage/analysis`; update packed types, browser checks, docs, examples, and this log.
  - [x] Run benchmark, focused graph/provider/tile tests, package/browser gates, and `npm run check`;
        record default byte/concurrency limits and prove import creates no cache or worker.

  - Result: `purejsimage/analysis` now exports canonical bounded tile requests, an explicit local
        `TileRuntime`, `TileSource`, a `NumericTileSource` adapter, and immutable halo-aware
        `DerivedTileSource`s over already planned providers. The 32 MiB/1,024-entry cache and
        four-task/4,096-queue scheduler create no global state or import-time work; dependency permit
        suspension prevents nested-source deadlock even at concurrency one. Eighteen focused tile
        tests cover true LRU ownership, a 1,500-task queue, cancellation races, hostile keys and
        accounting, semantic/provider/generation keys, fallback/pin behavior, clipped halo
        partition invariance, provider failures, and invalidation. The focused
        analysis/operation/source-identity suite, strict packed types, browser checks (1,782,761-byte
        bundle), docs, formatting, and lint pass. The correctness-gated 1,024 x 1,024 float32 fixture
        measured 2.023 ms uncached, 0.152 ms cached, 0.333 ms neighboring, and 8.428 ms halo-derived
        on this run; these are local wall-clock measurements, not process peak memory. The hostile
        suite excluding AVIF has 967 passing tests. The full suite has 1,126 passing tests;
        `npm run check` remains blocked only by the same three unrelated expanded 12-bit AVIF
        Sharp-oracle hash mismatches recorded by earlier PRs.

### PR 9: initial built-in analysis operations

The detailed PR 9 runbook replaces the earlier persistence/audit placeholder. Scientific built-ins
belong in the analysis entry because their implementations depend on `ScientificDataset`,
`NumericTile`, ROI, result, graph, and tile-runtime contracts. The lower `operations` entry continues
to own only generic descriptors, definitions, providers, and registries.

- [x] Prompt 9.1: crop, resample, arbitrary-axis slice, and projection.
  - [x] Add stable versioned descriptors, schemas, metadata-only descriptor inference, and strict
        reference implementations through explicit registries and providers.
  - [x] Preserve arbitrary labeled axes, components, sample/no-data semantics, units, calibration,
        non-selected axes, cropped linear origins, and lookup-coordinate subsets.
  - [x] Push crop/slice regions into lazy source reads; keep arbitrary-axis and projection work
        bounded without materializing an N-dimensional dataset.
  - [x] Define nearest/bilinear and min/max/mean output sample-type rules explicitly; use safe
        accumulators and deterministic no-data/non-finite behavior.
  - [x] Prove arbitrary axes, pushdown, calibration, tile partition invariance, integer precision,
        cancellation/release, graph execution, and inference without pixel reads.

- [x] Prompt 9.2: ROI-aware statistics, histogram, and calibrated line profile.
  - [x] Add stable descriptors, schemas, value-type ports, inference, and reference provider
        implementations returning provider-neutral result values.
  - [x] Stream deterministic tile-local ROI reductions with Welford statistics, explicit empty and
        invalid/no-data behavior, bounded percentiles, and no full-plane mask.
  - [x] Produce explicit-edge bounded histograms with underflow/overflow and explicit or validated
        automatic range; make any required second pass visible and cache-aware.
  - [x] Use bounded ROI line/polyline plans for nearest/bilinear component profiles in pixel or
        calibrated physical distance.
  - [x] Prove brute-force parity, concave and partitioned ROIs, fixed indices, physical coordinates,
        cancellation/release, summaries, provenance, and future-provider conformance.

- [x] Prompt 9.3: threshold and Gaussian blur as the halo proof.
  - [x] Add bit-exact uint8 threshold semantics with explicit comparison and no-data/non-finite
        policies, and a tolerance-declared Float32 Gaussian blur.
  - [x] Precompute `ceil(3 * sigma)` separable kernels and mappings; support clamp, mirror, and
        validated constant boundaries without per-pixel allocation or full-frame intermediates.
  - [x] Integrate halo and scratch-memory estimates with tile execution and retain only requested
        output pixels.
  - [x] Prove threshold exactness, blur tile invariance/seams, boundaries, impulse/constant images,
        sigma limits, cancellation/releases, graph execution, and provider decline/fallback.
  - [x] Add and run a correctness-gated representative multi-tile blur benchmark, recording honest
        timing, tile/cache dimensions, retained bytes, and the declared comparison tolerance.

- [x] Prompt 9.4: capabilities, commands, extension example, documentation, and final gate.
  - [x] Expose an explicit built-in operation/value-type bundle and reference provider with no
        package-global registration or import-time work.
  - [x] Exercise public capabilities, schema normalization, immutable commands, validation, dry-run,
        explicit execution/cancellation, bounded summaries, reference-provider pinning, and
        provenance without private operation calls or DOM state.
  - [x] Add a trusted custom pointwise extension example using the same descriptor/provider
        contract, with no acceleration claim or hidden registration.
  - [x] Update package types, browser/size guards, API/architecture docs, generated references if
        appropriate, ordinary image examples, and the deferred list including FFT and
        materials-specific algorithms.
  - [x] Run package/browser gates, all affected operation/graph/ROI/tile and ordinary-pipeline tests,
        relevant benchmarks, and `npm run check`; record diff stat, public versions, command/dry-run/
        provenance evidence, bundle impact, sample-type rules, reduction order, percentile policy,
        blur tolerance, and unrelated failures.

  - Result: `purejsimage/analysis` now exposes nine version-1 scientific operations through one
        explicit built-in registry/value-type/provider bundle: crop, resample, arbitrary-axis slice,
        projection, threshold, Gaussian blur, ROI statistics, histogram, and calibrated line
        profile. Descriptor inference is metadata-only; execution stays lazy over NumericTiles and
        bounded runtime reads. ROI reductions are global-row-major, statistics use Welford
        accumulation, large percentile requests use a bounded deterministic row-major reservoir,
        and automatic histograms declare their cache-aware second pass. Gaussian blur uses
        `ceil(3 * sigma)`, bounded separable Float64 scratch, Float32 output, and absolute/relative
        tolerances of `1e-5`/`1e-6`. The correctness-gated 1,024 x 1,024 sigma-3 benchmark measured
        292.581 ms per run locally, zero constant-field error, a 1,494,048-byte planner estimate,
        and 9,296,672 retained cache bytes; these are tile/cache and wall-clock measurements, not
        process peak memory. Strict packed types, browser checks, docs, format, lint, 102 focused
        analysis/operation/extension tests, and 25 ordinary pipeline/browser-runtime tests pass.
        The root entry remains 59.9 KiB minified; the explicit analysis entry is 229.1 KiB (61.9 KiB
        gzip, 52.1 KiB Brotli). The full and hostile-source runs each have 1,144 passing tests and
        remain blocked only by the same three unrelated expanded 12-bit AVIF Sharp-oracle hash
        mismatches documented by earlier PRs. The first unscoped `npm run check` attempt also
        encountered the machine's root-owned npm cache; the isolated-cache rerun passed that step
        and reached only those known AVIF failures.

### PR 10: external materials spike, package hardening, and release candidate

- [x] Prompt 10.1: make an installed npm tarball the only supported external-integration boundary.
  - [x] Extend the automated package consumer to run `npm pack --ignore-scripts`, install that exact
        tarball in a clean temporary project, and clean up on success or failure without invoking
        recursive `prepack` checks.
  - [x] Compile strict TypeScript against the documented root, browser, scientific,
        scientific/node, operations, analysis, extensions, pathology, and HTTP-range subpaths.
  - [x] Bundle a browser entry and Worker entry from installed package exports and reject every Node
        built-in in either portable graph.
  - [x] Execute an in-memory scientific-reader, dataset, graph, ROI, tile, operation, result, and
        provenance workflow entirely from the installed tarball.
  - [x] Add negative checks proving private/unexported imports fail and Node-only scientific helpers
        cannot enter the browser bundle.
  - [x] Integrate the fixture into `npm run check`; run the fixture, package types, browser check,
        and full check; record package contents and any unrelated failures.

  - Result: `package:types` is now the single packed-consumer gate. It packs with lifecycle scripts
    disabled into an isolated temporary npm cache, verifies the 376-file manifest contains every
    documented application entry and no `src/` files, installs the exact tarball with no package
    lock, and removes the consumer on every exit. Strict declarations and a live installed-package
    GSF to NumericTile to ROI-statistics workflow pass, including reference-provider and source
    identity provenance. Browser and Worker bundles are 361,576 and 277,727 bytes locally and
    contain no Node built-ins. Negative bundles reject `purejsimage/src/...` and the Node path helper
    under a browser target. Standalone package, browser, type, lint, and format gates pass. The full
    check reaches 1,150 passing tests and stops on the same three unrelated expanded 12-bit AVIF
    Sharp-oracle hash mismatches recorded before PR 10, so its hostile-source phase is not reached.

- [x] Prompt 10.2: add correctness-gated application-level benchmarks.
  - [x] Measure document detection, summary enumeration, first numeric tile, first display tile,
        HTTP-range requests/bytes, source and derived cache behavior, ROI statistics, line profile,
        threshold, Gaussian blur, and validation/planning/provider preparation.
  - [x] Cover a large scalar plane, arbitrary-axis 4D-STEM data, a range-backed TIFF/WSI workflow,
        and representative MRC, CBF, and GSF documents without silently downloading whole sources.
  - [x] Separate cold and warm/setup and compute measurements; record environment, provider,
        correctness, bytes, cache metrics, wall time, and bounded working-set evidence without
        labeling retained-cache counters as process peak memory.
  - [x] Emit reproducible JSON and Markdown, use deterministic inputs and only generous catastrophic
        regression gates, document invocation and interpretation, and run the narrow benchmark gate.

  - Result: `bench:application-platform` now correctness-gates a deterministic 1,024 x 1,024 scalar
    analysis fixture, scanX/scanY/kx/ky 4D-STEM selection, generated GSF/MRC/CBF documents, and the
    committed 1,938,955-byte Aperio fixture through `HttpRangeSource`. The recorded local WSI run
    fetched 300,556 bytes in six range requests, not the whole source. The cache probe retains
    65,536 bytes in each source and derived class and observes one cold miss plus one warm hit per
    class. The local reference provider measured ROI statistics at 276.918 ms cold/41.343 ms warm,
    line profile at 27.934/11.643 ms, threshold tile at 19.747/1.038 ms, and a 256-square sigma-3
    blur tile at 31.311/15.602 ms; these are environment-labeled wall-clock samples, not release
    budgets. Exact constant-field blur, bounded result kinds, nondegenerate threshold output,
    document/tile checksums, provider provenance, and no-whole-download assertions gate every
    report. JSON and Markdown artifacts, invocation guidance, three-decimal application timings,
    provider/setup/planning fields, and explicit cache-not-peak-memory wording are checked in. The
    narrow benchmark and typecheck pass.

- [x] Prompt 10.3: create the separate installed-tarball materials application spike.
  - [x] Create a separate repository outside this workspace, record its initial cwd/status and tool
        versions, and install only the exact packed PureJsImage tarball with no workspace link,
        source import, GitHub dependency, or alias.
  - [x] Use strict vanilla TypeScript and Vite unless the public contracts demonstrate a concrete
        reason for another stack; keep Canvas/UI work on the main thread and readers, controller,
        graph, tile runtime, operations, and results in a Worker.
  - [x] Define a versioned JSON-safe Worker protocol with transferable buffers, task IDs,
        cancellation, structured errors, capability snapshots, and immutable command traffic.
  - [x] Add file selection, remote HTTP-range input, capability/dataset/canvas placeholders, an
        event log, and a deterministic synthetic Worker workflow test.

  - Result: `/Users/ard/projects/PureJsImage-materials-spike` is an independent Git repository
    created from a strict vanilla TypeScript/Vite 8.2.1 template under Node 24.16.0/npm 11.13.0.
    Its lockfile resolves `purejsimage` only from the copied
    `.packages/purejsimage-0.9.0.tgz`; there is no workspace, GitHub, alias, source, or private dist
    import. The main thread owns controls, event log, and Canvas. A module Worker owns six explicitly
    registered readers, documents/datasets, source identities, the analysis controller/workspace,
    operation bundle, tile runtime, results, and provenance. Protocol v1 uses discriminated JSON
    envelopes, task IDs, cancellation, structured errors, capability snapshots, immutable
    `AnalysisCommand` payloads, and transferred RGBA buffers. Local companion sets, remote
    `HttpRangeSource`, synthetic GSF, capabilities, datasets, rendering, and synthetic analysis are
    wired through public exports. The deterministic controller test and production build pass; the
    Worker bundle is 538.92 kB and main-thread JavaScript is 5.83 kB before gzip. No commit was made.

- [x] Prompt 10.4: implement the materials viewer workflow through public APIs only.
  - [x] Open local companion resources and remote range sources through the explicit reader
        registry; enumerate datasets, labeled axes, calibration, components, and resolution levels.
  - [x] Support arbitrary display-axis pairs and fixed indices, pan/zoom, visible-before-near tile
        priorities, cancellation of stale work, explicit display mapping, incremental painting, and
        visible cache/network/runtime metrics.
  - [x] Do not add a second tile cache or private-package workaround; test axis switching, stale
        cancellation, local/HTTP equivalence, and no whole-source remote download.
  - [x] Record missing generic APIs as gaps rather than importing package internals.

  - Result: the spike viewer opens browser `File` companion sets and remote `HttpRangeSource`
    documents through explicitly registered readers, enumerates document datasets and full scientific
    descriptor metadata, and exposes arbitrary axis pairs, every fixed index, level selection,
    pan/zoom, explicit range/scale/palette mapping, and incremental Canvas painting. One Worker-owned
    `TileRuntime` handles bounded retention, deduplication, four-way concurrency, visible versus
    near-visible priority, and abort propagation; view changes cancel outstanding task IDs and the
    main thread ignores stale view IDs. Network request/byte/cache statistics and tile runtime
    source/derived metrics remain visible. A trusted spike-only synthetic 4D-STEM reader exercises
    scanX/scanY/kx/ky switching through the same public registry and tile contracts without entering
    the package. Two controller tests and two real Chromium E2E tests pass, covering arbitrary-axis
    switching, stale cancellation, byte-identical local/HTTP rendering, and a range byte count below
    the 4,194,356-byte GSF source size. `API-GAPS.md` records the default-dataset, display-recommendation,
    built-in cache-class, and viewport-policy gaps; no private import or second cache was added.

- [x] Prompt 10.5: implement analysis, commands, persistence, and provenance in the spike.
  - [x] Create and edit ROI geometry through immutable workspace commands; expose statistics,
        histograms, line profiles, threshold, and blur graph construction.
  - [x] Show DAG/provider planning; support validate, dry-run, explicit execute, and cancellation;
        render bounded summaries/charts with provider and reproducibility provenance.
  - [x] Save versioned `analysis.json` containing workspace/graph/ROIs/source identity/operation
        versions/display state but neither source bytes nor live result payloads; reload, rebind,
        verify identity, migrate explicitly, and replay.
  - [x] Add a developer surface for capability inspection and pasted `AnalysisCommand` JSON using
        the same validation/preview/application path as the UI, with no `eval` or AI-only backdoor.
  - [x] Add end-to-end coverage for commands, cancellation, save/reload/rebind, provenance warnings,
        and replay.

  - Result: the spike creates rectangle, ellipse, polygon, and line ROIs and builds five public DAG
    workflows: statistics, histogram, calibrated line profile, threshold into statistics, and
    Gaussian blur into statistics. Each run records the graph, validation/dry-run plan, bounded
    result summary, provider/implementation choice, reproducibility contract, and execution
    provenance; execution is explicit and task-ID cancellation yields before planning so queued
    aborts are observable. The workspace is refreshed from the executed graph and ROI set. The same
    controller `validateCommand`/`applyCommand` path drives pasted developer JSON and UI state, with
    immutable revision checking and no eval. `analysis.json` schema v1 stores the workspace,
    graph/ROIs, source identity, operation versions, and display state, but no source bytes or result
    payloads. Reload rejects unsupported versions, validates the graph and ROI set, rebinds the
    current source, and reports identity mismatch/absence without silent migration. Two controller
    tests cover all five operations, command preview/application, save/reload, provenance, and local/
    remote behavior; three real Chromium E2E tests cover viewer cancellation, stale commands,
    reference-provider pinning, analysis cancellation, provenance, result parity after replay,
    source-identity mismatch, and download/reload/rebind. Unit, strict build, and E2E gates pass.

- [ ] Prompt 10.6: audit both repositories and prepare release-candidate evidence without release
      side effects.
  - [x] Classify every spike workaround or API gap; close only generic PureJsImage gaps and remove
        spike workarounds once a public API exists.
  - [x] Re-run the tarball consumer, browser/package/full gates, benchmarks, and spike tests; update
        public docs, XYZCT migration guidance, examples, ROADMAP deferrals, and the architecture log.
  - [x] Follow the repository release process to prepare 0.10 prerelease notes and audit evidence,
        but do not change a version, tag, push, publish, or create a GitHub release without separate
        authorization.
  - [x] End with both repositories' status/diff summaries, remaining API gaps, benchmark evidence,
        release gates, deferred scope, and a candid release-readiness assessment.

  - Release-candidate audit result: the external spike found no generic missing API that justified
    new production runtime code. The unsafe pasted-command assertion was removed in the app so both
    preview and apply pass `unknown` through the public validator; the app also renders a bounded
    chart from `AnalysisResultSummary.preview`. `API-GAPS.md` classifies the remaining issues as
    deliberate app policy, documentation, non-blocking cache-class semantics, or deferred work.
    The refreshed exact tarball and lockfile pass two unit tests, a strict production build, and
    three real Chromium E2E workflows in the separate repository.

    PureJsImage passes a clean install, the packed external fixture on Node 24 and minimum-supported
    Node 22, browser/type/lint/format gates, 45 focused application and ordinary-pipeline tests, 12
    real Chromium ordinary-demo/scientific tests, the correctness-gated application benchmark, and
    release fuzz with seed `1592598566` and 512
    mutations per registered codec with no crash artifacts. The 376-file tarball is 778,585 bytes
    (`sha512-1oqv...tkJuw==`); installed imports create no Worker, fetch, interval, or package global.
    `npm run check` is still red: 1,150 tests pass and the same three unrelated expanded 12-bit AVIF
    Sharp-oracle hashes fail, so the hostile-source phase does not run. This prompt therefore stays
    unchecked and the prerelease candidate is **not release-ready** until that existing AVIF gate is
    reconciled and the complete check passes. No version, tag, push, publication, or GitHub release
    was created; the reviewed PR 10 code can be committed independently of release state.

### Post-PR 10 review follow-up

- [x] Make nested `TileRuntime.request()` calls dependency-safe by default. An active scheduled tile
      now yields its permit while awaiting an uncached or in-flight upstream tile and reacquires a
      permit before resuming computation; the explicit `requestDependency()` name remains as a
      compatibility alias that is also safe outside scheduled work.
- [x] Make default built-in analysis cache identities unique within a shared runtime. Every
      `AnalysisDatasetOperationContext` without an explicit session ID now receives a bounded
      runtime-scoped identity rather than the shared `reference-analysis` literal. Explicit session
      IDs remain available when the caller intentionally owns stable identity semantics.
- [ ] Converge built-in dataset operations and generic `DerivedTileSource` on one accelerated tile
      path before freezing the analysis API. Define a narrow tile-kernel contract separately from
      graph-level dataset-to-dataset implementations, then route threshold and Gaussian blur through
      it first to prove pointwise and halo semantics. This is a distinct architecture slice rather
      than part of the scheduler correctness fix.
- [x] Bound total runtime-managed memory separately from cache residency. Tile runtimes now enforce
      `maxTileBytes`, `maxInFlightBytes`, `maxLeasedBytes`, `maxOperationWorkingBytes`, and
      `maxTotalManagedBytes`, expose current/high-water memory metrics, and reserve declared derived
      provider scratch. Cache bytes remain a subset rather than a proxy for the total budget.
- [x] Make semantic graph hashes independent of ID-addressed collection insertion order. Canonical
      hash domain v2 sorts graph inputs by name, nodes by ID, node input groups by port, and outputs
      by name while preserving order among variadic values on the same port and preserving all
      parameter arrays.
- [ ] Add explicit resolution-level selection and physical coordinate transforms to built-in
      operation schemas. The existing descriptor lengths validate level bounds but do not fully
      define physical calibration for every pyramid; this remains required before claiming general
      pyramidal analysis rather than being guessed in this review fix.
- [x] Distinguish lazy graph invocation from pixel materialization in execution provenance. Dataset
      outputs are marked `materialization: lazy`, completed reductions are marked `complete`, and the
      timing scope states that later tile work belongs to the tile runtime. Per-tile materialization
      provenance will converge with the common derived-tile path above.
- [x] Add optional idempotent async provider disposal. `OperationRuntime`, prepared extension hosts,
      and prepared analysis plans expose disposal; partial preparation failures clean up providers in
      reverse order. GPU-resident multi-operation storage remains future work and is not claimed by
      the CPU `NumericTile` contract.
- [x] Group line-profile sample contributions by normal source tile. Nearest and bilinear plans now
      request each intersected tile once, including cross-tile bilinear neighborhoods, rather than
      creating one tiny source key per sample.
- [x] Publish JSON-safe command descriptors from controller capabilities. Each available command now
      describes its title, purpose, closed shape, mutation status, and mandatory revision
      requirement; `commandKinds` is derived from that descriptor list.
- [x] Replace the exposed mutable execution-output `Map` with a frozen lookup/iteration view and
      reject detectable output/output and input/output resource aliases. Providers must supply a
      shared `ownershipIdentity` for opaque aliases the runtime cannot inspect.
- [x] State the quantitative `uint64` boundary explicitly. Native tiles remain exact, while current
      number-backed analysis rejects samples above `Number.MAX_SAFE_INTEGER`; bigint/decimal result,
      parameter, and no-data contracts remain future work.
- [x] Make namespaced operation and extension ID validation linear-time. A single segmented-ID
      validator now preserves well-formed dotted and hyphenated IDs without overlapping separator
      consumption. The alpha grammar uses dot-separated segments that begin with lowercase ASCII;
      later segment characters may be lowercase ASCII, digits, or hyphens. A hard length bound and
      focused adversarial tests prevent regular-expression backtracking and unbounded scanning.

### Contract-level review blockers

- [x] Publish one scientific dataset model. `ScientificDataset` is now the only dataset contract in
      `purejsimage/scientific`; fixed-axis parser objects and adapters are internal migration code,
      first-party formats open through explicit readers/documents, and the website/package fixtures
      use labeled-axis requests. The ordinary image pipeline is unchanged.
- [x] Give every first-party reader-opened dataset a structured identity containing the exact
      reader ID/version, stable dataset ID, and every source identity. ENVI includes header and data;
      FITS and OME-TIFF include stable HDU/image IDs. Planning recognizes attached identities while
      synthetic datasets still require an explicit identity.
- [x] Implement the normative `AnalysisProjectV1` envelope with discriminated source/ROI/ROI-set/
      inline bindings and exported validation, normalization, and hash helpers. Validation resolves
      logical source and ROI references, checks registered value types and semantic identities,
      rejects stale graph/binding/invocation hashes, enforces document/presentation limits, and does
      not open sources or prepare providers.

- [x] Separate reusable recipe identity from complete invocation identity with binding and
      invocation hashes, canonical ROI/scalar semantics, explicit opaque identities, and no
      execute-time identity replacement.
- [x] Lease prepared plans through execution-result release, including lazy output reads, and make
      plan, operation-runtime, and tile-runtime disposal closing, observable, waiting, and
      idempotent.
- [x] Split JSON-only provider planning requests from value-bearing execution requests and keep one
      exact selected provider for every tile produced by a node.
- [x] Make resample and Gaussian blur honest selected-plane transforms whose output descriptors are
      two-dimensional and whose source reads use explicit fixed indices.
- [x] Require tile sources to estimate output, peak working, and retained auxiliary bytes before
      allocation; validate returned descriptor semantics and estimates; account decoded input bytes;
      and transfer a single exact source tile without a merge copy.
- [x] Replace the CodeQL-flagged namespaced-ID regular expression with one bounded linear parser and
      reuse it for operation and extension identifiers.

### Additional application review blockers

- [x] Charge the complete backing allocation retained by every `NumericTile`, not only its visible
      typed-array view. Hard tile memory maxima are separate from timing confidence; undeclared
      pooled/padded direct tiles compact before caching, while declared allocations can transfer
      zero-copy and remain fully charged.
- [x] Permanently close every tile-runtime acquisition and mutation path during disposal, return one
      stable disposal promise, and include explicit operation-working reservations in idle cleanup.
- [x] Run derived provider outputs through the shared ownership validator before tile-specific shape
      validation so claimed input/pool aliases cannot enter the cache.
- [x] Expose the extension host's frozen provider list and prove an installed custom operation can be
      planned and executed through `AnalysisController` with provider provenance and cleanup.
- [x] Require every controller/planner graph input value type to be registered, including unused and
      directly published inputs, while retaining registry-independent structural graph validation.
- [x] Require `expectedRevision` on every standalone mutation and add atomic `applyCommands()` that
      either applies a complete batch with one revision increment or returns the original snapshot.
- [x] Require exact probe read lengths and bound companion resolver calls in the shared scientific
      detection ledger.

  - Additional-review validation: 98 focused tile/runtime/extension/controller/project/reader tests
    pass. The standard and hostile-source suites each pass all 95 non-AVIF files and 1,175 tests;
    package consumer types, browser dependency checks, documentation build, lint, formatting, and
    the correctness-gated tile-runtime benchmark pass. The complete standard suite reaches 1,197 of
    1,200 tests and is blocked only by the same three environment-specific expanded 12-bit AVIF
    Sharp-oracle hashes.

  - Contract-blocker validation: 142 focused scientific/application tests pass. Package consumer
    types, browser dependency checks, documentation build, lint, formatting, and three
    correctness-gated scientific/application benchmarks pass. Standard and hostile-source suites
    each pass all 95 files and 1,167 tests when the AVIF oracle file is excluded. The complete
    `npm run check` remains blocked only by the same three environment-specific expanded 12-bit AVIF
    Sharp-oracle hash mismatches (1,189 of 1,192 tests pass); no scientific/application test fails.

  - Small-feedback validation: 64 focused operation/controller/result/tile/extension tests pass;
    dense nearest sampling uses three normal tiles for 17 samples and the cross-boundary bilinear
    fixture uses two. Package types, browser graph, docs build, lint, formatting, and the
    correctness-gated application benchmark pass. The full suite reaches 93 passing files and 1,174
    passing tests before the same three environment-specific expanded 12-bit AVIF oracle hashes;
    the hostile-source phase therefore does not run.

  - Review validation: 92 test files and 1,170 tests passed in the complete standard suite. The gate
    remains blocked by two environment-specific expanded 12-bit AVIF Sharp-oracle hashes, one AVIF
    timeout under full-suite load, and one WebP timeout that passes when rerun alone. The hostile-source
    suite reached 91 passing files and 1,169 passing tests before the same AVIF failures and load-only
    timeouts. The 92 scientific/application-platform focused tests, package types, browser graph,
    lint, formatting, and correctness-gated application benchmark pass.

  - Review result: focused regression coverage now exercises one derived tile at concurrency one,
    four concurrent visible tiles at concurrency four, a crop-to-Gaussian chain, cancellation while
    blocked upstream, shared in-flight upstream work with one consumer cancelling, and two default
    bundles sharing one runtime without cache cross-contamination.

  - CodeQL validation: the two unresolved PR 20 regular-expression findings share one linear-time
    validator. The 22 focused operation/extension tests, correctness-gated tile-runtime benchmark,
    package types, browser graph, lint, and formatting pass. Both standard and hostile-source suites
    reach 93 passing files and 1,176 passing tests before the same three environment-specific
    expanded 12-bit AVIF Sharp-oracle hash mismatches.

### Website, bundle, and extension-ecosystem review follow-up

- [x] Record exact minified baselines for `scientific`, `operations`, `analysis`, and `extensions`
      and enforce hard ceilings with approximately 30% growth headroom in the normal size gate.
- [x] Make the extension descriptor ID its owned namespace: readers use `<extension-id>/...`, all
      dotted contributions use `<extension-id>....`, and operation migrations stay within it.
- [x] Add `/scientific/platform/` without changing the codec-first homepage or the existing local
      Scientific Raster Explorer; document labeled axes, range sources, NumericTiles, bounded
      runtime, ROIs/results, graphs, identity/provenance, trusted extensions, future accelerators,
      alpha status, and limitations.
- [x] Add a public-import-only compiled application lifecycle example and import that exact source
      into the website rather than maintaining an independent HTML-only snippet.
- [x] Give every application entry its own API-reference section and label the application platform
      alpha, provider/extension APIs experimental, and the ordinary codec pipeline the existing
      stable path, including lifecycle warnings.
- [x] Update `llms.txt` for readers, labeled datasets, identities, NumericTile ownership, operations,
      graphs, ROIs/results, planning/execution, persistence, extensions, and WASM/WebGPU status;
      distinguish initial bounded analysis from still-deferred mature scientific ecosystems.
- [x] Use materials and instrument-imagery language on the secondary platform page while explicitly
      avoiding mature SEM/TEM, DM3/DM4, EDS, FFT, particle, or grain-analysis claims.
- [x] Run formatting, package/browser/documentation gates, focused tests, `npm run check`, and
      record the final validation result and diff summary.

  - Follow-up validation: the four minified entry baselines are 438,229 bytes for scientific,
    44,252 for operations, 272,246 for analysis, and 46,564 for extensions; their enforced ceilings
    are 570,000, 58,000, 354,000, and 61,000 bytes. The public-only platform example compiles and
    executes, package types pass, the browser graph passes, all 19 documentation pages build, and
    lint and formatting pass. The complete standard suite passes 95 files and 1,198 tests before the
    same three environment-specific expanded 12-bit AVIF Sharp-oracle hash mismatches; the hostile
    suite with only that known oracle file excluded passes 95 files and 1,176 tests.

### Pre-release scientific API cleanup

- [x] Publish the sole `ScientificDatasetDescriptor` schema as version 1 and remove migration-history
      terms such as `V2` and `Labeled` from the public scientific API.
- [x] Rename the current arbitrary-axis implementation files to `dataset.ts` and `public.ts`, while
      keeping the unreleased fixed-axis implementation isolated as an internal legacy adapter.
- [x] Give GSF, ENVI, FITS, MRC, CBF, and OME-TIFF individual reader entries plus an explicit
      `scientific/readers/all` convenience entry.
- [x] Remove concrete readers and format-specific helpers from the base `scientific` entry so the
      registry and portable dataset contracts remain lightweight.
- [x] Add hard bundle-size ceilings for the base scientific platform, every individual reader, and
      the opt-in all-readers entry.
- [x] Run package, browser, documentation, focused scientific, benchmark, and full repository gates;
      record the final result before handoff.

  - Cleanup validation: the base scientific bundle is 138,147 bytes minified, down from 438,229
    bytes before readers were split. Individual minified reader entries range from 37,864 bytes for
    GSF to 267,489 bytes for OME-TIFF; the all-readers entry is 337,265 bytes. All have ceilings with
    roughly 30% headroom. The 121 focused scientific/contract tests, package consumer, browser graph,
    19-page documentation build, compiled external application example, correctness-gated platform
    benchmark, and real Chromium scientific workflow pass. Standard and hostile-source suites each
    pass 95 files and 1,204 tests; both report only the same three environment-specific expanded
    12-bit AVIF Sharp-oracle hash mismatches.

### Final merge-hardening pass

- [x] Centralize exact ordered scientific plane-read capability checks, reuse them in request
      normalization and the website Worker, and reject unsupported built-in plane requests during
      metadata inference before provider preparation or source reads.
- [x] Make NumericTile assembly cleanup attempt every tile release and iterator close while
      preserving operational errors, and forward MRC YZ cross-section block ownership.
- [x] Label the application platform as an unreleased main-branch alpha preview across the website,
      API, guide, `llms.txt`, README, application guide, and draft release notes while preserving
      the established npm codec workflow.
- [x] Run focused lifecycle/planning tests, package and browser gates, documentation checks, the
      relevant application-platform benchmark, a real Chromium scientific workflow, and the full
      repository gate; record the result before handoff.
- [x] Replace the ambiguous native-source retained-byte estimate with request-specific
      `single-exact`/`streamed` read plans. Streamed adapter admission now includes compact output,
      one-byte coverage storage, and one complete emitted backing allocation simultaneously;
      zero-copy requires the explicit exact-delivery contract and performs no iterator lookahead.

  - Final hardening validation: 120 focused scientific/planning/lifecycle/project-contract tests,
    package-consumer types, the compiled external lifecycle, browser dependency checks, the 19-page
    documentation build, the correctness-gated application benchmark, and the real Chromium
    scientific workflow pass. On macOS, the three platform-variable expanded 12-bit AVIF
    Sharp/libvips oracle cases are explicitly skipped while remaining mandatory elsewhere; the
    standard and hostile-source suites otherwise pass 98 files and 1,211 tests. No scientific
    application-platform test fails.
