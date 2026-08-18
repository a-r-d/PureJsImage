# PureJsImage DICOM image reader roadmap

Status: D0–D5 and D6 JPEG Lossless SV1 implemented in-tree; remaining D6 codecs and D7+ remain unreleased  
Initial normative baseline: DICOM 2026c  
Proposed package export: `purejsimage/scientific/readers/dicom`  
Proposed reader ID: `purejsimage/dicom`

Current public reader: `purejsimage/scientific/readers/dicom` opens strict DICOM Part 10 files with File Meta Information and Implicit or Explicit VR Little Endian native uncompressed MONOCHROME1/2 pixels, Encapsulated Uncompressed, RLE Lossless, JPEG Baseline 8-bit, JPEG Lossless Process 14 Selection Value 1, and JPEG 2000 lossless/lossy grayscale. Package-private parser code lives in `src/scientific/formats/dicom/`. Linear rescale and Window Center/Width are metadata only; stored pixel bytes are unchanged. JPEG Lossless other selection values, JPEG-LS, HTJ2K, and series composition remain unreleased.

## Executive decision

DICOM should be the next major **scientific reader lane** after OME-Zarr, but it must not be treated as one ordinary image codec or one giant implementation PR.

The initial product is:

> A zero-runtime-dependency, browser-portable, strict TypeScript reader for local DICOM Part 10 image instances, with native stored-pixel access, bounded selected-frame reads, explicit transfer-syntax support, normalized grayscale presentation metadata, and honest unsupported boundaries.

It is not:

- a PACS client;
- a DICOMweb implementation;
- a DIMSE networking stack;
- a diagnostic viewer;
- a complete implementation of every DICOM Information Object Definition;
- a series database;
- a de-identification tool;
- a DICOM writer or transcoder.

The first public release should be useful for local CT, MR, CR, DX, secondary-capture, and other conventional grayscale image instances without pretending to be a complete medical-imaging platform.

## Why this is the next major lane

PureJsImage already has the foundation DICOM needs:

- portable, abort-aware `ImageSource`;
- explicit scientific reader registration;
- labeled axes;
- native-precision `RasterBlock` output;
- bounded plane reads;
- source identity and provenance;
- browser and Node adapters;
- first-party JPEG and JPEG 2000 implementations that may be reusable after DICOM-specific codestream conformance is proven;
- benchmark lanes for loader-only and browser-viewer comparisons.

DICOM would add a broad medical-imaging input lane and enable direct comparison with:

- `dicom-parser` for metadata parsing;
- Cornerstone DICOM Image Loader for local Part 10 image loading;
- ITK-Wasm DICOM for local file and series loading.

This is strategically more important to the scientific-reader product than another small interchange format. It is also more competitive and more scope-sensitive than the existing scientific readers, so the implementation must remain staged.

## Priority relative to OpenEXR

DICOM should come first when the goal is expanding the scientific application platform and browser-native imaging comparisons.

OpenEXR remains the clearest missing ordinary professional raster format, but full OpenEXR is also a subsystem: scanline and tiled layouts, multiple channel types, many compression modes, multi-resolution levels, multipart files, multiview files, and deep data.

Do not combine DICOM and OpenEXR in one roadmap or PR. A separately scoped OpenEXR reader can proceed in parallel after the DICOM parser contract is stable.

## Product boundary

### Included in the initial DICOM lane

- DICOM Part 10 files with File Meta Information.
- One local DICOM instance per `ScientificDocument`.
- Single-frame and homogeneous multi-frame image instances.
- Native stored pixel values.
- Signed and unsigned integer samples.
- Common 8-bit and 16-bit storage, including 12-bit values stored in 16-bit words.
- `MONOCHROME1` and `MONOCHROME2`.
- Pixel spacing.
- Linear rescale slope and intercept.
- Window center and width presets.
- Selected-frame reads.
- Selected transfer syntaxes with explicit dispatch.
- Browser `File`, `Blob`, `ArrayBuffer`, `Uint8Array`, and `ImageSource` inputs.
- Node path input through the existing Node adapter.
- Explicit unsupported errors for every recognized but unsupported surface.

### Explicitly excluded from the first public boundary

