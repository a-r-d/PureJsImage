# Application platform architecture

Status: design checkpoint approved on 2026-08-12; no runtime API described here is implemented yet.

This document defines a target architecture for scientific web applications built on
PureJsImage. It is deliberately additive. The existing image API, codec registry, and streaming
pixel pipeline remain the ordinary-image path; the application platform grows beside them and
shares only the portable source and block foundations.

The design is based on the repository at commit
`75a3e3a29cd829f89419cda837bffe6646090636` (PureJsImage 0.9.0). File names below describe the
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
- `src/scientific/dataset.ts` defines `MultidimensionalRasterDataset`, a lazy fixed `X/Y/Z/C/T`
  model whose `readPlane()` method yields bounded `RasterBlock`s. FITS, MRC, CBF, GSF, ENVI, and
  OME-TIFF expose this model through the existing `openX` functions.
- The format readers validate dimensions and source extents, keep sample data lazy, and generally
  bound blocks with `maxDecodedBytes`. They do not yet accept an `AbortSignal` in
  `RasterPlaneRequest`, so cancellation cannot reliably interrupt an in-flight scientific read.
- Current scientific rendering and measurement consume blocks correctly and propagate
  `release()` in `finally`, but repeated work converts canonical bytes repeatedly, often through a
  newly allocated `Float64Array` per row. Range measurement followed by rendering may read the same
  region more than once. That is a sound display implementation, not yet a reusable compute
  runtime.
- `src/image-core.ts`, `src/pipeline.ts`, and `src/executor.ts` implement an immutable linear image
  pipeline. The executor pushes eligible crops and JPEG scale selection toward decoders and streams
  `PixelBlock`s to encoders. This behavior is central to `resize().jpeg()` and must not be absorbed
  into a scientific graph rewrite.
- `src/accelerator.ts` already requires explicit accelerator registration at image-library
  construction. An `ImageCodecAccelerator` wraps a whole codec and owns its workload choice. That
  contract is intentionally too coarse for operation-level semantic matching, cost comparison, and
  provenance, so analysis providers should follow its explicit-registration principle without
  reusing its interface.
- The package already isolates `purejsimage/scientific`, `purejsimage/scientific/node`, explicit
  codecs, and explicit WASM accelerators. `tsconfig.browser.json`,
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
        -> ScientificDataset V2 descriptors and RasterBlock read selections
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

### `ScientificDataset` V2

Use the public name `ScientificDataset` with an explicit `schemaVersion: 2` rather than the more
verbose `ScientificDatasetV2`. There is no existing `ScientificDataset` symbol, and the version is
part of the serialized descriptor rather than a permanent suffix in every consumer type.

V2 describes dimensions as labeled axes instead of assuming every dataset is exactly `X/Y/Z/C/T`.
An axis has a stable ID, semantic kind, length, and optional unit, regular origin/spacing, or an
explicit coordinate vector. Channel descriptions remain first-class metadata rather than being
forced into numeric coordinates. A read selection names two display axes and fixes, ranges, or
indexes all other axes; it yields two-dimensional `RasterBlock`s. That keeps the existing portable
block boundary usable without pretending `RasterBlock` is an arbitrary N-dimensional tensor.

The V2 read contract must include `AbortSignal` and a byte budget in its options. Cancellation must
be threaded through `readExactly()` and `ImageSource.read()` as each reader migrates, rather than
being simulated by an adapter that can only check between blocks. Tests must prove axis mapping,
channel selection, coordinate metadata, block shape, cancellation, and release propagation.

The implemented PR 1 boundary keeps a temporary explicit adapter while readers still return the
fixed-axis type. `ScientificAxisDescriptor.entries` carries per-coordinate channel identity, name,
unit, color, and spectral center/FWHM without confusing independently selectable channels with
stored components. Generic measurement and rendering now execute from a resolved two-axis plane and
therefore support arbitrary stable display-axis IDs. Spectral helpers require the spectral axis ID;
volume projection requires the reduction axis ID; neither guesses from position. Labeled slice,
projection, integration, and ratio outputs preserve the surviving axis descriptors and remain lazy
and region-bounded. The ENVI classification renderer remains intentionally format-specific because
its class lookup table is an ENVI reader contract, not generic labeled-axis metadata.

