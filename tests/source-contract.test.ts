import { beforeAll, describe, expect, it } from 'vitest'

import { allCodecs } from '../src/codec-entries/all.ts'
import { inspectJpegXlStructure } from '../src/codecs/jpegxl.ts'
import { defaultImageLimits, ImageError, type ImageSource } from '../src/index.ts'
import { createImageSource, SourceReader } from '../src/source.ts'
import { HttpRangeSource } from '../src/sources/http-range.ts'
import { encodeTiffDocument, openTiffDocument } from '../src/codecs/tiff.ts'
import { createNodeImageLibrary } from '../src/node-image.ts'
import { nodeRuntime } from '../src/node-runtime.ts'
import type { PixelBlock } from '../src/pixel.ts'
import { Uint8ArraySink } from '../src/sink.ts'
import { createCodecFixtures, type CodecFixture } from './codec-fixtures.ts'
import { jpegXlContainerFixture } from './fixtures.ts'
import { HostileSource } from './hostile-source.ts'
import { Image } from './image-library.ts'

describe('ImageSource buffer lifetime contract', () => {
  const normalImage = createNodeImageLibrary(allCodecs)
  let fixtures: readonly CodecFixture[] = []

  beforeAll(async () => {
    fixtures = await createCodecFixtures()
  })

  it('invalidates a previous read as soon as the next source read starts', async () => {
    const reader = new SourceReader(new HostileSource(Uint8Array.of(1, 2, 3, 4)), 0, 2)
    const retained = await reader.read(2)

    expect([...retained]).toEqual([1, 2])
    expect([...(await reader.read(2))]).toEqual([3, 4])
    expect([...retained]).toEqual([0, 0])
  })

  it('keeps every registered pixel decoder correct when source buffers expire between reads', async () => {
    expect(fixtures.map((fixture) => fixture.format)).toEqual(
      allCodecs
        .filter(({ createDecoder }) => createDecoder !== undefined)
        .map(({ format }) => format),
    )

    for (const fixture of fixtures) {
      const reference = await normalImage.open(fixture.input)
      const expectedMetadata = await reference.metadata()
      const expected = await reference
        .crop({ x: 0, y: 0, width: Math.min(4, expectedMetadata.width), height: 3 })
        .png()
        .toBuffer()

      const hostile = await Image.open(fixture.input)
      expect(await hostile.metadata(), fixture.format).toEqual(expectedMetadata)
      const actual = await hostile
        .crop({ x: 0, y: 0, width: Math.min(4, expectedMetadata.width), height: 3 })
        .png()
        .toBuffer()

      expect(actual, fixture.format).toEqual(expected)
    }
  }, 20_000)

  it('keeps registered JPEG XL structure inspection correct when source buffers expire', async () => {
    const input = jpegXlContainerFixture()

    await expect(inspectJpegXlStructure(new HostileSource(input))).resolves.toEqual(
      await inspectJpegXlStructure(input),
    )
  })
})

describe('ImageSource return-value contract', () => {
  const sourceSize = 524_288

  const wrappedSource = async (
    read: ImageSource['read'],
  ): Promise<Awaited<ReturnType<typeof createImageSource>>> =>
    createImageSource({ read, size: sourceSize }, defaultImageLimits)

  it('normalizes short and detached reads as truncated ImageErrors', async () => {
    const short = await wrappedSource(async (_offset, length) => new Uint8Array(length - 1))
    await expect(short.read(0, 8)).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
      name: 'ImageError',
    })

    const detached = new Uint8Array(262_144)
    structuredClone(detached.buffer, { transfer: [detached.buffer] })
    const detachedSource = await wrappedSource(async () => detached)
    await expect(detachedSource.read(0, 8)).rejects.toMatchObject({
      code: 'TRUNCATED_INPUT',
      name: 'ImageError',
    })
  })

  it('rejects reads that return more data than requested', async () => {
    const source = await wrappedSource(async (_offset, length) => new Uint8Array(length + 1))

    await expect(source.read(0, 8)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
      name: 'ImageError',
    })
  })

  it('normalizes a raw reader failure after a successful source read', async () => {
    const rawFailure = new Error('remote range request failed')
    let reads = 0
    const source = await wrappedSource(async (_offset, length) => {
      reads += 1
      if (reads === 2) throw rawFailure
      return new Uint8Array(length)
    })

    await expect(source.read(0, 8)).resolves.toHaveLength(8)

    let failure: unknown
    try {
      await source.read(262_144, 8)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ImageError)
    expect(failure).toMatchObject({ code: 'INVALID_INPUT', name: 'ImageError' })
    if (!(failure instanceof ImageError)) throw new Error('Expected an ImageError')
    expect(failure.cause).toBe(rawFailure)
  })
})

