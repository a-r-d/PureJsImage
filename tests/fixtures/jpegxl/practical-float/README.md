# JPEG XL mixed float display references

Run `node benchmark/jpegxl/generate-practical-float-references.ts` with the
pinned libjxl 0.12.0 build under `.tmp/jpegxl-oracles/` to regenerate these
fixtures. The script checks the decoder binary's SHA-256 before decoding.

Each JXL file is written by PureJsImage. Pinned libjxl `djxl` independently
decodes its original color and alpha samples to PFM. The manifest records
SHA-256 digests for the JXL and both PFM files, the decoded samples, and the
straight RGBA16 values for the caller's 0.25-to-1.25 display range. The
associated cases divide native color by alpha before applying that range.

The set covers gray and RGB binary16/binary32 color, opposite-width IEEE or
8-bit integer alpha, straight and associated alpha, and one two-pixel shifted
integer alpha case. The 8-bit alpha comparisons allow one output code of
rounding difference because PFM stores normalized alpha as binary32.
