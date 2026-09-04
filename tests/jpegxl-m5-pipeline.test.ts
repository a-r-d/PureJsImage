import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { allCodecs } from '../src/codec-entries/all.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { convertPixelBlocks } from '../src/convert.ts'
import { explainImage } from '../src/explain.ts'
import { createImageLibrary } from '../src/index.ts'
import { inspectJpegXl } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import type { PixelBlock } from '../src/pixel.ts'
import { createResizeTransform } from '../src/resize.ts'
import { MemorySource } from '../src/source.ts'
import alphaManifest from './fixtures/jpegxl/m4-color/alpha-manifest.json' with { type: 'json' }
import manifest from './fixtures/jpegxl/m4-color/manifest.json' with { type: 'json' }

const Image = createImageLibrary(allCodecs)
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(`tests/fixtures/jpegxl/m4-color/${name}`))
const collect = async (blocks: AsyncIterable<PixelBlock>): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = []
  for await (const block of blocks) {
    try {
      chunks.push(block.data.slice())
    } finally {
      block.release?.()
    }
  }
  const data = new Uint8Array(chunks.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.length
  }
  return data
}
const pixels = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits, {
    colorOutput: 'preserve',
  })
  if (!decoder) throw new Error('Missing decoder')
  return collect(decoder.decode())
}

