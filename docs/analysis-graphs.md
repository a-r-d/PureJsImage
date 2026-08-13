# Analysis graphs, planning, and execution

`purejsimage/analysis` provides the runtime-neutral application boundary for versioned analysis
graphs. The graph is declarative JSON: it contains no sources, pixel payloads, functions, provider
availability, timestamps, or task state. Operation definitions and executable providers remain in
explicit application-owned registries.

This API does not replace the ordinary image pipeline. `image.resize(...).jpeg(...)` continues to
use its existing direct pipeline and package entry points.

## Semantic graph and hash

An `AnalysisGraph` declares `schemaVersion`, named external inputs, stable node IDs, exact operation
`{ id, version }` references, named input connections, normalized parameters, and named outputs.
Structural `validateGraph()` rejects unknown fields, operations, versions, ports, references,
incompatible value types, missing inputs, invalid parameters, cycles, and configured limits. The
controller, planner, and project validator additionally require every declared graph input type to
exist in their explicit `ValueTypeRegistry`, even when the input is unused or published directly.
A successful result includes a stable topological node order and the normalized graph.

The semantic hash contains:

- `schemaVersion`;
- each input's name and exact value-type ID/version, sorted by input name;
- each node's ID, exact operation ID/version, named connections, and normalized parameters, in graph
  order after nodes are sorted by node ID; node inputs are sorted by port name;
- each named output and its source, sorted by output name.

Graph, input, node, and output `label` fields are deliberately excluded. Labels are editable human
presentation text and do not change computation. Source values and identities, typed payloads,
provider availability or selection, timestamps, measurements, and provenance are also excluded.
They are supplied to planning or recorded with execution instead.

The graph hash identifies only the reusable recipe. Planning also creates an
`AnalysisInvocationManifest`: each external binding has its exact value-type ID/version and either
a normalized source identity, a hash of canonical semantic JSON, or an explicit application-defined
identity. ROI identities hash quantitative geometry, axes, fixed indices, and coordinate semantics
while excluding presentation. The manifest hashes those bindings as `bindingHash`, then hashes
`{ graphHash, bindingHash }` as `invocationHash`. Opaque and extension-defined object values must
supply an explicit semantic identity; execution cannot replace or supplement the identities fixed
by the prepared plan.

`canonicalGraphJson()` first constructs that semantically sorted graph representation, then sorts
every JSON object key. It rejects values outside the supported JSON domain, including `undefined`,
non-finite numbers, bigint, functions, symbols, sparse arrays, accessors, non-plain objects, and
cycles. `hashAnalysisGraph()` asynchronously hashes the canonical text with SHA-256 and the domain
prefix `purejsimage.analysis-graph.canonical-json.v2`.

Hashing never validates or migrates a graph. Callers must explicitly validate and, when needed,
inspect and apply a registered migration plan before hashing the migrated graph.

## Source identity ladder

Source identity is available without reading an entire source. Identity lookup never blocks first
display on a content hash.

| Identity | Strength and stability | Intended use |
| --- | --- | --- |
| SHA-256 content identity | Strong, content-addressed | Durable cache keys, exports, and comparisons after an explicit bounded hash pass. |
| Remote URL plus strong ETag or version ID | Strong, versioned | Reopenable remote provenance and cache reuse while the validator remains unchanged. |
| Remote URL plus `Last-Modified`, or no validator | Weak, best-effort | Session planning and diagnostics; never represented as content equality. |
| Local path/name, size, and last-modified time | Weak metadata identity | Fast local provenance and cache hints without reading a large file. |
| Per-instance session ID | Session-only | Memory, plain Blob, or custom sources with no external stable identity. |

`MemorySource` accepts an explicit caller identity or creates a per-instance session identity.
`BlobSource` recognizes `File`-shaped name and last-modified metadata without requiring a browser
global. `FileSource`, `HttpRangeSource`, buffered sources, validation wrappers, and signal wrappers
propagate identity metadata. HTTP validators are immutable snapshots, and version IDs, strong ETags,
and `Last-Modified` values are checked across later range reads so the source cannot silently change
after opening.

