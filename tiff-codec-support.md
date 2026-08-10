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

- [x] 1-, 2-, 4-, 6-, 8-, 10-, 12-, 14-, and 16-bit grayscale (`WhiteIsZero` and `BlackIsZero`)
- [x] 1-, 2-, 4-, and 8-bit indexed color with a TIFF color map
- [x] 2-, 4-, 8-, 10-, 12-, 14-, and 16-bit RGB
- [x] 8-bit grayscale plus alpha
- [x] 8-bit RGBA
- [x] Associated and unassociated alpha samples
- [x] 16-bit grayscale-alpha and RGBA
- [x] Four-component CMYK / `Separated`, including `DotRange`
- [x] Five-sample CMYK plus associated or unassociated alpha
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
- [x] Horizontal differencing predictor for uniform 2-, 4-, 6-, 8-, 10-, 12-, 14-, and 16-bit unsigned samples
- [x] JPEG-in-TIFF (`Compression=7`) complete and abbreviated streams with `JPEGTables`
- [x] Old-style JPEG (`Compression=6`) complete interchange streams, multi-strip scans, omitted `RowsPerStrip`, and baseline Q/DC/AC table reconstruction
- [x] WebP-in-TIFF (`Compression=50001`) through explicit `createTiffCodec({ embeddedCodecs: [webpCodec] })` composition
- [ ] Zstandard, LERC, ThunderScan, and other extension compressions
- [ ] Reversed bit fill order (`FillOrder=2`) outside CCITT fax compression

## Decode roadmap

The 154-file Imazen baseline currently has no decode failures: 106 inputs pass, 44 reach structured `UNSUPPORTED_OPERATION` boundaries, and 4 robustness inputs are rejected safely. The TIFF conformance worker explicitly composes WebP; the default TIFF codec remains independent. Unsupported totals record only the first boundary reached.

### Next recommended capability

- [ ] Define raw preservation and deterministic display conversion semantics for signed integer and floating-point samples
- [ ] Add pixel formats or explicit normalization APIs before accepting scientific values
- [ ] Keep predictor reversal bounded to strip or tile buffers

This design checkpoint precedes signed or floating-point decoder work because the contract affects transforms, browser behavior, metadata, and memory accounting.

### Follow-on priorities

1. Add wide unsigned 24-, 32-, and 64-bit samples only after the raw/display pixel contract is defined.
2. Add SubIFD traversal, explicit frame selection, and reduced-resolution pyramid selection with cycle detection.
3. Keep generic five-band data unsupported until the public API has explicit band-selection semantics.
4. Treat LogLuv/SGILog and Zstandard as separate scientific and compression projects.
5. Keep ThunderScan unsupported: the only current corpus fixture is truncated by three rows and LibTIFF independently rejects it.

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
- [x] Verify packed 10-, 12-, and 14-bit output exactly at native 16-bit depth against ImageMagick/LibTIFF
- [x] Verify low packed depths, CMYK-alpha, and lossless WebP-in-TIFF output exactly against ImageMagick/LibTIFF
- [x] Verify explicitly composed lossy WebP-in-TIFF against the independently validated WebP decoder contract
- [x] Verify CCITT Group 4 output against independently encoded ImageMagick/LibTIFF fixtures
- [x] Verify tiled LZW and BigTIFF output against independently encoded ImageMagick/LibTIFF fixtures
- [x] Complete the 154-file Imazen TIFF corpus decode-to-PNG baseline with every
  supported valid file decoded and all remaining inputs classified at structured boundaries
