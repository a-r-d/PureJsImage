import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import manifest from './fixtures/jpegxl/global-modular/manifest.json' with { type: 'json' }

const base = new URL('./fixtures/jpegxl/global-modular/', import.meta.url)
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
describe('JPEG XL multi-group global Modular transforms', () => {
  it('cancels full-frame Squeeze reconstruction before emitting pixels', async () => {
    const bytes = new Uint8Array(await readFile(new URL('squeeze-16.jxl', base)))
    const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
    if (!decoder) throw new Error('Missing JPEG XL decoder')
    const controller = new AbortController()
    const first = decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]().next()
    setTimeout(() => controller.abort(), 0)
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
  })
  for (const fixture of manifest.fixtures) {
    it(`decodes ${fixture.id} exactly, including partial groups, cross-group crops and replay`, async () => {
      const bytes = new Uint8Array(await readFile(new URL(`${fixture.id}.jxl`, base)))
      const reference = new Uint8Array(
        gunzipSync(await readFile(new URL(`${fixture.id}.rgb.gz`, base))),
      )
      expect(digest(bytes)).toBe(fixture.sha256)
      expect(digest(reference)).toBe(fixture.referenceSha256)
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), defaultImageLimits)
      if (!decoder) throw new Error('Missing JPEG XL decoder')
      expect(decoder.pixelFormat).toBe(fixture.bitDepth === 8 ? 'rgb8' : 'rgb16')
      expect(decoder.execution?.fullFrameFallbackReasons.length).toBe(
        fixture.id.startsWith('squeeze') ? 1 : 0,
      )
      for (const region of [
        { x: 0, y: 0, width: manifest.width, height: manifest.height },
        { x: 249, y: 249, width: 22, height: 10 },
        { x: 512, y: 256, width: 1, height: 3 },
      ]) {
        let row = 0
        const stride = (region.width * 3 * fixture.bitDepth) / 8
        for await (const block of decoder.decode(region)) {
          try {
            expect(block.y).toBe(row)
            for (let y = 0; y < block.height; y++) {
              const offset =
                (((region.y + row + y) * manifest.width + region.x) * 3 * fixture.bitDepth) / 8
              expect(block.data.subarray(y * block.stride, y * block.stride + stride)).toEqual(
                reference.subarray(offset, offset + stride),
              )
            }
            row += block.height
          } finally {
            block.release?.()
          }
        }
        expect(row).toBe(region.height)
      }
      const controller = new AbortController()
      const iterator = decoder.decode({ signal: controller.signal })[Symbol.asyncIterator]()
      const first = await iterator.next()
      if (first.done) throw new Error('Missing first row')
      first.value.release?.()
      controller.abort()
      await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' })
      const replay = decoder.decode({ x: 512, y: 258, width: 1, height: 1 })[Symbol.asyncIterator]()
      expect((await replay.next()).done).toBe(false)
      await replay.return?.(undefined)
    }, 30_000)
  }
  it.each(['palette-8', 'squeeze-16'])(
    'rejects %s working planes before producing a row',
    async (id) => {
      const bytes = new Uint8Array(await readFile(new URL(`${id}.jxl`, base)))
      const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), {
        ...defaultImageLimits,
        maxDecodedBytes: 1_100_000,
      })
      if (!decoder) throw new Error('Missing JPEG XL decoder')
      await expect(decoder.decode()[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        code: 'LIMIT_EXCEEDED',
      })
    },
  )
})
