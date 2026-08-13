# Whole-slide to scientific-dataset bridge

Status: design only. The adapter described here is not implemented.

## Current separation

`WholeSlideImage` exposes bounded, display-oriented `PixelBlock` regions. `ScientificDataset`
exposes portable `RasterBlock` reads and optional native `NumericTile` reads. Analysis accepts
`ScientificDataset`, so it cannot currently consume a `WholeSlideImage` directly. That distinction
must remain truthful until the metadata and level semantics below exist.

## Required metadata and document model

Before the first region read, the whole-slide contract must expose pixel/sample format, component
descriptors, per-level dimensions and declared downsample, physical calibration, and
associated-image metadata. Missing calibration remains missing; it is never guessed.

```text
WholeSlideImage
  -> ScientificDocument
    -> primary pyramidal ScientificDataset
    -> label ScientificDataset
    -> macro ScientificDataset
    -> thumbnail or other associated ScientificDatasets
```

Associated images are separate datasets, not synthetic resolution levels of the primary slide.

## Pyramid and plane semantics

Each declared slide level maps to one `ScientificResolutionLevel`. Physical step at level N is the
base calibration multiplied by that level's declared downsample. The ordered plane pair is `[x,
y]`. Reads remain range-backed and bounded. The application selects the level; the adapter must not
silently force level zero.

Operation schemas need explicit resolution-level parameters and one canonical per-level calibration
transform before implementation. Otherwise graphs, cache keys, provenance, and ROI measurements
cannot state which pixels were analyzed.

## Storage, identity, and ownership

The adapter must forward every `PixelBlock.release` through `RasterBlock` and `NumericTile`
wrappers. It must represent display-oriented storage truthfully, retain every RGB component, and
never stage a full slide or level. Document identity includes the slide reader/profile and complete
resource identity; associated datasets receive distinct dataset IDs.

## Acceptance tests

- Local and HTTP Range sources return equivalent pixels and metadata.
- Explicit level selection returns declared dimensions, downsample, and calibration.
- Calibrated ROI measurements use the selected level transform.
- Semantic cache reuse never collides across slides, levels, or associated images.
- Label, macro, thumbnail, and other associated images are separate datasets.
- Recorded fetched bytes remain below full source size for bounded workflows.
- Cancellation reaches active range reads and every acquired block releases exactly once.
- Metadata, planning, and first-tile paths never download or materialize the full slide.
