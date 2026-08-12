import type { AbortOptions } from '../abort.ts'
import { combineAbortSignals, throwIfAborted } from '../abort.ts'
import { invalidInput, limitExceeded, unsupportedFormat } from '../errors.ts'
import {
  bindImageSourceSignal,
  type ImageSource,
  type ImageSourceReadOptions,
  sourceSessionEnd,
  sourceSessionStart,
  withSourceSession,
} from '../source.ts'
import type {
  NormalizedScientificDatasetDescriptor,
  ScientificDataset,
  ScientificMetadataObject,
} from './dataset-v2.ts'
import { normalizeScientificMetadataObject } from './dataset-v2.ts'

export type ScientificSourceIdentityStrength = 'weak' | 'strong'

/** Caller-supplied evidence about a resource; it is not itself a verified content identity. */
export interface ScientificSourceIdentityHint {
  readonly kind: string
  readonly value: string
  readonly strength?: ScientificSourceIdentityStrength
}

/** One named input resource used by a scientific reader. */
export interface ScientificResource {
  readonly id: string
  readonly source: ImageSource
  readonly name?: string
  readonly mediaType?: string
  readonly identityHint?: ScientificSourceIdentityHint
}

export type ScientificCompanionRequest =
  | {
      readonly kind: 'relative-name'
      readonly name: string
    }
  | {
      readonly kind: 'role'
      readonly role: string
      readonly relativeName?: string
    }

/** Runtime adapter for resolving format companions without portable filesystem assumptions. */
export interface ScientificCompanionResolver {
  resolve(
    request: Readonly<ScientificCompanionRequest>,
    options?: Readonly<AbortOptions>,
  ): Promise<ScientificResource | undefined>
}

export interface ScientificProbeLimits {
  /** Sum of logical bytes admitted across all probe reads and resources. */
  readonly maxTotalBytes: number
  /** Number of non-empty source reads admitted across all probes and resources. */
  readonly maxTotalReads: number
  /** Number of reader probes that may execute during one detection. */
  readonly maxReaders: number
  /** Largest single logical source read a probe may request. */
  readonly maxReadBytes: number
}

export type ScientificProbeLimitOptions = Partial<ScientificProbeLimits>

export const defaultScientificProbeLimits: Readonly<ScientificProbeLimits> = Object.freeze({
  maxTotalBytes: 65_536,
  maxTotalReads: 32,
  maxReaders: 32,
  maxReadBytes: 16_384,
})

export interface ScientificOpenContext extends AbortOptions {
  readonly primary: ScientificResource
  readonly companions?: ScientificCompanionResolver
  /** Explicitly select a registered reader and bypass probing. */
  readonly readerId?: string
  /** Disambiguate explicitly registered versions of one reader ID. */
  readonly readerVersion?: string
  readonly probeLimits?: ScientificProbeLimitOptions
}

export interface ScientificReaderDescriptor {
  readonly id: string
  readonly version: string
  readonly format: string
  /** Lowercase extensions without a leading dot. Hints never override bytes. */
  readonly extensions: readonly string[]
  readonly mediaTypes: readonly string[]
  readonly capabilities: ScientificMetadataObject
}

export interface ScientificProbeResult {
  /** Inclusive confidence from 0 (not this format) through 1 (definitive match). */
  readonly confidence: number
  readonly reason?: string
}

export interface ScientificDatasetSummary {
  readonly id: string
  readonly name?: string
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly metadata?: ScientificMetadataObject
}

export interface ScientificDocumentReaderInfo {
  readonly id: string
  readonly version: string
}

export interface ScientificDocument {
  readonly reader: ScientificDocumentReaderInfo
  readonly format: string
  readonly metadata: ScientificMetadataObject
  readonly datasets: readonly ScientificDatasetSummary[]
  openDataset(id: string, options?: Readonly<AbortOptions>): Promise<ScientificDataset>
  close?(): void | Promise<void>
}

/** Executable reader code kept separate from its JSON-safe descriptor. */
export interface ScientificReader {
  readonly descriptor: ScientificReaderDescriptor
  probe(context: Readonly<ScientificOpenContext>): Promise<ScientificProbeResult>
  open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument>
}

export interface ScientificProbeStats {
  readonly readers: number
  readonly reads: number
  readonly bytes: number
}

