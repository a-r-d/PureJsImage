# Building scientific applications with PureJsImage

PureJsImage's application platform is an explicit opt-in layer above the ordinary image pipeline.
Importing `purejsimage/analysis`, `purejsimage/operations`, or `purejsimage/extensions` does not
create a registry, cache, Worker, or network request. Existing `resize().jpeg()` applications keep
using the root or browser entry without loading these application APIs.

This is an **unreleased main-branch alpha preview**. The current npm 0.9.x release does not contain
these application entrypoints. The preview's external boundary is the package tarball packed from
this branch: applications and examples must not import `src/`, private `dist/` files, or a workspace
alias. The checked fixture at
[`test-fixtures/packed-package-consumer`](../test-fixtures/packed-package-consumer) installs that
packed tarball, compiles the examples below, and bundles both browser and Worker entry points.

## Open through an explicit reader registry

Applications choose their trusted readers and own the resulting library:

```ts
import { MemorySource } from 'purejsimage'
import { createScientificLibrary } from 'purejsimage/scientific'
import { fitsReader } from 'purejsimage/scientific/readers/fits'
import { gsfReader } from 'purejsimage/scientific/readers/gsf'
import { mrcReader } from 'purejsimage/scientific/readers/mrc'

const science = createScientificLibrary({ readers: [fitsReader, gsfReader, mrcReader] })
const document = await science.open({
  primary: { id: 'upload', name: file.name, source: new MemorySource(await file.bytes()) },
  signal,
})
const summary = document.datasets[0]
if (summary === undefined) throw new Error('The document contains no datasets')
const dataset = await document.openDataset(summary.id, { signal })

console.log(science.capabilities, summary.descriptor.axes)
```

Browser companion files use `createScientificFileContext()` from
`purejsimage/scientific/browser`. Node path convenience uses
`createScientificPathContext()` from `purejsimage/scientific/node`. Remote range inputs use the
separate browser-portable `purejsimage/sources/http-range` entry.

## Read any labeled-axis plane

A plane selects one ordered display-axis pair declared by
`dataset.descriptor.capabilities.planeReads` and fixes every other non-singleton axis. Numeric
computation uses native-endian tiles; display mapping remains a later, explicit step:

```ts
import { resolveNumericTileSource } from 'purejsimage/scientific'

const tiles = resolveNumericTileSource(dataset).readNumericTiles({
  displayAxes: ['kx', 'ky'],
  fixedIndices: [
    { axisId: 'scanX', index: 12 },
    { axisId: 'scanY', index: 8 },
  ],
  resolutionLevel: 0,
  x: 0,
  y: 0,
  width: 256,
  height: 256,
  signal,
})

for await (const tile of tiles) {
  try {
    computeWithNativeSamples(tile.data)
  } finally {
    tile.release()
  }
}
```

Use one application-owned `TileRuntime` for repeated reads. Its byte budget, concurrency,
cancellation, invalidation, and source/derived cache metrics are explicit; it never materializes a
whole dataset implicitly. Reader-backed source keys use the complete dataset/resource identity;
weak evidence is session-scoped and synthetic datasets are instance-scoped. Derived keys include
source, operation/version, normalized parameters, output, provider/implementation, and generation.

## Select and analyze a whole-slide level

Register `aperioSvsReader` explicitly from
`purejsimage/scientific/readers/aperio-svs`. Its document exposes `pyramid` plus separate
`associated/label`, `associated/macro`, `associated/thumbnail`, or other stable associated-image
IDs. The pyramid declares decoded uint8 RGB components and per-level X/Y calibration. Local and
HTTP Range-backed sources use the same bounded region contract.

The default reader uses explicit WSI-appropriate limits rather than ordinary image-file defaults.
Applications can call `createAperioSvsReader({ limits })` to bound source bytes, dimensions,
directories, region pixels, decoded region bytes, and associated-image pixels for their deployment.
Large reported source sizes and full-slide dimensions remain lazy; every requested region is
validated before TIFF decoder creation. Pyramid metadata records ICC presence, tag, and byte length
without fetching or base64-encoding the profile payload during enumeration; supported TIFF pixel
decode still applies ICC color management.

Select one pyramid level with `purejsimage.analysis.select-resolution-level@1` before adding later
operations. The output is a calibrated, single-level `ScientificDataset`; crop, threshold, blur,
ROI, and measurement nodes then need no separate resolution parameter. The selected level remains
part of derived identity and provenance.

## Measure an ROI through a graph

Built-in operations are installed as one explicit bundle calibrated to the selected descriptor:

