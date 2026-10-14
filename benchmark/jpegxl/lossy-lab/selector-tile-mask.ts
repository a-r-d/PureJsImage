/**
 * Source: libjxl lib/jxl/enc_adaptive_quantization.cc, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Changes: the separately ported Laplacian and Blur1x1Masking formula computed
 * on one 64x64 selector tile with a three-pixel halo. Clamped padded borders,
 * Float32 intermediate storage and accumulation order match the full-plane port.
 * Scratch is bounded independently of image dimensions. Development only.
 */
import type { JpegXlDevelopmentTransformContext } from '../../../src/codecs/jpegxl-development-decisions.ts'
import type { VarDctCoefficientGeometry } from '../../../src/codecs/jpegxl-jpeg-encode.ts'

export function selectorTileMask(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
) {
  const memory = base.memory
  if (!memory) throw new Error('Missing tile mask memory')
  const width = base.blocksWide * 8,
    height = base.blocksHigh * 8
  const luma = memory.allocate(Float32Array, 70 * 70)
  const raw = memory.allocate(Float32Array, 68 * 68)
  const data = memory.allocate(Float32Array, 64 * 64)
  const numeratorMul = ((18.6580932135 * Math.LN2) / 73.377132366608819) * 3 * 226.77216153508914
  const denominatorMul = Math.LN2 * 226.77216153508914
  const offset = 7.7825991679894591 * Math.LN2 + 0.01
  const adjacent = 0.364911248,
    diagonal = 0.05,
    farAxis = 0.1688888021,
    mixed = 0.221069183,
    farDiagonal = 0.306563504
  const normalization = 1 / (1 + 4 * (adjacent + diagonal + farAxis + farDiagonal + 2 * mixed))
  const kernel = Float64Array.of(
    1,
    adjacent,
    farAxis,
    adjacent,
    diagonal,
    mixed,
    farAxis,
    mixed,
    farDiagonal,
  )
  return {
    data,
    fill(blockX: number, blockY: number): void {
      const originX = blockX * 8,
        originY = blockY * 8
      // Copy each intersecting block once. readBlock returns reusable scratch.
      for (let by = Math.floor((originY - 3) / 8); by <= Math.floor((originY + 66) / 8); by++)
        for (let bx = Math.floor((originX - 3) / 8); bx <= Math.floor((originX + 66) / 8); bx++) {
          const source = context.readBlock(
            Math.max(0, Math.min(base.blocksWide - 1, bx)),
            Math.max(0, Math.min(base.blocksHigh - 1, by)),
            false,
          )[1]
          if (!source) throw new Error('Missing tile mask luminance')
          for (let y = Math.max(originY - 3, by * 8); y < Math.min(originY + 67, by * 8 + 8); y++)
            for (let x = Math.max(originX - 3, bx * 8); x < Math.min(originX + 67, bx * 8 + 8); x++)
              luma[(y - originY + 3) * 70 + x - originX + 3] =
                source[
                  (Math.max(0, Math.min(height - 1, y)) % 8) * 8 +
                    (Math.max(0, Math.min(width - 1, x)) % 8)
                ] ?? 0
        }
      for (let y = 0; y < 68; y++)
        for (let x = 0; x < 68; x++) {
          // Clamp the Laplacian center before reading its neighbors. Clamping
          // raw-mask coordinates is not the same as differentiating padding.
          const px = Math.max(0, Math.min(width - 1, originX + x - 2)) - originX + 3
          const py = Math.max(0, Math.min(height - 1, originY + y - 2)) - originY + 3
          const at = py * 70 + px,
            value = luma[at] ?? 0
          const average =
            0.25 *
            ((luma[at - 70] ?? 0) +
              (luma[at + 70] ?? 0) +
              (luma[at - 1] ?? 0) +
              (luma[at + 1] ?? 0))
          const v = Math.max(0, value + 0.019)
          const gamma = (denominatorMul * v * v * v + offset) / (numeratorMul * v * v + 0.01)
          raw[y * 68 + x] = 1 / (Math.log1p(Math.abs(gamma * (value - average))) + 0.01)
        }
      for (let y = 0; y < Math.min(64, height - originY); y++)
        for (let x = 0; x < Math.min(64, width - originX); x++) {
          let sum = 0
          for (let dy = -2; dy <= 2; dy++)
            for (let dx = -2; dx <= 2; dx++)
              sum +=
                (kernel[Math.abs(dy) * 3 + Math.abs(dx)] ?? 0) *
                (raw[(y + dy + 2) * 68 + x + dx + 2] ?? 0)
          data[y * 64 + x] = sum * normalization
        }
    },
    release(): void {
      memory.release(luma)
      memory.release(raw)
      memory.release(data)
    },
  }
}
