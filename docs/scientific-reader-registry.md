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

## Ordinary image codec fallbacks

PNG, JPEG, WebP, BMP, and JP2 are available as individually composable scientific reader fallbacks:

```ts
import { createScientificLibrary } from 'purejsimage/scientific'
import { jpegReader } from 'purejsimage/scientific/readers/jpeg'
import { pngReader } from 'purejsimage/scientific/readers/png'
import { webpReader } from 'purejsimage/scientific/readers/webp'
import { bmpReader } from 'purejsimage/scientific/readers/bmp'
import { jp2Reader } from 'purejsimage/scientific/readers/jp2'

const science = createScientificLibrary({
  readers: [pngReader, jpegReader, webpReader, bmpReader, jp2Reader],
})
```

The base scientific entry also exports `createImageCodecScientificReader({ descriptor, codec,
limits })` for applications that deliberately adapt another registered codec. The adapter exposes
`gray8`, `rgb8`, and `rgba8` pixels as canonical uint8 raster blocks without copying their backing
data. Selectable frames become separate `frame-N` datasets; selectable resolution levels remain
levels within each frame dataset. A codec's metadata-only frame count and decode-time scaling
shortcuts do not create selectable scientific coordinates.
Experimental HEIC is intentionally not exposed through this fallback set.

## AFM and surface formats

The Milestone F readers are explicit imports and are also re-exported by the optional all-readers
entry:

```ts
import { digitalSurfReader } from 'purejsimage/scientific/readers/digital-surf'
import { igorBinaryWaveReader } from 'purejsimage/scientific/readers/igor-binary-wave'
import { nanonisSxmReader } from 'purejsimage/scientific/readers/nanonis-sxm'
import { x3pReader } from 'purejsimage/scientific/readers/x3p'

const science = createScientificLibrary({
  readers: [nanonisSxmReader, igorBinaryWaveReader, digitalSurfReader, x3pReader],
})
```

SXM exposes each recorded channel and direction separately and preserves top-to-bottom file-row
order with a negative Y coordinate step. IBW accepts numeric version-5 waves with two through four
dimensions. Digital Surf accepts the bounded integer surface/profile subset and converts values to
float64 with the declared scale and offset. X3P accepts one-layer ISO 5436-2 surface matrices through
the shared bounded ZIP/ZIP64 layer. The exact exclusions are documented in
[`scientific-surface-formats.md`](scientific-surface-formats.md).

## Interchange and detector formats

Milestone H adds explicit entries for RPL/RAW, EMSA/MAS, NRRD, MetaImage, NIfTI, NPY, NanoMegas
BLO, Merlin MIB, and ANG/CTF orientation maps. They are re-exported only by the optional
`purejsimage/scientific/readers/all` entry. The exact numeric, compression, companion, grid, and
unsupported-variant boundaries are documented in
[`scientific-interchange-formats.md`](scientific-interchange-formats.md).

Codec adapters probe at fallback confidence so a specialized scientific reader with the same file
signature wins. They preserve source identity, `AbortSignal`, and caller-owned block release.
Importing the PNG or JPEG reader is explicit; neither is linked by `purejsimage/scientific`, and
experimental HEIC is not included in the all-readers entry.

## Ordinary TIFF native rasters

Ordinary TIFF is available through a dedicated reader rather than the uint8 codec adapter:

```ts
import { createScientificLibrary } from 'purejsimage/scientific'
import { omeTiffReader } from 'purejsimage/scientific/readers/ome-tiff'
import { tiffReader } from 'purejsimage/scientific/readers/tiff'

const science = createScientificLibrary({ readers: [tiffReader, omeTiffReader] })
```

The generic TIFF probe has lower confidence than OME-TIFF and Aperio SVS. The reader forwards
native signed, floating-point, planar, and interleaved N-channel blocks from
`TiffDirectory.createRasterDecoder()`. It groups only contiguous top-level pages with identical
native format and pyramid geometry, labels those coordinates as `page`, and keeps incompatible
series as separate datasets. It does not infer Z or time from page order. Direct SubIFDs are
resolution levels. Standard optional tags and selected DigitalMicrograph, FEI, and Zeiss private
tags are normalized under aggregate and per-tag byte limits; oversized or malformed optional tags
do not prevent pixel opening.

GeoTIFF georeferencing is part of the ordinary reader's scientific descriptor rather than a
microscopy calibration profile. The base raster uses `descriptor.spatialReference`; each SubIFD
level may carry its own transform, with missing overview transforms derived from the base raster
geometry. The six affine values map raster `(x, y)` to model coordinates as
`(a*x + b*y + c, d*x + e*y + f)`:

```ts
const summary = document.datasets[0]
if (summary === undefined) throw new Error('GeoTIFF contains no scientific datasets')
const dataset = await document.openDataset(summary.id)
const spatial = dataset.descriptor.spatialReference
if (spatial?.pixelToModel) {
  const [a, b, c, d, e, f] = spatial.pixelToModel
  const model = { x: a * 100 + b * 200 + c, y: d * 100 + e * 200 + f }
  console.log(spatial.crs, model, spatial.bounds, spatial.noData)
}

// Regions are still raster pixel coordinates, not CRS/model coordinates.
dataset.readPlane({ displayAxes: ['x', 'y'], fixedIndices: [], x: 100, y: 200, width: 256, height: 256 })
```

## OME-Zarr / NGFF

OME-Zarr 0.5 is a separate cloud-native reader, not an HDF5 side effect:

```ts
import { createScientificLibrary } from 'purejsimage/scientific'
import { omeZarrReader } from 'purejsimage/scientific/readers/ome-zarr'

const science = createScientificLibrary({ readers: [omeZarrReader] })
```

The primary resource is the store-root `zarr.json` for v3 or `.zgroup` / `.zattrs` for v2. Child
metadata and chunks resolve by normalized relative name through the existing companion resolver.
A ZIP archive with that root metadata, or a single nested `*.zarr/` prefix, is accepted as a
single-file store (`.ozx`, `.zip`, and `.zarr` names are probe hints; `__MACOSX/` sidecars are
ignored). Image `multiscales` from NGFF 0.4 and 0.5 become scientific resolution levels.
Sibling `labels/` groups, plate/well fields, and `bioformats2raw.layout` series become additional
datasets. The reader fetches only intersecting chunks, including Blosc 1 LZ4/zlib/zstd payloads
with byte shuffle or 8-element-aligned bitshuffle, and rejects BloscLZ, Snappy, malformed bitshuffle,
tables, multi-root ZIPs, and writers. The exact
codec and store boundary is documented in [`scientific-ome-zarr.md`](scientific-ome-zarr.md).

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

A native one-dimensional spectrum or profile keeps only its real axis, advertises
`planeReads: { kind: 'none' }` plus `seriesReads`, and yields bounded canonical big-endian
`ScientificSeriesBlock` segments through `readSeries()`. Each request selects one axis, fixes every
other non-singleton axis, and may select a bounded `start` and `length`. Existing plane readers can
opt into the explicit `readScientificSeriesFromPlane()` row/column adapter when that is their native
storage boundary; applications must not add a fake singleton display axis.

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
