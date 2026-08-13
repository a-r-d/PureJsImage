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
When a bounded TIFF ICC tag is present, the descriptor retains its exact bytes as base64 plus the
original byte length. The existing TIFF decoder applies supported ICC color management before
yielding those display-oriented RGB samples.

## Storage, cancellation, and ownership

The bridge wraps a `PixelBlock` as a `RasterBlock` without copying its bytes, rebases the
decoder-relative coordinates to the requested region, and forwards the optional release callback.
Reads remain bounded to requested regions and propagate `AbortSignal` into the whole-slide decoder.
Local and HTTP Range sources therefore read TIFF metadata and intersecting compressed segments,
not a complete slide or pyramid level.

Focused synthetic bridge tests cover anisotropic level calibration, associated-image separation,
source/dataset identity, cancellation before a read, bounded region forwarding, and exact release
forwarding. The pinned Aperio fixture verifies local/range metadata and pixel parity and confirms
that initial metadata plus a small region fetch less than the complete source.

## Deliberate limits

- Only explicitly registered whole-slide scientific readers are available; the base scientific
  entry does not auto-register Aperio.
- Multi-area Leica scene composition and additional vendor profiles remain future work.
- The bridge exposes decoded display samples. Native vendor channels require a separate truthful
  reader contract rather than relabeling RGB output.
- Whole-slide selection and connected components do not add UI, morphology, watershed, or a second
  scheduler.