- DICOMweb, WADO-URI, WADO-RS, QIDO-RS, and STOW-RS.
- DIMSE, associations, C-STORE, C-FIND, C-MOVE, and C-GET.
- PACS integration.
- DICOMDIR.
- Directory scanning and automatic study discovery.
- Writing, transcoding, and metadata mutation.
- De-identification and anonymization.
- Diagnostic-use claims.
- Presentation States.
- Structured Reports.
- Waveforms.
- RTSTRUCT.
- RT Dose display semantics beyond ordinary supported image pixels.
- Segmentation Storage object semantics.
- Parametric Map semantics beyond a future explicitly scoped reader.
- Encapsulated video and MPEG transfer syntaxes.
- Private transfer syntaxes.
- Private tag interpretation.
- Overlays embedded in unused pixel bits.
- Modality LUT Sequence and VOI LUT Sequence in the first release.
- Arbitrary per-frame varying modality transforms in the first release.
- Full patient-space volume reconstruction in the first release.

## Regulatory and privacy posture

Documentation must state:

> PureJsImage DICOM support is intended for research, development, interoperability testing, visualization prototypes, and non-diagnostic workflows. It is not validated or certified for diagnostic use.

The reader must not log or publish patient-identifying metadata by default.

Tests and benchmarks must use:

- generated synthetic instances;
- publicly licensed, de-identified fixtures;
- exact hashes and provenance;
- no real patient identifiers in repository artifacts, logs, snapshots, screenshots, or benchmark output.

The project is not an anonymizer. It must not claim that ignoring patient fields makes an instance de-identified.

## Public API shape

### Reader export

```ts
import { createScientificLibrary } from 'purejsimage/scientific'
import { dicomReader } from 'purejsimage/scientific/readers/dicom'

const science = createScientificLibrary({
  readers: [dicomReader],
})

const document = await science.open(context)
```

### Reader descriptor

Proposed descriptor:

```ts
export const dicomReaderDescriptor = Object.freeze({
  id: 'purejsimage/dicom',
  version: '1.0.0',
  format: 'DICOM Part 10 Image',
  extensions: Object.freeze(['dcm', 'dicom']),
  mediaTypes: Object.freeze(['application/dicom']),
  capabilities: Object.freeze({
    resources: 'single',
    datasets: 'single',
    axes: 'labeled',
    selectedFrames: true,
  }),
})
```

### Dataset mapping

For a single-frame image:

```text
axes: [y, x]
planeReads: [['x', 'y']]
```

For a multi-frame image:

```text
axes: [frame, y, x]
planeReads: [['x', 'y']]
```

The `frame` axis remains an index axis in the initial release. Do not rename it to `z`, `time`, `phase`, `echo`, or another domain axis unless DICOM dimension and geometry metadata proves that interpretation.

The reader must emit raw stored sample values as canonical big-endian `RasterBlock` bytes.

It must not silently:

- apply rescale slope or intercept;
- apply window center or width;
- invert `MONOCHROME1`;
- convert grayscale to 8-bit display pixels;
- combine frames into a patient-space volume;
- normalize color into RGB before the relevant color milestone.

Those are transformations or presentation semantics, not the stored-pixel reader boundary.

## Normalized DICOM metadata

Expose a bounded, JSON-safe, namespaced technical metadata object. Do not expose arbitrary tags by default.

Proposed shape:

```ts
interface DicomTechnicalMetadata {
  readonly sopClassUid: string
  readonly sopInstanceUid?: string
  readonly transferSyntaxUid: string
  readonly modality?: string

  readonly rows: number
  readonly columns: number
  readonly numberOfFrames: number
  readonly samplesPerPixel: number
  readonly photometricInterpretation: string
  readonly bitsAllocated: number
  readonly bitsStored?: number
  readonly highBit?: number
  readonly pixelRepresentation?: 'unsigned' | 'signed'
  readonly planarConfiguration?: 0 | 1

  readonly pixelSpacingMm?: {
    readonly row: number
    readonly column: number
  }

  readonly storedValueTransform?: {
    readonly kind: 'linear'
    readonly slope: number
    readonly intercept: number
    readonly type?: string
  }

  readonly voiPresets?: readonly {
    readonly center: number
    readonly width: number
    readonly explanation?: string
    readonly function: 'LINEAR' | 'LINEAR_EXACT' | 'SIGMOID'
  }[]

  readonly monochromeInverted: boolean

  readonly imagePositionPatient?: readonly [number, number, number]
  readonly imageOrientationPatient?: readonly [number, number, number, number, number, number]
  readonly frameOfReferenceUid?: string
}
```

