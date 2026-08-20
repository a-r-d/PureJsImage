import { describe, expect, it } from 'vitest'
import { loadDocsDevAsset } from '../scripts/docs-dev-assets.ts'

describe('docs development assets', () => {
  it('builds the OME-Zarr viewer and worker as JavaScript modules', async () => {
    for (const pathname of ['/assets/ome-zarr-viewer.js', '/assets/ome-zarr-worker.js']) {
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

  it('leaves unrelated routes to Astro', async () => {
    await expect(loadDocsDevAsset('/ome-zarr/')).resolves.toBeUndefined()
  })
})
