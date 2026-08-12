# Application platform architecture

Status: design checkpoint approved on 2026-08-12; implementation is in progress. Dataset V2, the
explicit scientific reader/document platform, native numeric tiles, operation descriptors and
providers, and trusted local extension composition described by PRs 1 through 4 now exist. Graph,
tile-runtime, workspace, and application layers remain future work.

This document defines a target architecture for scientific web applications built on
PureJsImage. It is deliberately additive. The existing image API, codec registry, and streaming
pixel pipeline remain the ordinary-image path; the application platform grows beside them and
shares only the portable source and block foundations.

PR 4 began from commit `a5cad144f8cdc3a5a953c4121685c774a5ebbc85` (PureJsImage 0.9.0). File
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
- `src/scientific/dataset.ts` defines `MultidimensionalRasterDataset`, a lazy fixed `X/Y/Z/C/T`
  model whose `readPlane()` method yields bounded `RasterBlock`s. FITS, MRC, CBF, GSF, ENVI, and
  OME-TIFF expose this model through the existing `openX` functions.
- The format readers validate dimensions and source extents, keep sample data lazy, generally bound
  blocks with `maxDecodedBytes`, and propagate read cancellation through both dataset generations.
- Scientific rendering, measurement, spectral math, volume reduction, and classification now
  convert each canonical block once into a native tile before sample loops. Independent range,
  statistics, histogram, and render passes can still reread the same region because PR 3 adds no
  long-lived cache; cache ownership and measurable reuse remain PR 7 work.
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

