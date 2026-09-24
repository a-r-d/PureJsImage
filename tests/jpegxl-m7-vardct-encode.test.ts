import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { readJpegXlSourceFrameStructure } from '../src/codecs/jpegxl-decode.ts'
import { JpegXlEncoderMemory } from '../src/codecs/jpegxl-encoder-memory.ts'
import {
  encodeJpegXlVarDct8,
  encodeJpegXlVarDct8Async,
  forwardJpegXlDct8,
} from '../src/codecs/jpegxl-vardct-encode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

describe('JPEG XL pixel-to-VarDCT conformance path', () => {
  it('decodes aligned effort-1 sRGB including black and white endpoints', async () => {
    const width = 16
    const height = 16
    const pixels = Uint8Array.from({ length: width * height * 3 }, (_, index) => {
      const x = Math.floor(index / 3) % width
      const y = Math.floor(index / (width * 3))
      return y < 8 ? (x < 8 ? 0 : 255) : Math.round(((x + y) * 255) / 30)
    })
    const sink = new Uint8ArraySink()
    for (const part of encodeJpegXlVarDct8(pixels, width, height, 1, undefined, 3, 1))
      await sink.write(part)
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(sink.toUint8Array()),
      defaultImageLimits,
    )
    if (!decoder) throw new Error('Missing JPEG XL decoder')
    let samples = 0
    let maximum = 0
    for await (const block of decoder.decode()) {
      for (let y = 0; y < block.height; y++) {
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
      }
      block.release?.()
    }
    expect(samples).toBe(pixels.length)
    expect(maximum).toBeLessThan(40)
  })

  for (const distance of [0.999, 1, 1.001, 2, 3]) {
    it(`preserves smooth colored gradients at distance ${distance}`, async () => {
      const width = 129,
        height = 65
      const pixels = Uint8Array.from({ length: width * height * 3 }, (_, index) => {
        const x = Math.floor(index / 3) % width,
          y = Math.floor(index / (width * 3))
        return Math.round(
          index % 3 === 0 ? 180 + x / 4 : index % 3 === 1 ? 90 + y / 4 : 140 + x / 8 + y / 8,
        )
      })
      const sink = new Uint8ArraySink()
      for (const part of encodeJpegXlVarDct8(pixels, width, height, distance, undefined, 3, 7))
        await sink.write(part)
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(sink.toUint8Array()),
        defaultImageLimits,
      )
      if (!decoder) throw new Error('Missing JPEG XL decoder')
      let error = 0,
        maximum = 0,
        samples = 0
      for await (const block of decoder.decode()) {
        for (let y = 0; y < block.height; y++) {
          for (let x = 0; x < width * 3; x++) {
            const delta = Math.abs(
              (block.data[y * block.stride + x] ?? -1000) -
                (pixels[(block.y + y) * width * 3 + x] ?? 1000),
            )
            error += delta
            maximum = Math.max(maximum, delta)
            samples++
          }
        }
        block.release?.()
      }
      expect(samples).toBe(pixels.length)
      expect(error / samples).toBeLessThan(1.5)
      expect(maximum).toBeLessThanOrEqual(5)
    })
  }

  for (const [distance, channels, iterations] of [
    [1, 3, 0],
    [3, 3, 2],
    [3, 4, 0],
  ] as const) {
    it(`signals residual restoration for distance=${distance}, channels=${channels}`, async () => {
      const width = 257,
        height = 33
      const pixels = Uint8Array.from(
        { length: width * height * channels },
        (_, index) => (index * 13 + Math.floor(index / (width * channels)) * 7) & 255,
      )
      const sink = new Uint8ArraySink()
      for (const part of encodeJpegXlVarDct8(
        pixels,
        width,
        height,
        distance,
        undefined,
        channels,
        7,
      ))
        await sink.write(part)
      const frame = await readJpegXlSourceFrameStructure(
        new MemorySource(sink.toUint8Array()),
        defaultImageLimits,
      )
      expect(frame.epfIterations).toBe(iterations)
      expect(frame.gaborish).toBe(false)
    })
  }

  it('normalizes DC to the block mean and preserves both frequency axes', () => {
    const input = Float32Array.from(
      { length: 64 },
      (_, index) =>
        0.4 +
        0.1 * Math.cos(((2 * (index & 7) + 1) * Math.PI) / 16) +
        0.2 * Math.cos(((2 * (index >>> 3) + 1) * 3 * Math.PI) / 16),
    )
    const coefficients = new Float32Array(64)
    forwardJpegXlDct8(input, new Float32Array(64), coefficients)
    expect(coefficients[0]).toBeCloseTo(0.4, 6)
    expect(coefficients[8]).toBeCloseTo(0.1 * Math.SQRT1_2, 6)
    expect(coefficients[3]).toBeCloseTo(0.2 * Math.SQRT1_2, 6)
    for (let position = 1; position < 64; position++)
      if (position !== 8 && position !== 3)
        expect(Math.abs(coefficients[position] ?? 1)).toBeLessThan(1e-7)
  })

  for (const [width, height] of [
    [1, 1],
    [31, 19],
    [255, 17],
    [17, 256],
    [257, 33],
    [33, 257],
    [2051, 9],
  ]) {
    if (!width || !height) throw new Error('Missing test dimensions')
    it(`encodes an asymmetric ${width}x${height} RGB ramp without JPEG input`, async () => {
      const pixels = Uint8Array.from({ length: width * height * 3 }, (_, index) => {
        const x = Math.floor(index / 3) % width
        const y = Math.floor(index / (width * 3))
        return index % 3 === 0
          ? Math.round((x * 255) / Math.max(1, width - 1))
          : index % 3 === 1
            ? Math.round((y * 255) / Math.max(1, height - 1))
            : 64
      })
      const sink = new Uint8ArraySink()
      for (const part of encodeJpegXlVarDct8(pixels, width, height, 0.25)) await sink.write(part)
      const bytes = sink.toUint8Array()
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('Missing JPEG XL decoder')
      expect(decoder.width).toBe(width)
      expect(decoder.height).toBe(height)
      let total = 0,
        count = 0,
        maximum = 0
      for await (const block of decoder.decode()) {
        expect(block.format).toBe('rgb8')
        for (let y = 0; y < block.height; y++) {
          for (let x = 0; x < width * 3; x++) {
            const error = Math.abs(
              (block.data[y * block.stride + x] ?? -1000) -
                (pixels[(block.y + y) * width * 3 + x] ?? 1000),
            )
            total += error
            maximum = Math.max(maximum, error)
            count++
          }
        }
        block.release?.()
      }
      expect(count).toBe(pixels.length)
      expect(total / count).toBeLessThan(2.5)
      expect(maximum).toBeLessThan(35)
    })
  }

  for (const horizontal of [false, true])
    for (const progressive of [false, true]) {
      it(`preserves asymmetric half-block edges, horizontal=${horizontal}, progressive=${progressive}`, async () => {
        const width = 257,
          height = 33
        const pixels = Uint8Array.from({ length: width * height * 3 }, (_, index) => {
          const pixel = Math.floor(index / 3),
            x = pixel % width,
            y = Math.floor(pixel / width)
          return (horizontal ? x : y) % 8 < 4 ? 255 : 0
        })
        const sink = new Uint8ArraySink()
        for (const part of encodeJpegXlVarDct8(
          pixels,
          width,
          height,
          0.25,
          undefined,
          3,
          7,
          undefined,
          8,
          progressive,
        ))
          await sink.write(part)
        const decoder = await jpegxlCodec.createDecoder?.(
          new MemorySource(sink.toUint8Array()),
          defaultImageLimits,
        )
        if (!decoder) throw new Error('Missing JPEG XL decoder')
        let samples = 0,
          maximum = 0
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
        expect(maximum).toBeLessThan(5)
      })
    }

  it('rejects zero distance and unsupported extents explicitly', () => {
    expect(() => encodeJpegXlVarDct8(new Uint8Array(3), 1, 1, 0)).toThrow(/distance/)
    expect(() => encodeJpegXlVarDct8(new Uint8Array(3), 100001, 1, 1)).toThrow(/maxWidth/)
    expect(() => encodeJpegXlVarDct8(new Uint8Array(2), 1, 1, 1)).toThrow(/extent/)
  })

  for (const [width, height, distance, effort] of [
    [17, 13, 1, 3],
    [257, 33, 1, 3],
    [33, 257, 1, 3],
    [513, 257, 1, 3],
    [257, 33, 3, 5],
    [257, 33, 3, 7],
  ] as const) {
    it(`preserves every alpha level across ${width}x${height}, distance ${distance}, effort ${effort}`, async () => {
      const pixels = Uint8Array.from({ length: width * height * 4 }, (_, index) =>
        index % 4 === 3 ? Math.floor(index / 4) % 256 : (index * 13) % 256,
      )
      const sink = new Uint8ArraySink()
      for (const part of encodeJpegXlVarDct8(pixels, width, height, distance, undefined, 4, effort))
        await sink.write(part)
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(sink.toUint8Array()),
        defaultImageLimits,
      )
      if (!decoder) throw new Error('Missing alpha decoder')
      let count = 0
      for await (const block of decoder.decode()) {
        expect(block.format).toBe('rgba8')
        for (let y = 0; y < block.height; y++) {
          for (let x = 0; x < width; x++) {
            expect(block.data[y * block.stride + x * 4 + 3]).toBe(
              pixels[((block.y + y) * width + x) * 4 + 3],
            )
            count++
          }
        }
        block.release?.()
      }
      expect(count).toBe(width * height)
    })
  }

  it('admits scratch before allocation, returns only owned sections, and unwinds failure', () => {
    const pixels = new Uint8Array(257 * 33 * 3).fill(96)
    const memory = new JpegXlEncoderMemory(16_777_216)
    const parts = encodeJpegXlVarDct8(pixels, 257, 33, 1, memory)
    expect(memory.liveBytes).toBe(parts.reduce((sum, part) => sum + part.byteLength, 0))
    expect(memory.liveAllocations).toBe(parts.length)
    const peak = memory.peakBytes
    expect(peak).toBeLessThan(8_388_608)
    memory.close()
    expect(memory.liveBytes).toBe(0)
    const limited = new JpegXlEncoderMemory(peak - 1)
    expect(() => encodeJpegXlVarDct8(pixels, 257, 33, 1, limited)).toThrow(/maxWorkingBytes/)
    expect(limited.liveBytes).toBe(0)
    limited.close()
    const shortOutput = new JpegXlEncoderMemory(16_777_216, 32)
    expect(() => encodeJpegXlVarDct8(pixels, 257, 33, 1, shortOutput)).toThrow(/maxOutputBytes/)
    expect(shortOutput.liveBytes).toBe(0)
    shortOutput.close()
  })

  it('keeps asynchronous output identical and releases scratch when a timer cancels encoding', async () => {
    const pixels = new Uint8Array(257 * 33 * 3).fill(96)
    const memory = new JpegXlEncoderMemory(16_777_216)
    const actual = await encodeJpegXlVarDct8Async(pixels, 257, 33, 1, memory, async () => {})
    expect(actual).toEqual(encodeJpegXlVarDct8(pixels, 257, 33, 1))
    memory.close()
    const aborted = new JpegXlEncoderMemory(16_777_216)
    const reason = new Error('cancel forward encoding')
    let cancel = false
    let checkpoints = 0
    const encoding = encodeJpegXlVarDct8Async(pixels, 257, 33, 1, aborted, async () => {
      if (++checkpoints === 2)
        setTimeout(() => {
          cancel = true
        }, 0)
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (cancel) throw reason
    })
    await expect(encoding).rejects.toBe(reason)
    expect(aborted.peakBytes).toBeGreaterThan(0)
    expect(aborted.liveBytes).toBe(0)
    aborted.close()
  })
})