The bridge is not the release architecture. `MultidimensionalRasterDataset` is marked deprecated,
and the explicit adapters isolate migration rather than promise 0.9.x compatibility. Reader
migration can remove the bridge before the next version increment. V1 does not describe pyramid
geometry, so callers adapting a V1 pyramid must supply known `ScientificResolutionLevel` entries;
the adapter refuses to invent them. Reverse adaptation accepts only literal `x`, `y`, optional `z`,
`channel`, and `time` axes plus one scalar component and flat string metadata. Anything richer is
rejected instead of silently flattened or discarded.

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

The first source of `NumericTile`s is an adapter over V2 `RasterBlock` reads. A later
`NativeNumericTileSource` capability may let a reader or an explicitly registered WASM backend
produce a conforming tile directly. That is an optional fast path, not a second dataset model. It
must preserve the same selection, abort, limits, ownership, sample semantics, and conformance tests
as conversion from canonical blocks.

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
an iterable of trusted bundles or receives explicit `register()` calls. Duplicate IDs and
incompatible versions reject. There is no package-global mutable singleton, side-effect import, or
hidden auto-registration. Built-in reference operations are ordinary explicitly supplied bundles.

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

The tile runtime owns planning, bounded scheduling, conversion, cache accounting, and release
propagation. Every read and execution call requires an `AbortSignal`; callers that do not need
external cancellation may pass a fresh non-aborted signal. Every plan has explicit limits for source
bytes read, live decoded bytes, live native-tile bytes, provider memory, result bytes, and concurrent
tasks. Limits are checked before admission and as actual usage is reported.

Cancellation stops new admissions, propagates to sources and providers, closes iterators, and
releases cached, in-flight, input, output, and provider resources. Cancellation and failure paths are
tested as strongly as success paths. Concurrency is an input to the scheduler, never an unbounded
`Promise.all()` over tiles.

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

A Worker or cross-origin iframe RPC boundary for untrusted extensions is future work. That boundary
will need a structured-clone-safe protocol, capability-scoped source/tile handles, transfer and copy
accounting, cancellation, quotas, timeouts, crash cleanup, and version negotiation. The in-process
registry must not be marketed as safe for untrusted code while that work remains unimplemented.

## Intended package boundaries

The public module graph should develop as follows:

- `purejsimage` and `purejsimage/browser` keep the current ordinary image API and behavior. No
  analysis module is imported from either root.
- `purejsimage/scientific` owns the format readers, portable V2 dataset descriptors, and numeric tile
  contracts/conversion. Its unreleased scientific exports may change during the alpha implementation
  sequence and are finalized at the next versioned release. `purejsimage/scientific/node` remains
  the place for path-based helpers.
- A future `purejsimage/operations` entry exports JSON-safe descriptors and schemas, provider
  contracts, caller-owned registries, and the explicit TypeScript reference bundle. It depends only
  on portable scientific and core types.
- A future `purejsimage/analysis` entry exports graph parsing/canonicalization/migration, ROIs,
  results and provenance, planning, tile runtime, immutable workspace snapshots, and commands. It
  depends on `operations` and `scientific`, not on concrete readers or Node adapters.
