# Flagship scientific explorer architecture

Status: implementation checkpoint for Phase 3. This document describes the accepted boundary and
tracks the gates that must pass before the flagship is complete.

## 1. Product scope and non-goals

The flagship is an entirely client-side scientific raster explorer. Its signature workspace links a
4D-STEM navigation map to a diffraction pattern. A detector ROI creates a virtual detector map. A
scan ROI creates a summed or averaged diffraction pattern. The application also opens ordinary
scientific datasets through the same labeled-axis model and native numeric display path.

This phase does not add diffraction indexing, phase identification, ptychography, machine learning,
Python interoperability, cloud processing, accounts, uploads, arbitrary HDF5 browsing, or broad
vendor-convention inference. It is not a replacement for HyperSpy or py4DSTEM. WebGPU is not part of
the initial path.

## 2. Reuse of the existing application platform

The flagship uses the existing `ScientificLibrary`, `ScientificDataset`, `TileRuntime`, analysis
controller, graph, provider, command, project, ROI, workspace, and evidence contracts. Registries and
providers remain caller-owned. Importing the bundle does not register anything globally.

PureJsImage Lab is not part of this repository. The application therefore lives at the focused
`/4d-stem/` documentation route. It uses the existing Astro application shell and strict TypeScript
worker convention. This avoids adding another UI framework, state model, cache, or command system.
The current `/scientific/` route remains the broad introductory explorer while the new route proves
the deeper linked workflow.

## 3. Reader discovery and dynamic loading

The browser reader catalog is generated from the authoritative capability manifest and package
exports. The application uses extension and MIME type only to choose a small set of modules to load.
It then uses bounded reader probing or explicit user selection to establish the format.

MIB is the required first-class 4D-STEM reader. Its existing descriptor exposes
`scanX/scanY/kx/ky` only when the optional HDR sidecar proves a rectangular acquisition. Gatan
DigitalMicrograph is also eligible when its existing metadata gate proves a diffraction image, the
swapped data order, 2D-array acquisition mode, and matching scan shape. Velox EMD remains available
to the generic explorer, but its current rank-3 image/frame descriptors are not described as
4D-STEM. OME-Zarr input explains that one selected chunk is not a complete store and directs
applications to the browser HTTP or application-owned object-store APIs. HEIC is never loaded or
selected automatically.

## 4. Descriptor-driven control generation

The source and dataset controls come from document summaries. Axis controls come from axis IDs,
kinds, lengths, coordinates, entries, units, and plane-read capabilities. Resolution controls come
from declared levels. Component, no-data, native range, palette, and display scaling controls come
from the selected descriptor and measurement results.

Reader-specific UI branches are limited to resource acquisition, such as an MIB plus optional HDR
sidecar or an OME-Zarr directory. They do not define scientific axis meaning, ROIs, analysis graphs,
or rendering state.

## 5. Worker and cancellation model

The main thread owns accessible controls, pointer interaction, canvas presentation, and recoverable
error state. A dedicated module worker owns sources, documents, datasets, the tile runtime, analysis
controller, evidence session, and derived datasets. Messages have a version and are validated from
`unknown` before use.

Every open, viewport, cursor, and analysis request has a monotonically increasing sequence. Starting
a newer request aborts the older controller. Close and worker termination release documents, source
sessions, tile leases, caches, providers, and evidence sessions. Returned pixel buffers transfer
ownership to the main thread. Dataset and provider objects never enter serialized project state.

## 6. Generic viewer state

Authoritative scientific state is an analysis workspace snapshot plus explicit source and dataset
selection. Presentation state contains the selected display axes, fixed indices, level, viewport,
native-value mapping, palette, and measurement cursor. Project serialization stores semantic source
references and graph parameters, not open handles or live worker objects.

The generic viewer can select a dataset, choose any supported ordered axis pair, set every remaining
axis index, choose a resolution level, render a bounded plane, and inspect a native sample. Unsupported
axis pairs are disabled from the descriptor rather than attempted speculatively.

## 7. 4D-STEM axis-role model

A 4D-STEM dataset must have four distinct roles:

| Role | Required axis kind | Default accepted ID |
| --- | --- | --- |
| navigation X | `space` | `scanX` |
| navigation Y | `space` | `scanY` |
| detector X | `reciprocal-space` | `kx` |
| detector Y | `reciprocal-space` | `ky` |

Explicit caller roles may select different IDs only when the axes are distinct and the reader
advertises the detector pair as readable. Rank alone never proves 4D-STEM. Extra axes require fixed
indices. Coordinates, units, calibration evidence, components, no-data policy, and source identity
remain attached to derived results.

## 8. Virtual detector operation semantics

`purejsimage/analysis/4d-stem` provides a versioned virtual-detector operation. Its input is one
scientific dataset, explicit axis roles and fixed indices, a detector point, rectangle, circle, or
annulus, and `sum` or `mean`. Its output is a lazy float64, one-component dataset over the navigation
axes.

For each requested navigation output tile, the implementation visits only those scan positions. At
each position it requests the detector ROI bounding rectangle, applies the exact pixel-center mask,
and releases every block in `finally`. A point reads one detector pixel. A small ROI does not cause a
full detector-frame read. The derived semantic identity includes the input dataset identity, roles,
fixed indices, ROI, reduction, operation version, provider, and numeric policy.

## 9. Scan-region diffraction reduction semantics

The scan-reduction operation accepts a navigation point, rectangle, or circle and `sum` or `mean`.
It returns a lazy float64, one-component dataset over the detector axes. A requested detector tile is
the only accumulator retained. The implementation visits navigation positions admitted by the ROI,
requests that detector tile for each position, merges its released row blocks, and never retains one
complete frame per scan position.