export interface ScientificReaderDetection {
  readonly reader: ScientificReaderDescriptor
  readonly confidence: number
  readonly reason?: string
  readonly stats: ScientificProbeStats
}

interface RegisteredReader {
  readonly descriptor: ScientificReaderDescriptor
  readonly implementation: ScientificReader
}

interface SessionManagedSource extends ImageSource {
  [sourceSessionStart](): void
  [sourceSessionEnd](): Promise<void>
}

const isSessionManagedSource = (source: ImageSource): source is SessionManagedSource =>
  sourceSessionStart in source &&
  typeof source[sourceSessionStart] === 'function' &&
  sourceSessionEnd in source &&
  typeof source[sourceSessionEnd] === 'function'

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidInput(`${label} must be a non-empty string`)
  }
  return value
}

const optionalString = (value: unknown, label: string): string | undefined =>
  value === undefined ? undefined : requiredString(value, label)

const positiveInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const readerIdPattern = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._/-]*$/
const rolePattern = /^[a-z0-9][a-z0-9._-]*$/
const extensionPattern = /^[a-z0-9][a-z0-9+_-]*$/

const normalizeReaderId = (value: unknown, label: string): string => {
  const id = requiredString(value, label)
  if (!readerIdPattern.test(id)) {
    throw invalidInput(`${label} must be a lowercase namespaced identifier`)
  }
  return id
}

const normalizeStringHints = (
  value: unknown,
  label: string,
  validate: (entry: string) => boolean,
): readonly string[] => {
  if (!Array.isArray(value)) throw invalidInput(`${label} must be an array`)
  const output: string[] = []
  const seen = new Set<string>()
  for (let index = 0; index < value.length; index += 1) {
    const entry = requiredString(value[index], `${label}[${index}]`).toLowerCase()
    if (!validate(entry)) throw invalidInput(`${label}[${index}] is invalid`)
    if (seen.has(entry)) throw invalidInput(`${label} contains duplicate ${entry}`)
    seen.add(entry)
    output.push(entry)
  }
  return Object.freeze(output)
}

const normalizeReaderDescriptor = (value: ScientificReaderDescriptor): ScientificReaderDescriptor =>
  Object.freeze({
    id: normalizeReaderId(value.id, 'Scientific reader id'),
    version: requiredString(value.version, 'Scientific reader version'),
    format: requiredString(value.format, 'Scientific reader format'),
    extensions: normalizeStringHints(value.extensions, 'Scientific reader extensions', (entry) =>
      extensionPattern.test(entry),
    ),
    mediaTypes: normalizeStringHints(
      value.mediaTypes,
      'Scientific reader mediaTypes',
      (entry) => entry.includes('/') && !/\s/.test(entry),
    ),
    capabilities: normalizeScientificMetadataObject(value.capabilities),
  })

const normalizeIdentityHint = (
  value: ScientificSourceIdentityHint | undefined,
): ScientificSourceIdentityHint | undefined => {
  if (value === undefined) return undefined
  const kind = requiredString(value.kind, 'Scientific source identity kind')
  const identityValue = requiredString(value.value, 'Scientific source identity value')
  if (value.strength !== undefined && value.strength !== 'weak' && value.strength !== 'strong') {
    throw invalidInput('Scientific source identity strength must be weak or strong')
  }
  return Object.freeze({
    kind,
    value: identityValue,
    ...(value.strength === undefined ? {} : { strength: value.strength }),
  })
}

const normalizeResource = (value: ScientificResource, label: string): ScientificResource => {
  const id = requiredString(value.id, `${label}.id`)
  if (
    value.source === null ||
    typeof value.source !== 'object' ||
    !Number.isSafeInteger(value.source.size) ||
    value.source.size < 0 ||
    typeof value.source.read !== 'function'
  ) {
    throw invalidInput(`${label}.source must be an ImageSource with a valid size`)
  }
  const name = optionalString(value.name, `${label}.name`)
  const mediaType = optionalString(value.mediaType, `${label}.mediaType`)
  const identityHint = normalizeIdentityHint(value.identityHint)
  return Object.freeze({
    id,
    source: value.source,
    ...(name === undefined ? {} : { name }),
    ...(mediaType === undefined ? {} : { mediaType: mediaType.toLowerCase() }),
    ...(identityHint === undefined ? {} : { identityHint }),
  })
}

