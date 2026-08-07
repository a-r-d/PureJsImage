# Committed AVIF fixtures

These two files are committed because the AVIF unit tests require them:

- `fox.profile0.8bpc.yuv420.avif`
- `kodim03_yuv420_8bpc.avif`

They come from the libavif repository at revision
`25a6d23f872f37c91a3df15b75e1a97f590d7c46` under its BSD-2-Clause license.
Their source paths and SHA-256 checksums are pinned in `benchmark/avif/corpus.ts`.

The remaining benchmark corpus is intentionally ignored and can be prepared with
`npm run fixtures:avif`.