Call `hashImageSource()` only when content identity is required. It validates source size, enforces
a caller byte limit, reads fixed-size chunks, accepts `AbortSignal`, reports progress, and never
buffers the whole source.

```ts
import { getImageSourceIdentity, hashImageSource } from 'purejsimage/analysis'

const fastIdentity = await getImageSourceIdentity(source)
const contentIdentity = await hashImageSource(source, {
  maxBytes: source.size,
  signal,
  onProgress: ({ bytesRead, totalBytes }) => reportProgress(bytesRead, totalBytes),
})
```

Keeping these inspection and hashing utilities on the explicit analysis entry prevents the
ordinary root image pipeline from carrying the full analysis utility surface.

## Explicit migrations

`AnalysisMigrationRegistry` contains caller-supplied functions keyed by migration ID/version and an
exact graph-schema edge or operation ID/version edge. `inspectMigrationPlan()` rejects missing,
ambiguous, downgrade, and cyclic version paths. `applyMigrationPlan()` verifies every exact step,
applies trusted migration functions, revalidates the result, and returns its new semantic hash.

Migrations are never discovered globally and never run during validation or hash calculation.
Trusted extension bundles can contribute migration definitions while their host is constructed. A
collision rejects construction before a host is returned, so extension registration remains atomic.

## Planning and dry runs

Planning validates the graph and all bound inputs before it prepares providers. Only providers
allowed by the requested `reference-only`, `automatic`, or exact `pinned` policy are prepared.
Selection still requires exact operation semantics and reproducibility support, then compares the
reported setup, transfer, compute, readback, retained-memory, and confidence costs. Provider kind is
not a priority ranking.

Operation definitions may infer output shapes from caller-supplied JSON characteristics. Provider
planning receives only an `OperationPlanningRequest` containing JSON-safe characteristics; it never
receives actual values or synthetic value placeholders. Execution receives a separate
`OperationExecutionRequest` with actual inputs and the characteristics fixed during planning, and
may run an explicit execution validator before compute. Planning does not call `ImageSource.read()`
and cannot inspect pixels. Any metadata acquisition is a separate, explicit, bounded caller action
whose JSON result may be supplied as input characteristics.

The returned JSON-safe plan summary contains the graph, binding, and invocation hashes, node order, exact output value types,
shape inference results, provider and implementation fingerprints, execution characteristics,
costs, source identities, and warnings. `dryRun()` returns only structured issues, warnings, and the
summary; it never calls provider `execute()`.

```ts
import { createAnalysisController } from 'purejsimage/analysis'
import {
  createOperationRegistry,
  createValueTypeRegistry,
} from 'purejsimage/operations'

const controller = createAnalysisController({
  operations: createOperationRegistry(myOperationDefinitions),
  valueTypes: createValueTypeRegistry(myValueTypeDefinitions),
  providers: myExplicitProviders,
  library: { version: '0.9.0', buildFingerprint: myBuildFingerprint },
})

const dryRun = await controller.dryRun(graphJson, {
  bindings: {
    image: {
      value: imageSource,
      characteristics: { width: 4096, height: 4096 },
    },
  },
  policy: { mode: 'reference-only' },
  signal,
})

console.log(controller.capabilities, dryRun)
```

An abbreviated machine-facing response is plain JSON:

```json
{
  "capabilities": {
    "apiVersion": 1,
    "graphSchemaVersion": 1,
    "operationDescriptors": [],
    "valueTypeDescriptors": [],
    "providerDescriptors": [],
    "migrationDescriptors": [],
    "commandKinds": ["add-node", "connect", "set-output"],
    "trustBoundary": "Trusted in-process API, not a sandbox"
  },
  "dryRun": {
    "valid": true,
    "issues": [],
    "warnings": [],
    "plan": {
      "schemaVersion": 1,
      "graphHash": "<sha256>",
      "invocation": {
        "schemaVersion": 1,
        "graphHash": "<sha256>",
        "bindings": [],
        "bindingHash": "<sha256>",
        "invocationHash": "<sha256>"
      },
      "nodeOrder": ["measure"],
      "nodes": [{ "nodeId": "measure", "execution": "reduction" }]
    }
  }
}
```

