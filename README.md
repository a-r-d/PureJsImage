<div align="center">
<pre>
██████╗ ██╗   ██╗██████╗ ███████╗         ██╗███████╗
██╔══██╗██║   ██║██╔══██╗██╔════╝         ██║██╔════╝
██████╔╝██║   ██║██████╔╝█████╗           ██║███████╗
██╔═══╝ ██║   ██║██╔══██╗██╔══╝      ██   ██║╚════██║
██║     ╚██████╔╝██║  ██║███████╗     ╚█████╔╝███████║
╚═╝      ╚═════╝ ╚═╝  ╚═╝╚══════╝      ╚════╝ ╚══════╝
                         I M A G E
</pre>

<h3>First-party image codecs and low-memory raster processing in strict TypeScript</h3>

<p>Portable reference engine · optional first-party acceleration · zero runtime dependencies</p>

<p>
  <a href="https://www.npmjs.com/package/purejsimage"><img alt="npm version" src="https://img.shields.io/npm/v/purejsimage?style=for-the-badge&amp;logo=npm&amp;logoColor=white&amp;color=cb3837"></a>
  <a href="https://github.com/a-r-d/PureJsImage/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/a-r-d/PureJsImage/ci.yml?branch=main&amp;style=for-the-badge&amp;logo=githubactions&amp;logoColor=white&amp;label=CI"></a>
  <a href="https://github.com/a-r-d/PureJsImage/blob/main/package.json"><img alt="TypeScript version" src="https://img.shields.io/github/package-json/dependency-version/a-r-d/PureJsImage/dev/typescript?style=for-the-badge&amp;logo=typescript&amp;logoColor=white"></a>
  <a href="https://www.npmjs.com/package/purejsimage"><img alt="Node.js version" src="https://img.shields.io/node/v/purejsimage?style=for-the-badge&amp;logo=nodedotjs&amp;logoColor=white"></a>
</p>

<p>
  <a href="https://github.com/a-r-d/PureJsImage/blob/main/package.json"><img alt="Zero runtime dependencies" src="https://img.shields.io/badge/runtime_dependencies-0-2ea44f?style=for-the-badge"></a>
  <a href="https://github.com/a-r-d/PureJsImage/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/purejsimage?style=for-the-badge&amp;color=blue"></a>
  <a href="https://github.com/a-r-d/PureJsImage"><img alt="Strict TypeScript reference engine" src="https://img.shields.io/badge/reference-strict_TypeScript-3178c6?style=for-the-badge&amp;logo=typescript&amp;logoColor=white"></a>
</p>

<p>
  <a href="https://purejsimage.com/">Documentation</a> ·
  <a href="https://purejsimage.com/demo/"><strong>Live browser demo</strong></a> ·
  <a href="https://purejsimage.com/wsi/"><strong>Whole-slide demo</strong></a> ·
  <a href="https://purejsimage.com/scientific/"><strong>Scientific explorer</strong></a> ·
  <a href="#install">Install</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#supported-codecs">Codecs</a> ·
  <a href="ROADMAP.md">Roadmap</a> ·
  <a href="#benchmarks">Benchmarks</a>
</p>
</div>

PureJsImage is building a broad suite of first-party image codecs in strict
TypeScript. Each codec grows from a checked capability contract and conformance
corpus toward broader decode coverage, practical encoding, bounded-memory
execution, and optional first-party acceleration.

A shared lazy image and raster pipeline makes those codecs useful across two
workload families:

- **Application images:** inspect, orient, crop, resize, and transcode common
  formats.
- **Large and native rasters:** GSF surfaces, ENVI hyperspectral cubes and classification maps, FITS
  and MRC volumes, CBF detector frames, TIFF, OME-TIFF, GeoTIFF/COG, whole-slide images, remote
  regions, and N-channel numeric data.

The same source, codec, and pipeline architecture targets Node.js, modern
browsers, serverless, edge, and restricted deployments. It is not a canvas,
drawing, or graphics-effects toolkit.

The strict TypeScript reference engine is the permanent portable path. Optional
first-party JPEG and PNG WASM accelerators preserve its public behavior and are
explicitly registered; they do not replace it. Memory behavior remains codec-
and operation-specific: bounded rows or tiles are used where implemented, and
full-frame or larger-state fallbacks are documented.

## Install

```sh
npm install purejsimage
```

PureJsImage requires Node.js 22 or newer. Browser applications use the
`purejsimage/browser` entry. Installing it adds no runtime dependencies, native
addons, or external programs. Optional first-party JPEG and PNG WASM accelerators
use separate explicit entries.

