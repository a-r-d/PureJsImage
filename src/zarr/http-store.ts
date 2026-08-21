import { combineAbortSignals, throwIfAborted, waitForPromise } from '../abort.ts'
import { ImageError, invalidInput } from '../errors.ts'
import type { ImageSource, ImageSourceReadOptions } from '../source.ts'
import { stableSourceBuffers } from '../source.ts'
import type { RemoteSourceIdentity } from '../source-identity.ts'
import { createSessionSourceIdentity, imageSourceIdentity } from '../source-identity.ts'
import { HttpRangeSource, type HttpRangeSourceStats } from '../sources/http-range.ts'
import type { ZarrObject, ZarrObjectStore } from './core.ts'
import { normalizeZarrObjectPath } from './core.ts'

export interface NormalizedZarrStoreUrl {
  readonly storeRootUrl: string
  readonly primaryMetadataName: 'zarr.json' | '.zgroup' | '.zattrs'
  readonly discoverRootMetadata: boolean
}

export interface ZarrHttpStoreStats {
  readonly objectRequests: number
  readonly rangeRequests: number
  readonly metadataRequests: number
  readonly arrayRequests: number
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

export interface ZarrHttpStoreOptions {
  readonly fetch?: typeof fetch
  readonly signal?: AbortSignal
  readonly maxOpenSources?: number
  readonly blockBytes?: number
  readonly maxCacheBytesPerSource?: number
}

/** Root-scoped identity evidence. This is not a version claim for every object in the store. */
export interface ZarrHttpStoreIdentitySummary {
  readonly normalizedRootUrl: string
  readonly selectedRootMetadataObject: string
  readonly sourceIdentityStrength: RemoteSourceIdentity['strength']
  readonly rootObjectSize: number
  readonly rootObjectValidator?: RemoteSourceIdentity['validator']
  readonly sessionIdentity?: string
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

export const normalizeZarrStoreUrl = (input: string | URL): NormalizedZarrStoreUrl => {
  let url: URL
  try {
    url = new URL(String(input))
  } catch (cause) {
    throw new ImageError('INVALID_INPUT', 'Zarr store URL is invalid', { cause })
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw invalidInput('Zarr store URL must use HTTP or HTTPS')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw invalidInput('Zarr store URL must not contain credentials')
  }
  if (url.hash.length > 0) throw invalidInput('Zarr store URL must not contain a fragment')
  const trimmedPath = url.pathname.replace(/\/+$/u, '')
  const slash = trimmedPath.lastIndexOf('/')
  const lastEncoded = slash < 0 ? trimmedPath : trimmedPath.slice(slash + 1)
  let last: string
  try {
    last = decodeURIComponent(lastEncoded).toLowerCase()
  } catch (cause) {
    throw new ImageError('INVALID_INPUT', 'Zarr store URL path is malformed', { cause })
  }
  const explicitMetadata = rootMetadataNames.has(last)
  const primaryMetadataName = explicitMetadata
    ? (last as NormalizedZarrStoreUrl['primaryMetadataName'])
    : 'zarr.json'
  const rootPath = explicitMetadata ? trimmedPath.slice(0, Math.max(0, slash)) : trimmedPath
  url.pathname = `${rootPath.replace(/\/+$/u, '')}/`
  return Object.freeze({
    storeRootUrl: url.href,
    primaryMetadataName,
    discoverRootMetadata: !explicitMetadata,
  })
}

export const resolveZarrObjectUrl = (storeRootUrl: string, name: unknown): string => {
  const relative = normalizeZarrObjectPath(name)
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
    throw invalidInput('Zarr object URL escapes the configured store root')
  }
  return target.href
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

export class ZarrHttpObjectStore implements ZarrObjectStore {
  readonly normalized: NormalizedZarrStoreUrl
  readonly #fetch: typeof fetch
  readonly #lifetime = new AbortController()
  readonly #externalSignal: AbortSignal | undefined
  readonly #externalAbort = (): void => this.close()
  readonly #maxOpenSources: number
  readonly #blockBytes: number
  readonly #maxCacheBytesPerSource: number
  readonly #sources = new Map<string, TrackedHttpRangeSource>()
  readonly #pending = new Map<string, Promise<TrackedHttpRangeSource | undefined>>()
  readonly #sourceTotals = emptySourceTotals()
  readonly #metadataSourceTotals = emptySourceTotals()
  readonly #arraySourceTotals = emptySourceTotals()
  #rootMetadata:
    | {
        readonly name: string
        readonly identity: RemoteSourceIdentity
        readonly sessionIdentity?: string
      }
    | undefined
  #objectRequests = 0
  #rangeRequests = 0
  #objectsOpened = 0
  #baseline: ZarrHttpStoreStats

