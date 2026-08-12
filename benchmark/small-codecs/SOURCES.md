# Small codec corpus sources

Normal tests use only the committed files under `tests/fixtures/small-codecs`. They do not use the network. Larger benchmark files use the `small-codec-` prefix under the ignored `benchmark/corpus/files` directory and are prepared by running:

```sh
node --experimental-strip-types benchmark/small-codecs/prepare-benchmark-corpus.ts
```

The preparation script verifies every downloaded input and every derived output with SHA-256. It requires `cc` and FFmpeg. QOI output is written by the official MIT-licensed QOI reference implementation at commit `97bacc86a9c4abf5a2d452102dc26546c4c670b9`. PPM, PFM, and TGA output is written by FFmpeg 7.1.1. These programs are preparation tools only and are not package dependencies.

## Committed conformance fixtures

The Imazen Codec Corpus files below are CC0. The corpus source is <https://github.com/imazen/codec-corpus>, and the license declaration is in its `README.md`.

| File | Original URL and filename | SHA-256 | Dimensions | Tested features | Status |
| --- | --- | --- | --- | --- | --- |
| `checkerboard-8x8-ascii.pbm` | <https://raw.githubusercontent.com/imazen/codec-corpus/main/pnm-conformance/valid/pbm/checkerboard_8x8_ascii.pbm>, `checkerboard_8x8_ascii.pbm` | `bae96bc6e05337925f38bfa63f5f80e76840ed767a5f908a5990896158202e0e` | 8x8 | P1 ASCII PBM | Original |
| `checkerboard-8x8-binary.pbm` | <https://raw.githubusercontent.com/imazen/codec-corpus/main/pnm-conformance/valid/pbm/checkerboard_8x8_binary.pbm>, `checkerboard_8x8_binary.pbm` | `5ab69091dd50b98a39570b97975090b0e6b9402a481c15044a19d23425870a06` | 8x8 | P4 packed PBM | Original |
| `gradient-8x8-8bit.pgm` | <https://raw.githubusercontent.com/imazen/codec-corpus/main/pnm-conformance/valid/pgm/gradient_8x8_255_binary.pgm>, `gradient_8x8_255_binary.pgm` | `f7ba2dcb154f52f8bb4a27eb0fcd08fc7c7f2951e60eb2d412ae97de1bf6604f` | 8x8 | P5, 8-bit samples | Original |
| `gradient-8x8-16bit.pgm` | <https://raw.githubusercontent.com/imazen/codec-corpus/main/pnm-conformance/valid/pgm/gradient_8x8_65535_binary.pgm>, `gradient_8x8_65535_binary.pgm` | `12a7b27c0b35c256d4134a7b555bcd2e841e0f053dfa3c147f4730517be251c6` | 8x8 | P5, 16-bit big-endian samples | Original |
| `colorbars-4x4-ascii.ppm` | <https://raw.githubusercontent.com/imazen/codec-corpus/main/pnm-conformance/valid/ppm/colorbars_4x4_ascii.ppm>, `colorbars_4x4_ascii.ppm` | `4af84174efdf4533d4bd477a43c08c3c0a53732f165216b8770996b7bb2ba877` | 4x4 | P3 ASCII RGB | Original |
| `colorbars-4x4-16bit.ppm` | <https://raw.githubusercontent.com/imazen/codec-corpus/main/pnm-conformance/valid/ppm/colorbars_4x4_16bit_binary.ppm>, `colorbars_4x4_16bit_binary.ppm` | `3b3da865cffd1f8a4dee23a9a5088fd29e95f45eb805cb7069e248e314bae4ba` | 4x4 | P6, 16-bit big-endian RGB | Original |
| `rgb-alpha-4x4.pam` | <https://raw.githubusercontent.com/imazen/codec-corpus/main/pnm-conformance/valid/pam/rgb_alpha_4x4.pam>, `rgb_alpha_4x4.pam` | `be566edc634f5df1d62f73b57b58fdd40295dab1ee9566f8175a27c98d3e3aee` | 4x4 | P7 RGB_ALPHA | Original |
| `grayscale-alpha-4x4.pam` | <https://raw.githubusercontent.com/imazen/codec-corpus/main/pnm-conformance/valid/pam/grayscale_alpha_4x4.pam>, `grayscale_alpha_4x4.pam` | `18d99d91719d71ecc9610d14987b722c4a8e5751fa33e8397b6b71e76a3e3451` | 4x4 | P7 GRAYSCALE_ALPHA | Original |

The three files below are derivatives of sources with redistribution terms that permit the derivative.

