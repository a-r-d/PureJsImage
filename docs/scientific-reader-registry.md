# Scientific reader registry

The scientific reader API is explicit by design. Importing `purejsimage`,
`purejsimage/browser`, or `purejsimage/scientific` does not create or mutate a reader registry.
An application selects the trusted readers it needs:

```ts
import { MemorySource } from 'purejsimage'
import {
  createScientificLibrary,
  fitsReader,
  gsfReader,
  mrcReader,
} from 'purejsimage/scientific'

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
are 32 readers, 32 non-empty reads, 65,536 logical bytes total, and 16,384 logical bytes per read.
Reservations happen before I/O. Repeated and overlapping reads count again; zero-length and wholly
out-of-range reads do not. Override these limits through `ScientificOpenContext.probeLimits`.

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

## Migrating from fixed XYZCT datasets

`MultidimensionalRasterDataset` is the deprecated fixed-axis bridge. New application code should
use `ScientificDataset`, whose `schemaVersion: 2` descriptor names every axis and does not assume
that the data can be expressed as XYZCT.

For a legacy reader, wrap explicitly with `toScientificDataset(legacy)`. The adapter maps `sizeX`,
`sizeY`, `sizeZ`, logical channels, and `sizeT` to axis IDs `x`, `y`, `z`, `channel`, and `time`, and
preserves the old descriptor under typed compatibility metadata. Reverse adaptation is available
only through the explicit `toMultidimensionalRasterDataset()` adapter and rejects V2 datasets that
cannot be represented without losing fixed-axis semantics.

Replace a fixed request such as:

```ts
legacy.readPlane({ z: 4, c: 2, t: 0, x: 100, y: 200, width: 256, height: 256 })
```

with a labeled request:

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

See [Migrating to ScientificDataset V2 in 0.10 alpha](migration/0.10-scientific-v2.md) for ordinary
X/Y, OME XYZCT, arbitrary-rank FITS, EELS, and 4D-STEM mappings and the exact reverse-adapter
rejection boundary.
