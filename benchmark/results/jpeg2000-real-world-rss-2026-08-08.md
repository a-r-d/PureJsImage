# JPEG 2000 real-world RSS gate — updated 2026-08-12

The fixture is `wikimedia-blue-marble-openjpeg-lossless.jp2`, a public-domain
NASA photograph encoded losslessly with ImageMagick 7.1.2-3 and OpenJPEG 2.5.3.
It is 2,639,087 bytes compressed and decodes to 1920×2172 RGB pixels.

Each row ran in its own Node 24.16.0 process. Baselines were captured after five
explicit garbage collections and event-loop turns. The warm maximum is the
absolute process high-water mark and therefore includes the warmup execution.

| Action | Mode | Wall | Baseline RSS | Absolute peak RSS | Final external | Final ArrayBuffer | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Metadata | Cold | 3.8 ms | 95.3 MiB | 95.7 MiB | 12.6 MiB | 2.6 MiB | 1920×2172 |
| Metadata | Warm | 0.4 ms | 96.1 MiB | 96.5 MiB | 12.6 MiB | 2.6 MiB | 1920×2172 |
| Resize to JPEG | Cold | 468.2 ms | 95.9 MiB | 119.4 MiB | 19.6 MiB | 9.5 MiB | 480×543, 29,301 bytes |
| Resize to JPEG | Warm | 446.2 ms | 117.6 MiB | 123.0 MiB | 19.2 MiB | 9.2 MiB | 480×543, 29,301 bytes |

The resize path selected the denominator-4 wavelet level, emitted bounded rows,
and avoided a source-sized RGB or RGBA bitmap. The JPEG output was independently
decoded with `jpeg-js`; both modes produced SHA-256
`ad3d085b73c6e98df0c21cef23be11d54eca8f0f34ad1c247330326491e89964`.

`npm run bench:jpeg2000:rss` enforces a 128 MiB absolute peak for metadata and a
160 MiB absolute peak for resize. Decode still retains the compressed codestream
and the selected-resolution component planes for the active tile row, so a
single-tile full-resolution decode remains an explicit full-component fallback.
