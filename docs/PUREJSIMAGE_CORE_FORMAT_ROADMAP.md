# PureJsImage core format compatibility roadmap

Repository state inspected:

- `a-r-d/PureJsImage` at `c3ba42a6a2b1f10cc66d7df7115f1c7e3a6b852d`
- `a-r-d/PureJsImage-LabViewer` at `1e222dc8b8226285651571020c53a157a81cf11a`
- Inspection date: 2026-08-14

## Executive decision

Do not start by building HDF5.

The highest-leverage first milestone is to make the Lab Viewer consume format support that PureJsImage already has, while adding calibration semantics that every later vendor reader can reuse:

1. Add a reusable scientific-reader adapter for ordinary image codecs.
2. Add a native-precision ordinary TIFF scientific reader.
3. Add structured calibration provenance to scientific axes.
4. Add fixture-backed TIFF calibration profiles for FEI/Thermo, Zeiss, ImageJ, DigitalMicrograph TIFF, and selected sidecar conventions.
5. Integrate those readers in Lab Viewer before beginning a new container subsystem.

At the moment, Lab Viewer dynamically loads only seven scientific readers: GSF, ENVI, FITS, MRC, CBF, OME-TIFF, and Aperio SVS. A normal PNG, JPEG, WebP, JP2, or non-OME TIFF is therefore not opened through its worker, even though PureJsImage already decodes those formats. That is the most immediate compatibility gap.

After that milestone, implement original TEM files in this order:

1. Gatan DM3/DM4 images and multidimensional numeric datasets.
2. FEI/Thermo TIA SER, then EMI companion metadata.
3. A deliberately scoped pure-TypeScript HDF5 substrate.
4. NCEM EMD and Velox EMD image datasets as separate dialect readers.

HDF5 is strategically important, but Claude substantially underestimated it. It is not one reader comparable to MRC or CBF. It is a container runtime with multiple generations of group indexes, object headers, heaps, datatypes, layouts, chunk indexes, and filters. Treat it as a multi-PR subsystem, then make each instrument dialect prove its own metadata and calibration mapping.

## Corrections to the supplied analysis

| Claim in the supplied analysis | Repository or source reality | Roadmap consequence |
| --- | --- | --- |
| TIFF Deflate, PackBits, Predictor 2, and Predictor 3 should be added first | All are already implemented and tested. TIFF also has LZW, CCITT, old/new JPEG, Aperio JPEG 2000, Zstd, LERC, WebP composition, SGILog, packed 1/2/4/6/8/10/12/14/16/24/32/64-bit samples, BigTIFF, tiles, strips, SubIFDs, and HTTP ranges. | Do not schedule this work again. Concentrate on scientific reader composition and metadata profiles. |
| JPEG 2000 is a missing TIFF codec | PureJsImage already has a first-party JP2 decoder and uses it for Aperio compression 33003 and 33005. | Expand fixture coverage only when a real unsupported JP2 feature appears. |
| A pure-TypeScript HDF5 reader is roughly the same effort as existing scientific format work | HDF5 datasets may require old symbol tables and local heaps, compact or dense links, fractal heaps, B-tree v1 and v2, several chunk-index types, object header v1 and v2, datatypes, dataspaces, attributes, and filter pipelines. | Split HDF5 into at least five implementation PRs before any dialect reader. |
| HDF5 unlocks eight formats in one step | It unlocks a shared byte/container substrate. Velox EMD, NCEM EMD, HSpy, DATX, H5OINA, H5EBSD, NeXus, and detector variants still require separate path, metadata, axes, units, and semantic readers. | Count each dialect as separate product work and separate conformance work. |
| FEI SEM metadata uses TIFF tags 34681 and 34682 | Current `tifffile` identifies FEI SFEG as 34680 and FEI Helios as 34682. Zeiss `CZ_SEM` 34118 is correct. | Do not encode Claude's 34681 claim. Use versioned profiles and real fixtures. |
| JEOL calibration is generally a separate `.txt` sidecar | Some Hitachi SEM families use text plus image. JEOL SightX can store structured metadata in `ImageDescription`. Vendor behavior varies by product and software version. | Name profiles by actual producer/software family, not only by vendor. Never infer a sidecar convention without a fixture. |
| OME-NGFF has an HDF5 profile | The current released OME-NGFF 0.5 specification is OME-Zarr and adopts Zarr v3. | Remove this item from the HDF5 justification. OME-Zarr is a separate storage and codec track. |
| `h5wasm` is a natural optional production path in this repository | Current repository rules prohibit runtime-importing or vendoring a third-party production implementation. Optional WASM accelerators must follow the repository's first-party model. | Use `h5wasm`, HDF5 C tools, or h5py only as development oracles. Do not ship them inside PureJsImage. |

## What already exists and should be reused

### Codec and compression substrate

PureJsImage already has explicit codec entries for JPEG, PNG, WebP, BMP, TIFF, GIF, ICO, AVIF, JPEG 2000, JPEG XL, HDR, QOI, Netpbm/PFM/PAM, and TGA. HEIF/HEIC correctly remains an explicit experimental opt-in.

The existing reusable pieces include:

- first-party JPEG 2000 decoding;
- first-party Zstd decoding;
- comprehensive TIFF strip, tile, native-raster, and tag access;
- bounded public `TiffDirectory.getTag()` and `getTagInfo()`;
- a deterministic `TiffProfileRegistry` that is suitable for vendor metadata profiles;
- `ImageSource` random access and `HttpRangeSource`;
- source identity and source-session lifecycle support;
- portable browser and Node companion resolvers;
- explicit reader registries with bounded probes;
- labeled arbitrary-rank scientific axes;
- native numeric `RasterBlock` and `NumericTile` paths;
- OME-TIFF and Aperio pyramid bridges.

### Current scientific readers

- GSF
- ENVI
- FITS
- MRC / CCP4
- CBF / imgCIF
- OME-TIFF
- Aperio SVS

### Important existing design decisions

- Readers are explicit imports rather than global registrations.
- Large sources remain lazy and range-backed.
- Companion files are already part of `ScientificOpenContext`.
- Lab Viewer consumes only public package paths.
- Vendor format readers belong in PureJsImage. Domain workflows and UI belong in Lab Viewer or a materials extension.

These decisions are good. The format roadmap should extend them rather than introduce a second plugin, source, or dataset system.

## Required platform additions

### 1. Calibration provenance as a first-class contract

Current scientific axes contain coordinates and an optional unit, but not a normalized explanation of where the calibration came from. Lab Viewer can display `0.52 nm/px`, but it cannot reliably say whether that came from a Zeiss private tag, an FEI formula, an EMI sidecar, a format header, or a user override.

Add optional evidence contributors to `ScientificAxisDescriptor`:

```ts
export interface ScientificCalibrationEvidence {
  readonly kind: 'embedded' | 'sidecar' | 'derived' | 'format-default'
  readonly resourceId: string
  readonly locator: string
  readonly formula?: string
  readonly note?: string
}

export interface ScientificAxisDescriptor {
  // existing fields
  readonly calibration?:
    | ScientificCalibrationEvidence
    | readonly ScientificCalibrationEvidence[]
}
```

Rules:

