import { combineAbortSignals, throwIfAborted, waitForPromise } from '../abort.ts'
import { ImageError, invalidInput, truncatedInput } from '../errors.ts'
import type { EvidenceContext, EvidenceManagedLease } from '../evidence.ts'
import {
  sourceReadEvidenceDependencies,
  stableSourceBuffers,
  type ImageSource,
  type ImageSourceReadOptions,
} from '../source.ts'
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
  /** Trusted object size used only with allowHeadSizeFallback after a successful 206 probe. */
  readonly expectedSize?: number
  /**
   * Allow a HEAD request to establish the object size when a successful 206 response's
   * Content-Range header is hidden by CORS. The response remains strict when Content-Range is
   * present, and every subsequent request must still return 206 with the requested byte count.
   */
  readonly allowHeadSizeFallback?: boolean
  /** Return `undefined` when the initial range probe receives HTTP 404 or 410. */
  readonly allowNotFound?: boolean
  /** Optional caller-owned execution evidence. No collector is created by default. */
  readonly evidence?: EvidenceContext
  /** Explicit bounded policy. Fixed remains the default. */
  readonly rangePolicy?:
    | { readonly kind: 'fixed' }
    | {
        readonly kind: 'adaptive'
        readonly maxBlockBytes?: number
        readonly sequentialReadsBeforeGrowth?: number
      }
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
  readonly evidenceIds: readonly string[]
  readonly evidenceLease?: EvidenceManagedLease
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

const cancelResponse = (response: Response): void => {
  try {
    void response.body?.cancel().catch(() => undefined)
  } catch {
    // The response is already rejected; cancellation is best-effort cleanup.
  }
}

