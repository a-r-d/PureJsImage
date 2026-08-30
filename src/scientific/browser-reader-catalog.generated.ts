// Generated from capabilities/manifest.json and package.json.
// Run npm run scientific:reader-catalog:generate. Do not edit directly.

import type { ScientificBrowserReaderCatalogEntry } from './browser-reader-catalog.ts'

const entries: readonly ScientificBrowserReaderCatalogEntry[] =
[
  {
    "id": "purejsimage/gsf",
    "version": "1.0.0",
    "format": "Gwyddion Simple Field",
    "packageExport": "purejsimage/scientific/readers/gsf",
    "extensions": [
      "gsf"
    ],
    "mediaTypes": [
      "application/x-gwyddion-spm"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "surface"
    ],
    "directRangeReads": true,
    "boundary": "One scalar 2D field with exact X/Y calibration and bounded metadata."
  },
  {
    "id": "purejsimage/nanonis-sxm",
    "version": "1.0.0",
    "format": "Nanonis SXM",
    "packageExport": "purejsimage/scientific/readers/nanonis-sxm",
    "extensions": [
      "sxm"
    ],
    "mediaTypes": [
      "application/x-nanonis-sxm"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "surface"
    ],
    "directRangeReads": true,
    "boundary": "Nanonis SXM v2 FLOAT MSBFIRST images; every recorded channel and direction is separate, binary values retain declared channel units, and Y remains in top-to-bottom file order with a negative calibrated step."
  },
  {
    "id": "purejsimage/igor-binary-wave",
    "version": "1.0.0",
    "format": "Igor Binary Wave v5",
    "packageExport": "purejsimage/scientific/readers/igor-binary-wave",
    "extensions": [
      "ibw"
    ],
    "mediaTypes": [
      "application/x-igor-binary-wave"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume"
    ],
    "directRangeReads": true,
    "boundary": "Numeric IBW v5 waves with two through four contiguous dimensions, endian and checksum validation, linear axes, units, notes, labels, and selected XY regions; complex, text, formula-dependent, and private-option waves are rejected."
  },
  {
    "id": "purejsimage/digital-surf",
    "version": "1.0.0",
    "format": "Digital Surf SUR/PRO",
    "packageExport": "purejsimage/scientific/readers/digital-surf",
    "extensions": [
      "sur",
      "pro"
    ],
    "mediaTypes": [
      "application/x-digitalsurf-sur"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "surface"
    ],
    "directRangeReads": false,
    "boundary": "Digital Surf integer surface, multilayer, and profile records with bounded stored or zlib-stream payloads, exact scale/offset conversion, special-point masks, physical axes, units, object enumeration, comments, and private-zone bounds; spectral maps are rejected."
  },
  {
    "id": "purejsimage/x3p",
    "version": "1.0.0",
    "format": "X3P surface exchange",
    "packageExport": "purejsimage/scientific/readers/x3p",
    "extensions": [
      "x3p"
    ],
    "mediaTypes": [
      "application/x-x3p"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "surface"
    ],
    "directRangeReads": true,
    "boundary": "ISO 5436-2 SUR matrices with incremental X/Y axes, one Z layer, numeric binary point data, optional validity masks, exact Z increment/offset conversion, bounded ZIP/ZIP64 indexing, and stored-member range views."
  },
  {
    "id": "purejsimage/envi",
    "version": "1.0.0",
    "format": "ENVI",
    "packageExport": "purejsimage/scientific/readers/envi",
    "extensions": [
      "hdr",
      "img",
      "dat",
      "raw"
    ],
    "mediaTypes": [
      "application/x-envi"
    ],
    "resourceModel": "companion-pair",
    "datasetKinds": [
      "image",
      "volume",
      "spectrum-image"
    ],
    "directRangeReads": true,
    "boundary": "Header-plus-binary scalar cubes with BSQ, BIL, or BIP layout and exact selected-region reads."
  },
  {
    "id": "purejsimage/fits",
    "version": "1.0.0",
    "format": "FITS",
    "packageExport": "purejsimage/scientific/readers/fits",
    "extensions": [
      "fits",
      "fit",
      "fts"
    ],
    "mediaTypes": [
      "application/fits",
      "image/fits"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume"
    ],
    "directRangeReads": true,
    "boundary": "Supported image HDUs with ranked axes, native numeric samples, and linear physical coordinates."
  },
  {
    "id": "purejsimage/mrc",
    "version": "1.0.0",
    "format": "MRC/CCP4",
    "packageExport": "purejsimage/scientific/readers/mrc",
    "extensions": [
      "mrc",
      "map",
      "ccp4"
    ],
    "mediaTypes": [
      "application/x-mrc",
      "application/x-ccp4"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume"
    ],
    "directRangeReads": true,
    "boundary": "One scalar image or volume for the documented MRC/CCP4 modes and axis mappings."
  },
  {
    "id": "purejsimage/cbf",
    "version": "1.0.0",
    "format": "CBF/imgCIF",
    "packageExport": "purejsimage/scientific/readers/cbf",
    "extensions": [
      "cbf"
    ],
    "mediaTypes": [
      "application/x-cbf"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image"
    ],
    "directRangeReads": false,
    "boundary": "One 2D detector image using the documented byte-offset encoding subset."
  },
  {
    "id": "purejsimage/png",
    "version": "1.0.0",
    "format": "PNG",
    "packageExport": "purejsimage/scientific/readers/png",
    "extensions": [
      "png"
    ],
    "mediaTypes": [
      "image/png"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image"
    ],
    "directRangeReads": false,
    "boundary": "Low-confidence codec adapter exposing canonical uint8 image datasets."
  },
  {
    "id": "purejsimage/jpeg",
    "version": "1.0.0",
    "format": "JPEG",
    "packageExport": "purejsimage/scientific/readers/jpeg",
    "extensions": [
      "jpg",
      "jpeg",
      "jpe"
    ],
    "mediaTypes": [
      "image/jpeg"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image"
    ],
    "directRangeReads": false,
    "boundary": "Low-confidence codec adapter exposing canonical uint8 image datasets."
  },
  {
    "id": "purejsimage/webp",
    "version": "1.0.0",
    "format": "WebP",
    "packageExport": "purejsimage/scientific/readers/webp",
    "extensions": [
      "webp"
    ],
    "mediaTypes": [
      "image/webp"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image"
    ],
    "directRangeReads": false,
    "boundary": "Low-confidence codec adapter exposing canonical uint8 image datasets; animated WebP remains outside the codec boundary."
  },
  {
    "id": "purejsimage/bmp",
    "version": "1.0.0",
    "format": "BMP",
    "packageExport": "purejsimage/scientific/readers/bmp",
    "extensions": [
      "bmp",
      "dib"
    ],
    "mediaTypes": [
      "image/bmp",
      "image/x-ms-bmp"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image"
    ],
    "directRangeReads": false,
    "boundary": "Low-confidence codec adapter exposing canonical uint8 image datasets."
  },
  {
    "id": "purejsimage/jp2",
    "version": "1.0.0",
    "format": "JPEG 2000 / JP2",
    "packageExport": "purejsimage/scientific/readers/jp2",
    "extensions": [
      "jp2"
    ],
    "mediaTypes": [
      "image/jp2"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image"
    ],
    "directRangeReads": false,
    "boundary": "Low-confidence codec adapter exposing canonical uint8 image datasets within the first-party JP2 decoder subset."
  },
  {
    "id": "purejsimage/tiff",
    "version": "1.1.0",
    "format": "TIFF",
    "packageExport": "purejsimage/scientific/readers/tiff",
    "extensions": [
      "tif",
      "tiff"
    ],
    "mediaTypes": [
      "image/tiff",
      "image/x-tiff"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume",
      "pyramid"
    ],
    "directRangeReads": true,
    "boundary": "Native-precision compatible page series, separate incompatible series, and SubIFD or chained reduced-resolution levels with typed GeoTIFF CRS, affine, inverse, bounds, pixel interpretation, nodata, and JSON-safe source metadata; deterministic tiled Classic TIFF, BigTIFF, Deflate, LZW, PackBits, RGB/RGBA, three-band YCbCr JPEG, four-band photometric-RGB ExtraSamples=0 JPEG, and overview COG fixtures prove the applicable native-raster paths. JPEG compression 7 native samples are YCbCr-converted RGB, preserved RGB+unspecified extra components, or grayscale; four-band sources are not routed through the RGB display decoder. Old-style JPEG remains display-only. Pixel reads remain in raster coordinates without invented axis semantics."
  },
  {
    "id": "purejsimage/ome-tiff",
    "version": "1.0.0",
    "format": "OME-TIFF",
    "packageExport": "purejsimage/scientific/readers/ome-tiff",
    "extensions": [
      "tif",
      "tiff"
    ],
    "mediaTypes": [
      "image/tiff",
      "image/x-tiff"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume"
    ],
    "directRangeReads": true,
    "boundary": "OME-XML-backed X/Y/Z/C/T datasets on supported TIFF sample and compression layouts; detection follows the first TIFF IFD and bounded tag-270 ranges instead of scanning a fixed file prefix."
  },
  {
    "id": "purejsimage/ome-zarr",
    "version": "1.1.0",
    "format": "OME-Zarr",
    "packageExport": "purejsimage/scientific/readers/ome-zarr",
    "extensions": [
      "zarr",
      "ozx"
    ],
    "mediaTypes": [
      "application/vnd.ome.zarr",
      "application/x-zarr"
    ],
    "resourceModel": "directory-like",
    "datasetKinds": [
      "image",
      "volume",
      "pyramid"
    ],
    "directRangeReads": true,
    "boundary": "OME-NGFF 0.4 and 0.5 image multiscales, required 0.5 OMERO channel windows/colors and plate layout/version metadata, image-label colors/properties/source with 0.5 associated-pyramid parity, path-backed scale/translation, preserved pyramid-generation metadata, and rich plates/wells/acquisitions on Zarr v2 and v3 directory stores, range-first bounded public HTTP contexts with v2/v3 root discovery, or a ZIP archive with root-level or a single nested zarr.json/.zgroup (including *.zarr / *.ome.zarr names and ignored __MACOSX/ sidecars), plus explicit OME.series and consecutive bioformats2raw.layout fallback roots. Integer arrays include exact signed/unsigned 64-bit canonical bytes and BigInt access. Regular and sharding_indexed chunk grids; bytes, gzip, zlib, zstd, crc32c, transpose, shuffle, and Blosc 1 with byte shuffle or 8-element-aligned bitshuffle and LZ4/zlib/zstd or memcpy; missing chunks become fill values; selected planes fetch only intersecting chunks. BloscLZ, Snappy, malformed bitshuffle blocks, complex/boolean/structured dtypes, tables, storage_transformers, non-regular chunk grids, RFC-9 zip-comment/jsonFirst requirements, multi-root ZIPs, and writers are rejected."
  },
  {
    "id": "purejsimage/aperio-svs",
    "version": "1.0.0",
    "format": "Aperio SVS",
    "packageExport": "purejsimage/scientific/readers/aperio-svs",
    "extensions": [
      "svs"
    ],
    "mediaTypes": [
      "image/tiff",
      "image/x-tiff"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "pyramid",
      "image"
    ],
    "directRangeReads": true,
    "boundary": "One bounded calibrated whole-slide pyramid plus separate supported associated images."
  },
  {
    "id": "purejsimage/digital-micrograph",
    "version": "1.0.0",
    "format": "Gatan DigitalMicrograph",
    "packageExport": "purejsimage/scientific/readers/digital-micrograph",
    "extensions": [
      "dm3",
      "dm4"
    ],
    "mediaTypes": [
      "application/x-gatan-dm3",
      "application/x-gatan-dm4",
      "application/x-digital-micrograph"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume",
      "spectrum-image"
    ],
    "directRangeReads": true,
    "boundary": "Rank-2 images, rank-3 X/Y/Z volumes, evidence-gated X/Y/energy EELS spectrum images, evidence-gated C-ordered 4D-STEM diffraction planes, and otherwise neutral rank-4 axes, plus fixture-proven little-endian packed BGRA; no rank-1, complex, encrypted, external, big-endian packed color, or undocumented packed content."
  },
  {
    "id": "purejsimage/tia-ser",
    "version": "1.0.0",
    "format": "FEI/Thermo TIA SER",
    "packageExport": "purejsimage/scientific/readers/tia-ser",
    "extensions": [
      "ser"
    ],
    "mediaTypes": [
      "application/x-fei-ser",
      "application/x-thermo-tia-ser",
      "application/x-tia-ser"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume",
      "spectrum-image",
      "spectrum"
    ],
    "directRangeReads": true,
    "boundary": "TIA SER versions 0x0210 and 0x0220 with scalar element types 1 through 8, request-bounded batched metadata indexing, lazy payload reads, compatible image or spectrum collections, native calibrated series reads, and explicit valid or invalid element metadata; no complex elements or companion EMI metadata."
  },
  {
    "id": "purejsimage/tia-emi",
    "version": "1.0.0",
    "format": "FEI/Thermo TIA EMI",
    "packageExport": "purejsimage/scientific/readers/tia-emi",
    "extensions": [
      "emi"
    ],
    "mediaTypes": [
      "application/x-fei-emi",
      "application/x-thermo-tia-emi",
      "application/x-tia-emi"
    ],
    "resourceModel": "companion-set",
    "datasetKinds": [
      "image",
      "volume",
      "spectrum-image",
      "spectrum"
    ],
    "directRangeReads": true,
    "boundary": "Bounded ObjectInfo XML from the TIA EMI binary envelope plus consecutively numbered sibling SER resources resolved through ScientificCompanionResolver; EMI acquisition metadata enriches SER-backed datasets, strongly corroborated diffraction calibration is interpreted as reciprocal space, contradictory mode hints preserve SER facts, and every dataset identity includes its EMI and contributing SER resource."
  },
  {
    "id": "purejsimage/ncem-emd",
    "version": "1.0.0",
    "format": "NCEM EMD 0.2",
    "packageExport": "purejsimage/scientific/readers/ncem-emd",
    "extensions": [
      "emd"
    ],
    "mediaTypes": [
      "application/x-hdf5"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume",
      "spectrum-image",
      "spectrum"
    ],
    "directRangeReads": true,
    "boundary": "Berkeley/openNCEM EMD 0.2 numeric groups below /data or /signals with scalar integer or decimal-string version attributes, exact labeled coordinates, bounded scalar or array acquisition attributes, and selected HDF5 hyperslab reads; Direct Electron .de5 and later EMD revisions remain unsupported."
  },
  {
    "id": "purejsimage/velox-emd",
    "version": "1.0.0",
    "format": "FEI/Thermo Velox EMD",
    "packageExport": "purejsimage/scientific/readers/velox-emd",
    "extensions": [
      "emd"
    ],
    "mediaTypes": [
      "application/x-hdf5"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume"
    ],
    "directRangeReads": true,
    "boundary": "Velox HDF5 image hierarchy with rank-3 numeric image, diffraction, dense-map, DPC complex, or positive-half FFT arrays; bounded per-frame JSON metadata, explicit detector datasets and frame axes, exact native samples, and specific pruned-spectrum-image errors. Sparse SpectrumStream data and dense Spectrum entries remain outside this E2 boundary."
  },
  {
    "id": "purejsimage/rpl",
    "version": "1.0.0",
    "format": "Lispix RPL/RAW",
    "packageExport": "purejsimage/scientific/readers/rpl",
    "extensions": [
      "rpl",
      "raw"
    ],
    "mediaTypes": [
      "application/x-rpl",
      "application/x-lispix-raw"
    ],
    "resourceModel": "companion-pair",
    "datasetKinds": [
      "image",
      "spectrum-image"
    ],
    "directRangeReads": true,
    "boundary": "One numeric header-plus-RAW array in image, vector, or depth-one order with exact declared endian, offset, dimensions, axis calibration, and selected plane or series reads."
  },
  {
    "id": "purejsimage/emsa",
    "version": "1.0.0",
    "format": "EMSA/MAS spectrum",
    "packageExport": "purejsimage/scientific/readers/emsa",
    "extensions": [
      "msa",
      "emsa"
    ],
    "mediaTypes": [
      "application/x-emsa-mas"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "spectrum"
    ],
    "directRangeReads": false,
    "boundary": "Bounded EMSA/MAS text spectra using Y or XY data, with exact point counts, native float64 series values, calibrated or lookup spectral coordinates, units, and preserved header fields."
  },
  {
    "id": "purejsimage/nrrd",
    "version": "1.0.0",
    "format": "NRRD",
    "packageExport": "purejsimage/scientific/readers/nrrd",
    "extensions": [
      "nrrd",
      "nhdr"
    ],
    "mediaTypes": [
      "application/x-nrrd"
    ],
    "resourceModel": "companion-pair",
    "datasetKinds": [
      "image",
      "volume"
    ],
    "directRangeReads": false,
    "boundary": "NRRD0001 through NRRD0005 scalar numeric arrays with attached or one-file detached raw data, bounded gzip data, endian conversion, linear spacing or direction-vector calibration, origin, units, labels, kinds, and key/value metadata; ASCII, bzip2, and multi-file sequences are rejected."
  },
  {
    "id": "purejsimage/meta-image",
    "version": "1.0.0",
    "format": "MetaImage MHD/MHA",
    "packageExport": "purejsimage/scientific/readers/meta-image",
    "extensions": [
      "mhd",
      "mha"
    ],
    "mediaTypes": [
      "application/x-metaimage"
    ],
    "resourceModel": "companion-pair",
    "datasetKinds": [
      "image",
      "volume"
    ],
    "directRangeReads": true,
    "boundary": "Binary numeric MHA LOCAL or MHD plus one raw companion, with scalar or bounded interleaved components, endian conversion, spacing, origin, and preserved direction; compressed, ASCII, HeaderSize -1, and multi-file series are rejected."
  },
  {
    "id": "purejsimage/nifti",
    "version": "1.0.0",
    "format": "NIfTI-1/2",
    "packageExport": "purejsimage/scientific/readers/nifti",
    "extensions": [
      "nii",
      "gz"
    ],
    "mediaTypes": [
      "application/x-nifti"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume"
    ],
    "directRangeReads": false,
    "boundary": "Single-file NIfTI-1 and NIfTI-2 scalar numeric arrays, optionally bounded whole-file gzip, with endian conversion, scl_slope/inter transformation, voxel spacing and units, and preserved qform/sform metadata; paired hdr/img and complex, RGB, binary, and extension payloads are outside this subset."
  },
  {
    "id": "purejsimage/dicom",
    "version": "1.0.0",
    "format": "DICOM Part 10 Image",
    "packageExport": "purejsimage/scientific/readers/dicom",
    "extensions": [
      "dcm",
      "dicom"
    ],
    "mediaTypes": [
      "application/dicom"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume"
    ],
    "directRangeReads": true,
    "boundary": "Local DICOM Part 10 image instances using Implicit or Explicit VR Little Endian native uncompressed MONOCHROME1/2 pixels, Encapsulated Uncompressed Explicit VR Little Endian, RLE Lossless, JPEG Baseline 8-bit, JPEG Lossless Process 14 Selection Value 1, JPEG 2000 Lossless, and JPEG 2000, with 8-bit or 16-bit allocation as the transfer syntax permits, signed or unsigned stored values, 12-bit-in-16 normalization, homogeneous multi-frame selection, Pixel Spacing, linear rescale slope/intercept metadata, and Window Center/Width presets. Stored samples are not rescaled, windowed, or inverted. Selected encapsulated frames read only their offset table and fragments. Encapsulated Uncompressed and RLE require one fragment per frame. JPEG families may split a frame across fragments only with a valid Basic Offset Table. Empty offset tables with ambiguous multi-fragment frame boundaries remain unsupported; the reader does not scan for JPEG EOI markers to guess frames. Color, LUT-based presentation, DICOMweb, series discovery, private-tag interpretation, JPEG Lossless Process 14 other selection values, JPEG-LS, HTJ2K, and other compressed transfer syntaxes remain unsupported. Not validated for diagnostic use."
  },
  {
    "id": "purejsimage/npy",
    "version": "1.0.0",
    "format": "NumPy NPY",
    "packageExport": "purejsimage/scientific/readers/npy",
    "extensions": [
      "npy"
    ],
    "mediaTypes": [
      "application/x-npy"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "volume"
    ],
    "directRangeReads": true,
    "boundary": "Exactly one NPY v1, v2, or v3 C- or Fortran-contiguous scalar boolean, integer, float16, float32, or float64 array with generic index axes and selected plane or series reads; scalar, structured, object, complex, datetime, Unicode, and NPZ arrays are rejected."
  },
  {
    "id": "purejsimage/blockfile",
    "version": "1.0.0",
    "format": "NanoMegas ASTAR blockfile",
    "packageExport": "purejsimage/scientific/readers/blockfile",
    "extensions": [
      "blo"
    ],
    "mediaTypes": [
      "application/x-nanomegas-blo"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "image",
      "spectrum-image"
    ],
    "directRangeReads": true,
    "boundary": "NanoMegas ASTAR blockfiles with bounded square uint8 diffraction frames, per-frame ID validation, a virtual-bright-field navigator, scan calibration, diffraction scale, and acquisition metadata."
  },
  {
    "id": "purejsimage/mib",
    "version": "1.0.0",
    "format": "Quantum Detectors Merlin MIB",
    "packageExport": "purejsimage/scientific/readers/mib",
    "extensions": [
      "mib"
    ],
    "mediaTypes": [
      "application/x-merlin-mib"
    ],
    "resourceModel": "companion-pair",
    "datasetKinds": [
      "image",
      "spectrum-image"
    ],
    "directRangeReads": true,
    "boundary": "Processed Merlin U08, U16, or U32 frame sequences with 384- or 768-byte per-frame headers, vertical normalization, optional acquisition HDR metadata, and optional rectangular scan navigation; raw packed R64 detector words are explicitly rejected."
  },
  {
    "id": "purejsimage/ebsd-text",
    "version": "1.0.0",
    "format": "ANG/CTF orientation map",
    "packageExport": "purejsimage/scientific/readers/ebsd-text",
    "extensions": [
      "ang",
      "ctf"
    ],
    "mediaTypes": [
      "application/x-ebsd-ang",
      "application/x-ebsd-ctf"
    ],
    "resourceModel": "single",
    "datasetKinds": [
      "orientation-map"
    ],
    "directRangeReads": false,
    "boundary": "Bounded UTF-8 ANG square-grid and CTF rectangular orientation maps with validated row-major positions, physical scan axes, Euler angles, phase, and quality columns; staggered and hexagonal grids are rejected instead of silently reshaped."
  }
]