- `coordinates` and `unit` remain the authoritative normalized numeric calibration.
- `calibration` explains one source or the ordered contributors to a combined interpretation.
- `locator` is stable and machine-readable, for example `tiff:tag:34682/Scan/PixelWidth`, `dm:ImageList/0/ImageData/Calibrations/Dimension/0`, or `companion:sample.txt/PixelSize`.
- A derived calibration records the input fields and a short formula identifier.
- A reader does not report physical units when required metadata is missing or contradictory.
- Manual project overrides remain a Lab Viewer workspace concern. They must not be written back into the source reader's evidence.
- X and Y evidence is recorded separately so anisotropic calibration remains honest.

Acceptance gates:

- descriptor validation, normalization, freezing, and persistence tests;
- no change to existing uncalibrated datasets;
- exact evidence assertions for GSF, MRC, OME-TIFF, and one synthetic sidecar reader;
- Lab Viewer can show `source`, `derived`, and `uncalibrated` without parsing arbitrary metadata.

### 2. Reusable codec-to-scientific adapter

Add a public adapter that wraps an `ImageCodec` as a `ScientificReader` without copying codec logic:

```ts
createImageCodecScientificReader({
  descriptor,
  codec,
  limits,
})
```

The adapter should:

- probe using the codec's existing detector;
- expose every selectable frame as a dataset or a labeled frame axis according to a documented rule;
- expose codec resolution levels where available;
- convert `PixelBlock` to canonical uint8 scientific `RasterBlock` without a second full-frame allocation;
- preserve red, green, blue, alpha, intensity, and grayscale component semantics;
- preserve source identity, cancellation, and release behavior;
- provide low-confidence fallback detection so specialized scientific readers win;
- remain individually composable so Lab Viewer can lazy-load PNG, JPEG, WebP, BMP, JP2, and other readers by extension.

Do not make HEIC part of an automatic standard-reader bundle.

The first Lab Viewer integration should cover PNG, JPEG, WebP, BMP, and JP2. The same adapter can later expose AVIF, JPEG XL, GIF frame 0, HDR, Netpbm, QOI, and TGA without creating one-off reader architectures.

### 3. Ordinary TIFF scientific reader

Add `purejsimage/scientific/readers/tiff`. Do not route ordinary scientific TIFF through an 8-bit RGBA adapter.

Initial contract:

- native precision and native components through `TiffDirectory.createRasterDecoder()`;
- one dataset per incompatible top-level image series;
- compatible pages represented as a labeled page, Z, time, or index axis only when metadata justifies that interpretation;
- SubIFDs represented as resolution levels;
- planar and interleaved N-channel data preserved;
- signed integer and floating-point samples preserved;
- top-level and selected private metadata exposed in bounded normalized form;
- generic TIFF probe confidence lower than OME-TIFF and Aperio SVS;
- no guessing that a multipage file is a Z stack;
- no implicit RGB display mapping for arbitrary multiband numeric data.

This reader is the foundation for SEM TIFF profiles and for ordinary multipage engineering TIFF.

### 4. TIFF calibration and acquisition profiles

Use the existing `TiffProfileRegistry`. Create small first-party profiles with their own probes, parsers, fixtures, and evidence locators.

Implement in this order:

1. Standard TIFF resolution tags plus explicit unit policy.
2. ImageJ `ImageDescription` unit and spacing.
3. DigitalMicrograph TIFF tags 65003-65025 for axis units, scales, offsets, and intensity calibration.
4. FEI SFEG tag 34680 and FEI Helios tag 34682, with INI parsing and exact `PixelWidth` / `PixelHeight` preference.
5. FEI derived field-of-view fallback only when exact fixture families prove the formula.
6. Zeiss `CZ_SEM` tag 34118, including the unnamed values and named `AP_*` / `SV_*` fields needed by validated files.
7. TVIPS pixel size metadata if fixture demand justifies it.
8. JEOL SightX embedded metadata.
9. Hitachi S-3700/S-4800 text-plus-image profile through the existing companion resolver.
10. Tescan only after obtaining and independently validating real files. Do not ship a guessed `.hdr` parser.

Each profile must return:

- normalized X/Y origin, step, and unit;
- calibration evidence;
- instrument manufacturer, model, software, acquisition date, accelerating voltage, working distance, dwell time, and detector only when present and unambiguous;
- the bounded raw profile metadata under a namespaced object for inspection;
- warnings for contradictory calibration sources rather than silently choosing one.

A4 implements the first three profiles. Standard TIFF resolution is normalized to micrometers:
`ResolutionUnit=1` remains uncalibrated, inch and centimeter units are converted exactly, and an
omitted unit follows the TIFF 6.0 inch default with an explicit warning and evidence note. ImageJ
uses `ImageDescription` units, inverse X/Y resolution, pixel-origin semantics, and `spacing` only
for a validated single-channel Z stack. DigitalMicrograph uses coherent typed tuples from tags
65003-65011 and 65022/65024/65025; this stricter probe avoids the ASCII-only EPICS areaDetector
tag collision. Malformed profile metadata produces warnings or an uncalibrated dataset without
blocking generic pixel reads.

### 5. Rank-1 scientific series reads

**Status: Complete.** `ScientificDataset` now accepts one true axis when its descriptor explicitly
advertises `planeReads: { kind: 'none' }` and a native `seriesReads` capability for that axis.
`readSeries()` returns bounded, tightly packed canonical big-endian `ScientificSeriesBlock`
segments with no synthetic display dimension. `normalizeScientificSeriesReadRequest()` validates
the selected axis, fixed indices, resolution level, range, region capability, and cancellation
before I/O. `readScientificSeriesFromPlane()` provides the planned bounded fallback for extracting
one row or column from an existing plane reader, compacting one emitted source block at a time and
preserving source release ownership.

Previously, `ScientificDataset` required at least two axes and its primitive was a two-dimensional
plane. That works for spectrum images but does not honestly represent a single EDS/EELS spectrum,
Nanonis spectroscopy curve, or surface profile.

The implemented incremental series API is:

```ts
export interface ScientificSeriesReadRequest {
  readonly axisId: string
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly resolutionLevel?: number
  readonly start?: number
  readonly length?: number
  readonly signal?: AbortSignal
}

export interface ScientificSeriesBlock {
  readonly start: number
  readonly length: number
  readonly format: RasterFormat
  readonly data: Uint8Array
  readonly release?: () => void
}
```

Implemented contract change:

- allow one-axis descriptors;
- add a descriptor capability for native series reads;
- add `readSeries()` to scientific datasets that support it;
- provide an adapter that can extract a one-row or one-column series from an existing plane reader;
- preserve lookup axes for non-uniform energy or time coordinates;
- keep plot construction and peak annotation in Lab Viewer.

### 6. Scientific reader capability manifest

**Status: Complete.** `capabilities/manifest.json` now contains a separately validated and generated
`scientificReaders` collection for every public reader. Public JSON and test expectations carry the
stable descriptor, package export, input hints, resource model, dataset kinds, direct-range claim,
support boundary, evidence, and fixture locations.

The current capability manifest mixes photographic codecs, scientific formats, and the Nanoscope investigation. Lab Viewer then duplicates reader descriptors in `worker-readers.ts`.

Extend the generated capability source with a separate `scientificReaders` section. Generate:

- stable reader descriptors;
- documented package export paths;
- extensions and media types;
- resource model: single, companion pair, companion set, or directory-like;
- dataset kinds: image, volume, spectrum image, spectrum, surface, pyramid, orientation map;
- range-read capability;
- current support boundary;
- evidence links and fixtures.

Lab Viewer can still own its lazy import functions, but CI should compare its advertised readers to this generated core manifest so the two lists cannot drift.

## Milestone A: existing raster compatibility

This should ship before DM4 or HDF5.

