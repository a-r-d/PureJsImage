import { describe, expect, it } from 'vitest'
import {
  roundTripFastLossless,
  verifyFastLosslessChannels,
  verifyRepeatedLosslessColors,
} from './helpers/jpegxl-fast-lossless.ts'

describe('JPEG XL effort-1 channel models', () => {
  it.each([8, 16] as const)(
    'compresses repeated %i-bit colors without changing transparent RGB or caller bytes',
    async (depth) => {
      const result = await verifyRepeatedLosslessColors(depth)
      expect(result.samples).toBe(513 * 65 * 4 * (depth / 8))
      expect(result.bytes).toBe(depth === 8 ? 474 : 559)
      expect(result.checksum).toBe(depth === 8 ? 1679616053 : 3138963500)
      expect(result.inputChecksum).toBe(depth === 8 ? 794717347 : 4090140113)
    },
  )
  it.each([8, 16] as const)(
    'recovers the original %i-bit stream when the optional residual cache exceeds the working budget',
    async (depth) => {
      const budget = depth === 8 ? 2305794 : 2476162
      const result = await verifyRepeatedLosslessColors(depth, budget)
      expect(result.bytes).toBe(depth === 8 ? 19594 : 36492)
      expect(result.checksum).toBe(depth === 8 ? 1286743640 : 2550400864)
      expect(result.ownedPeak).toBeLessThanOrEqual(budget)
      expect(result.inputChecksum).toBe(depth === 8 ? 794717347 : 4090140113)
    },
  )
  it.each([8, 16] as const)(
    'keeps %i-bit RGB exact under constant opaque and transparent alpha',
    async (depth) => {
      const result = await verifyFastLosslessChannels(depth)
      expect(result.alphaResults).toHaveLength(3)
      expect(result.reference.samples).toBe(1025 * 41 * 3 * (depth / 8))
    },
  )
  it.each(['gray8', 'gray16'] as const)(
    'stores a nonzero %s constant across vertical groups',
    async (format) => {
      const width = 3,
        height = 1025,
        sampleBytes = format === 'gray16' ? 2 : 1
      const pixels = new Uint8Array(width * height * sampleBytes)
      for (let offset = 0; offset < pixels.length; offset += sampleBytes) {
        if (sampleBytes === 2) pixels[offset] = 0x91
        pixels[offset + sampleBytes - 1] = 0xb3
      }
      const result = await roundTripFastLossless(width, height, format, pixels)
      expect(result.bytes).toBeLessThan(256)
    },
  )
  it('keeps unrelated channel noise exact across the DC group boundary', async () => {
    const width = 8193,
      height = 3
    const pixels = new Uint8Array(width * height * 4)
    let state = 0x51d403e7
    for (let position = 0; position < pixels.length; position++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      pixels[position] = state >>> 24
    }
    const result = await roundTripFastLossless(width, height, 'rgba8', pixels)
    expect(result.samples).toBe(pixels.length)
  })
})
