import type { JpegXlDevelopmentTransformContext } from '../../../src/codecs/jpegxl-development-decisions.ts'
import type { VarDctCoefficientGeometry } from '../../../src/codecs/jpegxl-jpeg-encode.ts'

/** One 64x64 color tile, independent of image area. Only uncorrelated reads cache. */
export function selectorBlockCache(
  base: VarDctCoefficientGeometry,
  context: JpegXlDevelopmentTransformContext,
): JpegXlDevelopmentTransformContext & { release(): void } {
  const memory = base.memory
  if (!memory) throw new Error('Missing selector cache memory ledger')
  const storage = memory.allocate(Float32Array, 64 * 64 * 3)
  const present = memory.allocate(Uint8Array, 64)
  const blocks = Array.from({ length: 64 }, (_, i) => [
    storage.subarray(i * 192, i * 192 + 64),
    storage.subarray(i * 192 + 64, i * 192 + 128),
    storage.subarray(i * 192 + 128, i * 192 + 192),
  ])
  let tileX = -1,
    tileY = -1
  return {
    quantize: context.quantize,
    release: () => {
      memory.release(storage)
      memory.release(present)
    },
    readBlock: (x, y, correlated) => {
      if (correlated) return context.readBlock(x, y, true)
      const tx = Math.floor(x / 8),
        ty = Math.floor(y / 8)
      if (tx !== tileX || ty !== tileY) {
        present.fill(0)
        tileX = tx
        tileY = ty
      }
      const index = (y % 8) * 8 + (x % 8)
      const target = blocks[index]
      if (!target) throw new Error('Invalid selector cache block')
      if (!present[index]) {
        const source = context.readBlock(x, y, false)
        for (let c = 0; c < 3; c++) {
          const from = source[c],
            to = target[c]
          if (!from || !to) throw new Error('Missing selector cache plane')
          to.set(from)
        }
        present[index] = 1
      }
      return target
    },
  }
}
