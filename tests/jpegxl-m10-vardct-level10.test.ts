import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import type { PixelColorSemantics } from '../src/color.ts'
import { encodeJpegXlAnimation, inspectJpegXl, openJpegXlSequence } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import type { PixelFormat } from '../src/pixel.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'

const rgb: PixelColorSemantics = {
  family: 'rgb',
  primaries: 'srgb',
  transfer: { kind: 'srgb' },
  matrix: 'identity',
  range: 'full',
  alpha: 'none',
  provenance: 'assumed-default',
  renderingIntent: 'relative',
}

const encode = async (
  width: number,
  height: number,
  format: PixelFormat,
  data: Uint8Array,
  options: Readonly<Record<string, unknown>>,
): Promise<Uint8Array> => {
  const sink = new Uint8ArraySink()
  const encoder = await jpegxlCodec.createEncoder?.(sink, {
    width,
    height,
    pixelFormat: format,
    colorSemantics: format.startsWith('rgba') ? { ...rgb, alpha: 'straight' } : rgb,
    options,
    limits: defaultImageLimits,
  })
  if (!encoder) throw new Error('Missing JPEG XL encoder')
  const channels = format.startsWith('rgba') ? 4 : 3
  const stride = width * channels * (format.endsWith('16') ? 2 : 1)
  await encoder.write({ x: 0, y: 0, width, height, stride, format, data })
  await encoder.finish()
  return sink.toUint8Array()
}

