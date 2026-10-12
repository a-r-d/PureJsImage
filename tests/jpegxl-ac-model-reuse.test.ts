import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { encodeJpegXlVarDct8Async } from '../src/codecs/jpegxl-vardct-encode.ts'
import {
  estimateJpegXlForwardAcModel,
  estimateJpegXlForwardOrderBits,
} from '../src/codecs/jpegxl-jpeg-encode.ts'
import { createDct16OrderGeometry } from './helpers/jpegxl-dct16-orders.ts'
import { verifyAcModelReuse } from './helpers/jpegxl-ac-model-reuse.ts'

describe('JPEG XL ordinary AC model reuse', () => {
  it.each([false, true])(
    'retains only owned model buffers across a scope, progressive %s',
    (progressive) => {
      const memory = new JpegXlEncoderMemory(16_777_216)
      const geometry = { ...createDct16OrderGeometry(memory), progressive }
      const model = memory.run(() => {
        const estimation = estimateJpegXlForwardAcModel(geometry)
        let next = estimation.next()
        while (!next.done) next = estimation.next()
        return next.value
      })
      expect(memory.liveBytes).toBe(
        model.contextMap.byteLength +
          model.frequencies.reduce((sum, counts) => sum + counts.byteLength, 0),
      )
      const numeric = estimateJpegXlForwardOrderBits(geometry)
      let next = numeric.next()
      while (!next.done) next = numeric.next()
      expect(next.value).toBe(model.bits)
      expect(model.acBits).toBeGreaterThan(0)
      expect(model.acBits).toBeLessThan(model.bits)
      memory.release(model.contextMap)
      for (const counts of model.frequencies) memory.release(counts)
      expect(memory.liveBytes).toBe(0)
      expect(memory.liveAllocations).toBe(0)
      memory.close()
    },
  )

  it('releases partially collected frequencies on cancellation', () => {
    const memory = new JpegXlEncoderMemory(16_777_216)
    const estimation = estimateJpegXlForwardAcModel(createDct16OrderGeometry(memory))
    expect(estimation.next().done).toBe(false)
    estimation.return({ bits: 0, acBits: 0, contextMap: new Uint8Array(0), frequencies: [] })
    expect(memory.liveBytes).toBe(0)
    expect(memory.liveAllocations).toBe(0)
    memory.close()
  })

  it('unwinds partial collection and model allocation on LIMIT', () => {
    for (const limit of [1, 2048, 3_041_280]) {
      const memory = new JpegXlEncoderMemory(limit)
      const estimation = estimateJpegXlForwardAcModel(createDct16OrderGeometry(memory))
      expect(() => {
        let next = estimation.next()
        while (!next.done) next = estimation.next()
      }).toThrowError(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }))
      expect(memory.liveBytes).toBe(0)
      expect(memory.liveAllocations).toBe(0)
      memory.close()
    }
  })

  it('releases the selected model on late cooperative cancellation', async () => {
    const width = 513,
      height = 129
    const pixels = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        for (let channel = 0; channel < 3; channel++)
          pixels[(y * width + x) * 3 + channel] = Math.round(
            120 +
              50 * Math.sin((x + channel * 5) / 13) +
              40 * Math.cos((y + channel * 3) / 9) +
              ((x * 3 + y * 7 + channel * 13) % 23),
          )
    const before = pixels.slice()
    const completed = new JpegXlEncoderMemory(32_000_000)
    let checkpoints = 0
    const parts = await encodeJpegXlVarDct8Async(
      pixels,
      width,
      height,
      3,
      completed,
      async () => {
        checkpoints++
      },
      3,
      7,
    )
    expect(completed.liveBytes).toBe(parts.reduce((sum, part) => sum + part.byteLength, 0))
    completed.close()
    const cancelled = new JpegXlEncoderMemory(32_000_000)
    let steps = 0
    const reason = new Error('cancel retained ordinary model')
    await expect(
      encodeJpegXlVarDct8Async(
        pixels,
        width,
        height,
        3,
        cancelled,
        async () => {
          if (++steps === checkpoints - 3) throw reason
        },
        3,
        7,
      ),
    ).rejects.toBe(reason)
    expect(cancelled.liveBytes).toBe(0)
    expect(cancelled.liveAllocations).toBe(0)
    expect(pixels).toEqual(before)
    cancelled.close()
  }, 120_000)

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    'preserves every sample with family contexts %s, progressive %s',
    async (family, progressive) => {
      const result = await verifyAcModelReuse(family, progressive)
      expect(result.samples).toBe(512 * 128 * 3)
    },
  )
})