### Metadata rules

- `PixelSpacing` is ordered row spacing, then column spacing.
- The scientific X-axis step is the DICOM column spacing.
- The scientific Y-axis step is the DICOM row spacing.
- Units are millimeters.
- `ImagePositionPatient` and `ImageOrientationPatient` remain metadata in the first release.
- Do not pretend an oblique image can be represented by independent patient X/Y scalar axes.
- Do not include Patient Name, Patient ID, accession number, birth date, institution, referring physician, or arbitrary private tags in normalized metadata.
- Unknown or unneeded values should be skipped by offset and length without materializing their value bytes.

## Parser architecture

DICOM needs a reusable package-private parser substrate. Do not put all parsing, transfer syntax dispatch, pixel indexing, and scientific mapping into one file.

Suggested layout:

```text
src/scientific/formats/dicom/
  constants.ts
  dictionary.ts
  dictionary.generated.ts
  file-meta.ts
  parser.ts
  elements.ts
  sequences.ts
  transfer-syntax.ts
  pixel-description.ts
  native-pixel.ts
  encapsulated-pixel.ts
  rle.ts
  presentation.ts
  metadata.ts
  limits.ts
```

The public reader should live at:

```text
src/scientific/readers/dicom.ts
```

### Part 10 boundary

The first public reader should require:

- 128-byte preamble;
- `DICM` prefix;
- File Meta Information;
- Transfer Syntax UID in group `0002`.

Dataset-only byte streams without a Part 10 wrapper are common in the wild but remain outside the first automatic-detection boundary.

A later explicit compatibility mode may accept dataset-only input when the caller supplies the transfer syntax. Do not guess a transfer syntax from arbitrary bytes.

### File Meta Information

- Parse File Meta Information as Explicit VR Little Endian.
- Read Transfer Syntax UID from `(0002,0010)`.
- File Meta Information ends when the group changes from `0002`.
- Validate explicit lengths, padding, and source extents.
- Ignore unknown future `0002` elements safely.
- Do not interpret the dataset transfer syntax as applying to the File Meta Information.

### Data element parser

Support:

- Explicit VR Little Endian;
- Implicit VR Little Endian;
- 16-bit and 32-bit explicit value lengths according to VR;
- explicit-length sequences;
- undefined-length sequences;
- explicit-length items;
- undefined-length items;
- item and sequence delimiters;
- safe skipping of unneeded values;
- bounded extraction of required values;
- private elements as opaque values;
- cancellation through every source read.

Never find the end of an undefined-length sequence by scanning for delimiter bytes. Parse nested items structurally.

### Implicit VR dictionary

Implicit VR parsing requires a DICOM data dictionary.

Generate and commit a compact first-party lookup table from a pinned DICOM PS3.6 edition.

The generated artifact should include, at minimum:

- tag;
- VR;
- keyword;
- retired status where useful.

Requirements:

- no runtime dependency;
- deterministic generator;
- source edition and source hash recorded;
- generated output checked for drift;
- lookup optimized for tag-to-VR parsing;
- private tags remain unknown;
- ambiguous VRs are resolved using the applicable DICOM pixel-context rules.

Do not manually maintain a tiny dictionary that fails to recognize an unknown standard sequence and then misparses the rest of the file.

## Parser limits

Add a `DicomLimits` contract with safe defaults.

Suggested initial limits:

```ts
interface DicomLimits {
  readonly maxMetadataBytes: number
  readonly maxElementValueBytes: number
  readonly maxElements: number
  readonly maxSequenceDepth: number
  readonly maxSequenceItems: number
  readonly maxStringBytes: number
  readonly maxRows: number
  readonly maxColumns: number
  readonly maxFrames: number
  readonly maxFragments: number
  readonly maxEncodedFrameBytes: number
  readonly maxDecodedFrameBytes: number
  readonly maxOffsetTableBytes: number
  readonly maxLutEntries: number
}
```

Rules:

- validate all additions and multiplications before allocation;
- validate Rows, Columns, Samples per Pixel, frame count, and sample bytes before computing frame size;
- reject duplicate critical image-pixel attributes;
- reject pixel data shorter than required;
- tolerate one DICOM padding byte where the standard permits even-length padding;
- reject trailing bytes inside a native frame calculation rather than silently changing frame count;
- do not allocate a metadata value merely because its element length is legal;
- do not allocate the complete Pixel Data field when a selected frame can be addressed directly.