| PR | Status | Scope | Size | Definition of done |
| --- | --- | --- | --- | --- |
| A1 | Complete | Calibration evidence contract | Small | Existing readers populate one or more evidence contributors where possible; descriptor and migration tests pass. |
| A2 | Complete | Codec-to-scientific adapter | Medium | PNG, JPEG, WebP, BMP, and JP2 open lazily through the public scientific registry with exact pixels, cancellation, identity, and bounded blocks; experimental HEIC remains excluded. |
| A3 | Complete | Ordinary TIFF scientific reader | Medium | Native uint16, int16, float32, RGB, multipage, tiled, and SubIFD fixtures open without OME/Aperio regressions. |
| A4 | Complete | TIFF standard, ImageJ, and DM-TIFF calibration profiles | Medium | Exact X/Y/Z scale and origin match independent readers. |
| A5 | Complete | FEI and Zeiss SEM TIFF profiles | Medium | At least two independently produced fixture families per profile; calibration and acquisition metadata match the oracle. |
| A6 | Planned | Lab Viewer reader integration | App repo | PNG, JPEG, WebP, BMP, JP2, ordinary TIFF, OME-TIFF, and SVS all open through the worker with specialized-reader precedence. |

Release gate for the milestone:

- opening a normal TIFF no longer falls through OME-TIFF and Aperio only;
- every physical measurement can state the calibration source;
- a private tag profile never causes a generic TIFF pixel decode failure;
- edited TIFFs that lost vendor tags are clearly uncalibrated;
- probes remain within the shared probe budget;
- remote tiled TIFF still fetches only intersecting ranges.

## Milestone B: DigitalMicrograph DM3/DM4

DM3/DM4 is the highest-value new vendor reader because it directly addresses common TEM/STEM originals and needs no general compression subsystem.

### B1. Tag-tree indexer

**Status: Complete.** The package-private indexer is implemented with generated DM3/DM4 structural
fixtures. Real instrument files and oracle-backed pixel semantics remain part of the B2 acceptance
corpus; B1 does not advertise a public scientific-reader capability on its own.

Build an internal random-access DM container index:

- DM3 32-bit and DM4 64-bit count/length/offset fields;
- file byte order and tag payload byte order handled separately;
- nested tag groups with maximum depth and maximum tag count;
- scalar, string, array, struct, and array-of-struct descriptors required by fixtures;
- payload spans indexed without reading large arrays;
- duplicate names represented deterministically rather than overwritten;
- offsets parsed through `bigint`, then rejected if outside the safe `ImageSource` address range;
- exact bounds and allocation checks before every read;
- bounded metadata projection that excludes image payload arrays.

### B2. Common image datasets

**Status: Complete.** The explicit `purejsimage/scientific/readers/digital-micrograph` entry exposes
supported DM3/DM4 ImageList entries independently, preserves rank-2 through rank-4 dimension order,
and reads selected X/Y rows directly from indexed payload spans. The reader supports all listed
scalar types plus the Gatan-produced packed BGRA layouts proven by the pinned corpus. It maps
dimension and brightness calibration, initially kept higher dimensions neutral pending B3, and publishes bounded
metadata under `purejsimage:gatan`. A reproducible compatibility workflow pins 13 RosettaSciIO
fixtures by revision and SHA-256 while intentionally leaving their GPL-3.0 binaries out of the MIT
repository. Complex/packed-complex, undocumented packed, encrypted, external, malformed, rank-1,
and rank-outside-2-through-4 cases fail or are reported with exact boundaries.

Expose every supported `ImageList` entry as a separate scientific dataset:

- 2D grayscale images;
- 3D volumes/stacks;
- common 4D numeric arrays;
- signed and unsigned 8/16/32-bit integers;
- float32 and float64;
- common packed RGB/RGBA forms only when fixtures prove layout;
- exact dimension order;
- `Calibrations/Dimension/*` origin, scale, and units;
- intensity calibration when present;
- microscope/acquisition metadata under a bounded Gatan namespace;
- selected-region reads calculated directly from the array span.

Initially reject, with exact errors:

- unsupported complex data layouts;
- undocumented packed or interleaved types without fixtures;
- encrypted or externally referenced content;
- malformed tag trees;
- one-dimensional signals until the series contract exists.

### B3. Multidimensional semantics

**Status: Complete.** Rank-2 images map to X/Y and ordinary rank-3 arrays map to X/Y/Z. EELS
spectrum images map to X/Y/energy only when the same image carries exact Gatan
`Meta Data/Format = Spectrum image`, `Meta Data/Signal = EELS`, and an `eV` third-axis
calibration. A 4D array maps to logical scanX/scanY/kx/ky axes only when exact diffraction format,
C-order, 2D-array application mode, and scan width/height tags jointly identify the physical
kx/ky/scanX/scanY storage roles. Partial evidence and arbitrary rank-4 arrays retain
dimension-0 through dimension-3. The semantic evidence paths are recorded under
`purejsimage:gatan.axisSemantics`.

The local corpus now includes a small Gatan-produced DM4 X/Y/Z volume and the existing real EELS
spectrum image. A separate bounded remote verifier checks the 1.19 GB CC-BY-4.0 Zenodo 4D-STEM
fixture used by LiberTEM without downloading it: descriptor discovery and a pinned raw sample
window fetch 188,459 bytes through HTTP ranges.

Add fixture-backed mappings for:

- ordinary X/Y images;
- X/Y/Z volumes;
- EELS spectrum images as X/Y/energy;
- 4D-STEM as scanX/scanY/kx/ky only when metadata identifies those roles;
- otherwise preserve neutral `dimension-0` names instead of inventing semantics.

The reader should never decide that four dimensions imply 4D-STEM.

### DM acceptance corpus

At minimum:

- one small DM3 image;
- one DM4 TEM image;
- one DM4 volume;
- one DM4 EELS or EDS spectrum image;
- one DM4 4D-STEM dataset;
- big- and little-payload byte-order cases if both occur;
- a file with multiple `ImageList` entries;
- malformed depth, count, offset, array-type, and truncated-payload cases.

Oracle outputs must include descriptor JSON, selected raw sample windows, axis calibration, metadata subset, and bytes read. RosettaSciIO can be a development oracle, but its own documentation says DM coverage is incomplete, so one oracle is not sufficient evidence for every accepted variant.

## Milestone C: FEI/Thermo TIA SER and EMI

The existing companion resolver already provides the required architecture. No new multi-file abstraction is needed. The rank-1 series prerequisite above is complete, so C1 can represent native spectra without inventing a second axis.

### C1. SER

**Status: Complete.** The explicit `purejsimage/scientific/readers/tia-ser` entry detects the
little-endian SER signature and versions 0x0210/0x0220, indexes bounded dimension and element
metadata without reading sample payloads, and exposes compatible scalar spectra, spectrum images,
and image series with native calibration. Direct reads return canonical bytes, preserve SER image
row orientation, and report unsupported, invalid, truncated, or excess elements without treating
missing EMI metadata as present.

The acceptance workflow pins five real RosettaSciIO TIA fixtures by revision and SHA-256 without
committing their GPL-licensed binaries. It covers both header versions, int32 and uint32 spectra,
float32 and int32 images, a point spectrum, square and non-square spectrum-image calibration, and a
five-image series. Exact descriptor, calibration, sample-window, and direct-read checks complement
the first-party structural fixtures used in the regular test and browser suites.

