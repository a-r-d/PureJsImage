import { describe, expect, it } from 'vitest'
import type { RasterBlock } from '../src/raster.ts'
import { ScientificReaderRegistry } from '../src/scientific/reader.ts'
import { createTiffReader } from '../src/scientific/readers/tiff.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'
import manifest from './fixtures/kyfromabove/manifest.json' with { type: 'json' }
const live = process.env.KYFROMABOVE_LIVE === '1'

const collectRaster = async (
  blocks: AsyncIterable<RasterBlock>,
): Promise<readonly RasterBlock[]> => {
  const result: RasterBlock[] = []
  for await (const block of blocks) result.push(block)
  return result
}

describe.skipIf(!live)('live KyFromAbove JPEG COG smoke', () => {
  it('opens pinned four-band JPEG COGs with a bounded viewport read', async () => {
    const pinned = manifest.assets.filter(
      (asset): asset is (typeof manifest.assets)[number] & { href: string } =>
        typeof asset.href === 'string' && asset.samplesPerPixel === 4,
    )
    expect(pinned.map(({ itemId }) => itemId)).toEqual(manifest.liveSmoke.pinnedItemIds)

    for (const asset of pinned) {
      const source = await HttpRangeSource.open(asset.href, {
        blockBytes: 65_536,
        maxCacheBytes: 1_048_576,
      })
      const document = await new ScientificReaderRegistry([
        createTiffReader({
          limits: {
            maxInputBytes: source.size,
            maxPixels: 1_073_741_824,
            maxDecodedBytes: 4_294_967_295,
          },
        }),
      ]).open({
        primary: { id: asset.itemId, name: asset.itemId, source },
      })
      const dataset = await document.openDataset('series-0')
      expect(dataset.descriptor.components).toHaveLength(4)
      expect(dataset.descriptor.components[3]).toMatchObject({ kind: 'scalar' })
      expect(dataset.descriptor.capabilities.resolutionLevels).toBe(true)
      const before = source.stats.bytesFetched
      const blocks = await collectRaster(
        dataset.readPlane({
          displayAxes: ['x', 'y'],
          fixedIndices: [],
          resolutionLevel: Math.max(0, dataset.descriptor.levels.length - 1),
          x: 0,
          y: 0,
          width: 16,
          height: 16,
        }),
      )
      expect(blocks[0]?.format.channels).toBe(4)
      expect(source.stats.bytesFetched - before).toBeLessThan(source.size / 8)
      expect(source.stats.bytesFetched).toBeLessThan(source.size)
    }
  }, 120_000)
})
