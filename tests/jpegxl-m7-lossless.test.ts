import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { createJpegXlModularEncoder } from '../src/codecs/jpegxl-modular-encode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

describe('JPEG XL multi-group lossless effort search', () => {
  it.each(
    [512, 1031].flatMap((width) => [256, 257, 1024, 1025].map((colors) => ({ width, colors }))),
  )(
    'preserves RGBA16 samples with $colors colors at width $width at the palette boundaries',
    async ({ width, colors }) => {
      const height = 3
      const pixels = new Uint8Array(width * height * 8)
      for (let position = 0; position < width * height; position++) {
        const color = position % colors
        for (let channel = 0; channel < 4; channel++) {
          const sample =
            channel === 3
              ? color % 3 === 0
                ? 0
                : 65535
              : (color * (channel * 12 + 1) + channel * 12345) & 65535
          pixels[position * 8 + channel * 2] = sample >>> 8
          pixels[position * 8 + channel * 2 + 1] = sample
        }
      }
      const sink = new Uint8ArraySink()
      const encoder = await createJpegXlModularEncoder(sink, {
        width,
        height,
        pixelFormat: 'rgba16',
        colorSemantics: {
          family: 'rgb',
          primaries: 'srgb',
          transfer: { kind: 'srgb' },
          matrix: 'identity',
          range: 'full',
          alpha: 'straight',
          provenance: 'assumed-default',
          renderingIntent: 'relative',
        },
        options: { effort: 7 },
      })
      await encoder.write({
        x: 0,
        y: 0,
        width,
        height,
        stride: width * 8,
        format: 'rgba16',
        data: pixels,
      })
      await encoder.finish()
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(sink.toUint8Array()),
        defaultImageLimits,
      )
      if (!decoder) throw new Error('Missing decoder')
      let rows = 0
      for await (const block of decoder.decode()) {
        expect(block.format).toBe('rgba16')
        for (let y = 0; y < block.height; y++) {
          expect(block.data.subarray(y * block.stride, y * block.stride + width * 8)).toEqual(
            pixels.subarray((block.y + y) * width * 8, (block.y + y + 1) * width * 8),
          )
          rows++
        }
        block.release?.()
      }
      expect(rows).toBe(height)
    },
  )

  it.each([
    [false, 1025],
    [true, 1025],
    [false, 1024],
    [true, 1024],
  ] as const)(
    'round-trips signed gradient contexts across group and row boundaries, palette=%s width=%i',
    async (palette, width) => {
      const height = 65
      const pixels = new Uint8Array(width * height * 3)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          for (let channel = 0; channel < 3; channel++)
            pixels[(y * width + x) * 3 + channel] = palette
              ? x % 256 < 200 && y % 32 < 20 && Math.sin(x * 0.2) + Math.sin(y * 0.1) > 0
                ? 0
                : 255
              : Math.round(127 + 100 * Math.sin(x / (13 + channel * 7) + y / (5 + channel * 3)))
      const sink = new Uint8ArraySink()
      const encoder = await createJpegXlModularEncoder(sink, {
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
        options: { effort: 7 },
      })
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
      if (!('groupSearchEvidence' in encoder)) throw new Error('Missing group search evidence')
      if (width > 1024)
        expect(encoder.groupSearchEvidence).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              x: 0,
              contextModel: 'gradient',
              palette: palette ? 'ordinary' : 'none',
            }),
          ]),
        )
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(sink.toUint8Array()),
        defaultImageLimits,
      )
      if (!decoder) throw new Error('Missing decoder')
      let rows = 0
      for await (const block of decoder.decode()) {
        for (let y = 0; y < block.height; y++) {
          expect(block.data.subarray(y * block.stride, y * block.stride + width * 3)).toEqual(
            pixels.subarray((block.y + y) * width * 3, (block.y + y + 1) * width * 3),
          )
          rows++
        }
        block.release?.()
      }
      expect(rows).toBe(height)
    },
  )

  for (const width of [1024, 1025]) {
    it(`splits long zero runs across channel planes at width ${width}`, async () => {
      const height = 700,
        input = new Uint8Array(width * height * 3)
      const sink = new Uint8ArraySink()
      const encoder = await createJpegXlModularEncoder(sink, {
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
        options: { effort: 7 },
      })
      await encoder.write({
        x: 0,
        y: 0,
        width,
        height,
        stride: width * 3,
        format: 'rgb8',
        data: input,
      })
      await encoder.finish()
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(sink.toUint8Array()),
        defaultImageLimits,
      )
      if (!decoder) throw new Error('Missing decoder')
      let samples = 0
      for await (const block of decoder.decode()) {
        expect(block.data.some((sample) => sample !== 0)).toBe(false)
        samples += block.width * block.height * 3
        block.release?.()
      }
      expect(samples).toBe(input.length)
    }, 30000)
  }

  for (const depth of [8, 10, 12, 16]) {
    for (const width of [1023, 1024, 1025, 8193]) {
      it(`keeps exact ${depth}-bit RGB and transparent color at width ${width}`, async () => {
        const height = 7,
          channels = 4
        const sampleBytes = depth === 8 ? 1 : 2
        const format = depth === 8 ? 'rgba8' : 'rgba16'
        const maximum = 2 ** depth - 1
        const rowBytes = width * channels * sampleBytes
        const input = new Uint8Array(rowBytes * height)
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            for (let channel = 0; channel < channels; channel++) {
              const sample =
                channel === 3 ? (x % 3 === 0 ? 0 : maximum) : (x + y * (3 - channel)) & maximum
              const offset = ((y * width + x) * channels + channel) * sampleBytes
              if (sampleBytes === 2) input[offset] = sample >>> 8
              input[offset + sampleBytes - 1] = sample
            }
          }
        const sizes: number[] = []
        for (const effort of [1, 3, 5, 7]) {
          const sink = new Uint8ArraySink()
          const encoder = await createJpegXlModularEncoder(sink, {
            width,
            height,
            pixelFormat: format,
            colorSemantics: {
              family: 'rgb',
              primaries: 'srgb',
              transfer: { kind: 'srgb' },
              matrix: 'identity',
              range: 'full',
              alpha: 'straight',
              provenance: 'assumed-default',
              renderingIntent: 'relative',
            },
            options: { effort, sampleBitDepth: depth },
          })
          await encoder.write({
            x: 0,
            y: 0,
            width,
            height,
            stride: rowBytes,
            format,
            data: input,
          })
          await encoder.finish()
          const bytes = sink.toUint8Array()
          sizes.push(bytes.length)
          if (width > 1024 && effort > 1) {
            if (!('groupSearchEvidence' in encoder))
              throw new Error('Missing group search evidence')
            expect(encoder.groupSearchEvidence).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ effort, entropy: 'ans', x: 0, y: 0 }),
              ]),
            )
          }
          const decoder = await jpegxlCodec.createDecoder?.(
            new MemorySource(bytes),
            defaultImageLimits,
          )
          if (!decoder) throw new Error('Missing decoder')
          let rows = 0
          for await (const block of decoder.decode()) {
            expect(block.format).toBe(format)
            for (let y = 0; y < block.height; y++) {
              expect(block.data.subarray(y * block.stride, y * block.stride + rowBytes)).toEqual(
                input.subarray((block.y + y) * rowBytes, (block.y + y + 1) * rowBytes),
              )
              rows++
            }
            block.release?.()
          }
          expect(rows).toBe(height)
        }
        if (width > 1024) expect(sizes[3]).toBeLessThan((sizes[0] ?? 0) * 0.75)
      }, 30_000)
    }
  }
})