The permanent source of `NumericTile`s is an adapter over V2 `RasterBlock` reads. A dataset may also
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
| 1 | Define `ScientificDataset` V2 labeled-axis descriptors, replace the unreleased fixed-axis public contract, and migrate the first representative readers. | `src/scientific/dataset.ts`, `src/scientific/index.ts`, selected files under `src/scientific/formats/`; optionally a temporary internal migration bridge. | Current demos and tests must migrate with the intentional break; transitional code could outlive its purpose. | Contract tests using FITS, MRC, ENVI, and an irregular synthetic axis; affected scientific format and demo tests. | The new API is smaller than an adapter-based alternative; migrated readers have no legacy wrapper; temporary bridges are explicitly tracked for removal; `npm run browser:check`; `npm run check`. |
| 2 | Migrate the remaining scientific readers, remove transitional bridges, and require abort- and budget-aware V2 reads. | `src/scientific/formats/{fits,mrc,cbf,gsf,envi}.ts`, `src/scientific/ome-tiff.ts`, `src/scientific/{render,spectral,volume,classification}.ts`, `src/source.ts`, abort/limit helpers. | Partial reads or cancellation could leak blocks; format-specific metadata could be lost during migration. | Focused abort-before-read, abort-during-read, iterator-return, release, metadata, and byte-budget tests for contiguous and strided readers. | All readers use the V2 contract directly; no compatibility bridge remains; no read continues after observed abort; every yielded/rejected block is released; source-byte cap is enforced; `npm run check`. |
| 3 | Introduce `NumericTile`, validated one-time conversion, explicit caller-owned allocation, and the optional direct native tile-source capability. | `src/scientific/{numeric-tile,render,spectral,volume,classification}.ts`, `src/scientific/index.ts`, focused tests and benchmark. | Endianness, float16 expansion, uint64 precision, planar/interleaved strides, or ownership could change values. | Cross-sample-type golden tests, hostile stride/truncation tests, release-on-error tests, reference-vs-direct-source conformance, existing algorithm result suites. | Canonical block fixtures produce exact native values; no `uint64` number coercion; measured retained-byte bounds; `npm run browser:check`; `npm run check`. |
| 4 | Define JSON-safe operation descriptors and local registries; add provider mechanics, current pipeline lowering, trusted extension composition, and explicit public subpaths without implementing new scientific computation. | New `src/operations/{descriptor,registry,provider,builtins,index}.ts`, `src/extensions/index.ts`, `package.json`, browser/package/size scripts, focused tests, and trust-boundary docs. | Defaults or unknown-key handling could become persisted semantics; provider policy could imply a backend rank; extensions could be mistaken for isolation; ordinary pipeline behavior could drift. | JSON/hostile validation, registry isolation, provider cost/pin/release, IR parity, extension atomicity, strict package-consumer, and browser dependency-graph tests. | Descriptors/manifests contain only data; registries remain local; pipeline IR and fluent APIs remain unchanged; no import-time installation; new entries are browser-portable; `npm run check`. |
| 5 | Define bounded provider-neutral quantitative results, adapt existing scientific measurement without duplicate wrapper scans, and add the explicit analysis entry. | New `src/analysis/{result,scientific,index}.ts`; `src/scientific/render.ts`, scientific exports/tests, package/browser/type/size checks, and result docs. | Typed payload ownership or NaN/unit semantics could be ambiguous; generic adapters could reread planes; large results could be accidentally serialized as JSON. | Synthetic scalar/histogram/profile/table/collection validation, million-row columnar metadata, bounded summaries, legacy/generic differential measurements, cancellation/release, and package-boundary tests. | Result memory is bounded and accounted; legacy and generic outputs share one measurement execution; manifests contain schemas rather than payloads; the analysis entry is browser-portable and explicit; `npm run check`. |
| 6 | Add immutable graph JSON, canonicalization, explicit migrations, source identity ladder, and validation issues. | New `src/analysis/{graph,canonical-json,migrations,source-identity,issues}.ts`; `src/scientific/dataset-v2.ts` for source-reference types if needed. | Canonical bytes will become durable at release; weak identities could poison persistent caches. | Provisional canonical fixture corpus, property-order invariance, semantic-order preservation, migration reports, unsupported-version rejection, identity-refinement tests. | Canonical behavior is tested but remains revisable until the release gate; execution rejects unmigrated graphs; weak identity stays session-scoped; `npm run browser:check`; `npm run check`. |
| 7 | Build the bounded tile runtime and measurable local cache. | New `src/analysis/{tile-runtime,tile-cache,budget,scheduler}.ts`; `src/source.ts` and `src/sources/http-range.ts` only if shared metrics need a portable interface. | Double release, retained buffers, starvation, unbounded concurrency, or cache keys that cross semantic boundaries. | Deterministic fake-source/provider tests for budgets, LRU behavior, concurrency ceilings, cancellation races, iterator cleanup, and metrics. | High-water bytes stay within declared limits; concurrency never exceeds policy; all failure paths release; cold/warm cache measurements are observable; `npm run check`. |
| 8 | Add exact semantic matching, measured full-cost provider planning, pins, and execution provenance. | New `src/analysis/{planner,cost-model,provenance,executor}.ts`; `src/operations/provider.ts`; do not change `src/accelerator.ts`. | A nominally faster backend could change semantics or hidden fallback could invalidate reproducibility. | Candidate rejection matrix, small-tile TypeScript win, transfer-heavy WebGPU loss, resident-backend win, pin failure, and provenance snapshot tests. | Every selected provider passes exact support; cost components and model version are recorded; no hardcoded backend rank; `npm run check`. |
| 9 | Add ROIs, immutable workspace snapshots, structured commands, and the execution/audit boundary around the PR 5 result contracts. | New `src/analysis/{roi,workspace,commands,audit}.ts`; optional reuse of coordinate metadata from `src/scientific/dataset-v2.ts`. | UI convenience could mutate graphs in place, mix physical and index coordinates, or execute during a command. | Snapshot immutability, issue paths/codes, ROI conversion, command replay, explicit-execution, and cancel/audit tests. | Commands are JSON-safe and deterministic; invalid commands return unchanged snapshots; applying commands performs no source/provider work; `npm run check`. |
| 10 | Complete release-boundary hardening of the application platform and trusted extension boundary, and prove whole-platform ordinary-image/browser compatibility. | `package.json`, browser/package checks, project-contract tests, `src/index.ts`, `src/browser.ts`, `src/extensions/`, real browser tests, and version/changelog files only during an authorized release. | Provisional subpaths could still pull optional backends into browsers; root bundle or `resize().jpeg()` behavior could drift; contracts could be published prematurely; trust wording could overstate isolation. | Package consumers, bundle graphs, registry isolation, trust-label tests, current pipeline tests, scientific browser smoke, and canonical persisted-contract fixtures. | Transitional code is removed; release contracts and breaks are documented; root/browser exports exclude analysis/backends; existing `resize().jpeg()` and real Chromium scientific workflows pass; `npm run check`. |

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