## Pixel description contract

The initial reader supports:

- `SamplesPerPixel = 1`;
- `PhotometricInterpretation = MONOCHROME1` or `MONOCHROME2`;
- `BitsAllocated = 8` or `16`;
- `BitsStored` from 1 through `BitsAllocated`;
- `HighBit = BitsStored - 1`;
- unsigned and two's-complement signed representation;
- native integer Pixel Data;
- homogeneous multi-frame instances.

### Stored-bit normalization

For integer pixels:

1. read the allocated byte or word;
2. shift if required by the declared high bit;
3. mask to `BitsStored`;
4. sign-extend when Pixel Representation is signed;
5. emit the logical result in the corresponding canonical sample type.

Examples:

- unsigned 12-bit stored in 16 bits emits `uint16`;
- signed 12-bit stored in 16 bits emits sign-extended `int16`;
- 8-bit unsigned emits `uint8`;
- 8-bit signed emits `int8`.

Do not expose unused high bits or overlay bits as sample magnitude.

### Future native sample additions

Stage separately:

- 32-bit integer Pixel Data;
- Float Pixel Data;
- Double Float Pixel Data;
- 1-bit segmentation pixels;
- palette color;
- RGB and YBR color;
- planar color;
- subsampled YBR;
- packed or unusual retired encodings.

## Native pixel data

For native uncompressed transfer syntaxes:

- compute frame byte ranges without reading the complete pixel field;
- read only the selected frame and selected emitted row block where practical;
- preserve signedness;
- preserve native precision;
- emit canonical big-endian bytes;
- keep output blocks bounded by configured bytes or rows;
- propagate cancellation;
- validate the final frame extent against the Pixel Data element.

Multi-frame native pixel data is a direct concatenation of frames. Selected-frame access must not decode or copy preceding frames.

## Encapsulated pixel data

Encapsulated Pixel Data is a sequence containing:

1. Basic Offset Table item;
2. one or more fragment items;
3. Sequence Delimitation Item.

The parser must index fragments lazily and validate:

- item tags;
- explicit fragment lengths;
- even fragment lengths;
- source extents;
- fragment count;
- total encoded bytes;
- sequence termination.

### Frame boundary policy

Initial support:

- single-frame encapsulated instance: concatenate its frame fragments within `maxEncodedFrameBytes`;
- multi-frame with valid Extended Offset Table;
- multi-frame with valid Basic Offset Table;
- multi-frame with exactly one fragment per frame when the transfer syntax requires or permits that mapping.

Initial explicit unsupported boundary:

- multi-frame encapsulated data with empty offset tables and ambiguous multi-fragment frame boundaries;
- no scanning for JPEG EOI markers to guess frame boundaries;
- no assumption that fragment count always equals frame count.

A later codec-specific frame scanner may be added only with exact conformance tests.

### Offset tables

Support:

- empty Basic Offset Table;
- populated 32-bit Basic Offset Table;
- 64-bit Extended Offset Table and Extended Offset Table Lengths;
- offsets measured according to the DICOM encapsulation rules;
- validation that offsets are ordered and remain within the fragment sequence.

## Transfer syntax roadmap

### Tier 1: first publishable reader

| Transfer syntax | UID | Initial status |
| --- | --- | --- |
| Implicit VR Little Endian | `1.2.840.10008.1.2` | Required |
| Explicit VR Little Endian | `1.2.840.10008.1.2.1` | Required |

Pixel boundary:

- native uncompressed grayscale;
- 8-bit and 16-bit allocation;
- signed and unsigned;
- single-frame and homogeneous multi-frame.

### Tier 2: simple encapsulated formats

| Transfer syntax | UID | Planned approach |
| --- | --- | --- |
| Encapsulated Uncompressed Explicit VR Little Endian | `1.2.840.10008.1.2.1.98` | Reuse native frame unpacking after fragment indexing |
| RLE Lossless | `1.2.840.10008.1.2.5` | First-party DICOM RLE decoder |

DICOM RLE is a good early compressed syntax because the frame boundary is explicit and the algorithm is much smaller than the predictive and wavelet codecs.

### Tier 3: reuse existing codecs after conformance

