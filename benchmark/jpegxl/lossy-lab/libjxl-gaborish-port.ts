/**
 * Source: libjxl lib/jxl/enc_gaborish.cc, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Ported: five-by-five inverse Gaborish weights and normalization, with unit
 * channel strength used by enc_heuristics.cc at the same revision.
 * Changes: first-party scalar convolution of a bounded 12x12 block halo,
 * clamped borders, existing XYB input and memory ledger. No SIMD or threading.
 */
import type { JpegXlDevelopmentTransformContext } from '../../../src/codecs/jpegxl-development-decisions.ts'
import type { VarDctCoefficientGeometry } from '../../../src/codecs/jpegxl-jpeg-encode.ts'

const adjacent = -0.09495815671340026,
  diagonal = -0.041031725066768575
const farAxis = 0.013710004822696948,
  mixed = 0.006510206083837737,
  farDiagonal = -0.0014789063378272242
const norm = 1 / (1 + 4 * (adjacent + diagonal + farAxis + farDiagonal + 2 * mixed))
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

export function libjxlGaborishContext(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
  width: number,
  height: number,
): JpegXlDevelopmentTransformContext & { release(): void } {
  const memory = base.memory
  if (!memory) throw new Error('Missing Gaborish memory ledger')
  const halo = [
    memory.allocate(Float32Array, 144),
    memory.allocate(Float32Array, 144),
    memory.allocate(Float32Array, 144),
  ]
  const output = [
    memory.allocate(Float32Array, 64),
    memory.allocate(Float32Array, 64),
    memory.allocate(Float32Array, 64),
  ]
  let cachedX = -1,
    cachedY = -1
  return {
    quantize: context.quantize,
    release: () => {
      for (const buffer of [...halo, ...output]) memory.release(buffer)
    },
    readBlock: (bx, by, correlated) => {
      if (bx === cachedX && by === cachedY) {
        if (correlated) context.readBlock(bx, by, true)
        return output
      }
      for (let sy = Math.max(0, by - 1); sy <= Math.min(base.blocksHigh - 1, by + 1); sy++)
        for (let sx = Math.max(0, bx - 1); sx <= Math.min(base.blocksWide - 1, bx + 1); sx++) {
          const block = context.readBlock(sx, sy, false)
          for (let y = 0; y < 12; y++) {
            const iy = Math.max(0, Math.min(height - 1, by * 8 + y - 2))
            if (Math.floor(iy / 8) !== sy) continue
            for (let x = 0; x < 12; x++) {
              const ix = Math.max(0, Math.min(width - 1, bx * 8 + x - 2))
              if (Math.floor(ix / 8) !== sx) continue
              for (let c = 0; c < 3; c++) {
                const target = halo[c],
                  source = block[c]
                if (!target || !source) throw new Error('Missing Gaborish source plane')
                target[y * 12 + x] = source[(iy % 8) * 8 + (ix % 8)] ?? 0
              }
            }
          }
        }
      for (let c = 0; c < 3; c++) {
        const source = halo[c],
          target = output[c]
        if (!source || !target) throw new Error('Missing Gaborish output plane')
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            let sum = 0
            for (let dy = -2; dy <= 2; dy++)
              for (let dx = -2; dx <= 2; dx++)
                sum +=
                  (kernel[Math.abs(dy) * 3 + Math.abs(dx)] ?? 0) *
                  (source[(y + 2 + dy) * 12 + x + 2 + dx] ?? 0)
            target[y * 8 + x] = sum * norm
          }
      }
      // Preserve the encoder's activity state for its rate-aware quantizer.
      if (correlated) context.readBlock(bx, by, true)
      cachedX = bx
      cachedY = by
      return output
    },
  }
}
