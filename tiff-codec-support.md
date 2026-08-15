<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# TIFF codec support

This document is the capability contract for PureJsImage's first-party TIFF codec. A checked item is implemented and covered by tests or pinned fixtures. An unchecked item is planned and must remain an explicit unsupported operation until implemented.

## Decode

### Container and image layout

- [x] Classic TIFF 6.0 files with 32-bit offsets
- [x] Little-endian (`II`) and big-endian (`MM`) byte order
- [x] Explicit top-level frame selection, defaulting to the first image
- [x] Frame counting through the top-level IFD chain
- [x] Strip-based images
- [x] Chunky pixel layout (`PlanarConfiguration=1`)
- [x] Planar pixel layout (`PlanarConfiguration=2`)
- [x] Region decode without materializing a full RGBA source image
- [x] Orientation metadata (`Orientation` values 1-8)
- [x] Tiled images, including padded edges and legacy tile tables stored in strip tags
- [x] BigTIFF with validated 64-bit IFDs, counts, values, and offsets
- [x] Classic TIFF and BigTIFF SubIFD traversal with cycle, offset, and global directory-count validation plus alias-safe shared-directory reuse
- [x] Reduced-resolution pyramid selection through `resolutionLevel`, including nested and chained SubIFDs
- [x] Bounded validator-protected HTTP range input with request deduplication, an LRU byte cap, and selective COG-style tile reads

### Document, raster, and profile APIs

- [x] Public `openTiffDocument()` entry with stable top-level and SubIFD directory objects
- [x] Bounded typed `getTag()` reads, payload-free `getTagInfo()` metadata, plus per-directory display and native raster decoders
- [x] Configurable physical-segment count, segment-table construction-peak, and per-segment encoded-byte limits rejected before oversized payload reads
- [x] Native-precision planar or interleaved N-channel `RasterBlock` output without implicit RGB conversion
- [x] Explicit ordinary TIFF `ScientificDocument` reader with native precision/components, contiguous compatible-page series, labeled page axes, SubIFD resolution levels, bounded selected metadata, identities, cancellation, and region reads
- [x] Explicit `rasterToPixels()` display conversion with declared per-channel ranges
- [x] First-party GeoTIFF model, coordinate conversion, bounding-box, GeoKey, GDAL metadata, and nodata helpers
- [x] OME-TIFF Z/C/T datasets with validated dimension orders, channel metadata, physical pixel sizes, and explicit or implicit `TiffData` mappings
- [x] OME reduced-resolution SubIFD plane selection and separate-channel plane assembly
- [x] Explicit bounded scientific plane display mapping with declared or sampled ranges, scales, palettes, and optional scalar-surface relief
- [x] Deterministic TIFF profile registry with detector-failure isolation and equal-priority ambiguity rejection
- [x] First-party standard TIFF, ImageJ, DigitalMicrograph, FEI SFEG/Helios, and Zeiss SEM calibration profiles with normalized origins and steps, per-axis evidence, structured spatial/intensity status, format-default resolution evidence, bounded raw metadata, normalized acquisition fields, strict private-tag detection, and non-fatal validation warnings
- [x] Generic bounded `WholeSlideImage` levels, region reads, associated images, and physical metadata
- [x] First-party Aperio SVS pyramid, associated-image, MPP, objective, and JPEG 2000 tile integration
- [x] Explicit Aperio ScientificDocument reader with configurable large-source WSI limits, calibrated format-consistent pyramid levels, lightweight ICC presence/length metadata, distinct associated-image datasets, identities, cancellation, release forwarding, and bounded local or HTTP Range region reads
- [x] Separately compiled Leica SCN single-area example using only published package imports
- [ ] Automatic display semantics for arbitrary scientific multiband data
- [ ] Multi-area Leica scene composition and additional vendor-specific whole-slide profiles

### Pixel formats

