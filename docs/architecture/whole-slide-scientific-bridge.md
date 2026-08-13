# Whole-slide to scientific-dataset bridge

Status: implemented on the unreleased application-platform branch, first exercised by Aperio SVS.

## Boundary

The internal `createWholeSlideScientificDocument()` adapter maps any conforming `WholeSlideImage`
to one `ScientificDocument`. Concrete readers still own format detection and parsing. The first
reader, `purejsimage/aperio-svs`, reuses the existing TIFF document and Aperio profile; there is no
second SVS parser.

```text
ImageSource -> TIFF document -> Aperio WholeSlideImage
                                  |
                                  v
                             ScientificDocument
                               |- pyramid
                               |- associated/label
                               |- associated/macro
                               `- associated/thumbnail (and other stable IDs)
```

Associated images are independent single-level datasets, never fake pyramid levels. Dataset
identity contains reader ID/version, stable dataset ID, and source identity, so pyramid and
associated outputs cannot share cache identity accidentally.

## Pyramid and plane semantics

Every slide level becomes one `ScientificResolutionLevel` with explicit X and Y lengths and
per-axis coordinates. `downsampleX` and `downsampleY` independently scale the base MPP; missing MPP
leaves calibration absent. The ordered read pair is `[x, y]`.

Applications select a level once with
`purejsimage.analysis.select-resolution-level@1`. Its output is an ordinary single-level dataset,
so later crop, threshold, blur, ROI, measurement, and global-analysis operations do not each need a
resolution parameter. The selected level remains part of graph, derived-cache, and provenance
identity.

For ordinary Aperio color slides the scientific descriptor declares decoded uint8 RGB components,
not raw TIFF YCbCr. TIFF compression, photometric interpretation, bits, samples, Aperio properties,
MPP, objective power, per-level geometry, and source metadata remain explicit descriptor metadata.
When a TIFF ICC tag is present, the descriptor records only bounded JSON metadata—presence, byte
length, and tag 34675—from the IFD entry. Enumeration does not fetch, duplicate, hash, or base64
encode the profile payload. The existing TIFF decoder still reads supported profiles lazily and
applies its unchanged ICC color management before yielding display-oriented RGB samples.

All pyramid levels are checked during document construction against the pyramid's declared decoded
sample/component model. A grayscale, RGB, or RGBA mismatch rejects before any descriptor is
published. Associated images remain separate datasets and may use their own truthful formats.

## Storage, cancellation, and ownership

The bridge wraps a `PixelBlock` as a `RasterBlock` without copying its bytes, rebases the
decoder-relative coordinates to the requested region, and forwards the optional release callback.
Reads remain bounded to requested regions and propagate `AbortSignal` into the whole-slide decoder.
Local and HTTP Range sources therefore read TIFF metadata and intersecting compressed segments,
not a complete slide or pyramid level.

`createAperioSvsReader({ limits })` exposes explicit whole-slide bounds for source bytes, declared
width/height, directory count, requested region pixels and decoded bytes, and associated-image
pixels. The default reader accepts multi-gigabyte sources and large lazy dimensions but does not use
unbounded numeric limits. Coordinates, extents, pixel products, decoded bytes, segment storage, and
directory counts are admitted before allocation. These WSI-specific limits do not alter the
ordinary TIFF codec's image defaults.

Tiled Aperio region reads decompose the requested rectangle into sequential native-tile
intersections and rebase each emitted block to request-relative coordinates. This prevents a short,
wide request from retaining every intersecting decoded tile column at once. The generic TIFF display
and raster decoders also preflight the conservative aggregate of live decoded segments, the largest
emitted block, and floating-predictor row scratch before reading segment payloads, so direct callers
fail at the configured decoded-byte boundary rather than allocating an unbounded segment row.

Focused synthetic bridge tests cover anisotropic level calibration, mixed-format rejection,
associated-image separation, source/dataset identity, cancellation before a read, bounded region
forwarding, and exact release forwarding. Deterministic parser tests cover multilevel Aperio TIFF
and ICC enumeration without payload reads. The pinned Aperio fixture verifies local/range metadata
and pixel parity; a sparse virtual source reports more than the ordinary image-size default while
automatic detection and a small region remain bounded.

## Deliberate limits

- Only explicitly registered whole-slide scientific readers are available; the base scientific
  entry does not auto-register Aperio.
- Multi-area Leica scene composition and additional vendor profiles remain future work.
- The bridge exposes decoded display samples. Native vendor channels require a separate truthful
  reader contract rather than relabeling RGB output.
- Whole-slide selection and connected components do not add UI, morphology, watershed, or a second
  scheduler.