- A future `purejsimage/extensions` entry is justified only if trusted bundle composition and the
  future RPC protocol would otherwise make `operations` or `analysis` depend upward. It contains
  extension-host conveniences, not a global registry and not an implied sandbox.

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
| 1 | Define `ScientificDataset` V2 labeled-axis descriptors, replace the unreleased fixed-axis public contract, and migrate the first representative readers. | `src/scientific/dataset.ts`, `src/scientific/index.ts`, selected files under `src/scientific/formats/`; optionally a temporary internal migration bridge. | Current demos and tests must migrate with the intentional break; transitional code could outlive its purpose. | Contract tests using FITS, MRC, ENVI, and an irregular synthetic axis; affected scientific format and demo tests. | The new API is smaller than an adapter-based alternative; migrated readers have no legacy wrapper; temporary bridges are explicitly tracked for removal; `npm run browser:check`; `npm run check`. |
| 2 | Migrate the remaining scientific readers, remove transitional bridges, and require abort- and budget-aware V2 reads. | `src/scientific/formats/{fits,mrc,cbf,gsf,envi}.ts`, `src/scientific/ome-tiff.ts`, `src/scientific/{render,spectral,volume,classification}.ts`, `src/source.ts`, abort/limit helpers. | Partial reads or cancellation could leak blocks; format-specific metadata could be lost during migration. | Focused abort-before-read, abort-during-read, iterator-return, release, metadata, and byte-budget tests for contiguous and strided readers. | All readers use the V2 contract directly; no compatibility bridge remains; no read continues after observed abort; every yielded/rejected block is released; source-byte cap is enforced; `npm run check`. |
| 3 | Introduce `NumericTile`, validated one-time conversion, pooling, and the optional direct native tile-source capability. | `src/raster.ts`, `src/scientific/samples.ts`, `src/scientific/index.ts`; new `src/scientific/numeric-tile.ts`. | Endianness, float16 expansion, uint64 precision, planar/interleaved strides, or ownership could change values. | Cross-sample-type golden tests, hostile stride/truncation tests, release-on-error tests, reference-vs-direct-source conformance. | Canonical block fixtures produce exact native values; no `uint64` number coercion; measured retained-byte bounds; `npm run browser:check`; `npm run check`. |
| 4 | Define JSON-safe operation descriptors, the supported parameter-schema subset, validation, and caller-owned descriptor registry. | New `src/operations/{descriptor,schema,registry,index}.ts`; later export wiring in `package.json`; `tests/project-contract.test.ts`. | Defaults or unknown-key handling could become persisted semantics; a singleton could create order-dependent behavior. | JSON round-trip, unknown schema keyword, duplicate/version conflict, default application, and registry-isolation tests. | Descriptor corpus contains only JSON values; registry instances are isolated; no side-effect registration; dependency guard passes; `npm run check`. |
| 5 | Define `OperationProvider` and ship the permanent strict TypeScript reference provider for a deliberately small first operation set. | New `src/operations/{provider,reference}.ts`; reuse sample helpers without importing format readers; new provider tests. | Reference behavior could be underspecified, or provider code could materialize complete planes. | Semantic vectors for NaN/no-data/edges/types, bounded multi-tile execution, cancellation, release, and allocation tests. | Reference results are the conformance oracle; declared memory formula holds; no full-plane helper exists in the generic provider path; `npm run check`. |
| 6 | Add immutable graph JSON, canonicalization, explicit migrations, source identity ladder, and validation issues. | New `src/analysis/{graph,canonical-json,migrations,source-identity,issues}.ts`; `src/scientific/dataset-v2.ts` for source-reference types if needed. | Canonical bytes will become durable at release; weak identities could poison persistent caches. | Provisional canonical fixture corpus, property-order invariance, semantic-order preservation, migration reports, unsupported-version rejection, identity-refinement tests. | Canonical behavior is tested but remains revisable until the release gate; execution rejects unmigrated graphs; weak identity stays session-scoped; `npm run browser:check`; `npm run check`. |
| 7 | Build the bounded tile runtime and measurable local cache. | New `src/analysis/{tile-runtime,tile-cache,budget,scheduler}.ts`; `src/source.ts` and `src/sources/http-range.ts` only if shared metrics need a portable interface. | Double release, retained buffers, starvation, unbounded concurrency, or cache keys that cross semantic boundaries. | Deterministic fake-source/provider tests for budgets, LRU behavior, concurrency ceilings, cancellation races, iterator cleanup, and metrics. | High-water bytes stay within declared limits; concurrency never exceeds policy; all failure paths release; cold/warm cache measurements are observable; `npm run check`. |
| 8 | Add exact semantic matching, measured full-cost provider planning, pins, and execution provenance. | New `src/analysis/{planner,cost-model,provenance,executor}.ts`; `src/operations/provider.ts`; do not change `src/accelerator.ts`. | A nominally faster backend could change semantics or hidden fallback could invalidate reproducibility. | Candidate rejection matrix, small-tile TypeScript win, transfer-heavy WebGPU loss, resident-backend win, pin failure, and provenance snapshot tests. | Every selected provider passes exact support; cost components and model version are recorded; no hardcoded backend rank; `npm run check`. |
| 9 | Add ROIs, immutable results, workspace snapshots, structured commands, and the execution/audit boundary. | New `src/analysis/{roi,result,workspace,commands,audit}.ts`; optional reuse of coordinate metadata from `src/scientific/dataset-v2.ts`. | UI convenience could mutate graphs in place, mix physical and index coordinates, or execute during a command. | Snapshot immutability, issue paths/codes, ROI conversion, command replay, explicit-execution, and cancel/audit tests. | Commands are JSON-safe and deterministic; invalid commands return unchanged snapshots; applying commands performs no source/provider work; `npm run check`. |
| 10 | Complete release-boundary hardening, add trusted extension-bundle composition, and prove whole-platform ordinary-image/browser compatibility. | `package.json`, `tsconfig.browser.json`, `scripts/check-browser-build.ts`, `scripts/check-package-types.ts`, `tests/project-contract.test.ts`, `src/index.ts`, `src/browser.ts`; optional `src/extensions/`; `browser-tests/scientific.pw.ts`; version/changelog files only during an authorized release. | Incrementally exported subpaths could still pull Node built-ins or optional backends into browsers; root bundle or `resize().jpeg()` behavior could drift; provisional contracts could be published accidentally; “extension” could be mistaken for sandboxing. | Package-type consumers for Node/browser, bundle graph assertions, registry isolation, extension trust-label tests, current pipeline tests, scientific browser smoke test, canonical persisted-contract fixtures. | All transitional code is removed; release contracts and breaks are documented; root/browser exports remain compatible and exclude analysis/backends; new entries contain no Node built-ins; existing `resize().jpeg()` tests and real Chromium scientific workflow pass; `npm run check`. |

