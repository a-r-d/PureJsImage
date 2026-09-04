import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { encodeBrotli } from '../src/codecs/brotli.ts'
import { inspectJpegXlStructure, jpegxlCodec } from '../src/codecs/jpegxl.ts'
import type { PixelColorSemantics } from '../src/color.ts'
import { inspectJpegXl } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import type { JpegXlEncodeOptions } from '../src/pipeline.ts'
import type { PixelFormat } from '../src/pixel.ts'
import type { ImageSink } from '../src/sink.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import type { ImageSource, ImageSourceReadOptions } from '../src/source.ts'
import { MemorySource } from '../src/source.ts'
import { Image } from './image-library.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { exifOrientation } from '../src/metadata.ts'

const ascii = (value: string): Uint8Array =>
  Uint8Array.from(value, (character) => character.charCodeAt(0))

const hexadecimal = (input: string): Uint8Array => {
  const pairs = input.replaceAll(/\s/g, '').match(/../g)
  if (!pairs) throw new Error('Hexadecimal fixture is empty')
  return Uint8Array.from(pairs, (pair) => Number.parseInt(pair, 16))
}

// cjxl 0.11.0, lossless Modular effort 2, from the documented 8x5 RGB matrix.
// The expected RGBA digest below was produced independently with djxl 0.11.0.
const localTreeRgb = hexadecimal(`
  ff0a205010090804010038018924512a542005921b638c318c3118610c638c8e
  113118ea82ddb7d06ab724b9774aaa2eb3aaaacaaeaaaa02aaabaa5af4a92ec252c1a1
  ec2d0bb13477a92f68611ffadbb639a13d214aa900e305
`)

// cjxl 0.11.1, lossless Modular effort 2, from odd-sized PGM/PAM scientific rasters.
const grayscaleFixtures = [
  {
    bitDepth: 8,
    maximum: 255,
    format: 'gray8',
    digest: 'e9e899f06d05f032d4372e6500566293597290b1829e4af71b5e197197b1f9c8',
    input: hexadecimal(`
      ff0a105010143702080401004c004b12a54285245227057d4244dc22226e119101
    `),
  },
  {
    bitDepth: 10,
    maximum: 1_023,
    format: 'gray16',
    digest: '1c75b80c773e9b57c37a03460dbda13a6dcd9299e07bd9869a8709a403d46b6d',
    input: hexadecimal(`
      ff0a105014143702080401005c004b12a542852456490e28279224c9b52449926b49924401
    `),
  },
  {
    bitDepth: 12,
    maximum: 4_095,
    format: 'gray16',
    digest: 'd6b435b2ed9e9746f5a99c2f83c656d9a46337a58ad91cbfa1cd81b276d4d60d',
    input: hexadecimal(`
      ff0a1050181437020804010068004b12a5428524564b126827484a48cad952425242ee1692129212
    `),
  },
  {
    bitDepth: 16,
    maximum: 65_535,
    format: 'gray16',
    digest: '4593296aa5d6de8479d0c1383ce733b9bb5d3423b075d329bc1914a6dbf97134',
    input: hexadecimal(`
      0000000c4a584c200d0a870a00000014667479706a786c20000000006a786c20
      000000096a786c6c0a000000376a786c63ff0a1050fc00c58d0804010084004b
      12a5428524564f1ae8279224499224c9b52d4992244992e4da96244992245112
    `),
  },
] as const

const grayscaleAlpha = hexadecimal(`
  ff0a1050b0286e0408101000c0004b12a5428524d600f5248001fa5000fa0b1c
  00700094524a29a594524aa92fa494524ae9d5755dd78dd9026c38e00000
`)

// cjxl 0.11.1, lossless Modular effort 2, from a 600x530 PGM whose sample at
// (x, y) is (3x + 5y) mod 256. djxl 0.11.1 independently produced the digest below.
const multiGroupGray = new Uint8Array(readFileSync('tests/fixtures/jpegxl/multi-group-gray8.jxl'))
const adaptiveMultiGroupGray = new Uint8Array(
  readFileSync('benchmark/fixtures/jpegxl/generated-lossless-v0.12.0/gray8-multiple-groups.jxl'),
)

// cjxl 0.11.1, lossless Modular effort 2, from a 4096x4096 PGM whose sample at
// (x, y) is (3x + 5y) mod 256. Exercises a permuted TOC and per-group local MA trees.
const permutedLargeGray = new Uint8Array(
  readFileSync('tests/fixtures/jpegxl/permuted-large-gray8.jxl'),
)

const concatenate = (...parts: readonly Uint8Array[]): Uint8Array => {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const box = (type: string, payload: Uint8Array, extended = false): Uint8Array => {
  const headerBytes = extended ? 16 : 8
  const output = new Uint8Array(headerBytes + payload.byteLength)
  const view = new DataView(output.buffer)
  view.setUint32(0, extended ? 1 : output.byteLength)
  output.set(ascii(type), 4)
  if (extended) view.setBigUint64(8, BigInt(output.byteLength))
  output.set(payload, headerBytes)
  return output
}

const signature = box('JXL ', Uint8Array.of(0x0d, 0x0a, 0x87, 0x0a))
const fileType = (brand = 'jxl ', version: 0 | 1 = 0): Uint8Array =>
  box('ftyp', concatenate(ascii(brand), Uint8Array.of(0, 0, 0, version), ascii('jxl ')))

const fragment = (index: number, final: boolean, payload: Uint8Array): Uint8Array => {
  const header = new Uint8Array(4)
  new DataView(header.buffer).setUint32(0, index | (final ? 0x8000_0000 : 0))
  return box('jxlp', concatenate(header, payload))
}

class CountingSource implements ImageSource {
  readonly size: number
  readonly reads: { readonly offset: number; readonly length: number }[] = []
  readonly #data: Uint8Array

  constructor(data: Uint8Array) {
    this.#data = data
    this.size = data.byteLength
  }

  async read(
    offset: number,
    length: number,
    _options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    const available = offset >= this.size ? 0 : Math.min(length, this.size - offset)
    this.reads.push({ offset, length: available })
    return this.#data.subarray(offset, offset + available)
  }
}

const encodeLosslessJpegXl = async (
  format: PixelFormat,
  width: number,
  height: number,
  pixels: Uint8Array,
  container: boolean,
  options: Readonly<JpegXlEncodeOptions> = {},
  colorSemantics: PixelColorSemantics = jpegXlSemanticsFor(format),
): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: format,
    colorSemantics,
    options: { mode: 'lossless', effort: 1, container, ...options },
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('JPEG XL encoder is unavailable')
  const channels = format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3
  const rowBytes = width * channels * (format.endsWith('16') ? 2 : 1)
  await encoder.write({
    x: 0,
    y: 0,
    width,
    height,
    stride: rowBytes,
    format,
    data: pixels,
  })
  await encoder.finish()
  return sink.toUint8Array()
}