## Commands and execution

`AnalysisWorkspaceSnapshot` is immutable and has a monotonic revision. Versioned JSON commands add
or remove nodes, connect or disconnect ports, update normalized parameters, declare or remove graph
inputs, and set or remove outputs. `expectedRevision` rejects stale UI, script, or agent changes.
Validation and application are pure: an invalid command returns the original snapshot and structured
issues, while a successful command returns a new snapshot. Commands contain no code strings,
arbitrary mutation path, DOM access, `eval`, or privileged AI-only fields.

Controller capabilities publish a JSON-safe descriptor for every available command, including its
title, description, closed payload schema, whether it mutates the workspace, and whether
`expectedRevision` is mandatory. Domain payloads reference the public versioned graph/ROI contracts;
operation parameters remain JSON whose exact schema comes from the selected operation descriptor.
Every mutating command requires `expectedRevision`, and descriptors report
`requiresExpectedRevision: true`. `controller.applyCommands(snapshot, { expectedRevision,
commands })` validates a proposed batch against an immutable draft, applies everything and advances
the revision once, or returns the original snapshot with structured issues. Duplicate command IDs
inside a batch are rejected.

When the controller is configured with a scientific ROI context, the same snapshot also owns an
immutable `roiSet`, and the same command path supports `add-roi`, `update-roi`, `remove-roi`, and
`replace-roi-set`. ROI commands validate labeled axes, calibration, fixed indices, geometry, and
limits before changing the revision. They do not alter graph semantic hashing and do not execute a
provider; an ROI reaches an operation only through an explicitly typed graph input and a later
binding passed to planning. See the [ROI guide](roi-geometry-and-sampling.md).

Planning and execution are separate explicit calls. `executeGraph()` accepts an already prepared
plan, returns a cancellable task, respects bounded parallelism, executes dependencies
deterministically, and releases intermediate owned outputs after their last consumer. Named outputs
remain owned until the caller releases the result. There are no hidden retries or provider changes.
The returned `AnalysisExecutionOutputs` is a frozen accessor view with lookup and iteration only; it
does not expose the backing `Map` or mutation methods. Releasing the execution invalidates owned
values and empties the view.

A prepared plan owns its prepared providers and issues an execution lease for every invocation.
`plan.dispose()` closes the plan to new executions and waits for all leases; it does not tear down a
provider while execution is blocked or while a returned lazy dataset may still request its first
tile. `AnalysisExecutionResult.release()` releases owned outputs first and then releases the plan
lease. Disposal and release are idempotent.

Execution provenance records the graph, binding, and invocation hashes, graph schema, binding identities, exact operations, parameter
hashes, provider and implementation versions/fingerprints, library build, reproducibility class and
tolerance, warnings, and explicit fallbacks. Start/end timestamps and measured elapsed time are
execution records outside the semantic graph hash.

`AnalysisController` exposes the same capability descriptors, operation descriptions, graph and
command validation, command application, migration APIs, planning, dry runs, execution, and
cancellation to UI code, scripts, trusted plugins, and a future agent. Applying a command never
plans or executes computation.

For schema-driven editors and scripts, `normalizeOperationParameters(id, version, value)` uses the
same registered definition as graph validation to fill defaults and return structured parameter
issues. The initial dataset and ROI-aware result operations can be installed with
`createBuiltInAnalysisBundle()`; their IDs, numeric rules, reduction order, and tolerances are
listed in the [built-in analysis operation guide](built-in-analysis-operations.md).

The current extension and controller APIs run trusted code in process and are **not a sandbox**.
Worker or iframe RPC isolation for untrusted extensions remains future work.

Persisted graph/binding envelopes and the complete hash vocabulary are normative in
[Analysis project format v1](contracts/analysis-project-v1.md) and
[Reproducibility](contracts/reproducibility.md). Ownership across plans, results, lazy datasets, and
runtimes is normative in [Lifecycle and ownership](contracts/lifecycle-and-ownership.md).
