import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { DecoderOptions } from '../src/codec.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { explainImage } from '../src/explain.ts'
import { createImageLibrary } from '../src/index.ts'
import { inspectJpegXl } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import manifest from './fixtures/jpegxl/remediation/manifest.json' with { type: 'json' }

const Image = createImageLibrary([jpegxlCodec])
const fixture = (id: string, extension = 'jxl'): Uint8Array =>
  new Uint8Array(readFileSync(`tests/fixtures/jpegxl/remediation/${id}.${extension}`))
const decode = async (bytes: Uint8Array, options: DecoderOptions = { colorOutput: 'preserve' }) => {
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(bytes),
    defaultImageLimits,
    options,
  )
  if (!decoder) throw new Error('Missing decoder')
  const values: number[] = []
  const formats = new Set<string>()
  const families = new Set<string>()
  for await (const block of decoder.decode()) {
    try {
      formats.add(block.format)
      families.add(block.colorSemantics?.family ?? 'missing')
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      const stride = block.format.endsWith('f32') ? 4 : block.format.endsWith('16') ? 2 : 1
      for (let i = 0; i < block.data.byteLength; i += stride)
        values.push(
          stride === 4 ? view.getFloat32(i) : stride === 2 ? view.getUint16(i) : view.getUint8(i),
        )
    } finally {
      block.release?.()
    }
  }
  return { decoder, values, formats: [...formats], families: [...families] }
}
const oracle = (id: string): number[] => {
  const bytes = fixture(id, 'bin'),
    view = new DataView(bytes.buffer)
  return Array.from({ length: bytes.byteLength / 4 }, (_, i) => view.getFloat32(i * 4))
}