### PR 2: scientific reader and document registry

- [x] Prompt 2.1: add portable resource, reader, document, probe-budget, and local registry
      contracts.
  - [x] Re-read repository instructions, record HEAD/status, and inspect `ImageSource`, source
        sessions, HTTP range behavior, scientific Node adapters, OME-TIFF, V2 datasets, existing
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
    budget of 32 readers, 32 non-empty reads, 65,536 logical bytes, and 16,384 logical bytes per
    read. Reservations occur before underlying I/O; overlapping and repeated reads count again,
    primary and companion resources share the ledger, and zero-length or wholly out-of-range reads
    do not consume it. Explicit reader selection bypasses probing. The 38 focused registry and V2
    tests pass with typecheck, lint, and formatting.

- [x] Prompt 2.2: adapt GSF, MRC/CCP4, and CBF/imgCIF.
  - [x] Re-read instructions/status and inspect accumulated Prompt 2.1 changes plus each existing
        parser, dataset, fixture, metadata model, and error contract.
  - [x] Add explicitly registered, stable/versioned first-party readers reusing existing parsers and
        dataset implementations without duplicate decoding paths.
  - [x] Use small byte-based probes; treat extensions/media types only as confidence hints that
        cannot override contradictory bytes.
  - [x] Expose one stable lazy V2 dataset summary per document, preserving calibration, units,
        component/channel/no-data, detector, and typed format metadata.
  - [x] Preserve existing `openGsf`, `openMrc`, and `openCbf` exports and behavior; avoid payload
        decoding during probe and summary listing; propagate release and cancellation.
  - [x] Test extension-free detection, misleading extensions, metadata-only summaries, value parity,
        lazy region reads, malformed/truncated error categories, and one registry containing all
        three readers.
  - [x] Run focused format/registry tests, typecheck, lint, and formatting; record each reader's
        exact maximum probe reads and `git diff --stat`.
  - Result: `purejsimage/gsf`, `purejsimage/mrc`, and `purejsimage/cbf` reuse the existing open
    functions and lazy datasets, enrich their V2 descriptors with typed format metadata, and expose
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
    exposes stable `image-N` datasets and carries common declared SubIFD pyramid geometry into V2.
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
        bytes, enumerating summaries, and lazily opening a V2 dataset without `src/` imports.
  - [x] Run package types, browser check, the full scientific subset, and `npm run check`; record
        unrelated failures separately.
  - [x] Review final `git diff --stat`, public exports, bundle/tree-shaking implications, and prove
        root/browser imports do not register scientific readers.
  - Result: `createScientificLibrary({ readers })` owns one isolated registry and returns frozen
    JSON-safe reader and resource-pattern capabilities. `createScientificPathContext()` remains in
    `purejsimage/scientific/node`; `createScientificFileContext()` and the File resolver remain in
    `purejsimage/scientific/browser`. There is no all-readers singleton or bundle: consumers import
    named reader objects and bundlers can eliminate unselected modules under `sideEffects: false`.
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
    selection cannot be represented as one V2 axis index. Hot loops resolve layout/component
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
        value-type registration, and one-execution adapters for legacy and V2 scientific plane
        measurements. Statistics and histograms share a NumericTile pass; direct-tile regression
        coverage confirms the dataset-range/statistics/render workflow now performs three reads and
        releases all nine emitted tiles instead of four reads and twelve releases. The packed strict
        consumer, browser graph, lint, formatting, 111-test scientific/result subset, and 85-test
        hostile-source subset pass. The analysis entry measures 52.8 KiB minified (14.4 KiB gzip,
        13.0 KiB Brotli). The full suite has 1,056 passing tests; `npm run check` remains blocked only
        by the same three unrelated expanded 12-bit AVIF Sharp-oracle hash mismatches recorded by
        PRs 3 and 4.

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
