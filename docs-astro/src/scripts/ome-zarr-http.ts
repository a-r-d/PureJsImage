import { combineAbortSignals, throwIfAborted, waitForPromise } from '../../../src/abort.ts'
import { ImageError, invalidInput } from '../../../src/errors.ts'
import type { ImageSource, ImageSourceReadOptions } from '../../../src/source.ts'
import { stableSourceBuffers } from '../../../src/source.ts'
import type { RemoteSourceIdentity } from '../../../src/source-identity.ts'
import { imageSourceIdentity } from '../../../src/source-identity.ts'
import type {
  ScientificCompanionRequest,
  ScientificCompanionResolver,
  ScientificOpenContext,
  ScientificResource,
} from '../../../src/scientific/reader.ts'
import { normalizeScientificRelativeName } from '../../../src/scientific/reader.ts'
import { HttpRangeSource, type HttpRangeSourceStats } from '../../../src/sources/http-range.ts'

export interface NormalizedOmeZarrStoreUrl {
  readonly storeRootUrl: string
  readonly primaryMetadataName: 'zarr.json' | '.zgroup' | '.zattrs'
}

export interface OmeZarrNetworkStats {
  readonly objectRequests: number
  readonly rangeRequests: number
  readonly bytesFetched: number
  readonly uniqueBytes: number
  readonly metadataBytesFetched: number
  readonly arrayBytesFetched: number
  readonly sourceCacheHits: number
  readonly sourceCacheBytes: number
  readonly coalescedConsumers: number
  readonly abortedConsumers: number
  readonly objectsOpened: number
}

export interface OmeZarrHttpStoreOptions {
  readonly fetch?: typeof fetch
  readonly signal?: AbortSignal
  readonly maxOpenSources?: number
  readonly blockBytes?: number
  readonly maxCacheBytesPerSource?: number
}

interface SourceTotals {
  requests: number
  bytesFetched: number
  uniqueBytes: number
  cacheHits: number
  coalescedConsumers: number
  abortedConsumers: number
}

const emptySourceTotals = (): SourceTotals => ({
  requests: 0,
  bytesFetched: 0,
  uniqueBytes: 0,
  cacheHits: 0,
  coalescedConsumers: 0,
  abortedConsumers: 0,
})

const rootMetadataNames = new Set(['zarr.json', '.zgroup', '.zattrs'])

const positiveInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput(`${label} must be positive`)
  return value
}

export const normalizeOmeZarrStoreUrl = (input: string | URL): NormalizedOmeZarrStoreUrl => {
  let url: URL
  try {
    url = new URL(String(input))
  } catch (cause) {
    throw new ImageError('INVALID_INPUT', 'OME-Zarr store URL is invalid', { cause })
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw invalidInput('OME-Zarr store URL must use HTTP or HTTPS')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw invalidInput('OME-Zarr store URL must not contain credentials')
  }
  if (url.hash.length > 0) throw invalidInput('OME-Zarr store URL must not contain a fragment')
  const trimmedPath = url.pathname.replace(/\/+$/u, '')
  const slash = trimmedPath.lastIndexOf('/')
  const lastEncoded = slash < 0 ? trimmedPath : trimmedPath.slice(slash + 1)
  let last: string
  try {
    last = decodeURIComponent(lastEncoded).toLowerCase()
  } catch (cause) {
    throw new ImageError('INVALID_INPUT', 'OME-Zarr store URL path is malformed', { cause })
  }
  const primaryMetadataName = rootMetadataNames.has(last)
    ? (last as NormalizedOmeZarrStoreUrl['primaryMetadataName'])
    : 'zarr.json'
  const rootPath = rootMetadataNames.has(last)
    ? trimmedPath.slice(0, Math.max(0, slash))
    : trimmedPath
  url.pathname = `${rootPath.replace(/\/+$/u, '')}/`
  return Object.freeze({ storeRootUrl: url.href, primaryMetadataName })
}

export const resolveOmeZarrObjectUrl = (storeRootUrl: string, name: unknown): string => {
  const relative = normalizeScientificRelativeName(name)
  const root = new URL(storeRootUrl)
  const target = new URL(root.href)
  const encoded = relative
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  target.pathname = `${root.pathname}${encoded}`
  if (
    target.origin !== root.origin ||
    target.protocol !== root.protocol ||
    !target.pathname.startsWith(root.pathname)
  ) {
    throw invalidInput('OME-Zarr object URL escapes the configured store root')
  }
  return target.href
}

const requestedName = (request: Readonly<ScientificCompanionRequest>): string => {
  const name = request.kind === 'relative-name' ? request.name : request.relativeName
  if (name === undefined) {
    throw invalidInput(
      request.kind === 'role'
        ? `OME-Zarr companion role ${request.role} requires a relative name`
        : 'OME-Zarr companion relative name is missing',
    )
  }
  return normalizeScientificRelativeName(name)
}