const exactResponseBytes = async (
  response: Response,
  label: string,
  expected: number,
  signal: AbortSignal | undefined,
  onBytes?: (bytes: number) => void,
): Promise<Uint8Array<ArrayBuffer>> => {
  const rawContentLength = response.headers.get('content-length')
  if (rawContentLength !== null) {
    const contentLength = Number(rawContentLength)
    if (
      !/^\d+$/u.test(rawContentLength) ||
      !Number.isSafeInteger(contentLength) ||
      contentLength !== expected
    ) {
      cancelResponse(response)
      throw invalidInput(
        `${label} Content-Length ${rawContentLength} does not match expected ${expected}`,
      )
    }
  }

  if (response.body === null) {
    if (rawContentLength === null) {
      throw invalidInput(`${label} has no readable body or bounded Content-Length fallback`)
    }
    try {
      const buffered = new Uint8Array(await response.arrayBuffer())
      onBytes?.(buffered.byteLength)
      throwIfAborted(signal)
      if (buffered.byteLength !== expected) {
        throw truncatedInput(`${label} returned ${buffered.byteLength} of ${expected} bytes`)
      }
      return buffered
    } catch (cause) {
      throwIfAborted(signal)
      if (cause instanceof ImageError) throw cause
      throw new ImageError('INVALID_INPUT', `${label} body could not be read`, { cause })
    }
  }

  const reader = response.body.getReader()
  const output = new Uint8Array(expected)
  let received = 0
  let complete = false
  let cancelPromise: Promise<void> | undefined
  const cancelReader = (reason?: unknown): Promise<void> => {
    cancelPromise ??= reader.cancel(reason).catch(() => undefined)
    return cancelPromise
  }
  const abortReader = (): void => {
    void cancelReader(signal?.reason)
  }
  signal?.addEventListener('abort', abortReader, { once: true })
  try {
    while (true) {
      throwIfAborted(signal)
      const result = await waitForPromise(reader.read(), signal)
      throwIfAborted(signal)
      if (result.done) {
        if (received !== expected) {
          throw truncatedInput(`${label} returned ${received} of ${expected} bytes`)
        }
        complete = true
        return output
      }
      if (result.value.byteLength > expected - received) {
        void cancelReader()
        throw invalidInput(`${label} returned more than the expected ${expected} bytes`)
      }
      output.set(result.value, received)
      received += result.value.byteLength
      onBytes?.(result.value.byteLength)
    }
  } catch (cause) {
    throwIfAborted(signal)
    if (cause instanceof ImageError) throw cause
    throw new ImageError('INVALID_INPUT', `${label} body could not be read`, { cause })
  } finally {
    signal?.removeEventListener('abort', abortReader)
    if (complete) reader.releaseLock()
    else void cancelReader(signal?.reason)
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
  readonly #allowMissingContentRange: boolean
  readonly #cache = new Map<number, HttpRangeBlock>()
  readonly #pending = new Map<string, InflightBlock>()
  readonly #validator: HttpRangeValidator | undefined
  readonly #identity: RemoteSourceIdentity
  readonly #evidence: EvidenceContext | undefined
  readonly #rangePolicy: 'fixed' | 'adaptive'
  readonly #maxAdaptiveBlockBytes: number
  readonly #sequentialReadsBeforeGrowth: number
  #adaptiveBlockBytes: number
  #previousReadEnd = -1
  #sequentialReads = 0
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
    allowMissingContentRange: boolean,
  ) {
    this.#url = new URL(url).href
    this.size = size
    this.#fetch = fetcher
    this.#headers = new Headers(options.headers)
    this.#lifetimeSignal = options.lifetimeSignal
    this.#blockBytes = options.blockBytes ?? defaultBufferBytes
    this.#maxCacheBytes = options.maxCacheBytes ?? defaultBufferBytes * defaultBufferSlots
    this.#allowMissingContentRange = allowMissingContentRange
    this.#validator = validator
    this.#evidence = options.evidence
    this.#rangePolicy = options.rangePolicy?.kind ?? 'fixed'
    this.#maxAdaptiveBlockBytes =
      options.rangePolicy?.kind === 'adaptive'
        ? (options.rangePolicy.maxBlockBytes ?? Math.min(this.#maxCacheBytes, this.#blockBytes * 4))
        : this.#blockBytes
    this.#sequentialReadsBeforeGrowth =
      options.rangePolicy?.kind === 'adaptive'
        ? (options.rangePolicy.sequentialReadsBeforeGrowth ?? 2)
        : 2
    this.#adaptiveBlockBytes = this.#blockBytes
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
    options: Readonly<HttpRangeSourceOptions> & { readonly allowNotFound: true },
  ): Promise<HttpRangeSource | undefined>
  static async open(
    url: string | URL,
    options?: Readonly<HttpRangeSourceOptions>,
  ): Promise<HttpRangeSource>
  static async open(
    url: string | URL,
    options: Readonly<HttpRangeSourceOptions> = {},
  ): Promise<HttpRangeSource | undefined> {
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
    if (options.rangePolicy?.kind === 'adaptive') {
      const maxAdaptive =
        options.rangePolicy.maxBlockBytes ?? Math.min(maxCacheBytes, blockBytes * 4)
      const growthReads = options.rangePolicy.sequentialReadsBeforeGrowth ?? 2
      if (
        !Number.isSafeInteger(maxAdaptive) ||
        maxAdaptive < blockBytes ||
        maxAdaptive > maxCacheBytes
      ) {
        throw invalidInput(
          'Adaptive HTTP range maxBlockBytes must be between blockBytes and maxCacheBytes',
        )
      }
      if (!Number.isSafeInteger(growthReads) || growthReads < 1 || growthReads > 64) {
        throw invalidInput(
          'Adaptive HTTP range sequentialReadsBeforeGrowth must be an integer from 1 to 64',
        )
      }
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
    const probeStarted = options.evidence?.nowMicroseconds() ?? 0
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
    if (options.allowNotFound === true && (response.status === 404 || response.status === 410)) {
      cancelResponse(response)
      return undefined
    }
    if (response.status !== 206) {
      cancelResponse(response)
      throw invalidInput(
        `HTTP source must support byte ranges; probe returned status ${response.status}`,
      )
    }
    const contentEncoding = response.headers.get('content-encoding')
    if (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') {
      cancelResponse(response)
      throw invalidInput('HTTP range source does not support content-encoded responses')
    }
    const rawContentRange = response.headers.get('content-range')
    let size: number
    let headRequests = 0
    if (rawContentRange !== null) {
      size = parseContentRange(response, 0, 0)
    } else if (options.allowHeadSizeFallback === true && options.expectedSize !== undefined) {
      size = options.expectedSize
      if (!Number.isSafeInteger(size) || size < 1) {
        cancelResponse(response)
        throw invalidInput('HTTP expected size must be a positive safe integer')
      }
    } else if (options.allowHeadSizeFallback === true) {
      let head: Response
      try {
        throwIfAborted(openSignal)
        head = await fetcher(href, {
          headers: new Headers(options.headers),
          method: 'HEAD',
          ...(openSignal === undefined ? {} : { signal: openSignal }),
        })
        headRequests += 1
      } catch (cause) {
        throwIfAborted(openSignal)
        cancelResponse(response)
        throw new ImageError('INVALID_INPUT', `HTTP size probe failed for ${href}`, { cause })
      }
      if (head.status !== 200) {
        cancelResponse(response)
        cancelResponse(head)
        throw invalidInput(`HTTP size probe returned status ${head.status}`)
      }
      const rawSize = head.headers.get('content-length')
      size = Number(rawSize)
      if (!Number.isSafeInteger(size) || size < 1) {
        cancelResponse(response)
        cancelResponse(head)
        throw invalidInput('HTTP size probe is missing a valid Content-Length header')
      }
      cancelResponse(head)
    } else {
      cancelResponse(response)
      throw invalidInput('HTTP range response is missing a valid Content-Range header')
    }
    let probeFirstByte: number | undefined
    const probeEvidence = options.evidence
    const recordProbeBytes =
      probeEvidence === undefined
        ? undefined
        : (): void => {
            probeFirstByte ??= Math.max(0, probeEvidence.nowMicroseconds() - probeStarted)
          }
    await exactResponseBytes(response, 'HTTP range probe', 1, openSignal, recordProbeBytes)
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
    const source = new HttpRangeSource(
      href,
      size,
      options,
      fetcher,
      validator,
      rawContentRange === null,
    )
    source.#requests = 1 + headRequests
    source.#transferBytes = 1
    source.#cover(0, 1)
    options.evidence?.source(source.#identity)
    options.evidence?.physicalTransfer({
      start: 0,
      end: 1,
      transferredBytes: 1,
      status: response.status,
      durationMicroseconds: Math.max(0, options.evidence.nowMicroseconds() - probeStarted),
      ...(probeFirstByte === undefined ? {} : { firstByteMicroseconds: probeFirstByte }),
      outcome: 'complete',
    })
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

  /** Abort and await every physical block transfer without discarding completed cache entries. */
  async quiesce(): Promise<void> {
    const pending = [...new Set([...this.#pending.values()])]
    for (const inflight of pending) inflight.abort.abort()
    await Promise.all(
      pending.map(({ promise }) =>
        promise.then(
          () => undefined,
          () => undefined,
        ),
      ),
    )
  }

  /** Release retained cache accounting and drop cached response blocks. */
  clearCache(): void {
    for (const block of this.#cache.values()) {
      block.evidenceLease?.release()
      this.#evidence?.cache({
        action: 'evict',
        start: block.start,
        end: block.start + block.data.byteLength,
        bytes: block.data.byteLength,
      })
    }
    this.#cache.clear()
    this.#cacheBytes = 0
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
    this.#evidence?.cache({ action: 'abort' })
    this.#evidence?.cancellation('http-range-consumer')
    throwIfAborted(signal)
  }

  #store(block: HttpRangeBlock): HttpRangeBlock {
    const previous = this.#cache.get(block.start)
    if (previous) {
      this.#cacheBytes -= previous.data.byteLength
      previous.evidenceLease?.release()
      this.#evidence?.cache({
        action: 'evict',
        start: previous.start,
        end: previous.start + previous.data.byteLength,
        bytes: previous.data.byteLength,
      })
    }
    this.#cache.delete(block.start)
    const evidenceLease = this.#evidence?.allocate(
      'http-range-source-cache',
      block.data.byteLength,
      'cache',
    )
    const stored: HttpRangeBlock = Object.freeze({
      ...block,
      ...(evidenceLease === undefined ? {} : { evidenceLease }),
    })
    this.#cache.set(block.start, stored)
    this.#cacheBytes += stored.data.byteLength
    while (this.#cacheBytes > this.#maxCacheBytes) {
      const oldestStart = this.#cache.keys().next().value
      if (typeof oldestStart !== 'number') break
      const oldest = this.#cache.get(oldestStart)
      this.#cache.delete(oldestStart)
      if (oldest !== undefined) {
        this.#cacheBytes -= oldest.data.byteLength
        oldest.evidenceLease?.release()
        this.#evidence?.cache({
          action: 'evict',
          start: oldest.start,
          end: oldest.start + oldest.data.byteLength,
          bytes: oldest.data.byteLength,
        })
      }
    }
    return stored
  }

  async #load(
    start: number,
    blockBytes: number,
    consumerSignal: AbortSignal | undefined,
    dependencies: ((ids: readonly string[]) => void) | undefined,
  ): Promise<HttpRangeBlock> {
    this.#recordAbortedConsumer(this.#lifetimeSignal)
    this.#recordAbortedConsumer(consumerSignal)
    const cached = this.#cache.get(start)
    const expectedBytes = Math.min(this.size - start, blockBytes)
    if (cached && cached.data.byteLength >= expectedBytes) {
      this.#cacheHits += 1
      this.#evidence?.cache({
        action: 'hit',
        start,
        end: start + cached.data.byteLength,
        bytes: cached.data.byteLength,
      })
      this.#cache.delete(start)
      this.#cache.set(start, cached)
      dependencies?.(cached.evidenceIds)
      return cached
    }
    const waitSignal = combineAbortSignals(this.#lifetimeSignal, consumerSignal)
    const pendingKey = `${start}:${blockBytes}`
    let inflight = this.#pending.get(pendingKey)
    if (inflight) {
      this.#coalescedConsumers += 1
      this.#evidence?.cache({ action: 'join', start })
      inflight.consumers += 1
    } else {
      this.#evidence?.cache({ action: 'miss', start })
      const abort = new AbortController()
      const fetchSignal = combineAbortSignals(this.#lifetimeSignal, abort.signal)
      const promise = this.#fetchBlock(start, blockBytes, fetchSignal).then((block) => {
        const stored = this.#store(block)
        this.#cover(start, start + stored.data.byteLength)
        return stored
      })
      void promise.catch(() => {
        // Waiters observe the rejection through waitForPromise. This listener prevents an
        // unhandled rejection when the last consumer already aborted.
      })
      inflight = { promise, abort, consumers: 1 }
      this.#pending.set(pendingKey, inflight)
    }
    const current = inflight
    try {
      const block = await waitForPromise(current.promise, waitSignal)
      this.#recordAbortedConsumer(this.#lifetimeSignal)
      this.#recordAbortedConsumer(consumerSignal)
      dependencies?.(block.evidenceIds)
      return block
    } catch (error) {
      this.#recordAbortedConsumer(this.#lifetimeSignal)
      this.#recordAbortedConsumer(consumerSignal)
      throw error
    } finally {
      current.consumers -= 1
      if (current.consumers === 0 && this.#pending.get(pendingKey) === current) {
        this.#pending.delete(pendingKey)
        current.abort.abort()
        await current.promise.then(
          () => undefined,
          () => undefined,
        )
      }
    }
  }

  async #fetchBlock(
    start: number,
    blockBytes: number,
    signal: AbortSignal | undefined,
  ): Promise<HttpRangeBlock> {
    throwIfAborted(signal)
    const end = Math.min(this.size, start + blockBytes) - 1
    const headers = new Headers(this.#headers)
    headers.set('range', `bytes=${start}-${end}`)
    let response: Response
    const started = this.#evidence?.nowMicroseconds() ?? 0
    let transferredBytes = 0
    let firstByteMicroseconds: number | undefined
    try {
      this.#requests += 1
      response = await this.#fetch(this.#url, {
        headers,
        method: 'GET',
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (cause) {
      this.#evidence?.physicalTransfer({
        start,
        end: end + 1,
        transferredBytes,
        status: 0,
        durationMicroseconds: Math.max(0, (this.#evidence?.nowMicroseconds() ?? 0) - started),
        ...(firstByteMicroseconds === undefined ? {} : { firstByteMicroseconds }),
        outcome: signal?.aborted === true ? 'aborted' : 'failed',
        policy: this.#rangePolicy,
      })
      throwIfAborted(signal)
      throw new ImageError('INVALID_INPUT', `HTTP range request failed for bytes ${start}-${end}`, {
        cause,
      })
    }
    const recordFailedTransfer = (validatorFailure = false): void => {
      this.#evidence?.physicalTransfer({
        start,
        end: end + 1,
        transferredBytes: 0,
        status: response.status,
        durationMicroseconds: Math.max(0, (this.#evidence?.nowMicroseconds() ?? 0) - started),
        outcome: signal?.aborted === true ? 'aborted' : 'failed',
        policy: this.#rangePolicy,
        ...(validatorFailure ? { validatorFailure: true } : {}),
      })
    }
    if (response.status !== 206) {
      recordFailedTransfer()
      cancelResponse(response)
      throw invalidInput(`HTTP range request returned status ${response.status}`)
    }
    const rawContentRange = response.headers.get('content-range')
    let responseSize: number
    try {
      responseSize =
        rawContentRange === null && this.#allowMissingContentRange
          ? this.size
          : parseContentRange(response, start, end)
    } catch (error) {
      recordFailedTransfer()
      cancelResponse(response)
      throw error
    }
    if (responseSize !== this.size) {
      recordFailedTransfer()
      cancelResponse(response)
      throw invalidInput(`HTTP range source size changed from ${this.size} to ${responseSize}`)
    }
    const contentEncoding = response.headers.get('content-encoding')
    if (contentEncoding !== null && contentEncoding.toLowerCase() !== 'identity') {
      recordFailedTransfer()
      cancelResponse(response)
      throw invalidInput('HTTP range source does not support content-encoded responses')
    }
    if (this.#validator && response.headers.get(this.#validator.header) !== this.#validator.value) {
      recordFailedTransfer(true)
      cancelResponse(response)
      throw invalidInput(`HTTP range source ${this.#validator.header} changed during reading`)
    }
    const expected = end - start + 1
    let data: Uint8Array<ArrayBuffer>
    try {
      const evidence = this.#evidence
      const recordResponseBytes =
        evidence === undefined
          ? undefined
          : (bytes: number): void => {
              transferredBytes += bytes
              firstByteMicroseconds ??= Math.max(0, evidence.nowMicroseconds() - started)
            }
      data = await exactResponseBytes(
        response,
        'HTTP range response',
        expected,
        signal,
        recordResponseBytes,
      )
    } catch (error) {
      recordFailedTransfer()
      throw error
    }
    this.#transferBytes += data.byteLength
    const evidenceId = this.#evidence?.physicalTransfer({
      start,
      end: end + 1,
      transferredBytes: data.byteLength,
      status: response.status,
      durationMicroseconds: Math.max(0, (this.#evidence?.nowMicroseconds() ?? 0) - started),
      ...(firstByteMicroseconds === undefined ? {} : { firstByteMicroseconds }),
      outcome: 'complete',
      policy: this.#rangePolicy,
    })
    return Object.freeze({
      start,
      data,
      evidenceIds: Object.freeze(evidenceId === undefined ? [] : [evidenceId]),
    })
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
    const dependencies = options[sourceReadEvidenceDependencies]
    const blockBytes = this.#adaptiveBlockBytes
    const firstBlock = Math.floor(offset / blockBytes) * blockBytes
    const lastBlock = Math.floor((offset + available - 1) / blockBytes) * blockBytes
    if (firstBlock === lastBlock) {
      const block = await this.#load(firstBlock, blockBytes, options.signal, dependencies)
      const blockOffset = offset - firstBlock
      const result = block.data.subarray(blockOffset, blockOffset + available)
      this.#observeRead(offset, available)
      return result
    }
    const output = new Uint8Array(available)
    let outputOffset = 0
    for (let start = firstBlock; start <= lastBlock; start += blockBytes) {
      this.#recordAbortedConsumer(this.#lifetimeSignal)
      this.#recordAbortedConsumer(options.signal)
      const block = await this.#load(start, blockBytes, options.signal, dependencies)
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
    this.#observeRead(offset, available)
    return output
  }

  #observeRead(offset: number, returnedBytes: number): void {
    if (this.#rangePolicy !== 'adaptive') return
    if (offset === this.#previousReadEnd) this.#sequentialReads += 1
    else this.#sequentialReads = 0
    this.#previousReadEnd = offset + returnedBytes
    if (
      this.#sequentialReads >= this.#sequentialReadsBeforeGrowth &&
      this.#adaptiveBlockBytes < this.#maxAdaptiveBlockBytes
    ) {
      const previous = this.#adaptiveBlockBytes
      this.#adaptiveBlockBytes = Math.min(this.#maxAdaptiveBlockBytes, previous * 2)
      this.#sequentialReads = 0
      this.#evidence?.operation({
        operationId: 'http-range-policy',
        phase: 'planned',
        detail: `sequential reads increased block bytes from ${previous} to ${this.#adaptiveBlockBytes}`,
      })
    }
  }
}

const unsupportedFetch = (): ImageError =>
  new ImageError('UNSUPPORTED_OPERATION', 'HTTP range sources require the Fetch API')