describe('PR 35 independently generated metadata and gray-alpha regressions', () => {
  for (const entry of manifest.cases) {
    it(`pins libjxl input and oracle checksums for ${entry.id}`, () => {
      expect(createHash('sha256').update(fixture(entry.id)).digest('hex')).toBe(entry.sha256)
      expect(createHash('sha256').update(fixture(entry.id, 'bin')).digest('hex')).toBe(
        entry.pixelsSha256,
      )
    })
    if (entry.id === 'gray-icc-alpha-8-8') {
      it('keeps gray ICC inspection available and rejects unsupported RGB expansion explicitly', async () => {
        const bytes = fixture(entry.id)
        const metadata = await jpegxlCodec.metadata(new MemorySource(bytes), defaultImageLimits)
        expect(metadata.colorSemantics).toMatchObject({ family: 'gray', provenance: 'icc' })
        expect(metadata.components).toBe(2)
        for (const colorOutput of ['preserve', 'srgb'] as const)
          await expect(
            (await Image.open(bytes, { colorOutput })).jpegxl().toBuffer(),
          ).rejects.toMatchObject({
            code: 'UNSUPPORTED_OPERATION',
          })
      })
      continue
    }
    if (entry.color === 3) {
      it(`preserves ${entry.id} luminance fields through native and storage-only re-encoding`, async () => {
        const input = fixture(entry.id),
          source = await inspectJpegXl(input)
        const image = await Image.open(input, { colorOutput: 'preserve' })
        expect(source.toneMapping).toEqual(entry.toneMapping)
        expect((await inspectJpegXl(await image.jpegxl().toBuffer())).toneMapping).toEqual(
          entry.toneMapping,
        )
        const pipeline = image
          .convertPixelFormat({ format: entry.alpha ? 'rgba16' : 'rgb16' })
          .jpegxl()
        const plan = await explainImage(pipeline)
        expect(plan.encoderNegotiation.options).toMatchObject({ toneMapping: entry.toneMapping })
        const output = await pipeline.toBuffer(),
          header = await inspectJpegXl(output)
        expect(header.toneMapping).toEqual(entry.toneMapping)
        expect(header.bitDepth).toBe(16)
        const actual = await decode(output),
          reference = oracle(entry.id)
        expect(actual.decoder.execution?.sampleBitDepths).toEqual(
          Array(entry.alpha ? 4 : 3).fill(16),
        )
        for (let i = 0; i < reference.length; i++)
          expect(
            Math.abs((actual.values[i] ?? 0) / 65535 - (reference[i] ?? 0)),
          ).toBeLessThanOrEqual(0.5 / 65535 + 6e-8)
        const sourceLinear = await decode(input, { hdrOutput: 'linear-float' })
        const outputLinear = await decode(output, { hdrOutput: 'linear-float' })
        // Half an output code step, propagated through the largest transfer/OOTF
        // slope (bounded by 16 over these normalized test values), plus float noise.
        const peak = Math.max(...sourceLinear.values.map(Math.abs))
        for (let i = 0; i < sourceLinear.values.length; i++)
          expect(
            Math.abs((sourceLinear.values[i] ?? 0) - (outputLinear.values[i] ?? 0)),
          ).toBeLessThanOrEqual((peak * 8) / 65535 + 1e-5)
      })
      it(`replaces ${entry.id} HDR metadata after real SDR tone mapping`, async () => {
        const image = await Image.open(fixture(entry.id), { hdrOutput: 'tone-map-srgb' })
        const pipeline = image
          .convertPixelFormat({ format: entry.alpha ? 'rgba16' : 'rgb16' })
          .jpegxl()
        const plan = await explainImage(pipeline),
          header = await inspectJpegXl(await pipeline.toBuffer())
        expect(plan.encoderNegotiation.options).not.toHaveProperty('toneMapping')
        expect(header.toneMapping).toEqual({
          intensityTarget: 255,
          minNits: 0,
          relativeToMaxDisplay: false,
          linearBelow: 0,
        })
        expect(header.bitDepth).toBe(16)
        expect(
          (await decode(await pipeline.toBuffer())).decoder.colorSemantics?.transfer.kind,
        ).toBe('srgb')
      })
    } else {
      it(`keeps source gray metadata and emitted RGB semantics for ${entry.id}`, async () => {
        const input = fixture(entry.id),
          native = await decode(input),
          metadata = await jpegxlCodec.metadata(new MemorySource(input), defaultImageLimits)
        expect(metadata.colorSemantics?.family).toBe('gray')
        expect(metadata.components).toBe(2)
        expect(metadata.channelBitDepths).toEqual([entry.depth, entry.alpha])
        expect(native.decoder.colorSemantics).toMatchObject({
          family: 'rgb',
          alpha: entry.associated ? 'premultiplied' : 'straight',
        })
        expect(native.families).toEqual(['rgb'])
        expect(native.formats).toEqual([entry.depth > 8 ? 'rgba16' : 'rgba8'])
        expect(native.decoder.execution?.inputColorSemantics?.family).toBe('gray')
        expect(native.decoder.execution?.precisionLoss).toBe(false)
        const reference = oracle(entry.id)
        for (let pixel = 0; pixel < entry.width * entry.height; pixel++) {
          for (let c = 0; c < 4; c++) {
            const maximum = 2 ** (c === 3 ? entry.alpha : entry.depth) - 1
            expect(native.values[pixel * 4 + c]).toBe(
              Math.round((reference[pixel * 2 + (c === 3 ? 1 : 0)] ?? 0) * maximum),
            )
          }
        }
        const image = await Image.open(input, { colorOutput: 'preserve' })
        expect((await decode(await image.jpegxl().toBuffer())).values).toEqual(native.values)
        const cropped = await decode(
          await image.crop({ x: 1, y: 1, width: 2, height: 1 }).jpegxl().toBuffer(),
        )
        expect(cropped.values).toEqual(
          native.values.slice((entry.width + 1) * 4, (entry.width + 3) * 4),
        )
      })
      it(`resizes ${entry.id} and explicitly straightens associated alpha`, async () => {
        const image = await Image.open(fixture(entry.id), {
          colorOutput: 'preserve',
          alphaOutput: 'straight',
        })
        const straight = await decode(await image.jpegxl().toBuffer())
        const original = await decode(fixture(entry.id))
        if (entry.associated) {
          for (let p = 0; p < entry.width * entry.height; p++) {
            const alpha = (original.values[p * 4 + 3] ?? 0) / (2 ** entry.alpha - 1)
            expect(straight.values[p * 4]).toBe(
              alpha === 0
                ? 0
                : Math.min(2 ** entry.depth - 1, Math.round((original.values[p * 4] ?? 0) / alpha)),
            )
          }
        }
        for (const linearLight of [false, true]) {
          const pipeline = image
            .crop({ x: 1, y: 1, width: 1, height: 1 })
            .resize({
              width: 2,
              height: 2,
              fit: 'fill',
              kernel: 'nearest',
              colorSpace: linearLight ? 'linear-light' : 'encoded',
            })
            .jpegxl()
          const result = await decode(await pipeline.toBuffer())
          expect(result.decoder.colorSemantics).toMatchObject({ family: 'rgb', alpha: 'straight' })
          expect(result.values).toEqual(
            Array.from({ length: 4 }, () =>
              straight.values.slice((entry.width + 1) * 4, (entry.width + 2) * 4),
            ).flat(),
          )
        }
      })
    }
  }
  it('keeps explicit metadata overrides and validates incompatible ones', async () => {
    const image = (await Image.open(fixture('hlg-12'))).convertPixelFormat({ format: 'rgb16' })
    const toneMapping = {
      intensityTarget: 4000,
      minNits: 0,
      relativeToMaxDisplay: false,
      linearBelow: 0,
    }
    expect(
      (await inspectJpegXl(await image.jpegxl({ toneMapping }).toBuffer())).toneMapping,
    ).toEqual(toneMapping)
    await expect(
      image.jpegxl({ toneMapping: { ...toneMapping, minNits: 5000 } }).toBuffer(),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })
  it('rejects inherited JXL color meaning after a display window in both plan and execution', async () => {
    const gray = new Uint8Array(readFileSync('tests/fixtures/jpegxl/m4-color/gray-hlg-12.jxl'))
    const pipeline = (await Image.open(gray)).window({ center: 2048, width: 4096 }).jpegxl()
    await expect(explainImage(pipeline)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    await expect(pipeline.toBuffer()).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })
  it('keeps ordinary grayscale gray and ordinary sRGB storage conversion unchanged', async () => {
    const gray = new Uint8Array(readFileSync('tests/fixtures/jpegxl/m4-color/gray-srgb-12.jxl'))
    const image = await Image.open(gray)
    const native = await decode(await image.jpegxl().toBuffer())
    expect(native.decoder.colorSemantics?.family).toBe('gray')
    const output = await decode(
      await image.convertPixelFormat({ format: 'gray16' }).jpegxl().toBuffer(),
    )
    expect(output.decoder.colorSemantics?.family).toBe('gray')
    expect(output.values).toEqual(native.values.map((value) => Math.round((value * 65535) / 4095)))
  })
})
