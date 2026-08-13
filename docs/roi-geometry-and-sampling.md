# ROI geometry and sampling

`purejsimage/analysis` provides portable, JSON-safe region-of-interest primitives for scientific
applications. They do not depend on DOM, Canvas, SVG, React, or application state, and they do not
read dataset pixels. The API is provisional while the package remains alpha.

## Coordinate semantics

An ROI names exactly two ordered display axes: horizontal then vertical. Every other non-singleton
dataset axis must have an explicit fixed index, so a shape cannot silently move between time,
channel, scan, or depth coordinates.

Pixel-space ROI coordinates are continuous. Integer coordinates are pixel boundaries, and the
center of pixel index `i` is `i + 0.5`. For a linear scientific axis, coordinate `origin` belongs to
pixel center `0.5`; therefore:

```text
physical = origin + (pixelCoordinate - 0.5) * step
pixelCoordinate = (physical - origin) / step + 0.5
```

Numeric lookup calibration is linearly interpolated between sample centers and may ascend or
descend, but it must be strictly monotonic for physical-to-pixel conversion. Index, labeled,
repeated-value, and non-monotonic axes reject physical ROI geometry. Units must match the axis units
exactly; PureJsImage does not silently convert `nm` to `um` or otherwise guess compatibility.

For example, an `x` axis with `{ origin: 10, step: 2, unit: 'um' }` maps pixel centers `0.5`, `1.5`,
and `2.5` to `10`, `12`, and `14 um`.

## Geometry and canonical data

Schema version 1 supports point, line segment, polyline, rectangle, ellipse, and polygon geometry,
plus `RoiSet` collections with stable ROI IDs. `normalizeRoi()` and `normalizeRoiSet()` validate and
copy input into immutable JSON-safe data. Configurable limits bound ROI count, points per geometry,
coordinate magnitude, presentation nesting, presentation bytes, and strings.

`canonicalRoiJson()` serializes all stored ROI data. `canonicalRoiSemanticsJson()` deliberately
excludes the optional human name and `presentation` label/style metadata; those fields may change
without changing quantitative geometry. Geometry, axes, fixed indices, coordinate space, units,
schema version, and stable ID remain quantitative semantics. No rendering behavior is inferred from
style metadata.

```ts
import {
  canonicalRoiSemanticsJson,
  normalizeRoi,
  pixelToPhysicalPoint,
} from 'purejsimage/analysis'

const roi = normalizeRoi(
  {
    schemaVersion: 1,
    id: 'cell-17',
    axisIds: ['x', 'y'],
    fixedIndices: [{ axisId: 'time', index: 3 }],
    coordinateSpace: 'pixel',
    geometry: {
      kind: 'polygon',
      points: [
        { x: 10, y: 12 },
        { x: 18, y: 12 },
        { x: 15, y: 20 },
      ],
    },
  },
  dataset.descriptor,
)

const calibratedCenter = pixelToPhysicalPoint(
  dataset.descriptor,
  roi.axisIds,
  { x: 10.5, y: 12.5 },
)
const quantitativeJson = canonicalRoiSemanticsJson(roi, dataset.descriptor)
```

## Tile-local masks

`createRoiMask()` allocates exactly one byte per pixel in the requested tile, reports the tile
origin, dimensions, and stride, and clips work to both the plane and ROI bounds. It never creates a
full-plane mask unless the caller explicitly requests a full-plane tile. The current storage is an
ordinary caller-owned `Uint8Array`, so no release callback is required.

Rectangle membership uses lower-inclusive and upper-exclusive continuous bounds. Ellipse boundaries
are included. Polygon masks use even-odd filling with boundaries included; scanline vertex handling
uses a half-open vertical edge convention so inclusion is independent of tile partitioning. Polygon
holes have no schema representation and unknown hole fields are rejected. Point, line-segment, and
polyline geometry are not area masks because no stroke-width contract exists yet.

## Deterministic line plans

`createRoiLineSamplingPlan()` accepts line-segment or polyline geometry and returns coordinates plus
nearest indices or bilinear indices/weights. It returns pixel coordinates, physical coordinates,
axis units, path distances, and the distance unit separately from any future sampled dataset values.
It performs no dataset read.

Pixel-distance spacing works for pixel geometry. Physical-distance spacing works for physical
geometry when both axis units are equal, including two explicitly unitless axes. Crossing between
pixel-path and physical
spacing is currently limited to two linear calibrated axes, because equal physical distances along
a nonlinear lookup path require a more explicit curve-flattening tolerance contract. Plans reject
zero-length paths, invalid spacing, and sample counts above the caller limit. Abort signals are
observed during long loops. Pixel-distance plans remain available on index or labeled axes; their
`physicalCoordinates` field is `null` because no calibrated values can be reported.

Nearest sampling maps a coordinate to `floor(pixelCoordinate)`, so a coordinate exactly on an
integer boundary deterministically chooses the pixel on its positive side. Bilinear weights are
relative to pixel centers and are returned in top-left, top-right, bottom-left, bottom-right order.

## Workspace and operation integration

`createRoiValueTypeDefinitions()` and `createRoiValueTypeRegistry()` create explicit local built-in
definitions for `purejsimage.roi@1` and `purejsimage.roi-set@1`. Their capability descriptors contain
the schema fields, geometry kinds, coordinate spaces, limits, and presentation-semantic rule.
Extensions may define distinct namespaced ROI-like values, but cannot replace the core IDs.

An `AnalysisController` configured with `roi: { descriptor, limits }` exposes `add-roi`,
`update-roi`, `remove-roi`, and `replace-roi-set` commands. They use the same immutable snapshot,
monotonic revision, expected-revision check, and structured issue path as graph commands. Applying a
command changes data only; planning and execution remain separate explicit calls.

```ts
const command = {
  schemaVersion: 1,
  id: 'add-cell-17',
  kind: 'add-roi',
  expectedRevision: workspace.revision,
  roi,
}

const application = controller.applyCommand(workspace, command)
if (!application.applied) console.error(application.issues)
workspace = application.snapshot
```

ROI-aware statistics, histograms, and line profiles are implemented by the built-in reference
provider and use these same geometry and sampling contracts. Freehand brushes, stroke-width masks,
3D ROIs and meshes, boolean geometry, holes, mutable painting, annotation collaboration, visual
styling systems, and rendering UI remain deliberately deferred.
