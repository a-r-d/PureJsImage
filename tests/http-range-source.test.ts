import { describe, expect, it } from 'vitest'
import { HttpRangeSource } from '../src/sources/http-range.ts'

const bytes = Uint8Array.from({ length: 100 }, (_value, index) => index)

const rangeResponse = (start: number, end: number, size = bytes.byteLength): Response =>
  new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: { 'content-range': `bytes ${start}-${end}/${size}` },
  })

const parseRange = (init: RequestInit | undefined): { start: number; end: number } | undefined => {
  const raw = new Headers(init?.headers).get('range')
  const match = raw?.match(/^bytes=(\d+)-(\d+)$/)
  if (match === undefined || match === null) return undefined
  return { start: Number(match[1]), end: Number(match[2]) }
}

const immediateFetch: typeof fetch = async (_input, init) => {
  const range = parseRange(init)
  if (range === undefined) return new Response(null, { status: 416 })
  return rangeResponse(range.start, Math.min(range.end, bytes.byteLength - 1))
}

describe('HttpRangeSource cancellation scopes', () => {
  it('uses an opt-in HEAD size fallback when Content-Range is hidden by CORS', async () => {
    const methods: string[] = []
    const fetchRange: typeof fetch = async (_input, init) => {
      const method = init?.method ?? 'GET'
      methods.push(method)
      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-length': '100' } })
      }
      const range = parseRange(init)
      if (range === undefined) return new Response(null, { status: 416 })
      return new Response(bytes.slice(range.start, Math.min(range.end, 99) + 1), { status: 206 })
    }
    const source = await HttpRangeSource.open('https://example.test/cors-range.bin', {
      allowHeadSizeFallback: true,
      blockBytes: 16,
      fetch: fetchRange,
    })
    await expect(source.read(16, 2)).resolves.toEqual(Uint8Array.of(16, 17))
    expect(methods).toEqual(['GET', 'HEAD', 'GET'])
    expect(source.size).toBe(100)
    expect(source.stats).toMatchObject({ requests: 3, bytesFetched: 17, uniqueBytes: 17 })
  })

  it('uses a validated expected size without issuing a duplicate HEAD request', async () => {
    const methods: string[] = []
    const fetchRange: typeof fetch = async (_input, init) => {
      methods.push(init?.method ?? 'GET')
      const range = parseRange(init)
      if (range === undefined) return new Response(null, { status: 400 })
      return new Response(bytes.slice(range.start, Math.min(range.end, 99) + 1), { status: 206 })
    }
    const source = await HttpRangeSource.open('https://example.test/known-size.bin', {
      allowHeadSizeFallback: true,
      blockBytes: 16,
      expectedSize: 100,
      fetch: fetchRange,
    })
    await expect(source.read(16, 2)).resolves.toEqual(Uint8Array.of(16, 17))
    expect(methods).toEqual(['GET', 'GET'])
    expect(source.stats).toMatchObject({ requests: 2, bytesFetched: 17, uniqueBytes: 17 })
  })

  it('rejects an invalid expected size even after a successful range probe', async () => {
    const fetchRange: typeof fetch = async () => new Response(Uint8Array.of(0), { status: 206 })
    await expect(
      HttpRangeSource.open('https://example.test/invalid-known-size.bin', {
        allowHeadSizeFallback: true,
        expectedSize: 0,
        fetch: fetchRange,
      }),
    ).rejects.toThrow('expected size must be a positive safe integer')
  })

  it('keeps missing and malformed Content-Range strict without the opt-in fallback', async () => {
    const missing: typeof fetch = async () => new Response(Uint8Array.of(0), { status: 206 })
    await expect(
      HttpRangeSource.open('https://example.test/missing-content-range.bin', { fetch: missing }),
    ).rejects.toThrow('missing a valid Content-Range')

    const malformed: typeof fetch = async () =>
      new Response(Uint8Array.of(0), {
        status: 206,
        headers: { 'content-range': 'bytes nope' },
      })
    await expect(
      HttpRangeSource.open('https://example.test/malformed-content-range.bin', {
        allowHeadSizeFallback: true,
        fetch: malformed,
      }),
    ).rejects.toThrow('missing a valid Content-Range')
  })

  it('aborts only the probe when openSignal is aborted during open', async () => {
    const controller = new AbortController()
    const fetchProbe: typeof fetch = async (_input, init) => {
      const range = parseRange(init)
      if (range === undefined) return new Response(null, { status: 416 })
      if (range.start === 0 && range.end === 0) {
        controller.abort()
        const signal = init?.signal
        if (signal?.aborted === true) throw signal.reason
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }
      return rangeResponse(range.start, Math.min(range.end, bytes.byteLength - 1))
    }
    await expect(
      HttpRangeSource.open('https://example.test/probe-abort.tif', {
        fetch: fetchProbe,
        openSignal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not retain a deprecated open signal as the source lifetime', async () => {
    const controller = new AbortController()
    const source = await HttpRangeSource.open('https://example.test/open-only.tif', {
      blockBytes: 16,
      fetch: immediateFetch,
      signal: controller.signal,
    })
    controller.abort()
    await expect(source.read(16, 2)).resolves.toEqual(Uint8Array.of(16, 17))
    expect(source.stats.abortedConsumers).toBe(0)
  })

  it('rejects one of two same-block consumers without aborting the shared fetch', async () => {
    let blockFetches = 0
    let finishBlock: ((response: Response) => void) | undefined
    const fetchRange: typeof fetch = async (_input, init) => {
      const range = parseRange(init)
      if (range === undefined) return new Response(null, { status: 416 })
      if (range.start === 0 && range.end === 0) return rangeResponse(0, 0)
      blockFetches += 1
      return new Promise<Response>((resolve) => {
        finishBlock = resolve
      })
    }
    const source = await HttpRangeSource.open('https://example.test/one-of-two.tif', {
      blockBytes: 16,
      fetch: fetchRange,
    })
    const firstController = new AbortController()
    const first = source.read(16, 2, { signal: firstController.signal })
    const second = source.read(18, 2, { signal: new AbortController().signal })
    await Promise.resolve()
    firstController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(blockFetches).toBe(1)
    finishBlock?.(rangeResponse(16, 31))
    await expect(second).resolves.toEqual(Uint8Array.of(18, 19))
    expect(blockFetches).toBe(1)
    expect(source.stats).toMatchObject({
      requests: 2,
      coalescedConsumers: 1,
      abortedConsumers: 1,
      transferBytes: 17,
      uniqueBytes: 17,
    })
    expect(source.stats.uniqueBytes).toBeLessThanOrEqual(source.size)
  })

  it('aborts the shared fetch after every same-block consumer aborts', async () => {
    let fetchAborted = false
    const fetchRange: typeof fetch = async (_input, init) => {
      const range = parseRange(init)
      if (range === undefined) return new Response(null, { status: 416 })
      if (range.start === 0 && range.end === 0) return rangeResponse(0, 0)
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal == null) {
          reject(new Error('Expected a fetch AbortSignal'))
          return
        }
        signal.addEventListener(
          'abort',
          () => {
            fetchAborted = true
            reject(signal.reason)
          },
          { once: true },
        )
      })
    }
    const source = await HttpRangeSource.open('https://example.test/all-consumers.tif', {
      blockBytes: 16,
      fetch: fetchRange,
    })
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = source.read(16, 1, { signal: firstController.signal })
    const second = source.read(17, 1, { signal: secondController.signal })
    await Promise.resolve()
    firstController.abort()
    secondController.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await expect(second).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchAborted).toBe(true)
    expect(source.stats.abortedConsumers).toBe(2)
    expect(source.stats.coalescedConsumers).toBe(1)
  })
  it('rejects later reads when the source lifetime signal aborts', async () => {
    const lifetime = new AbortController()
    const source = await HttpRangeSource.open('https://example.test/lifetime.tif', {
      blockBytes: 16,
      fetch: immediateFetch,
      lifetimeSignal: lifetime.signal,
    })
    await expect(source.read(0, 2)).resolves.toEqual(Uint8Array.of(0, 1))
    lifetime.abort()
    await expect(source.read(16, 1)).rejects.toMatchObject({ name: 'AbortError' })
    expect(source.stats.abortedConsumers).toBe(1)
  })

  it('leaves a previous source readable after a replacement open fails', async () => {
    const live = await HttpRangeSource.open('https://example.test/keep.tif', {
      blockBytes: 16,
      fetch: immediateFetch,
    })
    const failedOpen = new AbortController()
    failedOpen.abort()
    await expect(
      HttpRangeSource.open('https://example.test/replace.tif', {
        fetch: immediateFetch,
        openSignal: failedOpen.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(live.read(32, 3)).resolves.toEqual(Uint8Array.of(32, 33, 34))
  })

  it('refetches after LRU eviction without increasing unique coverage past source size', async () => {
    const requests: string[] = []
    const fetchRange: typeof fetch = async (_input, init) => {
      const range = parseRange(init)
      if (range === undefined) return new Response(null, { status: 416 })
      requests.push(`bytes=${range.start}-${range.end}`)
      return rangeResponse(range.start, Math.min(range.end, bytes.byteLength - 1))
    }
    const source = await HttpRangeSource.open('https://example.test/evict.tif', {
      blockBytes: 16,
      maxCacheBytes: 16,
      fetch: fetchRange,
    })
    await source.read(16, 1)
    await source.read(32, 1)
    await source.read(16, 1)
    expect(requests).toEqual(['bytes=0-0', 'bytes=16-31', 'bytes=32-47', 'bytes=16-31'])
    expect(source.stats.transferBytes).toBe(1 + 16 + 16 + 16)
    expect(source.stats.uniqueBytes).toBe(33)
    expect(source.stats.uniqueBytes).toBeLessThanOrEqual(source.size)
    expect(source.stats.cacheHits).toBe(0)
  })

  it('rejects a validator or size change on a later range read', async () => {
    let request = 0
    const fetchRange: typeof fetch = async (_input, init) => {
      const range = parseRange(init)
      if (range === undefined) return new Response(null, { status: 416 })
      request += 1
      return new Response(bytes.slice(range.start, Math.min(range.end, bytes.byteLength - 1) + 1), {
        status: 206,
        headers: {
          'content-range': `bytes ${range.start}-${Math.min(range.end, bytes.byteLength - 1)}/${request === 1 ? 100 : 100}`,
          etag: request === 1 ? '"v1"' : '"v2"',
        },
      })
    }
    const source = await HttpRangeSource.open('https://example.test/validator.tif', {
      blockBytes: 16,
      fetch: fetchRange,
    })
    await expect(source.read(16, 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    request = 0
    const resized: typeof fetch = async (_input, init) => {
      const range = parseRange(init)
      if (range === undefined) return new Response(null, { status: 416 })
      request += 1
      const size = request === 1 ? 100 : 80
      const end = Math.min(range.end, size - 1)
      return new Response(bytes.slice(range.start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${range.start}-${end}/${size}` },
      })
    }
    const resizedSource = await HttpRangeSource.open('https://example.test/resized.tif', {
      blockBytes: 16,
      fetch: resized,
    })
    await expect(resizedSource.read(16, 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('coalesces overlapping multi-block signaled reads into one request per block', async () => {
    const requests: string[] = []
    const fetchRange: typeof fetch = async (_input, init) => {
      const range = parseRange(init)
      if (range === undefined) return new Response(null, { status: 416 })
      requests.push(`bytes=${range.start}-${range.end}`)
      await Promise.resolve()
      return rangeResponse(range.start, Math.min(range.end, bytes.byteLength - 1))
    }
    const source = await HttpRangeSource.open('https://example.test/overlap.tif', {
      blockBytes: 16,
      maxCacheBytes: 64,
      fetch: fetchRange,
    })
    const [first, second] = await Promise.all([
      source.read(8, 20, { signal: new AbortController().signal }),
      source.read(12, 20, { signal: new AbortController().signal }),
    ])
    expect(first).toEqual(bytes.slice(8, 28))
    expect(second).toEqual(bytes.slice(12, 32))
    expect(requests).toEqual(['bytes=0-0', 'bytes=0-15', 'bytes=16-31'])
    expect(source.stats.coalescedConsumers).toBeGreaterThan(0)
    expect(source.stats.uniqueBytes).toBe(32)
    expect(source.stats.uniqueBytes).toBeLessThanOrEqual(source.size)
  })
})
