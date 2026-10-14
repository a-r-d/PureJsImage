import { expect, it } from 'vitest'
import { libjxlStrategyMask } from '../benchmark/jpegxl/lossy-lab/libjxl-strategy-mask.ts'
import { selectorTileMask } from '../benchmark/jpegxl/lossy-lab/selector-tile-mask.ts'
import { encodeTransplant } from '../benchmark/jpegxl/lossy-lab/transplant.ts'

it.each([
  [1, 1],
  [73, 29],
  [137, 75],
])('preserves the full-plane mask at %sx%s including all borders', async (width, height) => {
  const pixels = Uint8Array.from({ length: width * height * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : (i * 17 + Math.floor(i / width) * 31) % 256,
  )
  await encodeTransplant(pixels, width, height, 2, {
    rewriteGeometry: (base, context) => {
      const full = libjxlStrategyMask(base, context)
      const before = base.memory?.liveBytes ?? 0
      const tile = selectorTileMask(base, context)
      expect((base.memory?.liveBytes ?? 0) - before).toBeLessThan(56_000)
      for (let by = 0; by < base.blocksHigh; by += 8)
        for (let bx = 0; bx < base.blocksWide; bx += 8) {
          tile.fill(bx, by)
          for (let y = 0; y < Math.min(64, (base.blocksHigh - by) * 8); y++)
            for (let x = 0; x < Math.min(64, (base.blocksWide - bx) * 8); x++)
              expect(tile.data[y * 64 + x]).toBe(
                full[(by * 8 + y) * base.blocksWide * 8 + bx * 8 + x],
              )
        }
      tile.release()
      expect(base.memory?.liveBytes).toBe(before)
      base.memory?.release(full)
      return base
    },
  })
})