describe('JPEG XL M5 pipeline', () => {
  for (const entry of [...manifest.cases, ...alphaManifest.cases]) {
    it(`re-encodes ${entry.id} with exact independently verified samples and depth`, async () => {
      const input = fixture(`${entry.id}.jxl`)
      const image = await Image.open(input, { colorOutput: 'preserve' })
      const output = await image.jpegxl().toBuffer()
      expect(await pixels(output)).toEqual(fixture(`${entry.id}.bin`))
      const source = await inspectJpegXl(input)
      const result = await inspectJpegXl(output)
      expect(result.bitDepth).toBe(source.bitDepth)
      expect(result.extraChannels).toEqual(source.extraChannels)
      expect(result.toneMapping).toEqual(source.toneMapping)
      expect(result.encodedColor).toEqual(source.encodedColor)
    })
  }
  for (const format of ['jpeg', 'png', 'webp', 'avif', 'tiff'] as const) {
    it(`exports ${format} independently decoded by libvips`, async () => {
      const image = (await Image.open(fixture('srgb-8.jxl')))
        .crop({ x: 2, y: 1, width: 1, height: 1 })
        .resize({ width: 8, height: 8, fit: 'fill', kernel: 'nearest' })
      const output = await (format === 'jpeg'
        ? image.jpeg({ quality: 100, chromaSubsampling: '444' })
        : format === 'png'
          ? image.png()
          : format === 'webp'
            ? image.webp({ lossless: true })
            : format === 'avif'
              ? image.avif()
              : image.tiff()
      ).toBuffer()
      const decoded = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      expect([decoded.info.width, decoded.info.height]).toEqual([8, 8])
      const expected = fixture('srgb-8.bin').subarray((7 + 2) * 3, (7 + 3) * 3)
      for (let i = 0; i < decoded.data.length; i += 1)
        expect(Math.abs((decoded.data[i] ?? 0) - (expected[i % 3] ?? 0))).toBeLessThanOrEqual(
          format === 'jpeg' || format === 'avif' ? 2 : 0,
        )
    })
  }
  for (const depth of [10, 12, 16]) {
    it(`preserves ${depth}-bit crop, orientation and resize ranges through explicit PNG conversion`, async () => {
      const image = (await Image.open(fixture(`srgb-${depth}.jxl`)))
        .crop({ x: 2, y: 1, width: 1, height: 1 })
        .rotate(90)
        .resize({ width: 3, height: 2, fit: 'fill', kernel: 'nearest' })
      const output = await image.convertPixelFormat({ format: 'rgb8' }).png().toBuffer()
      const actual = await sharp(output).raw().toBuffer()
      const raw = fixture(`srgb-${depth}.bin`)
      const source = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
      const expected = [0, 1, 2].map((c) =>
        Math.round((source.getUint16(((7 + 2) * 3 + c) * 2) * 255) / (2 ** depth - 1)),
      )
      expect(Array.from(actual)).toEqual(Array.from({ length: 6 }, () => expected).flat())
      if (depth !== 16)
        await expect(image.png().toBuffer()).rejects.toMatchObject({
          code: 'UNSUPPORTED_OPERATION',
        })
      await expect(image.jpeg().toBuffer()).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    })
  }
  it('reports native precision, encoder defaults, color, orientation and working storage', async () => {
    const image = (await Image.open(fixture('srgb-12.jxl')))
      .crop({ x: 1, y: 1, width: 2, height: 2 })
      .resize({ width: 1, height: 1 })
      .jpegxl()
    const plan = await explainImage(image)
    expect(plan.source.pixelFormat).toBe('rgb16')
    expect(plan.pushedOperations).toContain('crop')
    expect(plan.encoderNegotiation).toMatchObject({
      pixelFormat: 'rgb16',
      options: { sampleBitDepth: 12, orientation: 1 },
    })
    expect(plan.decoderExecution?.sampleBitDepths).toEqual([12, 12, 12])
    expect(plan.memoryEstimate.decoderWorkingBytes).toBeGreaterThan(0)
    expect(plan.fullFrameFallbackReasons).toContain(
      'Single-group Modular retains its complete channel planes',
    )
    expect(plan.precision.stages.every((stage) => !stage.precisionLoss)).toBe(true)
    expect(plan.precision.outputColorSemantics?.transfer.kind).toBe('srgb')
  })
  it('requires explicit unsupported color conversions and supports selected P3 and HDR output', async () => {
    await expect((await Image.open(fixture('p3-8.jxl'))).jpeg().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    for (const id of ['p3-8', 'pq-10', 'hlg-12']) {
      const image = await Image.open(
        fixture(`${id}.jxl`),
        id.startsWith('p3') ? { colorOutput: 'srgb' } : { hdrOutput: 'tone-map-srgb' },
      )
      const output = await image.resize({ width: 3, height: 2, fit: 'fill' }).png().toBuffer()
      expect((await sharp(output).metadata()).width).toBe(3)
      const plan = await explainImage(image.png())
      expect(plan.decoderExecution?.conversions.length).toBeGreaterThan(0)
      // keepIcc is a no-op when the input has no profile, in both planning and execution.
      await expect(explainImage(image.keepIcc().png())).resolves.toMatchObject({
        output: { format: 'png' },
      })
      await expect(image.keepIcc().png().toBuffer()).resolves.toBeInstanceOf(Uint8Array)
    }
  })
  it('resizes float RGBA in linear light with independent alpha and no highlight clipping', async () => {
    const data = new Uint8Array(32)
    const view = new DataView(data.buffer)
    const inputValues = [100, 0, 0, 0, 0, 0, 4, 1]
    for (let index = 0; index < inputValues.length; index += 1)
      view.setFloat32(index * 4, inputValues[index] ?? 0)
    const semantics = {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'linear' },
      matrix: 'identity',
      range: 'full',
      alpha: 'straight',
      provenance: 'decoder-converted',
    } as const
    const input = async function* (): AsyncGenerator<PixelBlock> {
      yield {
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        stride: 32,
        format: 'rgbaf32',
        data,
        colorSemantics: semantics,
      }
    }
    const transform = createResizeTransform(
      2,
      1,
      'rgbaf32',
      { width: 1, height: 1, fit: 'fill', kernel: 'bilinear', colorSpace: 'linear-light' },
      semantics,
    )
    const result = await collect(transform.apply(input()))
    const samples = new DataView(result.buffer)
    expect([0, 1, 2, 3].map((c) => samples.getFloat32(c * 4))).toEqual([0, 0, 4, 0.5])
    const display = await collect(
      convertPixelBlocks(transform.apply(input()), 'rgbaf32', {
        format: 'rgba8',
        range: { minimum: 0, maximum: 4 },
      }),
    )
    expect(Array.from(display)).toEqual([0, 0, 255, 128])
  })
  it('filters 12-bit sRGB in linear light against the analytical two-pixel mean', async () => {
    const data = new Uint8Array(12)
    const view = new DataView(data.buffer)
    for (let c = 3; c < 6; c += 1) view.setUint16(c * 2, 4095)
    const semantics = {
      family: 'rgb',
      primaries: 'srgb',
      transfer: { kind: 'srgb' },
      matrix: 'identity',
      range: 'full',
      alpha: 'none',
      provenance: 'container-signaled',
    } as const
    const input = async function* (): AsyncGenerator<PixelBlock> {
      yield {
        x: 0,
        y: 0,
        width: 2,
        height: 1,
        stride: 12,
        format: 'rgb16',
        data,
        colorSemantics: semantics,
        displayRanges: Array.from({ length: 3 }, () => ({ black: 0, white: 4095 })),
      }
    }
    const transform = createResizeTransform(
      2,
      1,
      'rgb16',
      { width: 1, height: 1, fit: 'fill', kernel: 'bilinear', colorSpace: 'linear-light' },
      semantics,
      [12, 12, 12],
    )
    const result = new DataView((await collect(transform.apply(input()))).buffer)
    const expected = Math.round((1.055 * 0.5 ** (1 / 2.4) - 0.055) * 4095)
    expect([0, 2, 4].map((offset) => result.getUint16(offset))).toEqual([
      expected,
      expected,
      expected,
    ])
  })
})

it('keeps display window hints separate from native integer sample precision', async () => {
  const input = async function* (): AsyncGenerator<PixelBlock> {
    yield {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      stride: 2,
      format: 'gray16',
      data: new Uint8Array([0x80, 0]),
      displayRanges: [{ black: 100, white: 1000 }],
    }
  }
  const transform = createResizeTransform(1, 1, 'gray16', {
    width: 2,
    height: 1,
    fit: 'fill',
    kernel: 'nearest',
  })
  expect(await collect(transform.apply(input()))).toEqual(new Uint8Array([0x80, 0, 0x80, 0]))
  expect(await collect(convertPixelBlocks(input(), 'gray16', { format: 'gray8' }))).toEqual(
    new Uint8Array([128]),
  )
})