| Transfer syntax | UID | Gate |
| --- | --- | --- |
| JPEG Baseline 8-bit | `1.2.840.10008.1.2.4.50` | Existing JPEG decoder must accept DICOM codestreams without JFIF assumptions and match independent pixels |
| JPEG 2000 Lossless | `1.2.840.10008.1.2.4.90` | Existing JPEG 2000 path must support raw codestream, bit depth, signedness, components, and DICOM photometric semantics |
| JPEG 2000 | `1.2.840.10008.1.2.4.91` | Same gate, with independent lossy validation |

Do not mark a transfer syntax supported merely because PureJsImage has a similarly named ordinary image codec.

Add a DICOM-specific codestream compatibility matrix and fixtures first.

### Tier 4: new medical codec projects

Implement in this order:

1. JPEG Lossless Process 14, Selection Value 1  
   UID `1.2.840.10008.1.2.4.70`

2. JPEG-LS Lossless  
   UID `1.2.840.10008.1.2.4.80`

3. JPEG-LS Near-lossless  
   UID `1.2.840.10008.1.2.4.81`

4. JPEG Lossless Process 14  
   UID `1.2.840.10008.1.2.4.57`

5. HTJ2K Lossless  
   UID `1.2.840.10008.1.2.4.201`

6. HTJ2K Lossless RPCL  
   UID `1.2.840.10008.1.2.4.202`

7. HTJ2K  
   UID `1.2.840.10008.1.2.4.203`

JPEG Lossless SV1 is the highest-leverage new codec because it covers a large legacy CT and MR corpus and is the DICOM-required default when lossless JPEG processes are supported.

JPEG-LS is the next favorable pure-TypeScript target.

HTJ2K is strategically important, but it should follow a working DICOM encapsulation layer and sufficient JPEG 2000 packet infrastructure.

### Explicitly deferred transfer syntaxes

- Explicit VR Big Endian.
- Deflated Explicit VR Little Endian.
- JPEG Extended 12-bit until a real 12-bit JPEG decoder exists.
- MPEG-2.
- MPEG-4 AVC/H.264.
- HEVC/H.265.
- JPEG XL.
- SMPTE ST 2110 video.
- JPIP-referenced transfer syntaxes.
- private transfer syntaxes.

Deflated Explicit VR Little Endian compresses the entire dataset, including native Pixel Data. It therefore needs a separately designed bounded decompression source or temporary-storage strategy and should not be slipped into the first parser.

## Grayscale transformations

### Stored values remain authoritative

The scientific dataset emits stored values.

The following are metadata or later operations:

1. Modality transformation.
2. VOI transformation.
3. Presentation inversion.

### Linear modality transform

Support:

```text
modality value = slope * stored value + intercept
```

Normalize:

- Rescale Slope;
- Rescale Intercept;
- Rescale Type.

Top-level attributes are supported first.

Enhanced multi-frame Pixel Value Transformation Sequence may be supported when it is shared or exactly identical across all selected frames.

If per-frame values vary and the public dataset contract cannot represent them honestly, reject that semantic mapping or preserve the frames as raw stored values with an explicit warning. Do not apply the first frame's transform to every frame.

### Window center and width

Expose all paired Window Center and Window Width values as display presets.

Rules:

- values are applied after the modality transform;
- width must be at least 1 for the default linear function;
- pair values by position;
- preserve Window Center and Width Explanation when present;
- preserve VOI LUT Function;
- do not choose one preset silently when several are present;
- do not bake windowing into the stored-pixel block.

### MONOCHROME1

`MONOCHROME1` means the minimum display value is intended to appear white rather than black.

Record:

```ts
monochromeInverted: true
```

Do not numerically invert raw stored samples in the reader.

### Deferred LUTs

Defer:

- Modality LUT Sequence;
- VOI LUT Sequence;
- Presentation LUT;
- palette LUT;
- Real World Value Mapping.

Each needs its own bounded LUT limits, signed input rules, and conformance fixtures.

## Geometry and calibration

### Pixel spacing

Map Pixel Spacing to local image coordinates:

```text
x step = column spacing in mm
y step = row spacing in mm
```

Record calibration evidence with exact DICOM tag locators.

Do not use Imager Pixel Spacing or Nominal Scanned Pixel Spacing as a silent substitute for Pixel Spacing. Any fallback policy needs an explicit modality-specific evidence-backed milestone.

### Patient orientation

Preserve:

- Image Position Patient;
- Image Orientation Patient;
- Frame of Reference UID.

Do not represent an arbitrary patient-space affine as independent scalar axes.

A later application-platform affine contract or DICOM series layer may use these values for patient-space geometry.

