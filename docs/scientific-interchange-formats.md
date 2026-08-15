# Scientific interchange and detector formats

Milestone H adds nine explicit, portable scientific readers. None are registered by importing the
root package or `purejsimage/scientific`; applications opt into only the formats they trust.

```ts
import { createScientificLibrary } from 'purejsimage/scientific'
import { emsaReader } from 'purejsimage/scientific/readers/emsa'
import { niftiReader } from 'purejsimage/scientific/readers/nifti'
import { nrrdReader } from 'purejsimage/scientific/readers/nrrd'
import { npyReader } from 'purejsimage/scientific/readers/npy'

const science = createScientificLibrary({
  readers: [emsaReader, nrrdReader, niftiReader, npyReader],
})
```

## Initial supported boundaries

| Entry | Supported initial contract | Deliberate exclusions |
| --- | --- | --- |
| `readers/rpl` | Lispix RPL plus one RAW companion, scalar numeric types, image/vector order, endian, offset, axis scale/origin/unit | Multi-file payloads and undocumented sample types |
| `readers/emsa` | Bounded EMSA/MAS text spectra with Y or XY data and native series reads | Multidimensional spectra and unknown DATATYPE variants |
| `readers/nrrd` | NRRD0001-0005, raw or bounded gzip, attached or one detached data file, scalar numeric types, endian, directions, origin, spacing, labels, units, kinds, key/value metadata | ASCII, bzip2, multi-file LIST/pattern payloads |
| `readers/meta-image` | Binary MHA LOCAL or MHD plus one raw companion, scalar or bounded interleaved components, endian, spacing, origin, direction metadata | Compressed/ASCII payloads, `HeaderSize = -1`, file series |
| `readers/nifti` | Single-file NIfTI-1 and NIfTI-2 `.nii`, plus bounded whole-file `.nii.gz`; scalar numeric types, scaling, voxel units, qform/sform preservation | Paired hdr/img, complex/RGB/binary data, extension interpretation |
| `readers/npy` | NPY v1-v3, C or Fortran order, explicitly endian scalar boolean/integer/float arrays, generic index axes | Scalar, structured, object, complex, datetime, Unicode, ambiguous native-endian, NPZ |
| `readers/blockfile` | NanoMegas ASTAR BLO uint8 diffraction frames, frame IDs, navigator, scan calibration, acquisition metadata | Non-square or non-uint8 diffraction payloads |
| `readers/mib` | Processed Merlin U08/U16/U32 frame sequences with 384/768-byte headers and optional acquisition HDR sidecar | Packed raw R64 words |
| `readers/ebsd-text` | Rectangular row-major ANG square grids and CTF maps with Euler, phase, position, and quality components | Hexagonal/staggered ANG grids, IPF rendering, grain analysis |

RPL/RAW, detached NRRD, detached MHD, and optional MIB HDR files use the portable
`ScientificCompanionResolver`; browser callers provide `File` companions and Node callers can use
the constrained path adapter. A filename or media type is only a hint. Structural probes determine
the winning reader.

## Large-data and numeric behavior

Uncompressed RPL, NRRD, MetaImage, NIfTI, NPY, BLO, and MIB datasets keep payloads lazy and fetch
only selected row spans or frames. Text formats are bounded before parsing. Gzip NRRD data and
`.nii.gz` are explicit bounded whole-decompression paths because arbitrary compressed range access
is unavailable. Every reader exposes configurable input, metadata, element, decoded-byte, region,
and read-operation limits appropriate to its structure.

All emitted numeric blocks use the scientific API's canonical big-endian representation. No reader
silently converts native samples to display-oriented uint8 pixels. NPY intentionally exposes
generic index axes because the format does not carry calibration. Rotated NRRD directions and the
complete NIfTI qform/sform matrices remain in metadata when they cannot be represented as separable
one-dimensional coordinates.

EDAX SPC/SPD/IPR and Bruker BCF remain later roadmap items: both require additional companion,
container, calibration, and spectrum-image contracts and are not claimed by these readers.
