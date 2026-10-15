import { expect, it } from 'vitest'
import { selectorMaskLoss } from '../benchmark/jpegxl/lossy-lab/selector-mask-loss.ts'

it('preserves spatial loss exactly across tile edges, transform shapes and channels', () => {
  const spatial = Float32Array.from({ length: 4096 }, (_, p) => Math.sin(p * 1.37) / 1024)
  const mask = Float32Array.from({ length: 4096 }, (_, p) => 1 + Math.cos(p * 0.13) * 0.99)
  for (const width of [8, 16, 32, 64])
    for (const height of [8, 16, 32, 64])
      for (const [x, y] of [
        [0, 0],
        [64 - width, 64 - height],
      ])
        for (const [offset, weight] of [
          [0, 1],
          [12, 8.2],
          [4, 1.03],
        ]) {
          if (x === undefined || y === undefined || offset === undefined || weight === undefined)
            throw new Error('Missing test case')
          let expected = 0
          for (let p = 0; p < width * height; p++) {
            let error =
              (spatial[p] ?? 0) *
              ((mask[(y + Math.floor(p / width)) * 64 + x + (p % width)] ?? 1) + offset) *
              weight
            error *= error
            error *= error
            error *= error
            expected += error
          }
          expect(selectorMaskLoss(spatial, mask, width, height, y * 64 + x, offset, weight)).toBe(
            expected,
          )
        }
})
