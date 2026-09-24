import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { readJpegXlSourceFrameStructures } from '../src/codecs/jpegxl-decode.ts'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { forwardJpegXlDct16 } from '../src/codecs/jpegxl-vardct-forward-transforms.ts'
import {
  encodeJpegXlVarDct8,
  encodeJpegXlVarDct8Async,
} from '../src/codecs/jpegxl-vardct-encode.ts'
import { JpegXlVarDctMemoryLedger } from '../src/codecs/jpegxl-vardct-memory.ts'
import { prepareJpegXlVarDctLowFrequency } from '../src/codecs/jpegxl-vardct-render.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'

const encode = (
  pixels: Uint8Array,
  width: number,
  height: number,
  experimental: boolean,
  memory?: JpegXlEncoderMemory,
  progressive = false,
): Uint8Array => {
  const parts = encodeJpegXlVarDct8(
    pixels,
    width,
    height,
    3,
    memory,
    3,
    7,
    undefined,
    8,
    progressive,
    undefined,
    experimental,
  )
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

const ramp = (width: number, height: number): Uint8Array =>
  Uint8Array.from({ length: width * height * 3 }, (_, index) => {
    const x = Math.floor(index / 3) % width
    const y = Math.floor(index / (width * 3))
    return index % 3 === 0
      ? Math.round(100 + x / 2)
      : index % 3 === 1
        ? Math.round(120 + y / 2)
        : Math.round(140 + x / 4 + y / 4)
  })

const basis = (frequency: number, position: number): number =>
  Math.sqrt(2 / 16) *
  (frequency === 0 ? Math.SQRT1_2 : 1) *
  Math.cos(((2 * position + 1) * frequency * Math.PI) / 32)

describe('experimental DCT16 backend', () => {
  for (const pattern of ['constant', 'ramp', 'impulse', 'edge', 'texture'] as const) {
    it(`round trips ${pattern} with mean-normalized transposed coefficients`, () => {
      const samples = Float32Array.from({ length: 256 }, (_, index) => {
        const x = index & 15
        const y = index >>> 4
        switch (pattern) {
          case 'constant':
            return 0.375
          case 'ramp':
            return (x + y) / 30
          case 'impulse':
            return x === 7 && y === 9 ? 1 : 0
          case 'edge':
            return x < 8 ? -0.5 : 0.5
          case 'texture':
            return ((x * 37 + y * 71 + x * y * 13) % 257) / 256
        }
      })
      const coefficients = new Float32Array(256)
      forwardJpegXlDct16(samples, new Float32Array(256), coefficients)
      const mean = samples.reduce((sum, value) => sum + value, 0) / 256
      expect(coefficients[0]).toBeCloseTo(mean, 6)
      let maximum = 0
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          let value = 0
          for (let horizontal = 0; horizontal < 16; horizontal++)
            for (let vertical = 0; vertical < 16; vertical++)
              value +=
                (coefficients[horizontal * 16 + vertical] ?? 0) *
                basis(horizontal, x) *
                basis(vertical, y) *
                16
          maximum = Math.max(maximum, Math.abs(value - (samples[y * 16 + x] ?? 0)))
        }
      expect(maximum).toBeLessThan(2e-6)
    })
  }

  it('signals mixed DCT16 and DCT8 coverage on an odd-sized ramp and reconstructs pixels', async () => {
    const width = 65,
      height = 65,
      pixels = ramp(width, height)
    const stream = encode(pixels, width, height, true)
    expect(stream).not.toEqual(encode(pixels, width, height, false))
    expect(
      createHash('sha256')
        .update(encode(pixels, width, height, false))
        .digest('hex'),
    ).toBe('54554eb00e70a50f1254a0029338e0c11b8a6bfb5ea59b7b4026917c8a713ba3')
    const frames = await readJpegXlSourceFrameStructures(
      new MemorySource(stream),
      defaultImageLimits,
    )
    const frame = frames.at(-1)
    if (!frame) throw new Error('Missing frame')
    const sections = frame.sections.map(({ offset, length }) =>
      stream.subarray(offset, offset + length),
    )
    const ledger = new JpegXlVarDctMemoryLedger(defaultImageLimits.maxDecodedBytes)
    const state = prepareJpegXlVarDctLowFrequency(
      sections.slice(0, 1 + frame.dcGroupCount),
      frame,
      ledger,
    )
    expect(state.dcGroup.strategies.filter((value) => value === 4).length).toBeGreaterThan(0)
    expect(state.dcGroup.strategies.filter((value) => value === 0).length).toBeGreaterThan(0)
    const group = state.dcGroup
    const covered = new Uint8Array(group.blockWidth * group.blockHeight)
    for (let y = 0; y < group.blockHeight; y++)
      for (let x = 0; x < group.blockWidth; x++) {
        const index = y * group.blockWidth + x
        if (group.strategyFirstBlocks[index] !== 1) continue
        const strategy = group.strategies[index]
        const extent = strategy === 4 ? 2 : 1
        expect(strategy === 0 || strategy === 4).toBe(true)
        expect(x + extent).toBeLessThanOrEqual(group.blockWidth)
        expect(y + extent).toBeLessThanOrEqual(group.blockHeight)
        for (let dy = 0; dy < extent; dy++)
          for (let dx = 0; dx < extent; dx++) {
            const next = (y + dy) * group.blockWidth + x + dx
            expect(covered[next]).toBe(0)
            expect(group.strategies[next]).toBe(strategy)
            covered[next] = 1
          }
      }
    expect(covered.every((value) => value === 1)).toBe(true)
    state.release()
    expect(ledger.liveBytes).toBe(0)
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(stream), defaultImageLimits)
    if (!decoder) throw new Error('Missing decoder')
    let samples = 0,
      maximum = 0,
      sum = 0
    for await (const block of decoder.decode()) {
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < width * 3; x++) {
          const delta = Math.abs(
            (block.data[y * block.stride + x] ?? -1000) -
              (pixels[(block.y + y) * width * 3 + x] ?? 1000),
          )
          maximum = Math.max(maximum, delta)
          sum += delta
          samples++
        }
      block.release?.()
    }
    expect(samples).toBe(pixels.length)
    expect(maximum).toBeLessThanOrEqual(5)
    expect(sum / samples).toBeLessThan(1)
  })

  it('decodes mixed neighboring transforms on partial groups', async () => {
    const width = 257,
      height = 65
    const pixels = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 3
        const value =
          x < 160 ? Math.round(80 + x / 3 + y / 4) : ((x >>> 2) + (y >>> 2)) & 1 ? 48 : 208
        pixels[offset] = value
        pixels[offset + 1] = value
        pixels[offset + 2] = value
      }
    const stream = encode(pixels, width, height, true)
    const frames = await readJpegXlSourceFrameStructures(
      new MemorySource(stream),
      defaultImageLimits,
    )
    const frame = frames.at(-1)
    if (!frame) throw new Error('Missing frame')
    const sections = frame.sections.map(({ offset, length }) =>
      stream.subarray(offset, offset + length),
    )
    const ledger = new JpegXlVarDctMemoryLedger(defaultImageLimits.maxDecodedBytes)
    const state = prepareJpegXlVarDctLowFrequency(
      sections.slice(0, 1 + frame.dcGroupCount),
      frame,
      ledger,
    )
    expect(state.dcGroup.strategies.includes(4)).toBe(true)
    expect(state.dcGroup.strategies.some((strategy) => strategy !== 4)).toBe(true)
    state.release()
    expect(ledger.liveBytes).toBe(0)
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(stream), defaultImageLimits)
    if (!decoder) throw new Error('Missing decoder')
    let maximum = 0,
      samples = 0
    for await (const block of decoder.decode()) {
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < width * 3; x++) {
          maximum = Math.max(
            maximum,
            Math.abs(
              (block.data[y * block.stride + x] ?? -1000) -
                (pixels[(block.y + y) * width * 3 + x] ?? 1000),
            ),
          )
          samples++
        }
      block.release?.()
    }
    expect(samples).toBe(pixels.length)
    expect(maximum).toBeLessThan(100)
  })

  it('keeps asynchronous opt-in output identical and releases scratch on cancellation', async () => {
    const pixels = ramp(65, 65)
    const memory = new JpegXlEncoderMemory(16_777_216)
    const parts = await encodeJpegXlVarDct8Async(
      pixels,
      65,
      65,
      3,
      memory,
      async () => {},
      3,
      7,
      undefined,
      8,
      false,
      undefined,
      defaultImageLimits,
      {},
      true,
    )
    const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let position = 0
    for (const part of parts) {
      output.set(part, position)
      position += part.length
    }
    expect(output).toEqual(encode(pixels, 65, 65, true))
    memory.close()
    const aborted = new JpegXlEncoderMemory(16_777_216)
    const reason = new Error('cancel DCT16 encoding')
    let checkpoints = 0
    await expect(
      encodeJpegXlVarDct8Async(
        pixels,
        65,
        65,
        3,
        aborted,
        async () => {
          if (++checkpoints === 15) throw reason
        },
        3,
        7,
        undefined,
        8,
        false,
        undefined,
        defaultImageLimits,
        {},
        true,
      ),
    ).rejects.toBe(reason)
    expect(aborted.peakBytes).toBeGreaterThan(0)
    expect(aborted.liveBytes).toBe(0)
    aborted.close()
  })

  it('keeps progressive and lower-effort defaults and unwinds a resource-limit failure', () => {
    const pixels = ramp(65, 65)
    expect(encode(pixels, 65, 65, true, undefined, true)).toEqual(
      encode(pixels, 65, 65, false, undefined, true),
    )
    const memory = new JpegXlEncoderMemory(16_777_216)
    const output = encode(pixels, 65, 65, true, memory)
    expect(memory.liveBytes).toBe(output.length)
    const peak = memory.peakBytes
    memory.close()
    const limited = new JpegXlEncoderMemory(peak - 1)
    expect(() => encode(pixels, 65, 65, true, limited)).toThrow(/maxWorkingBytes/)
    expect(limited.liveBytes).toBe(0)
    limited.close()
  })
})