const decodeJpegXlPixels = async (
  input: Uint8Array,
): Promise<Readonly<{ format: PixelFormat; pixels: Uint8Array }>> => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
  if (!decoder) throw new Error('JPEG XL decoder is unavailable')
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const block of decoder.decode()) {
    chunks.push(block.data)
    length += block.data.byteLength
  }
  const pixels = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    pixels.set(chunk, offset)
    offset += chunk.byteLength
  }
  return Object.freeze({ format: decoder.pixelFormat, pixels })
}

const losslessEncoderFormats = [
  { format: 'gray8', channels: 1, bytesPerSample: 1, container: false },
  { format: 'gray16', channels: 1, bytesPerSample: 2, container: true },
  { format: 'rgb8', channels: 3, bytesPerSample: 1, container: false },
  { format: 'rgb16', channels: 3, bytesPerSample: 2, container: true },
  { format: 'rgba8', channels: 4, bytesPerSample: 1, container: false },
  { format: 'rgba16', channels: 4, bytesPerSample: 2, container: true },
] as const

const srgbSemantics = (alpha: PixelColorSemantics['alpha']): PixelColorSemantics =>
  Object.freeze({
    family: 'rgb',
    primaries: 'srgb',
    transfer: Object.freeze({ kind: 'srgb' }),
    matrix: 'identity',
    range: 'full',
    alpha,
    provenance: 'decoder-converted',
    renderingIntent: 'relative',
  })

const jpegXlSemanticsFor = (format: PixelFormat): PixelColorSemantics =>
  Object.freeze({
    ...srgbSemantics(format.startsWith('rgba') ? 'straight' : 'none'),
    family: format.startsWith('gray') ? 'gray' : 'rgb',
  })

const sourceCoordinate = (
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: number,
): readonly [number, number] => {
  if (orientation === 1) return [x, y]
  if (orientation === 2) return [width - 1 - x, y]
  if (orientation === 3) return [width - 1 - x, height - 1 - y]
  if (orientation === 4) return [x, height - 1 - y]
  if (orientation === 5) return [y, x]
  if (orientation === 6) return [y, height - 1 - x]
  if (orientation === 7) return [width - 1 - y, height - 1 - x]
  return [width - 1 - y, x]
}

class RecordingSink implements ImageSink {
  readonly abortReasons: unknown[] = []
  readonly chunkBytes: number[] = []
  writes = 0
  closes = 0
  failWrite = false

  async write(chunk: Uint8Array): Promise<void> {
    this.writes += 1
    this.chunkBytes.push(chunk.byteLength)
    if (this.failWrite) throw new Error('sink write failed')
  }

  async close(): Promise<void> {
    this.closes += 1
  }

  async abort(reason: unknown): Promise<void> {
    this.abortReasons.push(reason)
  }
}