- detect by bytes, not extension;
- support common 1D and 2D series types;
- parse versioned headers, dimensions, calibration records, offset arrays, element type, and valid-element count;
- expose each element or compatible element collection without reading all payloads;
- represent image series and spectrum images honestly;
- tolerate missing EMI by exposing only metadata actually present in SER;
- preserve invalid/truncated element handling as explicit document metadata rather than indexing beyond valid data.

### C2. EMI

**Status: Complete.** The explicit `purejsimage/scientific/readers/tia-emi` entry detects the TIA
EMI binary signature, extracts bounded embedded `ObjectInfo` XML through the portable parser, and
resolves consecutive numbered SER companions through `ScientificCompanionResolver`. Each SER-backed
dataset retains native precision and lazy payload reads, gains its matching acquisition metadata,
and identifies both the EMI and contributing SER resource. SER calibration remains authoritative;
EMI diffraction mode changes spatial interpretation only when the SER calibration magnitude
corroborates reciprocal space, while contradictory hints are preserved as metadata conflicts.

The acceptance workflow pins four real RosettaSciIO EMI groups and seven SER companions by revision
and SHA-256 without committing their GPL-licensed binaries. It covers old and new TIA output, one
and multiple companions, more SER resources than XML records, unused XML records, exact UUID
mapping, reciprocal-space interpretation, preserved conflicts, and exact image and spectrum sample
windows. Direct SER opening remains independently supported, while EMI is the richer preferred path
when its companions are present.

- bounded XML parsing through the existing portable XML utilities;
- resolve every referenced SER through `ScientificCompanionResolver`;
- allow an EMI file to expose multiple SER-backed datasets;
- merge EMI acquisition metadata and calibration without overwriting contradictory SER facts;
- include every contributing resource in dataset identity;
- support opening SER directly and opening EMI as the preferred richer path.

## Milestone D: pure-TypeScript HDF5 substrate

### Scope rule

Do not promise general HDF5 compatibility in the first release. Promise the exact structural subset exercised by the first EMD corpus, and make every unsupported structure report its object path, message/layout version, filter ID, or datatype class.

### D1. File and address layer

**Status: Complete.** The package-private D1 layer locates signatures only at legal user-block
offsets, parses superblock versions 0 through 3 with all HDF5-supported 2/4/8/16-byte offset and
length widths, applies the specified base-address relocation rule, and retains on-disk addresses as
`bigint` until declared EOF and `ImageSource.size` bounds permit conversion. Modern superblocks
verify the HDF5 lookup3 checksum. A caller-owned metadata page cache is byte/read bounded, true-LRU,
source-identity checked, cancellation aware, and safe for weakest-lifetime source buffers. Legacy
family, multi-file, and unknown driver blocks are rejected explicitly; D1 also rejects modern
superblock extensions until D2 can parse their object-header driver messages rather than guessing.
Exact independently generated h5py 3.14.0 / HDF5 1.14.6 byte fixtures cover clean superblock v2,
clean superblock v3, and a 512-byte user block in addition to generated hostile geometry.

- locate the HDF5 signature at legal user-block offsets;
- superblock versions 0, 1, 2, and 3;
- variable offset and length widths;
- base address, end-of-file address, root object address;
- metadata checksum verification where applicable;
- all on-disk addresses parsed as `bigint` and bounded against `ImageSource.size` before conversion;
- bounded metadata page cache with source identity awareness.

Explicitly reject multi-file family/multi drivers in the first version.

### D2. Object and group graph

**Status: In progress.** The first package-private D2 slice parses object header versions 1 and 2,
including aligned v1 messages, packed and checksummed v2 chunks, optional v2 prefix fields, nested
continuation chunks, compact hard and soft links, and compact-versus-dense link-info descriptors.
Addresses remain `bigint` through bounds validation, object-path-aware errors identify unsupported
mandatory messages and link classes, and configurable byte, message, continuation, link-name, and
soft-target limits bound hostile metadata. Old symbol-table groups now traverse bounded local-heap
free lists, group B-tree v1 internal and leaf nodes, and `SNOD` entries to expose ASCII hard and
soft links, including validated cached subgroup metadata. Modern dense groups now traverse
checksummed fractal-heap headers, root direct and recursive indirect managed blocks, seven-byte
managed heap IDs, and type-5 B-tree v2 leaf and internal nodes. The dense path validates block
geometry, checksums, record ordering and name hashes while bounding aggregate metadata, heap
objects, blocks, tree depth and nodes, links, names, targets, table width, and heap address space.
A reproducible compatibility workflow pins the HDF Group's `tgroup.h5` and `h5repack_objs.h5`
fixtures by source revision and SHA-256 without committing their binaries. The first verifies the
three legacy root links; the second verifies a real 40-record dense index before reaching the
intentional external-link rejection. A package-private object graph now resolves absolute paths
across compact, legacy, and dense groups, follows containing-group-relative and absolute soft links,
preserves dangling links as unresolved, and bounds aggregate objects, links, metadata, path bytes,
hard-link depth, and soft-link traversals. The pinned legacy and dense fixtures also run through
this graph boundary. Huge and tiny heap objects, filtered heaps, the secondary creation-order index,
and required attributes remain pending before D2 is complete.

- object header versions 1 and 2;
- continuation chunks;
- compact links in object headers;
- old symbol-table groups with local heaps and B-tree v1;
- dense modern links with fractal heaps and B-tree v2;
- hard links;
- bounded soft-link resolution if required by fixtures;
- cycle detection, link depth, object count, heap size, and metadata byte limits;
- compact and dense attributes required by the selected files.

External links and user-defined links remain unsupported initially.

### D3. Datatypes, dataspaces, and layouts

**Status: Complete for the initial corpus.** The package-private D3 layer parses scalar and simple dataspace
messages in versions 1 and 2, preserving finite current extents and explicit unlimited maxima while
bounding rank, individual dimensions, and aggregate element counts before later storage planning.
It also parses datatype message versions 1 through 3 for fixed signed/unsigned integers, exact IEEE
binary16/32/64 floating-point layouts, fixed ASCII or UTF-8 strings, integer-backed enums, and flat
scalar compounds. Integer byte order, precision, offset, and low/high padding are retained; enum
values remain exact bigints; and compound member names, offsets, types, and storage bounds are
preserved. Member count, name bytes, and nesting depth are bounded, while malformed fields are
distinguished from valid but unsupported layouts. Dataset metadata resolves committed shared
dataspace, datatype, layout, and fill messages using locator versions 1 through 3 with depth and
cycle limits. Shared-object-header-message heap locators remain an explicit unsupported boundary.
Null/permuted dataspaces, VAX or non-IEEE floats, nested or overlapping compounds, compound array
members, and unsupported datatype classes also reject explicitly.

The layout layer parses compact, contiguous, and chunked messages in versions 1 through 4,
retaining classic B-tree v1 and every modern single, implicit, fixed-array, extensible-array, and
B-tree v2 index descriptor without traversing those indexes before D4. It bounds declared storage,
compact payload, decoded chunk, fill-value, and requested raw-read bytes; validates layout rank,
dimensions, element size, allocated addresses, and datatype-sized fills; and distinguishes
absent/default-zero, undefined, and defined old or version 1 through 3 fill semantics. Element-aligned
raw ranges are available for compact and contiguous storage, including exact fill materialization
for unallocated datasets. External raw storage, contradictory fill messages, and chunked raw reads
before D4 reject explicitly. Revision- and SHA-256-pinned HDF Group fixtures verify real version 3
compact, contiguous, and chunked datasets, a version 4 fixed-array chunk descriptor, a committed
enum datatype using a legacy contiguous layout, and a version 1 compound datatype. The verifier
checks exact datatype members and raw samples without committing the licensed binaries. Chunk-index
traversal and filters move to D4/D5; HDF5 remains package-private with no capability claim.

