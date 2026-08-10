# AVIF high-bit-depth lossy correctness — 2026-08-09

## Correctness

`npm run fixtures:avif:high-bit` decoded native high-depth Y, U, and V planes
with PureJsImage, FFmpeg 7.1.1 using dav1d 1.5.1, and FFmpeg 7.1.1 using
libaom 3.12.1. The two independent decoders and PureJsImage agreed byte for
byte for every fixture below. The required and observed tolerance is zero.
Portable 8-bit RGBA output is separately checksum-pinned in
`benchmark/avif/high-bit-expanded-fixtures.ts` and exercised in Node.js and
Chromium.

| Fixture | Coverage | Dimensions | Shared native YUV SHA-256 |
| --- | --- | ---: | --- |
| `filter-free-lossy-10bpc-yuv420-32x24.avif` | 10-bit, YUV 4:2:0, quantizer 30, filters disabled | 32×24 | `794b7068522ec1ac1e9996787892268f7033235c8e155f2315101dbe75d9ffa5` |
| `filter-free-lossy-10bpc-yuv422-32x24.avif` | 10-bit, YUV 4:2:2, quantizer 30, filters disabled | 32×24 | `900275cc0e0147a0b6b91aeb1c07ac8b7dd4e17fefa10fc061309c9010b88d73` |
| `filter-free-lossy-10bpc-yuv444-32x24.avif` | 10-bit, YUV 4:4:4, quantizer 30, filters disabled | 32×24 | `b1a0adee85bb4a29b97a3230a133ceea2b80258bb9292b2034c5c40c8e04b928` |
| `filter-free-lossy-12bpc-yuv420-32x24.avif` | 12-bit, YUV 4:2:0, quantizer 30, filters disabled | 32×24 | `4dd09df647b9184436138139b3681f9988af6564b4537e3eb8827af25ee26832` |
| `filter-free-lossy-12bpc-yuv422-32x24.avif` | 12-bit, YUV 4:2:2, quantizer 30, filters disabled | 32×24 | `a2edc55a367d94176e3e3886da161f0f269ec34b5a7958373937115846cb59ad` |
| `filter-free-lossy-12bpc-yuv444-32x24.avif` | 12-bit, YUV 4:4:4, quantizer 30, filters disabled | 32×24 | `6d12bcf52ba68b3411ce5b46d053b7fdadb6c4ac437f16f3f639afb0acdacdbb` |
| `filtered-lossy-10bpc-yuv444-96x64.avif` | 10-bit, YUV 4:4:4, quantizer 45, deblocking, CDEF, and Wiener restoration | 96×64 | `28213f547f44e46289785fd2c19373813dae7cd0777d80ef985642e8cd3c0dbb` |

The filter-free matrix covers all supported chroma sampling modes at both
supported high bit depths. The filtered fixture activates deblocking, CDEF, and
Wiener restoration on all three planes. Self-guided restoration at high bit
depth, filtered lossy YUV 4:2:0 and 4:2:2, and all filtered 12-bit frames remain
outside the supported boundary.

## Memory boundary

High-depth reconstruction and post-filter planes use `Uint16Array`; conversion
to the public 8-bit RGBA contract occurs only after reconstruction and filtering.
The existing 64 MiB aggregate coded-payload and conservatively estimated
working-state limit remains enforced. This capability change does not claim a
new peak-RSS result or remove the documented full-frame fallback used by
filtered paths.