const addSourceStats = (target: SourceTotals, source: Readonly<SourceTotals>): void => {
  target.requests += source.requests
  target.bytesFetched += source.bytesFetched
  target.uniqueBytes += source.uniqueBytes
  target.cacheHits += source.cacheHits
  target.coalescedConsumers += source.coalescedConsumers
  target.abortedConsumers += source.abortedConsumers
}

class TrackedHttpRangeSource implements ImageSource {
  readonly [stableSourceBuffers] = true
  readonly #source: HttpRangeSource
  readonly #record: (delta: Readonly<SourceTotals>) => void
  #last = emptySourceTotals()

  constructor(source: HttpRangeSource, record: (delta: Readonly<SourceTotals>) => void) {
    this.#source = source
    this.#record = record
    this.#sync()
  }

  get size(): number {
    return this.#source.size
  }

  get stats(): HttpRangeSourceStats {
    this.#sync()
    return this.#source.stats
  }

  [imageSourceIdentity](): RemoteSourceIdentity {
    return this.#source[imageSourceIdentity]()
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    try {
      return await this.#source.read(offset, length, options)
    } finally {
      this.#sync()
    }
  }

  #sync(): void {
    const current = this.#source.stats
    const delta = {
      requests: current.requests - this.#last.requests,
      bytesFetched: current.bytesFetched - this.#last.bytesFetched,
      uniqueBytes: current.uniqueBytes - this.#last.uniqueBytes,
      cacheHits: current.cacheHits - this.#last.cacheHits,
      coalescedConsumers: current.coalescedConsumers - this.#last.coalescedConsumers,
      abortedConsumers: current.abortedConsumers - this.#last.abortedConsumers,
    }
    addSourceStats(this.#last, delta)
    this.#record(delta)
  }
}

export class OmeZarrHttpStore implements ScientificCompanionResolver {
  readonly normalized: NormalizedOmeZarrStoreUrl
  readonly #fetch: typeof fetch
  readonly #lifetime = new AbortController()
  readonly #maxOpenSources: number
  readonly #blockBytes: number
  readonly #maxCacheBytesPerSource: number
  readonly #sources = new Map<string, TrackedHttpRangeSource>()
  readonly #pending = new Map<string, Promise<TrackedHttpRangeSource | undefined>>()
  readonly #sourceTotals = emptySourceTotals()
  readonly #metadataSourceTotals = emptySourceTotals()
  readonly #arraySourceTotals = emptySourceTotals()
  #objectRequests = 0
  #rangeRequests = 0
  #objectsOpened = 0
  #baseline: OmeZarrNetworkStats

