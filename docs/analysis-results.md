# Quantitative analysis results

`purejsimage/analysis` is the explicit, browser-portable boundary for quantitative result values.
It does not install readers, operations, or providers, and importing the root `purejsimage` package
does not load it. The entry contains result contracts, scientific measurement adapters, graphs,
ROIs, execution, and the caller-owned tile runtime. Persisted project envelopes are specified by
the [Analysis project v1 contract](contracts/analysis-project-v1.md); full typed result payloads are
deliberately not persisted by that JSON format.

## Result shapes

Every result has a stable namespaced value-type ID and is independent of the provider that produced
it:

| Kind | Value type | In-memory payload |
| --- | --- | --- |
| Scalar | `purejsimage.result.scalar` | One number, optional non-negative uncertainty, unit, and explicit NaN policy |
| Histogram | `purejsimage.result.histogram` | `Float64Array` edges, integer-valued typed counts, underflow, overflow, and unit |
| Profile | `purejsimage.result.profile` | One numeric typed axis and one or more equal-length named typed series |
| Table | `purejsimage.result.table` | Equal-length numeric, bit-packed boolean, UTF-8 offset, or dictionary-coded columns |
| Collection | `purejsimage.result.collection` | A small, uniquely named set of other results |

Numeric columns use typed arrays. Boolean values and validity use least-significant-bit-first
`Uint8Array` bitsets. Strings use one `Uint8Array` of valid UTF-8 plus a `Uint32Array` containing
`rowCount + 1` offsets; the final offset must equal the data length. Categories use bounded unique
strings and unsigned typed codes. A validity zero means the corresponding value is absent. A valid
floating value follows its column's `forbid` or `allow` NaN policy; infinities are never accepted.

Validators reject unknown properties, accessors, inconsistent lengths, non-monotonic histogram
edges, bad category codes, invalid UTF-8, non-zero bit padding, non-finite JSON metadata, and values
outside caller-configurable limits. Defaults also cap rows, columns, histogram bins, profile points,
collection breadth/depth and total result count, strings, metadata, categories, and retained bytes.

The validated wrapper objects and descriptor arrays are frozen. JavaScript cannot freeze a
non-empty typed array, so payload buffers remain caller-owned and must be treated as read-only after
validation. These result types do not expose `release()`: this layer neither pools nor borrows
storage. A future producer that borrows buffers must own that lifecycle outside these durable result
values or define an explicit separate resource contract.

## Memory accounting and JSON boundaries

`accountAnalysisResultMemory()` counts each distinct backing `ArrayBuffer` once, using its complete
`byteLength` even when the result holds only a view. It also counts UTF-8 bytes for metadata, names,
units, category labels, and provenance IDs. Therefore:

- numeric/profile storage is the sum of distinct typed-array backing buffers;
- bit-packed value or validity storage is `ceil(rows / 8)` bytes when exactly sized;
- UTF-8 columns retain `4 * (rows + 1) + data.buffer.byteLength` bytes;
- category columns retain their code buffer plus UTF-8 dictionary bytes;
- `retainedBytes = payloadBytes + structuralBytes` under this portable accounting model.

The structural number deliberately excludes engine-specific object/header overhead, which cannot be
measured portably. Object counts are bounded separately. Passing a large subarray does not hide its
larger retained backing store from `maxRetainedBytes`.

Typed payloads are not JSON-safe and are never silently converted to arrays or base64.
`summarizeResult()` instead returns bounded JSON-safe data: schema, units, dimensions, finite/NaN/
invalid ranges, memory accounting, and a capped columnar preview. Full-result persistence and binary
transport are future work and require an explicit format.

```ts
import {
  summarizeResult,
  validateHistogramResult,
} from 'purejsimage/analysis'

const histogram = validateHistogramResult({
  kind: 'histogram',
  valueType: 'purejsimage.result.histogram',
  binEdges: new Float64Array([0, 10, 20]),
  counts: new Uint32Array([41, 9]),
  underflow: 0,
  overflow: 2,
  unit: 'K',
})

const summary = summarizeResult(histogram, { maxPreviewValues: 8 })
JSON.stringify(summary) // bounded metadata, never the typed payload
```

## Scientific measurement adapter

`measureScientificPlane()` and `ScientificPlaneMeasurement` remain available from
`purejsimage/scientific`. Histograms now also expose their explicit `counts.length + 1` bin edges.
Their existing semantics are:

- the range is inclusive at both ends, with a value equal to the maximum placed in the last bin;
- underflow and overflow count finite, non-no-data values outside the histogram range;
- invalid samples include NaN, infinities, and the configured no-data value;
- standard deviation is the population deviation produced by Welford's algorithm;
- percentiles use the existing bounded deterministic sample and remain approximate when
  `sampledValues < finiteSamples`.

`measureScientificPlaneWithResults()` returns the scientific measurement and a generic
`ResultCollection` from the same measurement execution. Statistics and a histogram share their
value pass; resolving a dataset-derived range can require an earlier range pass. Histogram count and
edge arrays are reused rather than copied. `scientificPlaneMeasurementToResult()` adapts an already
computed measurement without reading the dataset. Units come from the selected scientific
component unless explicitly overridden. Abort signals and `NumericTile.release()` propagation stay
in the existing measurement path.

## Explicit value-type registration

`createAnalysisResultValueTypeRegistry()` constructs a new local registry on every call. Its JSON
capability snapshot contains result schemas, never result payloads. There is no global singleton or
import-time registration. Applications can compose the exported built-ins with a namespaced trusted
extension explicitly:

```ts
import { analysisResultValueTypeDefinitions } from 'purejsimage/analysis'
import {
  createValueTypeDefinition,
  createValueTypeRegistry,
} from 'purejsimage/operations'

const maskArea = createValueTypeDefinition({
  descriptor: {
    id: 'example.result.mask-area',
    version: 1,
    title: 'Mask area result',
  },
})

const valueTypes = createValueTypeRegistry([
  ...analysisResultValueTypeDefinitions,
  maskArea,
])
```

Extensions cannot replace a built-in result ID. Result values contain semantics and optional source
provenance references, but never a chosen execution provider. Provider selection and execution
provenance remain separate concerns.
