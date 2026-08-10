import { describe, expect, it } from 'vitest'
import { compareTiffFile, tiffCompetitorEngines } from '../scripts/compare-tiff-worker.ts'

describe('TIFF competitor conformance harness', () => {
  it('scores every competitor against independent exact RGBA output', async () => {
    const results = await Promise.all(
      tiffCompetitorEngines.map(async (engine) => ({
        engine,
        result: await compareTiffFile(engine, 'benchmark/corpus/files/libtiff-rgb-3c-8b.tiff'),
      })),
    )

    expect(results.map(({ engine, result }) => ({ engine, status: result.status }))).toEqual(
      tiffCompetitorEngines.map((engine) => ({ engine, status: 'success' })),
    )
    for (const { result } of results) {
      if (result.status !== 'success') throw new Error(`Unexpected result: ${result.status}`)
      expect(result.exact).toBe(true)
      expect(result.mismatchedPixels).toBe(0)
      expect(result.maximumChannelDelta).toBe(0)
      expect(result.rootMeanSquareError).toBe(0)
    }
  })
})
