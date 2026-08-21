import { describe, expect, it } from 'vitest'

import {
  createOmeZarrHttpContext,
  normalizeOmeZarrStoreUrl,
  OmeZarrHttpStore,
  resolveOmeZarrObjectUrl,
} from '../src/scientific/browser.ts'
import { omeZarrReader } from '../src/scientific/readers/ome-zarr.ts'

const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

interface MockStore {
  readonly fetch: typeof fetch
  readonly requests: readonly { readonly method: string; readonly path: string }[]
}

const mockStore = (
  files: Readonly<Record<string, Uint8Array>>,
  options: {
    readonly hideContentRange?: boolean
    readonly headStatus?: number
    readonly missingStatus?: Readonly<Record<string, 404 | 410>>
    readonly rangeStatus?: number
    readonly etag?: string
    readonly lastModified?: string
    readonly versionId?: string
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
      if (options.headStatus !== undefined) {
        return new Response(null, { status: options.headStatus })
      }
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
    const responseHeaders: Record<string, string> = {
      'content-length': String(end - start + 1),
      ...(options.etag === undefined ? {} : { etag: options.etag }),
      ...(options.lastModified === undefined ? {} : { 'last-modified': options.lastModified }),
      ...(options.versionId === undefined ? {} : { 'x-amz-version-id': options.versionId }),
    }
    if (options.hideContentRange !== true) {
      responseHeaders['content-range'] = `bytes ${start}-${end}/${bytes.byteLength}`
    }
    return new Response(bytes.slice(start, end + 1), {
      status: options.rangeStatus ?? 206,
      headers: responseHeaders,
    })
  }
  return { fetch: fetcher, requests }
}

