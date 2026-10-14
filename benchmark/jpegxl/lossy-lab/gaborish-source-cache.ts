import type { JpegXlDevelopmentTransformContext } from '../../../src/codecs/jpegxl-development-decisions.ts'
import type { VarDctCoefficientGeometry } from '../../../src/codecs/jpegxl-jpeg-encode.ts'

/** First-party bounded cache for overlapping source blocks in inverse Gaborish. */
export function gaborishSourceCache(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
): JpegXlDevelopmentTransformContext & { release(): void } {
  const memory = base.memory
  if (!memory) throw new Error('Missing source cache memory ledger')
  // Three neighboring rows and ten columns cover a 64-pixel tile plus its halo.
  const storage = memory.allocate(Float32Array, 30 * 192)
  const xs = memory.allocate(Int32Array, 30)
  const ys = memory.allocate(Int32Array, 30)
  xs.fill(-1)
  ys.fill(-1)
  const blocks = Array.from({ length: 30 }, (_, i) => [
    storage.subarray(i * 192, i * 192 + 64),
    storage.subarray(i * 192 + 64, i * 192 + 128),
    storage.subarray(i * 192 + 128, i * 192 + 192),
  ])
  return {
    quantize: context.quantize,
    release(): void {
      memory.release(storage)
      memory.release(xs)
      memory.release(ys)
    },
    readBlock(x, y, correlated) {
      // Correlated reads also update the encoder's activity-dependent quantizer.
      if (correlated) return context.readBlock(x, y, true)
      const index = (y % 3) * 10 + (x % 10)
      const target = blocks[index]
      if (!target) throw new Error('Invalid source cache block')
      if (xs[index] !== x || ys[index] !== y) {
        const source = context.readBlock(x, y, false)
        for (let c = 0; c < 3; c++) {
          const from = source[c],
            to = target[c]
          if (!from || !to) throw new Error('Missing source cache plane')
          to.set(from)
        }
        xs[index] = x
        ys[index] = y
      }
      return target
    },
  }
}
