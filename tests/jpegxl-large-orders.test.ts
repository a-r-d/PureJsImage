import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { learnJpegXlForwardCoefficientOrders } from '../src/codecs/jpegxl-jpeg-encode.ts'
import { decodeDct16OrderFixture } from './helpers/jpegxl-dct16-orders.ts'
import { createLargeOrderGeometry, encodeLargeOrderFixture } from './helpers/jpegxl-large-orders.ts'

describe('JPEG XL square and rectangle coefficient orders', () => {
  it('signals learned orders when the single group uses prefix entropy', async () => {
    const natural = encodeLargeOrderFixture(false, false, 1)
    const learned = encodeLargeOrderFixture(true, false, 1)
    expect(await decodeDct16OrderFixture(learned, 256)).toEqual(
      await decodeDct16OrderFixture(natural, 256),
    )
  })
  it.each([false, true])(
    'preserves every sample with family contexts %s',
    async (familyContexts) => {
      const natural = encodeLargeOrderFixture(false, familyContexts)
      const learned = encodeLargeOrderFixture(true, familyContexts)
      expect(learned.length).toBeLessThan(natural.length)
      expect(await decodeDct16OrderFixture(learned)).toEqual(await decodeDct16OrderFixture(natural))
    },
  )

  it('keeps every LF prefix and learns all three large families together', () => {
    const memory = new JpegXlEncoderMemory(1_048_576)
    try {
      const learning = learnJpegXlForwardCoefficientOrders(createLargeOrderGeometry(memory))
      let next = learning.next()
      while (!next.done) next = learning.next()
      expect(next.value).toHaveLength(15)
      for (const [family, width, height, size] of [
        [2, 2, 2, 256],
        [3, 4, 4, 1024],
        [4, 4, 2, 512],
      ]) {
        if (
          family === undefined ||
          width === undefined ||
          height === undefined ||
          size === undefined
        )
          throw new Error('Missing test family')
        for (let channel = 0; channel < 3; channel++) {
          const order = next.value[family * 3 + channel]
          expect(order?.length).toBe(size)
          expect(new Set(order).size).toBe(size)
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++)
              expect(order?.[y * width + x]).toBe(y * (size === 256 ? 16 : 32) + x)
          expect(order?.[width * height]).toBe(size - 29 - channel * 19)
        }
      }
      for (const order of next.value) memory.release(order)
      expect(memory.liveBytes).toBe(0)
    } finally {
      memory.close()
    }
  })

  it('unwinds earlier allocations if the last family cannot be admitted', () => {
    const memory = new JpegXlEncoderMemory(17_000)
    const learning = learnJpegXlForwardCoefficientOrders(createLargeOrderGeometry(memory))
    expect(() => learning.next()).toThrow()
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
    memory.close()
  })
})
