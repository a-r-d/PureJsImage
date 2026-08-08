<!-- Generated from capabilities/manifest.json by npm run capabilities:generate. Do not edit directly. -->
# TIFF codec support

This document is the capability contract for PureJsImage's first-party TIFF codec. A checked item is implemented and covered by tests or pinned fixtures. An unchecked item is planned and must remain an explicit unsupported operation until implemented.

## Decode

### Container and image layout

- [x] Classic TIFF 6.0 files with 32-bit offsets
- [x] Little-endian (`II`) and big-endian (`MM`) byte order
- [x] First-image decode for multi-image TIFF files
- [x] Frame counting through the top-level IFD chain
- [x] Strip-based images
- [x] Chunky pixel layout (`PlanarConfiguration=1`)
- [x] Planar pixel layout (`PlanarConfiguration=2`)
- [x] Region decode without materializing a full RGBA source image
- [x] Orientation metadata (`Orientation` values 1-8)
- [x] Tiled images, including padded right and bottom edges
- [x] BigTIFF with validated 64-bit IFDs, counts, values, and offsets
- [ ] SubIFDs, pyramids, and reduced-resolution images

### Pixel formats

- [x] 1-, 2-, 4-, and 8-bit grayscale (`WhiteIsZero` and `BlackIsZero`)
- [x] 1-, 2-, 4-, and 8-bit indexed color with a TIFF color map
- [x] 8-bit RGB
- [x] 8-bit grayscale plus alpha
- [x] 8-bit RGBA
- [x] Associated and unassociated alpha samples
- [x] 16-bit grayscale, grayscale-alpha, RGB, and RGBA
- [x] Four-component CMYK / `Separated`, including `DotRange`
- [x] Chunky subsampled YCbCr and planar 1x1 YCbCr
- [x] RGB, indexed, and JPEG-backed ICC-profile color conversion
- [ ] CIELab and CMYK ICC-profile color conversion
- [ ] Floating-point sample formats

### Compression and prediction

- [x] Uncompressed strips
- [x] PackBits
- [x] LZW
- [x] Deflate / Adobe Deflate
- [x] CCITT Group 4 (`T6`) bilevel fax, including multi-strip and `FillOrder=2` input
- [x] CCITT Modified Huffman and Group 3 (`T4`) fax, including mixed 1D/2D rows
- [x] Horizontal differencing predictor for uniform 8-bit and 16-bit samples
- [x] JPEG-in-TIFF (`Compression=7`) complete and abbreviated streams with `JPEGTables`
- [x] Old-style JPEG (`Compression=6`) complete interchange streams and baseline Q/DC/AC table reconstruction
- [ ] Zstandard, WebP, LERC, and other extension compressions
- [ ] Reversed bit fill order (`FillOrder=2`) outside CCITT fax compression

## Encode

### Implemented target

- [x] Classic little-endian TIFF with 32-bit offsets
- [x] Streaming, top-to-bottom output without a full-frame staging buffer
- [x] Uncompressed 8-bit grayscale
- [x] Uncompressed 8-bit RGB
- [x] Uncompressed 8-bit RGBA with unassociated alpha metadata
- [x] Compatible ICC profile writing when explicitly preserved
- [x] Public `image.tiff()` and `image.encode('tiff')` APIs

### Planned

- [ ] Configurable rows per strip
- [ ] PackBits, LZW, and Deflate compression
- [ ] Palette encoding
- [ ] 16-bit channel encoding
- [ ] Associated-alpha encoding
- [ ] Tiled and pyramidal TIFF output
- [ ] Multi-image TIFF output
- [ ] BigTIFF output
- [ ] EXIF, XMP, resolution, and application metadata preservation

## Correctness and safety contract

- [x] Validate IFD extents, field types, counts, and offset arithmetic before reading or allocating
- [x] Validate strip/tile counts, byte ranges, decoded sizes, and predictor boundaries
- [x] Bound decompression output to the declared strip or tile geometry
- [x] Reject unsupported photometric interpretations, sample formats, and compressions explicitly
- [x] Verify decoded pixels against pinned LibTIFF fixtures
- [x] Verify CCITT Group 4 output against independently encoded ImageMagick/LibTIFF fixtures
- [x] Verify tiled LZW and BigTIFF output against independently encoded ImageMagick/LibTIFF fixtures
- [x] Benchmark absolute peak RSS in isolated cold and warm processes
