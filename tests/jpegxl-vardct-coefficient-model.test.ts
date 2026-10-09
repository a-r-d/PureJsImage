import { describe, expect, it } from 'vitest'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import {
  createCoherentCoefficientModel,
  createNaturalLargeOrder,
} from '../src/codecs/jpegxl-vardct-coefficient-model.ts'

const order = Uint32Array.from({ length: 64 }, (_, i) => i)
function one(value: number, scan = 1): Int16Array {
  const coefficients = new Int16Array(64)
  coefficients[scan] = value
  return coefficients
}

describe('JPEG XL frozen coefficient support model', () => {
  it('prices emitted zeros through the last nonzero, excludes the unused tail and exposes additive costs', () => {
    const memory = new JpegXlEncoderMemory(1_000_000),
      model = createCoherentCoefficientModel(memory),
      scratch = new Float64Array(6)
    model.learn(one(-1), order, 1, 0, 0, scratch)
    model.freeze()
    model.estimateInto(new Int16Array(64), order, 1, 0, 0, scratch)
    expect([...scratch]).toEqual([0, 0, 0, 0, 0, 0])
    model.estimateInto(one(-1, 60), order, 1, 0, 0, scratch)
    expect(scratch[4]).toBe(60)
    expect(scratch[5]).toBe(1)
    expect(scratch[0]).toBe((scratch[1] ?? 0) + (scratch[2] ?? 0) + (scratch[3] ?? 0))
    expect([...scratch].every(Number.isFinite)).toBe(true)
    const lateCost = scratch[0] ?? 0
    model.estimateInto(one(-1), order, 1, 0, 0, scratch)
    expect(scratch[4]).toBe(1)
    expect(scratch[0]).toBeLessThan(lateCost)
    model.release()
    expect(memory.liveBytes).toBe(0)
  })

  it('learns signed nonzero symbols and retains finite backoff for unobserved channels', () => {
    const memory = new JpegXlEncoderMemory(1_000_000),
      model = createCoherentCoefficientModel(memory),
      scratch = new Float64Array(6)
    for (let i = 0; i < 100; i++) model.learn(one(-1), order, 1, 0, 0, scratch)
    model.learn(one(1), order, 1, 0, 0, scratch)
    model.freeze()
    model.estimateInto(one(-1), order, 1, 0, 0, scratch)
    const frequent = scratch[0] ?? 0
    model.estimateInto(one(1), order, 1, 0, 0, scratch)
    expect(scratch[0]).toBeGreaterThan(frequent)
    for (const channel of [1, 2]) {
      model.estimateInto(one(-4095), order, 1, channel, 0, scratch)
      expect([...scratch].every(Number.isFinite)).toBe(true)
      expect(scratch[0]).toBeGreaterThan(0)
      expect(scratch[3]).toBeGreaterThan(0)
    }
    model.release()
    expect(memory.liveAllocations).toBe(0)
  })

  it('freezes training, rejects invalid lifecycle and coefficient extents, and releases idempotently', () => {
    const memory = new JpegXlEncoderMemory(1_000_000),
      model = createCoherentCoefficientModel(memory),
      scratch = new Float64Array(6)
    expect(() => model.estimateInto(one(1), order, 1, 0, 0, scratch)).toThrow()
    model.freeze()
    expect(() => model.freeze()).toThrow()
    expect(() => model.learn(one(1), order, 1, 0, 0, scratch)).toThrow()
    for (const area of [0, 2, 3, 5])
      expect(() => model.estimateInto(one(1), order, area, 0, 0, scratch)).toThrow()
    expect(() => model.estimateInto(one(1), order, 1, 3, 0, scratch)).toThrow()
    expect(() => model.estimateInto(one(1), order, 1, 0, 1, scratch)).toThrow()
    const invalid = Uint32Array.from(order)
    invalid[63] = 64
    expect(() => model.estimateInto(one(1), invalid, 1, 0, 0, scratch)).toThrow()
    model.release()
    model.release()
    expect(() => model.estimateInto(one(1), order, 1, 0, 0, scratch)).toThrow()
    expect(memory.liveBytes).toBe(0)
  })

  it('unwinds every partially admitted model allocation on LIMIT', () => {
    for (const limit of [1, 10_992, 186_864, 187_272, 560_999]) {
      const memory = new JpegXlEncoderMemory(limit)
      expect(() => createCoherentCoefficientModel(memory)).toThrow()
      expect(memory.liveBytes).toBe(0)
      expect(memory.liveAllocations).toBe(0)
      memory.close()
    }
  })

  it('provides complete canonical rectangular/square orders with compact LF first', () => {
    const memory = new JpegXlEncoderMemory(1_000_000)
    for (const rows of [2, 4] as const) {
      const natural = createNaturalLargeOrder(memory, rows),
        skip = rows * 4
      expect(natural.length).toBe(rows * 256)
      expect(new Set(natural).size).toBe(natural.length)
      expect([...natural].every((value) => value < natural.length)).toBe(true)
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < 4; x++) expect(natural[y * 4 + x]).toBe(y * 32 + x)
      expect(natural.subarray(skip).some((value) => value === 0)).toBe(false)
      memory.release(natural)
    }
    expect(memory.liveBytes).toBe(0)
  })
})