New package subpaths and completed capabilities may land incrementally in the PR that makes them
usable. PR 10 is the release-readiness gate, not the first publication point. Repository exports
before that gate are provisional alpha contracts; an actual package release must not occur until the
whole exported surface passes the final browser, package, compatibility, and persisted-contract
checks.

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

1. the `ScientificDataset` public name, `schemaVersion: 2`, labeled-axis selection model, and clean
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
permanent V1/V2 compatibility period. The later approved alpha policy supersedes that assumption:
the unreleased fixed-axis API may be replaced when that produces cleaner code. Temporary adapters
remain an implementation option, not a compatibility requirement. Preserve the prompts' substantive
parity, metadata, laziness, release, cancellation, and bounded-memory acceptance criteria whichever
migration path is chosen.

### Completed design work

- [x] Prompt 0: inspect the current architecture and write this application-platform checkpoint.
- [x] Record the ten maintainer decisions, including the revised alpha release and incremental export
      policy.
- [x] Add this checklist and the repository-level pointer in `AGENTS.md`.

### PR 1: labeled-axis scientific dataset V2

- [x] Prompt 1.1: add the V2 contracts and validation.
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
  - [x] Export only stable V2 types/utilities; add no dependency, codec, Node-only path, global
        registry, or full-frame buffering.
  - [x] Run focused Vitest tests, `npm run typecheck`, `npm run lint`, and `npm run format:check`;
        review `git diff --stat`.
  - Result: 28 V2 contract tests and 92 affected scientific tests pass; browser and packed-declaration
    checks also pass. The fixed-axis API remains untouched pending Prompt 1.2. The full repository
    check reaches Vitest with 970 passing tests and the same three unrelated AVIF Sharp-oracle hash
    failures recorded before Prompt 1.1; the hostile-source phase is not reached after that failure.