### Frame axis

Initial multi-frame images expose `frame` as an index axis.

Only promote it to a physical Z or time axis when:

- frame dimension metadata identifies the dimension;
- geometry is complete;
- planes are parallel;
- ordering is unambiguous;
- spacing is regular or represented as a lookup axis;
- per-frame pixel transforms are compatible.

## Homogeneous multi-frame boundary

The first multi-frame implementation requires all frames to share:

- Rows;
- Columns;
- Samples per Pixel;
- Photometric Interpretation;
- Bits Allocated;
- Bits Stored;
- High Bit;
- Pixel Representation;
- planar configuration;
- output sample type.

Shared and Per-frame Functional Groups may be parsed only for the small supported subset:

- Pixel Measures;
- Pixel Value Transformation;
- Frame Content;
- Plane Position Patient;
- Plane Orientation Patient.

Per-frame values may be preserved in bounded metadata only when needed.

Do not materialize every large per-frame sequence into arbitrary JSON.

## Future series composition

A DICOM series is commonly stored as many Part 10 instances. That is a separate milestone from one-instance parsing.

Proposed future API:

```ts
openDicomSeries({
  resources,
  limits,
  signal,
})
```

The caller supplies an explicit resource array. PureJsImage does not scan a filesystem or contact a server.

Series composition should:

- group by Series Instance UID;
- validate one Frame of Reference UID where geometry depends on it;
- sort slices by patient-space plane position;
- validate consistent rows, columns, pixel spacing, orientation, photometric interpretation, and logical sample type;
- preserve source identity for every instance;
- expose Z as linear or lookup coordinates only when geometry proves it;
- reject ambiguous or duplicate slice positions;
- keep selected-slice reads lazy;
- allow transfer syntax to vary by instance only when decoded output semantics remain identical.

DICOMweb retrieval remains an application integration that supplies resources to this API. It does not belong inside the core reader.

## Memory and performance requirements

Northstars:

1. No full-file materialization for ordinary native Part 10 images.
2. No full-series materialization.
3. No full multi-frame materialization.
4. Selected frame before full frame set.
5. Native precision without an RGBA intermediate.
6. Bounded metadata parsing.
7. Bounded encapsulated frame assembly.
8. No duplicate full-frame buffers at codec boundaries.
9. Explicit release of emitted blocks.
10. Browser and Node use the same parser and pixel implementation.

For a selected native frame:

```text
peak incremental pixel memory
  approximately emitted block bytes
  plus small parser and conversion scratch
```

For a compressed selected frame:

```text
peak incremental pixel memory
  approximately encoded selected frame
  plus codec working set
  plus emitted block
```

A full-frame fallback must be explicit in the transfer-syntax capability boundary and benchmarked separately.

## Benchmark plan

### Parser-only lane

Compare:

- PureJsImage DICOM parser;
- `dicom-parser`.

Workloads:

- metadata open;
- sequence-heavy metadata open;
- implicit VR;
- explicit VR;
- selected technical tag extraction;
- skip large Pixel Data without reading it.

Metrics:

- import and initialization;
- metadata-open wall time;
- source reads and bytes;
- peak RSS;
- package footprint;
- correctness.

### Pixel-loader lane

Compare:

- PureJsImage;
- Cornerstone DICOM Image Loader;
- ITK-Wasm DICOM.

Use local files only. Do not include WADO or network-server behavior in the first comparison.

Representative workloads:

1. 512 by 512 signed 16-bit CT, native.
2. 512 by 512 unsigned 12-bit-in-16 MR, native.
3. 512 by 512 by 128 homogeneous multi-frame native.
4. 2048 by 2048 8-bit CR or DX.
5. DICOM RLE frame.
6. JPEG Baseline frame.
7. JPEG 2000 lossless frame.
8. JPEG Lossless frame after that codec exists.
9. JPEG-LS frame after that codec exists.
10. HTJ2K frame after that codec exists.

Operations:

- cold import;
- metadata open;
- first selected frame;
- complete selected frame;
- deterministic scroll through 100 frames;
- repeated warm frame;
- modality transform;
- window mapping;
- source requests and bytes;
- peak RSS;
- output hash or independent tolerance.

Keep browser and Node results separate.

Do not make one universal medical-imaging score.

## Fixtures and independent oracles

### Generated structural fixtures

Create a small first-party DICOM fixture writer under test or benchmark tooling only.

