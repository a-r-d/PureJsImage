import { describe, expect, it } from 'vitest'
import { verifyGroupedLosslessSearch } from './helpers/jpegxl-grouped-search.ts'

describe('JPEG XL optional grouped lossless search', () => {
  for (const width of [512, 513] as const)
    for (const effort of [1, 7] as const)
      it(`preserves every RGBA sample at width ${width}, effort ${effort}`, async () => {
        const result = await verifyGroupedLosslessSearch(width, effort)
        expect(result).toMatchObject({
          width,
          effort,
          samples: width * 512 * 4,
          ownedLive: 0,
          ownedAllocations: 0,
        })
        expect(result.bytes).toBeGreaterThan(0)
      }, 60_000)
})
