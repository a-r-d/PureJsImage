import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { inspectJpegXlVarDctStrategyIds } from '../benchmark/jpegxl/inspect-vardct-strategies.ts'
import { readJpegXlSourceFrameStructures } from '../src/codecs/jpegxl-decode.ts'
import { defaultImageLimits } from '../src/limits.ts'
import { MemorySource } from '../src/source.ts'
import manifest from './fixtures/jpegxl/modular-dc-alpha/manifest.json' with { type: 'json' }
import { verifyJpegXlModularDcAlpha } from './helpers/jpegxl-modular-dc-alpha.ts'

const root = new URL('./fixtures/jpegxl/modular-dc-alpha/', import.meta.url)
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

describe('JPEG XL internal Modular DC alpha dependencies', () => {
  for (const fixture of manifest.fixtures)
    it(`reconstructs ${fixture.id} DC dependencies through ordinary, session and sequence APIs`, async () => {
      const input = new Uint8Array(await readFile(new URL(fixture.file, root)))
      const compressed = await readFile(new URL(`${fixture.id}.rgba.gz`, root))
      const reference = gunzipSync(compressed)
      expect(digest(input)).toBe(fixture.encodedSha256)
      expect(digest(compressed)).toBe(fixture.compressedReferenceSha256)
      expect(digest(reference)).toBe(fixture.referenceSha256)
      const frames = await readJpegXlSourceFrameStructures(
        new MemorySource(input),
        defaultImageLimits,
      )
      const dc = frames.find((frame) => frame.frameType === 'dc')
      expect(dc).toMatchObject({
        encoding: 'modular',
        codedWidth: fixture.dcWidth,
        codedHeight: fixture.dcHeight,
        dcLevel: fixture.dcLevel,
        alphaBitDepth: 8,
      })
      expect(dc?.extraChannels.map((channel) => channel.type)).toEqual([0])
      expect(dc?.sections.map((section) => section.length)).toEqual(fixture.dcSections)
      expect(dc?.sections.slice(1).some((section) => section.length > 0)).toBe(fixture.grouped)
      expect(await inspectJpegXlVarDctStrategyIds(new MemorySource(input), frames)).toEqual(
        fixture.grouped ? [5, 6, 11, 19] : [0, 5, 6, 7],
      )
      const result = await verifyJpegXlModularDcAlpha(
        input,
        reference,
        fixture.width,
        fixture.height,
      )
      expect(result.maximumColor).toBeLessThanOrEqual(manifest.tolerance.color)
      expect(result.maximumAlpha).toBe(manifest.tolerance.alpha)
      expect(result.rows).toBe(fixture.height)
      expect(digest(input)).toBe(fixture.encodedSha256)
    })
})
