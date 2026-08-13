# Analysis project format v1

Status: normative alpha contract for persisted PureJsImage analysis projects. This format is
opt-in and does not affect the ordinary image pipeline.

An analysis project records a reusable recipe, semantic bindings, source rebinding information,
and optional presentation state. It never embeds executable providers, open handles, tiles, or
large quantitative result payloads.

## Document shape

```ts
interface AnalysisProjectV1 {
  readonly schemaVersion: 1
  readonly graph: AnalysisGraph
  readonly roiSet: RoiSet
  readonly bindings: readonly PersistedInputBinding[]
  readonly sourceReferences: readonly PersistedSourceReference[]
  readonly providerPolicy?: PersistedProviderPolicy
  readonly display?: ApplicationDisplayState
  readonly createdWith: {
    readonly packageVersion: string
    readonly buildFingerprint: string
  }
  readonly hashes: {
    readonly graph: string
    readonly bindings: string
    readonly invocation: string
  }
}

interface PersistedInputBinding {
  readonly input: string
  readonly valueType: { readonly id: string; readonly version: number }
  readonly identity: AnalysisSemanticIdentity
  readonly value:
    | { readonly kind: 'source'; readonly sourceReference: string }
    | { readonly kind: 'roi'; readonly roiId: string }
    | { readonly kind: 'roi-set'; readonly roiIds?: readonly string[] }
    | { readonly kind: 'inline-json'; readonly value: OperationJsonValue }
}

interface PersistedSourceReference {
  readonly id: string
  readonly identity: AnalysisSemanticIdentity
  readonly locatorHint?:
    | { readonly kind: 'local-file'; readonly name: string; readonly size: number }
    | { readonly kind: 'remote'; readonly url: string }
}
```

The discriminated `value` resolves a source, one project ROI, all or a selected subset of project
ROIs, or bounded inline JSON without duplicating ROI geometry. A source reference ID is unique and
must resolve to exactly one entry. Its identity is a plain `SourceIdentity` for a single source or a
`ScientificDatasetIdentity` for a reader-opened dataset; the latter carries every resource in a
multi-resource format such as ENVI. `ApplicationDisplayState` is bounded JSON owned by the
application; PureJsImage does not interpret its keys.

`PersistedProviderPolicy` mirrors the public `reference-only`, `automatic`, and exact `pinned`
policies. An absent or automatic policy is advisory: replay may choose another semantically
conforming provider and records the actual choice. A pinned policy is mandatory; replay fails if
the exact provider version and optional build fingerprint are unavailable or decline the plan.

## Semantic and presentation fields

The graph hash covers the graph's computation semantics and excludes graph/input/node/output
labels. The binding hash covers every binding's input name, exact value type, and semantic identity.
ROI identities use quantitative ROI semantics: geometry, axes, fixed indices, coordinate space,
units, schema version, and stable ROI ID. ROI names and presentation metadata are excluded.

`display`, graph labels, ROI names/presentation, `createdWith`, locator hints, and source-reference
IDs are presentation or provenance fields. They are not included in the three semantic hashes.
Changing a source identity, inline semantic value, quantitative ROI, value type, or graph recipe
requires recomputing the hashes.

The hashes use the library's published domains:

- graph: `purejsimage.analysis-graph.canonical-json.v2`;
- bindings: `purejsimage.analysis-bindings.v1`;
- invocation: `purejsimage.analysis-invocation.v1`, over `{ graphHash, bindingHash }`.

The stored values must exactly equal a newly planned `AnalysisInvocationManifest`. A loader must
reject a mismatch; it must never repair hashes silently.

## Source rebinding

A persisted local-file locator is a hint, not authority. Browsers ask the user for a `File`; Node
applications resolve paths through their own policy. The loader obtains the candidate's current
`SourceIdentity` and compares it with the persisted identity before planning.

- A matching strong content or versioned remote identity may be rebound automatically.
- A matching weak local metadata identity may be offered as a best-effort candidate, but the UI or
  calling script must disclose that equality is not proven.
- A session identity is not durable and always requires explicit rebinding.
- If a remote ETag, version ID, `Last-Modified`, size, or other validator changes, the source is a
  different binding. Replay stops until the user accepts a rebind, after which binding and
  invocation hashes are recomputed and the event is auditable.