  constructor(input: string | URL, options: Readonly<ZarrHttpStoreOptions> = {}) {
    this.normalized = normalizeZarrStoreUrl(input)
    const configuredFetch = options.fetch ?? globalThis.fetch
    if (typeof configuredFetch !== 'function') {
      throw new ImageError('UNSUPPORTED_OPERATION', 'Remote Zarr requires the Fetch API')
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
    this.#externalSignal = options.signal
    this.#baseline = this.#rawStats()
    if (this.#externalSignal?.aborted) this.close()
    else this.#externalSignal?.addEventListener('abort', this.#externalAbort, { once: true })
  }

  get signal(): AbortSignal {
    return this.#lifetime.signal
  }

  async openRootObject(): Promise<ZarrObject> {
    const candidates: readonly NormalizedZarrStoreUrl['primaryMetadataName'][] = this.normalized
      .discoverRootMetadata
      ? ['zarr.json', '.zgroup', '.zattrs']
      : [this.normalized.primaryMetadataName]
    let primary: ZarrObject | undefined
    for (const name of candidates) {
      primary = await this.#openResource(name, this.#lifetime.signal)
      if (primary !== undefined) break
    }
    if (primary === undefined) {
      throw invalidInput(`Zarr root metadata ${candidates.join(', ')} was not found`)
    }
    const identity = await primary.source[imageSourceIdentity]?.()
    if (identity?.kind !== 'remote') {
      throw invalidInput('Zarr HTTP root metadata is missing its remote source identity')
    }
    const stable = identity.validator?.kind === 'etag' || identity.validator?.kind === 'version-id'
    const sessionIdentity = stable
      ? undefined
      : (this.#rootMetadata?.sessionIdentity ?? createSessionSourceIdentity(identity.size).id)
    this.#rootMetadata = Object.freeze({
      name: primary.id,
      identity,
      ...(sessionIdentity === undefined ? {} : { sessionIdentity }),
    })
    return primary
  }

  async resolve(relative: string, signal?: AbortSignal): Promise<ZarrObject | undefined> {
    return this.#openResource(normalizeZarrObjectPath(relative), signal)
  }

  stats(): ZarrHttpStoreStats {
    const raw = this.#rawStats()
    return Object.freeze({
      objectRequests: Math.max(0, raw.objectRequests - this.#baseline.objectRequests),
      rangeRequests: Math.max(0, raw.rangeRequests - this.#baseline.rangeRequests),
      metadataRequests: Math.max(0, raw.metadataRequests - this.#baseline.metadataRequests),
      arrayRequests: Math.max(0, raw.arrayRequests - this.#baseline.arrayRequests),
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

  /** Return JSON-safe evidence for the selected root metadata object. */
  identitySummary(): ZarrHttpStoreIdentitySummary {
    const root = this.#rootMetadata
    if (root === undefined) throw invalidInput('Zarr HTTP root metadata has not been opened')
    return Object.freeze({
      normalizedRootUrl: this.normalized.storeRootUrl,
      selectedRootMetadataObject: root.name,
      sourceIdentityStrength: root.identity.strength,
      rootObjectSize: root.identity.size,
      ...(root.identity.validator === undefined
        ? {}
        : { rootObjectValidator: Object.freeze({ ...root.identity.validator }) }),
      ...(root.sessionIdentity === undefined ? {} : { sessionIdentity: root.sessionIdentity }),
    })
  }

  close(): void {
    this.#externalSignal?.removeEventListener('abort', this.#externalAbort)
    if (!this.#lifetime.signal.aborted) this.#lifetime.abort()
    this.#sources.clear()
    this.#pending.clear()
  }

  async #openResource(
    name: string,
    consumerSignal: AbortSignal | undefined,
  ): Promise<ZarrObject | undefined> {
    throwIfAborted(this.#lifetime.signal)
    throwIfAborted(consumerSignal)
    const normalizedName = normalizeZarrObjectPath(name)
    const cached = this.#sources.get(normalizedName)
    if (cached !== undefined) {
      this.#sources.delete(normalizedName)
      this.#sources.set(normalizedName, cached)
      return Object.freeze({ id: normalizedName, source: cached })
    }
    let opening = this.#pending.get(normalizedName)
    if (opening === undefined) {
      opening = this.#openSource(normalizedName)
      this.#pending.set(normalizedName, opening)
      void opening.finally(() => this.#pending.delete(normalizedName)).catch(() => undefined)
    }
    const signal = combineAbortSignals(this.#lifetime.signal, consumerSignal)
    const source = await waitForPromise(opening, signal)
    return source === undefined ? undefined : Object.freeze({ id: normalizedName, source })
  }

  async #openSource(name: string): Promise<TrackedHttpRangeSource | undefined> {
    const url = resolveZarrObjectUrl(this.normalized.storeRootUrl, name)
    const remoteSource = await HttpRangeSource.open(url, {
      allowNotFound: true,
      allowHeadSizeFallback: true,
      blockBytes: this.#blockBytes,
      fetch: this.#fetch,
      lifetimeSignal: this.#lifetime.signal,
      maxCacheBytes: this.#maxCacheBytesPerSource,
      openSignal: this.#lifetime.signal,
    })
    if (remoteSource === undefined) return undefined
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

  #rawStats(): ZarrHttpStoreStats {
    let sourceCacheBytes = 0
    for (const source of this.#sources.values()) {
      const stats = source.stats
      sourceCacheBytes += stats.cacheBytes
    }
    return {
      objectRequests: this.#objectRequests,
      rangeRequests: this.#rangeRequests,
      metadataRequests: this.#metadataSourceTotals.requests,
      arrayRequests: this.#arraySourceTotals.requests,
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
