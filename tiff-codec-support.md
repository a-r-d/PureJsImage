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
- [ ] CIELab and CMYK ICC-profile conversion

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
- [x] WebP-in-TIFF (`Compression=50001`) through explicit `createTiffCodec({ embeddedCodecs: [webpCodec] })` composition
- [x] SGILog (`Compression=34676`) and SGILog24 (`Compression=34677`) with bounded row RLE and exact segment sizing
- [ ] Zstandard, LERC, ThunderScan, and other extension compressions
- [ ] Reversed bit fill order (`FillOrder=2`) outside CCITT fax compression

## Decode roadmap

The 154-file Imazen baseline currently has no decode failures: 147 inputs pass, 3 reach structured `UNSUPPORTED_OPERATION` boundaries, and 4 robustness inputs are rejected safely. The TIFF conformance worker explicitly composes WebP; the default TIFF codec remains independent. Unsupported totals record only the first boundary reached.

### Next recommended capability

- [ ] Add CIELab display conversion with an explicit output color contract
- [ ] Expand TIFF encoding beyond uncompressed strips

LogL and LogLuv now reconstruct native CIE Y or XYZ float32 blocks. SGILog RLE scratch remains one row; decoded segment state is bounded to the current strip or tile. Display conversion uses the LogLuv CCIR 709 equal-energy-white matrix, gamma 2, and explicit clipping.

### Follow-on priorities

1. Add CIELab display conversion with an explicit output color contract.
2. Treat Zstandard as a separate first-party compression project.
3. Keep generic five-band data unsupported until its public pixel semantics are defined.
4. Keep ThunderScan unsupported: the current corpus fixture is truncated by three rows and LibTIFF independently rejects it.

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
- [x] Traverse top-level and SubIFD graphs with bounded directory counts, cycle rejection, and alias-safe shared-directory reuse
- [x] Validate strip/tile counts, byte ranges, decoded sizes, and predictor boundaries
- [x] Bound decompression output to the declared strip or tile geometry
- [x] Reject unsupported photometric interpretations, sample formats, and compressions explicitly
- [x] Verify decoded pixels against pinned LibTIFF fixtures
- [x] Verify packed 10-, 12-, and 14-bit output exactly at native 16-bit depth against ImageMagick/LibTIFF
- [x] Verify low packed depths, CMYK-alpha, and lossless WebP-in-TIFF output exactly against ImageMagick/LibTIFF
- [x] Verify explicitly composed lossy WebP-in-TIFF against the independently validated WebP decoder contract
- [x] Verify float16, float32, float64, and floating Predictor 3 display output exactly against ImageMagick/LibTIFF
- [x] Verify signed integer and IEEE floating-point raw values at native precision in both byte orders
- [x] Verify unsigned 24-/32-bit display output exactly against ImageMagick/LibTIFF and unsigned 64-bit raw values exactly above JavaScript's safe-integer range
- [x] Verify CCITT Group 4 output against independently encoded ImageMagick/LibTIFF fixtures
- [x] Verify tiled LZW and BigTIFF output against independently encoded ImageMagick/LibTIFF fixtures
- [x] Verify selected classic TIFF and BigTIFF pyramid levels independently and decode no unselected pixel segments
- [x] Verify 16-bit ColorMap scaling, floating-point CMYK display, and signed CMYK sample reconstruction exactly against independent ImageMagick and tifffile oracles
- [x] Complete the 154-file Imazen TIFF corpus decode-to-PNG baseline with every
  supported valid file decoded and all remaining inputs classified at structured boundaries
