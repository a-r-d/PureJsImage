import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createImageLibrary } from '../src/browser.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { encodeJpegXlNative } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import cmyk from './fixtures/jpegxl/cmyk-pipeline/manifest.json' with { type: 'json' }
import floats from './fixtures/jpegxl/practical-float/manifest.json' with { type: 'json' }
import { verifyJpegXlFloatPipeline } from './helpers/jpegxl-float-pipeline.ts'
import {
  collectJpegXlProfileRows,
  verifyJpegXlProfilePipeline,
} from './helpers/jpegxl-profile-pipeline.ts'

const root = new URL('./fixtures/jpegxl/', import.meta.url)
const read = async (file: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(new URL(file, root)))
const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const open = async (bytes: Uint8Array, options = {}) => {
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(bytes),
    defaultImageLimits,
    options,
  )
  if (!decoder) throw new Error('Missing JPEG XL decoder')
  return decoder
}
describe('JPEG XL ordinary native float and CMYK input', () => {
  for (const fixture of floats.manifest)
    it(`preserves and processes pinned libjxl ${fixture.name}`, async () => {
      const bytes = await read(`practical-float/${fixture.name}.jxl`)
      expect(hash(bytes)).toBe(fixture.jxlSha256)
      expect(hash(await read(`practical-float/${fixture.name}.pfm`))).toBe(fixture.colorPfmSha256)
      expect(hash(await read(`practical-float/${fixture.name}.pfm-ec1.pfm`))).toBe(
        fixture.alphaPfmSha256,
      )
      expect(await verifyJpegXlFloatPipeline(bytes, fixture)).toBeLessThanOrEqual(1)
    })
  for (const fixture of cmyk.fixtures)
    it(`converts and processes LittleCMS ${fixture.id}`, async () => {
      const bytes = await read(`cmyk-pipeline/${fixture.id}.jxl`)
      const reference = new Uint8Array(gunzipSync(await read(`cmyk-pipeline/${fixture.id}.bin.gz`)))
      expect(hash(bytes)).toBe(fixture.sha256)
      expect(hash(reference)).toBe(fixture.referenceSha256)
      expect(hash(await read('cmyk-pipeline/source.icc'))).toBe(cmyk.profileSha256)
      expect(await verifyJpegXlProfilePipeline(bytes, reference, fixture)).toMatchObject({
        maximumAlpha: 0,
      })
      const decoder = await open(bytes)
      expect(decoder.execution?.inputColorSemantics.family).toBe('unspecified')
      expect(decoder.execution?.conversions).toContain('cmyk-to-srgb')
      expect(decoder.colorSemantics?.icc).toBeUndefined()
      await expect(open(bytes, { preserveIcc: true })).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
      })
      await expect(open(bytes, { colorOutput: 'preserve' })).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
      })
    }, 30_000)
  it.each([16, 32] as const)(
    'preserves binary%d signed zero, negatives, subnormals and headroom',
    async (depth) => {
      const data =
        depth === 16
          ? Uint16Array.of(0x8000, 0xbc00, 1, 0x4000)
          : Uint32Array.of(0x80000000, 0xbf800000, 1, 0x40000000)
      const bytes = await encodeJpegXlNative({
        width: 4,
        height: 1,
        color: [{ data, bitDepth: depth, sampleFormat: depth === 16 ? 'binary16' : 'binary32' }],
      })
      const decoder = await open(bytes)
      expect(decoder.pixelFormat).toBe('grayf32')
      expect(decoder.execution?.precisionLoss).toBe(false)
      const output = await collectJpegXlProfileRows(decoder)
      const view = new DataView(output.buffer)
      expect(Object.is(view.getFloat32(0, false), -0)).toBe(true)
      expect(view.getFloat32(4, false)).toBe(-1)
      expect(view.getFloat32(8, false)).toBe(depth === 16 ? 2 ** -24 : 2 ** -149)
      expect(view.getFloat32(12, false)).toBe(2)
      expect(decoder.execution?.sourceSampleBitDepths).toEqual([depth])
    },
  )
  it('decodes the independent level-10 binary32 fixture exactly', async () => {
    const decoder = await open(await read('m10-level10/lossless-pfm.jxl'))
    const planes = Array.from(
      { length: 3 },
      () => new Uint8Array(decoder.width * decoder.height * 4),
    )
    const bytes = await collectJpegXlProfileRows(decoder)
    const input = new DataView(bytes.buffer)
    for (let pixel = 0; pixel < decoder.width * decoder.height; pixel++)
      for (let channel = 0; channel < 3; channel++) {
        const plane = planes[channel]
        if (!plane) throw new Error('Missing plane')
        new DataView(plane.buffer).setUint32(
          pixel * 4,
          input.getUint32((pixel * 3 + channel) * 4, false),
          false,
        )
      }
    const digest = createHash('sha256')
    for (const plane of planes) digest.update(plane)
    expect(digest.digest('hex')).toBe(
      'b79a3696b462f6dfad2685f9201cb27abb375af3ca4efcdf145a35d361de3093',
    )
  })
  it.each([0x7f800000, 0x7fc00000])(
    'rejects nonfinite float pattern %i during decode',
    async (bits) => {
      const bytes = await encodeJpegXlNative({
        width: 1,
        height: 1,
        color: [{ data: Uint32Array.of(bits), bitDepth: 32, sampleFormat: 'binary32' }],
      })
      await expect(collectJpegXlProfileRows(await open(bytes))).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      })
    },
  )
  it('selects alpha by descriptor despite a preceding CMYK black channel', async () => {
    const bytes = await encodeJpegXlNative({
      width: 2,
      height: 1,
      color: [
        { data: Uint8Array.of(255, 255), bitDepth: 8 },
        { data: Uint8Array.of(255, 255), bitDepth: 8 },
        { data: Uint8Array.of(255, 255), bitDepth: 8 },
      ],
      extraChannels: [
        { type: 4, data: Uint8Array.of(255, 255), bitDepth: 8 },
        { type: 0, data: Uint8Array.of(0, 255), bitDepth: 8 },
        { type: 0, data: Uint8Array.of(255, 0), bitDepth: 8 },
      ],
      iccProfile: await read('cmyk-pipeline/source.icc'),
    })
    await expect(open(bytes)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    for (const alphaChannel of [0, 1]) {
      const pixels = await collectJpegXlProfileRows(await open(bytes, { alphaChannel }))
      expect([pixels[3], pixels[7]]).toEqual(alphaChannel === 0 ? [0, 255] : [255, 0])
    }
  })
  it('reserves ICC and normalized extras before allocating, and rejects unsupported requests', async () => {
    for (const file of [
      'cmyk-pipeline/cmyk16-alpha16.jxl',
      'practical-float/gray16-alpha32-straight.jxl',
    ]) {
      const bytes = await read(file)
      await expect(
        jpegxlCodec.createDecoder?.(new MemorySource(bytes), {
          ...defaultImageLimits,
          maxDecodedBytes: 64,
        }),
      ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
      const decoder = await open(bytes)
      await expect(collectJpegXlProfileRows(decoder, { x: -1 })).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      })
      await expect(
        collectJpegXlProfileRows(decoder, { scaleDenominator: 2 }),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
      await expect(open(bytes, { hdrOutput: 'linear-float' })).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
      })
    }
  })
  it('closes on early return and supports replay after cancellation', async () => {
    const decoder = await open(await read('cmyk-pipeline/cmyk16-shifted-grouped.jxl'))
    const controller = new AbortController()
    const iterator = decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]()
    expect((await iterator.next()).done).toBe(false)
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
    for await (const row of decoder.decode()) {
      expect(row.y).toBe(0)
      break
    }
    expect((await collectJpegXlProfileRows(decoder)).length).toBe(1025 * 3 * 8)
  })
  it('preserves float precision through orientation, crop and resize', async () => {
    const native = await encodeJpegXlNative({
      width: 2,
      height: 3,
      orientation: 6,
      color: [
        {
          data: new Uint32Array(Float32Array.of(-1, 0.25, 0.5, 0.75, 1, 2).buffer),
          bitDepth: 32,
          sampleFormat: 'binary32',
        },
      ],
    })
    const Image = createImageLibrary({ codecs: [jpegxlCodec, pngCodec] })
    const image = await Image.open(native)
    const output = await image
      .autoOrient()
      .crop({ x: 2, y: 0, width: 1, height: 1 })
      .resize({ width: 2, height: 2, fit: 'fill' })
      .convertPixelFormat({ format: 'gray16', range: { minimum: -1, maximum: 2 } })
      .png()
      .toUint8Array()
    const decoder = await pngCodec.createDecoder?.(new MemorySource(output), defaultImageLimits)
    if (!decoder) throw new Error('Missing mapped float output')
    expect(await collectJpegXlProfileRows(decoder)).toEqual(new Uint8Array(8))
  })
  it('converts float black and rejects unrelated extra channels', async () => {
    const color = [
      { data: Uint8Array.of(255), bitDepth: 8 },
      { data: Uint8Array.of(255), bitDepth: 8 },
      { data: Uint8Array.of(255), bitDepth: 8 },
    ] as const
    const floatBlack = await open(
      await encodeJpegXlNative({
        width: 1,
        height: 1,
        color,
        extraChannels: [
          { type: 4, data: Uint32Array.of(0x3f800000), bitDepth: 32, sampleFormat: 'binary32' },
        ],
        iccProfile: await read('cmyk-pipeline/source.icc'),
      }),
    )
    expect((await collectJpegXlProfileRows(floatBlack)).length).toBe(6)
    await expect(
      open(
        await encodeJpegXlNative({
          width: 1,
          height: 1,
          color: [{ data: Uint32Array.of(0x3f800000), bitDepth: 32, sampleFormat: 'binary32' }],
          extraChannels: [{ type: 1, data: Uint8Array.of(255), bitDepth: 8 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })
})
