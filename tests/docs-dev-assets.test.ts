import { describe, expect, it } from 'vitest'
import { loadDocsDevAsset } from '../scripts/docs-dev-assets.ts'

describe('docs development assets', () => {
  it('builds the OME-Zarr and Geo viewers and workers as JavaScript modules', async () => {
    for (const pathname of [
      '/assets/ome-zarr-viewer.js',
      '/assets/ome-zarr-worker.js',
      '/assets/geo-showcase.js',
      '/assets/geo-showcase-worker.js',
    ]) {
      const asset = await loadDocsDevAsset(pathname)
      expect(asset?.contentType).toBe('text/javascript; charset=utf-8')
      expect(asset?.body.byteLength).toBeGreaterThan(0)
      expect(new TextDecoder().decode(asset?.body)).not.toContain('<!doctype html>')
    }
  })

  it('serves accelerator binaries with the WebAssembly MIME type', async () => {
    const asset = await loadDocsDevAsset('/assets/jpeg-decoder.wasm')
    expect(asset?.contentType).toBe('application/wasm')
    expect(Array.from(asset?.body.subarray(0, 4) ?? [])).toEqual([0, 97, 115, 109])
  })

  it('serves the generated OME-Zarr Feature Tour as a range-capable same-origin store', async () => {
    const asset = await loadDocsDevAsset('/fixtures/ome-zarr-feature-tour/zarr.json')
    expect(asset?.contentType).toBe('application/json; charset=utf-8')
    expect(asset?.rangeCapable).toBe(true)
    expect(JSON.parse(new TextDecoder().decode(asset?.body))).toMatchObject({ zarr_format: 3 })
    await expect(
      loadDocsDevAsset('/fixtures/ome-zarr-feature-tour/not-present'),
    ).resolves.toBeUndefined()
  })

  it('serves the Geo showcase fixtures as range-capable same-origin sources', async () => {
    const cog = await loadDocsDevAsset('/fixtures/geo/overview-cog.tif')
    expect(cog?.contentType).toBe('image/tiff')
    expect(cog?.rangeCapable).toBe(true)
    expect(new TextDecoder().decode(cog?.body.subarray(0, 4))).toBe('II*\u0000')

    const zarr = await loadDocsDevAsset('/fixtures/geo/geozarr-cube/zarr.json')
    expect(zarr?.contentType).toBe('application/json; charset=utf-8')
    expect(zarr?.rangeCapable).toBe(true)
    expect(JSON.parse(new TextDecoder().decode(zarr?.body))).toMatchObject({ zarr_format: 3 })

    const zarrChunk = await loadDocsDevAsset('/fixtures/geo/geozarr-cube/fine/c.0.0.0.0')
    expect(zarrChunk?.contentType).toBe('application/octet-stream')
    expect(Array.from(zarrChunk?.body.subarray(0, 4) ?? [])).toEqual([25, 30, 35, 40])

    await expect(loadDocsDevAsset('/fixtures/geo/not-present')).resolves.toBeUndefined()
  })

  it('leaves unrelated routes to Astro', async () => {
    await expect(loadDocsDevAsset('/ome-zarr/')).resolves.toBeUndefined()
  })
})
