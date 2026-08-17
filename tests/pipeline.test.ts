import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { selectDecodeScaleDenominator } from '../src/executor.ts'
import {
  createImageLibrary,
  type DecodeRequest,
  type ImageCodec,
  type PixelBlock,
  type PixelFormat,
} from '../src/index.ts'
import { jpegFixture, pngFixture } from './fixtures.ts'
import { Image } from './image-library.ts'

describe('immutable image pipelines', () => {
  it('selects the closest safe JPEG decode scale for common large-image outputs', () => {
    const region = { x: 0, y: 0, width: 6000, height: 4000 }
    expect(
      selectDecodeScaleDenominator(6000, 4000, region, [{ type: 'resize', width: 200 }], true),
    ).toBe(8)
    expect(
      selectDecodeScaleDenominator(6000, 4000, region, [{ type: 'resize', width: 800 }], true),
    ).toBe(4)
    expect(
      selectDecodeScaleDenominator(6000, 4000, region, [{ type: 'resize', width: 1200 }], true),
    ).toBe(4)
    expect(
      selectDecodeScaleDenominator(
        6000,
        4000,
        { x: 1001, y: 501, width: 3999, height: 2999 },
        [{ type: 'resize', width: 200 }],
        true,
      ),
    ).toBe(8)
    expect(
      selectDecodeScaleDenominator(
        6000,
        4000,
        { x: 333, y: 0, width: 5334, height: 4000 },
        [{ type: 'resize', width: 1200, height: 900 }],
        true,
      ),
    ).toBe(4)
    expect(
      selectDecodeScaleDenominator(
        6000,
        4000,
        { x: 1000, y: 500, width: 4000, height: 3000 },
        [{ type: 'resize', width: 200 }],
        true,
      ),
    ).toBe(8)
  })

  it('keeps northstar crop-resize samples after aligned scaled JPEG decode', async () => {
    const fixture = 'benchmark/corpus/files/old-faithful-6000x4000.jpg'
    if (!existsSync(fixture)) return
    const encoded = await (await Image.open(await readFile(fixture)))
      .autoOrient()
      .crop({ x: 333, y: 0, width: 5334, height: 4000 })
      .resize({ width: 1200, height: 900 })
      .jpeg({ quality: 80 })
      .toBuffer()
    const decoded = await (await Image.open(encoded)).png({ compressionLevel: 0 }).toBuffer()
    const pixels = PNG.sync.read(decoded).data
    const sample = (x: number, y: number): readonly [number, number, number] => {
      const offset = (y * 1200 + x) * 4
      return [pixels[offset] ?? -1, pixels[offset + 1] ?? -1, pixels[offset + 2] ?? -1]
    }
    const within = (
      actual: readonly [number, number, number],
      expected: readonly [number, number, number],
      tolerance: number,
    ): boolean =>
      actual.every((value, index) => Math.abs(value - (expected[index] ?? 0)) <= tolerance)
    expect(within(sample(0, 0), [148, 173, 207], 8)).toBe(true)
    expect(within(sample(300, 225), [187, 190, 195], 8)).toBe(true)
    expect(within(sample(600, 450), [228, 225, 222], 8)).toBe(true)
  })

  it('plans orientation, crop, resize, and encoding without mutating the source image', async () => {
    const source = await Image.open(jpegFixture(120, 80, 6))
    const output = source
      .autoOrient()
      .crop({ x: 10, y: 20, width: 40, height: 60 })
      .resize({ width: 20 })
      .encode('png', { compressionLevel: 6 })

    await expect(source.metadata()).resolves.toMatchObject({
      width: 120,
      height: 80,
      orientation: 6,
      format: 'jpeg',
    })
    await expect(output.metadata()).resolves.toMatchObject({
      width: 20,
      height: 30,
      orientation: 1,
      format: 'png',
      mimeType: 'image/png',
    })
  })

  it('reports exact contain geometry and preserves source alpha', async () => {
    const image = await Image.open(pngFixture(120, 40))
    const output = image
      .resize({
        width: 256,
        height: 256,
        fit: 'contain',
        position: 'center',
        background: 'transparent',
      })
      .png({ compressionLevel: 6 })

    await expect(output.metadata()).resolves.toMatchObject({
      width: 256,
      height: 256,
      format: 'png',
      hasAlpha: true,
    })
  })

  it('reports alpha introduced by a transparent contain canvas', async () => {
    const image = await Image.open(pngFixture(120, 40, 0))

    await expect(
      image.resize({ width: 256, height: 256, fit: 'contain' }).png().metadata(),
    ).resolves.toMatchObject({ width: 256, height: 256, hasAlpha: true })
  })

  it('honors withoutEnlargement for single-dimension resize', async () => {
    const image = await Image.open(pngFixture(100, 50))

    await expect(
      image.resize({ width: 200, withoutEnlargement: true }).metadata(),
    ).resolves.toMatchObject({
      width: 100,
      height: 50,
    })
  })

  it('validates operation options and lazy crop bounds', async () => {
    const image = await Image.open(pngFixture(100, 50))

    expect(() => image.jpeg({ quality: 101 })).toThrow('JPEG quality')
    expect(() => image.resize({ width: 10, background: '#ffffff' })).toThrow(
      'require both width and height',
    )
    await expect(
      image.crop({ x: 90, y: 0, width: 20, height: 10 }).metadata(),
    ).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('fails explicitly when an unimplemented codec is requested', async () => {
    const metadataOnlyCodec: ImageCodec = {
      format: 'metadata-only',
      mimeTypes: ['image/metadata-only'],
      minimumBytes: 1,
      detect: (header) => header[0] === 42,
      metadata: async () => ({
        width: 10,
        height: 10,
        format: 'metadata-only',
        mimeType: 'image/metadata-only',
        hasAlpha: false,
      }),
    }
    const image = await createImageLibrary([metadataOnlyCodec]).open(Uint8Array.of(42))

    await expect(image.resize({ width: 5 }).png().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })

  it('releases decoder pixel blocks after a direct encode', async () => {
    let released = 0
    const pixels = Uint8Array.of(10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120)
    const codec: ImageCodec = {
      format: 'release-fixture',
      mimeTypes: ['image/x-release-fixture'],
      minimumBytes: 1,
      detect: (header) => header[0] === 0x52,
      metadata: async () => ({
        width: 2,
        height: 2,
        format: 'release-fixture',
        mimeType: 'image/x-release-fixture',
        hasAlpha: false,
      }),
      createDecoder: async () => ({
        width: 2,
        height: 2,
        pixelFormat: 'rgb8',
        capabilities: {
          sequential: true,
          regionDecode: true,
          scaledDecode: false,
          progressive: false,
        },
        async *decode(): AsyncGenerator<PixelBlock> {
          yield {
            x: 0,
            y: 0,
            width: 2,
            height: 2,
            stride: 6,
            format: 'rgb8',
            data: pixels,
            release: () => {
              released += 1
            },
          }
        },
      }),
      createEncoder: async () => ({
        async write(): Promise<void> {},
        async finish(): Promise<void> {},
      }),
    }
    const image = await createImageLibrary([codec]).open(Uint8Array.of(0x52))
    await image.toBuffer()
    expect(released).toBe(1)
  })

  it('applies an explicit grayscale window before a color LUT', async () => {
    const captured: PixelBlock[] = []
    const codec: ImageCodec = {
      format: 'window-fixture',
      mimeTypes: ['image/x-window-fixture'],
      minimumBytes: 1,
      detect: (header) => header[0] === 0x57,
      metadata: async () => ({
        width: 3,
        height: 1,
        format: 'window-fixture',
        mimeType: 'image/x-window-fixture',
        hasAlpha: false,
        bitDepth: 16,
        sampleFormat: 'unsigned-integer',
      }),
      createDecoder: async () => ({
        width: 3,
        height: 1,
        pixelFormat: 'gray16',
        capabilities: {
          sequential: true,
          regionDecode: true,
          scaledDecode: false,
          progressive: false,
        },
        async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
          request.signal?.throwIfAborted()
          yield {
            x: 0,
            y: 0,
            width: 3,
            height: 1,
            stride: 6,
            format: 'gray16',
            data: Uint8Array.of(0, 0, 8, 0, 15, 255),
          }
        },
      }),
      createEncoder: async (_sink, request) => ({
        async write(block): Promise<void> {
          captured.push({ ...block, data: block.data.slice() })
        },
        async finish(): Promise<void> {
          expect(request.pixelFormat).toBe('rgb8')
        },
      }),
    }
    const table = new Uint8Array(256 * 3)
    for (let value = 0; value < 256; value += 1) {
      table[value * 3] = value
      table[value * 3 + 1] = 255 - value
      table[value * 3 + 2] = value >>> 1
    }
    const image = await createImageLibrary([codec]).open(Uint8Array.of(0x57))

    await image.window({ center: 2047.5, width: 4095 }).lut({ table, format: 'rgb8' }).toBuffer()

    expect(captured).toHaveLength(1)
    expect(captured[0]?.format).toBe('rgb8')
    expect(Array.from(captured[0]?.data ?? [])).toEqual([0, 255, 0, 128, 127, 64, 255, 0, 127])
    await expect(
      image.window({ center: 2047.5, width: 4095 }).lut({ table, format: 'rgb8' }).metadata(),
    ).resolves.toMatchObject({
      bitDepth: 8,
      sampleFormat: 'unsigned-integer',
      channels: 3,
      hasAlpha: false,
      colorSpace: 'sRGB',
    })
  })

  it('applies independent channel lookup tables to RGBA pixels', async () => {
    const captured: PixelBlock[] = []
    const codec: ImageCodec = {
      format: 'rgba-lut-fixture',
      mimeTypes: ['image/x-rgba-lut-fixture'],
      minimumBytes: 1,
      detect: (header) => header[0] === 0x52,
      metadata: async () => ({
        width: 2,
        height: 1,
        format: 'rgba-lut-fixture',
        mimeType: 'image/x-rgba-lut-fixture',
        hasAlpha: true,
        bitDepth: 8,
      }),
      createDecoder: async () => ({
        width: 2,
        height: 1,
        pixelFormat: 'rgba8',
        capabilities: {
          sequential: true,
          regionDecode: true,
          scaledDecode: false,
          progressive: false,
        },
        async *decode(): AsyncGenerator<PixelBlock> {
          yield {
            x: 0,
            y: 0,
            width: 2,
            height: 1,
            stride: 8,
            format: 'rgba8',
            data: Uint8Array.of(10, 20, 30, 40, 255, 128, 0, 64),
          }
        },
      }),
      createEncoder: async () => ({
        async write(block): Promise<void> {
          captured.push({ ...block, data: block.data.slice() })
        },
        async finish(): Promise<void> {},
      }),
    }
    const table = new Uint8Array(256 * 4)
    for (let value = 0; value < 256; value += 1) {
      table[value * 4] = 255 - value
      table[value * 4 + 1] = value >>> 1
      table[value * 4 + 2] = value
      table[value * 4 + 3] = 255 - value
    }

    await (await createImageLibrary([codec]).open(Uint8Array.of(0x52)))
      .lut({ table, format: 'rgba8' })
      .toBuffer()

    expect(captured).toHaveLength(1)
    expect(captured[0]?.format).toBe('rgba8')
    expect(Array.from(captured[0]?.data ?? [])).toEqual([245, 10, 30, 215, 0, 64, 0, 191])
  })

  it('stops a pipeline between decoded blocks when its signal aborts', async () => {
    const controller = new AbortController()
    let decoderSignal: AbortSignal | undefined
    let writes = 0
    let encoderAborted = false
    const pixel = (value: number): PixelBlock => ({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 1,
      format: 'gray8' satisfies PixelFormat,
      data: Uint8Array.of(value),
    })
    const codec: ImageCodec = {
      format: 'abort-fixture',
      mimeTypes: ['image/x-abort-fixture'],
      minimumBytes: 1,
      detect: (header) => header[0] === 0x41,
      metadata: async () => ({
        width: 1,
        height: 2,
        format: 'abort-fixture',
        mimeType: 'image/x-abort-fixture',
        hasAlpha: false,
      }),
      createDecoder: async () => ({
        width: 1,
        height: 2,
        pixelFormat: 'gray8',
        capabilities: {
          sequential: true,
          regionDecode: true,
          scaledDecode: false,
          progressive: false,
        },
        async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
          decoderSignal = request.signal
          yield pixel(1)
          request.signal?.throwIfAborted()
          yield pixel(2)
        },
      }),
      createEncoder: async () => ({
        async write(): Promise<void> {
          writes += 1
          controller.abort()
        },
        async finish(): Promise<void> {},
        async abort(): Promise<void> {
          encoderAborted = true
        },
      }),
    }
    const image = await createImageLibrary([codec]).open(Uint8Array.of(0x41))

    await expect(image.toBuffer({ signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(decoderSignal).toBe(controller.signal)
    expect(writes).toBe(1)
    expect(encoderAborted).toBe(true)
  })
})