Point inclusion uses pixel centers. Rectangles include the left and top edge and exclude the right
and bottom edge. Circles include samples whose pixel centers are on or inside the radius. Empty ROIs
are invalid.

## 10. Tile, cache, and source-read strategy

Derived plane reads are divided into bounded output blocks. The application exposes each derived
dataset through the existing numeric-tile adapter and `TileRuntime`, so complete semantic tile keys,
coalescing, cancellation, ownership, and eviction use the shared cache contract. Source readers keep
their own format-aware bounded access. The operation layer never converts a region request into a
full 4D allocation.

MIB already reads only the requested detector rows and columns. Its frame header is validated before
the selected rows are read. Any grouping or adaptive overfetch change requires separate measurement
because it changes the range-read tradeoff.

## 11. Precision and accumulation rules

Source sample type and layout are resolved before hot loops. Unsigned and signed integer input uses
`bigint` accumulation when a static worst-case can exceed JavaScript's exact integer range. The
result converts to float64 only after checking that the selected value is exactly representable;
otherwise the operation fails instead of wrapping or silently rounding. Smaller integer sums use
exact number accumulation. Floating input uses float64 accumulation.

Mean output is float64. NaN propagates. A declared no-data value is absent from both the sum and the
mean divisor. Zero is a valid measured count. If all selected samples are absent, the output is NaN.
The reference operations are backend-stable with documented floating tolerance, not declared
bit-exact across arbitrary floating providers.

## 12. Evidence integration

The worker creates an explicit bounded evidence collector and passes its context into source,
scientific, analysis, and tile-runtime construction. The visible snapshot separates logical source
reads from physical transfers and cache hits. It also reports unique primary-source coverage,
decoded blocks, cache admissions and retained bytes, cancellation, managed leases and bytes,
provider selection, and a bounded recent timeline.

Evidence is proof of the observed session only. A cache hit does not imply a network transfer, a
logical read does not imply a physical request, and source size is not reported as fetched bytes.
The live export is the JSON-safe measured snapshot shown by the application. The finalized evidence
session remains the authoritative full `ExecutionEvidenceReport` for integrations that retain it.

## 13. Demo dataset and licensing policy

A checked-in TypeScript generator creates the small deterministic fixture and its manifest. It has a
bright central beam, displaced diffraction disks, two scan regions, and a nontrivial annular signal.
Tests derive exact virtual maps and scan reductions from the generator rather than opaque handwritten
binary output. The documentation site ships only this small same-origin fixture.

The credible real validation path is the existing CC-BY-4.0 Zenodo 4D-STEM DigitalMicrograph dataset used by
LiberTEM. Its opt-in verifier records the URL, attribution, license, SHA-256, 342 by 213 scan shape,
128 by 128 detector shape, sample type, 1.19 GB source size, CORS result, Range result, and bounded
bytes fetched. Normal CI does not contact it and the site does not claim a live multi-gigabyte demo
unless hosting behavior remains independently verified. The focused linked worker currently opens
processed MIB plus an optional HDR sidecar. DM4 remains available through the generic scientific
reader and its opt-in verifier, but it does not enter the linked 4D workspace until its descriptor
proves the four axis roles required by this application.

## 14. Browser performance budget

The built-in fixture should open and paint an initial linked view within 1 second in the focused
Chromium harness. A virtual detector update and a scan-region reduction should complete within 250
ms for the fixture after warmup. Cursor response should begin within one animation frame, with stale
work cancelled rather than queued.

No benchmark may allocate `scanX * scanY * kx * ky * sampleBytes`. Benchmarks record open, virtual
detector, scan reduction, cursor interaction, source bytes, output correctness, peak managed bytes,
and cache behavior. These fixture budgets are regression gates, not universal claims about hardware
or remote datasets.

## 15. Accessibility and failure behavior

Every canvas has an accessible name and a nearby text summary. ROI tools, reduction mode, scan
position, dataset, axes, and evidence export are keyboard operable. Focus remains visible. Color is
not the only selection cue, and palettes include a grayscale option. Motion is minimal and respects
reduced-motion preferences.

Malformed input, ambiguous detection, missing companions, unsupported axis roles, limits,
cancellation, and worker failure produce distinct plain-language messages. A worker failure offers a
restart that returns to a safe unopened state. No failure silently changes the selected reader,
materializes a complete dataset, or uploads data.

## 16. Implementation checklist and acceptance gates

- [x] Record the host decision and architecture boundary before implementation.
- [x] Add the explicit `purejsimage/analysis/4d-stem` operation bundle with no import side effects.
- [x] Prove descriptor and parameter validation, ROI semantics, precision, release, limits, and
      cancellation with focused tests.
- [x] Generate the deterministic fixture and exact expected reductions from TypeScript.
- [x] Add the versioned worker protocol and worker-owned source, dataset, runtime, controller, and
      evidence lifecycle.
- [x] Add the polished linked navigation and diffraction workspace at `/4d-stem/`.
- [x] Generate the browser reader catalog from authoritative capability data and dynamically load
      likely readers without treating hints as proof.
- [x] Verify MIB frame, HDR, axis, orientation, region, type, malformed-input, remote, cancellation,
      identity, and read-limit behavior for the flagship workload.
- [x] Keep Velox 4D-STEM unclaimed unless a real descriptor and fixture prove four axis roles.
- [x] Record the real DM4 dataset provenance and keep normal CI network-independent.
- [x] Add generic explorer, 4D semantics, worker, cancellation, evidence, and browser tests.
- [x] Add a reproducible simulated-range operation benchmark and assert that a bounded virtual
      detector viewport does not read the complete 4D source or a complete detector frame.
- [x] Add the user guide, API example, navigation, README, roadmap, changelog, and generated social
      screenshot.
- [x] Pass focused tests, package checks, real Chromium, docs build, size checks, and `npm run check`.
