# M8 native channel fixtures

The VarDCT JXL fixtures contain procedural pixels generated for this repository.
Pinned libjxl 0.12.0 encoded their VarDCT color and lossless extra channels at
distance 1 and effort 3, with one thread. They contain no external image content.

- `grouped-alpha-depth.jxl`: 512 by 512 RGB, alpha and depth. Every input plane
  uses `(7 * (y * 512 + x) + 3 * y) & 255`. Its input was written with the
  first-party native Modular writer, then independently re-encoded by `cjxl`.
  Both reconstructed extra channels must match every original integer.
- `dc-alpha-shift8.jxl`: 512 by 4096 RGBA, encoded with `--ec_resampling=8`.
  The original alpha is `((x >> 3) + 3 * (y >> 3)) & 255`. Its stored alpha
  plane is 64 by 512 and must equal `(x + 3 * y) & 255`. This exercises the
  extra-channel payload between DC coefficients and VarDCT block metadata.
- `gray.icc`: the gray profile extracted from the CC0 official `grayscale`
  conformance fixture during the M4 qualification. It tests byte preservation
  and the relationship between one gray color plane and separate alpha.

The native decoder binary SHA-256 is
`8da836ae132de221c53532a8296cc5b9e5f4bef16df4fcf4681f8b61ee4f3788`.
Source revision: `a7a9c787341cf703dede03c2009fa460cae5e5df`.

Fixture SHA-256 values:

| File | SHA-256 |
| --- | --- |
| grouped-alpha-depth.jxl | 44360d49c9d689d955dfce341d1d31925b64c354f926c4966a9175d849f037f9 |
| dc-alpha-shift8.jxl | 67c8d5a065410ca0c463d841056d8f56304beff61b0b637af8154895e778156f |
| gray.icc | 3f62598dfd40d6642ca5fd962559bb6615af15448a57a3972a4089c109e62fbd |

`modular-upsampling.jxl` combines factor-two color reconstruction with a
shifted alpha plane whose actual reconstruction factor is eight. The analytic
32x32 color planes contain 128; the 8x8 alpha plane contains `4 * index`.
`invalid-combined-shift16.jxl` signals a combined extra-channel factor of 16.
Both the pinned native decoder and the first-party parser reject it as invalid:
JPEG XL limits the combined extra upsampling and dimension shift to eight.
Regenerate these two fixtures with
`node benchmark/jpegxl/generate-m8-shifts.ts`.
