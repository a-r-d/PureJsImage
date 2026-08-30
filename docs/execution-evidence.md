# Execution evidence

## Quick Answer

`purejsimage/evidence` records bounded source, pipeline, provider, tile, and managed-memory evidence.
It is opt-in and works in Node.js and modern browsers. Default reports exclude source bytes, pixels,
signed URL queries, request headers, local paths, and file names.

## Create a session

```ts
import { createEvidenceSession, explainImage, instrumentImageSource } from 'purejsimage/evidence'
import { allCodecs } from 'purejsimage/codecs/all'
import { createImageLibrary, MemorySource } from 'purejsimage'

const evidence = createEvidenceSession({ mode: 'trace' })
const images = createImageLibrary(allCodecs)
const source = instrumentImageSource(new MemorySource(inputBytes), evidence.context)
const image = await images.open(source)
const plan = await explainImage(image.resize({ width: 800 }).jpeg())
const output = await image.resize({ width: 800 }).jpeg().toBuffer({
  evidence: evidence.context,
})
const report = evidence.finalize()
```

Use `summary` when counters and merged ranges are enough. Use `trace` when the application needs a
bounded event timeline, child scopes, dependencies, or allocation IDs. Omit the evidence option for
the normal off path.

## What the report means

| Section | Meaning | Measurement |
| --- | --- | --- |
| `logicalReads` | Reads requested from an `ImageSource` | Measured by the source wrapper |
| `physicalTransfers` | Remote response bytes, status classes, first-body-byte and transfer timing, cache behavior, and unique source coverage | Measured by `HttpRangeSource`; unavailable for local memory and files |
| `operations`, `providers`, and `cancellations` | Bounded execution aggregates retained in summary and trace modes | Measured at the instrumented operation boundary |
| pipeline plan | Crop pushdown, scaled decode, remaining stages, precision conversion, and fallback reasons | Computed by the executor planner; working-memory class is estimated |
| `execution` | Decoded and encoded block and pixel counts, plus first-block timing | Measured at portable decoder and encoder block boundaries |
| analysis providers | Operation, semantic version, provider, and build fingerprint | Measured at graph invocation |
| dependencies | Recorded input IDs for one output block or tile | Measured at block or tile granularity |
| `managedMemory` | Buffers and leases explicitly accounted by PureJsImage | Measured inside the declared managed scope |

Managed bytes are not JavaScript heap use, browser memory, `ArrayBuffer` external memory, or process
RSS. Benchmarks record those process values separately.

## Bounds

Sessions cap events, estimated serialized bytes, source ranges, allocation leases, labels,
subscribers, and child scopes. When a detail cap fills, the session increments a dropped counter,
adds one warning, and continues aggregate accounting. Trace storage limits never fail image work.
The finalized `session` section reports dropped events, ranges, allocation details, labels, and
child scopes separately. The bounded `scopes` list keeps retained parent and label relationships.

The default trace caps are 4,096 events, 1 MiB of estimated serialized event data, 2,048 merged
source ranges, 4,096 retained allocation leases, 512 labels, 8 subscribers, and 1,024 child scopes.
Pass smaller or larger positive safe integers through `limits`.

Unique coverage and overfetch are measured while all contributing merged ranges fit. If the range
cap fills, the retained union becomes a conservative partial estimate and the corresponding
`uniqueBytesMeasurement` or `overfetchMeasurement` field changes to `estimated`.

## Privacy

Source names are disabled by default. `includeSourceNames: true` retains only a remote URL's scheme,
host, and path or the last component of a local name. Query strings and fragments are removed.
Authorization headers, cookies, and source metadata values are not recorded.

## HTTP range policies

`HttpRangeSource` keeps its fixed block policy by default. The adaptive policy is explicit:

```ts
const source = await HttpRangeSource.open(url, {
  evidence: evidence.context,
  rangePolicy: {
    kind: 'adaptive',
    maxBlockBytes: 256 * 1024,
    sequentialReadsBeforeGrowth: 2,
  },
})
```

The policy only grows after consecutive adjacent logical reads and never exceeds the cache or caller
limit. Every growth decision appears in trace evidence. It does not prefetch independently, delay a
read, weaken response validation, or share cache data between sources.

The deterministic benchmark currently shows a crossover. Its adaptive sequential case can reduce
local scheduling time, but it may transfer more bytes and did not improve the simulated high-latency
case. Keep fixed policy unless a representative benchmark shows that the extra transfer is useful.

## Raster X-Ray

The browser page at `/xray/` accepts a local file, a remote URL, or its generated safe sample. It
reports detected metadata, the ordinary output plan, logical reads, physical transfers, unique byte
coverage, bounded live timeline updates, cancellation activity, and managed bytes. A running
inspection can be cancelled, and the redacted finalized trace can be exported as JSON. Structural
inspection may read codec metadata but does not decode the full pixel pipeline.

Remote inputs must allow CORS, expose valid byte-range response headers, and return exact `206`
responses. A URL ending in `.zarr`, `zarr.json`, `.zgroup`, or `.zattrs` opens through the OME-Zarr
reader and decodes one preview tile bounded to 128 by 128 samples. Raster X-Ray covers ordinary PNG
and JPEG, TIFF/COG, AVIF and JP2 box formats, and OME-Zarr without duplicating their parsers.
OME-Zarr object and chunk statistics remain available in the OME-Zarr viewer because their units
are format-specific.

## Reproducible benchmark

`npm run bench:evidence` runs six real workflows in off, summary, and trace modes and seven fixed
versus adaptive range workloads. It writes `benchmark/results/execution-evidence.json`. Every mode
must preserve the same output hash, output size, and logical source-read count. The artifact keeps
all three timing samples because short in-process workloads are sensitive to JIT and garbage
collection order. Treat those microtimings as diagnostic measurements, not a release performance
claim.

The current deterministic range matrix shows no request-count reduction from adaptive growth. In
the high-latency, low-throughput case it transferred 229,377 bytes instead of 98,305 bytes and took
about 162.8 ms instead of 97.5 ms. Fixed blocks therefore remain the default. The adaptive option is
available for callers that have measured a better crossover on their own access pattern.

## Unsupported boundaries

- Local files have no physical network-transfer section.
- A dependency set is block or tile provenance, not exact per-pixel provenance.
- Evidence does not inspect arbitrary codec metadata values or source contents.
- In-process timing samples do not replace an isolated before-and-after release benchmark.
- A finalized session cannot be reused or finalized twice.
- Live subscribers receive retained trace events only. Summary mode has no timeline.
