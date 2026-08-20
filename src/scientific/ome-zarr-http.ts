import { combineAbortSignals, throwIfAborted, waitForPromise } from '../abort.ts'
import { ImageError, invalidInput } from '../errors.ts'
import type { ImageSource, ImageSourceReadOptions } from '../source.ts'
import { stableSourceBuffers } from '../source.ts'
import type { RemoteSourceIdentity } from '../source-identity.ts'
import { createSessionSourceIdentity, imageSourceIdentity } from '../source-identity.ts'
import { HttpRangeSource, type HttpRangeSourceStats } from '../sources/http-range.ts'
import type {
  ScientificCompanionRequest,
  ScientificCompanionResolver,
  ScientificOpenContext,
  ScientificDocument,
  ScientificResource,
} from './reader.ts'
import { normalizeScientificRelativeName } from './reader.ts'

export interface NormalizedOmeZarrStoreUrl {
  readonly storeRootUrl: string
  readonly primaryMetadataName: 'zarr.json' | '.zgroup' | '.zattrs'
  readonly discoverRootMetadata: boolean
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

/** Root-scoped identity evidence. This is not a version claim for every object in the store. */
export interface OmeZarrHttpStoreIdentitySummary {
  readonly normalizedRootUrl: string
  readonly selectedRootMetadataObject: string
  readonly sourceIdentityStrength: RemoteSourceIdentity['strength']
  readonly rootObjectSize: number
  readonly rootObjectValidator?: RemoteSourceIdentity['validator']
  readonly sessionIdentity?: string
  readonly zarrFormat?: 2 | 3
  readonly omeNgffVersion?: string
}

/** A reader-ready remote context that retains its owning store for stats and cleanup. */
export interface OmeZarrHttpContext extends ScientificOpenContext {
  readonly store: OmeZarrHttpStore
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
  const explicitMetadata = rootMetadataNames.has(last)
  const primaryMetadataName = explicitMetadata
    ? (last as NormalizedOmeZarrStoreUrl['primaryMetadataName'])
    : 'zarr.json'
  const rootPath = explicitMetadata ? trimmedPath.slice(0, Math.max(0, slash)) : trimmedPath
  url.pathname = `${rootPath.replace(/\/+$/u, '')}/`
  return Object.freeze({
    storeRootUrl: url.href,
    primaryMetadataName,
    discoverRootMetadata: !explicitMetadata,
  })
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
    this.#externalSignal = options.signal
    this.#baseline = this.#rawStats()
    if (this.#externalSignal?.aborted) this.close()
    else this.#externalSignal?.addEventListener('abort', this.#externalAbort, { once: true })
  }

  async openContext(): Promise<ScientificOpenContext> {
    const candidates: readonly NormalizedOmeZarrStoreUrl['primaryMetadataName'][] = this.normalized
      .discoverRootMetadata
      ? ['zarr.json', '.zgroup', '.zattrs']
      : [this.normalized.primaryMetadataName]
    let primary: ScientificResource | undefined
    for (const name of candidates) {
      primary = await this.#openResource(name, this.#lifetime.signal)
      if (primary !== undefined) break
    }
    if (primary === undefined) {
      throw invalidInput(`OME-Zarr root metadata ${candidates.join(', ')} was not found`)
    }
    const identity = await primary.source[imageSourceIdentity]?.()
    if (identity?.kind !== 'remote') {
      throw invalidInput('OME-Zarr HTTP root metadata is missing its remote source identity')
    }
    const stable = identity.validator?.kind === 'etag' || identity.validator?.kind === 'version-id'
    const sessionIdentity = stable
      ? undefined
      : (this.#rootMetadata?.sessionIdentity ?? createSessionSourceIdentity(identity.size).id)
    this.#rootMetadata = Object.freeze({
      name: primary.name ?? primary.id,
      identity,
      ...(sessionIdentity === undefined ? {} : { sessionIdentity }),
    })
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

  /**
   * Return JSON-safe evidence for the selected root metadata object.
   *
   * Pass the document returned by the OME-Zarr reader to include its parsed NGFF and Zarr
   * versions. Validators in this summary apply only to the root metadata object.
   */
  identitySummary(
    document?: Pick<ScientificDocument, 'reader' | 'metadata'>,
  ): OmeZarrHttpStoreIdentitySummary {
    const root = this.#rootMetadata
    if (root === undefined) throw invalidInput('OME-Zarr HTTP root metadata has not been opened')
    if (document !== undefined && document.reader.id !== 'purejsimage/ome-zarr') {
      throw invalidInput('OME-Zarr HTTP identity summary requires an OME-Zarr document')
    }
    const rawZarrFormat = document?.metadata.zarrFormat
    const zarrFormat = rawZarrFormat === 2 || rawZarrFormat === 3 ? rawZarrFormat : undefined
    const rawOmeNgffVersion = document?.metadata.omeNgffVersion
    const omeNgffVersion = typeof rawOmeNgffVersion === 'string' ? rawOmeNgffVersion : undefined
    return Object.freeze({
      normalizedRootUrl: this.normalized.storeRootUrl,
      selectedRootMetadataObject: root.name,
      sourceIdentityStrength: root.identity.strength,
      rootObjectSize: root.identity.size,
      ...(root.identity.validator === undefined
        ? {}
        : { rootObjectValidator: Object.freeze({ ...root.identity.validator }) }),
      ...(root.sessionIdentity === undefined ? {} : { sessionIdentity: root.sessionIdentity }),
      ...(zarrFormat === undefined ? {} : { zarrFormat }),
      ...(omeNgffVersion === undefined ? {} : { omeNgffVersion }),
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

/** Open a bounded remote OME-Zarr store and return a context accepted directly by the reader. */
export const createOmeZarrHttpContext = async (
  input: string | URL,
  options: Readonly<OmeZarrHttpStoreOptions> = {},
): Promise<OmeZarrHttpContext> => {
  const store = new OmeZarrHttpStore(input, options)
  try {
    const context = await store.openContext()
    return Object.freeze({ ...context, store })
  } catch (cause) {
    store.close()
    throw cause
  }
}
