import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { encodeJpegXlNative } from '../src/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import manifest from './fixtures/jpegxl/structured-pipeline/manifest.json' with { type: 'json' }
import {
  collectJpegXlProfileRows,
  verifyJpegXlProfilePipeline,
} from './helpers/jpegxl-profile-pipeline.ts'

const root = new URL('./fixtures/jpegxl/structured-pipeline/', import.meta.url)
const read = async (file: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(new URL(file, root)))
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
describe('JPEG XL ordinary structured SDR conversion', () => {
  for (const fixture of manifest.fixtures)
    it(`converts ${fixture.id} with independent colors and exact alpha`, async () => {
      const input = await read(fixture.file)
      const reference = new Uint8Array(
        gunzipSync(await readFile(new URL(`${fixture.id}.bin.gz`, root))),
      )
      expect(digest(input)).toBe(fixture.sha256)
      expect(digest(reference)).toBe(fixture.referenceSha256)
      expect(digest(await read(`${fixture.id}.icc`))).toBe(fixture.sourceProfileSha256)
      const result = await verifyJpegXlProfilePipeline(input, reference, fixture, false)
      expect(result.maximumColor).toBeLessThanOrEqual(fixture.colorTolerance)
      expect(result.maximumAlpha).toBe(0)
    })
  it.each(['gray-linear-16', 'p3-16'])(
    'reserves color tables before allocating %s decoder storage',
    async (id) => {
      const fixture = manifest.fixtures.find((row) => row.id === id)
      if (!fixture) throw new Error('Missing structured fixture')
      await expect(
        jpegxlCodec.createDecoder?.(
          new MemorySource(await read(fixture.file)),
          { ...defaultImageLimits, maxDecodedBytes: 65536 },
          { colorOutput: 'srgb' },
        ),
      ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    },
  )
  it.each(['p3-8', 'rgb-icc'])(
    'reserves legacy 8-bit %s conversion tables and reports their storage',
    async (id) => {
      const input =
        id === 'p3-8'
          ? await read('../m4-color/p3-8.jxl')
          : await encodeJpegXlNative({
              width: 1,
              height: 1,
              color: [
                { data: Uint8Array.of(32), bitDepth: 8 },
                { data: Uint8Array.of(64), bitDepth: 8 },
                { data: Uint8Array.of(128), bitDepth: 8 },
              ],
              iccProfile: await read('../m4-color/oriented-icc.icc'),
            })
      await expect(
        jpegxlCodec.createDecoder?.(
          new MemorySource(input),
          { ...defaultImageLimits, maxDecodedBytes: 8192 },
          { colorOutput: 'srgb' },
        ),
      ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
      const preserved = await jpegxlCodec.createDecoder?.(
        new MemorySource(input),
        { ...defaultImageLimits, maxDecodedBytes: 8192 },
        { colorOutput: 'preserve' },
      )
      const converted = await jpegxlCodec.createDecoder?.(
        new MemorySource(input),
        defaultImageLimits,
        { colorOutput: 'srgb' },
      )
      if (!preserved?.execution || !converted?.execution)
        throw new Error('Missing legacy color memory reports')
      expect(
        converted.execution.estimatedWorkingBytes - preserved.execution.estimatedWorkingBytes,
      ).toBeGreaterThanOrEqual(16_384)
    },
  )
  it.each([
    { id: 'gray8', gray: true, maxDecodedBytes: 4096 },
    { id: 'rgb8-mab', gray: false, maxDecodedBytes: 65536 },
  ])('reserves 8-bit lookup storage for $id under a small budget', async (fixture) => {
    const metadata = fixture.gray
      ? await jpegxlCodec.preservedMetadata?.(
          new MemorySource(await read('../profile-pipeline/gray8-alpha8.jxl')),
          defaultImageLimits,
          { exif: false, icc: true },
        )
      : undefined
    const profile = fixture.gray ? metadata?.icc : await read('../profile-pipeline/rgb-mab.icc')
    if (!profile) throw new Error('Missing lookup profile')
    const gray = { data: Uint8Array.of(128), bitDepth: 8 }
    const input = await encodeJpegXlNative({
      width: 1,
      height: 1,
      color: fixture.gray ? [gray] : [gray, gray, gray],
      iccProfile: profile,
    })
    await expect(
      jpegxlCodec.createDecoder?.(
        new MemorySource(input),
        { ...defaultImageLimits, maxDecodedBytes: fixture.maxDecodedBytes },
        { colorOutput: 'srgb' },
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    const preserved = await jpegxlCodec.createDecoder?.(
      new MemorySource(input),
      { ...defaultImageLimits, maxDecodedBytes: fixture.maxDecodedBytes },
      { colorOutput: 'preserve' },
    )
    if (!preserved) throw new Error('Missing preserved lookup decoder')
    expect(await collectJpegXlProfileRows(preserved)).toEqual(
      fixture.gray ? Uint8Array.of(128) : Uint8Array.of(128, 128, 128),
    )
  })
  it('rejects nonrelative custom-white conversion and preserves its raw samples', async () => {
    const encoded = await encodeJpegXlNative({
      width: 1,
      height: 1,
      color: [
        { data: Uint16Array.of(20000), bitDepth: 16 },
        { data: Uint16Array.of(30000), bitDepth: 16 },
        { data: Uint16Array.of(40000), bitDepth: 16 },
      ],
      colorSemantics: {
        family: 'rgb',
        primaries: 'display-p3',
        transfer: { kind: 'srgb' },
        matrix: 'identity',
        range: 'full',
        alpha: 'none',
        provenance: 'container-signaled',
        renderingIntent: 'absolute',
        chromaticities: { whitePoint: { x: 0.314, y: 0.351 } },
      },
    })
    await expect(
      jpegxlCodec.createDecoder?.(new MemorySource(encoded), defaultImageLimits, {
        colorOutput: 'srgb',
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    const preserved = await jpegxlCodec.createDecoder?.(
      new MemorySource(encoded),
      defaultImageLimits,
      { colorOutput: 'preserve' },
    )
    if (!preserved) throw new Error('Missing preserved custom-white decoder')
    const samples = await collectJpegXlProfileRows(preserved)
    expect(new DataView(samples.buffer).getUint16(0, false)).toBe(20000)
  })
  it('cancels structured rows and can replay the decoder', async () => {
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(await read('custom-12-alpha16-grouped.jxl')),
      defaultImageLimits,
      { colorOutput: 'srgb' },
    )
    if (!decoder) throw new Error('Missing structured decoder')
    const controller = new AbortController()
    const iterator = decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]()
    const row = await iterator.next()
    if (row.done) throw new Error('Missing structured row')
    row.value.release?.()
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect((await collectJpegXlProfileRows(decoder)).length).toBe(1025 * 3 * 8)
  })
})