Initial dataset subset:

- scalar and simple dataspaces;
- fixed-width signed/unsigned integers and IEEE floats;
- fixed-length strings;
- enums and simple compounds only when required for metadata;
- byte order, precision, offset, and padding validation;
- compact, contiguous, and chunked layouts;
- fill values;
- unlimited dimensions only where the stored current extent is finite and safe.

Initially reject:

- arbitrary object/region references as scientific samples;
- virtual datasets;
- external raw storage;
- variable-length numeric arrays;
- unsupported nested compounds;
- int64 scientific raster output until PureJsImage has an exact signed-64-bit sample contract.

### D4. Chunk indexes and hyperslab planner

Support the chunk index types proven necessary by the corpus:

- classic chunk B-tree v1;
- single-chunk and implicit indexes;
- fixed arrays;
- extensible arrays;
- chunk B-tree v2.

The planner must:

- calculate only chunks intersecting the requested scientific plane region;
- preserve dimension order and partial-edge chunks;
- validate chunk coordinates and encoded spans before reads;
- bound live encoded bytes, decoded bytes, filter scratch, and output blocks;
- avoid enumerating millions of chunk records merely to display one tile;
- cache metadata indexes separately from decoded chunks;
- support cancellation between chunk reads and filter stages.

D4 is complete for the internal HDF5 layer. A bounded hyperslab planner enumerates only the
intersecting chunk coordinates in dataset order, retains exact partial-edge and output geometry,
and rejects unsafe selections or working sets before I/O. Targeted index lookup supports classic
chunk B-tree v1, single and implicit indexes, paged and unpaged fixed arrays, extensible-array index,
data, super-block, and paged data storage, plus leaf and internal chunk B-tree v2 nodes. Every
metadata structure, checksum, coordinate, encoded span, traversal depth, node count, and metadata
byte total is validated before a raw chunk read. The encoded-block stream keeps at most one encoded
chunk live, preserves per-chunk filter masks for D5, and checks cancellation around metadata and raw
reads. Index bytes remain in the existing bounded metadata cache; no decoded-chunk cache or public
HDF5 export is introduced. Generated hostile fixtures cover planner limits, checksums, internal-node
branch selection, extensible-array super blocks, cancellation, and isolated sibling reads. An exact
SHA-256-pinned h5py 3.14.0 / HDF5 1.14.6 fixture verifies every modern index family, while the pinned
HDF Group corpus independently verifies classic B-tree v1 and fixed-array lookup with exact raw
chunk prefixes. Filter execution and decoded scientific blocks remain D5.

### D5. Filter pipeline

Required first:

- raw/no filters;
- Deflate;
- Shuffle;
- Fletcher32 verification;
- correct reverse-order decoding of filter pipelines;
- per-chunk filter masks;
- explicit errors for N-bit, Scale-Offset, SZIP, or unknown filters.

Add only after real files require them:

- LZF;
- LZ4 block decoding;
- Blosc 1 with reusable Zstd, zlib, and LZ4 inner codecs;
- Bitshuffle plus LZ4;
- Blosc2;
- ZFP.

Do not let unsupported SZIP or ZFP data return plausible bytes.

D5 is complete for the required internal filter subset. Dataset metadata now parses bounded version
1 and version 2 filter-pipeline messages, including built-in and named-filter layouts, client data,
optional flags, shared-message resolution, and the format's 32-filter ceiling. The decoded-chunk
stream applies active filters in reverse order, supports raw, Deflate, Shuffle, and verified
Fletcher32 data, honors per-chunk masks, requires exact decoded sizes, bounds decompression and
filter scratch, and checks cancellation between stages. Active N-bit, Scale-Offset, SZIP, and
unknown filters fail explicitly with the dataset path and filter identity; masked filters remain
skipped. A revision- and SHA-256-pinned HDF Group file verifies individual Deflate, Shuffle, and
Fletcher32 datasets, the real combined Shuffle/Fletcher32/Deflate pipeline, and N-bit rejection.
Generated hostile tests cover both message versions, corrupt checksums, invalid masks and
parameters, byte limits, and cancellation, while a real Chromium workflow verifies the portable
Deflate path. Optional third-party and specialized filters remain deferred until a real dialect
corpus requires them. HDF5 remains package-private with no general compatibility claim.

### D6. Low-level API and conformance

Keep the HDF5 implementation internal until two independent dialect readers use it successfully. Then consider a read-only `purejsimage/containers/hdf5` export.

Internal surface should be small:

```ts
interface Hdf5File {
  get(path: string): Promise<Hdf5Object | undefined>
  list(path: string): Promise<readonly Hdf5Link[]>
  attributes(path: string, names?: readonly string[]): Promise<readonly Hdf5Attribute[] | undefined>
  readDataset(path: string, selection: Hdf5Selection): AsyncIterable<Hdf5Block>
  close(): void | Promise<void>
}
```

Conformance gates:

- generated fixtures written by at least two HDF5 library versions;
- `h5dump` / h5py descriptor and sample oracles;
- old and modern group storage;
- contiguous and every supported chunk index;
- every supported filter composition;
- user-block signature case;
- corrupted checksum, heap, B-tree, object header, datatype, and chunk cases;
- local and HTTP-range parity;
- exact request and byte budgets for a small region in a large chunked dataset.

D6 is complete for the package-private substrate. A small internal file facade now classifies graph
objects, lists links, caches bounded dataset metadata, and streams exact row-major rectangular
selection blocks from compact, contiguous, and chunked storage. Linear reads coalesce the largest
contiguous suffix instead of reading element by element; chunked reads retain D4/D5's targeted index
lookup and one-decoded-chunk working set, copy only each selected intersection into the yielded
block, and materialize exact fill bytes without allocating a logical dataset. Selection rank,
extent, output bytes, read operations, selected chunks, metadata, encoded data, decoded data, and
filter scratch remain independently bounded. Cancellation is observed before and during reads, and
closing the facade invalidates further operations.

The D1-D5 hostile and independent corpus remains the conformance base for superblocks, user blocks,
old and modern groups, object continuations, datatypes, layouts, every supported chunk index, filter
compositions, and corruption. D6 adds multi-chunk filtered-selection checks against independently
generated h5py 3.14.0 / HDF5 1.14.6 and h5py 3.12.1 / HDF5 1.14.4 files, including a pinned
cross-version Shuffle/Deflate/Fletcher32 selection oracle. Compact and contiguous block assembly,
unallocated chunks, exact local and HTTP-range parity, and a two-request / 5,120-byte local source
budget cover a one-element selection in a dataset declaring one trillion elements. The same facade
executes in real Chromium. HDF5 remains unreachable from package exports and has no compatibility
claim; a public read-only
`purejsimage/containers/hdf5` entry remains gated on successful use by two independent dialect
readers in Milestone E.

## Milestone E: HDF5 dialect readers

### E1. NCEM EMD

Implement first because its hierarchy is cleaner and gives the HDF5 substrate a smaller semantic target.

- identify EMD version and expected root structure;
- expose every image/numeric group as a labeled scientific dataset;
- map dimensions, names, units, and calibration exactly;
- preserve microscope and acquisition metadata;
- selected-plane and selected-region reads remain chunk-bounded;
- Direct Electron `.de5` only after a fixture proves the same contract.