- [x] Prompt 1.2: resolve the old/new dataset migration boundary.
  - [x] Re-read repository instructions and inspect all Prompt 1.1 changes and current status.
  - [x] Choose and document the cleaner migration: temporary lossless adapters or direct replacement
        of the unreleased fixed-axis contract. Do not add a permanent 0.9.x compatibility layer by
        default.
  - [x] If a legacy-to-V2 bridge is useful, preserve X/Y/Z/C/T mapping, calibration, channel and
        spectral metadata, sample/no-data/source metadata, resolution selection, lazy blocks, exact
        coordinates/values, release callbacks, and abort propagation.
  - [x] If a V2-to-legacy bridge is useful, allow only truthful X/Y plus optional Z/C/T mappings and
        reject arbitrary axes such as scanX/scanY/kx/ky rather than flattening or relabeling them.
  - [x] Provide one internal normalization path only if it removes real duplication; keep conversion
        work outside per-sample hot loops.
  - [x] Add parity tests for uint8, uint16, float32, planar/interleaved layouts, calibration/channel
        metadata, releases, aborts, and unsafe 4D-STEM reverse mapping where an adapter exists.
  - [x] Run focused migration and affected scientific tests, `npm run typecheck`, `npm run lint`, and
        `npm run format:check`; review `git diff --stat` and record any intentional API break.
  - Result: the temporary bridge uses explicit `toScientificDataset()` and
    `toMultidimensionalRasterDataset()` adapters plus one internal dataset-form guard shared by
    algorithm boundaries. V1-to-V2 keeps the original `RasterBlock` object, data, coordinates,
    layout, and release callback; maps logical channels to typed axis entries; and forwards
    cancellation through the now abort-aware V1 request. Known pyramid geometry must be supplied
    explicitly because V1 does not describe level dimensions. V2-to-V1 accepts only literal spatial
    `x`/`y`, optional spatial `z`, channel or spectral `channel`, optional `time`, one stored
    component, and metadata representable as a flat string record; richer axes, components, or
    metadata are rejected rather than discarded. The fixed-axis interface is deprecated as a
    temporary alpha bridge, not promised through a permanent 0.9.x window. The 40 focused V2/adapter
    tests and 176 affected scientific/reader tests pass, as do typecheck, lint, and formatting.

- [x] Prompt 1.3: make existing scientific algorithms V2-aware and close PR 1 scope.
  - [x] Re-read repository instructions and inspect every accumulated PR 1 change before editing.
  - [x] Use thin normalization at algorithm boundaries; do not fork V1/V2 implementations or make
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
  - [x] Review final `git diff --stat`; document the public V2 API, deferred assumptions, and ordinary
        image-pipeline regression result.
  - Result: render and measurement resolve one scalar plane before entering the existing row scans,
    so legacy and labeled callers share statistics, histograms, range measurement, relief, and pixel
    mapping without polymorphism in sample loops. Labeled spectral selection, rendering, composites,
    integration, and ratios require an explicit spectral-axis ID. Labeled slices preserve the two
    selected axes; projections require an explicit reduction-axis ID and retain only bounded output
    rows and one contributing plane region at a time. ENVI classification stays format-specific
    until V2 has a generic categorical metadata contract. The 180-test scientific/reader subset and
    a 78-test ordinary pipeline/JPEG/PNG subset pass; browser and packed-declaration checks pass. The
    repository-wide check has 984 passing tests and stops on the same three unrelated 12-bit AVIF
    Sharp-oracle hash mismatches from the earlier baseline, so the hostile-source phase is not
    reached.

### Remaining implementation PRs

- [ ] PR 2: migrate remaining scientific readers and enforce abort/budget-aware V2 reads. Detailed
      prompts not yet supplied.
- [ ] PR 3: add native `NumericTile` conversion and optional direct native tile sources. Detailed
      prompts not yet supplied.
- [ ] PR 4: add JSON-safe operation descriptors, schemas, validation, and local registries. Detailed
      prompts not yet supplied.
- [ ] PR 5: add the strict TypeScript reference `OperationProvider`. Detailed prompts not yet
      supplied.
- [ ] PR 6: add canonical analysis graphs, migrations, source identity, and validation issues.
      Detailed prompts not yet supplied.
- [ ] PR 7: add the bounded tile runtime, cache, budgets, and scheduler. Detailed prompts not yet
      supplied.
- [ ] PR 8: add semantic provider matching, measured cost planning, pins, and provenance. Detailed
      prompts not yet supplied.
- [ ] PR 9: add ROIs, immutable results/workspaces, structured commands, and audit boundaries.
      Detailed prompts not yet supplied.
- [ ] PR 10: complete release-boundary hardening, extension composition, and whole-platform
      compatibility validation. Detailed prompts not yet supplied.
