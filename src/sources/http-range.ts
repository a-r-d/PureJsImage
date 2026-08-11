import { combineAbortSignals, throwIfAborted } from '../abort.ts'
import { ImageError, invalidInput, truncatedInput } from '../errors.ts'
import { stableSourceBuffers, type ImageSource, type ImageSourceReadOptions } from '../source.ts'

const defaultBufferBytes = 262_144
const defaultBufferSlots = 4

const readLength = (size: number, offset: number, length: number): number => {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw invalidInput('Read offset must be non-negative')
  if (!Number.isSafeInteger(length) || length < 0)
    throw invalidInput('Read length must be non-negative')
  return offset >= size ? 0 : Math.min(length, size - offset)
}

export interface HttpRangeSourceOptions {
  /** Fixed remote read size. Defaults to 256 KiB. */
  readonly blockBytes?: number
  /** Maximum retained response bytes. Defaults to 1 MiB. */
  readonly maxCacheBytes?: number
  readonly headers?: HeadersInit
  readonly signal?: AbortSignal
  /** Alternate Fetch implementation for controlled runtimes and tests. */
  readonly fetch?: typeof fetch
}

export interface HttpRangeSourceStats {
  readonly requests: number
  readonly bytesFetched: number
  readonly cacheBytes: number
}

interface HttpRangeBlock {
  readonly data: Uint8Array<ArrayBuffer>
  readonly start: number
}

const contentRangePattern = /^bytes (\d+)-(\d+)\/(\d+)$/

const parseContentRange = (
  response: Response,
  expectedStart: number,
  expectedEnd: number,
): number => {
  const raw = response.headers.get('content-range')
  const match = raw?.match(contentRangePattern)
  if (!match) throw invalidInput('HTTP range response is missing a valid Content-Range header')
  const start = Number(match[1])
  const end = Number(match[2])
  const size = Number(match[3])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    start !== expectedStart ||
    end !== expectedEnd ||
    end >= size
  ) {
    throw invalidInput(
      `HTTP range response ${raw} does not match requested bytes ${expectedStart}-${expectedEnd}`,
    )
  }
  return size
}
interface HttpRangeValidator {
  readonly header: 'etag' | 'last-modified'
  readonly value: string
}

const cancelResponse = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel()
  } catch {
    // The response is already rejected; cancellation is best-effort cleanup.
  }
}

const responseBytes = async (
  response: Response,
  label: string,
  signal: AbortSignal | undefined,
): Promise<Uint8Array<ArrayBuffer>> => {
  try {
    const data = new Uint8Array(await response.arrayBuffer())
    throwIfAborted(signal)
    return data
  } catch (cause) {
    throwIfAborted(signal)
    throw new ImageError('INVALID_INPUT', `${label} body could not be read`, { cause })
  }
}

export class HttpRangeSource implements ImageSource {
  readonly size: number
  readonly [stableSourceBuffers] = true
  readonly #url: string
  readonly #fetch: typeof fetch
  readonly #headers: Headers
  readonly #signal: AbortSignal | undefined
  readonly #blockBytes: number
  readonly #maxCacheBytes: number
  readonly #cache = new Map<number, HttpRangeBlock>()
  readonly #pending = new Map<number, Promise<HttpRangeBlock>>()
  readonly #validator: HttpRangeValidator | undefined
  #cacheBytes = 0
  #requests = 0
  #bytesFetched = 0

  private constructor(
    url: string,
    size: number,
    options: Readonly<HttpRangeSourceOptions>,
    fetcher: typeof fetch,
    validator: HttpRangeValidator | undefined,
  ) {
    this.#url = url
    this.size = size
    this.#fetch = fetcher
    this.#headers = new Headers(options.headers)
    this.#signal = options.signal
    this.#blockBytes = options.blockBytes ?? defaultBufferBytes
    this.#maxCacheBytes = options.maxCacheBytes ?? defaultBufferBytes * defaultBufferSlots
    this.#validator = validator
  }

