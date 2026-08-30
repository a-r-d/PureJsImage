# Execution evidence architecture

Status: Phase 2 implementation checkpoint. The API is provisional until an authorized release.

## 1. Dependency direction

The portable evidence contract sits beside `ImageSource` and below scientific and application code.
Sources and the ordinary pipeline may emit low-level records. Scientific readers, analysis, and
applications may consume or add records. Core sources do not import analysis, scientific readers do
not import applications, and there is no package-global collector.

## 2. Caller ownership

`createEvidenceSession()` creates one caller-owned session. The caller passes `session.context`
explicitly to a source, range source, pipeline execution, tile runtime, or analysis execution. An
import creates no session, cache, timer, listener, or registry.

## 3. Public and internal API

`purejsimage/evidence` exports the versioned report types, session constructor, source wrapper,
`explainImage()`, and managed lease contract. Event storage, interval merging, string bounds, and
counters stay private. The root package exposes only the type-only execution option and a small
symbol hook used by the explicit evidence helper.

## 4. Schema versioning

Reports contain `schemaVersion: 1`. A breaking field or meaning change requires a new schema
version. Adding an optional field does not change the meaning of existing fields.

## 5. Summary and trace modes

Summary mode retains counters, merged source ranges, bounded operation, provider, and cancellation
aggregates, warnings, and managed-byte totals. Trace mode adds bounded correlated events,
dependencies, and allocation IDs. Omitting evidence is the off mode. The off path does not
construct a collector or event object.

The execution summary counts decoded and encoded blocks and pixels and records the first decoded
and output block times. Failed operations retain only a stable structured failure code, never the
error message.

## 6. Event correlation

Each retained event has a session-local integer ID, relative monotonic timestamp, and scope ID.
`context.child(label)` creates an explicit child scope. Code does not depend on Node async-local
storage. The report retains a bounded parent and label table for those scopes. Labels are interned,
bounded, and are not used as source names.

## 7. Source range accounting

An instrumented `ImageSource` records logical requested and returned bytes. `HttpRangeSource`
records physical response bytes, response ranges, cache hits, misses, and in-flight joins. Unique
bytes are interval unions. Status classes and transfer durations are measured. Time to first byte
is measured from the first response-body chunk and remains unavailable when a source cannot expose
that boundary. Local sources report physical transfers as unavailable. Overfetch is the physical
unique coverage outside the logical range union.

When the configured interval-detail cap is exhausted, the retained union remains a conservative
partial estimate. The report changes the unique coverage and overfetch measurement labels from
`measured` to `estimated` instead of presenting truncated coverage as exact.

Format-specific Zarr object, shard, chunk, WSI tile, and Geo level counters keep their current
contracts. Applications may show them beside the normalized source report. They are not renamed
when their units differ.

## 8. Block and tile provenance

Dependency events use compact input and output IDs. The supported guarantee is block or tile
granularity: a selected output block or tile can identify the bounded recorded set of upstream
blocks, source reads, and operations. Resize, convolution, projection, and reprojection dependencies
are not described as exact per-pixel provenance.

## 9. Managed allocation accounting

Managed leases count buffers whose ownership and byte length PureJsImage knows. Evidence never owns
or retains the buffer. Release is exactly once and double release or underflow throws. Finalization
reports live leases but does not free them. These values are PureJsImage-managed bytes, not JavaScript
heap use, `ArrayBuffer` external memory, process RSS, or browser memory.

## 10. Timing semantics

Timestamps are integer microseconds relative to session start from an injectable monotonic clock.
Wall-clock dates and runtime timer objects are absent. Durations state whether they are measured,
estimated, or unavailable. Routine events do not capture stacks.

## 11. Privacy and redaction

Default reports contain no image bytes, pixels, arbitrary metadata values, headers, cookies, query
strings, local paths, or file names. Remote names, when enabled, retain scheme, host, and path while
dropping the query and fragment. Local names, when enabled, retain only the final name component.
Authorization and cookie headers are never recorded.

## 12. Bounds and overflow

Sessions validate limits for events, estimated serialized bytes, source ranges, allocation leases,
labels, subscribers, and child scopes. Exhausting detail increments a dropped counter and adds one
bounded warning. Aggregate counters continue and image work does not fail because trace storage is
full. Reports expose separate dropped counts for events, ranges, allocation details, labels, and
child scopes.

## 13. Analysis-provider integration

Analysis execution records operation ID and semantic version, provider ID, implementation build
fingerprint, result identity, and reproducibility policy. Evidence refers to existing graph and
provenance IDs instead of copying the graph or result payload.

## 14. Viewer integration

Raster X-Ray owns a trace session inside its worker. Live subscribers send bounded updates to the
page. Worker messages and exported reports are structured-clone and JSON safe. The shared
scientific registry records reader, document, dataset, plane, series, source-block, and conversion
events for OME-Zarr, WSI, and Geo readers without importing an application. Existing object, shard,
chunk, tile, and viewport telemetry remains available because those units are format-specific.

## 15. Benchmark requirements

The evidence benchmark compares off, summary, and trace across JPEG resize, PNG resize, TIFF/COG
viewport, OME-Zarr viewport, scientific render, and analysis graph execution. It verifies identical
output hashes, output sizes, and source reads, then records median wall time, all timing samples,
event and report bytes, dropped detail, managed bytes, RSS, external and `ArrayBuffer` memory, and
first output time. Seven deterministic range workloads report request, transfer, unique, overfetch,
cache, cancellation, first-pixel, and completion values. Request-count reductions are not wins when
overfetch or first-pixel latency regresses.

## 16. Implementation checklist

- [x] Add a portable caller-owned versioned session and report.
- [x] Add bounded summary and trace collection with injected timing.
- [x] Add default URL and local-name redaction tests.
- [x] Instrument logical reads without buffer copies and preserve source contracts.
- [x] Instrument physical HTTP transfers, cache hits, misses, and joins.
- [x] Add exactly-once managed leases and live-lease finalization.
- [x] Expose ordinary pipeline explanation from the same planning functions used for execution.
- [x] Connect analysis provider selection, graph dependencies, and tile-runtime cache ownership.
- [x] Connect normalized reader, document, dataset, plane, series, source-block, conversion, and
      dependency events through shared scientific, OME-Zarr, WSI, and Geo paths while preserving
      format-specific counters.
- [x] Add the bounded opt-in adaptive range policy and deterministic crossover benchmark.
- [x] Add Raster X-Ray with local, remote, and safe sample inputs.
- [x] Complete package, browser, Playwright, benchmark, documentation, and full repository gates.

An item is complete only after its focused tests and the required repository gates pass. Intentional
deferrals remain unchecked and must be reported at handoff.