export const generatedScientificBrowserReaderCatalog = Object.freeze(
  entries.map((entry) => Object.freeze({
    ...entry,
    extensions: Object.freeze(entry.extensions),
    mediaTypes: Object.freeze(entry.mediaTypes),
    datasetKinds: Object.freeze(entry.datasetKinds),
  })),
)

export const importGeneratedScientificReaderModule = (id: string): Promise<unknown> => {
  switch (id) {
    case "purejsimage/gsf": return import('./readers/gsf.ts')
    case "purejsimage/nanonis-sxm": return import('./readers/nanonis-sxm.ts')
    case "purejsimage/igor-binary-wave": return import('./readers/igor-binary-wave.ts')
    case "purejsimage/digital-surf": return import('./readers/digital-surf.ts')
    case "purejsimage/x3p": return import('./readers/x3p.ts')
    case "purejsimage/envi": return import('./readers/envi.ts')
    case "purejsimage/fits": return import('./readers/fits.ts')
    case "purejsimage/mrc": return import('./readers/mrc.ts')
    case "purejsimage/cbf": return import('./readers/cbf.ts')
    case "purejsimage/png": return import('./readers/png.ts')
    case "purejsimage/jpeg": return import('./readers/jpeg.ts')
    case "purejsimage/webp": return import('./readers/webp.ts')
    case "purejsimage/bmp": return import('./readers/bmp.ts')
    case "purejsimage/jp2": return import('./readers/jp2.ts')
    case "purejsimage/tiff": return import('./readers/tiff.ts')
    case "purejsimage/ome-tiff": return import('./readers/ome-tiff.ts')
    case "purejsimage/ome-zarr": return import('./readers/ome-zarr.ts')
    case "purejsimage/aperio-svs": return import('./readers/aperio-svs.ts')
    case "purejsimage/digital-micrograph": return import('./readers/digital-micrograph.ts')
    case "purejsimage/tia-ser": return import('./readers/tia-ser.ts')
    case "purejsimage/tia-emi": return import('./readers/tia-emi.ts')
    case "purejsimage/ncem-emd": return import('./readers/ncem-emd.ts')
    case "purejsimage/velox-emd": return import('./readers/velox-emd.ts')
    case "purejsimage/rpl": return import('./readers/rpl.ts')
    case "purejsimage/emsa": return import('./readers/emsa.ts')
    case "purejsimage/nrrd": return import('./readers/nrrd.ts')
    case "purejsimage/meta-image": return import('./readers/meta-image.ts')
    case "purejsimage/nifti": return import('./readers/nifti.ts')
    case "purejsimage/dicom": return import('./readers/dicom.ts')
    case "purejsimage/npy": return import('./readers/npy.ts')
    case "purejsimage/blockfile": return import('./readers/blockfile.ts')
    case "purejsimage/mib": return import('./readers/mib.ts')
    case "purejsimage/ebsd-text": return import('./readers/ebsd-text.ts')
    default: return Promise.reject(new Error(`Unknown generated scientific reader ${id}`))
  }
}