describe('OME-Zarr HTTP store URL handling', () => {
  it('normalizes store roots and exact v3 and v2 root metadata URLs', () => {
    expect(normalizeOmeZarrStoreUrl('https://example.test/data/image.zarr')).toEqual({
      storeRootUrl: 'https://example.test/data/image.zarr/',
      primaryMetadataName: 'zarr.json',
      discoverRootMetadata: true,
    })
    expect(
      normalizeOmeZarrStoreUrl('https://example.test/data/image.zarr/zarr.json?token=one'),
    ).toEqual({
      storeRootUrl: 'https://example.test/data/image.zarr/?token=one',
      primaryMetadataName: 'zarr.json',
      discoverRootMetadata: false,
    })
    expect(normalizeOmeZarrStoreUrl('https://example.test/v2/.zgroup')).toEqual({
      storeRootUrl: 'https://example.test/v2/',
      primaryMetadataName: '.zgroup',
      discoverRootMetadata: false,
    })
    expect(normalizeOmeZarrStoreUrl('https://example.test/v2/.zattrs')).toEqual({
      storeRootUrl: 'https://example.test/v2/',
      primaryMetadataName: '.zattrs',
      discoverRootMetadata: false,
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
  it('discovers a naked Zarr v2 root after a missing v3 root without requiring HEAD', async () => {
    const mocked = mockStore({
      '.zgroup': new TextEncoder().encode('{"zarr_format":2}'),
      '.zattrs': new TextEncoder().encode('{}'),
    })
    const context = await createOmeZarrHttpContext('https://example.test/store', {
      fetch: mocked.fetch,
    })
    expect(context.primary.name).toBe('.zgroup')
    expect(mocked.requests).toEqual([
      { method: 'GET', path: 'zarr.json' },
      { method: 'GET', path: '.zgroup' },
    ])
    context.store.close()
  })

  it('opens and reads a naked remote Zarr v2 store through the public context', async () => {
    const mocked = mockStore({
      '.zgroup': json({ zarr_format: 2 }),
      '.zattrs': json({
        multiscales: [
          {
            version: '0.4',
            axes: [
              { name: 'y', type: 'space' },
              { name: 'x', type: 'space' },
            ],
            datasets: [
              { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
            ],
          },
        ],
      }),
      '0/.zarray': json({
        zarr_format: 2,
        shape: [2, 2],
        chunks: [2, 2],
        dtype: '|u1',
        compressor: null,
        fill_value: 0,
        order: 'C',
        filters: null,
      }),
      '0/.zattrs': json({}),
      '0/0.0': Uint8Array.of(1, 2, 3, 4),
    })
    const context = await createOmeZarrHttpContext('https://example.test/store', {
      fetch: mocked.fetch,
    })
    try {
      const document = await omeZarrReader.open(context)
      const dataset = await document.openDataset('image')
      const values: number[] = []
      for await (const block of dataset.readPlane({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        resolutionLevel: 0,
        x: 0,
        y: 0,
        width: 2,
        height: 2,
      })) {
        values.push(...block.data)
        block.release?.()
      }
      expect(values).toEqual([1, 2, 3, 4])
      expect(mocked.requests.some((request) => request.method === 'HEAD')).toBe(false)
    } finally {
      context.store.close()
    }
  })

  it('keeps an explicit metadata URL authoritative instead of falling through discovery', async () => {
    const mocked = mockStore({ '.zgroup': Uint8Array.of(1) })
    await expect(
      createOmeZarrHttpContext('https://example.test/store/zarr.json', {
        fetch: mocked.fetch,
      }),
    ).rejects.toThrow('zarr.json was not found')
    expect(mocked.requests).toEqual([{ method: 'GET', path: 'zarr.json' }])
  })

  it('uses HEAD only when a successful range response hides Content-Range', async () => {
    const mocked = mockStore({ 'zarr.json': Uint8Array.of(123, 125) }, { hideContentRange: true })
    const context = await createOmeZarrHttpContext('https://example.test/store/zarr.json', {
      fetch: mocked.fetch,
    })
    expect(mocked.requests).toEqual([
      { method: 'GET', path: 'zarr.json' },
      { method: 'HEAD', path: 'zarr.json' },
    ])
    context.store.close()
  })

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

  it('reports JSON-safe root identity without claiming identity for the complete store', async () => {
    const mocked = mockStore(
      {
        '.zgroup': json({ zarr_format: 2 }),
        '.zattrs': json({
          multiscales: [
            {
              version: '0.4',
              axes: [
                { name: 'y', type: 'space' },
                { name: 'x', type: 'space' },
              ],
              datasets: [
                { path: '0', coordinateTransformations: [{ type: 'scale', scale: [1, 1] }] },
              ],
            },
          ],
        }),
        '0/.zarray': json({
          zarr_format: 2,
          shape: [1, 1],
          chunks: [1, 1],
          dtype: '|u1',
          compressor: null,
          fill_value: 0,
          order: 'C',
          filters: null,
        }),
        '0/.zattrs': json({}),
      },
      { etag: '"root-version"' },
    )
    const context = await createOmeZarrHttpContext('https://example.test/store', {
      fetch: mocked.fetch,
    })
    try {
      const document = await omeZarrReader.open(context)
      const summary = context.store.identitySummary(document)
      expect(summary).toEqual({
        normalizedRootUrl: 'https://example.test/store/',
        selectedRootMetadataObject: '.zgroup',
        sourceIdentityStrength: 'strong',
        rootObjectSize: json({ zarr_format: 2 }).byteLength,
        rootObjectValidator: { kind: 'etag', value: '"root-version"' },
        zarrFormat: 2,
        omeNgffVersion: '0.4',
      })
      expect(JSON.parse(JSON.stringify(summary))).toEqual(summary)
      expect('storeValidator' in summary).toBe(false)
      expect('objects' in summary).toBe(false)
    } finally {
      context.store.close()
    }
  })

  it('uses a session identity when root metadata has no stable validator', async () => {
    const mocked = mockStore({ 'zarr.json': Uint8Array.of(123, 125) })
    const context = await createOmeZarrHttpContext('https://example.test/store/zarr.json', {
      fetch: mocked.fetch,
    })
    const first = context.store.identitySummary()
    const second = context.store.identitySummary()
    expect(first).toMatchObject({
      normalizedRootUrl: 'https://example.test/store/',
      selectedRootMetadataObject: 'zarr.json',
      sourceIdentityStrength: 'weak',
      rootObjectSize: 2,
    })
    expect(first.sessionIdentity).toMatch(/^\d+$/u)
    expect(second.sessionIdentity).toBe(first.sessionIdentity)
    expect(first.rootObjectValidator).toBeUndefined()
    context.store.close()
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

  it('cancels a pending open and keeps close idempotent', async () => {
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let requestAborted = false
    const pendingFetch: typeof fetch = async (_input, init) => {
      markStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal == null) {
          reject(new Error('Expected a request signal'))
          return
        }
        signal.addEventListener(
          'abort',
          () => {
            requestAborted = true
            reject(signal.reason)
          },
          { once: true },
        )
      })
    }
    const store = new OmeZarrHttpStore('https://example.test/store', { fetch: pendingFetch })
    const opening = store.openContext()
    await started
    store.close()
    store.close()
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestAborted).toBe(true)
    await expect(store.openContext()).rejects.toMatchObject({ name: 'AbortError' })
    await expect(store.resolve({ kind: 'relative-name', name: 'zarr.json' })).rejects.toMatchObject(
      { name: 'AbortError' },
    )
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

  it('does not retain negative lookups', async () => {
    const mocked = mockStore(
      { 'zarr.json': Uint8Array.of(1) },
      { missingStatus: { 'missing/zarr.json': 404 } },
    )
    const store = new OmeZarrHttpStore('https://example.test/store', { fetch: mocked.fetch })
    await expect(
      store.resolve({ kind: 'relative-name', name: 'missing/zarr.json' }),
    ).resolves.toBeUndefined()
    await expect(
      store.resolve({ kind: 'relative-name', name: 'missing/zarr.json' }),
    ).resolves.toBeUndefined()
    expect(mocked.requests.filter((request) => request.path === 'missing/zarr.json')).toHaveLength(
      2,
    )
    store.close()
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
      objectRequests: 3,
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
      metadataRequests: 0,
      arrayRequests: 0,
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
      mocked.requests.filter((request) => request.method === 'GET' && request.path === 'zarr.json'),
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
