# Scientific reader registry

The scientific reader API is explicit by design. Importing `purejsimage`,
`purejsimage/browser`, or `purejsimage/scientific` does not create or mutate a reader registry.
An application selects the trusted readers it needs:

```ts
import { MemorySource } from 'purejsimage'
import { createScientificLibrary } from 'purejsimage/scientific'
import { fitsReader } from 'purejsimage/scientific/readers/fits'
import { gsfReader } from 'purejsimage/scientific/readers/gsf'
import { mrcReader } from 'purejsimage/scientific/readers/mrc'

const science = createScientificLibrary({ readers: [fitsReader, gsfReader, mrcReader] })
const document = await science.open({
  primary: { id: 'upload-1', name: 'surface.gsf', source: new MemorySource(bytes) },
  signal,
})

for (const summary of document.datasets) {
  console.log(summary.id, summary.descriptor.axes)
}
const dataset = await document.openDataset(document.datasets[0]!.id, { signal })
```

`capabilities()` returns only frozen JSON-safe reader descriptors and resource patterns. It contains
no executable reader functions and is suitable for application menus or machine-readable capability
inspection.

## Detection and budgets

Readers are probed in registration order. One unique highest confidence wins; equal nonzero top
scores are ambiguous, and all-zero results mean no match. Extensions and media types are hints only:
the first-party readers never allow a name to override contradictory bytes. Supplying both
`readerId` and, when needed, `readerVersion` bypasses probing.

One detection shares a ledger across every reader and every primary or companion resource. Defaults
are 32 readers, 32 non-empty reads, 32 companion resolutions, 65,536 logical bytes total, and
16,384 logical bytes per read. Reservations happen before I/O, and a source must return exactly the
admitted byte count. Repeated and overlapping reads count again; zero-length and wholly out-of-range
reads do not. Override these limits through `ScientificOpenContext.probeLimits`.

## Multi-resource formats

Portable readers ask a `ScientificCompanionResolver` for a normalized relative name or semantic
role. They do not import filesystem APIs or infer unrestricted paths. ENVI accepts either its header
or named data file as the primary resource and resolves the other through this interface.

Node applications can import `createScientificPathContext` from `purejsimage/scientific/node`.
Browser applications can import `createScientificFileContext` or
`createScientificFileCompanionResolver` from `purejsimage/scientific/browser`. Duplicate browser
relative names and ambiguous Node companion candidates fail explicitly.

Readers are trusted in-process code. The registry is an extension composition point, not a sandbox;
untrusted extensions require the future Worker or iframe RPC boundary described in the application
platform architecture.

## Labeled-axis reads

`ScientificDataset` is the sole public scientific dataset contract. Its `schemaVersion: 1`
descriptor names every axis and does not assume that data can be expressed as XYZCT. Read a plane
with stable axis IDs:

```ts
dataset.readPlane({
  displayAxes: ['x', 'y'],
  fixedIndices: [
    { axisId: 'z', index: 4 },
    { axisId: 'channel', index: 2 },
    { axisId: 'time', index: 0 },
  ],
  x: 100,
  y: 200,
  width: 256,
  height: 256,
})
```

Do not infer meaning from array position in new code. Select axes by stable ID, preserve their
`kind`, units, calibration/lookup/labels, components, level geometry, sample type, no-data value,
and typed metadata, and require one fixed index for every non-displayed non-singleton axis.

Physical coordinates and `unit` remain the normalized numeric calibration. An axis may also expose
`calibration` with a `kind`, contributing `resourceId`, stable machine-readable `locator`, and an
optional derivation formula or note. Applications can therefore label an axis as source-calibrated,
derived, or uncalibrated without parsing format-specific metadata. Absence of `calibration` means
the reader did not supply provenance; it does not authorize an application to infer one.

```ts
const axis = dataset.descriptor.axes.find(({ id }) => id === 'x')!
const status = axis.calibration === undefined
  ? 'uncalibrated'
  : axis.calibration.kind === 'derived'
    ? 'derived'
    : 'source'
console.log(status, axis.coordinates, axis.unit, axis.calibration?.locator)
```

Reader-opened datasets also carry a `ScientificDatasetIdentity` containing the reader ID/version,
stable dataset ID, and every resource identity. The planner recognizes it automatically. Synthetic
or application-created datasets still require an explicit semantic identity.

See [ScientificDataset in 0.10](migration/0.10-scientific.md) for ordinary
X/Y, OME axes, arbitrary-rank FITS, EELS, and 4D-STEM mappings.