E1 is complete for the initial Berkeley/openNCEM 0.2 subset. The public
`purejsimage/scientific/readers/ncem-emd` entry recognizes integer or decimal-string version
attributes and numeric groups below `/data` or `/signals`; exposes every valid numeric group as a
separate labeled-axis dataset; preserves exact linear or lookup coordinates, units, calibration
evidence, and bounded scalar or array acquisition metadata; and keeps selected plane, region, and
series reads on the HDF5 hyperslab path. Generated hostile fixtures, two independently generated
h5py files, and three revision- and SHA-256-pinned RosettaSciIO application files verify metadata,
sample values, chunk-bounded reads, package generation, and real Chromium execution. Direct Electron
`.de5` remains outside the claim because no fixture has yet proved the same contract.

### E2. Velox EMD images

Keep this a separate reader ID even though the extension is also `.emd`.

- probe by HDF5 paths and Velox metadata, not filename;
- decode image, diffraction, FFT, and dense map datasets that have fully specified numeric arrays;
- parse bounded JSON metadata blobs;
- expose detector/frame choices as axes or datasets rather than silently summing;
- report pruned files with a specific unsupported-variant error;
- preserve positive-frequency-only or uncentered FFT metadata rather than silently modifying samples.

E2 is complete for the initial Velox image subset. The separate public
`purejsimage/scientific/readers/velox-emd` entry probes `/Version` plus the internal `/Data`
hierarchy, parses bounded per-frame JSON, exposes every rank-3 numeric image group as its own
detector dataset with an explicit frame axis, preserves native scalar, DPC complex, and FFT compound
samples, and records positive-half and uncentered FFT storage without reconstructing or shifting it.
Generated fixtures cover hostile JSON, output limits, frame non-summing, FFT storage, and pruned
files. Three revision- and SHA-256-pinned RosettaSciIO files independently verify a TEM stack, DPC
complex data, and positive-half FFT data without committing their GPL binaries.

### E3. Velox spectra

Do not include sparse EDS event streams in E2.

Add them only after:

- rank-1 series reads exist;
- Lab Viewer has a spectrum surface;
- event binning, detector selection, frame selection, summing, overflow, and memory contracts are specified;
- a sparse read can avoid materializing the complete spectrum image when a point or ROI spectrum is requested.

E3 remains blocked by its first external product prerequisite: the current Lab Viewer has analysis
series export but no scientific spectrum viewing surface. Sparse `SpectrumStream` support is not
registered or claimed ahead of that UI and data-model gate.

The implementation contract is nevertheless fixed from the pinned version-11 and EELS/EDS files:

- each `/Data/SpectrumStream/<uuid>` is a separate detector dataset; the reader never adds streams;
- the stored `uint16` value `65535` advances one spatial pixel and every other value is one count in
  that native energy channel; E3 performs no implicit energy rebinning;
- the energy axis uses the bounded `AcquisitionSettings.bincount`, and detector `Dispersion` plus
  `OffsetEnergy` provide embedded eV calibration only when the stream's `BinaryResult.Detector`
  identifies that detector metadata unambiguously;
- X/Y lengths come from the exact integer product of `Scan.ScanSize` and the normalized
  `Scan.ScanArea`, not the full raster size in `RasterScanDefinition`; the marker count for every
  selected frame must agree with that cropped area;
- `FrameLocationTable` entries are monotonic event indices and bound the selected frame. The final
  frame ends at the event dataset extent. `SpectrumImageSettings` frame positions must agree when
  present, and a caller fixes one frame explicitly; E3 does not sum frames;
- a point spectrum is `readSeries({ axisId: 'energy', fixedIndices: [frame, y, x], ... })`. The
  decoder scans only the selected frame up to the requested pixel and keeps one bounded native-bin
  `Uint32Array`; it never materializes an X/Y/energy cube. A missing final gate pulse is accepted only
  for the last pixel of the selected frame;
- counts increment with an explicit `0xffffffff` overflow check. Event bytes, native bins, frame
  table entries, JSON bytes, selected-frame events, source reads, and output bytes all have separate
  positive safe-integer limits; cancellation is checked between bounded event blocks;
- ROI aggregation and detector/frame summing remain higher-level operations over explicit source
  selections. They are not hidden reader defaults.

The package-private HDF5 facade now also resolves one fixed or global-heap variable-length scalar
string under explicit string, heap-collection, heap-object, dataset-read, and cancellation limits.
Generated hostile coverage verifies padding, missing heap objects, and both string and heap limits;
the exact method reads `AcquisitionSettings` from the pinned version-11 stream. This removes the last
container-level metadata gap without registering sparse spectra ahead of the Lab Viewer gate.

The dormant E3 core substrate is also complete behind that gate. It indexes dense spectra and every
separate `SpectrumStream` detector, reads pretty-printed metadata plus bounded acquisition settings,
derives exact cropped X/Y dimensions and native eV calibration, validates monotonic frame tables,
and deliberately leaves the sparse event payload unread during discovery. Its point decoder reads
bounded event blocks only through the selected frame and requested pixel, returns canonical
big-endian `uint32` counts for a native energy interval, and enforces independent frame-event,
event-block, event-read, output-byte, channel, count-overflow, and cancellation boundaries. Generated
hostile fixtures cover malformed geometry, encoding, frame tables, channels, missing gates, and every
limit. Three revision- and SHA-256-pinned RosettaSciIO archives independently verify version-11,
combined EELS/EDS, and empty-selection producer files, including detector counts, cropped shapes,
frame offsets, energy calibration, point-spectrum hashes, and the zero-count case. The GPL fixtures
remain downloaded test oracles and are not included in the package or repository. The generated
metadata and bounded point path also pass in real Chromium. No E3 reader,
manifest capability, browser registration, or package export is added until the required spectrum
surface exists.

### Later HDF5 dialect priority

| Dialect | Priority | Initial supported subset |
| --- | --- | --- |
| DATX | High after EMD | Height/surface arrays, masks, X/Y/Z units, acquisition metadata. |
| H5OINA | Medium | Raw recorded and processed maps exposed separately, Euler/phase components and calibration. No IPF or texture math in the reader. |
| HSpy | Medium-low | Numeric datasets and axes sufficient for interchange. HyperSpy users already have conversion options. |
| H5EBSD | Medium-low | Normalized orientation maps and phases. Rendering belongs in a materials extension. |
| NeXus | Low until a target instrument exists | Only a named application definition with fixtures, never a generic promise to understand all NeXus files. |
| Arina / Quantum / detector HDF5 variants | Request-driven | One named producer/version per reader. |

## Milestone F: AFM, SPM, and surface formats

This can proceed as a separate track after Milestone A. It should not block on HDF5 except for DATX.

Status (2026-08-15): F2, F3, F4, and the reusable ZIP/X3P portion of F5 are implemented and
published as explicit scientific-reader entries. F1 remains deliberately planned: one fully
sampled NanoScope family plus header-only variants do not satisfy the three-family scaling gate
below. ZIP-backed JPK force/curve archives are outside the image subset, and OZX still has no
released stable profile; neither is claimed. See `docs/scientific-surface-formats.md` for the exact
supported boundaries and fixture evidence.

### F1. Bruker Nanoscope SPM images

PureJsImage already contains a good investigation document and a deliberately planned capability. Follow it rather than starting from Claude's short description.

Initial subset:

