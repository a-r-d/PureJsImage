# JPEG 2000 real-world RSS gate — 2026-08-08

The fixture is `wikimedia-blue-marble-openjpeg-lossless.jp2`, a public-domain
NASA photograph encoded losslessly with ImageMagick 7.1.2-3 and OpenJPEG 2.5.3.
It is 2,639,087 bytes compressed and decodes to 1920×2172 RGB pixels.

Each row ran in its own Node 24.16.0 process. Baselines were captured after five
explicit garbage collections and event-loop turns. The warm maximum is the
absolute process high-water mark and therefore includes the warmup execution.

| Action | Mode | Wall | Baseline RSS | Absolute peak RSS | Final external | Final ArrayBuffer | Output |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Metadata | Cold | 13.7 ms | 93.3 MiB | 97.3 MiB | 11.9 MiB | 2.6 MiB | 1920×2172 |
| Metadata | Warm | 13.3 ms | 96.7 MiB | 100.6 MiB | 11.9 MiB | 2.6 MiB | 1920×2172 |
| Resize to JPEG | Cold | 4,422.4 ms | 93.5 MiB | 191.8 MiB | 15.3 MiB | 6.0 MiB | 480×543, 28,205 bytes |
| Resize to JPEG | Warm | 4,204.0 ms | 128.9 MiB | 211.0 MiB | 39.7 MiB | 30.4 MiB | 480×543, 28,205 bytes |

The JPEG output was independently decoded with `jpeg-js`; both modes produced
SHA-256 `53e1d505fb26697e9f91135ed973102cd4cb3f474dc9ef75404bd7233c1f3995`.

`npm run bench:jpeg2000:rss` enforces a 128 MiB absolute peak for metadata and a
256 MiB absolute peak for the resize workflow. The resize result confirms that
the current full-frame fallback is not safe for a 256 MiB Lambda tier once
normal runtime headroom and concurrency are considered. Use at least a 512 MiB
tier for comparable four-megapixel inputs, or lower `maxPixels` and
`maxDecodedBytes` for smaller deployments.