```ts
import {
  analysisStatisticsOperationId,
  createAnalysisController,
  createBuiltInAnalysisBundle,
  normalizeRoi,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
  validateAnalysisProjectV1,
} from 'purejsimage/analysis'
import type { AnalysisGraph } from 'purejsimage/analysis'
import { createTileRuntime } from 'purejsimage/analysis/runtime'
import { roiValueTypeId } from 'purejsimage/analysis/roi'

const runtime = createTileRuntime({
  limits: {
    maxCacheBytes: 64 * 1024 * 1024,
    maxTileBytes: 16 * 1024 * 1024,
    maxInFlightBytes: 64 * 1024 * 1024,
    maxLeasedBytes: 64 * 1024 * 1024,
    maxOperationWorkingBytes: 64 * 1024 * 1024,
    maxTotalManagedBytes: 128 * 1024 * 1024,
  },
})
const bundle = createBuiltInAnalysisBundle({ descriptor: dataset.descriptor, runtime })
const controller = createAnalysisController({
  ...bundle,
  roi: { descriptor: dataset.descriptor },
  library: { version: applicationVersion, buildFingerprint },
})
const fixedIndices = [
  { axisId: 'scanX', index: 12 },
  { axisId: 'scanY', index: 8 },
]
const roi = normalizeRoi({
  schemaVersion: 1,
  id: 'selection',
  axisIds: ['kx', 'ky'],
  fixedIndices,
  coordinateSpace: 'pixel',
  geometry: { kind: 'rectangle', x: 20, y: 20, width: 80, height: 60 },
}, dataset.descriptor)

const graph: AnalysisGraph = {
  schemaVersion: 1,
  inputs: [
    { name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
    { name: 'selection', valueType: { id: roiValueTypeId, version: 1 } },
  ],
  nodes: [{
    id: 'statistics',
    operation: { id: analysisStatisticsOperationId, version: 1 },
    inputs: [
      { port: 'dataset', source: { kind: 'input', input: 'source' } },
      { port: 'roi', source: { kind: 'input', input: 'selection' } },
    ],
    parameters: {
      displayAxes: ['kx', 'ky'], fixedIndices, component: 0,
      percentiles: [5, 50, 95], percentileMaxSamples: 100_000, emptyPolicy: 'error',
    },
  }],
  outputs: [{
    name: 'statistics',
    source: { kind: 'node', nodeId: 'statistics', output: 'statistics' },
  }],
}

const bindings = {
  source: { value: dataset, characteristics: scientificDatasetCharacteristics(dataset) },
  selection: { value: roi },
}
```

Datasets opened by a registered first-party reader already carry their structured reader, dataset,
and resource identity, so the planner derives the source binding identity automatically. Only a
synthetic or application-created `ScientificDataset` needs an explicit `identity` field.

Validate and dry-run before execution. Pin the permanent TypeScript reference provider when the
reproducibility policy requires that exact provider:

```ts
const policy = {
  mode: 'pinned' as const,
  providerId: 'purejsimage.analysis.reference',
  providerVersion: 1,
}
const dryRun = await controller.dryRun(graph, { bindings, policy, signal })
if (!dryRun.valid) throw new Error(JSON.stringify(dryRun.issues))
const plan = await controller.planGraph(graph, { bindings, policy, signal })
const execution = await controller.executeGraph(plan).result
try {
  console.log(execution.outputs.get('statistics'), execution.provenance)
} finally {
  await execution.release()
  await plan.dispose()
  runtime.clear()
}
```

## Save, validate, and replay

Use the normative [Analysis project v1 envelope](contracts/analysis-project-v1.md) for graph and ROI
state, exact operation versions, source identity/rebinding, provider policy, hashes, and optional
display state. It deliberately excludes source bytes, executable providers, and large typed result
payloads. Canonical graph JSON is suitable for hashing and comparison; it does not silently
validate or migrate:

```ts
const project = {
  schemaVersion: 1,
  graph: workspace.graph,
  roiSet: workspace.roiSet,
  bindings: persistedBindings,
  sourceReferences: persistedSources,
  providerPolicy: policy,
  display: currentDisplayState,
  createdWith: { packageVersion, buildFingerprint },
  hashes: invocationHashes,
}

const parsed: unknown = JSON.parse(savedText)
const validation = await validateAnalysisProjectV1(parsed, {
  operations: bundle.operations,
  valueTypes: bundle.valueTypes,
  roi: { descriptor: dataset.descriptor },
})
if (!validation.valid || validation.project === undefined) {
  showIssues(validation.issues)
} else {
  // Rebind source locators separately, then dry-run and plan explicitly.
  await controller.dryRun(validation.project.graph, { bindings, policy, signal })
}
```

