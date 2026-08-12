# Built-in scientific analysis operations

`purejsimage/analysis` provides an explicit, application-owned set of strict TypeScript reference
operations. Importing the entry creates no registry, cache, provider, worker, or global state.
Applications choose a dataset descriptor and tile runtime, then construct the matching bundle:

```ts
import {
  createAnalysisController,
  createBuiltInAnalysisBundle,
  createTileRuntime,
} from 'purejsimage/analysis'

const runtime = createTileRuntime()
const builtIns = createBuiltInAnalysisBundle({ descriptor: dataset.descriptor, runtime })
const controller = createAnalysisController({
  ...builtIns,
  roi: { descriptor: dataset.descriptor },
  library: { version: '0.9.0', buildFingerprint: applicationBuild },
})
```

This is separate from the ordinary image API. Existing `image.resize(...).jpeg(...)` workflows do
not construct an analysis controller and do not import this entry.

## Public operations

Every initial operation has semantic version `1`.

| Operation ID | Input to output | Numeric policy |
| --- | --- | --- |
| `purejsimage.analysis.crop` | dataset to dataset | Preserves sample type, components, units, calibration, and no-data. Linear origins and lookup/label subsets move with the crop. |
| `purejsimage.analysis.resample` | dataset to dataset | Nearest defaults to the input sample type. Bilinear requires Float32 or Float64 and defaults to Float32. Invalid samples either propagate or are ignored with weight renormalization. |
| `purejsimage.analysis.slice` | dataset to dataset | Preserves exact samples while selecting any two labeled axes and fixing every remaining axis. |
| `purejsimage.analysis.projection` | dataset to dataset | Min/max default to preserving the input type. Mean defaults to Float64. Invalid/no-data handling is explicit (`ignore` or `propagate`). |
| `purejsimage.analysis.threshold` | scalar dataset to dataset | Emits one-component Uint8 values with false `0` and true `1`. Invalid/no-data output is explicitly `0` or `1`. |
| `purejsimage.analysis.gaussian-blur` | dataset to dataset | Selects one component and emits Float32. Radius is permanently defined as `ceil(3 * sigma)`. Clamp, mirror, and finite constant boundaries are explicit. |
| `purejsimage.analysis.statistics` | dataset plus optional ROI/ROI set to result collection | Counts, extrema, Welford mean/population deviation, and optional bounded percentiles. Empty selections return NaN or error as requested. |
| `purejsimage.analysis.histogram` | dataset plus optional ROI/ROI set to histogram | Explicit edges/counts/underflow/overflow. Explicit range is one pass; automatic range is a declared cache-aware two-pass reduction. |
| `purejsimage.analysis.line-profile` | dataset plus line/polyline ROI to profile | Bounded nearest or bilinear samples for selected components, with pixel or calibrated physical distance and explicit invalid/no-data error-or-NaN behavior. |

Crop and slice are bit-exact. Threshold is also bit-exact. Resample, projection, statistics,
histogram, and line profile declare operation-level tolerances where floating arithmetic is part of
their versioned semantics. Gaussian blur declares absolute tolerance `1e-5` and relative tolerance
`1e-6`; providers still have to match the exact radius, boundary, invalid-sample, component, and
Float32 output semantics before cost comparison.

## Bounded execution details

Dataset transforms return lazy datasets. A graph execution creates their descriptors but does not
read pixels. Crop and slice push requested regions directly to the underlying source. Projection
visits reduction indices in ascending order while retaining only the output tile, counts, invalid
flags, and Float64 accumulation needed for that tile.

ROI reductions traverse tiles in global row-major order. Statistics use Welford accumulation.
Percentiles are exact when the finite selection fits `percentileMaxSamples`; larger selections use a
bounded deterministic row-major reservoir and record the approximation and sample count in result
metadata. ROI masks exist only for the current tile. Automatic histograms make the mathematically
required range pass explicit, then request the same tiles so the bounded runtime cache can satisfy
the counting pass.

Gaussian blur requests only the output tile plus its clipped halo. It precomputes one normalized
Float64 kernel and integer boundary mappings per request, uses separable bounded typed-array
scratch, retains no full-frame intermediate, and releases its source tile on success, cancellation,
or failure. The planner estimate includes halo input and horizontal scratch storage.

## Data-driven application workflow

`controller.capabilities` is JSON-only and enumerates operations, value types, providers,
migrations, commands, ROI limits, and the trust boundary. `describeOperation()` returns one plain
descriptor and `normalizeOperationParameters()` validates and fills schema defaults without reading
pixels.

Workspace commands operate on immutable revisioned snapshots. A UI, script, trusted extension, or
future agent uses the same sequence: bind typed graph inputs, add nodes, connect named ports, add an
ROI, set named outputs, validate, dry-run, then explicitly execute a prepared plan. A stale
`expectedRevision` returns a structured `stale-revision` issue. Execution can be cancelled by task
ID and records the pinned provider and implementation version in provenance. Graph mutation never
executes a provider.

The complete public-only example is exercised by
[`tests/analysis-builtins-workflow.test.ts`](../tests/analysis-builtins-workflow.test.ts). The
trusted pointwise extension in
[`examples/analysis-trusted-extension/index.ts`](../examples/analysis-trusted-extension/index.ts)
contributes one namespaced descriptor and reference provider through an explicitly constructed
extension host. It makes no acceleration claim and performs no global registration.

## Deliberately deferred

The initial set does not include FFTs, frequency-domain filtering, registration, segmentation,
mutable painting/editing, 3D ROI geometry, brush masks, collaboration, or materials-specific
algorithms such as crystallographic indexing and phase identification. WASM and WebGPU providers
also remain future explicit extensions. Untrusted code requires a future Worker or iframe RPC host;
the current extension registry is trusted in-process code and is not a sandbox.