describe('JPEG XL probing and lossless Modular decoding', () => {
  it('exposes a registered decoder for raw codestreams and containers', () => {
    expect(jpegxlCodec.format).toBe('jpegxl')
    expect(jpegxlCodec.mimeTypes).toEqual(['image/jxl'])
    expect(jpegxlCodec.createDecoder).toBeTypeOf('function')
    expect(jpegxlCodec.createEncoder).toBeTypeOf('function')
    expect(jpegxlCodec.encoderPixelFormats).toEqual([
      'gray8',
      'gray16',
      'rgb8',
      'rgb16',
      'rgba8',
      'rgba16',
    ])
    expect(jpegxlCodec.detect(Uint8Array.of(0xff, 0x0a))).toBe(true)
    expect(jpegxlCodec.detect(signature)).toBe(true)
    expect(jpegxlCodec.detect(Uint8Array.of(0xff, 0x0b))).toBe(false)
  })

  it.each(losslessEncoderFormats)(
    'round-trips deterministic $format samples through $container container output',
    async ({ format, channels, bytesPerSample, container }) => {
      const width = 7
      const height = 5
      const pixels = Uint8Array.from(
        { length: width * height * channels * bytesPerSample },
        (_, index) => (index * 37 + 11) & 255,
      )
      const first = await encodeLosslessJpegXl(format, width, height, pixels, container)
      const second = await encodeLosslessJpegXl(format, width, height, pixels, container)
      expect(first).toEqual(second)
      expect(await inspectJpegXlStructure(first)).toMatchObject({
        kind: container ? 'container' : 'raw-codestream',
        organization: container ? 'jxlc' : 'raw',
      })
      await expect(inspectJpegXl(first)).resolves.toMatchObject({
        width,
        height,
        bitDepth: bytesPerSample === 1 ? 8 : 16,
        encoding: 'modular',
        expectedPixelFormat: format,
      })
      const decoded = await decodeJpegXlPixels(first)
      expect(decoded.format).toBe(format)
      expect(decoded.pixels).toEqual(pixels)
    },
  )

  it.each([1, 3, 5, 7] as const)(
    'round-trips deterministic RGB8 samples at effort $s',
    async (effort) => {
      const width = 41
      const height = 29
      const pixels = Uint8Array.from({ length: width * height * 3 }, (_, index) => {
        const x = Math.floor(index / 3) % width
        const y = Math.floor(index / 3 / width)
        return (x * 11 + y * 7 + (index % 3) * 19) & 255
      })
      const first = await encodeLosslessJpegXl('rgb8', width, height, pixels, true, { effort })
      const second = await encodeLosslessJpegXl('rgb8', width, height, pixels, true, { effort })
      expect(first).toEqual(second)
      await expect(decodeJpegXlPixels(first)).resolves.toEqual({ format: 'rgb8', pixels })
    },
  )

  it.each([9, 10, 11, 12, 13, 14, 15] as const)(
    'preserves explicitly declared $s-bit RGB samples in rgb16 storage',
    async (sampleBitDepth) => {
      const width = 7
      const height = 5
      const maximum = 2 ** sampleBitDepth - 1
      const pixels = new Uint8Array(width * height * 6)
      for (let offset = 0; offset < pixels.byteLength; offset += 2) {
        const sample = (offset * 37 + 11) & maximum
        pixels[offset] = sample >>> 8
        pixels[offset + 1] = sample
      }
      const output = await encodeLosslessJpegXl('rgb16', width, height, pixels, false, {
        effort: 3,
        sampleBitDepth,
      })
      await expect(inspectJpegXl(output)).resolves.toMatchObject({ bitDepth: sampleBitDepth })
      await expect(decodeJpegXlPixels(output)).resolves.toEqual({ format: 'rgb16', pixels })
    },
  )

  it('preserves independent straight-alpha precision and reports managed peak bytes', async () => {
    const width = 9
    const height = 6
    const pixels = new Uint8Array(width * height * 8)
    for (let offset = 0; offset < pixels.byteLength; offset += 8) {
      for (let channel = 0; channel < 3; channel += 1) {
        const sample = (offset * 13 + channel * 71) & 4_095
        pixels[offset + channel * 2] = sample >>> 8
        pixels[offset + channel * 2 + 1] = sample
      }
      const alpha = (offset * 17 + 5) & 511
      pixels[offset + 6] = alpha >>> 8
      pixels[offset + 7] = alpha
    }
    const sink = new RecordingSink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width,
      height,
      pixelFormat: 'rgba16',
      colorSemantics: jpegXlSemanticsFor('rgba16'),
      options: { mode: 'lossless', effort: 7, sampleBitDepth: 12, alphaBitDepth: 9 },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error('JPEG XL encoder is unavailable')
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
    expect(sink.writes).toBeGreaterThan(1)
    expect('managedPeakBytes' in encoder ? encoder.managedPeakBytes : 0).toBeGreaterThan(0)
  })

  it('rejects samples outside an explicitly declared depth', async () => {
    await expect(
      encodeLosslessJpegXl('gray16', 1, 1, Uint8Array.of(0x04, 0x00), false, {
        effort: 3,
        sampleBitDepth: 10,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('encodes multiple Modular groups and decodes a cross-group crop exactly', async () => {
    const width = 1_100
    const height = 7
    const pixels = Uint8Array.from(
      { length: width * height },
      (_, index) => ((index % width) * 3 + Math.floor(index / width) * 5) & 255,
    )
    const output = await encodeLosslessJpegXl('gray8', width, height, pixels, false)
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(output), defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')
    const decoded: number[] = []
    for await (const block of decoder.decode({ x: 1_020, y: 2, width: 12, height: 3 })) {
      decoded.push(...block.data)
    }
    expect(decoded).toEqual(
      Array.from(
        { length: 12 * 3 },
        (_, index) => ((1_020 + (index % 12)) * 3 + (2 + Math.floor(index / 12)) * 5) & 255,
      ),
    )
  })

  it('rejects unsupported lossless encoder options and incomplete pixel input', async () => {
    await expect(
      jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
        width: 1,
        height: 1,
        pixelFormat: 'rgb8',
        colorSemantics: jpegXlSemanticsFor('rgb8'),
        options: { effort: 2 },
        limits: defaultImageLimits,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const encoder = await jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
      width: 2,
      height: 2,
      pixelFormat: 'gray8',
      colorSemantics: jpegXlSemanticsFor('gray8'),
      options: { mode: 'lossless' },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error('JPEG XL encoder is unavailable')
    await encoder.write({
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      stride: 2,
      format: 'gray8',
      data: Uint8Array.of(1, 2),
    })
    await expect(encoder.finish()).rejects.toMatchObject({ code: 'TRUNCATED_INPUT' })
  })

  it('accepts only the encoder color and alpha semantics it signals', async () => {
    const straight = srgbSemantics('straight')
    const { renderingIntent: _renderingIntent, ...withoutRenderingIntent } = straight
    expect(jpegxlCodec.acceptsColorSemantics?.(srgbSemantics('none'))).toBe(true)
    expect(jpegxlCodec.acceptsColorSemantics?.(straight)).toBe(true)
    expect(
      jpegxlCodec.acceptsColorSemantics?.({ ...straight, renderingIntent: 'perceptual' }),
    ).toBe(true)
    expect(
      jpegxlCodec.acceptsColorSemantics?.({ ...straight, renderingIntent: 'saturation' }),
    ).toBe(true)
    expect(jpegxlCodec.acceptsColorSemantics?.({ ...straight, renderingIntent: 'absolute' })).toBe(
      true,
    )
    expect(jpegxlCodec.acceptsColorSemantics?.(withoutRenderingIntent)).toBe(false)
    expect(
      jpegxlCodec.acceptsColorSemantics?.({
        ...straight,
        transfer: { kind: 'linear' },
      }),
    ).toBe(true)
    expect(jpegxlCodec.acceptsColorSemantics?.({ ...straight, primaries: 'display-p3' })).toBe(true)
    expect(
      jpegxlCodec.acceptsColorSemantics?.({
        ...straight,
        primaries: 'source-profile',
        transfer: { kind: 'source-profile' },
        provenance: 'icc',
        icc: { relevance: 'emitted-pixels' },
      }),
    ).toBe(false)
    expect(jpegxlCodec.acceptsColorSemantics?.({ ...straight, alpha: 'premultiplied' })).toBe(true)
    expect(jpegxlCodec.acceptsColorSemantics?.({ ...straight, family: 'unspecified' })).toBe(false)
    expect(jpegxlCodec.acceptsColorSemantics?.({ ...straight, primaries: 'unspecified' })).toBe(
      false,
    )
    expect(
      jpegxlCodec.acceptsColorSemantics?.({ ...straight, transfer: { kind: 'unspecified' } }),
    ).toBe(false)
    expect(jpegxlCodec.acceptsColorSemantics?.({ ...straight, range: 'unspecified' })).toBe(false)
    expect(jpegxlCodec.acceptsColorSemantics?.({ ...straight, range: 'limited' })).toBe(false)

    for (const renderingIntent of ['perceptual', 'saturation', 'absolute'] as const) {
      await expect(
        jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
          width: 1,
          height: 1,
          pixelFormat: 'rgb8',
          colorSemantics: { ...straight, alpha: 'none', renderingIntent },
          options: { mode: 'lossless' },
          limits: defaultImageLimits,
        }),
      ).resolves.toBeDefined()
    }

    await expect(
      jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
        width: 1,
        height: 1,
        pixelFormat: 'rgba8',
        colorSemantics: { ...straight, alpha: 'premultiplied' },
        options: { mode: 'lossless' },
        limits: defaultImageLimits,
      }),
    ).resolves.toBeDefined()

    await expect(
      jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
        width: 1,
        height: 1,
        pixelFormat: 'rgb8',
        options: { mode: 'lossless' },
        limits: defaultImageLimits,
      }),
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
      message: expect.stringContaining('explicit'),
    })
  })

  it('signals and applies every display orientation exactly once', async () => {
    const width = 3
    const height = 2
    const pixels = Uint8Array.of(
      10,
      11,
      12,
      20,
      21,
      22,
      30,
      31,
      32,
      40,
      41,
      42,
      50,
      51,
      52,
      60,
      61,
      62,
    )
    for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
      const encoded = await encodeLosslessJpegXl('rgb8', width, height, pixels, true, {
        orientation,
      })
      const inspection = await inspectJpegXl(encoded)
      expect(inspection).toMatchObject({
        width,
        height,
        displayWidth: orientation >= 5 ? height : width,
        displayHeight: orientation >= 5 ? width : height,
        orientation,
      })
      const output = PNG.sync.read(await (await Image.open(encoded)).autoOrient().png().toBuffer())
      expect([output.width, output.height]).toEqual([
        orientation >= 5 ? height : width,
        orientation >= 5 ? width : height,
      ])
      for (let y = 0; y < output.height; y += 1) {
        for (let x = 0; x < output.width; x += 1) {
          const [sourceX, sourceY] = sourceCoordinate(x, y, width, height, orientation)
          const source = (sourceY * width + sourceX) * 3
          const target = (y * output.width + x) * 4
          expect(Array.from(output.data.subarray(target, target + 3))).toEqual(
            Array.from(pixels.subarray(source, source + 3)),
          )
        }
      }
      const cropped = PNG.sync.read(
        await (await Image.open(encoded))
          .autoOrient()
          .crop({ x: 1, y: 1, width: 1, height: 1 })
          .resize({ width: 2, height: 2, fit: 'fill' })
          .png()
          .toBuffer(),
      )
      expect([cropped.width, cropped.height]).toEqual([2, 2])
      const expectedPixel = output.data.subarray((output.width + 1) * 4, (output.width + 1) * 4 + 4)
      for (let offset = 0; offset < cropped.data.length; offset += 4)
        expect(cropped.data.subarray(offset, offset + 4)).toEqual(expectedPixel)
    }
  })

  it('normalizes copied Exif orientation when applying codestream orientation', async () => {
    const original = await encodeLosslessJpegXl('rgb8', 3, 2, new Uint8Array(18).fill(80), true, {
      orientation: 6,
    })
    const exif = hexadecimal('4d4d002a00000008000101120003000000010006000000000000')
    const encoded = concatenate(original, box('Exif', concatenate(new Uint8Array(4), exif)))
    const png = await (await Image.open(encoded)).autoOrient().keepExif().png().toBuffer()
    expect(await (await Image.open(png)).metadata()).toMatchObject({
      width: 2,
      height: 3,
    })
    const preserved = await pngCodec.preservedMetadata?.(
      new MemorySource(png),
      defaultImageLimits,
      { exif: true, icc: false },
    )
    if (!preserved?.exif) throw new Error('Preserved Exif is missing')
    expect(exifOrientation(preserved.exif)).toBe(1)
    const second = await (await Image.open(png)).autoOrient().png().toBuffer()
    expect(PNG.sync.read(second).data).toEqual(PNG.sync.read(png).data)
  })

  it('round-trips structured color, rendering intent, and premultiplied alpha', async () => {
    const structuredCases = [
      { primaries: 'srgb', transfer: { kind: 'linear' }, renderingIntent: 'perceptual' },
      { primaries: 'display-p3', transfer: { kind: 'srgb' }, renderingIntent: 'relative' },
      { primaries: 'rec2020', transfer: { kind: 'pq' }, renderingIntent: 'saturation' },
      { primaries: 'rec2020', transfer: { kind: 'hlg' }, renderingIntent: 'absolute' },
    ] as const
    for (const color of structuredCases) {
      const semantics: PixelColorSemantics = Object.freeze({
        ...srgbSemantics('none'),
        ...color,
        transfer: Object.freeze(color.transfer),
      })
      const encoded = await encodeLosslessJpegXl(
        'rgb16',
        1,
        1,
        Uint8Array.of(0, 64, 1, 0, 3, 255),
        true,
        { sampleBitDepth: 10 },
        semantics,
      )
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(encoded),
        defaultImageLimits,
      )
      expect(decoder?.colorSemantics).toMatchObject({
        ...semantics,
        provenance: 'container-signaled',
      })
    }

    const premultiplied = Object.freeze({
      ...srgbSemantics('premultiplied'),
      alpha: 'premultiplied' as const,
    })
    const encoded = await encodeLosslessJpegXl(
      'rgba8',
      2,
      1,
      Uint8Array.of(50, 25, 10, 128, 9, 8, 7, 0),
      true,
      {},
      premultiplied,
    )
    const preserved = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded),
      defaultImageLimits,
      { alphaOutput: 'preserve' },
    )
    expect(preserved?.colorSemantics?.alpha).toBe('premultiplied')
    const straight = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded),
      defaultImageLimits,
      { alphaOutput: 'straight' },
    )
    if (!straight) throw new Error('JPEG XL straight-alpha decoder is unavailable')
    const blocks: number[] = []
    for await (const block of straight.decode()) blocks.push(...block.data)
    expect(blocks).toEqual([100, 50, 20, 128, 0, 0, 0, 0])
  })

  it('returns explicit linear float HDR output without clamping highlights', async () => {
    const semantics: PixelColorSemantics = Object.freeze({
      ...srgbSemantics('none'),
      primaries: 'rec2020',
      transfer: Object.freeze({ kind: 'pq' }),
    })
    const encoded = await encodeLosslessJpegXl(
      'rgb16',
      1,
      1,
      Uint8Array.of(3, 255, 2, 0, 0, 0),
      true,
      { sampleBitDepth: 10 },
      semantics,
    )
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded),
      defaultImageLimits,
      { hdrOutput: 'linear-float' },
    )
    expect(decoder?.pixelFormat).toBe('rgbf32')
    if (!decoder) throw new Error('JPEG XL HDR decoder is unavailable')
    const output: number[] = []
    for await (const block of decoder.decode()) {
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let offset = 0; offset < block.data.byteLength; offset += 4) {
        output.push(view.getFloat32(offset, false))
      }
    }
    expect(output[0]).toBeGreaterThan(40)
    expect(output[1]).toBeGreaterThan(0.4)
    expect(output[2]).toBe(0)
  })

  it('preserves bounded Exif, XMP, JUMBF, and brob metadata', async () => {
    const exif = hexadecimal('4d4d002a00000008000000000000')
    const xmp = ascii('<x:xmpmeta>m4</x:xmpmeta>')
    const jumbf = hexadecimal('000000086a756d64')
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: 1,
      height: 1,
      pixelFormat: 'rgb8',
      colorSemantics: jpegXlSemanticsFor('rgb8'),
      options: { mode: 'lossless', container: true },
      metadata: { exif, xmp, jumbf },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error('JPEG XL metadata encoder is unavailable')
    await encoder.write({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 3,
      format: 'rgb8',
      data: Uint8Array.of(1, 2, 3),
    })
    await encoder.finish()
    const encoded = sink.toUint8Array()
    const preserved = await jpegxlCodec.preservedMetadata?.(
      new MemorySource(encoded),
      defaultImageLimits,
      { exif: true, icc: true, xmp: true, jumbf: true },
    )
    expect(preserved).toEqual({ exif, xmp, jumbf })

    const brob = box(
      'brob',
      concatenate(ascii('Exif'), encodeBrotli(concatenate(Uint8Array.of(0, 0, 0, 0), exif))),
    )
    const compressed = concatenate(encoded, brob)
    await expect(
      jpegxlCodec.preservedMetadata?.(new MemorySource(compressed), defaultImageLimits, {
        exif: true,
        icc: false,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const withoutMetadata = await encodeLosslessJpegXl('rgb8', 1, 1, Uint8Array.of(1, 2, 3), true)
    const brobOnly = concatenate(withoutMetadata, brob)
    const compressedExif = await jpegxlCodec.preservedMetadata?.(
      new MemorySource(brobOnly),
      defaultImageLimits,
      { exif: true, icc: false },
    )
    expect(compressedExif?.exif).toEqual(exif)
  })

  it('decodes and validates the pinned embedded ICC profile exactly', async () => {
    const input = new Uint8Array(readFileSync('tests/fixtures/jpegxl/m4-color/oriented-icc.jxl'))
    const reference = new Uint8Array(
      readFileSync('tests/fixtures/jpegxl/m4-color/oriented-icc.icc'),
    )
    const inspection = await inspectJpegXl(input)
    expect(inspection).toMatchObject({
      orientation: 5,
      displayWidth: 606,
      displayHeight: 500,
      encodedColor: 'icc',
      icc: { present: true },
    })
    expect(inspection.icc.decodedBytes).toBeGreaterThan(128)
    const jpegXlMetadata = await jpegxlCodec.preservedMetadata?.(
      new MemorySource(input),
      defaultImageLimits,
      { exif: false, icc: true },
    )
    expect(jpegXlMetadata?.icc).toEqual(reference)
  })

  it('aborts encoder state and its sink deterministically', async () => {
    const sink = new RecordingSink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: 1,
      height: 1,
      pixelFormat: 'gray8',
      colorSemantics: jpegXlSemanticsFor('gray8'),
      options: { mode: 'lossless' },
      limits: defaultImageLimits,
    })
    if (!encoder?.abort) throw new Error('JPEG XL encoder abort is unavailable')
    const cause = new Error('caller cancelled')
    await encoder.abort(cause)
    await encoder.abort(new Error('later abort'))
    expect(sink.abortReasons).toEqual([cause])
    await expect(
      encoder.write({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        stride: 1,
        format: 'gray8',
        data: Uint8Array.of(1),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(encoder.finish()).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('aborts the encoder sink when output writing fails', async () => {
    const sink = new RecordingSink()
    sink.failWrite = true
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: 1,
      height: 1,
      pixelFormat: 'gray8',
      colorSemantics: jpegXlSemanticsFor('gray8'),
      options: { mode: 'lossless' },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error('JPEG XL encoder is unavailable')
    await encoder.write({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 1,
      format: 'gray8',
      data: Uint8Array.of(1),
    })
    await expect(encoder.finish()).rejects.toThrow('sink write failed')
    expect(sink.abortReasons).toHaveLength(1)
    expect(sink.abortReasons[0]).toMatchObject({ message: 'sink write failed' })
  })

  it('does not abort an encoder sink after successful completion', async () => {
    const sink = new RecordingSink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: 1,
      height: 1,
      pixelFormat: 'gray8',
      colorSemantics: jpegXlSemanticsFor('gray8'),
      options: { mode: 'lossless' },
      limits: defaultImageLimits,
    })
    if (!encoder?.abort) throw new Error('JPEG XL encoder abort is unavailable')
    await encoder.write({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 1,
      format: 'gray8',
      data: Uint8Array.of(1),
    })
    await encoder.finish()
    await encoder.abort(new Error('too late'))
    expect(sink.writes).toBeGreaterThan(1)
    expect(sink.abortReasons).toEqual([])
  })

  it('decodes the pinned 12-bit lossless RGBA conformance image exactly', async () => {
    const input = readFileSync('benchmark/fixtures/jpegxl/conformance-alpha-nonpremultiplied.jxl')
    const source = new MemorySource(input)
    const metadata = await jpegxlCodec.metadata(source, defaultImageLimits)
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')

    expect(metadata).toMatchObject({
      width: 1_024,
      height: 1_024,
      bitDepth: 12,
      hasAlpha: true,
      lossless: true,
      channelBitDepths: [12, 12, 12, 12],
    })
    expect(decoder.pixelFormat).toBe('rgba16')
    expect(decoder.capabilities).toEqual({
      sequential: true,
      regionDecode: true,
      scaledDecode: false,
      progressive: false,
    })

    const digest = createHash('sha256')
    let rows = 0
    for await (const block of decoder.decode()) {
      expect(block).toMatchObject({
        x: 0,
        y: rows,
        width: 1_024,
        height: 1,
        format: 'rgba16',
        displayRanges: [
          { black: 0, white: 4_095 },
          { black: 0, white: 4_095 },
          { black: 0, white: 4_095 },
          { black: 0, white: 4_095 },
        ],
      })
      digest.update(block.data)
      rows += 1
    }
    expect(rows).toBe(1_024)
    // Official conformance ref.png samples converted back to their native 12-bit range.
    expect(digest.digest('hex')).toBe(
      'dcad2498d282253d5a0cc6228a557663f83e5547e196d4da472c2658a89b26b9',
    )
  })

  it('preserves adaptive 9-bit Modular samples within the conformance tolerance', async () => {
    const input = readFileSync('benchmark/fixtures/jpegxl/conformance-alpha-triangles.jxl')
    const source = new MemorySource(input)
    const metadata = await jpegxlCodec.metadata(source, defaultImageLimits)
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')

    expect(metadata).toMatchObject({
      width: 1_024,
      height: 1_024,
      bitDepth: 9,
      hasAlpha: true,
      lossless: true,
      channelBitDepths: [9, 9, 9, 9],
    })

    const digest = createHash('sha256')
    for await (const block of decoder.decode()) {
      expect(block.format).toBe('rgba16')
      expect(block.displayRanges).toEqual([
        { black: 0, white: 511 },
        { black: 0, white: 511 },
        { black: 0, white: 511 },
        { black: 0, white: 511 },
      ])
      digest.update(block.data)
    }
    // Validated against the official 16-bit ref.png at the fixture's ±1/512 tolerance.
    expect(digest.digest('hex')).toBe(
      'f9eee8a5b5f1e9209a1a82e590fcab10518ad4feb4cd550d4394dcc53cb35422',
    )
  })

  it.each(grayscaleFixtures)(
    'preserves native $bitDepth-bit grayscale samples and display range',
    async (fixture) => {
      const source = new MemorySource(fixture.input)
      const metadata = await jpegxlCodec.metadata(source, defaultImageLimits)
      const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
      if (!decoder) throw new Error('JPEG XL decoder is unavailable')

      expect(metadata).toMatchObject({
        width: 5,
        height: 3,
        bitDepth: fixture.bitDepth,
        colorSpace: 'gray',
        components: 1,
        channels: 1,
        channelBitDepths: [fixture.bitDepth],
        hasAlpha: false,
      })
      expect(decoder.pixelFormat).toBe(fixture.format)

      const digest = createHash('sha256')
      let rows = 0
      for await (const block of decoder.decode()) {
        expect(block).toMatchObject({
          y: rows,
          width: 5,
          height: 1,
          format: fixture.format,
          displayRanges: [{ black: 0, white: fixture.maximum }],
        })
        digest.update(block.data)
        rows += 1
      }
      expect(rows).toBe(3)
      expect(digest.digest('hex')).toBe(fixture.digest)
    },
  )

  it('replicates grayscale only when an independently validated alpha channel requires RGBA', async () => {
    const source = new MemorySource(grayscaleAlpha)
    const metadata = await jpegxlCodec.metadata(source, defaultImageLimits)
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')

    expect(metadata).toMatchObject({
      width: 5,
      height: 3,
      bitDepth: 8,
      colorSpace: 'gray',
      components: 2,
      channels: 2,
      channelBitDepths: [8, 8],
      hasAlpha: true,
    })
    expect(decoder.pixelFormat).toBe('rgba8')
    const digest = createHash('sha256')
    for await (const block of decoder.decode()) digest.update(block.data)
    expect(digest.digest('hex')).toBe(
      '864631980c91530b3379a6e8224d902eab5559ccd7435ecd017ca43ce7f2b71a',
    )
  })

  it('decodes multi-group grayscale and crops across four group boundaries', async () => {
    expect(createHash('sha256').update(multiGroupGray).digest('hex')).toBe(
      '4a03e76bfe063b2829cd5597da5b0268421a996c61e807421337209885e72bd4',
    )
    const source = new MemorySource(multiGroupGray)
    const metadata = await jpegxlCodec.metadata(source, defaultImageLimits)
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')

    expect(metadata).toMatchObject({
      width: 600,
      height: 530,
      bitDepth: 8,
      colorSpace: 'gray',
      components: 1,
      channels: 1,
      lossless: true,
    })
    expect(decoder.capabilities).toMatchObject({ sequential: true, regionDecode: true })
    const fullDigest = createHash('sha256')
    let fullRows = 0
    for await (const block of decoder.decode()) {
      expect(block).toMatchObject({
        x: 0,
        y: fullRows,
        width: 600,
        height: 1,
        format: 'gray8',
      })
      fullDigest.update(block.data)
      fullRows += 1
    }
    expect(fullRows).toBe(530)
    expect(fullDigest.digest('hex')).toBe(
      '572ba5b45bb426ef5bfa9f295bb6ba1ca829a577d879eb3ed30da141b046c31a',
    )

    let cropRows = 0
    const cropDigest = createHash('sha256')
    for await (const block of decoder.decode({ x: 250, y: 252, width: 20, height: 16 })) {
      expect(block).toMatchObject({
        x: 0,
        y: cropRows,
        width: 20,
        height: 1,
        format: 'gray8',
      })
      for (let x = 0; x < block.width; x += 1) {
        expect(block.data[x]).toBe(((250 + x) * 3 + (252 + cropRows) * 5) & 255)
      }
      cropDigest.update(block.data)
      cropRows += 1
    }
    expect(cropRows).toBe(16)
    expect(cropDigest.digest('hex')).toBe(
      '06eecf33e3dbfa73b7f180a24d4da80e31ddb87a8f312e540a8dab544e59489d',
    )
  })

  it('uses the signed weighted-predictor error property in learned group trees', async () => {
    expect(createHash('sha256').update(adaptiveMultiGroupGray).digest('hex')).toBe(
      '327bfea984d854f18902c53d4414eb480d2cfbdf7eed34d736525280a55da52a',
    )
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(adaptiveMultiGroupGray),
      defaultImageLimits,
    )
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')

    const digest = createHash('sha256')
    let rows = 0
    for await (const block of decoder.decode()) {
      digest.update(block.data)
      rows += block.height
    }
    expect(rows).toBe(643)
    expect(digest.digest('hex')).toBe(
      'baef35d99d2f58c9015c2c4670ebf672e10e66e1dfdfb831eab973c3b3317cd6',
    )
  })

  it('decodes only intersecting groups from permuted table-of-contents entries', async () => {
    expect(createHash('sha256').update(permutedLargeGray).digest('hex')).toBe(
      '23452102d25d7f58ff75e59691966ccfbefb986997289613230fd2a1a64b0b65',
    )
    const source = new MemorySource(permutedLargeGray)
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')
    const digest = createHash('sha256')
    let rows = 0
    for await (const block of decoder.decode({ x: 2_030, y: 2_040, width: 31, height: 29 })) {
      expect(block).toMatchObject({
        x: 0,
        y: rows,
        width: 31,
        height: 1,
        format: 'gray8',
      })
      for (let x = 0; x < block.width; x += 1) {
        expect(block.data[x]).toBe(((2_030 + x) * 3 + (2_040 + rows) * 5) & 255)
      }
      digest.update(block.data)
      rows += 1
    }
    expect(rows).toBe(29)
    expect(digest.digest('hex')).toBe(
      '346cd47f0c13966591db85e1e8b3b45cf395d24cd1455d44c61eb2085be578c1',
    )
  })

  it('fetches only crop-intersecting Modular group sections after decoder creation', async () => {
    const source = new CountingSource(permutedLargeGray)
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')
    source.reads.length = 0

    let rows = 0
    for await (const block of decoder.decode({ x: 2_030, y: 2_040, width: 31, height: 29 })) {
      rows += block.height
    }

    expect(rows).toBe(29)
    expect(source.reads).toHaveLength(4)
    expect(source.reads.reduce((sum, read) => sum + read.length, 0)).toBeLessThan(source.size / 20)
  })

  it('decodes RGB local-tree ANS residuals, crop requests, and aborts', async () => {
    const source = new MemorySource(localTreeRgb)
    const metadata = await jpegxlCodec.metadata(source, defaultImageLimits)
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')

    expect(metadata).toMatchObject({
      width: 8,
      height: 5,
      bitDepth: 8,
      hasAlpha: false,
      components: 3,
      channels: 3,
      channelBitDepths: [8, 8, 8],
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
    })
    expect(decoder.colorSemantics).toEqual(metadata.colorSemantics)
    const digest = createHash('sha256')
    for await (const block of decoder.decode()) digest.update(block.data)
    expect(digest.digest('hex')).toBe(
      'afa150de7f85974c5a5e512f543555aa521c538ddaf0a4f9da9e210173789a1b',
    )

    const cropped: number[] = []
    for await (const block of decoder.decode({ x: 2, y: 1, width: 3, height: 2 })) {
      cropped.push(...block.data)
    }
    expect(cropped).toEqual([
      43, 43, 65, 60, 50, 96, 77, 57, 127, 52, 72, 68, 69, 79, 99, 86, 86, 130,
    ])

    const controller = new AbortController()
    controller.abort()
    await expect(
      decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]().next(),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('accounts for compact Modular working planes before decoding', async () => {
    await expect(
      jpegxlCodec.metadata(new MemorySource(localTreeRgb), {
        ...defaultImageLimits,
        maxDecodedBytes: 8 * 5 * 3 * 4 - 1,
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('decodes the implemented subset directly from a jxlc container', async () => {
    const codestream = readFileSync(
      'benchmark/fixtures/jpegxl/conformance-alpha-nonpremultiplied.jxl',
    )
    const input = concatenate(signature, fileType(), box('jxlc', codestream))
    const metadata = await jpegxlCodec.metadata(new MemorySource(input), defaultImageLimits)

    expect(metadata).toMatchObject({ width: 1_024, height: 1_024, bitDepth: 12 })
  })

  it('identifies a raw codestream without parsing image metadata', async () => {
    const structure = await inspectJpegXlStructure(Uint8Array.of(0xff, 0x0a, 1, 2, 3))
    expect(structure).toEqual({
      kind: 'raw-codestream',
      organization: 'raw',
      containerVersion: undefined,
      level: undefined,
      codestreamBytes: 5,
      codestreamSegments: [{ offset: 0, length: 5, index: 0 }],
      boxes: [],
      metadataBoxes: [],
    })
  })

  it('validates a jxlc container and indexes metadata without reading its payload', async () => {
    const input = concatenate(
      signature,
      fileType(),
      box('Exif', Uint8Array.of(1, 2, 3), true),
      box('jxlc', Uint8Array.of(0xff, 0x0a, 4, 5)),
    )
    const structure = await inspectJpegXlStructure(input)
    expect(structure.kind).toBe('container')
    expect(structure.codestreamBytes).toBe(4)
    expect(structure.codestreamSegments).toHaveLength(1)
    expect(structure.metadataBoxes).toEqual([expect.objectContaining({ type: 'Exif', length: 19 })])
  })

  it('indexes ordered jxlp fragments without concatenating them', async () => {
    const input = concatenate(
      signature,
      fileType(),
      fragment(0, false, Uint8Array.of(0xff, 0x0a, 1)),
      fragment(1, true, Uint8Array.of(2, 3, 4)),
    )
    const structure = await inspectJpegXlStructure(input)
    expect(structure.codestreamBytes).toBe(6)
    expect(structure.organization).toBe('jxlp')
    expect(structure.codestreamSegments.map(({ index, length }) => ({ index, length }))).toEqual([
      { index: 0, length: 3 },
      { index: 1, length: 3 },
    ])
  })

  it('decodes an implemented Modular codestream across ordered jxlp fragments', async () => {
    const split = 37
    const input = concatenate(
      signature,
      fileType(),
      box('jxll', Uint8Array.of(5)),
      fragment(0, false, localTreeRgb.subarray(0, split)),
      fragment(1, true, localTreeRgb.subarray(split)),
    )
    const source = new MemorySource(input)
    const structure = await inspectJpegXlStructure(source)
    expect(structure).toMatchObject({
      kind: 'container',
      organization: 'jxlp',
      level: 5,
      codestreamBytes: localTreeRgb.byteLength,
    })

    const metadata = await jpegxlCodec.metadata(source, defaultImageLimits)
    expect(metadata).toMatchObject({ width: 8, height: 5, bitDepth: 8 })
    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')
    const digest = createHash('sha256')
    for await (const block of decoder.decode()) digest.update(block.data)
    expect(digest.digest('hex')).toBe(
      'afa150de7f85974c5a5e512f543555aa521c538ddaf0a4f9da9e210173789a1b',
    )
  })

  it('reorders version 1 jxlp fragments by logical index before decode', async () => {
    const split = 37
    const input = concatenate(
      signature,
      fileType('jxl ', 1),
      fragment(1, true, localTreeRgb.subarray(split)),
      fragment(0, false, localTreeRgb.subarray(0, split)),
    )
    const source = new MemorySource(input)
    const structure = await inspectJpegXlStructure(source)
    expect(structure).toMatchObject({
      organization: 'jxlp',
      containerVersion: 1,
      codestreamSegments: [{ index: 0 }, { index: 1 }],
    })

    const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits)
    if (!decoder) throw new Error('JPEG XL decoder is unavailable')
    const digest = createHash('sha256')
    for await (const block of decoder.decode()) digest.update(block.data)
    expect(digest.digest('hex')).toBe(
      'afa150de7f85974c5a5e512f543555aa521c538ddaf0a4f9da9e210173789a1b',
    )
  })

  it('inspects implemented metadata without reading a complete large codestream', async () => {
    const padded = new Uint8Array(1_048_576)
    padded.set(localTreeRgb)
    const source = new CountingSource(padded)
    const inspection = await inspectJpegXl(source)

    expect(inspection).toMatchObject({
      kind: 'raw-codestream',
      organization: 'raw',
      width: 8,
      height: 5,
      displayWidth: 8,
      displayHeight: 5,
      orientation: 1,
      bitDepth: 8,
      colorChannels: 3,
      extraChannels: 0,
      alpha: 'none',
      encoding: 'modular',
      imageKind: 'static',
      expectedPixelFormat: 'rgb8',
      jpegReconstruction: 'unavailable',
    })
    const returnedBytes = source.reads.reduce((sum, read) => sum + read.length, 0)
    expect(returnedBytes).toBeLessThan(source.size)
    expect(Math.max(...source.reads.map(({ length }) => length))).toBeLessThan(source.size)
  })

  it('rejects lookalikes, invalid brands, malformed extents, and missing codestreams', async () => {
    const lookalike = signature.slice()
    lookalike[8] = 0
    await expect(inspectJpegXlStructure(lookalike)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(
      inspectJpegXlStructure(
        concatenate(
          signature,
          box('ftyp', concatenate(ascii('fake'), Uint8Array.of(0, 0, 0, 0))),
          box('jxlc', Uint8Array.of(0xff, 0x0a)),
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    const badExtent = concatenate(signature, fileType(), box('jxlc', Uint8Array.of(0xff, 0x0a)))
    new DataView(badExtent.buffer).setUint32(signature.byteLength + fileType().byteLength, 1_000)
    await expect(inspectJpegXlStructure(badExtent)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
    await expect(inspectJpegXlStructure(concatenate(signature, fileType()))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('rejects conflicting and malformed codestream representations', async () => {
    await expect(
      inspectJpegXlStructure(
        concatenate(signature, fileType(), fileType(), box('jxlc', Uint8Array.of(0xff, 0x0a))),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      inspectJpegXlStructure(
        concatenate(
          signature,
          fileType(),
          box('jxlc', Uint8Array.of(0xff, 0x0a)),
          fragment(0, true, Uint8Array.of(0xff, 0x0a)),
        ),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      inspectJpegXlStructure(
        concatenate(signature, fileType(), fragment(1, true, Uint8Array.of(0xff, 0x0a))),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      inspectJpegXlStructure(
        concatenate(signature, fileType(), fragment(0, false, Uint8Array.of(0xff, 0x0a))),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(
      inspectJpegXlStructure(
        concatenate(signature, fileType(), box('jxlc', Uint8Array.of(0, 0, 0))),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
})
