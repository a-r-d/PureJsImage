import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import type { ImageDecoder } from '../src/codec.ts'
import { ColorManagedDecoder, parseRgbIccTransform } from '../src/codecs/icc.ts'
import { decodeJpegXlIccCommands } from '../src/codecs/jpegxl-icc.ts'
import { inspectJpegXl } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { MemorySource } from '../src/source.ts'
import { pixelStorage, normalizePixelBlocks } from '../src/pixel.ts'
import { convertPixelBlocks } from '../src/convert.ts'
import alphaManifest from './fixtures/jpegxl/m4-color/alpha-manifest.json' with { type: 'json' }
import manifest from './fixtures/jpegxl/m4-color/manifest.json' with { type: 'json' }
import vardctManifest from './fixtures/jpegxl/m4-color/vardct-manifest.json' with { type: 'json' }
import vardctAlphaManifest from './fixtures/jpegxl/m4-color/vardct-alpha-manifest.json' with {
  type: 'json',
}
import { summarizeJpegXlExif } from '../src/codecs/jpegxl-exif.ts'

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(`tests/fixtures/jpegxl/m4-color/${name}`))

describe('JPEG XL M4 independently validated color', () => {
  for (const renderingIntent of ['perceptual', 'relative', 'saturation', 'absolute'] as const) {
    it(`preserves ${renderingIntent} intent, intrinsic size, and tone mapping`, async () => {
      const sink = new Uint8ArraySink()
      const toneMapping = {
        intensityTarget: 1000,
        minNits: 0.5,
        relativeToMaxDisplay: true,
        linearBelow: 0.25,
      }
      const encoder = await jpegxlCodec.createEncoder?.(sink, {
        width: 1,
        height: 1,
        pixelFormat: 'rgb8',
        colorSemantics: {
          family: 'rgb',
          primaries: 'rec2020',
          transfer: { kind: 'pq' },
          matrix: 'identity',
          range: 'full',
          alpha: 'none',
          provenance: 'container-signaled',
          renderingIntent,
        },
        options: { mode: 'lossless', toneMapping, intrinsicSize: { width: 12, height: 8 } },
        limits: defaultImageLimits,
      })
      if (!encoder) throw new Error('Encoder unavailable')
      await encoder.write({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        stride: 3,
        format: 'rgb8',
        data: Uint8Array.of(2, 3, 4),
      })
      await encoder.finish()
      expect(await inspectJpegXl(sink.toUint8Array())).toMatchObject({
        renderingIntent,
        intrinsicWidth: 12,
        intrinsicHeight: 8,
        toneMapping,
      })
      expect(
        await jpegxlCodec.metadata(new MemorySource(sink.toUint8Array()), defaultImageLimits),
      ).toMatchObject({ intrinsicWidth: 12, intrinsicHeight: 8 })
    })
  }
  for (const definition of [...vardctManifest.cases, ...vardctAlphaManifest.cases]) {
    it(`matches independent float reference samples for ${definition.id}`, async () => {
      const input = fixture(`${definition.id}.jxl`)
      const reference = fixture(`${definition.id}.bin`)
      expect(hash(input)).toBe(definition.sha256)
      expect(hash(reference)).toBe(definition.pixelsSha256)
      const expected = new DataView(reference.buffer, reference.byteOffset, reference.byteLength)
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(input),
        defaultImageLimits,
        { colorOutput: 'preserve' },
      )
      if (!decoder) throw new Error('Decoder unavailable')
      expect(decoder.pixelFormat).toBe(definition.format)
      expect(decoder.colorSemantics).toEqual(definition.colorSemantics)
      let sample = 0
      let squared = 0
      let peak = 0
      for await (const block of decoder.decode()) {
        try {
          const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
          const storage = pixelStorage(block.format)
          for (let offset = 0; offset < block.data.byteLength; offset += storage.bytesPerSample) {
            const actual = block.format.endsWith('f32')
              ? view.getFloat32(offset, false)
              : view.getUint16(offset, false) / (2 ** definition.depth - 1)
            let target = expected.getFloat32(sample * 4, false)
            if (definition.clipReference) target = Math.min(1, Math.max(0, target))
            const error = Math.abs(actual - target) / definition.sourcePeak
            expect(error).toBeLessThanOrEqual(1 / 255)
            squared += error * error
            peak = Math.max(peak, actual)
            sample++
          }
          if (block.format.endsWith('f32'))
            expect(block.displayRanges?.[0]?.white).toBeGreaterThanOrEqual(1)
        } finally {
          block.release?.()
        }
      }
      expect(sample * 4).toBe(reference.byteLength)
      expect(Math.sqrt(squared / sample)).toBeLessThanOrEqual(0.55 / 255)
      if (definition.sourcePeak > 1) expect(peak).toBeGreaterThan(1)
    })
  }

  it('requires explicit selection between distinct alpha channels', async () => {
    const input = new MemorySource(fixture('multiple-alpha.jxl'))
    expect((await inspectJpegXl(input)).alphaChannels).toBe(2)
    await expect(jpegxlCodec.createDecoder?.(input, defaultImageLimits)).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    for (const alphaChannel of [0, 1]) {
      const decoder = await jpegxlCodec.createDecoder?.(input, defaultImageLimits, { alphaChannel })
      for await (const block of decoder?.decode() ?? []) {
        try {
          expect(block.data).toEqual(
            Uint8Array.of(
              10,
              30,
              50,
              alphaChannel === 0 ? 70 : 90,
              20,
              40,
              60,
              alphaChannel === 0 ? 80 : 100,
            ),
          )
        } finally {
          block.release?.()
        }
      }
    }
    for (const alphaChannel of [-1, 2, 0.5])
      await expect(
        jpegxlCodec.createDecoder?.(input, defaultImageLimits, { alphaChannel }),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('honors cancellation after opening and during HDR row output', async () => {
    for (const id of ['pq-16', 'vardct-pq-16']) {
      const controller = new AbortController()
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(fixture(`${id}.jxl`)),
        defaultImageLimits,
        { signal: controller.signal, hdrOutput: 'linear-float' },
      )
      controller.abort()
      await expect(decoder?.decode()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        name: 'AbortError',
      })
    }
    const controller = new AbortController()
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(fixture('vardct-pq-16.jxl')),
      defaultImageLimits,
    )
    const rows = decoder?.decode({ signal: controller.signal })[Symbol.asyncIterator]()
    const first = await rows?.next()
    if (!first || first.done) throw new Error('Missing first HDR row')
    first.value.release?.()
    controller.abort()
    await expect(rows?.next()).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('preflights high-depth alpha output against the decoded memory limit', async () => {
    await expect(
      jpegxlCodec.createDecoder?.(new MemorySource(fixture('vardct-alpha-0-2.jxl')), {
        ...defaultImageLimits,
        maxDecodedBytes: 4096,
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })

  it('reads bounded density and timestamp metadata and rejects invalid field extents', async () => {
    const exif = new Uint8Array(100)
    const view = new DataView(exif.buffer)
    exif.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8])
    view.setUint16(8, 4)
    for (const [index, tag, type, count, value] of [
      [0, 0x11a, 5, 1, 64],
      [1, 0x11b, 5, 1, 72],
      [2, 0x128, 3, 1, 0x20000],
      [3, 0x132, 2, 20, 80],
    ]) {
      if (
        index === undefined ||
        tag === undefined ||
        type === undefined ||
        count === undefined ||
        value === undefined
      )
        throw new Error('Invalid field')
      const offset = 10 + index * 12
      view.setUint16(offset, tag)
      view.setUint16(offset + 2, type)
      view.setUint32(offset + 4, count)
      view.setUint32(offset + 8, value)
    }
    view.setUint32(64, 300)
    view.setUint32(68, 1)
    view.setUint32(72, 150)
    view.setUint32(76, 1)
    exif.set(new TextEncoder().encode('2026:09:04 12:34:56\0'), 80)
    expect(summarizeJpegXlExif(exif)).toEqual({
      pixelDensity: { x: 300, y: 150, unit: 'inch' },
      timestamps: { modified: '2026:09:04 12:34:56' },
    })
    const sink = new Uint8ArraySink()
    const encoder = await jpegxlCodec.createEncoder?.(sink, {
      width: 1,
      height: 1,
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
      metadata: { exif },
      options: { mode: 'lossless' },
      limits: defaultImageLimits,
    })
    if (!encoder) throw new Error('Encoder unavailable')
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
    expect(
      await jpegxlCodec.metadata(new MemorySource(sink.toUint8Array()), defaultImageLimits),
    ).toMatchObject(summarizeJpegXlExif(exif))
    view.setUint32(18, 99)
    expect(() => summarizeJpegXlExif(exif)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
  })
  for (const definition of manifest.cases) {
    it(`preserves and re-encodes ${definition.id} native samples and semantics`, async () => {
      const input = fixture(`${definition.id}.jxl`)
      expect(hash(input)).toBe(definition.sha256)
      const expected = fixture(`${definition.id}.bin`)
      expect(hash(expected)).toBe(definition.pixelsSha256)
      const decoder = await jpegxlCodec.createDecoder?.(
        new MemorySource(input),
        defaultImageLimits,
        { colorOutput: 'preserve' },
      )
      if (!decoder?.colorSemantics) throw new Error('JPEG XL decoder unavailable')
      expect(decoder.colorSemantics).toEqual(definition.colorSemantics)
      expect(decoder.pixelFormat).toBe(definition.format)
      const sink = new Uint8ArraySink()
      const encoder = await jpegxlCodec.createEncoder?.(sink, {
        width: decoder.width,
        height: decoder.height,
        pixelFormat: decoder.pixelFormat,
        colorSemantics: decoder.colorSemantics,
        options: { mode: 'lossless', effort: 1, sampleBitDepth: definition.bitDepth },
        limits: defaultImageLimits,
      })
      if (!encoder) throw new Error('JPEG XL encoder unavailable')
      let offset = 0
      for await (const block of decoder.decode()) {
        try {
          expect(block.data).toEqual(expected.subarray(offset, offset + block.data.length))
          offset += block.data.length
          await encoder.write(block)
        } finally {
          block.release?.()
        }
      }
      expect(offset).toBe(expected.length)
      await encoder.finish()
      expect(hash(sink.toUint8Array())).toBe(definition.encodedSha256)
      const second = await jpegxlCodec.createDecoder?.(
        new MemorySource(sink.toUint8Array()),
        defaultImageLimits,
      )
      expect(second?.colorSemantics).toEqual(decoder.colorSemantics)
    })
  }

  for (const definition of alphaManifest.cases) {
    it(`preserves independent alpha samples for ${definition.id}`, async () => {
      const input = fixture(`${definition.id}.jxl`)
      const expected = fixture(`${definition.id}.bin`)
      expect(hash(input)).toBe(definition.sha256)
      expect(hash(expected)).toBe(definition.pixelsSha256)
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
      expect(decoder?.pixelFormat).toBe(definition.pixelFormat)
      expect(decoder?.colorSemantics).toEqual(definition.colorSemantics)
      const inspection = await inspectJpegXl(input)
      expect(inspection.expectedPixelFormat).toBe(definition.pixelFormat)
      for await (const block of decoder?.decode() ?? []) {
        try {
          expect(block.data).toEqual(expected)
        } finally {
          block.release?.()
        }
      }
      if (definition.id.startsWith('pq-') || definition.id.startsWith('hlg-')) {
        for (const hdrOutput of ['linear-float', 'tone-map-srgb'] as const) {
          const converted = await jpegxlCodec.createDecoder?.(
            new MemorySource(input),
            defaultImageLimits,
            { hdrOutput },
          )
          expect(converted?.colorSemantics?.alpha).toBe('straight')
          for await (const block of converted?.decode() ?? []) {
            try {
              const storage = pixelStorage(block.format)
              expect(storage.channels).toBe(4)
              const view = new DataView(
                block.data.buffer,
                block.data.byteOffset,
                block.data.byteLength,
              )
              for (let x = 0; x < 5; x += 1) {
                const offset = x * 4 * storage.bytesPerSample
                const alpha =
                  hdrOutput === 'linear-float'
                    ? view.getFloat32(offset + 12, false)
                    : (block.data[offset + 3] ?? 0) / 255
                const maximum = 2 ** definition.alphaDepth - 1
                expect(
                  Math.abs(alpha - Math.round((x * maximum) / 4) / maximum),
                ).toBeLessThanOrEqual(hdrOutput === 'linear-float' ? 1e-7 : 1 / 255)
                if (x === 0 && definition.colorSemantics?.alpha === 'premultiplied') {
                  for (let c = 0; c < 3; c += 1)
                    expect(
                      hdrOutput === 'linear-float'
                        ? view.getFloat32(offset + c * 4, false)
                        : block.data[offset + c],
                    ).toBe(0)
                }
              }
            } finally {
              block.release?.()
            }
          }
        }
      }
    })
  }

  it('normalizes and explicitly converts RGBA float alpha independently of HDR color range', async () => {
    const data = new Uint8Array(16)
    const view = new DataView(data.buffer)
    for (const [index, value] of [0, 2, 4, 0.5].entries()) view.setFloat32(index * 4, value, false)
    const block = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 16,
      format: 'rgbaf32',
      data,
      displayRanges: [
        { black: 0, white: 4 },
        { black: 0, white: 4 },
        { black: 0, white: 4 },
        { black: 0, white: 1 },
      ],
    } as const
    async function* blocks() {
      yield block
    }
    for await (const normalized of normalizePixelBlocks(blocks(), 'rgbaf32'))
      expect(normalized.data).toEqual(Uint8Array.of(0, 127, 255, 127))
    for await (const converted of convertPixelBlocks(blocks(), 'rgbaf32', {
      format: 'rgba8',
      range: { minimum: 0, maximum: 4 },
    }))
      expect(converted.data).toEqual(Uint8Array.of(0, 128, 255, 128))
  })

  it('does not silently skip an explicit high-depth sRGB conversion', async () => {
    await expect(
      jpegxlCodec.createDecoder?.(new MemorySource(fixture('p3-16.jxl')), defaultImageLimits, {
        colorOutput: 'srgb',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })

  it('requires explicit HDR tone mapping when sRGB output is selected', async () => {
    const input = new MemorySource(fixture('pq-10.jxl'))
    await expect(
      jpegxlCodec.createDecoder?.(input, defaultImageLimits, { colorOutput: 'srgb' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    const decoder = await jpegxlCodec.createDecoder?.(input, defaultImageLimits, {
      colorOutput: 'srgb',
      hdrOutput: 'tone-map-srgb',
    })
    expect(decoder?.pixelFormat).toBe('rgb8')
    expect(decoder?.colorSemantics?.transfer.kind).toBe('srgb')
    for await (const block of decoder?.decode() ?? []) {
      expect(block.format).toBe('rgb8')
      expect(block.displayRanges).toBeUndefined()
      block.release?.()
    }
  })

  it('renders HLG float highlights using the signaled display luminance', async () => {
    const input = fixture('hlg-16.jxl')
    const inspection = await inspectJpegXl(input)
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), defaultImageLimits, {
      hdrOutput: 'linear-float',
    })
    if (!decoder) throw new Error('HDR decoder unavailable')
    let peak = 0
    for await (const block of decoder.decode()) {
      try {
        expect(block.format).toBe('rgbf32')
        const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
        for (let offset = 0; offset < block.data.length; offset += 4) {
          const value = view.getFloat32(offset, false)
          expect(Number.isFinite(value)).toBe(true)
          expect(value).toBeGreaterThanOrEqual(0)
          peak = Math.max(peak, value)
        }
      } finally {
        block.release?.()
      }
    }
    expect(inspection.toneMapping.intensityTarget).toBe(1000)
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(1000 / 203)
  })

  it('matches the Little CMS 2.16 profile conversion probe within one 8-bit sample', async () => {
    const data = Uint8Array.of(0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 64, 128, 192)
    const source: ImageDecoder = {
      width: 5,
      height: 1,
      pixelFormat: 'rgb8',
      capabilities: {
        sequential: true,
        regionDecode: false,
        scaledDecode: false,
        progressive: false,
      },
      async *decode() {
        yield { x: 0, y: 0, width: 5, height: 1, stride: 15, format: 'rgb8', data }
      },
    }
    // transicc -v1 -n -ioriented-icc.icc -o*sRGB. Values are clipped and rounded to 8 bits.
    const expected = [0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 255, 0, 128, 192, 64]
    const decoder = new ColorManagedDecoder(
      source,
      parseRgbIccTransform(fixture('oriented-icc.icc')),
    )
    for await (const block of decoder.decode()) {
      try {
        for (let index = 0; index < expected.length; index += 1) {
          expect(Math.abs((block.data[index] ?? 0) - (expected[index] ?? 0))).toBeLessThanOrEqual(1)
        }
      } finally {
        block.release?.()
      }
    }
  })

  it('honors separate ICC compressed, decoded, and header limits', async () => {
    const input = fixture('oriented-icc.jxl')
    expect(hash(input)).toBe('e223fed907c6238622b2b6ec1c80609050c9d2db4d759cf3ca6f0db304cbb82a')
    for (const limits of [
      { maxIccCompressedBytes: 1 },
      { maxIccBytes: 128 },
      { maxHeaderBytes: 4 },
    ]) {
      await expect(inspectJpegXl(input, { limits })).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      })
    }
  })

  it('rejects ICC command expansion before exceeding the declared output allocation', () => {
    // 128-byte header, followed by one literal-copy command with one excess byte.
    const encoded = new Uint8Array(2 + 1 + 2 + 129)
    encoded.set([128, 1, 2, 1, 1])
    expect(() => decodeJpegXlIccCommands(encoded, 128)).toThrowError(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    )
    expect(() => decodeJpegXlIccCommands(Uint8Array.of(129, 1), 128)).toThrowError(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }),
    )
  })
})
