import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'

import { avifStagedAlphaFixtures } from '../benchmark/avif/alpha-fixtures.ts'
import {
  avifAuxiliaryFixtureDirectory,
  avifExpandedAlphaFixtures,
} from '../benchmark/avif/auxiliary-fixtures.ts'
import { avifCodec, inspectAvifBitstreams, validateAvifWorkingBytes } from '../src/codecs/avif.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import { Image } from './image-library.ts'

describe('AVIF expanded alpha decode', () => {
  it.each(avifStagedAlphaFixtures)(
    'decodes staged full-frame color and alpha from $file below the codec limit',
    async (fixture) => {
      const input = new Uint8Array(
        await readFile(join(avifAuxiliaryFixtureDirectory, fixture.file)),
      )
      const inspection = await inspectAvifBitstreams(new MemorySource(input))
      const decoder = await avifCodec.createDecoder?.(new MemorySource(input), defaultImageLimits)
      if (!decoder) throw new Error('AVIF decoder is unavailable')
      const color = inspection.codedImages.find((image) => image.role === 'color')
      const alpha = inspection.codedImages.find((image) => image.role === 'alpha')
      const hash = createHash('sha256')
      let nextY = 0
      for await (const block of decoder.decode()) {
        expect(block).toMatchObject({
          x: 0,
          y: nextY,
          width: fixture.width,
          stride: fixture.width * 4,
          format: 'rgba8',
        })
        expect(block.height).toBeLessThanOrEqual(32)
        nextY += block.height
        hash.update(block.data)
      }

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect([decoder.width, decoder.height, nextY]).toEqual([
        fixture.width,
        fixture.height,
        fixture.height,
      ])
      expect(color).toBeDefined()
      expect(alpha?.sequence).toMatchObject({ chromaSubsampling: '400', monochrome: true })
      expect(fixture.retainedAlphaBytes).toBeLessThan(fixture.colorPhaseWorkingBytes)
      expect(() => validateAvifWorkingBytes(fixture.colorPhaseWorkingBytes)).not.toThrow()
      expect(hash.digest('hex')).toBe(fixture.decodedRgbaSha256)
    },
    60_000,
  )

  it.each(avifExpandedAlphaFixtures)(
    'decodes $alphaBitDepth-bit $alphaFullRange alpha from $file',
    async (fixture) => {
      const input = await readFile(join(avifAuxiliaryFixtureDirectory, fixture.file))
      const inspection = await inspectAvifBitstreams(new MemorySource(input))
      const alpha = inspection.codedImages.find((image) => image.role === 'alpha')
      const image = await Image.open(input)
      const metadata = await image.metadata()
      const output = PNG.sync.read(await image.png().toBuffer())

      expect(createHash('sha256').update(input).digest('hex')).toBe(fixture.fileSha256)
      expect(alpha?.sequence).toMatchObject({
        bitDepth: fixture.alphaBitDepth,
        fullRange: fixture.alphaFullRange,
        monochrome: true,
      })
      expect(metadata.hasAlpha).toBe(true)
      expect([output.width, output.height]).toEqual([fixture.width, fixture.height])
      expect(createHash('sha256').update(output.data).digest('hex')).toBe(fixture.decodedRgbaSha256)
      if (fixture.decodedAlphaSha256) {
        const alphaSamples = new Uint8Array(output.width * output.height)
        for (let index = 0, offset = 3; index < alphaSamples.length; index += 1, offset += 4) {
          alphaSamples[index] = output.data[offset] ?? 0
        }
        expect(createHash('sha256').update(alphaSamples).digest('hex')).toBe(
          fixture.decodedAlphaSha256,
        )
      }
    },
  )
})