Hashing a multi-gigabyte source is never required before first display. Applications may later
upgrade a weak identity to a content identity through an explicit bounded, cancellable hash pass;
that produces a new binding and invocation identity.

## Validation and migration

The validator boundary is intentionally explicit:

```ts
interface AnalysisProjectValidation {
  readonly valid: boolean
  readonly issues: readonly AnalysisIssue[]
  readonly project?: AnalysisProjectV1
}

validateAnalysisProjectV1(
  value: unknown,
  options: {
    readonly operations: OperationRegistry
    readonly valueTypes: ValueTypeRegistry
    readonly roi: {
      readonly descriptor: NormalizedScientificDatasetDescriptor
      readonly limits?: RoiLimits
    }
    readonly analysisLimits?: AnalysisLimits
    readonly maxDocumentBytes?: number
    readonly maxSourceReferences?: number
    readonly maxBindings?: number
    readonly maxDisplayBytes?: number
  },
): Promise<AnalysisProjectValidation>
```

`validateAnalysisProjectV1()`, `normalizeAnalysisProjectV1()`, and
`computeAnalysisProjectHashes()` are exported from `purejsimage/analysis`. Validation treats parsed
data as `unknown`, rejects unknown fields, accessors, cycles, non-finite numbers, duplicate IDs,
unresolved references, mismatched value types/hashes, and configured limits. It does not open
sources, migrate, prepare providers, or execute a graph.

Project migrations and graph/operation migrations are separate explicit steps. A project loader
first validates the envelope version, presents a registered project migration plan, applies it only
after caller approval, then runs graph migration inspection and validation. No loader may silently
rewrite operation semantics or preserve an old hash across a semantic migration.

Default limits are 16 MiB of UTF-8 project JSON, 1,024 bindings/source references, and 1 MiB of
display JSON, in addition to the public graph and ROI limits. Applications may lower these limits.

## Results

Version 1 persists no full quantitative results. Results may contain typed arrays and explicit
ownership that are not JSON-safe. An application may persist bounded `summarizeResult()` output as
display cache data outside this document, but it is not authoritative and must be keyed by the
invocation plus execution record. A future binary result format requires its own version and
integrity contract.

## Complete example

```json
{
  "schemaVersion": 1,
  "graph": {
    "schemaVersion": 1,
    "inputs": [{ "name": "surface", "valueType": { "id": "purejsimage.scientific.dataset", "version": 1 } }],
    "nodes": [],
    "outputs": []
  },
  "roiSet": { "schemaVersion": 1, "rois": [] },
  "bindings": [{
    "input": "surface",
    "valueType": { "id": "purejsimage.scientific.dataset", "version": 1 },
    "identity": {
      "kind": "scientific-dataset",
      "reader": { "id": "purejsimage/gsf", "version": "1.0.0" },
      "datasetId": "surface",
      "resources": [{ "id": "primary", "identity": { "kind": "local-file", "strength": "weak", "stability": "metadata", "nameOrPath": "sample.gsf", "size": 8192, "lastModified": 1722470400000 } }]
    },
    "value": { "kind": "source", "sourceReference": "primary" }
  }],
  "sourceReferences": [{
    "id": "primary",
    "identity": {
      "kind": "scientific-dataset",
      "reader": { "id": "purejsimage/gsf", "version": "1.0.0" },
      "datasetId": "surface",
      "resources": [{ "id": "primary", "identity": { "kind": "local-file", "strength": "weak", "stability": "metadata", "nameOrPath": "sample.gsf", "size": 8192, "lastModified": 1722470400000 } }]
    },
    "locatorHint": { "kind": "local-file", "name": "sample.gsf", "size": 8192 }
  }],
  "providerPolicy": { "mode": "reference-only" },
  "display": { "dataset": "surface", "axes": ["x", "y"] },
  "createdWith": { "packageVersion": "0.10.0", "buildFingerprint": "example-build" },
  "hashes": { "graph": "<64 lowercase hex>", "bindings": "<64 lowercase hex>", "invocation": "<64 lowercase hex>" }
}
```