**Pre-1.0:** Codec behavior is heavily tested, but public APIs may receive breaking
refinements before 1.0.

[Read the installation and browser guide →](https://purejsimage.com/guides/)

## Quick start

### Common image pipeline

Register only the codecs the application needs, then build a processing pipeline:

```ts
import { createImageLibrary } from 'purejsimage'
import { jpegCodec } from 'purejsimage/codecs/jpeg'
import { pngCodec } from 'purejsimage/codecs/png'

// Optional first-party WASM accelerators:
import { wasmJpegAccelerator } from 'purejsimage/accelerators/wasm/jpeg'
import { wasmPngAccelerator } from 'purejsimage/accelerators/wasm/png'

const images = createImageLibrary({
  codecs: [jpegCodec, pngCodec],
  accelerators: [wasmJpegAccelerator, wasmPngAccelerator], // Optional
})
const image = await images.open('input.jpg')

await image
  .autoOrient()
  .resize({ width: 1200, withoutEnlargement: true })
  .jpeg({ quality: 80, background: '#ffffff' })
  .toFile('output.jpg')
```

In a browser, import from `purejsimage/browser` and use `toBlob()` or
`toUint8Array()` for output. Tools that need every default codec can register
`allCodecs` from `purejsimage/codecs/all`.

> **Alpha application platform:** PureJsImage 0.10.0 introduces the scientific application
> entrypoints documented below. Provider and extension APIs remain experimental. The ordinary
> codec pipeline above remains the established npm workflow.

> **Built with PureJsImage:** [PureJsImage Lab](https://lab.purejsimage.com/) is the first
> application built on the scientific platform—an in-progress, browser-native electron microscopy
> file analysis workbench.

### Scientific OME-TIFF

Register the OME-TIFF reader explicitly and open the numeric dataset without routing it through the
ordinary display-image codec pipeline:

```ts
import { FileSource } from 'purejsimage'
import { createScientificLibrary } from 'purejsimage/scientific'
import { omeTiffReader } from 'purejsimage/scientific/readers/ome-tiff'

const science = createScientificLibrary({ readers: [omeTiffReader] })
const document = await science.open({
  primary: {
    id: 'input',
    name: 'input.ome.tif',
    source: await FileSource.open('input.ome.tif'),
  },
})

const first = document.datasets[0]
if (first === undefined) throw new Error('OME-TIFF contains no datasets')
const dataset = await document.openDataset(first.id)
```

Ordinary PNG, JPEG, WebP, BMP, and JP2 files can use the same registry through explicit fallback readers without
linking codecs into the base scientific entry:

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

These readers expose exact codec-produced uint8 blocks and remain lower-confidence than specialized
scientific readers.
Experimental HEIC remains excluded from ordinary scientific fallback registration.

Ordinary scientific TIFF uses its own native-precision reader rather than that uint8 adapter:

```ts
import { tiffReader } from 'purejsimage/scientific/readers/tiff'

const science = createScientificLibrary({ readers: [tiffReader, omeTiffReader] })
```

`tiffReader` preserves signed, floating-point, planar, and N-channel samples. Compatible top-level
pages become a labeled `page` axis, incompatible contiguous series remain separate datasets, and
SubIFDs remain resolution levels. Its fallback probe stays below OME-TIFF and Aperio SVS.

FEI/Thermo TIA SER files use an explicit native-precision reader:

```ts
import { tiaSerReader } from 'purejsimage/scientific/readers/tia-ser'

const science = createScientificLibrary({ readers: [tiaSerReader] })
```

The reader opens v528 and v544 scalar spectra, spectrum images, and image series lazily. Direct SER
opening exposes only facts present in the SER file; companion EMI metadata is not inferred.

Open a TIA EMI document through its own reader when the numbered SER companions are available:

```ts
import { tiaEmiReader } from 'purejsimage/scientific/readers/tia-emi'
import { createScientificPathContext } from 'purejsimage/scientific/node'

const document = await tiaEmiReader.open(await createScientificPathContext('capture.emi'))
```

The EMI path exposes every consecutive `capture_1.ser`, `capture_2.ser`, and later companion as
datasets, adds bounded acquisition metadata, and includes the EMI plus the contributing SER in each
dataset identity. SER coordinates remain authoritative; strongly corroborated diffraction axes gain
reciprocal-space units, while contradictory mode hints are retained as metadata conflicts.

NCEM and FEI/Thermo Velox EMD files share an extension but use separate, hierarchy-probed readers:

```ts
import { ncemEmdReader } from 'purejsimage/scientific/readers/ncem-emd'
import { veloxEmdReader } from 'purejsimage/scientific/readers/velox-emd'

const science = createScientificLibrary({ readers: [ncemEmdReader, veloxEmdReader] })
```

The NCEM reader covers fixture-proven openNCEM 0.2 numeric groups. The Velox reader covers numeric
image, diffraction, dense-map, DPC, and complex FFT arrays with explicit frames and bounded JSON
metadata. It preserves positive-half, uncentered FFT storage instead of modifying samples. Sparse
Velox spectrum streams remain outside the current capability boundary.

### Scientific rasters and explicit display mapping

Scientific readers are separate from photographic codecs. The dataset remains numeric until an
application requests display pixels:

```ts
import { createScientificLibrary, renderScientificPlane } from 'purejsimage/scientific'
import { createScientificPathContext } from 'purejsimage/scientific/node'
import { fitsReader } from 'purejsimage/scientific/readers/fits'

const science = createScientificLibrary({ readers: [fitsReader] })
const fits = await science.open(await createScientificPathContext('observation.fits'))
const dataset = await fits.openDataset(fits.datasets[0].id)
const display = await renderScientificPlane(dataset, {
  plane: { displayAxes: ['x', 'y'], fixedIndices: [{ axisId: 'axis-3', index: 0 }] },
  range: { mode: 'percentile', low: 1, high: 99 },
  palette: 'viridis',
})
```

Labeled-axis datasets use stable axis IDs, so the same renderer can display an ordinary image, an
energy plane, or either domain of a 4D-STEM acquisition without relabeling dimensions:

```ts
import type {
  NormalizedScientificPlaneReadRequest,
  RasterBlock,
  ScientificDataset,
} from 'purejsimage/scientific'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  renderScientificPlane,
} from 'purejsimage/scientific'

const readSyntheticRegion = (plane: NormalizedScientificPlaneReadRequest): RasterBlock => {
  const data = new Uint8Array(plane.width * plane.height * 4)
  const view = new DataView(data.buffer)
  for (let index = 0; index < plane.width * plane.height; index += 1) {
    view.setFloat32(index * 4, index, false)
  }
  return {
    x: plane.x,
    y: plane.y,
    width: plane.width,
    height: plane.height,
    stride: plane.width * 4,
    format: { sampleType: 'float32', channels: 1, planar: false },
    data,
  }
}

const synthetic: ScientificDataset = {
  descriptor: normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes: [
      {
        id: 'x',
        kind: 'space',
        length: 64,
        unit: 'µm',
        coordinates: { type: 'linear', origin: 0, step: 0.5 },
      },
      {
        id: 'y',
        kind: 'space',
        length: 32,
        unit: 'µm',
        coordinates: { type: 'linear', origin: 0, step: 0.5 },
      },
      {
        id: 'energy',
        kind: 'spectral',
        length: 3,
        unit: 'eV',
        coordinates: { type: 'lookup', values: [10, 12, 18] },
      },
    ],
    sampleType: 'float32',
    components: [{ id: 'intensity', kind: 'intensity', unit: 'counts' }],
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
    },
  }),
  async *readPlane(request): AsyncIterable<RasterBlock> {
    const plane = normalizeScientificPlaneReadRequest(this.descriptor, request)
    yield readSyntheticRegion(plane)
  },
}

const energyDisplay = await renderScientificPlane(synthetic, {
  plane: {
    displayAxes: ['x', 'y'],
    fixedIndices: [{ axisId: 'energy', index: 1 }],
  },
  range: { mode: 'percentile', low: 1, high: 99 },
  palette: 'viridis',
})
```

The synthetic reader allocates only the requested region. Real readers should stream smaller blocks
when needed and propagate each block's optional `release()` callback.

One-dimensional spectra and profiles use a single true axis rather than a synthetic height axis.
Their descriptors advertise `planeReads: { kind: 'none' }` and `seriesReads`, while
`readSeries()` yields bounded `ScientificSeriesBlock` segments. Use
`normalizeScientificSeriesReadRequest()` before native reads. The explicit
`readScientificSeriesFromPlane()` fallback can compact one requested row or column from an existing
plane reader without materializing the complete series.

Applications that need format detection can construct an explicit, local scientific library without
changing the ordinary image codec pipeline:

```ts
import { FileSource } from 'purejsimage'
import { createScientificLibrary } from 'purejsimage/scientific'
import { fitsReader } from 'purejsimage/scientific/readers/fits'
import { gsfReader } from 'purejsimage/scientific/readers/gsf'

const science = createScientificLibrary({ readers: [fitsReader, gsfReader] })
const document = await science.open({
  primary: { id: 'observation', name: 'observation.fits', source: await FileSource.open(path) },
})
const dataset = await document.openDataset(document.datasets[0]!.id)
```

Registration is caller-owned: no package import installs readers globally. See the
[scientific reader registry guide](docs/scientific-reader-registry.md) for probe budgets,
multi-resource resolution, and Node/browser adapters.

Scientific readers expose portable canonical-byte `RasterBlock`s. Repeated scientific computation
converts each block once to a native-endian typed `NumericTile`; direct native tile sources remain an
explicit, local optimization and the canonical conversion fallback is permanent. Exact `uint64`
values remain `bigint`, while `float16` expands to `Float32Array`. See the
[numeric tile guide](docs/scientific-numeric-tiles.md) for ownership, checked conversion, and direct
provider semantics.

Application builders can explicitly import `purejsimage/operations` for JSON-safe operation
descriptors, immutable local registries, built-in pipeline lowering, and cost-based provider
selection. `purejsimage/extensions` composes trusted in-process readers, value types, operations,
and providers without package-global registration or import-time probing. Extensions execute with
the application's authority; this is not a sandbox. See the
[operations and trusted extensions guide](docs/operations-and-extensions.md).

Quantitative application results are available through the explicit `purejsimage/analysis` entry.
It provides bounded scalar, histogram, profile, columnar table, and collection contracts plus
JSON-safe summaries and a one-measurement scientific adapter. Typed payloads are never silently
serialized. See the [quantitative analysis results guide](docs/analysis-results.md).

The same analysis entry also provides versioned declarative graphs, canonical hashing, source
identity, explicit migrations, non-executing plans and dry runs, immutable workspace commands,
cancellable generic orchestration, and provenance. Graph mutation never executes providers, and
the controller is shared by UI, scripts, trusted plugins, and future agents without a privileged
AI-only path. See the [analysis graph guide](docs/analysis-graphs.md).

The analysis entry also provides calibrated JSON-safe ROI geometry, tile-local masks, deterministic
line sampling plans, built-in ROI value types, and immutable ROI workspace commands. See the
[ROI geometry and sampling guide](docs/roi-geometry-and-sampling.md).

Lazy quantitative applications can create a local byte-bounded `TileRuntime` with canonical source
and derived keys, shared in-flight reads, cancellable priority scheduling, explicit invalidation,
halo-aware provider execution, and JSON-safe metrics. Imports create no cache or background worker.
See the [lazy analysis tile runtime guide](docs/analysis-tile-runtime.md).

The initial strict TypeScript scientific operations cover lazy crop, resample, arbitrary-axis
slice, projection, threshold, Gaussian blur, ROI statistics, histogram, and calibrated line
profiles. They are registered only through an explicit application-owned bundle. See the
[built-in scientific analysis operations guide](docs/built-in-analysis-operations.md).

For the complete alpha application workflow—reader registry, arbitrary-axis tiles, ROI analysis,
graph save/replay, provider pinning, capability/command inspection, and trusted custom
operations—see [Building scientific applications with PureJsImage](docs/application-platform.md).

MRC and FITS volumes share lazy cross-section and projection operations:

```ts
import {
  createScientificLibrary,
  projectScientificVolume,
  sliceScientificVolume,
} from 'purejsimage/scientific'
import { createScientificPathContext } from 'purejsimage/scientific/node'
import { mrcReader } from 'purejsimage/scientific/readers/mrc'

const science = createScientificLibrary({ readers: [mrcReader] })
const document = await science.open(await createScientificPathContext('reconstruction.mrc'))
const volume = await document.openDataset(document.datasets[0].id)
const xz = sliceScientificVolume(volume, {
  displayAxes: ['x', 'z'], fixedIndices: [{ axisId: 'y', index: 128 }],
})
const maximum = projectScientificVolume(volume, {
  displayAxes: ['x', 'y'], axis: 'z', fixedIndices: [], mode: 'max',
})
```

[ENVI](https://purejsimage.com/scientific/envi/) ·
[GSF](https://purejsimage.com/scientific/gsf/) ·
[FITS](https://purejsimage.com/scientific/fits/) ·
[MRC2014 / CCP4](https://purejsimage.com/scientific/mrc/) ·
[CBF / imgCIF](https://purejsimage.com/scientific/cbf/) ·
[Volume operations](https://purejsimage.com/scientific/volumes/) ·
[Scientific API](https://purejsimage.com/api/#scientific) ·
[Client-side explorer](https://purejsimage.com/scientific/)

## Live browser demo

[Open the client-side image converter →](https://purejsimage.com/demo/)

[Open the client-side Scientific Raster Explorer →](https://purejsimage.com/scientific/)

Upload an image, let PureJsImage detect its actual format, apply optional
orientation, resize, rotation, and flip transforms, then download JPEG, PNG,
WebP, BMP, TIFF, Radiance HDR, QOI, PBM, PGM, PPM, PAM, PFM, or TGA output.
The demo runs entirely in the browser, makes no image-upload request, and reports
conversion time plus the browser memory measurements it can honestly observe.

[Browse a 2.12 GB pathology slide after fetching a fraction of a percent →](https://purejsimage.com/wsi/)

The zero-dependency whole-slide demo reads native Aperio SVS pyramid tiles directly from static
object storage with HTTP Range. It measures real requests and transferred bytes, cancels offscreen
tile work in a Web Worker, and requires no conversion, tile server, or sidecar index.

## Optional WASM acceleration

JPEG and PNG have optional first-party WebAssembly accelerators. They are never
loaded unless you explicitly register them, and unsupported work continues to
use the default TypeScript codecs.

[See WASM setup, options, and supported workflows →](https://purejsimage.com/api/#wasm-acceleration)

## Supported codecs

<!-- capabilities:readme:start -->
| Format | Read | Write |
| --- | --- | --- |
| JPEG | Yes | Yes |
| PNG | Yes | Yes |
| WebP | Yes | Yes |
| BMP | Yes | Yes |
| TIFF | Yes | Yes |
| GIF | Static / explicit frame 0 | No |
| ICO | Yes | No |
| JPEG 2000 / JP2 | Yes | No |
| AVIF | Yes | Limited |
| HEIF / HEIC (experimental) | Experimental | No |
| JPEG XL | Limited | No |
| Radiance HDR / RGBE | Yes | Yes |
| QOI | Yes | Yes |
| Netpbm and PFM | Yes | Yes |
| TGA / TARGA | Yes | Yes |

“Limited” means PureJsImage supports a useful subset and clearly rejects files
outside it.
“Experimental” means the codec is excluded from `allCodecs` and requires an
explicit direct import and registration.

[See the exact codec support matrix →](https://purejsimage.com/codecs/)

Detailed codec compatibility roadmaps:
[JPEG](https://github.com/a-r-d/PureJsImage/blob/main/jpeg-codec-support.md),
[PNG](https://github.com/a-r-d/PureJsImage/blob/main/png-codec-support.md),
[WebP](https://github.com/a-r-d/PureJsImage/blob/main/webp-codec-support.md),
[BMP](https://github.com/a-r-d/PureJsImage/blob/main/bmp-codec-support.md),
[TIFF](https://github.com/a-r-d/PureJsImage/blob/main/tiff-codec-support.md),
[GIF](https://github.com/a-r-d/PureJsImage/blob/main/gif-codec-support.md),
[ICO](https://github.com/a-r-d/PureJsImage/blob/main/ico-codec-support.md),
[JPEG 2000 / JP2](https://github.com/a-r-d/PureJsImage/blob/main/jpeg2000-codec-support.md),
[AVIF](https://github.com/a-r-d/PureJsImage/blob/main/avif-codec-support.md),
[HEIF / HEIC (experimental)](https://github.com/a-r-d/PureJsImage/blob/main/heif-codec-support.md),
[JPEG XL](https://github.com/a-r-d/PureJsImage/blob/main/jpegxl-codec-support.md),
[Radiance HDR / RGBE](https://github.com/a-r-d/PureJsImage/blob/main/hdr-codec-support.md),
[QOI](https://github.com/a-r-d/PureJsImage/blob/main/qoi-codec-support.md),
[Netpbm and PFM](https://github.com/a-r-d/PureJsImage/blob/main/netpbm-codec-support.md),
and [TGA / TARGA](https://github.com/a-r-d/PureJsImage/blob/main/tga-codec-support.md).
<!-- capabilities:readme:end -->

HEIF/HEIC is experimental, excluded from `allCodecs`, and available only through
`purejsimage/codecs/experimental/heic`. Its [support contract](heif-codec-support.md)
includes the HEVC patent notice for users and distributors.

AVIF is a first-party codec, not a wrapper around libavif or a third-party
runtime. Common still-image decode is supported in Node.js and modern browsers;
the checked [capability contract](avif-codec-support.md) records the explicit
boundaries for uncommon AV1 syntax and dependent animation. The public encoder
is intentionally constrained to opaque 8-bit YUV 4:2:0 still images.

## Beyond ordinary image conversion

The raster APIs preserve native numeric data instead of forcing every source
through RGB:

- **Scientific:** GSF surfaces, ENVI hyperspectral cubes and classification maps, FITS and MRC
  volumes, CBF detector frames, N-channel rasters, and OME-TIFF.
- **Geospatial:** GeoTIFF and remote COG region reads.
- **Pathology:** whole-slide pyramids, Aperio SVS, and vendor profiles.

The `Image` pipeline uses display-ready `PixelBlock`s for ordinary transformations
and encoding. Scientific TIFF workflows expose native numeric, N-channel
`RasterBlock`s and map them to display pixels only when requested.

The same explicit scientific renderer handles GSF, ENVI, FITS, MRC, CBF, and OME-TIFF planes with declared,
dataset, or bounded-sample percentile ranges; linear, logarithmic, square-root, or asinh scaling;
five first-party palettes; and optional three-row scalar relief. Quantitative inputs are never
mutated by display mapping.

### TIFF

TIFF support spans display images, native scientific rasters, OME-TIFF,
whole-slide pyramids, extensible vendor profiles, and canonical RGB/RGBA output.
The complete support list, memory model, examples, and remaining boundaries live
on the dedicated TIFF page:

- [Complete TIFF support →](https://purejsimage.com/tiff/)
- [TIFF output options →](https://purejsimage.com/tiff/#encode)
- [Scientific TIFF and OME-TIFF →](https://purejsimage.com/tiff/#scientific)
  · [Third-party TIFF profiles →](https://purejsimage.com/tiff/#profiles)
- [Zstandard decompression API →](https://purejsimage.com/api/#zstandard)

<!-- library-comparison:readme:start -->
<!-- Generated by scripts/render-library-comparison.ts. Do not edit this block. -->
### TIFF library comparison

A capability is **Yes** only when upstream documentation or source supports it; measured decode coverage is reported separately against independent RGBA output. “Not verified” is not treated as unsupported.

| Library | Runtime model | Browser | BigTIFF | Tiles | Region decode | Native scientific raster | OME / whole-slide semantics | Decode coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PureJsImage benchmark snapshot · 3be4530 | Strict TypeScript | Yes | Yes | Yes | Yes | Yes | Yes | 104/106 decoded<br>57 exact<br>47 pixel mismatches<br>2 oracle-unavailable cases |
| GeoTIFF.js 3.0.5 | Pure JavaScript | Yes | Partial | Yes | Yes | Yes | No | 84/106 decoded<br>32 exact<br>52 pixel mismatches<br>11 unsupported · 7 errors · 2 oracle-unavailable cases · 2 crashes |
| UTIF.js (utif2) 4.1.0 | Pure JavaScript | Yes | No | Yes | No | Partial | No | 74/106 decoded<br>49 exact<br>25 pixel mismatches<br>28 errors · 2 oracle-unavailable cases · 2 timeouts · 3 crashes |
| image-js/tiff 7.1.3 | Pure JavaScript | Yes | No | Yes | No | Yes | No | 41/106 decoded<br>27 exact<br>14 pixel mismatches<br>51 unsupported · 12 errors · 2 oracle-unavailable cases |
| image-js 1.7.0 | Pure JavaScript | Yes | No | Yes | No | Partial | No | 39/106 decoded<br>33 exact<br>6 pixel mismatches<br>51 unsupported · 14 errors · 2 oracle-unavailable cases |
| Jimp 1.6.0 | Pure JavaScript | Yes | No | Yes | No | No | No | 74/106 decoded<br>49 exact<br>25 pixel mismatches<br>28 errors · 2 oracle-unavailable cases · 2 timeouts · 3 crashes |
| Sharp / libvips 0.35.3 | Native wrapper | No | Partial | Yes | Partial | Partial | No | Not run |

“Oracle unavailable” means the independent Sharp/ImageMagick ground-truth path could not decode the fixture, not that the listed JavaScript engine failed. Every measured engine has the same two unavailable cases. PureJsImage's 47 non-exact decodes comprise 38 at or above 40 dB PSNR, 6 from 20 to below 30 dB, and 3 below 10 dB, derived from recorded RMSE. Jimp uses utif2 for TIFF internally, so its matching aggregate outcomes are expected.

[Full grouped capability matrix, methods, sources, and per-library results](https://purejsimage.com/tiff-comparison/)
<!-- library-comparison:readme:end -->

## Benchmarks

The seven-engine competitor profile measures the default PureJsImage TypeScript codecs and the
explicitly registered PureJsImage JPEG/PNG WASM accelerators as separate variants alongside Jimp,
Sharp, Sharp configured for one processing thread, image-js, and jSquash. Sharp uses native libvips;
PureJsImage WASM and jSquash use WebAssembly; default PureJsImage, Jimp, and image-js are pure
JavaScript. Each engine received the same files, used its public default resize kernel, and ran in a
separate process. A result appears only when its output passed validation.

[![Image workflow speed comparison across seven isolated engines, including default and WASM PureJsImage variants.](benchmark/results/competitors-speed-2026-08-10.png)](benchmark/results/competitors-speed-2026-08-10.png)

[![Image workflow output quality comparison across seven engines measured as premultiplied-RGBA PSNR against an exact-area reference.](benchmark/results/competitors-quality-2026-08-10.png)](benchmark/results/competitors-quality-2026-08-10.png)

[![Image workflow absolute peak memory comparison across seven isolated engines.](benchmark/results/competitors-memory-2026-08-10.png)](benchmark/results/competitors-memory-2026-08-10.png)

Resize workflows use engine defaults: PureJsImage and Sharp use Lanczos 3 while
Jimp uses bilinear. The quality chart reports premultiplied-RGBA PSNR against an
independently decoded exact-area reference; `exact` means every visible color
and alpha channel matched. This exposes quality differences, but cross-kernel
timings remain default-experience measurements rather than matched-quality
comparisons.

**Benchmark snapshot:** PureJsImage 0.8.0, August 10, 2026, Node.js 24.16.0.
Against the default TypeScript path, the opt-in WASM variant reduced median wall
time by 53.0% for JPEG-to-PNG, 38.9% for the 100-megapixel PNG downscale, and
11.6% for the large PNG resize while returning the same measured output quality.
On the 24-megapixel photo workflow, default PureJsImage used 86.7% less peak
memory than Jimp and 87.6% less than image-js. Timing, memory, and quality vary by
image, operation, machine, and library version.

The focused nine-run TIFF profile recorded:

| Workflow | PureJsImage wall | PureJsImage RSS | Jimp wall | Jimp RSS |
| --- | ---: | ---: | ---: | ---: |
| 4000×3000 TIFF metadata | 0.4 ms | 134.4 MiB | 150.4 ms | 289.8 MiB |
| 4000×3000 TIFF → 1000px JPEG | 144.4 ms | 214.9 MiB | 663.0 ms | 372.1 MiB |
| 7795×3122 LZW TIFF → 1000px PNG | 1,026.2 ms | 133.0 MiB | 753.2 ms | 284.8 MiB |
| PNG → Deflate TIFF | 24.5 ms | 111.4 MiB | 97.3 ms | 152.8 MiB |

PureJsImage passed all 18 TIFF workflows. Jimp passed seven, lacked the eight bounded raw/region
workflows, and produced invalid pixels in three decode-to-PNG cases. The LZW row is the measured
exception to the speed advantage: PureJsImage was slower there but used 53.3% less peak RSS.

[Raw competitor report](benchmark/results/competitors-2026-08-10.md) ·
[PureJsImage TIFF report](benchmark/results/tiff-profile-2026-08-10.md) ·
[Jimp TIFF report](benchmark/results/jimp-tiff-profile-2026-08-10.md)

[See the complete benchmark report and methodology →](https://purejsimage.com/performance/)

### Lambda memory sizing

A 256 MiB Lambda completed every measured 12-megapixel resize/conversion workflow and used
121–156 MiB at peak. That does not make 256 MiB the fastest setting: Lambda also allocates CPU with
memory. For JPEG → WebP, warm operation time fell from 10,601 ms at 256 MiB to 5,261 ms at 512 MiB
and 2,533 ms at 1024 MiB, while peak use stayed at 120–122 MiB. For latency-sensitive endpoints,
start at 1024 MiB even when the process only consumes about 150 MiB; use 256 MiB when its lower CPU
allocation and roughly 10-second latency are acceptable. Re-measure with your own images and
concurrency.

### Bundle size

JPEG and PNG form the matched set because all five libraries support them.
PureJsImage and jSquash can assemble only that set; the normal Jimp, image-js,
and Sharp imports include the additional codecs shown.

Measured on Linux x64 with Node.js 24.16.0 using the repository's reproducible
esbuild, gzip, and Brotli settings:

| Import | Version | Codecs included | Minified JS | gzip | Brotli |
| --- | --- | --- | ---: | ---: | ---: |
| **PureJsImage matched** | **0.10.0** | JPEG, PNG | 155.6 KiB | 49.9 KiB | 41.9 KiB |
| PureJsImage all codecs | 0.10.0 | 13 codecs | 844.1 KiB | 296.6 KiB | 245.3 KiB |
| Jimp | 1.6.0 | JPEG, PNG, TIFF, BMP, GIF | 577.4 KiB | 174.6 KiB | 139.5 KiB |
| image-js | 1.7.0 | JPEG, PNG, TIFF, BMP | 361.5 KiB | 111.2 KiB | 94.3 KiB |
| jSquash | JPEG 1.6.0; PNG 3.1.1; resize 2.1.1 | JPEG, PNG | **52.4 KiB** | **16.0 KiB** | **13.2 KiB** |
| Sharp JS wrapper | 0.35.3 | JPEG, PNG, TIFF, WebP, GIF, AVIF | 128.4 KiB | 38.3 KiB | 33.5 KiB |

Sharp's JavaScript bundle is only a wrapper around native code, while jSquash's
JavaScript bundle is glue around its WebAssembly codecs and resizer. The
complete installed deployment tells the other half of the story:

The new application APIs remain explicit imports and do not enter the root or
codec bundles. Measured independently on the same candidate:

| PureJsImage entry | Minified JS | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Core API | 59.9 KiB | 18.9 KiB | 16.8 KiB |
| Core + scientific platform | 140.2 KiB | 40.8 KiB | 35.2 KiB |
| All scientific readers | 348.7 KiB | 107.0 KiB | 89.1 KiB |
| Operation descriptors and runtime | 43.3 KiB | 11.7 KiB | 10.5 KiB |
| Analysis application API | 267.0 KiB | 73.0 KiB | 59.8 KiB |
| Trusted extension host | 45.5 KiB | 12.5 KiB | 11.2 KiB |

| Package | Version | Installed footprint | Production packages |
| --- | --- | ---: | ---: |
| **PureJsImage** | **0.10.0** | **3.9 MiB** | **1** |
| Jimp | 1.6.0 | 29.3 MiB | 70 |
| image-js | 1.7.0 | 17.0 MiB | 46 |
| jSquash JPEG + PNG + resize | JPEG 1.6.0; PNG 3.1.1; resize 2.1.1 | **1.0 MiB** | **3** |
| Sharp, including native libvips | 0.35.3 | 18.9 MiB | 6 |

[See bundle details and reproduction commands →](https://purejsimage.com/performance/#bundle)

## Why PureJsImage?

- First-party codecs implemented in this repository, with strict TypeScript as
  the permanent portable reference engine.
- Zero runtime dependencies and no required native image stack, WebAssembly, or
  external binaries.
- Codec-native bounded execution where the format permits it, with explicit
  memory classes and documented full-frame fallbacks.
- The same reference behavior across Node.js and modern browsers.
- A native whole-slide browser demo that opens Aperio SVS tiles through HTTP
  Range without conversion, a tile server, or a sidecar index.
- Explicit unsupported boundaries instead of plausible corruption.
- Permanent conformance corpora, hostile-input tests, and reproducible
  performance and memory measurements.
- Optional first-party acceleration that preserves the reference contract
  rather than replacing it.

### When to use Sharp instead

If you can deploy native libvips and throughput or latency is the main constraint, use
[Sharp](https://sharp.pixelplumbing.com/). It was 1.9×–12.2× faster than the default TypeScript path
across the five commonly supported benchmark workflows. PureJsImage is the better fit when the same
code must run in Node.js and browsers or edge workers, native addons or WASM are prohibited, or a
zero-dependency deployment materially simplifies an air-gapped or supply-chain-restricted build.
The measured installed footprint was 3.9 MiB and one package for PureJsImage versus 18.9 MiB and six
production packages for Sharp.

[Read the practical guides →](https://purejsimage.com/guides/)

## Development

The repository uses TypeScript strict mode, Biome, and Vitest.

```sh
npm install
npm run check
```

[Read the contributor guide →](https://purejsimage.com/contributing/)

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository checklist and the
[project specification](project-spec.md) for the architecture and implementation
principles.

The detailed implementation and acceleration plans remain in the
[project roadmap](ROADMAP.md).

## Special thanks

Special thanks to [Imazen](https://github.com/imazen) for building the image corpus that made broad,
real-world codec testing possible.
