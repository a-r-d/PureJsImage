import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { DecoderOptions } from '../src/codec.ts'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import type { PixelColorSemantics } from '../src/color.ts'
import { encodeJpegXlNative } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import manifest from './fixtures/jpegxl/float-color/manifest.json' with { type: 'json' }
import {
  collectJpegXlProfileRows,
  verifyJpegXlProfilePipeline,
} from './helpers/jpegxl-profile-pipeline.ts'

const root = new URL('./fixtures/jpegxl/float-color/', import.meta.url)
const read = async (file: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(new URL(file, root)))
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const open = async (bytes: Uint8Array, options: DecoderOptions = { colorOutput: 'srgb' }) => {
  const decoder = await jpegxlCodec.createDecoder?.(
    new MemorySource(bytes),
    defaultImageLimits,
    options,
  )
  if (!decoder) throw new Error('Missing float color decoder')
  return decoder
}
const semantics: PixelColorSemantics = {
  family: 'gray',
  primaries: 'srgb',
  transfer: { kind: 'linear' },
  matrix: 'identity',
  range: 'full',
  alpha: 'none',
  provenance: 'container-signaled',
}
describe('JPEG XL ordinary float structured SDR conversion', () => {
  for (const fixture of manifest.fixtures)
    it(`converts ${fixture.id} against independent colors and exact alpha`, async () => {
      const bytes = await read(fixture.file)
      const reference = new Uint8Array(gunzipSync(await read(`${fixture.id}.bin.gz`)))
      expect(digest(bytes)).toBe(fixture.sha256)
      expect(digest(reference)).toBe(fixture.referenceSha256)
      expect(digest(await read(`${fixture.id}.icc`))).toBe(fixture.sourceProfileSha256)
      const result = await verifyJpegXlProfilePipeline(bytes, reference, fixture, false)
      expect(result.maximumColor).toBeLessThanOrEqual(fixture.colorTolerance)
      expect(result.maximumAlpha).toBe(0)
    }, 30_000)
  it('preserves source values by default and evaluates floats before one final SDR rounding', async () => {
    const samples = Float32Array.of(-0.25, 0, 0.00001, 0.125, 0.5, 1.5)
    const bytes = await encodeJpegXlNative({
      width: samples.length,
      height: 1,
      color: [{ data: new Uint32Array(samples.buffer), bitDepth: 32, sampleFormat: 'binary32' }],
      colorSemantics: semantics,
    })
    const preserved = await open(bytes, {})
    expect(preserved.pixelFormat).toBe('grayf32')
    expect(preserved.execution?.precisionLoss).toBe(false)
    const raw = new DataView((await collectJpegXlProfileRows(preserved)).buffer)
    for (let index = 0; index < samples.length; index++)
      expect(raw.getFloat32(index * 4, false)).toBe(samples[index])
    const decoder = await open(bytes)
    const converted = new DataView((await collectJpegXlProfileRows(decoder)).buffer)
    expect(decoder.pixelFormat).toBe('gray16')
    expect(decoder.execution?.conversions).toContain('clip-float-to-sdr')
    expect(decoder.execution?.precisionLoss).toBe(true)
    expect(converted.getUint16(0, false)).toBe(0)
    expect(converted.getUint16(4, false)).toBe(8) // UInt16 input rounding would produce 13.
    expect(converted.getUint16(10, false)).toBe(65535)
  })
  it('straightens source alpha before SDR clipping and handles zero alpha', async () => {
    const values = Float32Array.of(0.75, 0.25, 0.125)
    const alpha = Float32Array.of(0.5, 0, 0.5)
    const bytes = await encodeJpegXlNative({
      width: 3,
      height: 1,
      color: [{ data: new Uint32Array(values.buffer), bitDepth: 32, sampleFormat: 'binary32' }],
      extraChannels: [
        {
          type: 0,
          data: new Uint32Array(alpha.buffer),
          bitDepth: 32,
          sampleFormat: 'binary32',
          associatedAlpha: true,
        },
      ],
      colorSemantics: { ...semantics, alpha: 'premultiplied' },
    })
    const decoder = await open(bytes)
    const output = new DataView((await collectJpegXlProfileRows(decoder)).buffer)
    expect(decoder.colorSemantics?.alpha).toBe('straight')
    expect(decoder.execution?.conversions).toContain('unpremultiply-alpha')
    expect(output.getUint16(0, false)).toBe(65535)
    expect(output.getUint16(6, false)).toBe(32768)
    expect(output.getUint16(8, false)).toBe(0)
    expect(output.getUint16(14, false)).toBe(0)
    expect(output.getUint16(16, false)).toBe(35199)
  })
  it.each([0x7f800000, 0xff800000, 0x7fc00000])(
    'rejects nonfinite source pattern %i',
    async (bits) => {
      const bytes = await encodeJpegXlNative({
        width: 1,
        height: 1,
        color: [{ data: Uint32Array.of(bits), bitDepth: 32, sampleFormat: 'binary32' }],
        colorSemantics: semantics,
      })
      await expect(collectJpegXlProfileRows(await open(bytes))).rejects.toMatchObject({
        code: 'INVALID_INPUT',
      })
    },
  )
  it.each(['pq', 'hlg'] as const)(
    'preserves encoded %s and rejects float HDR display conversion',
    async (kind) => {
      const bytes = await encodeJpegXlNative({
        width: 1,
        height: 1,
        color: [{ data: Uint32Array.of(0x3f000000), bitDepth: 32, sampleFormat: 'binary32' }],
        colorSemantics: { ...semantics, transfer: { kind } },
      })
      await expect(open(bytes)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
      expect((await open(bytes, {})).pixelFormat).toBe('grayf32')
    },
  )
  it('converts supported float ICC and rejects nonrelative custom conversion while preserving source samples', async () => {
    for (const colorSemantics of [
      undefined,
      {
        ...semantics,
        family: 'rgb',
        primaries: 'display-p3',
        renderingIntent: 'absolute',
        chromaticities: { whitePoint: { x: 0.314, y: 0.351 } },
      },
    ] satisfies (PixelColorSemantics | undefined)[]) {
      const sample = {
        data: Uint32Array.of(0x3f000000),
        bitDepth: 32,
        sampleFormat: 'binary32',
      } as const
      const bytes = await encodeJpegXlNative({
        width: 1,
        height: 1,
        color: [sample, sample, sample],
        ...(colorSemantics
          ? { colorSemantics }
          : { iccProfile: await read('../m4-color/oriented-icc.icc') }),
      })
      if (colorSemantics)
        await expect(open(bytes)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
      else expect((await open(bytes)).pixelFormat).toBe('rgb16')
      expect((await open(bytes, { colorOutput: 'preserve' })).pixelFormat).toBe('rgbf32')
    }
  })
  it('reserves bounded matrix scratch before native allocation and supports cancellation/replay', async () => {
    const input = await read('p3-16-alpha16-associated-grouped.jxl')
    await expect(
      jpegxlCodec.createDecoder?.(
        new MemorySource(input),
        { ...defaultImageLimits, maxDecodedBytes: 4096 },
        { colorOutput: 'srgb' },
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    const decoder = await open(input)
    const preserved = await open(input, {})
    expect(
      (decoder.execution?.estimatedWorkingBytes ?? 0) -
        (preserved.execution?.estimatedWorkingBytes ?? 0),
    ).toBeLessThanOrEqual(4096)
    const small = await read('gray16-linear.jxl')
    await expect(
      jpegxlCodec.createDecoder?.(
        new MemorySource(small),
        { ...defaultImageLimits, maxDecodedBytes: 4096 },
        { colorOutput: 'srgb' },
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    const raw = await jpegxlCodec.createDecoder?.(new MemorySource(small), {
      ...defaultImageLimits,
      maxDecodedBytes: 4096,
    })
    if (!raw) throw new Error('Missing budgeted raw float decoder')
    expect((await collectJpegXlProfileRows(raw)).length).toBe(8 * 4)
    const controller = new AbortController()
    const iterator = decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]()
    const row = await iterator.next()
    if (row.done) throw new Error('Missing float SDR row')
    row.value.release?.()
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect((await collectJpegXlProfileRows(decoder)).length).toBe(1025 * 3 * 8)
  })
})
