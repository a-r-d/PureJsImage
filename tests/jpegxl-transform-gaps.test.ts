import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { inspectJpegXlVarDctStrategyIds } from '../benchmark/jpegxl/inspect-vardct-strategies.ts'
import { inspectJpegXlStructure, jpegxlCodec } from '../src/codecs/jpegxl.ts'
import { JpegXlCodestreamSource } from '../src/codecs/jpegxl-container.ts'
import { readJpegXlSourceFrameStructures } from '../src/codecs/jpegxl-decode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import manifest from './fixtures/jpegxl/transform-gaps/manifest.json' with { type: 'json' }
import { verifyJpegXlTransformFrame } from './helpers/jpegxl-transform-gaps.ts'

const base = new URL('./fixtures/jpegxl/transform-gaps/', import.meta.url)
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

describe('JPEG XL legal rectangular and large VarDCT transforms', () => {
  for (const fixture of manifest.fixtures) {
    it(`matches independent pixels for strategy ${fixture.strategy}, including cross-group crops and replay`, async () => {
      const bytes = new Uint8Array(await readFile(new URL(fixture.file, base)))
      const reference = gunzipSync(
        await readFile(new URL(`strategy-${fixture.strategy}.rgb.gz`, base)),
      )
      expect(digest(bytes)).toBe(fixture.sha256)
      expect(digest(reference)).toBe(fixture.referenceSha256)
      const source = new MemorySource(bytes)
      const logical = new JpegXlCodestreamSource(source, await inspectJpegXlStructure(source))
      const frames = await readJpegXlSourceFrameStructures(logical, defaultImageLimits)
      expect(await inspectJpegXlVarDctStrategyIds(logical, frames)).toContain(fixture.strategy)
      const fullPlanes = await verifyJpegXlTransformFrame(bytes, reference)
      expect(fullPlanes.maximum).toBeLessThanOrEqual(1)
      expect(fullPlanes.rmse).toBeLessThanOrEqual(0.55)
      for (const region of [
        { x: 0, y: 0, width: manifest.width, height: manifest.height },
        { x: 249, y: 249, width: 22, height: 10 },
        { x: 500, y: 250, width: 13, height: 9 },
      ]) {
        const decoder = await jpegxlCodec.createDecoder?.(
          new MemorySource(bytes),
          defaultImageLimits,
        )
        if (!decoder) throw new Error('JPEG XL decoder unavailable')
        expect(decoder.pixelFormat).toBe('rgb8')
        let row = 0,
          maximum = 0,
          squared = 0,
          samples = 0
        for await (const block of decoder.decode(region)) {
          try {
            expect(block.y).toBe(row)
            for (let y = 0; y < block.height; y++)
              for (let x = 0; x < region.width * 3; x++) {
                const expected =
                  reference[((region.y + row + y) * manifest.width + region.x) * 3 + x] ?? 0
                const error = Math.abs((block.data[y * block.stride + x] ?? 0) - expected)
                maximum = Math.max(maximum, error)
                squared += error * error
                samples++
              }
            row += block.height
          } finally {
            block.release?.()
          }
        }
        expect(row).toBe(region.height)
        expect(maximum).toBeLessThanOrEqual(1)
        expect(Math.sqrt(squared / samples)).toBeLessThanOrEqual(0.55)
      }
    }, 30_000)
  }
  it('rejects large-transform scratch before producing pixels under a small working budget', async () => {
    const bytes = new Uint8Array(await readFile(new URL('strategy-24.jxl', base)))
    await expect(
      (async () => {
        const decoder = await jpegxlCodec.createDecoder?.(new MemorySource(bytes), {
          ...defaultImageLimits,
          maxDecodedBytes: 1_000_000,
        })
        if (!decoder) throw new Error('JPEG XL decoder unavailable')
        return decoder.decode()[Symbol.asyncIterator]().next()
      })(),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
  })
})
