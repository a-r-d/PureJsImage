<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# Bruker Nanoscope SPM investigation

This is a capability investigation, not an experimental reader. PureJsImage does not currently detect or open Bruker/Veeco Nanoscope `.spm` files.

## Findings

Gwyddion lists Veeco Nanoscope III `.spm`/numbered files as readable and separately lists several unrelated `.spm` formats. The filename extension therefore cannot identify Nanoscope content safely:

- https://gwyddion.net/documentation/user-guide-en/file-formats.html

Publicly mirrored NanoScope documentation describes a text header divided into lists, a Ctrl-Z header terminator, padding, and little-endian signed 16-bit image data. It also shows that force-volume files contain additional image and curve payloads and that data offsets and scaling depend on header parameters:

- https://www.nanoqam.ca/help/Multimode/Content/SoftwareGuide/FileFormats/DataFileOrganization.htm
- https://www.nanophys.kth.se/nanolab/afm/icon/bruker-help/Content/ForceVolume/ForceVolImgFileFormat.htm

The University of Minnesota DRUM item named below is CC0 and includes `AFM local.zip` (31,873,907 bytes) with eleven `.spm` files captured on a Bruker Nanoscope V Multimode 8. The repository does not vendor or download that archive in normal development or CI:

- https://conservancy.umn.edu/items/bf29254e-ce3d-49db-ae5c-0cd0cffc41e2

## Required before implementation

- [ ] Pin a small CC0 corpus inventory with file hashes, acquisition mode, NanoScope version, expected channels, dimensions, units, and independently exported numeric samples
- [ ] Define content signatures that distinguish Nanoscope III-or-newer files from ISO 28600, FemtoScan, Nanoeducator, NanoSystem, Nanotop, and other `.spm` formats
- [ ] Specify the accepted header-list grammar, text encoding, Ctrl-Z/data-length rules, duplicate parameters, and maximum header size
- [ ] Define a read-only image subset before spectroscopy, force-volume, curve-map, or volume support
- [ ] Resolve image dimensions, data offsets and lengths, bytes per sample, byte order, scan direction, physical extent, units, and channel scaling without heuristics
- [ ] Cross-check every accepted file against trusted NanoScope export and an independent reader without copying GPL or third-party parser code
- [ ] Add truncated header/data, overlapping offsets, duplicate channel, impossible scale-reference, oversized dimension, and allocation-overflow regressions
- [ ] Demonstrate bounded selected-channel and spatial-region reads through `ImageSource`
- [ ] Keep the API explicitly experimental and read-only until multiple acquisition/version families pass exact native-sample validation

## Decision

Stop at investigation. The basic container is understandable, but the current evidence does not justify a parser that guesses across channel scaling and acquisition variants. GSF and ENVI provide the stable scientific raster paths in this release.
