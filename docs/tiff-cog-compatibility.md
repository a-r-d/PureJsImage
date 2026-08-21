<!-- Generated from src/tiff/compressions.ts and tests/fixtures/cog/manifest.json. Do not edit directly. -->
# Cloud Optimized GeoTIFF compatibility

PureJsImage supports selective range-backed reads from tiled TIFF and BigTIFF files, but COG
compatibility is a combination of container layout, compression, overview structure, pixel layout,
and the API used for decoding. The matrix below is checked against executable tests instead of being
inferred from compression constants.

“Fully tested” means a deterministic COG or existing selective-range fixture exercises the assigned
compression. “Implemented but weakly COG-tested” means the codec has focused pixel tests, but this
repository does not yet have a deterministic COG-layout fixture for that assignment. “Recognized but
unsupported” and “not implemented” both fail with an explicit compression ID and name.

## Compression audit

| ID | Compression | Evidence status | Decode surface | Boundary |
| ---: | --- | --- | --- | --- |
| 1 | Uncompressed | Fully tested | Display and native raster | Strips and tiles. |
| 2 | CCITT Modified Huffman | Implemented but weakly COG-tested | Display only | Bilevel display decoding. |
| 3 | CCITT Group 3 | Implemented but weakly COG-tested | Display only | Bilevel display decoding with supported T4 options. |
| 4 | CCITT Group 4 | Implemented but weakly COG-tested | Display only | Bilevel display decoding with supported T6 options. |
| 5 | LZW | Fully tested | Display and native raster | Standard and legacy code packing. |
| 6 | Old-style JPEG | Implemented but weakly COG-tested | Display only | Complete streams and supported table reconstruction. |
| 7 | JPEG | Fully tested | Display and native raster | Complete or JPEGTables-composed streams. Native raster keeps 3-band YCbCr as converted RGB and 4-band photometric RGB ExtraSamples=0 as preserved components. |
| 8 | Deflate | Fully tested | Display and native raster | TIFF Deflate assignment. |
| 32773 | PackBits | Fully tested | Display and native raster | Bounded PackBits strips and tiles. |
| 32809 | ThunderScan | Recognized but unsupported | Unsupported | No decoder; rejected explicitly. |
| 32946 | Adobe Deflate | Implemented but weakly COG-tested | Display and native raster | Decoded by the bounded Deflate path. |
| 33003 | Aperio JPEG 2000 YCbCr | Implemented but weakly COG-tested | Display only | Aperio codestream tiles. |
| 33005 | Aperio JPEG 2000 MCT | Implemented but weakly COG-tested | Display only | Aperio codestream tiles. |
| 34676 | SGILog | Implemented but weakly COG-tested | Display only | LogL and LogLuv layouts only. |
| 34677 | SGILog24 | Implemented but weakly COG-tested | Display only | LogLuv layouts only. |
| 34712 | JPEG 2000 | Not implemented | Unsupported | The general TIFF assignment is not implemented; only the tested Aperio assignments are. |
| 34887 | LERC | Implemented but weakly COG-tested | Display and native raster | LERC2 and LERC plus Deflate; LERC plus Zstandard is unsupported. |
| 50000 | Zstandard | Implemented but weakly COG-tested | Display and native raster | First-party bounded Zstandard decoder. |
| 50001 | WebP | Implemented but weakly COG-tested | Display with explicit codec composition | Requires explicit TIFF/WebP codec composition. |
| 50002 | JPEG XL | Not implemented | Unsupported | No TIFF JPEG XL segment integration. |

Native scientific TIFF reads require the “Display and native raster” surface. Old-style JPEG,
CCITT, Aperio JPEG 2000, and SGILog remain display-decoder capabilities and are not silently
converted into native scientific raster samples. JPEG compression 7 native raster is tested for
three-band YCbCr-converted RGB and four-band photometric RGB ExtraSamples=0 layouts; four-band
sources are not routed through the RGB display decoder. WebP requires explicit TIFF/WebP codec
composition.

