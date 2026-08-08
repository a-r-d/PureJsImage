# Committed AVIF fixtures

The two common-photo files are committed because the AVIF unit tests require
them:

- `fox.profile0.8bpc.yuv420.avif`
- `kodim03_yuv420_8bpc.avif`

They come from the libavif repository at revision
`25a6d23f872f37c91a3df15b75e1a97f590d7c46` under its BSD-2-Clause license.
Their source paths and SHA-256 checksums are pinned in `benchmark/avif/corpus.ts`.

The five `post-filter-*.avif` files are deterministic, opaque 8-bit YUV 4:2:0
fixtures encoded with libavif 1.3.0 and libaom 3.12.1. They isolate disabled
filters, deblocking, luma/chroma CDEF, Wiener plus self-guided restoration, odd
frame dimensions, frame edges, and multiple restoration units. Their encoded
and decoded YUV checksums are pinned in
`benchmark/avif/post-filter-fixtures.ts`.

Run `npm run fixtures:avif:post-filters` to decode every targeted fixture with
PureJsImage, dav1d, and libaom through FFmpeg. The required numeric tolerance is
zero: all three visible Y, U, and V planes must match byte for byte. The script
also verifies that the two independent decoders agree before accepting the
PureJsImage result.

The remaining benchmark corpus is intentionally ignored and can be prepared with
`npm run fixtures:avif`.