  static async open(
    url: string | URL,
    options: Readonly<HttpRangeSourceOptions> = {},
  ): Promise<HttpRangeSource> {
    const blockBytes = options.blockBytes ?? defaultBufferBytes
    const maxCacheBytes = options.maxCacheBytes ?? defaultBufferBytes * defaultBufferSlots
    if (!Number.isSafeInteger(blockBytes) || blockBytes < 1) {
      throw invalidInput('HTTP range block size must be a positive safe integer')
    }
    if (!Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < blockBytes) {
      throw invalidInput(
        'HTTP range cache size must be a safe integer at least as large as one block',
      )
    }
    const configuredFetch = options.fetch ?? globalThis.fetch
    if (typeof configuredFetch !== 'function') throw unsupportedFetch()
    // Calling a native browser fetch after storing it as an object field gives it the object as
    // its receiver, which Chromium rejects as an illegal invocation. Keep the actual function in
    // this closure so both the probe and later range reads call it as a plain function.
    const fetcher: typeof fetch = (input, init) => configuredFetch(input, init)
    const href = String(url)
    let response: Response
    try {
      throwIfAborted(options.signal)
      const headers = new Headers(options.headers)
      headers.set('range', 'bytes=0-0')
      response = await fetcher(href, {
        headers,
        method: 'GET',
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (cause) {
      throwIfAborted(options.signal)
      throw new ImageError('INVALID_INPUT', `HTTP range probe failed for ${href}`, { cause })
    }
    if (response.status !== 206) {
      await cancelResponse(response)
      throw invalidInput(
        `HTTP source must support byte ranges; probe returned status ${response.status}`,
      )
    }
    const contentEncoding = response.headers.get('content-encoding')
    if (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') {
      await cancelResponse(response)
      throw invalidInput('HTTP range source does not support content-encoded responses')
    }
    const size = parseContentRange(response, 0, 0)
    const probe = await responseBytes(response, 'HTTP range probe', options.signal)
    if (probe.byteLength !== 1)
      throw truncatedInput('HTTP range probe did not return exactly one byte')
    const etag = response.headers.get('etag')
    const lastModified = response.headers.get('last-modified')
    const validator: HttpRangeValidator | undefined =
      etag !== null && !etag.startsWith('W/')
        ? Object.freeze({ header: 'etag', value: etag })
        : lastModified === null
          ? undefined
          : Object.freeze({ header: 'last-modified', value: lastModified })
    const source = new HttpRangeSource(href, size, options, fetcher, validator)
    source.#requests = 1
    source.#bytesFetched = 1
    return source
  }

  get stats(): HttpRangeSourceStats {
    return Object.freeze({
      requests: this.#requests,
      bytesFetched: this.#bytesFetched,
      cacheBytes: this.#cacheBytes,
    })
  }

  #store(block: HttpRangeBlock): void {
    const previous = this.#cache.get(block.start)
    if (previous) this.#cacheBytes -= previous.data.byteLength
    this.#cache.delete(block.start)
    this.#cache.set(block.start, block)
    this.#cacheBytes += block.data.byteLength
    while (this.#cacheBytes > this.#maxCacheBytes) {
      const oldestStart = this.#cache.keys().next().value
      if (typeof oldestStart !== 'number') break
      const oldest = this.#cache.get(oldestStart)
      this.#cache.delete(oldestStart)
      this.#cacheBytes -= oldest?.data.byteLength ?? 0
    }
  }

  async #load(start: number, signal: AbortSignal | undefined): Promise<HttpRangeBlock> {
    throwIfAborted(signal)
    const cached = this.#cache.get(start)
    if (cached) {
      this.#cache.delete(start)
      this.#cache.set(start, cached)
      return cached
    }
    if (signal !== undefined) {
      const block = await this.#fetchBlock(start, signal)
      this.#store(block)
      return block
    }
    const active = this.#pending.get(start)
    if (active) return active
    const promise = this.#fetchBlock(start, undefined)
    this.#pending.set(start, promise)
    try {
      const block = await promise
      this.#store(block)
      return block
    } finally {
      this.#pending.delete(start)
    }
  }

  async #fetchBlock(
    start: number,
    requestSignal: AbortSignal | undefined,
  ): Promise<HttpRangeBlock> {
    const signal = combineAbortSignals(this.#signal, requestSignal)
    throwIfAborted(signal)
    const end = Math.min(this.size, start + this.#blockBytes) - 1
    const headers = new Headers(this.#headers)
    headers.set('range', `bytes=${start}-${end}`)
    let response: Response
    try {
      this.#requests += 1
      response = await this.#fetch(this.#url, {
        headers,
        method: 'GET',
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (cause) {
      throwIfAborted(signal)
      throw new ImageError('INVALID_INPUT', `HTTP range request failed for bytes ${start}-${end}`, {
        cause,
      })
    }
    if (response.status !== 206) {
      await cancelResponse(response)
      throw invalidInput(`HTTP range request returned status ${response.status}`)
    }
    const responseSize = parseContentRange(response, start, end)
    if (responseSize !== this.size) {
      await cancelResponse(response)
      throw invalidInput(`HTTP range source size changed from ${this.size} to ${responseSize}`)
    }
    const contentEncoding = response.headers.get('content-encoding')
    if (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') {
      await cancelResponse(response)
      throw invalidInput('HTTP range source does not support content-encoded responses')
    }
    if (this.#validator && response.headers.get(this.#validator.header) !== this.#validator.value) {
      await cancelResponse(response)
      throw invalidInput(`HTTP range source ${this.#validator.header} changed during reading`)
    }
    const data = await responseBytes(response, 'HTTP range response', signal)
    const expected = end - start + 1
    if (data.byteLength !== expected) {
      throw truncatedInput(`HTTP range returned ${data.byteLength} of ${expected} requested bytes`)
    }
    this.#bytesFetched += data.byteLength
    return Object.freeze({ start, data })
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    const signal = combineAbortSignals(this.#signal, options.signal)
    throwIfAborted(signal)
    const available = readLength(this.size, offset, length)
    if (available === 0) return new Uint8Array()
    const firstBlock = Math.floor(offset / this.#blockBytes) * this.#blockBytes
    const lastBlock = Math.floor((offset + available - 1) / this.#blockBytes) * this.#blockBytes
    if (firstBlock === lastBlock) {
      const block = await this.#load(firstBlock, signal)
      const blockOffset = offset - firstBlock
      return block.data.subarray(blockOffset, blockOffset + available)
    }
    const output = new Uint8Array(available)
    let outputOffset = 0
    for (let start = firstBlock; start <= lastBlock; start += this.#blockBytes) {
      throwIfAborted(signal)
      const block = await this.#load(start, signal)
      const sourceStart = Math.max(offset, start)
      const sourceEnd = Math.min(offset + available, start + block.data.byteLength)
      const amount = sourceEnd - sourceStart
      output.set(
        block.data.subarray(sourceStart - start, sourceStart - start + amount),
        outputOffset,
      )
      outputOffset += amount
    }
    throwIfAborted(signal)
    return output
  }
}

const unsupportedFetch = (): ImageError =>
  new ImageError('UNSUPPORTED_OPERATION', 'HTTP range sources require the Fetch API')
