import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { pngCodec } from '../src/codecs/png.ts'
import { createImageLibrary } from '../src/index.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import manifest from './fixtures/jpegxl/profile-pipeline/manifest.json' with { type: 'json' }
import {
  collectJpegXlProfileRows,
  verifyJpegXlProfilePipeline,
} from './helpers/jpegxl-profile-pipeline.ts'

const root = new URL('./fixtures/jpegxl/profile-pipeline/', import.meta.url)
const read = async (id: string): Promise<Uint8Array> =>
  new Uint8Array(await readFile(new URL(`${id}.jxl`, root)))
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
describe('JPEG XL ordinary profile conversion', () => {
  for (const fixture of manifest.fixtures)
    it(`converts ${fixture.id} through ordinary decoding, PNG and native re-encode`, async () => {
      const input = await read(fixture.id)
      const reference = new Uint8Array(
        gunzipSync(await readFile(new URL(`${fixture.id}.bin.gz`, root))),
      )
      expect(digest(input)).toBe(fixture.sha256)
      expect(digest(reference)).toBe(fixture.referenceSha256)
      const result = await verifyJpegXlProfilePipeline(input, reference, fixture)
      expect(result.maximumColor).toBeLessThanOrEqual(fixture.colorTolerance)
      expect(result.maximumAlpha).toBe(0)
    })
  it('keeps adjacent 16-bit source colors distinct after conversion', async () => {
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(await read('gray16-adjacent')),
      defaultImageLimits,
      { colorOutput: 'srgb' },
    )
    if (!decoder) throw new Error('Missing decoder')
    const bytes = await collectJpegXlProfileRows(decoder)
    const view = new DataView(bytes.buffer)
    expect(view.getUint16(0, false)).toBe(28632)
    expect(view.getUint16(2, false)).toBe(28634)
  })
  it('rejects attaching a gray source profile to expanded RGBA output', async () => {
    const bytes = await read('gray8-alpha8')
    const Image = createImageLibrary([jpegxlCodec])
    for (const options of [{ colorOutput: 'preserve' }, { preserveIcc: true }] as const)
      await expect(
        jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits, options),
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
    await expect((await Image.open(bytes)).keepIcc().jpegxl().toBuffer()).rejects.toMatchObject({
      code: 'UNSUPPORTED_OPERATION',
    })
    await expect(
      (await Image.open(bytes, { colorOutput: 'srgb' })).keepIcc().jpegxl().toBuffer(),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION' })
  })
  it.each(['gray16-adjacent', 'rgb16'])(
    'reserves profile tables before decoding %s under a small budget',
    async (id) => {
      await expect(
        jpegxlCodec.createDecoder?.(
          new MemorySource(await read(id)),
          { ...defaultImageLimits, maxDecodedBytes: 65536 },
          { colorOutput: 'srgb' },
        ),
      ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    },
  )
  it.each(['gray16-adjacent', 'rgb16'])(
    'preserves %s source-profile samples into compatible PNG',
    async (id) => {
      const input = await read(id)
      const source = new MemorySource(input)
      const decoder = await jpegxlCodec.createDecoder?.(source, defaultImageLimits, {
        colorOutput: 'preserve',
      })
      if (!decoder) throw new Error('Missing decoder')
      expect(decoder.colorSemantics).toMatchObject({
        provenance: 'icc',
        icc: { relevance: 'emitted-pixels' },
      })
      const original = await collectJpegXlProfileRows(decoder)
      const Image = createImageLibrary([jpegxlCodec, pngCodec])
      const output = await (await Image.open(input, { colorOutput: 'preserve' }))
        .keepIcc()
        .png()
        .toBuffer()
      const png = new MemorySource(output)
      const reopened = await pngCodec.createDecoder?.(png, defaultImageLimits, {
        preserveIcc: true,
      })
      if (!reopened) throw new Error('Missing PNG decoder')
      expect(await collectJpegXlProfileRows(reopened)).toEqual(original)
      const originalProfile = await jpegxlCodec.preservedMetadata?.(source, defaultImageLimits, {
        exif: false,
        icc: true,
      })
      const retainedProfile = await pngCodec.preservedMetadata?.(png, defaultImageLimits, {
        exif: false,
        icc: true,
      })
      expect(retainedProfile?.icc).toEqual(originalProfile?.icc)
      const fixture = manifest.fixtures.find((row) => row.id === id)
      if (!originalProfile?.icc || !fixture) throw new Error('Missing pinned ICC profile')
      expect(digest(originalProfile.icc)).toBe(fixture.profileSha256)
    },
  )
  it('combines the gray profile budget with native working storage', async () => {
    await expect(
      jpegxlCodec.createDecoder?.(
        new MemorySource(await read('gray16-adjacent')),
        { ...defaultImageLimits, maxDecodedBytes: 131072 },
        { colorOutput: 'srgb' },
      ),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
  it('cancels converted rows and can replay the same decoder', async () => {
    const decoder = await jpegxlCodec.createDecoder?.(
      new MemorySource(await read('gray10-alpha8-grouped')),
      defaultImageLimits,
      { colorOutput: 'srgb' },
    )
    if (!decoder) throw new Error('Missing decoder')
    const controller = new AbortController()
    const iterator = decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]()
    const row = await iterator.next()
    if (row.done) throw new Error('Missing row')
    row.value.release?.()
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
    expect((await collectJpegXlProfileRows(decoder)).length).toBe(1025 * 3 * 8)
  })
})