## Deterministic COG corpus

| Fixture | Container | Compression IDs | Levels | Bytes |
| --- | --- | --- | --- | ---: |
| `classic-deflate-rgb-nodata.tif` | TIFF | 8 | 16×16 | 1,220 |
| `bigtiff-lzw-rgba.tif` | BigTIFF | 5 | 8×8 | 908 |
| `subifd-deflate-rotated.tif` | TIFF | 8 | 32×32 → 16×16 | 4,916 |
| `showcase-subifd-deflate-rotated.tif` | TIFF | 8 | 2048×1024 → 1024×512 → 512×256 | 238,596 |
| `classic-packbits-gray.tif` | TIFF | 32773 | 16×8 | 490 |
| `classic-jpeg-rgb.tif` | TIFF | 7 | 16×8 | 1,610 |
| `classic-jpeg-rgb-nir.tif` | TIFF | 7 | 20×12 → 10×6 | 3,706 |

The corpus covers tiled Classic TIFF and BigTIFF, internal SubIFD overviews, Deflate, LZW, PackBits,
JPEG-in-TIFF three-band YCbCr and four-band RGB+unspecified extra-sample layouts, scalar and
component nodata, RGB and RGBA samples, north-up and rotated affines, and pixel-is-area/pixel-is-point
semantics. Every audited compression fixture can be opened through the GeoTIFF geo reader.
Reduced-resolution tile payloads precede full-resolution tile payloads in the pyramid fixture so a
remote overview request can avoid the base imagery.

Regenerate the corpus reproducibly with:

```sh
npm run fixtures:cog:prepare
```

The generator is first-party TypeScript. Node's zlib and the existing development-only `jpeg-js`
oracle encode fixture segments; neither is a published runtime dependency. SHA-256 values and byte
lengths are recorded in `tests/fixtures/cog/manifest.json`.

Set `PUREJSIMAGE_GDAL_ORACLE=1` when GDAL development tools are installed to compare the public
geo reader's size, affine, and band count with `gdalinfo -json`. GDAL is an optional test oracle
and is not a runtime dependency.

## Structural inspection

`inspectCog(document)` reports TIFF versus BigTIFF, byte order, IFD/SubIFD paths and offsets,
overview dimensions, tile geometry and offsets, compression status, sample layout, and likely COG
issues such as strips, missing tile tables, non-reduced overviews, non-monotonic tile offsets,
unsupported compression, or IFDs stored after image data.

```ts
import { inspectCog, openTiffDocument } from 'purejsimage/tiff'

const document = await openTiffDocument(source)
const report = await inspectCog(document)
console.log(report.container, report.directories, report.issues)
```

This is a structural diagnostic, not a standards certification service. A warning identifies a
layout that is likely to cost extra remote reads; an error means the file misses a core tiled/readable
boundary used by PureJsImage.

The public geo adapter adds object size, normalized geospatial evidence, range-read suitability,
request and transferred-byte counts, unique bytes, and cache activity while keeping the same
non-certification boundary:

```ts
import { geoTiffReader } from 'purejsimage/geo/readers/geotiff'

const document = await geoTiffReader.open(context)
const report = await document.inspectStructure()
console.log(report.formalCogCertification, report.io)
```

## Viewport benchmark

`npm run bench:cog:viewport` opens the pyramid through a simulated HTTP Range server. It accepts
pixel or model viewports, chooses an overview from requested output resolution, asserts the expected
level, decodes the selected region twice, and reports request count, fetched bytes, cache hits, time
to first decoded TIFF tile block, total decode time, and decoded pixels. The benchmark fails if it
fetches the complete fixture, and CI uses no live remote server.

```sh
npm run bench:cog:viewport
npm run bench:cog:viewport -- --space model
npm run bench:cog:viewport -- --space pixel --viewport 0,0,32,32
```