describe('HttpRangeSource', () => {
  const bytes = Uint8Array.from({ length: 100 }, (_value, index) => index)
  const requests: string[] = []
  const fetchRange: typeof fetch = async (_input, init): Promise<Response> => {
    const range = new Headers(init?.headers).get('range')
    if (!range) return new Response(null, { status: 400 })
    requests.push(range)
    const match = range.match(/^bytes=(\d+)-(\d+)$/)
    if (!match) return new Response(null, { status: 416 })
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
    })
  }

  it('reads only bounded ranges and reuses a bounded LRU cache', async () => {
    requests.length = 0
    const source = await HttpRangeSource.open('https://example.test/image.tif', {
      blockBytes: 16,
      maxCacheBytes: 32,
      fetch: fetchRange,
    })
    expect(Array.from(await source.read(13, 10))).toEqual(Array.from(bytes.slice(13, 23)))
    expect(Array.from(await source.read(16, 4))).toEqual([16, 17, 18, 19])
    expect(requests).toEqual(['bytes=0-0', 'bytes=0-15', 'bytes=16-31'])
    expect(source.stats).toEqual({ requests: 3, bytesFetched: 33, cacheHits: 1, cacheBytes: 32 })
  })

  it('invokes the configured fetch without binding it to the range source', async () => {
    const receiverSensitive: typeof fetch = async function (
      this: unknown,
      _input,
      init,
    ): Promise<Response> {
      if (this !== undefined) throw new TypeError('Illegal invocation')
      const raw = new Headers(init?.headers).get('range') ?? ''
      const match = raw.match(/^bytes=(\d+)-(\d+)$/)
      if (!match) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Math.min(Number(match[2]), bytes.byteLength - 1)
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
      })
    }
    const source = await HttpRangeSource.open('https://example.test/receiver.tif', {
      blockBytes: 16,
      fetch: receiverSensitive,
    })
    await expect(source.read(16, 1)).resolves.toEqual(Uint8Array.of(16))
  })

  it('deduplicates concurrent blocks and evicts least-recently-used data', async () => {
    requests.length = 0
    const source = await HttpRangeSource.open('https://example.test/cache.tif', {
      blockBytes: 16,
      maxCacheBytes: 32,
      fetch: fetchRange,
    })
    await Promise.all([source.read(32, 4), source.read(35, 4)])
    await source.read(48, 1)
    await source.read(32, 1)
    await source.read(64, 1)
    await source.read(48, 1)
    expect(requests).toEqual([
      'bytes=0-0',
      'bytes=32-47',
      'bytes=48-63',
      'bytes=64-79',
      'bytes=48-63',
    ])
    expect(source.stats).toEqual({ requests: 5, bytesFetched: 65, cacheHits: 1, cacheBytes: 32 })
  })

  it('cancels an in-flight range fetch with a per-read signal', async () => {
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const cancellableFetch: typeof fetch = async (_input, init) => {
      const range = new Headers(init?.headers).get('range')
      if (range === 'bytes=0-0') {
        return new Response(Uint8Array.of(0), {
          status: 206,
          headers: { 'content-range': 'bytes 0-0/100' },
        })
      }
      markStarted?.()
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) {
          reject(new Error('Expected a fetch AbortSignal'))
          return
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }
    const source = await HttpRangeSource.open('https://example.test/cancel.tif', {
      blockBytes: 16,
      fetch: cancellableFetch,
    })
    const controller = new AbortController()
    const read = source.read(16, 1, { signal: controller.signal })
    await started
    controller.abort()

    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    expect(source.stats.requests).toBe(2)
  })

  it('rejects servers that ignore ranges or return mismatched extents', async () => {
    const ignored: typeof fetch = async () => new Response(bytes, { status: 200 })
    await expect(
      HttpRangeSource.open('https://example.test/full.tif', { fetch: ignored }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const mismatched: typeof fetch = async () =>
      new Response(bytes.slice(0, 2), {
        status: 206,
        headers: { 'content-range': 'bytes 0-1/100' },
      })
    await expect(
      HttpRangeSource.open('https://example.test/bad.tif', { fetch: mismatched }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('rejects changed resources, encoded blocks, and response-body failures', async () => {
    let request = 0
    const changed: typeof fetch = async (_input, init) => {
      const range = new Headers(init?.headers).get('range') ?? ''
      const match = range.match(/^bytes=(\d+)-(\d+)$/)
      if (!match) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Number(match[2])
      request += 1
      if (request > 1) expect(new Headers(init?.headers).get('if-range')).toBeNull()
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/${request === 1 ? 100 : 101}`,
          etag: request === 1 ? '"version-1"' : '"version-2"',
        },
      })
    }
    const changedSource = await HttpRangeSource.open('https://example.test/changed.tif', {
      blockBytes: 16,
      fetch: changed,
    })
    await expect(changedSource.read(16, 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    request = 0
    const encoded: typeof fetch = async (_input, init) => {
      const range = new Headers(init?.headers).get('range') ?? ''
      const match = range.match(/^bytes=(\d+)-(\d+)$/)
      if (!match) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Number(match[2])
      request += 1
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/100`,
          ...(request === 1 ? {} : { 'content-encoding': 'gzip' }),
        },
      })
    }
    const encodedSource = await HttpRangeSource.open('https://example.test/encoded.tif', {
      blockBytes: 16,
      fetch: encoded,
    })
    await expect(encodedSource.read(16, 1)).rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const bodyFailure = new Error('network body failed')
    const failedBody: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(bodyFailure)
          },
        }),
        {
          status: 206,
          headers: { 'content-range': 'bytes 0-0/100' },
        },
      )
    let failure: unknown
    try {
      await HttpRangeSource.open('https://example.test/body-failure.tif', { fetch: failedBody })
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'INVALID_INPUT', cause: bodyFailure })
  })

  it('decodes one COG-like tile without fetching unrelated tile payloads', async () => {
    const width = 64
    const height = 64
    const pixels = Uint8Array.from(
      { length: width * height * 3 },
      (_value, index) => (index * 73 + Math.floor(index / 17) * 29) & 0xff,
    )
    const blocks: AsyncIterable<PixelBlock> = {
      async *[Symbol.asyncIterator]() {
        yield { x: 0, y: 0, width, height, stride: width * 3, format: 'rgb8', data: pixels }
      },
    }
    const sink = new Uint8ArraySink()
    await encodeTiffDocument(sink, {
      runtime: nodeRuntime,
      options: {
        layout: 'tiles',
        tileWidth: 16,
        tileHeight: 16,
        format: 'classic',
        compressionLevel: 6,
      },
      pages: [{ width, height, pixelFormat: 'rgb8', blocks }],
    })
    const encoded = sink.toUint8Array()
    const ranges: Array<readonly [start: number, end: number]> = []
    const fetchTiff: typeof fetch = async (_input, init) => {
      const raw = new Headers(init?.headers).get('range') ?? ''
      const match = raw.match(/^bytes=(\d+)-(\d+)$/)
      if (!match) return new Response(null, { status: 416 })
      const start = Number(match[1])
      const end = Math.min(Number(match[2]), encoded.byteLength - 1)
      ranges.push([start, end])
      return new Response(encoded.slice(start, end + 1), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/${encoded.byteLength}`,
          etag: '"stable-cog"',
        },
      })
    }
    const source = await HttpRangeSource.open('https://example.test/selective.tif', {
      blockBytes: 64,
      maxCacheBytes: 256,
      fetch: fetchTiff,
    })
    const document = await openTiffDocument(source)
    const directory = document.getDirectory(0)
    if (!directory) throw new Error('Expected tiled TIFF directory')
    const offsets = await directory.getTag(324)
    const byteCounts = await directory.getTag(325)
    if (offsets?.kind !== 'numbers' || byteCounts?.kind !== 'numbers') {
      throw new Error('Expected tiled TIFF offset and byte-count tables')
    }
    const decoder = await directory.createRasterDecoder()
    const decoded: number[] = []
    for await (const block of decoder.decode({ x: 1, y: 1, width: 2, height: 2 })) {
      decoded.push(...block.data)
    }
    expect(decoded).toHaveLength(12)
    const selectedStart = offsets.values[0] ?? -1
    const selectedEnd = selectedStart + (byteCounts.values[0] ?? 0) - 1
    const unrelatedIndex = offsets.values.length - 1
    const unrelatedStart = offsets.values[unrelatedIndex] ?? -1
    const unrelatedEnd = unrelatedStart + (byteCounts.values[unrelatedIndex] ?? 0) - 1
    const overlaps = (
      range: readonly [start: number, end: number],
      start: number,
      end: number,
    ): boolean => range[0] <= end && range[1] >= start
    expect(ranges.some((range) => overlaps(range, selectedStart, selectedEnd))).toBe(true)
    expect(ranges.some((range) => overlaps(range, unrelatedStart, unrelatedEnd))).toBe(false)
    expect(source.stats.bytesFetched).toBeLessThan(encoded.byteLength / 4)
  })
})
