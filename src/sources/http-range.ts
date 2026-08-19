import { combineAbortSignals, throwIfAborted, waitForPromise } from '../abort.ts'
import { ImageError, invalidInput, truncatedInput } from '../errors.ts'
import { stableSourceBuffers, type ImageSource, type ImageSourceReadOptions } from '../source.ts'
import type { RemoteSourceIdentity } from '../source-identity.ts'
import { imageSourceIdentity, normalizeSourceIdentity } from '../source-identity.ts'

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
  /**
   * Cancels only the initial range probe. Not retained after `open()` resolves.
   *
   * Prefer this over `signal` for operation-scoped open cancellation.
   */
  readonly openSignal?: AbortSignal
  /**
   * Cancels every subsequent read and in-flight fetch for the returned source.
   * Distinct from `openSignal` and from each `read()` consumer signal.
   */
  readonly lifetimeSignal?: AbortSignal
  /**
   * @deprecated Use `openSignal` to cancel the probe. This option is not retained
   * as the source lifetime; an operation-scoped abort cannot poison a returned source.
   */
  readonly signal?: AbortSignal
  /** Alternate Fetch implementation for controlled runtimes and tests. */
  readonly fetch?: typeof fetch
}

export interface HttpRangeSourceStats {
  readonly requests: number
  /** Transferred response body bytes, including refetches. */
  readonly bytesFetched: number
  /** Same as `bytesFetched`; transfer volume rather than unique coverage. */
  readonly transferBytes: number
  /** Union of successfully received source-byte intervals; never exceeds `size`. */
  readonly uniqueBytes: number
  readonly cacheHits: number
  readonly cacheBytes: number
  /** Consumers that joined an in-flight fetch for a block already requested. */
  readonly coalescedConsumers: number
  /** Read consumers rejected because their signal or the source lifetime aborted. */
  readonly abortedConsumers: number
}

interface HttpRangeBlock {
  readonly data: Uint8Array<ArrayBuffer>
  readonly start: number
}

interface CoverageRange {
  start: number
  end: number
}

interface InflightBlock {
  readonly promise: Promise<HttpRangeBlock>
  readonly abort: AbortController
  consumers: number
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

export interface HttpRangeValidator {
  readonly header: 'etag' | 'last-modified' | 'x-amz-version-id'
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

const resolveOpenSignal = (options: Readonly<HttpRangeSourceOptions>): AbortSignal | undefined =>
  options.openSignal ?? options.signal

const addCoverage = (
  ranges: readonly CoverageRange[],
  start: number,
  end: number,
): CoverageRange[] => {
  if (end <= start) return [...ranges]
  const next = [...ranges, { start, end }].sort((left, right) => left.start - right.start)
  const merged: CoverageRange[] = []
  for (const range of next) {
    const last = merged.at(-1)
    if (last === undefined || range.start > last.end) {
      merged.push({ start: range.start, end: range.end })
      continue
    }
    if (range.end > last.end) last.end = range.end
  }
  return merged
}

const coverageBytes = (ranges: readonly CoverageRange[]): number => {
  let total = 0
  for (const range of ranges) total += range.end - range.start
  return total
}

export class HttpRangeSource implements ImageSource {
  readonly size: number
  readonly [stableSourceBuffers] = true
  readonly #url: string
  readonly #fetch: typeof fetch
  readonly #headers: Headers
  readonly #lifetimeSignal: AbortSignal | undefined
  readonly #blockBytes: number
  readonly #maxCacheBytes: number
  readonly #cache = new Map<number, HttpRangeBlock>()
  readonly #pending = new Map<number, InflightBlock>()
  readonly #validator: HttpRangeValidator | undefined
  readonly #identity: RemoteSourceIdentity
  #covered: CoverageRange[] = []
  #cacheBytes = 0
  #requests = 0
  #transferBytes = 0
  #cacheHits = 0
  #coalescedConsumers = 0
  #abortedConsumers = 0

  private constructor(
    url: string,
    size: number,
    options: Readonly<HttpRangeSourceOptions>,
    fetcher: typeof fetch,
    validator: HttpRangeValidator | undefined,
  ) {
    this.#url = new URL(url).href
    this.size = size
    this.#fetch = fetcher
    this.#headers = new Headers(options.headers)
    this.#lifetimeSignal = options.lifetimeSignal
    this.#blockBytes = options.blockBytes ?? defaultBufferBytes
    this.#maxCacheBytes = options.maxCacheBytes ?? defaultBufferBytes * defaultBufferSlots
    this.#validator = validator
    const identityValidator =
      validator === undefined
        ? undefined
        : {
            kind:
              validator.header === 'x-amz-version-id'
                ? ('version-id' as const)
                : validator.header === 'etag'
                  ? ('etag' as const)
                  : ('last-modified' as const),
            value: validator.value,
          }
    const strong = identityValidator?.kind === 'version-id' || identityValidator?.kind === 'etag'
    this.#identity = normalizeSourceIdentity({
      kind: 'remote',
      strength: strong ? 'strong' : 'weak',
      stability: strong ? 'versioned' : 'best-effort',
      url: this.#url,
      size,
      ...(identityValidator === undefined ? {} : { validator: identityValidator }),
    })
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
    const openSignal = resolveOpenSignal(options)
    let response: Response
    try {
      throwIfAborted(openSignal)
      const headers = new Headers(options.headers)
      headers.set('range', 'bytes=0-0')
      response = await fetcher(href, {
        headers,
        method: 'GET',
        ...(openSignal === undefined ? {} : { signal: openSignal }),
      })
    } catch (cause) {
      throwIfAborted(openSignal)
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
    const probe = await responseBytes(response, 'HTTP range probe', openSignal)
    if (probe.byteLength !== 1)
      throw truncatedInput('HTTP range probe did not return exactly one byte')
    const etag = response.headers.get('etag')
    const lastModified = response.headers.get('last-modified')
    const rawVersionId = response.headers.get('x-amz-version-id')
    const versionId =
      rawVersionId === null || rawVersionId.trim().length === 0 || rawVersionId === 'null'
        ? null
        : rawVersionId
    const validator: HttpRangeValidator | undefined =
      versionId !== null
        ? Object.freeze({ header: 'x-amz-version-id', value: versionId })
        : etag !== null && !etag.startsWith('W/')
          ? Object.freeze({ header: 'etag', value: etag })
          : lastModified === null
            ? undefined
            : Object.freeze({ header: 'last-modified', value: lastModified })
    const source = new HttpRangeSource(href, size, options, fetcher, validator)
    source.#requests = 1
    source.#transferBytes = 1
    source.#cover(0, 1)
    return source
  }