it('preserves ICC and Exif only on request, including normalized orientation', async () => {
  const input = fixture('oriented-icc.jxl')
  const image = await Image.open(input)
  const kept = await image.autoOrient().keepExif().keepIcc().png().toBuffer()
  const stripped = await image.autoOrient().png().toBuffer()
  const codec = allCodecs.find((codec) => codec.format === 'png')
  const metadata = await codec?.preservedMetadata?.(new MemorySource(kept), defaultImageLimits, {
    exif: true,
    icc: true,
  })
  expect(metadata?.icc).toEqual(fixture('oriented-icc.icc'))
  expect((await sharp(kept).metadata()).orientation ?? 1).toBe(1)
  expect(
    await codec?.preservedMetadata?.(new MemorySource(stripped), defaultImageLimits, {
      exif: true,
      icc: true,
    }),
  ).toEqual({})
})

it('cancels after the first encoded write and aborts the sink without closing it', async () => {
  const controller = new AbortController()
  let writes = 0,
    aborted = false,
    closed = false
  const image = await Image.open(fixture('srgb-12.jxl'))
  await expect(
    image
      .convertPixelFormat({ format: 'rgb8' })
      .resize({ width: 64, height: 64 })
      .png()
      .toSink(
        {
          async write() {
            writes += 1
            controller.abort()
          },
          async close() {
            closed = true
          },
          async abort() {
            aborted = true
          },
        },
        { signal: controller.signal },
      ),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(writes).toBe(1)
  expect(aborted).toBe(true)
  expect(closed).toBe(false)
})

it('keeps nearest and linear-light resize faithful while exposing reduced DCT for other kernels', async () => {
  const input = new Uint8Array(
    readFileSync(
      'benchmark/fixtures/jpegxl/jpeg-reconstruction-v0.12.0/progressive-yuv420-exif.jxl',
    ),
  )
  const image = await Image.open(input)
  for (const options of [{ kernel: 'nearest' as const }, { colorSpace: 'linear-light' as const }]) {
    const plan = await explainImage(image.resize({ width: 40, height: 30, ...options }).png())
    expect(plan.scaleDenominator).toBe(1)
  }
  const plan = await explainImage(image.resize({ width: 40, height: 30 }).png())
  expect(plan.scaleDenominator).toBe(8)
  expect(plan.pushedOperations).toContain('resize')
})

it('keeps JPEG-derived reduced IDCT components unclipped until final RGB conversion', async () => {
  const { decodeJpegXlJpegPixels } = await import('../src/codecs/jpegxl-jpeg-pixels.ts')
  const image = {
    width: 8,
    height: 8,
    progressive: false,
    colorTransform: 'ycbcr' as const,
    maximumHorizontalSampling: 1,
    maximumVerticalSampling: 1,
    mcusPerLine: 1,
    mcusPerColumn: 1,
    restartInterval: 0,
    scans: [],
    coefficientBytes: 384,
    components: [-1600, 1600, -1600].map((dc, id) => {
      const coefficients = new Int16Array(64)
      coefficients[0] = dc
      return {
        id,
        horizontalSampling: 1,
        verticalSampling: 1,
        quantizationTable: 0,
        blocksPerLine: 1,
        blocksPerColumn: 1,
        blocksPerLineForMcu: 1,
        blocksPerColumnForMcu: 1,
        quantization: new Int32Array(64).fill(1),
        coefficients,
      }
    }),
  }
  for (const scaleDenominator of [1, 2, 4, 8] as const) {
    const bytes = await collect(
      decodeJpegXlJpegPixels(image, { scaleDenominator }, [new Int32Array(1), new Int32Array(1)]),
    )
    // DC/8 + 128 gives Y=-72, Cb=328, Cr=-72. Only the final RGB values are clipped.
    const expected = [0, Math.round(-72 - 0.344136286 * 200 + 0.714136286 * 200), 255]
    expect(Array.from(bytes)).toEqual(
      Array.from({ length: (8 / scaleDenominator) ** 2 }, () => expected).flat(),
    )
  }
})

it('keeps independently declared alpha precision when contain adds a canvas', async () => {
  const image = (await Image.open(fixture('srgb-12.jxl')))
    .resize({ width: 9, height: 9, fit: 'contain' })
    .jpegxl()
  const plan = await explainImage(image)
  expect(plan.encoderNegotiation).toMatchObject({
    pixelFormat: 'rgba16',
    options: { sampleBitDepth: 12, alphaBitDepth: 16 },
  })
  const output = await image.toBuffer()
  const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(output), defaultImageLimits)
  expect(decoder?.execution?.sampleBitDepths).toEqual([12, 12, 12, 16])
})