- [x] 1-, 2-, 4-, 6-, 8-, 10-, 12-, 14-, 16-, 24-, 32-, and 64-bit grayscale (`WhiteIsZero` and `BlackIsZero`)
- [x] 1-, 2-, 4-, 8-, and 16-bit indexed color with a TIFF color map
- [x] 2-, 4-, 8-, 10-, 12-, 14-, 16-, 24-, 32-, and 64-bit RGB
- [x] 8-bit grayscale plus alpha
- [x] 8-bit RGBA
- [x] Associated and unassociated alpha samples
- [x] 16-bit grayscale-alpha and RGBA
- [x] Unsigned four-component CMYK / `Separated`, including `DotRange`
- [x] Five-sample unsigned CMYK plus associated or unassociated alpha
- [x] Chunky subsampled YCbCr and planar 1x1 YCbCr
- [x] 8-/16-bit RGB, indexed, and JPEG-backed ICC-profile color conversion
- [x] Signed 8- and 16-bit grayscale and RGB with raw numeric preservation
- [x] IEEE float16, float32, and float64 grayscale and RGB with raw numeric preservation
- [x] Signed 8-/16-bit and float16/float32/float64 CMYK with deterministic display-range normalization and direct RGB output
- [x] Unsigned 24-/32-bit samples preserved in `gray32` / `rgb32` blocks and unsigned 64-bit samples preserved in `gray64` / `rgb64` blocks
- [x] Deterministic display conversion using `SMinSampleValue` / `SMaxSampleValue` or documented full-type defaults without an 8-/16-bit raw intermediate
- [x] SGILog luminance reconstructed in native `yf32` CIE Y blocks with deterministic gamma-2 display conversion
- [x] SGILog24 and SGILog32 color reconstructed in native `xyzf32` CIE XYZ blocks with CCIR 709 display conversion
- [x] TIFF 6 8-bit CIELab L* and L*a*b* display conversion from D65 to sRGB with unassociated alpha
- [x] Embedded CMYK lut16 A2B0 ICC-profile conversion with profile precedence over numeric CMYK display

### Compression and prediction

- [x] Uncompressed strips
- [x] PackBits
- [x] LZW with standard MSB/early-change and legacy LSB/late-change code packing, including bounded final-strip padding
- [x] Deflate / Adobe Deflate
- [x] CCITT Group 4 (`T6`) bilevel fax, including multi-strip and `FillOrder=2` input
- [x] CCITT Modified Huffman and Group 3 (`T4`) fax, including mixed 1D/2D rows and legacy 1D rows without EOL markers
- [x] Horizontal differencing predictor for uniform 2-, 4-, 6-, 8-, 10-, 12-, 14-, 16-, 24-, 32-, and 64-bit integer or floating-point samples
- [x] Floating-point predictor 3 byte unshuffle and accumulation for float16, float32, and float64 samples
- [x] JPEG-in-TIFF (`Compression=7`) complete and abbreviated streams with `JPEGTables`
- [x] Old-style JPEG (`Compression=6`) complete interchange streams, multi-strip scans, omitted `RowsPerStrip`, and baseline Q/DC/AC table reconstruction
- [x] Aperio JPEG 2000 (`Compression=33003` YCbCr and `33005` MCT) tiles through the reusable codestream decoder
- [x] WebP-in-TIFF (`Compression=50001`) through explicit `createTiffCodec({ embeddedCodecs: [webpCodec] })` composition
- [x] SGILog (`Compression=34676`) and SGILog24 (`Compression=34677`) with bounded row RLE and exact segment sizing
- [x] Zstandard (`Compression=50000`) through the reusable first-party bounded decompressor
- [x] LERC and LERC plus Deflate (`Compression=34887`) with bounded first-party LERC2 decoding
- [ ] ThunderScan and other extension compressions
- [x] Reversed bit fill order (`FillOrder=2`) normalized per strip or tile before prediction

## Conformance evidence

The 2026-08-10 154-file Imazen TIFF baseline records 148 passes, 2 structured `UNSUPPORTED_OPERATION` results, and 4 safely rejected robustness inputs, with zero decode failures, invalid outputs, raw exceptions, timeouts, crashes, or out-of-memory results. Each file runs in an isolated worker with a 30-second timeout and 512 MiB heap limit. A pass means metadata inspection, TIFF-to-PNG decode, PNG reopen, and output-dimension validation all completed; it is not by itself an exact-pixel oracle.

Exact pixel behavior is covered separately by pinned focused fixtures and independent ImageMagick/LibTIFF, tifffile/imagecodecs, Esri LERC, libwebp, GeoTIFF.js, and OpenSlide comparisons. The TIFF conformance worker explicitly composes WebP; the default TIFF codec remains independent. Unsupported totals record only the first boundary reached.

### Remaining priorities

TIFF 6 CIELab converts the format's D65-referenced L*, a*, and b* samples directly to sRGB with explicit clipping and round-to-nearest output. CMYK lut16 A2B0 ICC profiles transform bounded rows and take precedence over numeric CMYK conversion. LogL and LogLuv reconstruct native CIE Y or XYZ float32 blocks. SGILog RLE scratch remains one row; decoded segment state is bounded to the current strip or tile.

### Follow-on priorities

1. Add alternate TIFF encoder compression and pixel profiles only when their complete contracts exist, prioritizing PackBits/LZW, grayscale, or 16-bit channels from demonstrated demand.
2. Keep implicit display conversion for generic multiband data unsupported; use native `RasterBlock` output or require an explicit channel/range mapping.
3. Keep ThunderScan unsupported: the current corpus fixture is truncated by three rows and LibTIFF independently rejects it.

