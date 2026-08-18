# AFM, SPM, and surface formats

Milestone F adds four explicit, browser-portable scientific readers and one shared bounded ZIP
container. Importing the base scientific package still does not register any reader automatically.

## Supported readers

| Reader | Implemented boundary | Direct selected reads |
| --- | --- | --- |
| Nanonis SXM | Version 2 `FLOAT MSBFIRST` image files; every channel and forward/backward direction is a separate dataset; X/Y range and offset, angle, bias, controller metadata, channel units, calibration fields, and scan direction are preserved. File rows are not flipped: Y starts at offset plus range and has a negative step. | Yes, selected rows from one channel. |
| Igor Binary Wave | Version 5 numeric waves with two through four contiguous dimensions; signed/unsigned integer and IEEE float types; endian and header checksum validation; linear scaling, units, notes, labels, and channel entries. | Yes, selected XY rows at fixed higher-axis indices. |
| Digital Surf SUR/PRO | Integer profile, surface, multilayer, and surface-series object types; stored or bounded zlib-stream data; exact `(stored - Zmin) * Zspacing / ZunitRatio + Zoffset`; special points become `NaN`; physical axes, units, comments, private-zone limits, and object enumeration. | Profiles and decoded surfaces expose selected regions; compressed objects are decoded under a whole-object byte cap. |
| X3P | ISO 5436-2 `SUR` records with incremental X/Y axes, one Z layer, numeric binary Z data, optional validity masks, and exact Z increment/offset conversion. | Stored point members remain range-backed; compressed members are bounded in memory. |

## Shared ZIP/ZIP64 boundary

The internal surface archive layer finds EOCD or ZIP64 EOCD records from the tail, reads only the
bounded central directory, validates local/member extents and normalized relative paths, rejects
duplicates, encryption, multi-disk archives, and unsupported methods, and supports stored and raw
Deflate members. `read()` verifies declared output size and CRC-32. `openStored()` intentionally
returns a zero-copy range view; callers that need whole-member CRC verification use `read()`.
Entry count, central-directory bytes, per-member bytes, total declared decoded bytes, and expansion
ratio are separately bounded.

## Explicit exclusions

- Bruker NanoScope SPM remains `planned`. The parser promotion gate requires three independent
  acquisition/software families with exact Z scaling, while the available corpus currently proves
  only one complete image family. Extension-only detection is never accepted.
- IBW v2/v3, rank-1 waves, text waves, complex samples, formula-dependent waves, and private option
  sections are rejected.
- Digital Surf RGB, spectra, and spectral maps remain outside the numeric surface/profile subset.
- X3P inline point lists, absolute X/Y coordinate arrays, and multilayer Z matrices are rejected.
- ZIP-backed JPK fixtures available to the project are force curves/maps rather than the initial
  image subset. A `.jpk` image fixture encountered during research is TIFF, not a ZIP container.
- OME-Zarr ZIP archives are read by the OME-Zarr reader when root-level `zarr.json` or `.zgroup`
  is present. RFC-9 zip-comment and `jsonFirst` requirements remain unclaimed.

## Evidence

Focused tests use two independently produced Nanonis acquisitions, one Asylum AFM IBW v5 file, a
compressed Digital Surf surface, and two OpenFMC ISO 5436 examples. They pin dimensions,
calibration, labels, selected samples, row orientation, and sparse read counts. The same public
reader entries open selected regions in real Chromium. Fixture provenance and hashes live beside
the binary fixtures in `tests/fixtures/scientific-surface/README.md`.