/** Reject absolute, backslash, empty-segment, and traversal-like companion names. */
export const normalizeScientificRelativeName = (value: unknown): string => {
  const name = requiredString(value, 'Scientific companion relative name').normalize('NFC')
  if (
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    /^[a-z][a-z0-9+.-]*:/i.test(name)
  ) {
    throw invalidInput('Scientific companion name must be a normalized relative name')
  }
  const segments = name.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw invalidInput('Scientific companion name must not contain empty or traversal segments')
  }
  return name
}

export const normalizeScientificCompanionRequest = (
  value: Readonly<ScientificCompanionRequest>,
): ScientificCompanionRequest => {
  if (value.kind === 'relative-name') {
    return Object.freeze({
      kind: 'relative-name',
      name: normalizeScientificRelativeName(value.name),
    })
  }
  if (value.kind !== 'role') throw invalidInput('Scientific companion request kind is invalid')
  const role = requiredString(value.role, 'Scientific companion role').toLowerCase()
  if (!rolePattern.test(role)) {
    throw invalidInput('Scientific companion role must be a lowercase identifier')
  }
  const relativeName =
    value.relativeName === undefined
      ? undefined
      : normalizeScientificRelativeName(value.relativeName)
  return Object.freeze({
    kind: 'role',
    role,
    ...(relativeName === undefined ? {} : { relativeName }),
  })
}

export const resolveScientificProbeLimits = (
  options: ScientificProbeLimitOptions = {},
): Readonly<ScientificProbeLimits> =>
  Object.freeze({
    maxTotalBytes: positiveInteger(
      options.maxTotalBytes ?? defaultScientificProbeLimits.maxTotalBytes,
      'Scientific probe maxTotalBytes',
    ),
    maxTotalReads: positiveInteger(
      options.maxTotalReads ?? defaultScientificProbeLimits.maxTotalReads,
      'Scientific probe maxTotalReads',
    ),
    maxReaders: positiveInteger(
      options.maxReaders ?? defaultScientificProbeLimits.maxReaders,
      'Scientific probe maxReaders',
    ),
    maxReadBytes: positiveInteger(
      options.maxReadBytes ?? defaultScientificProbeLimits.maxReadBytes,
      'Scientific probe maxReadBytes',
    ),
  })

class ScientificProbeBudget {
  readonly limits: Readonly<ScientificProbeLimits>
  #bytes = 0
  #reads = 0
  #readers = 0

  constructor(limits: Readonly<ScientificProbeLimits>) {
    this.limits = limits
  }

  admitReader(): void {
    if (this.#readers >= this.limits.maxReaders) {
      throw limitExceeded(`Scientific detection exceeds maxReaders ${this.limits.maxReaders}`)
    }
    this.#readers += 1
  }

  admitRead(size: number, offset: number, length: number): number {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw invalidInput('Scientific probe read offset must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(length) || length < 0) {
      throw invalidInput('Scientific probe read length must be a non-negative safe integer')
    }
    if (length > this.limits.maxReadBytes) {
      throw limitExceeded(
        `Scientific probe read ${length} exceeds maxReadBytes ${this.limits.maxReadBytes}`,
      )
    }
    const bytes = offset >= size ? 0 : Math.min(length, size - offset)
    if (bytes === 0) return 0
    if (this.#reads >= this.limits.maxTotalReads) {
      throw limitExceeded(`Scientific detection exceeds maxTotalReads ${this.limits.maxTotalReads}`)
    }
    if (this.#bytes + bytes > this.limits.maxTotalBytes) {
      throw limitExceeded(`Scientific detection exceeds maxTotalBytes ${this.limits.maxTotalBytes}`)
    }
    this.#reads += 1
    this.#bytes += bytes
    return bytes
  }

