# World files, ENVI, ASCII Grid, and SRTM HGT

## Quick answer

PureJsImage can open georeferenced TIFF, JPEG, or PNG images with an explicit world-file companion,
georeferenced ENVI rasters, Esri ASCII Grids, and SRTM HGT elevation tiles. Each reader returns the
same lazy `GeoRasterDataset` contract used by GeoTIFF and GeoZarr. The readers keep the access limits
of their source formats and do not advertise ASCII data as random-access or cloud-optimized.

## Public imports

The portable readers are available from these entries:

```ts
import { worldFileReader } from "purejsimage/geo/readers/world-file";
import { geoEnviReader } from "purejsimage/geo/readers/envi";
import { esriAsciiGridReader } from "purejsimage/geo/readers/esri-ascii-grid";
import { srtmHgtReader } from "purejsimage/geo/readers/srtm-hgt";
```

They also appear in the explicit `geoReaders` registry from
`purejsimage/geo/readers/all`. Importing `purejsimage/geo` alone does not register or load them.

## Images with world files

The world-file reader uses the existing TIFF, JPEG, or PNG scientific image reader for pixels. It
adds grid evidence from a caller-supplied companion resolver. It recognizes the following exact
sibling names:

| Image | Conventional suffix | Additional accepted suffixes |
| --- | --- | --- |
| `map.tif` or `map.tiff` | `map.tfw` | `map.tifw` or `map.tiffw`, `map.wld` |
| `map.jpg`, `map.jpeg`, or `map.jpe` | `map.jgw` | the image extension plus `w`, `map.wld` |
| `map.png` | `map.pgw` | `map.pngw`, `map.wld` |

Exactly one matching world file is required. An optional `map.prj` is read as coordinate reference
system evidence. The original WKT is retained. PureJsImage reads an authority and code only when it
is stated in the WKT. It does not use a built-in WKT-to-EPSG database.

A world file lists column scale, row rotation, column rotation, row scale, X center, and Y center in
that order. The final two values locate the center of the upper-left pixel. The reader converts them
to the corner-based six-value affine used by `GeoGridGeometry` and records
`pixel-is-area` registration. Rotation, shear, and either sign are preserved.

Browser callers can use `createScientificFileContext()` with an explicit companion `File` set. Node
callers can use `openWorldFilePath()` from `purejsimage/geo/readers/world-file/node`. HTTP callers can
use `openWorldFileHttp()`. The HTTP helper checks only the documented sibling names at the same URL
path. It does not crawl a directory or guess unrelated URLs. Sidecar byte limits apply before text
decoding.

## ENVI

The geo ENVI reader delegates binary reads to the existing ENVI implementation. BSQ, BIL, and BIP
therefore share the same decoder, byte-order handling, header offsets, source lifecycle, and bounded
plane reads as `purejsimage/scientific/readers/envi`.

The geo adapter requires `map info`. It normalizes samples, lines, bands, sample type, interleave,
byte order, nodata, band names, wavelengths, wavelength units, reflectance scale, and bounded
acquisition fields. It retains the coordinate-system string as original WKT evidence. UTM-style and
geographic map information become an upper-row affine without changing the native sample data.

## Esri ASCII Grid

The ASCII Grid reader accepts `ncols`, `nrows`, one matching lower-left X/Y origin pair, `cellsize`,
and optional `NODATA_value`. Corner declarations become `pixel-is-area`. Center declarations become
`pixel-is-point`. Mixing corner and center declarations is invalid.

ASCII rows are stored north to south, while the header describes the lower-left location. The reader
converts that location to an upper-row affine with a negative Y step. File bytes, rows, columns,
tokens, row bytes, and decoded sample bytes have explicit limits.

Opening an ASCII Grid must parse its text. A later region read parses preceding ASCII content again
unless an external indexed representation is prepared. The descriptor and diagnostics state this
sequential-read behavior. The reader does not claim cloud optimization.

## SRTM HGT

The HGT reader accepts only exact file sizes for 1201 by 1201 or 3601 by 3601 signed 16-bit samples.
Samples are big-endian, rows run north to south, and `-32768` is the void value. Region reads request
only the required contiguous source rows.

Location is read only from a filename that exactly matches a tile such as `N37W122.hgt` or
`S12E130.hgt`. An explicit integer southwest-corner location can be supplied when the filename is
missing or unsuitable. Other strings are not interpreted as coordinates. The grid uses EPSG:4326
evidence and `pixel-is-point` registration because tile edge samples lie on geographic nodes.

## Scope and limitations

These readers normalize defensible source evidence. They do not reproject coordinates, discover
catalogs, warp ground control points, scan remote object stores, or create another raster buffer or
dataset engine. Reprojection remains an explicit operation with a caller-supplied coordinate
transform when the source and target CRS differ.