  get stats(): HttpRangeSourceStats {
    const uniqueBytes = Math.min(this.size, coverageBytes(this.#covered))
    return Object.freeze({
      requests: this.#requests,
      bytesFetched: this.#transferBytes,
      transferBytes: this.#transferBytes,
      uniqueBytes,
      cacheHits: this.#cacheHits,
      cacheBytes: this.#cacheBytes,
      coalescedConsumers: this.#coalescedConsumers,
      abortedConsumers: this.#abortedConsumers,
    })
  }

  get validator(): HttpRangeValidator | undefined {
    return this.#validator === undefined ? undefined : Object.freeze({ ...this.#validator })
  }

  [imageSourceIdentity](): RemoteSourceIdentity {
    return this.#identity
  }

  #cover(start: number, end: number): void {
    const clampedStart = Math.max(0, start)
    const clampedEnd = Math.min(this.size, end)
    this.#covered = addCoverage(this.#covered, clampedStart, clampedEnd)
  }

  #recordAbortedConsumer(signal: AbortSignal | undefined): void {
    if (signal?.aborted !== true) return
    this.#abortedConsumers += 1
    throwIfAborted(signal)
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

  async #load(start: number, consumerSignal: AbortSignal | undefined): Promise<HttpRangeBlock> {
    this.#recordAbortedConsumer(this.#lifetimeSignal)
    this.#recordAbortedConsumer(consumerSignal)
    const cached = this.#cache.get(start)
    if (cached) {
      this.#cacheHits += 1
      this.#cache.delete(start)
      this.#cache.set(start, cached)
      return cached
    }
    const waitSignal = combineAbortSignals(this.#lifetimeSignal, consumerSignal)
    let inflight = this.#pending.get(start)
    if (inflight) {
      this.#coalescedConsumers += 1
      inflight.consumers += 1
    } else {
      const abort = new AbortController()
      const fetchSignal = combineAbortSignals(this.#lifetimeSignal, abort.signal)
      const promise = this.#fetchBlock(start, fetchSignal).then((block) => {
        this.#store(block)
        this.#cover(start, start + block.data.byteLength)
        return block
      })
      void promise.catch(() => {
        // Waiters observe the rejection through waitForPromise. This listener prevents an
        // unhandled rejection when the last consumer already aborted.
      })
      inflight = { promise, abort, consumers: 1 }
      this.#pending.set(start, inflight)
    }
    const current = inflight
    try {
      const block = await waitForPromise(current.promise, waitSignal)
      this.#recordAbortedConsumer(this.#lifetimeSignal)
      this.#recordAbortedConsumer(consumerSignal)
      return block
    } catch (error) {
      this.#recordAbortedConsumer(this.#lifetimeSignal)
      this.#recordAbortedConsumer(consumerSignal)
      throw error
    } finally {
      current.consumers -= 1
      if (current.consumers === 0 && this.#pending.get(start) === current) {
        this.#pending.delete(start)
        current.abort.abort()
      }
    }
  }

  async #fetchBlock(start: number, signal: AbortSignal | undefined): Promise<HttpRangeBlock> {
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
    this.#transferBytes += data.byteLength
    return Object.freeze({ start, data })
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    this.#recordAbortedConsumer(this.#lifetimeSignal)
    this.#recordAbortedConsumer(options.signal)
    const available = readLength(this.size, offset, length)
    if (available === 0) return new Uint8Array()
    const firstBlock = Math.floor(offset / this.#blockBytes) * this.#blockBytes
    const lastBlock = Math.floor((offset + available - 1) / this.#blockBytes) * this.#blockBytes
    if (firstBlock === lastBlock) {
      const block = await this.#load(firstBlock, options.signal)
      const blockOffset = offset - firstBlock
      return block.data.subarray(blockOffset, blockOffset + available)
    }
    const output = new Uint8Array(available)
    let outputOffset = 0
    for (let start = firstBlock; start <= lastBlock; start += this.#blockBytes) {
      this.#recordAbortedConsumer(this.#lifetimeSignal)
      this.#recordAbortedConsumer(options.signal)
      const block = await this.#load(start, options.signal)
      const sourceStart = Math.max(offset, start)
      const sourceEnd = Math.min(offset + available, start + block.data.byteLength)
      const amount = sourceEnd - sourceStart
      output.set(
        block.data.subarray(sourceStart - start, sourceStart - start + amount),
        outputOffset,
      )
      outputOffset += amount
    }
    this.#recordAbortedConsumer(this.#lifetimeSignal)
    this.#recordAbortedConsumer(options.signal)
    return output
  }
}

const unsupportedFetch = (): ImageError =>
  new ImageError('UNSUPPORTED_OPERATION', 'HTTP range sources require the Fetch API')