  constructor(input: string | URL, options: Readonly<OmeZarrHttpStoreOptions> = {}) {
    this.normalized = normalizeOmeZarrStoreUrl(input)
    const configuredFetch = options.fetch ?? globalThis.fetch
    if (typeof configuredFetch !== 'function') {
      throw new ImageError('UNSUPPORTED_OPERATION', 'Remote OME-Zarr requires the Fetch API')
    }
    this.#fetch = async (request, init) => {
      this.#objectRequests += 1
      if (new Headers(init?.headers).has('range')) this.#rangeRequests += 1
      return configuredFetch(request, init)
    }
    this.#maxOpenSources = positiveInteger(options.maxOpenSources ?? 24, 'Maximum open sources')
    this.#blockBytes = positiveInteger(options.blockBytes ?? 262_144, 'HTTP range block size')
    this.#maxCacheBytesPerSource = positiveInteger(
      options.maxCacheBytesPerSource ?? 2_097_152,
      'HTTP source cache size',
    )
    if (this.#maxCacheBytesPerSource < this.#blockBytes) {
      throw invalidInput('HTTP source cache size must hold at least one range block')
    }
    options.signal?.addEventListener('abort', () => this.close(), { once: true })
    this.#baseline = this.#rawStats()
  }

  async openContext(): Promise<ScientificOpenContext> {
    const primaryName = this.normalized.primaryMetadataName
    const primary = await this.#openResource(primaryName, this.#lifetime.signal)
    if (primary === undefined) {
      throw invalidInput(`OME-Zarr root metadata ${primaryName} was not found`)
    }
    return Object.freeze({
      primary,
      companions: this,
      readerId: 'purejsimage/ome-zarr',
      signal: this.#lifetime.signal,
    })
  }

  async resolve(
    request: Readonly<ScientificCompanionRequest>,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<ScientificResource | undefined> {
    return this.#openResource(requestedName(request), options.signal)
  }

  stats(): OmeZarrNetworkStats {
    const raw = this.#rawStats()
    return Object.freeze({
      objectRequests: Math.max(0, raw.objectRequests - this.#baseline.objectRequests),
      rangeRequests: Math.max(0, raw.rangeRequests - this.#baseline.rangeRequests),
      bytesFetched: Math.max(0, raw.bytesFetched - this.#baseline.bytesFetched),
      uniqueBytes: Math.max(0, raw.uniqueBytes - this.#baseline.uniqueBytes),
      metadataBytesFetched: Math.max(
        0,
        raw.metadataBytesFetched - this.#baseline.metadataBytesFetched,
      ),
      arrayBytesFetched: Math.max(0, raw.arrayBytesFetched - this.#baseline.arrayBytesFetched),
      sourceCacheHits: Math.max(0, raw.sourceCacheHits - this.#baseline.sourceCacheHits),
      sourceCacheBytes: raw.sourceCacheBytes,
      coalescedConsumers: Math.max(0, raw.coalescedConsumers - this.#baseline.coalescedConsumers),
      abortedConsumers: Math.max(0, raw.abortedConsumers - this.#baseline.abortedConsumers),
      objectsOpened: Math.max(0, raw.objectsOpened - this.#baseline.objectsOpened),
    })
  }

  resetStats(): void {
    this.#baseline = this.#rawStats()
  }

  close(): void {
    if (!this.#lifetime.signal.aborted) this.#lifetime.abort()
    this.#sources.clear()
    this.#pending.clear()
  }

  async #openResource(
    name: string,
    consumerSignal: AbortSignal | undefined,
  ): Promise<ScientificResource | undefined> {
    throwIfAborted(this.#lifetime.signal)
    throwIfAborted(consumerSignal)
    const normalizedName = normalizeScientificRelativeName(name)
    const cached = this.#sources.get(normalizedName)
    if (cached !== undefined) {
      this.#sources.delete(normalizedName)
      this.#sources.set(normalizedName, cached)
      return Object.freeze({ id: normalizedName, name: normalizedName, source: cached })
    }
    let opening = this.#pending.get(normalizedName)
    if (opening === undefined) {
      opening = this.#openSource(normalizedName)
      this.#pending.set(normalizedName, opening)
      void opening.finally(() => this.#pending.delete(normalizedName)).catch(() => undefined)
    }
    const signal = combineAbortSignals(this.#lifetime.signal, consumerSignal)
    const source = await waitForPromise(opening, signal)
    return source === undefined
      ? undefined
      : Object.freeze({ id: normalizedName, name: normalizedName, source })
  }

  async #openSource(name: string): Promise<TrackedHttpRangeSource | undefined> {
    const url = resolveOmeZarrObjectUrl(this.normalized.storeRootUrl, name)
    let head: Response
    try {
      head = await this.#fetch(url, { method: 'HEAD', signal: this.#lifetime.signal })
    } catch (cause) {
      throwIfAborted(this.#lifetime.signal)
      throw new ImageError('INVALID_INPUT', `OME-Zarr object request failed for ${name}`, { cause })
    }
    if (head.status === 404 || head.status === 410) return undefined
    if (head.status !== 200) {
      throw invalidInput(`OME-Zarr object ${name} returned status ${head.status}`)
    }
    const size = Number(head.headers.get('content-length'))
    if (!Number.isSafeInteger(size) || size < 1) {
      throw invalidInput(`OME-Zarr object ${name} is missing a valid Content-Length header`)
    }
    const remoteSource = await HttpRangeSource.open(url, {
      allowHeadSizeFallback: true,
      blockBytes: this.#blockBytes,
      expectedSize: size,
      fetch: this.#fetch,
      lifetimeSignal: this.#lifetime.signal,
      maxCacheBytes: this.#maxCacheBytesPerSource,
      openSignal: this.#lifetime.signal,
    })
    const metadataObject = /(?:^|\/)(?:zarr\.json|\.zgroup|\.zattrs|\.zarray)$/u.test(name)
    const source = new TrackedHttpRangeSource(remoteSource, (delta) => {
      addSourceStats(this.#sourceTotals, delta)
      addSourceStats(metadataObject ? this.#metadataSourceTotals : this.#arraySourceTotals, delta)
    })
    this.#objectsOpened += 1
    this.#sources.set(name, source)
    while (this.#sources.size > this.#maxOpenSources) {
      const oldest = this.#sources.entries().next().value
      if (oldest === undefined) break
      this.#sources.delete(oldest[0])
    }
    return source
  }

  #rawStats(): OmeZarrNetworkStats {
    let sourceCacheBytes = 0
    for (const source of this.#sources.values()) {
      const stats = source.stats
      sourceCacheBytes += stats.cacheBytes
    }
    return {
      objectRequests: this.#objectRequests,
      rangeRequests: this.#rangeRequests,
      bytesFetched: this.#sourceTotals.bytesFetched,
      uniqueBytes: this.#sourceTotals.uniqueBytes,
      metadataBytesFetched: this.#metadataSourceTotals.bytesFetched,
      arrayBytesFetched: this.#arraySourceTotals.bytesFetched,
      sourceCacheHits: this.#sourceTotals.cacheHits,
      sourceCacheBytes,
      coalescedConsumers: this.#sourceTotals.coalescedConsumers,
      abortedConsumers: this.#sourceTotals.abortedConsumers,
      objectsOpened: this.#objectsOpened,
    }
  }
}
