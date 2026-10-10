import { expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import {
  encodeJpegXlVarDct8,
  encodeJpegXlVarDct8Async,
} from '../src/codecs/jpegxl-vardct-encode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import { jpegXlDcModelPixels, verifyJpegXlDcModel } from './helpers/jpegxl-dc-model.ts'

const width = 129,
  height = 65,
  budget = 67_108_864
async function decode(encoded: Uint8Array, original: Uint8Array): Promise<Uint8Array> {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
  if (decoder?.pixelFormat !== 'rgba8' || decoder.width !== width || decoder.height !== height)
    throw new Error('Missing complete RGBA decoder')
  const result = new Uint8Array(original.length),
    visited = new Uint8Array(width * height)
  for await (const block of decoder.decode()) {
    try {
      if (
        block.format !== 'rgba8' ||
        block.x < 0 ||
        block.y < 0 ||
        block.x + block.width > width ||
        block.y + block.height > height ||
        block.stride < block.width * 4 ||
        block.data.length < (block.height - 1) * block.stride + block.width * 4
      )
        throw new Error('Invalid decoded block')
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < block.width; x++) {
          const pixel = (block.y + y) * width + block.x + x,
            source = y * block.stride + x * 4
          if (visited[pixel] !== 0) throw new Error('Duplicate decoded pixel')
          visited[pixel] = 1
          for (let c = 0; c < 4; c++) result[pixel * 4 + c] = block.data[source + c] ?? 0
          if (result[pixel * 4 + 3] !== original[pixel * 4 + 3]) throw new Error('Alpha changed')
        }
    } finally {
      block.release?.()
    }
  }
  for (const value of visited) if (value !== 1) throw new Error('Missing decoded pixel')
  return result
}

it('keeps forward entropy selection colors and exact alpha identical in synchronous and cooperative encoders', async () => {
  // A nonpalette, nonprogressive SDR photo at effort 7/distance 4 admits advanced DC.
  const pixels = jpegXlDcModelPixels(width, height),
    before = pixels.slice()
  const colors = new Set<number>()
  for (let i = 0; i < pixels.length; i += 4)
    colors.add(((pixels[i] ?? 0) << 16) | ((pixels[i + 1] ?? 0) << 8) | (pixels[i + 2] ?? 0))
  expect(colors.size).toBeGreaterThan(2048)
  const syncMemory = new JpegXlEncoderMemory(budget),
    asyncMemory = new JpegXlEncoderMemory(budget)
  let checkpoints = 0
  try {
    const sync = encodeJpegXlVarDct8(pixels, width, height, 4, syncMemory, 4, 7)
    const cooperative = await encodeJpegXlVarDct8Async(
      pixels,
      width,
      height,
      4,
      asyncMemory,
      async () => {
        checkpoints++
      },
      4,
      7,
    )
    expect(cooperative).toEqual(sync)
    const combine = (parts: readonly Uint8Array[]): Uint8Array => {
      const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
      let offset = 0
      for (const part of parts) {
        result.set(part, offset)
        offset += part.length
      }
      return result
    }
    const syncPixels = await decode(combine(sync), pixels)
    const asyncPixels = await decode(combine(cooperative), pixels)
    expect(asyncPixels).toEqual(syncPixels)
    expect(checkpoints).toBeGreaterThan(0)
    expect(pixels).toEqual(before)
  } finally {
    syncMemory.close()
    asyncMemory.close()
  }
  expect(syncMemory.liveBytes).toBe(0)
  expect(asyncMemory.liveBytes).toBe(0)
}, 60_000)

it('preserves public opaque gradient colors and exact alpha with ample advanced DC budget', async () => {
  // Public createEncoder is cooperative only; this complements the sync/async core comparison.
  const result = await verifyJpegXlDcModel(budget, width, height, 4)
  expect(result.samples).toBe(width * height * 4)
  expect(result.alphaError).toBe(0)
  expect(result.meanColorError).toBeLessThan(8)
  expect(result.ownedPeak).toBeLessThanOrEqual(budget)
  expect(result.ownedLive).toBe(0)
  expect(result.ownedAllocations).toBe(0)
}, 60_000)
