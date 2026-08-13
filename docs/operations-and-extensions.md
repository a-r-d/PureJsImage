# Operations and trusted extensions

PureJsImage exposes application-platform primitives through two explicit, browser-portable package
entries:

- `purejsimage/operations` contains JSON-safe value types, ports, parameter schemas, operation
  descriptors, immutable local registries, provider contracts, conservative selection, and the
  definitions that lower existing fluent image operations into their current internal pipeline.
- `purejsimage/extensions` composes trusted scientific readers, value types, operation definitions,
  providers, and explicit analysis migrations into an isolated application-owned host.

Neither entry changes the default `purejsimage` package, installs a registry, probes a backend, or
registers an extension merely because it was imported.

## Descriptors, definitions, and providers

An `OperationDescriptor` is plain JSON. Applications can serialize its stable ID and semantic
version, ordered ports, parameter schema, execution characteristic, and reproducibility class.
`OperationDefinition` keeps semantic normalization, shape inference, and lowering functions outside
that descriptor. `OperationProvider` is the separately registered executable implementation.

Registries are immutable caller-owned snapshots. Exact `(id, version)` pairs may coexist, while
duplicates and attempts to replace built-ins reject the whole construction. The capability snapshot
contains descriptors only, so a UI, script, or future agent can enumerate capabilities without
receiving function references.

```ts
import {
  createBuiltInOperationRegistry,
  createCoreValueTypeRegistry,
} from 'purejsimage/operations'

const operations = createBuiltInOperationRegistry()
const values = createCoreValueTypeRegistry()
const resize = operations.get('purejsimage.transform.resize', 1)
const normalized = resize?.normalizeParameters({ width: 800, kernel: 'lanczos3' })

console.log(operations.capabilitySnapshot, values.capabilitySnapshot, normalized)
```

Scientific applications can construct dataset-calibrated definitions for
`purejsimage.roi@1` and `purejsimage.roi-set@1` with `createRoiValueTypeDefinitions()` or an isolated
registry with `createRoiValueTypeRegistry()` from `purejsimage/analysis`. These are ordinary value
types: operation ports reference their exact IDs and versions, and planning validates bound ROI data
without embedding functions into graph JSON. Extensions must use their own namespaced IDs for
ROI-like semantics and cannot replace the core definitions.

The current fluent API remains the ordinary-image path. Its validators and `PipelineOperation`
execution IR remain authoritative; built-in definitions call those existing validated constructors
when lowering. Registry lookup therefore does not occur in pixel loops, and existing
`image.resize(...).jpeg(...)` code requires no registry.

## Provider selection and provenance

Provider preparation is asynchronous and explicit. An unavailable optional provider can decline at
preparation or exact semantic matching. The runtime filters by operation ID/version, reproducibility
requirements, provider policy, and `supportsPlan(request)`. Planning supplies only JSON-safe input
characteristics to `supportsPlan()` and `estimatePlan()`; actual values exist only in the separate
execution request, where `validateExecution()` may reject a violated runtime contract before
`execute()`. It compares reported setup, transfer,
compute, readback, retained-memory, and confidence measurements. Stable provider identity breaks
otherwise equal estimates; there is no WebGPU-over-WASM-over-JavaScript ranking.

Policies support reference-only execution, constrained automatic selection, and an exact provider
pin. Bit-exact operations admit only implementations marked as differentially conformant.
Provider-pinned operations fail instead of switching. Every result records provider and
implementation identity, the build fingerprint, reproducibility declaration, and selected estimate.
Execution requires an `AbortSignal`, returns owned outputs, and exposes one idempotent `release()`.
Each output must exclusively own the resource represented by its value and must not claim an input
resource. Providers whose separate wrappers or views alias one allocation, GPU buffer, WASM pool,
or remote handle must report the same `ownershipIdentity`. The runtime rejects duplicate wrappers,
shared declared identities, shared detectable typed-array/`NumericTile` buffers, and detectable
input/output storage aliases, releasing rejected outputs. Hidden aliases that JavaScript cannot
inspect remain a provider-contract violation; the in-process registry is a trust boundary, not a
sandbox.

Selection is exact for a prepared node, including lazy tile-producing nodes. A provider must declare
support for every valid tile shape covered by that plan; the runtime does not re-run support checks
per tile or mix providers within one node result. `OperationRuntime.dispose()` closes the runtime to
new execution, waits for active result leases, and then disposes prepared providers. `whenIdle()` and
`isDisposed` make that lifecycle observable without exposing provider internals.

## Trusted extension boundary

`createExtensionHost()` accepts extension objects supplied explicitly by the application. Host
construction validates all readers, value types, operations, provider collisions, registry limits,
and the extension API version before returning a composed registry. `host.prepare()` is the only
step that probes providers, and its manifest includes only successfully prepared provider
descriptors.

```ts
import { createExtensionHost } from 'purejsimage/extensions'
import { createValueTypeDefinition } from 'purejsimage/operations'

const host = createExtensionHost({
  extensions: [{
    descriptor: { id: 'acme.imaging', version: 1, apiVersion: 1 },
    valueTypes: [createValueTypeDefinition({
      descriptor: { id: 'acme.result.score', version: 1, title: 'Score' },
    })],
  }],
})

const prepared = await host.prepare()
console.log(prepared.manifest)
```

These are trusted in-process extensions, not a sandbox. Their reader, validator, lowering, provider,
release, and migration functions execute with the application's authority. PureJsImage does not scan packages
or directories, dynamically import names from data, auto-install bundles, call `eval`, or construct
functions from strings.

Untrusted extensions are future work. The same descriptors, validated commands, and structured
results can later cross a Worker or iframe RPC transport, but that host must add permissions,
resource limits, cancellation enforcement, serialization rules, and realm isolation. The in-process
registry makes no security claim on its behalf.

Analysis graphs, source identities, migrations, workspace commands, dry runs, and execution
provenance are documented in [Analysis graphs, planning, and execution](analysis-graphs.md).
An executable, non-registering pointwise example is available at
[`examples/analysis-trusted-extension/index.ts`](../examples/analysis-trusted-extension/index.ts).
It uses the same descriptor/provider split expected of a future explicitly installed WASM or WebGPU
extension, while remaining an honestly labeled TypeScript reference implementation.
