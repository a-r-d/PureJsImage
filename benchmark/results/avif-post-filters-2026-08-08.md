# AVIF post-filter correctness and memory — 2026-08-08

## Correctness

`npm run fixtures:avif:post-filters` decoded the visible 8-bit Y, U, and V
planes with PureJsImage, FFmpeg 7.1.1 using dav1d 1.5.1, and FFmpeg 7.1.1
using libaom 3.12.1. Both independent decoders agreed with each other and with
PureJsImage byte for byte. The required and observed tolerance is zero.

| Fixture | Coverage | Dimensions | Shared YUV SHA-256 |
| --- | --- | ---: | --- |
| `post-filter-disabled-66x70.avif` | all filters disabled, odd dimensions | 66×70 | `531b29039dc36da51208b653d2ba19e49d6f88061f7311306442ea4bba7ddcb6` |
| `post-filter-deblock-96x74.avif` | deblocking, luma/chroma strengths, frame edges | 96×74 | `3fb3d421c23e6199fb490a572db0e599317a06e35f46b91463352ad5effc76c7` |
| `post-filter-cdef-66x70.avif` | luma/chroma CDEF, odd dimensions | 66×70 | `dc94bb2693cab9e76c2d5b1eb38c7047fa1caa43c68eb9e0cdcafe3282296e64` |
| `post-filter-wiener-sgr-66x70.avif` | luma Wiener and chroma self-guided restoration | 66×70 | `b39130d2a320227a1092a54ddbc27ad61cb8c34ee20e4ca39c6929dde6fe6882` |
| `post-filter-restoration-units-300x130.avif` | self-guided luma/chroma, two luma restoration-unit columns | 300×130 | `76dafc8db06b678046b403d02e250b17f6c6701196b10f944b75ecf757e033e8` |

The existing Kodak and Fox fixtures still decode, but they are not included in
the exact claim. dav1d and libaom agree on their reference pixels. Independent
comparison found and fixed a reconstruction bug at superblock boundaries: the
partition tree exposed below-left samples from the following superblock row
before those samples had been decoded. A second fix keeps chroma-mode contexts
on the 4:2:0 chroma grid rather than allowing intervening luma-only blocks to
overwrite them. This made Fox and both Kodak chroma planes byte-exact. The
single remaining difference is not hidden by widening the filter tolerance:

| Fixture | Y MAE / max | U MAE / max | V MAE / max |
| --- | ---: | ---: | ---: |
| Kodak 768×512 | 0.000003 / 1 | 0 / 0 | 0 / 0 |
| Fox 1204×800 | 0 / 0 | 0 / 0 | 0 / 0 |

## Allocation and RSS

The correctness-first implementation keeps the deblocked planes as the
restoration halo source. CDEF allocates one additional padded YUV frame only
when CDEF is active. Restoration allocates one more padded YUV destination only
when a restoration unit is active.

The allocation review did not remove either source-sized buffer. In-place CDEF
would overwrite samples still required by neighboring filter blocks. Loop
restoration also needs deblocked samples at stripe borders while using CDEF
samples in stripe interiors. Replacing either buffer safely therefore requires
a bounded row/stripe halo design plus renewed exact oracle validation; doing a
source-sized copy reduction before that proof would trade measured memory for
unmeasured pixel risk.

- Kodak's padded YUV frame is 589,824 bytes. It uses CDEF and no restoration,
  so the added source-sized working set is one frame (0.563 MiB).
- Fox's padded YUV frame is 1,449,600 bytes. It uses CDEF and switchable
  restoration, so the added source-sized working set is two frames (2.765 MiB).

The unchanged `npm run bench:avif:b2` workload measured 144.4 MiB maximum RSS
before the filter patch and 145.8 MiB after it on the same host, a 1.4 MiB
observed increase. Five warm decodes per photograph remained compatible. Median
wall time changed from 290.044 ms to 500.884 ms for Kodak and from 780.509 ms to
1552.254 ms for Fox. This work intentionally prioritizes correctness; those
timings are measurements, not optimization claims.

Three supplementary isolated cold processes per photograph showed substantial
JIT/RSS variance. Absolute peak RSS medians were 201.0 MiB before and 197.9 MiB
after for Kodak, and 190.0 MiB before and 202.5 MiB after for Fox. The warm
benchmark and the explicit byte counts above are the more stable evidence for
the incremental filter buffers.