## Encode

### Implemented target

- [x] Classic little-endian TIFF and BigTIFF with automatic or explicit container selection
- [x] Chunky 8-bit RGB and RGBA with unassociated alpha metadata
- [x] Independently Deflate-compressed strips or tiles with horizontal differencing (`Predictor=2`)
- [x] Automatic roughly 128 KiB strips or explicit `rowsPerStrip`; tile dimensions validated as multiples of 16
- [x] Bounded current-segment pixel and predictor scratch without a full uncompressed frame
- [x] Compatible RGB ICC profile writing when explicitly preserved
- [x] Multi-page top-level IFD chains and reduced-resolution SubIFD pyramids
- [x] Strict `compression`, `predictor`, `layout`, `compressionLevel`, `format`, strip, and tile options on the public encode APIs

### Planned

- [ ] Uncompressed, PackBits, LZW, JPEG, and other compression profiles
- [ ] Grayscale and palette encoding
- [ ] 16-bit channel encoding
- [ ] Associated-alpha encoding
- [ ] EXIF, XMP, resolution, and application metadata preservation

## Correctness and safety contract

- [x] Validate IFD extents, field types, counts, and offset arithmetic before reading or allocating
- [x] Traverse top-level and SubIFD graphs with bounded directory counts, cycle rejection, and alias-safe shared-directory reuse
- [x] Expose stable IFD offsets and graph lookup, bounded defensive-copy source reads, per-directory immutable tag caching with per-call limits, and typed explicit profile opening through public TIFF APIs
- [x] Validate strip/tile counts, byte ranges, decoded sizes, and predictor boundaries
- [x] Bound decompression output to the declared strip or tile geometry
- [x] Preflight aggregate decoded-segment, output-block, and predictor-scratch peaks before direct TIFF segment reads; stream tiled Aperio regions one native intersection at a time
- [x] Reject unsupported photometric interpretations, sample formats, and compressions explicitly
- [x] Verify decoded pixels against pinned LibTIFF fixtures
- [x] Verify packed 10-, 12-, and 14-bit output exactly at native 16-bit depth against ImageMagick/LibTIFF
- [x] Verify low packed depths, CMYK-alpha, and lossless WebP-in-TIFF output exactly against ImageMagick/LibTIFF
- [x] Verify explicitly composed lossy WebP-in-TIFF against the independently validated WebP decoder contract
- [x] Verify float16, float32, float64, and floating Predictor 3 display output exactly against ImageMagick/LibTIFF
- [x] Verify signed integer and IEEE floating-point raw values at native precision in both byte orders
- [x] Verify unsigned 24-/32-bit display output exactly against ImageMagick/LibTIFF and unsigned 64-bit raw values exactly above JavaScript's safe-integer range
- [x] Verify CCITT Group 4 output against independently encoded ImageMagick/LibTIFF fixtures
- [x] Verify TIFF 6 CIELab samples exactly against an independent colour-science oracle and CMYK lut16 ICC output within one 8-bit code value of ImageMagick/LittleCMS
- [x] Verify FillOrder 2 packed strip and padded edge-tile output against independently written fixtures decoded by ImageMagick/LibTIFF
- [x] Verify tiled LZW and BigTIFF output against independently encoded ImageMagick/LibTIFF fixtures
- [x] Verify standalone Zstandard raw, RLE, compressed, multi-block, checksum, repeated-table, repeated-offset, and hostile-input behavior against independently generated reference frames
- [x] Verify selected classic TIFF and BigTIFF pyramid levels independently and decode no unselected pixel segments
- [x] Verify 16-bit ColorMap scaling, floating-point CMYK display, and signed CMYK sample reconstruction exactly against independent ImageMagick and tifffile oracles
- [x] Verify canonical Deflate-predicted RGB and RGBA output exactly after ImageMagick/LibTIFF reopen
- [x] Verify first-party LERC and LERC-plus-Deflate pixels against the independent Esri decoder and reject corrupt masks, headers, dimensions, checksums, and missing TIFF metadata
- [x] Verify bounded HTTP range caching, resource validators, failure propagation, and selective tile reads without fetching unrelated segment payloads
- [x] Verify tiled RGB/RGBA, BigTIFF, multi-page, and SubIFD-pyramid writer output through independent GeoTIFF.js reopen
- [x] Compare PureJsImage, GeoTIFF.js, UTIF.js, image-js, and Jimp against sharp with an ImageMagick fallback on the targeted TIFF feature corpus
- [x] Complete the 154-file Imazen TIFF corpus decode-to-PNG baseline with every
  supported valid file decoded and all remaining inputs classified at structured boundaries
