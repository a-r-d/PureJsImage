import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import alphaFixtures from './fixtures/jpegxl/gap-alpha/manifest.json' with { type: 'json' }
import { createImageLibrary } from '../src/browser.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { encodeJpegXlNative } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import {
  gapDecoder,
  gapSemantics,
  verifyJpegXlAnimationGaps,
  verifyJpegXlSampleGaps,
  verifyJpegXlExtendedColorGaps,
  verifyJpegXlVarDctFloatAlpha,
} from './helpers/jpegxl-gap-completion.ts'
import { collectJpegXlProfileRows } from './helpers/jpegxl-profile-pipeline.ts'
import {
  channelSwappingRgbProfile,
  constantGrayCmykProfile,
  rgbLegacyLutProfile,
} from './icc-fixtures.ts'
import { Uint8ArraySink } from '../src/sink.ts'

describe('JPEG XL remaining ordinary sample and animation gaps', () => {
  it('rejects attaching a source ICC profile to converted float samples', async () => {
    await expect(
      jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
        width: 1,
        height: 1,
        pixelFormat: 'rgbf32',
        colorSemantics: gapSemantics,
        metadata: { icc: channelSwappingRgbProfile() },
        options: {},
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })
  it('rejects unavailable native resolution levels on floating VarDCT input', async () => {
    const input = new Uint8Array(
      await readFile('tests/fixtures/jpegxl/gap-alpha/vardct-color-32-8-straight.jxl'),
    )
    await expect(gapDecoder(input, { resolutionLevel: 1 })).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
  })
  for (const fixture of alphaFixtures.fixtures)
    it(`renders pinned libjxl ${fixture.id}`, async () => {
      const input = new Uint8Array(
        await readFile(`tests/fixtures/jpegxl/gap-alpha/${fixture.file}`),
      )
      const reference = new Uint8Array(
        gunzipSync(await readFile(`tests/fixtures/jpegxl/gap-alpha/${fixture.id}.bin.gz`)),
      )
      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.sha256)
      expect(createHash('sha256').update(reference).digest('hex')).toBe(fixture.referenceSha256)
      const result = await verifyJpegXlVarDctFloatAlpha(input, reference)
      expect(result.maximumColor).toBeLessThanOrEqual(1 / 255)
      // Reference blends use Float64 working values; libjxl rounds intermediate alpha to Float32.
      expect(result.maximumAlpha).toBeLessThanOrEqual(fixture.blend ? 1.2e-7 : 0)
    })
  it('preserves mixed alpha and wide integer layouts through public APIs', async () => {
    expect(await verifyJpegXlSampleGaps()).toBe(24)
  })
  it('preserves custom floating fields and legacy LUT profiles through portable APIs', async () => {
    expect(await verifyJpegXlExtendedColorGaps()).toBe(4)
  })
  it('rejects nonfinite CMYK black beneath zero associated alpha', async () => {
    const plane = { data: Uint8Array.of(0), bitDepth: 8 }
    const input = await encodeJpegXlNative({
      width: 1,
      height: 1,
      color: [plane, plane, plane],
      iccProfile: constantGrayCmykProfile(),
      extraChannels: [
        { type: 4, data: Uint32Array.of(0x7fc00000), bitDepth: 32, sampleFormat: 'binary32' },
        { type: 0, data: Uint8Array.of(0), bitDepth: 8, associatedAlpha: true },
      ],
    })
    await expect(collectJpegXlProfileRows(await gapDecoder(input))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })
  it.each([
    { options: { sampleBitDepth: '31' }, code: 'INVALID_INPUT' },
    { options: { alphaBitDepth: 24 }, code: 'INVALID_INPUT' },
    { options: { sampleBitDepth: Number.NaN }, code: 'UNSUPPORTED_OPERATION' },
  ])('rejects invalid native row sample depths $options', async ({ options, code }) => {
    await expect(
      jpegxlCodec.createEncoder?.(new Uint8ArraySink(), {
        width: 1,
        height: 1,
        pixelFormat: 'rgb32',
        colorSemantics: gapSemantics,
        options,
      }),
    ).rejects.toMatchObject({ code })
  })
  it('encodes Float32 animation and renders selected HDR VarDCT frames', async () => {
    expect(await verifyJpegXlAnimationGaps()).toBe(6)
  })
  it.each([
    { bits: 24, exponent: 8, one: 0x3f8000, zero: 0x800000, tiny: 2 ** -141 },
    { bits: 16, exponent: 4, one: 0x3800, zero: 0x8000, tiny: 2 ** -17 },
  ])(
    'decodes custom $bits-bit float fields exactly',
    async ({ bits, exponent, one, zero, tiny }) => {
      const input = await encodeJpegXlNative({
        width: 4,
        height: 1,
        color: [
          {
            data: Uint32Array.of(zero, 1, one, zero + one),
            bitDepth: bits,
            exponentBits: exponent,
            sampleFormat: 'floating-point',
          },
        ],
      })
      const decoder = await gapDecoder(input)
      const raw = new DataView((await collectJpegXlProfileRows(decoder)).buffer)
      expect(Object.is(raw.getFloat32(0, false), -0)).toBe(true)
      expect(raw.getFloat32(4, false)).toBe(tiny)
      expect(raw.getFloat32(8, false)).toBe(1)
      expect(raw.getFloat32(12, false)).toBe(-1)
    },
  )
  it.each([1, 2] as const)(
    'converts and preserves RGB LUT%d ICC without integer quantization',
    async (precision) => {
      const plane = {
        data: new Uint32Array(Float32Array.of(0, 0.25, 0.5, 1).buffer),
        bitDepth: 32,
        sampleFormat: 'binary32' as const,
      }
      const profile = rgbLegacyLutProfile(precision)
      const input = await encodeJpegXlNative({
        width: 4,
        height: 1,
        color: [plane, plane, plane],
        iccProfile: profile,
      })
      const decoder = await gapDecoder(input, { colorOutput: 'srgb' })
      const raw = new DataView((await collectJpegXlProfileRows(decoder)).buffer)
      expect(raw.getUint16(0, false)).toBe(0)
      expect(raw.getUint16(18, false)).toBeGreaterThan(65000)
    },
  )
  it('preserves integer RGB ICC encoding', async () => {
    const plane = { data: Uint16Array.of(0, 1, 32767, 65535), bitDepth: 16 }
    const input = await encodeJpegXlNative({
      width: 4,
      height: 1,
      color: [plane, plane, plane],
      iccProfile: channelSwappingRgbProfile(),
    })
    const Image = createImageLibrary({ codecs: [jpegxlCodec] })
    const output = await (await Image.open(input, { colorOutput: 'preserve' }))
      .keepIcc()
      .jpegxl()
      .toUint8Array()
    expect(
      await collectJpegXlProfileRows(await gapDecoder(output, { colorOutput: 'preserve' })),
    ).toEqual(await collectJpegXlProfileRows(await gapDecoder(input, { colorOutput: 'preserve' })))
  })
  it('rounds lossy float color within its mantissa step and preserves alpha exactly', async () => {
    const values = Float32Array.of(-0, 2 ** -149, Math.PI, 3.4028234663852886e38)
    const alphaValues = Float32Array.of(0, 0.1234567, 0.5, 1)
    const plane = {
      data: new Uint32Array(values.buffer),
      bitDepth: 32,
      sampleFormat: 'binary32' as const,
    }
    const input = await encodeJpegXlNative({
      width: 4,
      height: 1,
      color: [plane, plane, plane],
      extraChannels: [
        {
          type: 0,
          data: new Uint32Array(alphaValues.buffer),
          bitDepth: 32,
          sampleFormat: 'binary32',
        },
      ],
    })
    const Image = createImageLibrary({ codecs: [jpegxlCodec] })
    const image = await Image.open(input)
    const lossy = await image.jpegxl({ mode: 'lossy', distance: 25 }).toUint8Array()
    const view = new DataView((await collectJpegXlProfileRows(await gapDecoder(lossy))).buffer)
    let changed = false
    for (let pixel = 0; pixel < 4; pixel++) {
      const source = values[pixel] ?? 0,
        actual = view.getFloat32(pixel * 16, false)
      expect(Number.isFinite(actual)).toBe(true)
      expect(Math.abs(actual - source)).toBeLessThanOrEqual(
        Math.max(Math.abs(source) * 2 ** -10, 2 ** -138),
      )
      expect(view.getFloat32(pixel * 16 + 12, false)).toBe(alphaValues[pixel])
      changed ||= !Object.is(actual, source)
    }
    expect(Object.is(view.getFloat32(0, false), -0)).toBe(true)
    expect(changed).toBe(true)
    const lossless = await image.jpegxl().toUint8Array()
    expect(await collectJpegXlProfileRows(await gapDecoder(lossless))).toEqual(
      await collectJpegXlProfileRows(await gapDecoder(input)),
    )
  })
  it.each(['pq', 'hlg'] as const)(
    'converts custom-primary %s floats to linear and tone-mapped output',
    async (kind) => {
      const plane = {
        data: new Uint32Array(Float32Array.of(0, 0.25, 0.5, 1).buffer),
        bitDepth: 32,
        sampleFormat: 'binary32' as const,
      }
      const input = await encodeJpegXlNative({
        width: 4,
        height: 1,
        color: [plane, plane, plane],
        colorSemantics: {
          ...gapSemantics,
          primaries: 'unspecified',
          transfer: { kind },
          chromaticities: {
            whitePoint: { x: 0.3127, y: 0.329 },
            primaries: [
              { x: 0.64, y: 0.33 },
              { x: 0.3, y: 0.6 },
              { x: 0.15, y: 0.06 },
            ],
          },
        },
      })
      for (const hdrOutput of ['linear-float', 'tone-map-srgb'] as const) {
        const decoder = await gapDecoder(input, { hdrOutput })
        expect((await collectJpegXlProfileRows(decoder)).length).toBe(
          4 * 3 * (hdrOutput === 'linear-float' ? 4 : 1),
        )
      }
    },
  )
  it('decodes independent float groups under a budget smaller than source-wide staging', async () => {
    const width = 4100,
      height = 17
    const values = new Float32Array(width * height).fill(0.25)
    const plane = {
      data: new Uint32Array(values.buffer),
      bitDepth: 32,
      sampleFormat: 'binary32' as const,
    }
    const input = await encodeJpegXlNative({ width, height, color: [plane, plane, plane] })
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(input), {
      ...defaultImageLimits,
      maxDecodedBytes: 4_000_000,
    })
    if (!decoder) throw new Error('Missing native grouped decoder')
    const crop = await collectJpegXlProfileRows(decoder, { x: 1022, y: 3, width: 5, height: 2 })
    const view = new DataView(crop.buffer)
    for (let index = 0; index < crop.length; index += 4)
      expect(view.getFloat32(index, false)).toBe(0.25)
  })
})
