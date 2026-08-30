import { invalidInput } from '../errors.ts'
import type { RemoteSourceIdentity } from '../source-identity.ts'
import type {
  ScientificCompanionRequest,
  ScientificCompanionResolver,
  ScientificDocument,
  ScientificOpenContext,
  ScientificResource,
} from './reader.ts'
import { normalizeScientificRelativeName } from './reader.ts'
import {
  normalizeZarrStoreUrl,
  resolveZarrObjectUrl,
  ZarrHttpObjectStore,
  type NormalizedZarrStoreUrl,
  type ZarrHttpStoreOptions,
  type ZarrHttpStoreStats,
} from '../zarr/http-store.ts'
import type { EvidenceContext } from '../evidence.ts'

export type NormalizedOmeZarrStoreUrl = NormalizedZarrStoreUrl
export type OmeZarrNetworkStats = ZarrHttpStoreStats
export type OmeZarrHttpStoreOptions = ZarrHttpStoreOptions

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

export const normalizeOmeZarrStoreUrl = normalizeZarrStoreUrl

export const resolveOmeZarrObjectUrl = (storeRootUrl: string, name: unknown): string =>
  resolveZarrObjectUrl(storeRootUrl, normalizeScientificRelativeName(name))

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

/** OME-Zarr compatibility adapter over the generic HTTP object store. */
export class OmeZarrHttpStore implements ScientificCompanionResolver {
  readonly #store: ZarrHttpObjectStore
  readonly #evidence: EvidenceContext | undefined

  constructor(input: string | URL, options: Readonly<OmeZarrHttpStoreOptions> = {}) {
    this.#store = new ZarrHttpObjectStore(input, options)
    this.#evidence = options.evidence
  }

  get normalized(): NormalizedOmeZarrStoreUrl {
    return this.#store.normalized
  }

  async openContext(): Promise<ScientificOpenContext> {
    const object = await this.#store.openRootObject()
    const primary: ScientificResource = Object.freeze({
      ...object,
      name: object.id,
    })
    return Object.freeze({
      primary,
      companions: this,
      readerId: 'purejsimage/ome-zarr',
      signal: this.#store.signal,
      ...(this.#evidence === undefined ? {} : { evidence: this.#evidence }),
    })
  }

  async resolve(
    request: Readonly<ScientificCompanionRequest>,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<ScientificResource | undefined> {
    const object = await this.#store.resolve(requestedName(request), options.signal)
    return object === undefined ? undefined : Object.freeze({ ...object, name: object.id })
  }

  stats(): OmeZarrNetworkStats {
    return this.#store.stats()
  }

  resetStats(): void {
    this.#store.resetStats()
  }

  async quiesce(): Promise<void> {
    await this.#store.quiesce()
  }

  identitySummary(
    document?: Pick<ScientificDocument, 'reader' | 'metadata'>,
  ): OmeZarrHttpStoreIdentitySummary {
    if (document !== undefined && document.reader.id !== 'purejsimage/ome-zarr') {
      throw invalidInput('OME-Zarr HTTP identity summary requires an OME-Zarr document')
    }
    const root = this.#store.identitySummary()
    const rawZarrFormat = document?.metadata.zarrFormat
    const zarrFormat = rawZarrFormat === 2 || rawZarrFormat === 3 ? rawZarrFormat : undefined
    const rawOmeNgffVersion = document?.metadata.omeNgffVersion
    const omeNgffVersion = typeof rawOmeNgffVersion === 'string' ? rawOmeNgffVersion : undefined
    return Object.freeze({
      ...root,
      ...(zarrFormat === undefined ? {} : { zarrFormat }),
      ...(omeNgffVersion === undefined ? {} : { omeNgffVersion }),
    })
  }

  close(): void {
    this.#store.close()
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