describe('JPEG XL general Level 10 VarDCT encoding', () => {
  it('emits explicitly requested progressive multi-group VarDCT in a jxll=10 container', async () => {
    const width = 1_025,
      height = 9
    const pixels = Uint8Array.from({ length: width * height * 3 }, (_, index) => {
      const pixel = Math.floor(index / 3)
      return (pixel % width) * 17 + Math.floor(pixel / width) * 29 + (index % 3) * 41
    })
    const encoded = await encode(width, height, 'rgb8', pixels, {
      mode: 'lossy',
      distance: 1,
      effort: 7,
      progressive: true,
      codestreamLevel: 10,
    })
    await expect(inspectJpegXl(encoded)).resolves.toMatchObject({
      kind: 'container',
      organization: 'jxlc',
      level: 10,
      width,
      height,
    })
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    if (!decoder) throw new Error('Missing JPEG XL decoder')
    let rows = 0
    for await (const block of decoder.decode()) {
      expect(block.format).toBe('rgb8')
      rows += block.height
      block.release?.()
    }
    expect(rows).toBe(height)
  })

  it('automatically selects Level 10 for exact 16-bit Modular alpha', async () => {
    const width = 17,
      height = 13,
      pixels = new Uint8Array(width * height * 8),
      view = new DataView(pixels.buffer)
    for (let pixel = 0; pixel < width * height; pixel++) {
      for (let channel = 0; channel < 3; channel++)
        view.setUint16(pixel * 8 + channel * 2, 128, false)
      view.setUint16(pixel * 8 + 6, pixel * 297, false)
    }
    const encoded = await encode(width, height, 'rgba16', pixels, {
      mode: 'lossy',
      distance: 0.25,
      sampleBitDepth: 8,
      alphaBitDepth: 16,
    })
    await expect(inspectJpegXl(encoded)).resolves.toMatchObject({
      kind: 'container',
      level: 10,
      bitDepth: 8,
    })
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits)
    if (!decoder) throw new Error('Missing JPEG XL decoder')
    for await (const block of decoder.decode()) {
      const actual = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let y = 0; y < block.height; y++)
        for (let x = 0; x < width; x++) {
          const target = y * block.stride + x * 8 + 6
          const source = ((block.y + y) * width + x) * 8 + 6
          expect(actual.getUint16(target, false)).toBe(view.getUint16(source, false))
        }
      block.release?.()
    }
  })

  it('keeps Level 5 for 16-bit VarDCT color without high-depth alpha', async () => {
    const encoded = await encode(9, 7, 'rgb16', new Uint8Array(9 * 7 * 6), {
      mode: 'lossy',
      sampleBitDepth: 16,
      codestreamLevel: 'auto',
    })
    await expect(inspectJpegXl(encoded)).resolves.toMatchObject({
      kind: 'container',
      bitDepth: 16,
    })
    expect((await inspectJpegXl(encoded)).level).toBeUndefined()
  })

  it('selects Level 10 above the Level 5 dimension limit when the caller admits it', async () => {
    const width = 262_145,
      sink = new Uint8ArraySink(),
      limits = { ...defaultImageLimits, maxWidth: width }
    const request = {
      width,
      height: 1,
      pixelFormat: 'gray8' as const,
      colorSemantics: { ...rgb, family: 'gray' as const },
      limits,
    }
    await expect(
      jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
        ...request,
        options: { mode: 'lossy', effort: 1, codestreamLevel: 5 },
      }),
    ).rejects.toThrow(/requires codestream Level 10/)
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      ...request,
      options: { mode: 'lossy', effort: 1 },
    })
    if (!encoder) throw new Error('Missing JPEG XL encoder')
    const pixels = new Uint8Array(width)
    await encoder.write({
      x: 0,
      y: 0,
      width,
      height: 1,
      stride: width,
      format: 'gray8',
      data: pixels,
    })
    await encoder.finish()
    await expect(inspectJpegXl(sink.toUint8Array(), { limits })).resolves.toMatchObject({
      kind: 'container',
      level: 10,
      width,
      height: 1,
    })
  })

  it('streams high-depth-alpha VarDCT animation in a Level 10 container', async () => {
    const pixels = new Uint8Array(16),
      view = new DataView(pixels.buffer)
    for (let pixel = 0; pixel < 2; pixel++) {
      for (let channel = 0; channel < 3; channel++)
        view.setUint16(pixel * 8 + channel * 2, pixel ? 255 : 0, false)
      view.setUint16(pixel * 8 + 6, pixel ? 65_535 : 0, false)
    }
    async function* frames() {
      yield { width: 2, height: 1, data: pixels, durationTicks: 1 }
    }
    const chunks: Uint8Array[] = []
    let size = 0
    for await (const chunk of encodeJpegXlAnimation(frames(), {
      width: 2,
      height: 1,
      pixelFormat: 'rgba16',
      colorSemantics: { ...rgb, alpha: 'straight' },
      animation: {
        ticksPerSecondNumerator: 24,
        ticksPerSecondDenominator: 1,
        loops: 0,
        haveTimecodes: false,
      },
      encoding: { mode: 'lossy', sampleBitDepth: 8, alphaBitDepth: 16 },
    })) {
      chunks.push(chunk)
      size += chunk.length
    }
    const encoded = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      encoded.set(chunk, offset)
      offset += chunk.length
    }
    await expect(inspectJpegXl(encoded)).resolves.toMatchObject({
      kind: 'container',
      organization: 'jxlc',
      level: 10,
    })
    const sequence = await openJpegXlSequence(encoded)
    try {
      const frame = await sequence.frame(0)
      expect(frame.header.alphaBitDepth).toBe(16)
      expect(Array.from(frame.planes[3] ?? [])).toEqual([0, 1])
    } finally {
      await sequence.close()
    }
  })

  it('rejects explicit Level 5 and raw-output conflicts', async () => {
    const request = {
      width: 1,
      height: 1,
      pixelFormat: 'rgba16' as const,
      colorSemantics: { ...rgb, alpha: 'straight' as const },
      limits: defaultImageLimits,
    }
    await expect(
      jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
        ...request,
        options: { mode: 'lossy', sampleBitDepth: 8, alphaBitDepth: 16, codestreamLevel: 5 },
      }),
    ).rejects.toThrow(/requires codestream Level 10/)
    await expect(
      jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
        ...request,
        options: { mode: 'lossy', sampleBitDepth: 8, alphaBitDepth: 16, container: false },
      }),
    ).rejects.toThrow(/Level 10 requires container/)
    await expect(
      jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
        ...request,
        options: {
          mode: 'lossy',
          sampleBitDepth: 8,
          alphaBitDepth: 8,
          codestreamLevel: 10,
          container: false,
        },
      }),
    ).rejects.toThrow(/Level 10 requires container/)
  })
})
