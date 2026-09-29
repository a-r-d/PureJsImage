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
import { verifyJpegXlLocalContrast } from './helpers/jpegxl-local-contrast.ts'

describe('JPEG XL pixel-to-VarDCT conformance path', () => {
  for (const progressive of [false, true]) {
    it(`changes local contrast gradually across refinement boundaries, progressive=${progressive}`, async () => {
      for (const boundary of [2, 4]) {
        const before = await verifyJpegXlLocalContrast(progressive, boundary - 0.01)
        const after = await verifyJpegXlLocalContrast(progressive, boundary + 0.01)
        expect(Math.abs(after.rmse - before.rmse)).toBeLessThan(0.1)
        expect(Math.abs(after.contrast - before.contrast)).toBeLessThan(0.05)
      }
    })

    it(`preserves fine colored texture at effort 7, progressive=${progressive}`, async () => {
      const result = await verifyJpegXlLocalContrast(progressive)
      expect(result.samples).toBe(129 * 65 * 3)
      expect(result.rmse).toBeLessThan(3)
      expect(result.contrast).toBeGreaterThan(0.8)
      expect(result.contrast).toBeLessThan(1.1)
    })
  }

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

  it('selects a smaller public stream for sparse diagonal graphics without losing edge quality', async () => {
    const width = 512
    const height = 512
    const pixels = new Uint8Array(width * height * 3)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const edge = (x * 3 + y * 5) % 127 < 2
        const offset = (y * width + x) * 3
        pixels[offset] = edge ? 90 : 238 + ((x * 13 + y * 7) % 5)
        pixels[offset + 1] = edge ? 132 : 244 + ((x + y) % 5)
        pixels[offset + 2] = edge ? 12 : 229 + ((x * 5 + y) % 5)
      }
    const source = pixels.slice()
    const strict = new Uint8ArraySink()
    for (const part of encodeJpegXlVarDct8(pixels, width, height, 3, undefined, 3, 7))
      await strict.write(part)
    const publicSink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(publicSink, {
      width,
      height,
      pixelFormat: 'rgb8',
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'assumed-default',
        renderingIntent: 'relative',
      },
      options: { mode: 'lossy', distance: 3, effort: 7, container: false },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error('Missing JPEG XL encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height,
      stride: width * 3,
      format: 'rgb8',
      data: pixels,
    })
    await encoder.finish()
    const publicBytes = publicSink.toUint8Array()
    expect(pixels).toEqual(source)
    expect(publicBytes.byteLength).toBeLessThan(strict.toUint8Array().byteLength * 0.75)
    const frames = await readJpegXlSourceFrameStructure(
      new MemorySource(publicBytes),
      defaultImageLimits,
    )
    expect(frames.encoding).toBe('vardct')
    const squaredError = async (bytes: Uint8Array): Promise<number> => {
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('Missing JPEG XL decoder')
      let error = 0
      let samples = 0
      for await (const block of decoder.decode()) {
        for (let y = 0; y < block.height; y++)
          for (let x = 0; x < width * 3; x++) {
            const delta =
              (block.data[y * block.stride + x] ?? 0) - (pixels[(block.y + y) * width * 3 + x] ?? 0)
            error += delta * delta
            samples++
          }
        block.release?.()
      }
      expect(samples).toBe(pixels.length)
      return error / samples
    }
    expect(await squaredError(publicBytes)).toBeLessThan(await squaredError(strict.toUint8Array()))
    // Two effort-7 encodes and both reconstructions can exceed Vitest's default
    // five seconds on shared CI runners. Size and quality checks stay unchanged.
  }, 30_000)

  it('keeps bright PQ16 edges and native precision at effort 7', async () => {
    const width = 17,
      height = 9
    const pixels = new Uint8Array(width * height * 6)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const value = x < 8 ? 0x3000 : 0xd000
        for (let channel = 0; channel < 3; channel++) {
          const offset = (y * width + x) * 6 + channel * 2
          pixels[offset] = value >>> 8
          pixels[offset + 1] = value & 255
        }
      }
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width,
      height,
      pixelFormat: 'rgb16',
      colorSemantics: {
        family: 'rgb',
        primaries: 'srgb',
        transfer: { kind: 'pq' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'container-signaled',
        renderingIntent: 'relative',
      },
      options: { mode: 'lossy', distance: 3, effort: 7, sampleBitDepth: 16 },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error('Missing JPEG XL encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height,
      stride: width * 6,
      format: 'rgb16',
      data: pixels,
    })
    await encoder.finish()
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(sink.toUint8Array()),
      defaultImageLimits,
    )
    if (!decoder) throw new Error('Missing JPEG XL decoder')
    expect(decoder.pixelFormat).toBe('rgbf32')
    let dark = 0,
      bright = 0,
      rows = 0
    for await (const block of decoder.decode()) {
      const values = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < width; x++) {
          const value = values.getFloat32(y * block.stride + x * 12, false)
          expect(Number.isFinite(value)).toBe(true)
          if (x < 8) dark += value
          else bright += value
        }
      rows += block.height
      block.release?.()
    }
    expect(rows).toBe(height)
    expect(bright / 9).toBeGreaterThan(dark / 8)
  })

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

  it('keeps effort-7 lossy RGBA color boundaries accurate with exact alpha', async () => {
    const width = 64
    const height = 64
    const pixels = new Uint8Array(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4
        const color = y >= 26 && y < 34 ? [244, 218, 32] : x < 32 ? [223, 36, 40] : [30, 67, 235]
        for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = color[channel] ?? 0
        pixels[offset + 3] = y < 8 ? 0 : y < 16 ? 128 : 255
      }
    }
    const sink = new Uint8ArraySink()
    for (const part of encodeJpegXlVarDct8(pixels, width, height, 3, undefined, 4, 7))
      await sink.write(part)
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(sink.toUint8Array()),
      defaultImageLimits,
    )
    if (!decoder) throw new Error('Missing alpha decoder')
    let error = 0
    let count = 0
    for await (const block of decoder.decode()) {
      for (let y = 0; y < block.height; y++) {
        for (let x = 0; x < width; x++) {
          const source = ((block.y + y) * width + x) * 4
          const decoded = y * block.stride + x * 4
          expect(block.data[decoded + 3]).toBe(pixels[source + 3])
          if (x < 28 || x > 35 || block.y + y < 16) continue
          for (let channel = 0; channel < 3; channel++) {
            error += Math.abs(
              (block.data[decoded + channel] ?? 0) - (pixels[source + channel] ?? 0),
            )
            count++
          }
        }
      }
      block.release?.()
    }
    expect(count).toBe(8 * 48 * 3)
    expect(error / count).toBeLessThan(4.5)
  })

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
