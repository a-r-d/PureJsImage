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
- [x] Tiled images, including padded edges and legacy tile tables stored in strip tags
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
- [x] LZW with standard MSB/early-change and legacy LSB/late-change code packing, including bounded final-strip padding
- [x] Deflate / Adobe Deflate
- [x] CCITT Group 4 (`T6`) bilevel fax, including multi-strip and `FillOrder=2` input
- [x] CCITT Modified Huffman and Group 3 (`T4`) fax, including mixed 1D/2D rows and legacy 1D rows without EOL markers
- [x] Horizontal differencing predictor for uniform 8-bit and 16-bit samples
- [x] JPEG-in-TIFF (`Compression=7`) complete and abbreviated streams with `JPEGTables`
- [x] Old-style JPEG (`Compression=6`) complete interchange streams, multi-strip scans, omitted `RowsPerStrip`, and baseline Q/DC/AC table reconstruction
- [ ] Zstandard, WebP, LERC, and other extension compressions
- [ ] Reversed bit fill order (`FillOrder=2`) outside CCITT fax compression

## Decode roadmap

The 154-file Imazen baseline currently has no decode failures: 87 inputs pass, 63 reach structured `UNSUPPORTED_OPERATION` boundaries, and 4 robustness inputs are rejected safely. Unsupported totals record only the first boundary reached, so one input may still depend on another unsupported sample format, predictor, photometric interpretation, or compression.

### Next recommended capability

- [ ] Decode unsigned 10-, 12-, and 14-bit grayscale and RGB into existing `gray16` and `rgb16` pixel blocks
- [ ] Preserve the declared sample range without silently downconverting through an 8-bit intermediate
- [ ] Validate all 11 affected Imazen inputs against an independent decoder, including packed rows, planar data, strip/tile edges, and hostile size arithmetic

This is the highest-value bounded follow-up: it unlocks 11 corpus inputs without adding signed, floating-point, or generic multi-band pixel formats.

### Follow-on priorities

1. Decode four-component CMYK plus unassociated alpha into RGBA; keep arbitrary five-band imagery unsupported until the public API has explicit band-selection semantics.
2. Add packed 2- and 4-bit RGB plus 6-bit grayscale decode.
3. Consider WebP-in-TIFF only with explicit codec composition or registration so importing TIFF does not silently pull the WebP implementation into the bundle.
4. Treat signed integer and floating-point TIFF as a separate pipeline capability. Define preservation or normalization semantics and add corresponding pixel formats before accepting those samples.
5. Keep generic five-band data, LogLuv/SGILog, Zstandard, and ThunderScan unsupported until a demonstrated workload justifies their API, implementation, and security cost.

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
- [x] Complete the 154-file Imazen TIFF corpus decode-to-PNG baseline with every
  supported valid file decoded and all remaining inputs classified at structured boundaries