It may generate:

- Part 10 File Meta Information;
- explicit and implicit VR datasets;
- explicit and undefined sequences;
- native pixel data;
- encapsulated fragment sequences;
- Basic and Extended Offset Tables;
- signed and unsigned bit-depth edge cases;
- malformed lengths and delimiters.

The fixture writer is not a public DICOM writer.

### External fixtures

Use pinned, de-identified files from independently maintained corpora.

Every external fixture needs:

- exact source URL;
- exact revision;
- license;
- attribution;
- redistribution status;
- SHA-256;
- expected transfer syntax;
- expected shape and dtype;
- expected sample hash;
- expected selected metadata.

### Development oracles

Allowed as dev-only oracles:

- pydicom;
- GDCM;
- DCMTK;
- Cornerstone DICOM Image Loader;
- ITK-Wasm DICOM.

No oracle becomes a production runtime dependency.

## Hostile-input tests

At minimum:

- truncated File Meta Information;
- missing Transfer Syntax UID;
- unsupported transfer syntax;
- invalid explicit VR;
- invalid 16-bit versus 32-bit length form;
- odd and invalid padding;
- element length outside source;
- integer overflow in frame size;
- excessive rows, columns, frames, elements, nesting, items, or fragments;
- undefined sequence without delimiter;
- item delimiter in the wrong nesting level;
- duplicate critical pixel tags;
- Pixel Data too short;
- invalid Bits Stored;
- invalid High Bit;
- signed 12-bit extremes;
- invalid Samples per Pixel;
- missing Planar Configuration for color;
- native pixel length inconsistent with frame count;
- encapsulated pixel sequence without delimitation;
- malformed Basic Offset Table;
- malformed Extended Offset Table;
- non-monotonic or out-of-range frame offsets;
- frame spanning excessive fragments;
- compressed frame exceeding encoded limit;
- decoded frame exceeding decoded limit;
- cancellation during metadata parse;
- cancellation during selected frame read;
- no PHI emitted into error messages or logs.

## Milestone plan

### D0: specification, dictionary pipeline, and corpus

Scope:

- land this roadmap;
- choose and record the DICOM edition;
- create the generated dictionary pipeline;
- create fixture provenance manifests;
- prepare synthetic and external fixtures;
- add no public reader.

Definition of done:

- deterministic dictionary generation;
- exact dictionary source provenance;
- exact fixture hashes and oracles;
- parser limits approved;
- no runtime dependencies.

### D1: Part 10 and dataset parser substrate

Scope:

- File Meta Information;
- strict Part 10 detection;
- Explicit VR Little Endian;
- Implicit VR Little Endian;
- sequences and items;
- bounded tag lookup;
- no pixel decode;
- package-private parser.

Definition of done:

- parser survives hostile structural fixtures;
- unneeded Pixel Data can be skipped without reading it;
- metadata matches independent oracle;
- browser and Node tests pass;
- parser is not exported as a generic unlimited DICOM object model.

### D2: native grayscale scientific reader

Scope:

- public explicit DICOM reader;
- native uncompressed transfer syntaxes;
- MONOCHROME1 and MONOCHROME2;
- 8-bit and 16-bit allocation;
- signed and unsigned;
- 12-bit-in-16;
- single-frame and homogeneous multi-frame;
- selected-frame reads;
- Pixel Spacing;
- technical metadata.

Definition of done:

- exact native sample hashes;
- selected frame without reading prior frames;
- no full-file pixel allocation;
- browser `File` support;
- capability manifest and generated documentation;
- explicit unsupported errors for color and compressed transfer syntaxes.

### D3: modality and VOI metadata

Scope:

- Rescale Slope;
- Rescale Intercept;
- Rescale Type;
- Window Center;
- Window Width;
- Window explanation;
- VOI LUT Function;
- MONOCHROME1 inversion metadata;
- shared and homogeneous per-frame functional-group subset.

Definition of done:

- stored pixel bytes remain unchanged;
- independent modality-value assertions;
- exact DICOM linear window formula tests;
- multiple presets preserved;
- per-frame conflicts reject or remain explicitly raw.

### D4: encapsulation and RLE

Scope:

- fragment index;
- Basic Offset Table;
- Extended Offset Table;
- selected encapsulated frame;
- Encapsulated Uncompressed;
- DICOM RLE Lossless.

Definition of done:

