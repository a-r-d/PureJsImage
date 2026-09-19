import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import type { PixelColorSemantics } from '../src/color.ts'
import { createImageLibrary } from '../src/index.ts'
import { inspectJpegXl, openJpegXlSession } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

const Image = createImageLibrary([jpegxlCodec])
const semantics: PixelColorSemantics = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'straight',
  provenance: 'assumed-default',
  renderingIntent: 'relative',
}
const width = 257,
  height = 17
const pixels = Uint8Array.from({ length: width * height * 4 }, (_, index) =>
  index % 4 === 3 ? Math.floor(index / 4) % 256 : Math.floor(index / 4) % 251,
)

async function encode(options: Readonly<Record<string, unknown>>) {
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: 'rgba8',
    colorSemantics: semantics,
    options,
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('Missing encoder')
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: width * 4,
    format: 'rgba8',
    data: pixels,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

describe('JPEG XL M7 explicit encoding modes', () => {
  it.each([3, 7])(
    'ignores invisible RGB during lossy effort %i while preserving alpha',
    async (effort) => {
      const frameWidth = 17,
        frameHeight = 9
      const encoded: Uint8Array[] = []
      for (const variant of [0, 1]) {
        const input = new Uint8Array(frameWidth * frameHeight * 4)
        for (let y = 0; y < frameHeight; y++)
          for (let x = 0; x < frameWidth; x++) {
            const offset = (y * frameWidth + x) * 4
            const alpha = x < 8 || (x + y) % 7 === 0 ? 0 : x % 3 === 0 ? 127 : 255
            for (let channel = 0; channel < 3; channel++)
              input[offset + channel] =
                alpha === 0
                  ? (offset * (variant + 3) + channel * 19) & 255
                  : (x * 7 + y * 5 + channel * 13) & 255
            input[offset + 3] = alpha
          }
        const sink = new Uint8ArraySink()
        const encoder = await jpegxlCodec.createEncoder?.(sink, {
          width: frameWidth,
          height: frameHeight,
          pixelFormat: 'rgba8',
          colorSemantics: semantics,
          options: { mode: 'lossy', distance: 1, effort },
        })
        if (!encoder) throw new Error('Missing encoder')
        await encoder.write({
          x: 0,
          y: 0,
          width: frameWidth,
          height: frameHeight,
          stride: frameWidth * 4,
          format: 'rgba8',
          data: input,
        })
        await encoder.finish()
        const bytes = sink.toUint8Array()
        encoded.push(bytes)
        const decoder = await jpegxlCodec.createDecoder?.(
          new MemorySource(bytes),
          defaultImageLimits,
        )
        if (!decoder) throw new Error('Missing decoder')
        let rows = 0
        for await (const block of decoder.decode()) {
          for (let y = 0; y < block.height; y++) {
            for (let x = 0; x < frameWidth; x++)
              expect(block.data[y * block.stride + x * 4 + 3]).toBe(
                input[((block.y + y) * frameWidth + x) * 4 + 3],
              )
            rows++
          }
          block.release?.()
        }
        expect(rows).toBe(frameHeight)
      }
      expect(encoded[1]).toEqual(encoded[0])
    },
  )

  it.each([3, 7])(
    'keeps grouped alpha and final pixels exact across passes at effort %i',
    async (effort) => {
      const frameWidth = 513,
        frameHeight = 257
      const input = new Uint8Array(frameWidth * frameHeight * 4)
      for (let y = 0; y < frameHeight; y++)
        for (let x = 0; x < frameWidth; x++) {
          const offset = (y * frameWidth + x) * 4
          input[offset] = x & 255
          input[offset + 1] = y & 255
          input[offset + 2] = (x + y) & 255
          input[offset + 3] = x % 17 === 0 ? 0 : x % 13 === 0 ? y & 255 : 255
        }
      const decodedFrames: Uint8Array[] = []
      for (const progressive of [false, true]) {
        const sink = new Uint8ArraySink()
        const encoder = await jpegxlCodec.createEncoder?.(sink, {
          width: frameWidth,
          height: frameHeight,
          pixelFormat: 'rgba8',
          colorSemantics: semantics,
          options: {
            mode: 'lossy',
            effort,
            distance: 1,
            progressive,
            maxWorkingBytes: 64 * 1024 * 1024,
          },
        })
        if (!encoder) throw new Error('Missing encoder')
        await encoder.write({
          x: 0,
          y: 0,
          width: frameWidth,
          height: frameHeight,
          stride: frameWidth * 4,
          format: 'rgba8',
          data: input,
        })
        await encoder.finish()
        const bytes = sink.toUint8Array()
        expect((await inspectJpegXl(bytes)).progressivePasses).toBe(progressive ? 2 : 1)
        const decoder = await jpegxlCodec.createDecoder?.(
          new MemorySource(bytes),
          defaultImageLimits,
        )
        if (!decoder) throw new Error('Missing decoder')
        const output = new Uint8Array(input.length)
        let rows = 0
        for await (const block of decoder.decode()) {
          for (let y = 0; y < block.height; y++) {
            output.set(
              block.data.subarray(y * block.stride, y * block.stride + frameWidth * 4),
              (block.y + y) * frameWidth * 4,
            )
            rows++
          }
          block.release?.()
        }
        expect(rows).toBe(frameHeight)
        for (let index = 3; index < input.length; index += 4)
          if (output[index] !== input[index]) throw new Error(`Alpha changed at sample ${index}`)
        decodedFrames.push(output)
      }
      expect(decodedFrames[1]).toEqual(decodedFrames[0])
    },
    15_000,
  )

  it.each(['modular', 'forward-vardct', 'jpeg-transcoded'] as const)(
    're-encodes decoded %s pixels through the public lossy pipeline',
    async (origin) => {
      const source =
        origin === 'jpeg-transcoded'
          ? await readFile(
              'benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/progressive-rgb-exif.jxl',
            )
          : await encode(origin === 'modular' ? { effort: 7 } : { mode: 'lossy', effort: 7 })
      const before = await inspectJpegXl(source)
      const image = await Image.open(source)
      const encoded = await image
        .jpegxl({ mode: 'lossy', distance: 0.5, effort: 7, progressive: true })
        .toBuffer()
      const after = await inspectJpegXl(encoded)
      expect(after.encoding).toBe('vardct')
      expect(after.progressivePasses).toBe(2)
      expect(after.width).toBe(before.width)
      expect(after.height).toBe(before.height)
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(encoded),
        defaultImageLimits,
      )
      if (!decoder) throw new Error('Missing re-encode decoder')
      let decodedPixels = 0
      for await (const block of decoder.decode()) {
        decodedPixels += block.width * block.height
        block.release?.()
      }
      expect(decodedPixels).toBe(before.width * before.height)
    },
  )
  it('keeps the default pipeline lossless and selects VarDCT only for explicit lossy mode', async () => {
    const source = await encode({})
    const image = await Image.open(source)
    const lossless = await image.jpegxl().toBuffer()
    const lossy = await image.jpegxl({ mode: 'lossy', distance: 1, effort: 3 }).toBuffer()
    expect((await inspectJpegXl(lossless)).encoding).toBe('modular')
    expect((await inspectJpegXl(lossy)).encoding).toBe('vardct')
    for (const [bytes, exactColor] of [
      [lossless, true],
      [lossy, false],
    ] as const) {
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('Missing decoder')
      let samples = 0
      for await (const block of decoder.decode()) {
        expect(block.format).toBe('rgba8')
        for (let y = 0; y < block.height; y++) {
          for (let x = 0; x < width * 4; x++) {
            if (exactColor || x % 4 === 3)
              expect(block.data[y * block.stride + x]).toBe(pixels[(block.y + y) * width * 4 + x])
            samples++
          }
        }
        block.release?.()
      }
      expect(samples).toBe(pixels.length)
    }
  })

  it('writes two progressive passes with the same final pixels and exact alpha', async () => {
    const final = await encode({ mode: 'lossy', distance: 1 })
    const progressive = await encode({ mode: 'lossy', distance: 1, progressive: true })
    expect((await inspectJpegXl(progressive)).progressivePasses).toBe(2)
    const collect = async (bytes: Uint8Array) => {
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('Missing decoder')
      const output = new Uint8Array(width * height * 4)
      for await (const block of decoder.decode()) {
        for (let y = 0; y < block.height; y++)
          output.set(
            block.data.subarray(y * block.stride, y * block.stride + width * 4),
            (block.y + y) * width * 4,
          )
        block.release?.()
      }
      return output
    }
    expect(await collect(progressive)).toEqual(await collect(final))
  })

  for (const options of [
    { distance: 1 },
    { progressive: true },
    { mode: 'lossy', progressive: 1 },
    { mode: 'lossless', distance: 1 },
    { mode: 'lossy', distance: 0 },
    { mode: 'lossy', distance: -1 },
    { mode: 'lossy', distance: Infinity },
    { mode: 'lossy', distance: NaN },
    { mode: 'lossy', distance: 26 },
    { mode: 'unknown' },
  ]) {
    it(`rejects conflicting or invalid options ${JSON.stringify(options)}`, async () => {
      await expect(encode(options)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    })
  }

  for (const depth of [8, 10, 12, 16]) {
    for (const family of ['gray', 'rgb', 'rgba'] as const) {
      it(`encodes ${family} ${depth}-bit samples with exact native alpha`, async () => {
        const channels = family === 'gray' ? 1 : family === 'rgb' ? 3 : 4
        const bytesPerSample = depth === 8 ? 1 : 2
        const format =
          family === 'gray'
            ? depth === 8
              ? 'gray8'
              : 'gray16'
            : family === 'rgb'
              ? depth === 8
                ? 'rgb8'
                : 'rgb16'
              : depth === 8
                ? 'rgba8'
                : 'rgba16'
        const testWidth = 257,
          testHeight = 9,
          maximum = 2 ** depth - 1
        const input = new Uint8Array(testWidth * testHeight * channels * bytesPerSample)
        const view = new DataView(input.buffer)
        for (let pixel = 0; pixel < testWidth * testHeight; pixel++) {
          for (let channel = 0; channel < channels; channel++) {
            const value =
              channel === 3
                ? pixel % (maximum + 1)
                : Math.round(((pixel % testWidth) * maximum) / (testWidth - 1))
            const offset = (pixel * channels + channel) * bytesPerSample
            if (bytesPerSample === 1) input[offset] = value
            else view.setUint16(offset, value, false)
          }
        }
        const sink = new Uint8ArraySink()
        const encoder = await jpegxlCodec.createEncoder?.(sink, {
          width: testWidth,
          height: testHeight,
          pixelFormat: format,
          colorSemantics: {
            ...semantics,
            family: family === 'gray' ? 'gray' : 'rgb',
            alpha: family === 'rgba' ? 'straight' : 'none',
          },
          options: { mode: 'lossy', distance: 0.25, sampleBitDepth: depth },
          limits: defaultImageLimits,
        })
        if (!encoder) throw new Error('Missing encoder')
        await encoder.write({
          x: 0,
          y: 0,
          width: testWidth,
          height: testHeight,
          stride: testWidth * channels * bytesPerSample,
          format,
          data: input,
        })
        await encoder.finish()
        const decoder = await jpegxlCodec.createDecoder?.(
          new MemorySource(sink.toUint8Array()),
          defaultImageLimits,
          { colorOutput: 'preserve' },
        )
        if (!decoder) throw new Error('Missing decoder')
        expect(decoder.pixelFormat).toBe(format)
        let count = 0,
          error = 0
        for await (const block of decoder.decode()) {
          const data = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
          for (let y = 0; y < block.height; y++) {
            for (let sample = 0; sample < testWidth * channels; sample++) {
              const actualOffset = y * block.stride + sample * bytesPerSample
              const expectedOffset =
                ((block.y + y) * testWidth * channels + sample) * bytesPerSample
              const actual =
                bytesPerSample === 1
                  ? (block.data[actualOffset] ?? -1)
                  : data.getUint16(actualOffset, false)
              const expected =
                bytesPerSample === 1
                  ? (input[expectedOffset] ?? -1)
                  : view.getUint16(expectedOffset, false)
              if (channels === 4 && sample % 4 === 3) expect(actual).toBe(expected)
              else {
                error += Math.abs(actual - expected) / maximum
                count++
              }
            }
          }
          block.release?.()
        }
        expect(count).toBe(testWidth * testHeight * (channels === 4 ? 3 : channels))
        expect(error / count).toBeLessThan(0.01)
      })
    }
  }

  for (const primaries of ['srgb', 'display-p3', 'rec2020'] as const) {
    for (const transfer of [{ kind: 'linear' }, { kind: 'pq' }] as const) {
      it(`preserves ${primaries} ${transfer.kind} white luminance and source signaling`, async () => {
        const sink = new Uint8ArraySink()
        const input = new Uint8Array(8 * 8 * 6).fill(255)
        const encoder = await jpegxlCodec.createEncoder?.(sink, {
          width: 8,
          height: 8,
          pixelFormat: 'rgb16',
          colorSemantics: { ...semantics, primaries, transfer, alpha: 'none' },
          options: { mode: 'lossy', distance: 0.25, progressive: true, sampleBitDepth: 16 },
          limits: defaultImageLimits,
        })
        if (!encoder) throw new Error('Missing encoder')
        await encoder.write({
          x: 0,
          y: 0,
          width: 8,
          height: 8,
          stride: 48,
          format: 'rgb16',
          data: input,
        })
        await encoder.finish()
        const bytes = sink.toUint8Array()
        const inspection = await inspectJpegXl(bytes)
        expect(inspection.toneMapping.intensityTarget).toBe(transfer.kind === 'pq' ? 10000 : 255)
        const decoder = await jpegxlCodec.createDecoder?.(
          new MemorySource(bytes),
          defaultImageLimits,
        )
        if (!decoder) throw new Error('Missing decoder')
        expect(decoder.pixelFormat).toBe('rgbf32')
        for await (const block of decoder.decode()) {
          const values = new DataView(
            block.data.buffer,
            block.data.byteOffset,
            block.data.byteLength,
          )
          const expected = transfer.kind === 'pq' ? 10000 / 203 : 1
          for (let offset = 0; offset < block.data.length; offset += 4)
            expect(Math.abs(values.getFloat32(offset, false) / expected - 1)).toBeLessThan(0.001)
          block.release?.()
        }
      })
    }
  }

  it('keeps independent 8-bit color and 16-bit alpha precision in RGBA16 storage', async () => {
    const width = 17,
      height = 13
    const input = new Uint8Array(width * height * 8),
      view = new DataView(input.buffer)
    for (let pixel = 0; pixel < width * height; pixel++) {
      for (let channel = 0; channel < 3; channel++)
        view.setUint16(pixel * 8 + channel * 2, 128, false)
      view.setUint16(pixel * 8 + 6, pixel * 297, false)
    }
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width,
      height,
      pixelFormat: 'rgba16',
      colorSemantics: semantics,
      options: { mode: 'lossy', sampleBitDepth: 8, alphaBitDepth: 16, progressive: true },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error('Missing encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height,
      stride: width * 8,
      format: 'rgba16',
      data: input,
    })
    await encoder.finish()
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(sink.toUint8Array()),
      defaultImageLimits,
    )
    if (!decoder) throw new Error('Missing decoder')
    expect(decoder.pixelFormat).toBe('rgba16')
    for await (const block of decoder.decode()) {
      const values = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < width; x++) {
          const actual = y * block.stride + x * 8,
            expected = ((block.y + y) * width + x) * 8
          expect(values.getUint16(actual + 6, false)).toBe(view.getUint16(expected + 6, false))
          expect(Math.abs(values.getUint16(actual, false) - 128)).toBeLessThanOrEqual(1)
        }
      block.release?.()
    }
  })

  it('lets M6 read the first generated SDR pass without consuming the final pass', async () => {
    const sink = new Uint8ArraySink()
    const input = Uint8Array.from({ length: 513 * 17 * 3 }, (_, index) => (index * 13) % 256)
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: 513,
      height: 17,
      pixelFormat: 'rgb8',
      colorSemantics: { ...semantics, alpha: 'none' },
      options: { mode: 'lossy', progressive: true, effort: 3 },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error('Missing encoder')
    await encoder.write({
      x: 0,
      y: 0,
      width: 513,
      height: 17,
      stride: 513 * 3,
      format: 'rgb8',
      data: input,
    })
    await encoder.finish()
    const bytes = sink.toUint8Array()
    const session = await openJpegXlSession(bytes)
    const completed: number[] = []
    for await (const event of session.native({ scaleDenominator: 2 })) {
      if (event.type === 'stage-complete') completed.push(event.stage.completedPasses)
      if (event.type === 'block') event.block.release?.()
    }
    expect(completed).toEqual([0, 1])
    expect(session.sourceSectionBytes).toBeLessThan(bytes.length)
    await session.close()
    expect(session.managedLiveBytes).toBe(0)
  })

  it('rejects source color that the forward path cannot preserve', async () => {
    await expect(
      jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
        width,
        height,
        pixelFormat: 'rgba8',
        colorSemantics: { ...semantics, primaries: 'display-p3', transfer: { kind: 'hlg' } },
        options: { mode: 'lossy' },
        limits: defaultImageLimits,
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })
})
