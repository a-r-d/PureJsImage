import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { learnJpegXlForwardCoefficientOrders } from '../src/codecs/jpegxl-jpeg-encode.ts'
import {
  createDct16OrderGeometry,
  decodeDct16OrderFixture,
  encodeDct16OrderFixture,
} from './helpers/jpegxl-dct16-orders.ts'

describe('JPEG XL DCT16 coefficient orders', () => {
  it('reduces complete files while preserving every decoded sample', async () => {
    const natural = encodeDct16OrderFixture(false)
    const learned = encodeDct16OrderFixture(true)
    expect(learned.length).toBeLessThan(natural.length)
    expect(await decodeDct16OrderFixture(learned)).toEqual(await decodeDct16OrderFixture(natural))
  })

  it('preserves the four LF positions and learns both progressive passes', () => {
    const memory = new JpegXlEncoderMemory(16_777_216)
    const geometry = createDct16OrderGeometry(memory)
    const passes: number[] = []
    const learning = learnJpegXlForwardCoefficientOrders({
      ...geometry,
      progressive: true,
      loadAc: (group, pass) => {
        passes.push(pass)
        return geometry.loadAc?.(group, pass) ?? []
      },
    })
    const orders = memory.run(() => {
      let result = learning.next()
      while (!result.done) result = learning.next()
      return result.value
    })
    expect(passes).toEqual([0, 1, 0, 1])
    expect(orders).toHaveLength(9)
    for (let channel = 0; channel < 3; channel++) {
      const order = orders[6 + channel]
      expect(order?.subarray(0, 4)).toEqual(Uint32Array.of(0, 1, 16, 17))
      expect(order?.[4]).toBe(227 - channel * 19)
      expect(new Set(order).size).toBe(256)
      if (order) memory.release(order)
    }
    for (const order of orders.slice(0, 6)) memory.release(order)
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
    memory.close()
  })

  it('releases counters when interrupted after visiting a group', () => {
    const memory = new JpegXlEncoderMemory(16_777_216)
    const learning = learnJpegXlForwardCoefficientOrders(createDct16OrderGeometry(memory))
    expect(learning.next().done).toBe(false)
    expect(memory.liveBytes).toBeGreaterThan(0)
    learning.return([])
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
    memory.close()
  })

  it('releases earlier scratch when the additional counters exceed the working budget', () => {
    const memory = new JpegXlEncoderMemory(2_048)
    const learning = learnJpegXlForwardCoefficientOrders(createDct16OrderGeometry(memory))
    expect(() => learning.next()).toThrow()
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
    memory.close()
  })
})