- selected frame reads only its offset table and fragments;
- multi-fragment single frame supported;
- ambiguous empty-table multi-frame rejects;
- RLE signed and unsigned pixel hashes match independent oracle;
- no full encapsulated Pixel Data allocation.

### D5: existing-codec transfer syntaxes

Scope:

- JPEG Baseline 8-bit;
- JPEG 2000 Lossless;
- JPEG 2000 lossy subset;
- DICOM-specific codestream adapters and conformance matrix.

Definition of done:

- raw codestream support proven;
- DICOM metadata and codestream properties cross-validated;
- lossy output has independent tolerance;
- unsupported bit depth and color combinations reject;
- no ordinary-codec support claim is broadened accidentally.

### D6: medical codec expansion

Separate PRs:

1. JPEG Lossless SV1.
2. JPEG-LS Lossless.
3. JPEG-LS Near-lossless.
4. JPEG Lossless Process 14.
5. HTJ2K.

Each codec remains:

- first-party pure TypeScript reference implementation;
- independently testable outside DICOM where the codestream standard permits;
- explicitly dispatched by DICOM transfer syntax;
- eligible for later optional first-party WASM acceleration;
- bounded and browser-compatible.

### D7: explicit series composition

Scope:

- explicit resource-array input;
- grouping;
- geometry validation;
- lazy selected slice;
- linear or lookup Z axis;
- no directory scan and no networking.

Definition of done:

- CT and MR series match independent ordering and geometry;
- duplicate and ambiguous slice positions reject;
- selected slice does not decode the full series;
- source identities cover every instance.

### D8: application integration and comparisons

Scope:

- add DICOM to the scientific explorer or a dedicated non-diagnostic demo;
- local-file loading only;
- display raw and modality-scaled values;
- window presets;
- frame scrolling;
- benchmark against Cornerstone and ITK-Wasm.

Definition of done:

- visible non-diagnostic disclaimer;
- no patient metadata rendered by default;
- measured bundle, initialization, selected-frame time, scroll time, and peak RSS;
- screenshots use generated or de-identified fixtures;
- no server or PACS scope.

## First publishable support claim

The first public capability entry should not say simply:

> DICOM supported

It should say something like:

> DICOM Part 10 local image instances using Implicit or Explicit VR Little Endian native uncompressed MONOCHROME1/2 pixels, with 8-bit or 16-bit allocation, signed or unsigned stored values, 12-bit-in-16 normalization, homogeneous multi-frame selection, Pixel Spacing, linear rescale metadata, and Window Center/Width presets. Color, LUT-based presentation, DICOMweb, series discovery, private tags, and compressed transfer syntaxes remain unsupported unless separately listed.

## Definition of complete DICOM image lane

The DICOM image lane is mature when:

- strict Part 10 parsing is stable;
- native grayscale is complete;
- RLE is complete;
- JPEG Baseline, JPEG Lossless, JPEG-LS, JPEG 2000, and HTJ2K have explicit tested status;
- selected frame reads are bounded;
- one-instance and explicit-series behavior are separate and documented;
- raw stored values and display transforms remain separate;
- browser and Node behavior match;
- Cornerstone and ITK-Wasm comparisons exist;
- no runtime dependencies exist;
- no diagnostic-use claim exists;
- every unsupported transfer syntax produces a precise error.

## Normative and comparison references

- DICOM PS3.10 File Format: https://dicom.nema.org/medical/dicom/current/output/chtml/part10/chapter_7.html
- DICOM PS3.5 Data Set encoding: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/chapter_7.html
- DICOM PS3.5 Transfer Syntaxes: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/chapter_a.html
- DICOM PS3.5 Encapsulated Pixel Data: https://dicom.nema.org/medical/dicom/current/output/chtml/part05/sect_A.4.html
- DICOM PS3.3 Image Pixel Module: https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.3.html
- DICOM PS3.3 Functional Groups: https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.16.2.html
- DICOM PS3.3 VOI LUT Module: https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_c.11.2.html
- DICOM PS3.6 Data Dictionary: https://dicom.nema.org/medical/dicom/current/output/chtml/part06/chapter_6.html
- Cornerstone DICOM Image Loader: https://www.cornerstonejs.org/docs/concepts/cornerstone-core/imageloader/
- ITK-Wasm DICOM migration/API overview: https://docs.itk.org/projects/wasm/en/latest/development/itk_js_to_itk_wasm_migration_guide.html