- Nanoscope III-or-newer image records only;
- explicit content signature, not `.spm` extension alone;
- bounded text header and Ctrl-Z/data boundary;
- channel enumeration;
- exact data offset, dimensions, sample storage, scan direction, and scaling chain;
- independent X/Y physical calibration and Z value units;
- lazy selected-channel region reads.

Explicitly exclude at first:

- force curves;
- force-volume and QNM maps;
- spectroscopy;
- variants whose scale references cannot be reproduced exactly;
- unrelated formats that also use `.spm`.

Do not change the manifest from `planned` to `supported` until at least three acquisition/software families match both a trusted Nanoscope export and an independent reader.

### F2. Nanonis SXM

- SXM image files only;
- text header plus binary scan data;
- all recorded channels and directions as separate datasets/components;
- X/Y calibration, scan offset, angle, bias, setpoint, and channel units;
- explicit Y-direction convention and tests that prevent a silent vertical flip;
- Nanonis DAT spectroscopy waits for rank-1 series reads.

### F3. Igor Binary Wave

Start with IBW v5 numeric 2D-4D waves. Add v2/v3 only after fixtures establish demand.

- endian/version/checksum validation;
- dimensions, data type, scaling, units, notes, and wave labels;
- region reads where layout permits;
- complex waves rejected until complex sample semantics exist.

### F4. Digital Surf SUR/PRO

This is more strategically useful for industrial surface metrology than Gwyddion's native `.gwy` file.

- surface maps and multilayer surfaces first;
- profiles after rank-1 support;
- integer storage with exact scale/offset conversion;
- masks, physical X/Y/Z units, object enumeration, and custom metadata;
- spectral maps only after spectrum UI and semantics exist.

### F5. ZIP-backed formats

Build one bounded range-aware ZIP container instead of separate archive parsers:

- EOCD and ZIP64 central directory;
- normalized safe paths;
- stored and Deflate members;
- CRC verification;
- entry count, central-directory bytes, member bytes, decompression ratio, and total decoded limits;
- remote central-directory and selected-entry range reads;
- `ImageSource` views for stored members;
- clear rejection of encryption and unsupported compression methods.

Then use it for:

- X3P surface exchange;
- JPK image containers;
- OME-Zarr Zip / OZX if the released profile remains stable and useful.

Gwyddion `.gwy`, Nanosurf NID, optical OPD, and other SPM formats should remain request-driven after these higher-value formats.

## Milestone G: OME-Zarr / NGFF

OME-Zarr should be implemented as a separate cloud-native track, not as a side effect of HDF5.

### G1. Resource-root handling

Prove the existing companion resolver can model a selected Zarr root before adding another store abstraction:

- browser directory input selects `.zgroup` / `.zattrs` for v2 or `zarr.json` for v3 as the primary resource;
- all child metadata and chunks resolve by normalized relative name;
- a remote `.zarr/` URL is normalized by the application to the root metadata resource;
- same-origin and traversal protections remain enforced;
- resource count and open-source cache limits are explicit.

Add a new store interface only if a real operation cannot be expressed safely through the current resolver.

### G2. Zarr v2 arrays

- groups, arrays, attributes, shape, chunks, dtype, order, fill value, and dimension separator;
- raw, zlib/gzip, and Blosc 1 as fixture demand requires;
- only intersecting chunks fetched;
- C/F order and endian conversion tested exactly;
- missing chunks return fill values according to spec.

### G3. Zarr v3 arrays and sharding

- `zarr.json` group and array metadata;
- regular chunk grids and chunk key encodings;
- bytes, transpose, gzip, Zstd, and CRC32C codecs as required by selected corpora;
- `sharding_indexed` with index-at-start and index-at-end;
- range reads for only the selected inner chunks when the backing source supports them;
- explicit unsupported-codec errors containing codec names and configuration.

### G4. OME-NGFF mapping

- released 0.4 and 0.5 multiscales required by the chosen corpus;
- axes and coordinate transformations;
- channel names/colors and physical units;
- multiscale levels as scientific resolution levels;
- image datasets first;
- labels, tables, plates, and wells later and only with product demand.

Do not build an OME-Zarr writer in the first reader milestone.

## Milestone H: cheap, useful interchange formats

These should be small independent readers after the foundational contracts are stable.

Status: **initial milestone complete**. Every non-deferred row below has a public explicit reader,
bounded fixture coverage, package/browser validation, capability-manifest entry, and measured size
ceiling. Pinned real RosettaSciIO files verify RPL/RAW, ISO EMSA, BLO, and processed Merlin MIB.
EDAX and Bruker BCF remain intentionally deferred as the table originally specified. Registration
and a representative scenario in the separate Lab Viewer repository remain integration work.

| Status | Format | Priority | Reason and initial contract |
| --- | --- | --- | --- |
| Complete | RPL/RAW | High after series reads | Simple companion pair, widely used for EDS and multidimensional interchange, exact dimensions/type/endian/calibration. |
| Complete | MSA/EMSA | High after series reads | Text spectrum interchange and the cheapest honest entry into spectra. |
| Complete | NRRD | Medium | Common volume interchange. Supports raw and bounded gzip payloads, type/endian, sizes, space directions, origin, and one detached data file. |
| Complete | MHD/MHA plus RAW | Medium | Simple medical/engineering volume exchange, useful for CT without adopting DICOM. |
| Complete | NIfTI-1/2 `.nii` | Medium-low | Useful generic volumes. Uncompressed data stays range-readable; `.nii.gz` is an explicit bounded full-decompression path. |
| Complete | NPY | Medium-low | Cheap arbitrary numeric interchange with intentionally generic axes because calibration is normally absent. NPZ remains outside the initial contract. |
| Complete | BLO | Medium for 4D-STEM | Uint8 diffraction blockfiles with frame validation, navigator, and limited metadata. |
| Complete for processed data | MIB | Medium for 4D-STEM | U08/U16/U32 detector frames and optional HDR metadata; packed raw R64 words reject explicitly. |
| Complete for rectangular grids | ANG / CTF | Medium-low | Raw Euler/phase/confidence components; IPF colors and grain math remain outside the reader. |
| Deferred as planned | EDAX SPC/SPD/IPR | Later | Valuable EDS compatibility, but needs rank-1 plots, companion calibration, and spectrum-image workflows. |
| Deferred as planned | Bruker BCF | Later | Hybrid virtual filesystem, XML, compressed binary, images, and hyperspectral EDS. It is not a cheap single reader. |

## Codec and byte-encoding backlog

### Already implemented, do not schedule again

- TIFF PackBits
- TIFF LZW
- TIFF Deflate and Adobe Deflate
- TIFF Predictor 2 and floating Predictor 3
- TIFF CCITT variants
- TIFF JPEG and old-style JPEG
- TIFF Aperio JPEG 2000
- TIFF Zstandard
- TIFF LERC and LERC plus Deflate
- explicit WebP-in-TIFF composition
- broad packed TIFF sample depths
- standalone first-party JPEG 2000
- standalone first-party Zstd decode

### Build as reusable primitives when their parent readers need them

| Primitive | First consumer | Contract |
| --- | --- | --- |
| Bounded zlib/Deflate module | HDF5, ZIP, Zarr | Refactor or share the TIFF path without changing its behavior; exact output cap and checksum policy. |
| Shuffle/unshuffle | HDF5 | Bytes per element 1-16, overflow-safe dimensions, in-place or bounded scratch. |
| Fletcher32 | HDF5 | Verify by default; explicit corruption error. |
| CRC32C | Zarr v3 | Streaming verification with bounded state. |
| LZ4 block decode | Blosc/HDF5/Zarr | Exact block-size and output-cap enforcement. |
| Blosc 1 | Zarr and HDF5 | Parse header, validate sizes/flags, support only registered inner codecs, optional byte/bit shuffle. |
| Bitshuffle | Detector HDF5 | Width-aware and block-aware, with exact tail handling. |
| Packed sample unpacker | MIB and detectors | Explicit bits, byte order, bit order, signedness, row stride, and 1/6/10/12/14-bit fixtures. |
| Range-aware ZIP | X3P/JPK/OZX/NPZ | Central-directory limits, CRC, safe paths, selected member reads. |

