/**
 * Source: libjxl lib/jxl/enc_gaborish.cc, v0.12.0,
 * a7a9c787341cf703dede03c2009fa460cae5e5df.
 * Copyright (c) the JPEG XL Project Authors. BSD-3-Clause
 * Ported: five-by-five inverse Gaborish weights and normalization, with unit
 * channel strength used by enc_heuristics.cc at the same revision.
 * Changes: first-party scalar convolution of a bounded 12x12 block halo,
 * clamped borders, existing XYB input and memory ledger, plus optional bounded
 * source-block caching and unrolled taps in the original summation order. No SIMD or threading.
 */
import { gaborishSourceCache } from './gaborish-source-cache.ts'
import type { JpegXlDevelopmentTransformContext } from '../../../src/codecs/jpegxl-development-decisions.ts'
import type { VarDctCoefficientGeometry } from '../../../src/codecs/jpegxl-jpeg-encode.ts'

const adjacent = -0.09495815671340026,
  diagonal = -0.041031725066768575
const farAxis = 0.013710004822696948,
  mixed = 0.006510206083837737,
  farDiagonal = -0.0014789063378272242
const norm = 1 / (1 + 4 * (adjacent + diagonal + farAxis + farDiagonal + 2 * mixed))

export function libjxlGaborishContext(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
  width: number,
  height: number,
  cacheSource = false,
): JpegXlDevelopmentTransformContext & { release(): void } {
  const memory = base.memory
  if (!memory) throw new Error('Missing Gaborish memory ledger')
  const cachedSource = cacheSource ? gaborishSourceCache(base, context) : undefined
  const sourceContext = cachedSource ?? context
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
      cachedSource?.release()
    },
    readBlock: (bx, by, correlated) => {
      if (bx === cachedX && by === cachedY) {
        if (correlated) sourceContext.readBlock(bx, by, true)
        return output
      }
      for (let sy = Math.max(0, by - 1); sy <= Math.min(base.blocksHigh - 1, by + 1); sy++)
        for (let sx = Math.max(0, bx - 1); sx <= Math.min(base.blocksWide - 1, bx + 1); sx++) {
          const block = sourceContext.readBlock(sx, sy, false)
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
            const at = y * 12 + x
            sum += farDiagonal * (source[at + 0] ?? 0)
            sum += mixed * (source[at + 1] ?? 0)
            sum += farAxis * (source[at + 2] ?? 0)
            sum += mixed * (source[at + 3] ?? 0)
            sum += farDiagonal * (source[at + 4] ?? 0)
            sum += mixed * (source[at + 12] ?? 0)
            sum += diagonal * (source[at + 13] ?? 0)
            sum += adjacent * (source[at + 14] ?? 0)
            sum += diagonal * (source[at + 15] ?? 0)
            sum += mixed * (source[at + 16] ?? 0)
            sum += farAxis * (source[at + 24] ?? 0)
            sum += adjacent * (source[at + 25] ?? 0)
            sum += 1 * (source[at + 26] ?? 0)
            sum += adjacent * (source[at + 27] ?? 0)
            sum += farAxis * (source[at + 28] ?? 0)
            sum += mixed * (source[at + 36] ?? 0)
            sum += diagonal * (source[at + 37] ?? 0)
            sum += adjacent * (source[at + 38] ?? 0)
            sum += diagonal * (source[at + 39] ?? 0)
            sum += mixed * (source[at + 40] ?? 0)
            sum += farDiagonal * (source[at + 48] ?? 0)
            sum += mixed * (source[at + 49] ?? 0)
            sum += farAxis * (source[at + 50] ?? 0)
            sum += mixed * (source[at + 51] ?? 0)
            sum += farDiagonal * (source[at + 52] ?? 0)
            target[y * 8 + x] = sum * norm
          }
      }
      // Preserve the encoder's activity state for its rate-aware quantizer.
      if (correlated) sourceContext.readBlock(bx, by, true)
      cachedX = bx
      cachedY = by
      return output
    },
  }
}
