import { describe, expect, it } from 'vitest'
import { runCogViewportBenchmark } from '../benchmark/cog/run-viewport.ts'

describe('COG viewport benchmark', () => {
  it('asserts overview selection and reads a simulated remote viewport without the full source', async () => {
    const result = await runCogViewportBenchmark({
      space: 'pixel',
      viewport: [0, 0, 32, 32],
      outputWidth: 8,
      outputHeight: 8,
      expectedOverviewLevel: 1,
    })
    expect(result).toMatchObject({
      viewportSpace: 'pixel',
      selectedOverviewLevel: 1,
      selectedOverviewDimensions: { width: 16, height: 16 },
      selectedPixelViewport: { x: 0, y: 0, width: 16, height: 16 },
      tileDimensions: { width: 8, height: 8 },
      decodedPixels: 256,
      warmDecodedPixels: 256,
    })
    expect(result.bytesFetched).toBeLessThan(result.sourceBytes)
    expect(result.requests).toBeGreaterThan(1)
    expect(result.cacheHits).toBeGreaterThan(0)
    expect(result.timeToFirstDecodedTileMs).toBeGreaterThanOrEqual(0)
  })

  it('accepts a model-space viewport and still selects the asserted overview', async () => {
    const result = await runCogViewportBenchmark({
      space: 'model',
      outputWidth: 8,
      outputHeight: 8,
      expectedOverviewLevel: 1,
    })
    expect(result.viewportSpace).toBe('model')
    expect(result.selectedOverviewLevel).toBe(1)
    expect(result.basePixelViewport).toEqual({ x: 0, y: 0, width: 32, height: 32 })
    expect(result.bytesFetched).toBeLessThan(result.sourceBytes)
  })
})