Applications still own source pickers, display-state keys, and storage location, but not a competing
project envelope. Graph and project migrations are explicit registered steps; loading never
silently rewrites operation semantics or accepts stale hashes.

## Commands and capability inspection

The same JSON command path serves UI actions, scripts, trusted plugins, and a future agent. Treat
pasted or received JSON as `unknown`; validate before applying, and execute separately:

```ts
const capabilities = controller.capabilities
const validation = controller.validateCommand(commandJson)
const preview = validation.valid ? controller.applyCommand(workspace, commandJson) : undefined

if (preview?.applied) {
  workspace = preview.snapshot
} else {
  showIssues(validation.issues)
}
```

Commands use immutable workspace revisions and return structured issues, including stale-revision
conflicts. They contain no code strings, DOM access, `eval`, or AI-only privileged fields.

## Trusted custom operations

Custom operations keep their JSON-safe descriptor and parameter schema separate from executable
provider code. Compose the operation through a caller-owned extension host:

```ts
import { createExtensionHost } from 'purejsimage/extensions'
import { createAnalysisController } from 'purejsimage/analysis'
import { createOperationDefinition, createOperationProvider } from 'purejsimage/operations'

const operation = createOperationDefinition({ descriptor, inferOutputShapes })
const provider = createOperationProvider({ descriptor: providerDescriptor, prepare })
const host = createExtensionHost({
  extensions: [{
    descriptor: { id: 'acme.materials', version: 1, apiVersion: 1 },
    operations: [operation],
    providers: [provider],
  }],
})
const extensionController = createAnalysisController({
  operations: host.operations,
  valueTypes: host.valueTypes,
  providers: host.providers,
  migrations: host.analysisMigrations,
  library,
})
```

The normal application workflow is exported from `purejsimage/analysis`. Full result schemas,
geometry/sampling utilities, provider-facing tile runtime contracts, and project/migration helpers
live at `purejsimage/analysis/results`, `/roi`, `/runtime`, and `/project` respectively. Importing any
entry creates no timer, worker, registry, provider, fetch, or global state.

Threshold and Gaussian blur materialize lazy tiles through the exact provider selected during graph
planning. Crop and slice remain coordinate views; resample remains the next neighborhood-kernel
migration; projection remains the first dataset-reducer migration; statistics, histogram, and line
profile remain result reducers. Reducer scratch uses lexical working-memory scopes whose accounting
the runtime releases internally.

`purejsimage.analysis.connected-components@1` is the first globally prepared transform. It scans a
selected plane in deterministic row-major tiles, reconciles 4- or 8-connected boundaries, and
returns both a lazy uint32 label dataset and a bounded columnar object table. Measurements include
pixel count/area, bounds, centroid, equivalent circular diameter, moment axes, aspect, and
orientation; compatible linear calibration adds physical measurements with anisotropic spacing.
The implementation retains typed component state and per-tile label mappings, not a complete input,
mask, or label plane. Planning uses the existing provider and graph barrier, and capacity exhaustion
fails with `LIMIT_EXCEEDED` under the runtime's operation-working budget.

The memory plan explicitly bounds scan and finalization peaks, including per-tile sentinels,
union-find/moment state, boundaries, roots, mappings, and every object-table backing array. Label
values, row-major ordering, counts, and integer bounds are exact; floating shape and calibrated
measurements use the operation's `1e-12` absolute/relative tolerance. Physical centroids use the
same pixel-center conversion as ROIs, including anisotropic and negative axis steps. A downstream
lazy dataset keeps consumed dataset dependencies and their managed-byte accounting alive until the
execution result is released.

The extension descriptor owns its namespace. For `acme.materials`, reader IDs begin with
`acme.materials/`; value-type, operation, provider, and migration IDs begin with
`acme.materials.`. Operation migrations may only target operations in that same namespace.

The complete pointwise reference example is
[`examples/analysis-trusted-extension/index.ts`](../examples/analysis-trusted-extension/index.ts).
These extensions are trusted in-process code, not a sandbox. Untrusted execution requires the
future permissioned Worker or iframe RPC boundary.

## Worker architecture

A browser application can keep Canvas and serializable UI state on the main thread while a module
Worker owns readers, graph/controller instances, the tile runtime, and execution. Use a versioned
discriminated protocol, task IDs, `AbortSignal`, structured issues/errors, and transferable tile
buffers. Worker placement is application policy; PureJsImage deliberately does not create a Worker,
global cache, registry, or network request at import time.
