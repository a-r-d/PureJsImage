import { describe, expect, it } from 'vitest'

import {
  createOmeZarrHttpContext,
  normalizeOmeZarrStoreUrl,
  OmeZarrHttpStore,
  resolveOmeZarrObjectUrl,
} from '../src/scientific/browser.ts'

interface MockStore {
  readonly fetch: typeof fetch
  readonly requests: readonly { readonly method: string; readonly path: string }[]
}

const mockStore = (
  files: Readonly<Record<string, Uint8Array>>,
  options: {
    readonly missingStatus?: Readonly<Record<string, 404 | 410>>
    readonly rangeStatus?: number
  } = {},
): MockStore => {
  const requests: { method: string; path: string }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const path = url.pathname.replace('/store/', '')
    const method = init?.method ?? 'GET'
    requests.push({ method, path })
    const missingStatus = options.missingStatus?.[path]
    if (missingStatus !== undefined) return new Response(null, { status: missingStatus })
    const bytes = files[path]
    if (bytes === undefined) return new Response(null, { status: 404 })
    if (method === 'HEAD') {
      return new Response(null, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) },
      })
    }
    const rawRange = new Headers(init?.headers).get('range')
    const match = rawRange?.match(/^bytes=(\d+)-(\d+)$/u)
    if (match === undefined || match === null) return new Response(null, { status: 400 })
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: options.rangeStatus ?? 206,
      headers: {
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${bytes.byteLength}`,
      },
    })
  }
  return { fetch: fetcher, requests }
}

describe('OME-Zarr HTTP store URL handling', () => {
  it('normalizes store roots and exact v3 and v2 root metadata URLs', () => {
    expect(normalizeOmeZarrStoreUrl('https://example.test/data/image.zarr')).toEqual({
      storeRootUrl: 'https://example.test/data/image.zarr/',
      primaryMetadataName: 'zarr.json',
    })
    expect(
      normalizeOmeZarrStoreUrl('https://example.test/data/image.zarr/zarr.json?token=one'),
    ).toEqual({
      storeRootUrl: 'https://example.test/data/image.zarr/?token=one',
      primaryMetadataName: 'zarr.json',
    })
    expect(normalizeOmeZarrStoreUrl('https://example.test/v2/.zgroup')).toEqual({
      storeRootUrl: 'https://example.test/v2/',
      primaryMetadataName: '.zgroup',
    })
    expect(normalizeOmeZarrStoreUrl('https://example.test/v2/.zattrs')).toEqual({
      storeRootUrl: 'https://example.test/v2/',
      primaryMetadataName: '.zattrs',
    })
  })

  it('rejects traversal, absolute companions, protocol escape, credentials, and fragments', async () => {
    expect(() => resolveOmeZarrObjectUrl('https://example.test/store/', '../secret')).toThrow(
      'must not contain',
    )
    expect(() =>
      resolveOmeZarrObjectUrl('https://example.test/store/', 'https://evil.test/zarr.json'),
    ).toThrow('normalized relative name')
    expect(() =>
      resolveOmeZarrObjectUrl('https://example.test/store/', 'http://example.test/zarr.json'),
    ).toThrow('normalized relative name')
    expect(() => normalizeOmeZarrStoreUrl('https://user@example.test/store')).toThrow('credentials')
    expect(() => normalizeOmeZarrStoreUrl('https://example.test/store#level')).toThrow('fragment')

    const mocked = mockStore({ 'zarr.json': Uint8Array.of(1) })
    const store = new OmeZarrHttpStore('https://example.test/store', { fetch: mocked.fetch })
    await expect(store.resolve({ kind: 'relative-name', name: '../outside' })).rejects.toThrow(
      'must not contain',
    )
  })
})

describe('OME-Zarr HTTP object resolution', () => {
  it('creates a reader-ready public context with an owning store', async () => {
    const mocked = mockStore({ 'zarr.json': Uint8Array.of(123, 125) })
    const context = await createOmeZarrHttpContext('https://example.test/store', {
      fetch: mocked.fetch,
    })
    expect(context.primary.name).toBe('zarr.json')
    expect(context.companions).toBe(context.store)
    expect(context.readerId).toBe('purejsimage/ome-zarr')
    context.store.close()
    await expect(context.primary.source.read(0, 1)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('honors an already-aborted store lifetime without issuing a request', async () => {
    const controller = new AbortController()
    controller.abort()
    const mocked = mockStore({ 'zarr.json': Uint8Array.of(1) })
    const store = new OmeZarrHttpStore('https://example.test/store', {
      fetch: mocked.fetch,
      signal: controller.signal,
    })
    await expect(store.openContext()).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocked.requests).toEqual([])
  })

  it.each([404, 410] as const)('returns undefined for an HTTP %s companion', async (status) => {
    const mocked = mockStore(
      { 'zarr.json': Uint8Array.of(1) },
      { missingStatus: { 'missing/zarr.json': status } },
    )
    const store = new OmeZarrHttpStore('https://example.test/store', { fetch: mocked.fetch })
    await expect(
      store.resolve({ kind: 'relative-name', name: 'missing/zarr.json' }),
    ).resolves.toBeUndefined()
  })

  it('rejects a remote object that does not honor byte ranges', async () => {
    const mocked = mockStore({ 'zarr.json': Uint8Array.of(1, 2) }, { rangeStatus: 200 })
    const store = new OmeZarrHttpStore('https://example.test/store', { fetch: mocked.fetch })
    await expect(store.openContext()).rejects.toThrow('must support byte ranges')
  })

  it('aggregates source statistics and resets baselines without clearing caches', async () => {
    const mocked = mockStore({
      'zarr.json': Uint8Array.from({ length: 20 }, (_value, index) => index),
      '0/zarr.json': Uint8Array.from({ length: 40 }, (_value, index) => index + 20),
    })
    const store = new OmeZarrHttpStore('https://example.test/store', {
      blockBytes: 8,
      fetch: mocked.fetch,
      maxCacheBytesPerSource: 16,
    })
    const context = await store.openContext()
    const level = await store.resolve({ kind: 'relative-name', name: '0/zarr.json' })
    if (level === undefined) throw new Error('Expected the level metadata object')
    await level.source.read(8, 4)
    await level.source.read(9, 2)
    const measured = store.stats()
    expect(measured).toMatchObject({
      objectRequests: 5,
      rangeRequests: 3,
      objectsOpened: 2,
      bytesFetched: 10,
      uniqueBytes: 10,
      sourceCacheHits: 1,
      metadataBytesFetched: 10,
      arrayBytesFetched: 0,
    })
    expect(measured.sourceCacheBytes).toBe(8)
    expect(context.primary.name).toBe('zarr.json')

    store.resetStats()
    expect(store.stats()).toEqual({
      objectRequests: 0,
      rangeRequests: 0,
      bytesFetched: 0,
      uniqueBytes: 0,
      metadataBytesFetched: 0,
      arrayBytesFetched: 0,
      sourceCacheHits: 0,
      sourceCacheBytes: 8,
      coalescedConsumers: 0,
      abortedConsumers: 0,
      objectsOpened: 0,
    })
    await level.source.read(10, 1)
    expect(store.stats().sourceCacheHits).toBe(1)
    expect(store.stats().objectRequests).toBe(0)
  })

  it('evicts opened object sources with a bounded LRU', async () => {
    const mocked = mockStore({
      'zarr.json': Uint8Array.of(1),
      'a/zarr.json': Uint8Array.of(2),
      'b/zarr.json': Uint8Array.of(3),
    })
    const store = new OmeZarrHttpStore('https://example.test/store', {
      fetch: mocked.fetch,
      maxOpenSources: 2,
    })
    const context = await store.openContext()
    await store.resolve({ kind: 'relative-name', name: 'a/zarr.json' })
    await store.resolve({ kind: 'relative-name', name: 'b/zarr.json' })
    await store.resolve({ kind: 'relative-name', name: 'zarr.json' })
    expect(store.stats().objectsOpened).toBe(4)
    expect(
      mocked.requests.filter(
        (request) => request.method === 'HEAD' && request.path === 'zarr.json',
      ),
    ).toHaveLength(2)

    const beforeRetiredRead = store.stats()
    await context.primary.source.read(0, 1)
    expect(store.stats()).toMatchObject({
      bytesFetched: beforeRetiredRead.bytesFetched + 1,
      objectRequests: beforeRetiredRead.objectRequests + 1,
      rangeRequests: beforeRetiredRead.rangeRequests + 1,
    })
  })
})
