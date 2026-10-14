import { expect, it } from 'vitest'
import { gaborishSourceCache } from '../benchmark/jpegxl/lossy-lab/gaborish-source-cache.ts'
import { encodeTransplant } from '../benchmark/jpegxl/lossy-lab/transplant.ts'

it('caches raw halo blocks across collisions while preserving correlated read side effects', async () => {
  const width = 137,
    height = 75
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (Math.floor(i / 4) * 73 + (i % 4) * 47) % 256,
  )
  await encodeTransplant(pixels, width, height, 2, {
    rewriteGeometry(base, context) {
      let reads = 0,
        correlatedReads = 0
      const cached = gaborishSourceCache(base, {
        quantize: context.quantize,
        readBlock(x, y, correlated) {
          reads++
          if (correlated) correlatedReads++
          return context.readBlock(x, y, correlated)
        },
      })
      try {
        for (const [x, y] of [
          [0, 0],
          [1, 1],
          [10, 3],
          [17, 9],
          [0, 0],
        ] as const) {
          const expected = context.readBlock(x, y, false).map((plane) => plane.slice())
          const before = reads
          expect(cached.readBlock(x, y, false)).toEqual(expected)
          expect(cached.readBlock(x, y, false)).toEqual(expected)
          expect(reads - before).toBe(1)
          cached.readBlock(x, y, true)
          expect(cached.readBlock(x, y, false)).toEqual(expected)
          expect(reads - before).toBe(2)
        }
        expect(correlatedReads).toBe(5)
      } finally {
        cached.release()
      }
      return base
    },
  })
})
