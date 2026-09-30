# JPEG XL shifted native-grid reference

The three compressed grids were decoded from the 1025x1027 file written by
`benchmark/jpegxl/verify-practical-shifted.ts`. That script pins the input
file's SHA-256 and checks every decoded native sample against the writer's
source arrays.

The independent decoder was jxl-oxide commit
`c0cc4c7ea57c1207f38ff2970d94757470613be4`. A temporary development
build captured each channel of the Modular frame before
`ImageWithRegion::upsample_nonseparable()` in
`crates/jxl-render/src/render.rs`. The capture wrote row-major signed 32-bit
little-endian samples. It cast 16-bit integer grids to signed 32-bit values
without changing their low 16 bits. No decode algorithm was changed. The
original source checkout and pinned CLI binary were restored after capture.

| Grid | Size | Raw SHA-256 |
| --- | ---: | --- |
| Associated alpha, 10-bit, shift 1 | 513x514 | `8134cbd6db6711c8424f9eea87babca13e64714ef565b6621db140cd1fbcfeff` |
| Black, 8-bit, shift 2 | 257x257 | `02e4037e9ab2f17bb6dccd269b5ca175146e58c6e75f8dc1132907f16913dfda` |
| Depth, binary16, shift 3 | 129x129 | `2f0810a233839bb41217a3843f099d27507db7faa89ccc37a378bd719126c608` |

The ordinary jxl-oxide CLI returns upsampled display grids. The temporary
capture is needed to compare samples at their encoded native dimensions.