  get stats(): ScientificProbeStats {
    return Object.freeze({ readers: this.#readers, reads: this.#reads, bytes: this.#bytes })
  }
}

class ProbeLimitedSource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  readonly #budget: ScientificProbeBudget
  readonly #signal: AbortSignal | undefined

  constructor(source: ImageSource, budget: ScientificProbeBudget, signal: AbortSignal | undefined) {
    this.#source = source
    this.#budget = budget
    this.#signal = signal
    this.size = source.size
  }

  [sourceSessionStart](): void {
    if (isSessionManagedSource(this.#source)) this.#source[sourceSessionStart]()
  }

  async [sourceSessionEnd](): Promise<void> {
    if (isSessionManagedSource(this.#source)) await this.#source[sourceSessionEnd]()
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    const signal = combineAbortSignals(this.#signal, options.signal)
    throwIfAborted(signal)
    this.#budget.admitRead(this.size, offset, length)
    const data = await this.#source.read(offset, length, {
      ...(signal === undefined ? {} : { signal }),
    })
    throwIfAborted(signal)
    return data
  }
}

const boundResource = (
  resource: ScientificResource,
  signal: AbortSignal | undefined,
  budget: ScientificProbeBudget | undefined,
  label: string,
): ScientificResource => {
  const normalized = normalizeResource(resource, label)
  const source =
    budget === undefined
      ? bindImageSourceSignal(normalized.source, signal)
      : new ProbeLimitedSource(normalized.source, budget, signal)
  return Object.freeze({ ...normalized, source })
}

const boundCompanions = (
  resolver: ScientificCompanionResolver | undefined,
  signal: AbortSignal | undefined,
  budget: ScientificProbeBudget | undefined,
): ScientificCompanionResolver | undefined => {
  if (resolver === undefined) return undefined
  return Object.freeze({
    async resolve(
      request: Readonly<ScientificCompanionRequest>,
      options: Readonly<AbortOptions> = {},
    ): Promise<ScientificResource | undefined> {
      const normalizedRequest = normalizeScientificCompanionRequest(request)
      const combinedSignal = combineAbortSignals(signal, options.signal)
      throwIfAborted(combinedSignal)
      const resource = await resolver.resolve(normalizedRequest, {
        ...(combinedSignal === undefined ? {} : { signal: combinedSignal }),
      })
      throwIfAborted(combinedSignal)
      return resource === undefined
        ? undefined
        : boundResource(resource, combinedSignal, budget, 'Scientific companion resource')
    },
  })
}

const normalizeContext = (
  context: Readonly<ScientificOpenContext>,
  budget?: ScientificProbeBudget,
): ScientificOpenContext => {
  const readerId =
    context.readerId === undefined
      ? undefined
      : normalizeReaderId(context.readerId, 'Explicit scientific reader id')
  const readerVersion = optionalString(context.readerVersion, 'Explicit scientific reader version')
  if (readerVersion !== undefined && readerId === undefined) {
    throw invalidInput('Scientific readerVersion requires readerId')
  }
  const probeLimits = resolveScientificProbeLimits(context.probeLimits)
  const companions = boundCompanions(context.companions, context.signal, budget)
  return Object.freeze({
    primary: boundResource(context.primary, context.signal, budget, 'Scientific primary resource'),
    ...(companions === undefined ? {} : { companions }),
    ...(readerId === undefined ? {} : { readerId }),
    ...(readerVersion === undefined ? {} : { readerVersion }),
    probeLimits,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  })
}

const normalizeProbeResult = (
  value: ScientificProbeResult,
  descriptor: ScientificReaderDescriptor,
): ScientificProbeResult => {
  if (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw invalidInput(
      `Scientific reader ${descriptor.id}@${descriptor.version} returned confidence outside 0..1`,
    )
  }
  const reason = optionalString(
    value.reason,
    `Scientific reader ${descriptor.id}@${descriptor.version} probe reason`,
  )
  return Object.freeze({
    confidence: value.confidence,
    ...(reason === undefined ? {} : { reason }),
  })
}

const readerKey = (descriptor: ScientificReaderDescriptor): string =>
  `${descriptor.id}\0${descriptor.version}`

/** Explicit caller-owned scientific reader registry. Construction has no global side effects. */
export class ScientificReaderRegistry {
  readonly #readers: readonly RegisteredReader[]
  readonly #descriptors: readonly ScientificReaderDescriptor[]

  constructor(readers: Iterable<ScientificReader>) {
    const registered: RegisteredReader[] = []
    const seen = new Set<string>()
    for (const implementation of readers) {
      if (
        implementation === null ||
        typeof implementation !== 'object' ||
        typeof implementation.probe !== 'function' ||
        typeof implementation.open !== 'function'
      ) {
        throw invalidInput('Scientific reader implementation is invalid')
      }
      const descriptor = normalizeReaderDescriptor(implementation.descriptor)
      const key = readerKey(descriptor)
      if (seen.has(key)) {
        throw invalidInput(`Duplicate scientific reader ${descriptor.id}@${descriptor.version}`)
      }
      seen.add(key)
      registered.push(Object.freeze({ descriptor, implementation }))
    }
    this.#readers = Object.freeze(registered)
    this.#descriptors = Object.freeze(registered.map(({ descriptor }) => descriptor))
  }

  /** Frozen JSON-safe descriptors in deterministic registration order. */
  get descriptors(): readonly ScientificReaderDescriptor[] {
    return this.#descriptors
  }

  #explicitReader(context: Readonly<ScientificOpenContext>): RegisteredReader | undefined {
    if (context.readerId === undefined) return undefined
    const matches = this.#readers.filter(
      ({ descriptor }) =>
        descriptor.id === context.readerId &&
        (context.readerVersion === undefined || descriptor.version === context.readerVersion),
    )
    if (matches.length === 0) {
      throw unsupportedFormat(
        `Scientific reader ${context.readerId}${context.readerVersion === undefined ? '' : `@${context.readerVersion}`} is not registered`,
      )
    }
    if (matches.length > 1) {
      throw invalidInput(
        `Scientific reader ${context.readerId} has multiple registered versions; select readerVersion`,
      )
    }
    return matches[0]
  }

  async #detectImplementation(context: Readonly<ScientificOpenContext>): Promise<{
    readonly registered: RegisteredReader
    readonly detection: ScientificReaderDetection
  }> {
    const normalized = normalizeContext(context)
    const explicit = this.#explicitReader(normalized)
    if (explicit !== undefined) {
      return Object.freeze({
        registered: explicit,
        detection: Object.freeze({
          reader: explicit.descriptor,
          confidence: 1,
          reason: 'Explicit reader selection',
          stats: Object.freeze({ readers: 0, reads: 0, bytes: 0 }),
        }),
      })
    }
    if (this.#readers.length === 0) throw unsupportedFormat('No scientific readers are registered')
    const limits = resolveScientificProbeLimits(normalized.probeLimits)
    if (this.#readers.length > limits.maxReaders) {
      throw limitExceeded(
        `Scientific detection requires ${this.#readers.length} reader probes; maxReaders is ${limits.maxReaders}`,
      )
    }
    const budget = new ScientificProbeBudget(limits)
    const probeContext = normalizeContext(normalized, budget)
    const results: {
      readonly registered: RegisteredReader
      readonly result: ScientificProbeResult
    }[] = []
    await withSourceSession(probeContext.primary.source, async () => {
      for (const registered of this.#readers) {
        throwIfAborted(probeContext.signal)
        budget.admitReader()
        const result = normalizeProbeResult(
          await registered.implementation.probe(probeContext),
          registered.descriptor,
        )
        results.push(Object.freeze({ registered, result }))
      }
    })
    let top = 0
    for (const { result } of results) top = Math.max(top, result.confidence)
    if (top === 0) throw unsupportedFormat('No registered scientific reader matched the resource')
    const matches = results.filter(({ result }) => result.confidence === top)
    if (matches.length !== 1) {
      const names = matches
        .map(({ registered }) => `${registered.descriptor.id}@${registered.descriptor.version}`)
        .join(', ')
      throw unsupportedFormat(
        `Scientific reader detection is ambiguous at confidence ${top}: ${names}`,
      )
    }
    const match = matches[0]
    if (match === undefined) throw unsupportedFormat('No registered scientific reader matched')
    return Object.freeze({
      registered: match.registered,
      detection: Object.freeze({
        reader: match.registered.descriptor,
        confidence: match.result.confidence,
        ...(match.result.reason === undefined ? {} : { reason: match.result.reason }),
        stats: budget.stats,
      }),
    })
  }

  async detect(context: Readonly<ScientificOpenContext>): Promise<ScientificReaderDetection> {
    return (await this.#detectImplementation(context)).detection
  }

  async open(context: Readonly<ScientificOpenContext>): Promise<ScientificDocument> {
    const selected = await this.#detectImplementation(context)
    const openContext = normalizeContext({
      ...context,
      readerId: selected.registered.descriptor.id,
      readerVersion: selected.registered.descriptor.version,
    })
    throwIfAborted(openContext.signal)
    return withSourceSession(openContext.primary.source, () =>
      selected.registered.implementation.open(openContext),
    )
  }
}