| File | Source, license, and original filename | SHA-256 | Dimensions | Tested features | Derivation |
| --- | --- | --- | --- | --- | --- |
| `city-16x16-reference.qoi` | Imazen Codec Corpus GB82, CC0, <https://raw.githubusercontent.com/imazen/codec-corpus/main/gb82/city-lossless.png>, `city-lossless.png` | `aa59095435609cb1f82352f06a99f1188a997f81392e61c3b777010de094d096` | 16x16 | Independently encoded RGB QOI | `ffmpeg -i city-lossless.png -vf crop=16:16:0:0 -f rawvideo -pix_fmt rgb24 city-16x16.rgb`, then official `qoi_write` with 3 channels and sRGB |
| `city-16x16-ffmpeg-rle.tga` | Imazen Codec Corpus GB82, CC0, same URL, `city-lossless.png` | `eba8ba1d22d8aec536b6c1d5f066c21d5a91d9dfe3e305014584913cc92a89a2` | 16x16 | Independently encoded 24-bit RLE truecolor TGA | `ffmpeg -i city-lossless.png -vf crop=16:16:0:0 -c:v targa -rle 1 city-16x16-ffmpeg-rle.tga` |
| `potsdamer-8x4-ffmpeg.pfm` | Poly Haven, CC0, <https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/potsdamer_platz_1k.hdr>, `potsdamer_platz_1k.hdr`, author Greg Zaal | `aa1a52bb1be696a9f62507481cc54898ce599b59b0c3d9c7498b5ee5f08fea70` | 8x4 | Independently encoded little-endian RGB PFM, bottom-to-top rows | `ffmpeg -i potsdamer_platz_1k.hdr -vf crop=8:4:0:0 -frames:v 1 -pix_fmt gbrpf32le -c:v pfm potsdamer-8x4-ffmpeg.pfm` |

Poly Haven's CC0 terms are at <https://polyhaven.com/license>. The Potsdamer Platz asset page is <https://polyhaven.com/a/potsdamer_platz>.

## Downloaded benchmark corpus

The benchmark profile uses the same three 576x576 CC0 GB82 images for QOI, PPM, and TGA so throughput comparisons use identical pixels. QOI uses RGB input. PPM uses binary P6. TGA uses 24-bit RLE truecolor.

| Output | Source SHA-256 | Output SHA-256 | Dimensions |
| --- | --- | --- | --- |
| `small-codec-city.qoi` | `92950cec34adafe5a2d8ca5c247ec04df1a8de508f602ef683c838e1e2804aa7` | `91b15578c0b03a3b75e30bcc42cdb2df4ebddf43d8ff6eb4d4c2df795cd6aaf5` | 576x576 |
| `small-codec-haze.qoi` | `160eb5004cfa03cdf72c726f24f65d747cf67e932ce7b668e03d8d296b4737a2` | `61d28d2c47b5f34bb0637f0d76c9a0769746727602a0756293f3bbd61702c1e7` | 576x576 |
| `small-codec-grass.qoi` | `b49986dad608edadf1b2071359ac6d18de55751864df407b215ea9bb00a92079` | `c4afc70617e9e631c93c129c106bf13c1698123e318736edb9b7bbfb423d64cf` | 576x576 |
| `small-codec-city.ppm` | same source as `small-codec-city.qoi` | `659e8592a4715371efdd32cb2496724fcc4071b909f00fda2d532d18c48870f4` | 576x576 |
| `small-codec-haze.ppm` | same source as `small-codec-haze.qoi` | `8884f171d3844274f0f4122f20833a5a3e8051abb73888e57f94ad74b9944159` | 576x576 |
| `small-codec-grass.ppm` | same source as `small-codec-grass.qoi` | `0c801b31b96901bbf507470c29a4c749b36c693d331c3a927522455eef012219` | 576x576 |
| `small-codec-city.tga` | same source as `small-codec-city.qoi` | `20d8412bdbdc5fc2abcb82dd420d7ae0ebc836ef210062abf6139ce194a0ad2d` | 576x576 |
| `small-codec-haze.tga` | same source as `small-codec-haze.qoi` | `b0c7cbf872dbdcfca677718f976133a7fadb3a37ac1fc3b8d5ee7494c8d4a905` | 576x576 |
| `small-codec-grass.tga` | same source as `small-codec-grass.qoi` | `608b31c561b0e5cc6f201101e6f51ca40673439d5862749278e079afbe700284` | 576x576 |

HDR and PFM benchmarks use two 1024x512 Poly Haven CC0 panoramas. The source Radiance files are also kept as benchmark inputs. PFM is written as little-endian float32 RGB with bottom-to-top rows.

| Asset and author | Source HDR SHA-256 | Derived PFM SHA-256 |
| --- | --- | --- |
| [Potsdamer Platz](https://polyhaven.com/a/potsdamer_platz), Greg Zaal | `7afe4c2f9700ee78c7477c53fa355463d7dda1fdede401432d6b5f9ff0a95696` | `5f7af3f9b2b7e70180d725842b14572e95903f82eb023e14ba74443e694528a5` |
| [Abandoned Greenhouse](https://polyhaven.com/a/abandoned_greenhouse), Andreas Mischok | `d6c3d214ecbb76a1e132bc9b5afe7d1c98fdb5f106ff598077f23bd3e566b466` | `b4251b37e333972f0575be001a8458d79efa7511792a788eb101bab89baa5898` |

## Optional TGA compatibility files

The historical TrueVision files mirrored by image-rs have no established redistribution grant. They are not committed and are not used by CI. For local interoperability checks, run:

```sh
node --experimental-strip-types benchmark/small-codecs/prepare-tga-compatibility.ts
```

The script downloads and verifies `top_left.tga`, `bottom_left.tga`, `b5-cmap.tga`, and `ctc24.tga` into an ignored directory, then checks their decoded geometry and FFmpeg-derived pixel SHA-256 values. Their source is the image-rs TrueVision mirror at <https://github.com/image-rs/image/tree/main/tests/images/tga/testsuite>. The files remain subject to their original, unclear terms.

The USC ICT light-probe archives are not committed or scripted. Their redistribution terms are unclear, and the URLs listed in the original corpus proposal returned HTTP 404 when checked on 2026-08-12.