### Detect and report, but do not implement yet

- SZIP
- ZFP
- arbitrary Blosc2 pipelines
- Snappy
- JPEG-XR
- HTJ2K
- encrypted ZIP
- proprietary Velox pruned EDS storage

## Concrete reader definition of done

Every new reader must satisfy all of the following before it appears as supported:

### Format truth

- byte signature or structural probe, with filename used only as a hint;
- a narrowly written supported subset;
- exact structured errors for recognized unsupported variants;
- no silent fallback from numeric samples to plausible-looking 8-bit output;
- no inferred axis semantics without metadata evidence.

### Scientific truth

- exact sample type, component count, dimension order, axes, origin, scale, unit, and no-data policy;
- calibration evidence per physical axis;
- original vendor metadata bounded and namespaced;
- contradictory or missing calibration surfaced explicitly;
- multiple datasets represented separately rather than silently selecting the first.

### Large-data behavior

- metadata open does not read pixel/event payloads;
- selected regions read only required rows/chunks/frames where the format permits it;
- source reads, decoded bytes, scratch bytes, and live blocks have explicit limits;
- cancellation is observed between independent reads and decode stages;
- every emitted block is released exactly once on success, error, cancellation, and iterator return;
- local and HTTP-range sources produce identical descriptors and samples.

### Evidence

- at least one generated structural fixture and real independently produced fixtures;
- source URL, exact selected file, license, attribution, hash, and expected oracle in a corpus manifest;
- raw-sample windows and calibration values compared against an independent implementation;
- malicious count, extent, offset, recursion, compression, and truncation tests;
- browser package graph and public package-consumer tests;
- a per-reader minified bundle ceiling;
- one Lab Viewer scenario from open to calibrated cursor/measurement.

## Recommended next 14 core PRs

This is the concrete order I would use.

1. Add calibration evidence to the scientific descriptor contract and populate it in existing readers.
2. Add a generated scientific-reader capability manifest distinct from the codec manifest.
3. Add `createImageCodecScientificReader()` and validate it with PNG and JPEG.
4. Add `scientific/readers/tiff` with native precision, pages, and SubIFD levels.
5. Add standard TIFF, ImageJ, and DigitalMicrograph TIFF calibration profiles.
6. Add FEI 34680/34682 and Zeiss 34118 SEM TIFF profiles with real fixtures.
7. Add the DM3/DM4 tag-tree indexer and hostile-input tests.
8. Add DM3/DM4 common 2D/3D image datasets and exact calibration.
9. Add DM4 multidimensional mapping, including neutral 4D and fixture-backed EELS/4D-STEM semantics.
10. Add SER image and spectrum-image support.
11. Add EMI XML and multi-SER companion support.
12. Add rank-1 scientific series reads and adapters.
13. Begin HDF5 with superblocks, addresses, object headers, and compact links only.
14. Continue HDF5 as separate group/index, dataset/chunk, filter, and EMD PRs. Do not collapse the remaining subsystem into one diff.

After PR 6, Lab Viewer should immediately adopt the new raster readers. After PR 11, it should adopt DM and TIA. HDF5 can then proceed without holding the first useful compatibility release hostage.

## Explicitly not now

- full HDF5 writing;
- a generic claim to open arbitrary HDF5 or NeXus;
- CZI/JPEG-XR, ND2, LIF, or broad biological vendor parity;
- DICOM;
- full EBSD indexing, IPF coloring, ODFs, or pole figures in the core reader;
- Velox sparse EDS before the spectrum data model and UI exist;
- Bruker BCF before the simple spectrum formats work;
- all 160-plus Gwyddion formats;
- proprietary scientific-format encoders;
- automatic HEIC registration;
- a runtime dependency on RosettaSciIO, h5wasm, Bio-Formats, Gwyddion, or vendor software.

## Conversion escape hatch

The converter is useful, but it should not muddy the zero-runtime-dependency package.

Ship it as a separate documented tool or script that depends on RosettaSciIO and emits one of:

- OME-Zarr for large multidimensional data;
- ENVI for simple cubes;
- GSF for scalar surfaces;
- MRC for compatible volumes.

The converter should also emit a small provenance JSON containing the original filename, size, hash, converter version, source reader, selected dataset, axes, and calibration. Lab Viewer can import that record with the converted dataset. Do not present converted data as if PureJsImage natively parsed the original file.

## Primary references

- [Current PureJsImage TIFF capability contract](https://github.com/a-r-d/PureJsImage/blob/c3ba42a6a2b1f10cc66d7df7115f1c7e3a6b852d/tiff-codec-support.md)
- [Current PureJsImage scientific reader contract](https://github.com/a-r-d/PureJsImage/blob/c3ba42a6a2b1f10cc66d7df7115f1c7e3a6b852d/src/scientific/reader.ts)
- [Current Lab Viewer reader loader list](https://github.com/a-r-d/PureJsImage-LabViewer/blob/1e222dc8b8226285651571020c53a157a81cf11a/packages/imaging/src/worker-readers.ts)
- [Current Lab Viewer product north star](https://github.com/a-r-d/PureJsImage-LabViewer/blob/1e222dc8b8226285651571020c53a157a81cf11a/docs/PRODUCT_NORTH_STAR.md)
- [HDF5 File Format Specification 4.0](https://support.hdfgroup.org/documentation/hdf5/latest/_f_m_t4.html)
- [RosettaSciIO supported formats](https://hyperspy.org/rosettasciio/supported_formats/index.html)
- [RosettaSciIO DigitalMicrograph notes](https://hyperspy.org/rosettasciio/supported_formats/digitalmicrograph.html)
- [RosettaSciIO 0.14 TIFF calibration mapping](https://sources.debian.org/src/python-rosettasciio/0.14.0-1/rsciio/tiff/_api.py/)
- [TIFF Revision 6.0 specification](https://download.osgeo.org/geotiff/spec/tiff6.pdf)
- [ImageJ calibration coordinate implementation](https://github.com/imagej/ImageJ/blob/master/ij/measure/Calibration.java)
- [tifffile ImageJ metadata implementation](https://github.com/cgohlke/tifffile/blob/master/tifffile/tifffile.py)
- [RosettaSciIO EMD notes](https://hyperspy.org/rosettasciio/supported_formats/emd.html)
- [RosettaSciIO TIA SER/EMI notes](https://hyperspy.org/rosettasciio/supported_formats/tia.html)
- [Gwyddion supported file formats](https://gwyddion.net/documentation/user-guide-en/file-formats.html)
- [OME-NGFF 0.5 specification](https://ngff.openmicroscopy.org/0.5/)
- [Zarr v3 sharding codec specification](https://zarr-specs.readthedocs.io/en/v3.1.0/v3/codecs/sharding-indexed/index.html)
- [Current tifffile FEI and Zeiss metadata implementation](https://github.com/cgohlke/tifffile/blob/940f7630df48edf8e13913962035ed80b408b5f4/tifffile/tifffile.py)
