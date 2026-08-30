import { invalidInput } from './errors.ts'
import type { ImageSource, ImageSourceReadOptions } from './source.ts'
import {
  drainSourceEvidenceDependencies,
  sourceReadEvidenceDependencies,
  sourceSessionEnd,
  sourceSessionStart,
  stableSourceBuffers,
} from './source.ts'
import type { SourceIdentity } from './source-identity-contract.ts'
import { imageSourceIdentity, inheritImageSourceIdentity } from './source-identity-contract.ts'

export const executionEvidenceSchemaVersion = 1 as const
export type { ImageExecutionPlanDescription } from './explain.ts'
export { explainImage } from './explain.ts'

export type EvidenceMode = 'summary' | 'trace'
export type EvidenceStatus = 'complete' | 'cancelled' | 'failed'
export type EvidenceMeasurement = 'measured' | 'estimated' | 'unavailable'

export interface EvidenceClock {
  now(): number
}

export interface EvidenceLimits {
  readonly maxEvents?: number
  readonly maxSerializedBytes?: number
  readonly maxSourceRanges?: number
  readonly maxAllocationLeases?: number
  readonly maxLabels?: number
  readonly maxSubscribers?: number
  readonly maxChildSpans?: number
}

export interface ResolvedEvidenceLimits {
  readonly maxEvents: number
  readonly maxSerializedBytes: number
  readonly maxSourceRanges: number
  readonly maxAllocationLeases: number
  readonly maxLabels: number
  readonly maxSubscribers: number
  readonly maxChildSpans: number
}

export interface EvidenceSessionOptions {
  readonly mode?: EvidenceMode
  readonly id?: string
  readonly clock?: EvidenceClock
  readonly limits?: Readonly<EvidenceLimits>
  readonly includeSourceNames?: boolean
}

export interface EvidenceRange {
  readonly start: number
  readonly end: number
}

export type EvidenceEvent =
  | EvidenceLogicalReadEvent
  | EvidencePhysicalTransferEvent
  | EvidenceCacheEvent
  | EvidenceOperationEvent
  | EvidenceBlockEvent
  | EvidenceAllocationEvent
  | EvidenceReleaseEvent
  | EvidenceDependencyEvent
  | EvidenceProviderEvent
  | EvidenceCancellationEvent

type EvidenceEventInput = EvidenceEvent extends infer Event
  ? Event extends EvidenceEvent
    ? Omit<Event, keyof EvidenceEventBase>
    : never
  : never

interface EvidenceEventBase {
  readonly id: number
  readonly timeMicroseconds: number
  readonly scopeId: number
}

export interface EvidenceLogicalReadEvent extends EvidenceEventBase {
  readonly type: 'logical-read'
  readonly offset: number
  readonly requestedBytes: number
  readonly returnedBytes: number
  readonly outcome: 'complete' | 'aborted' | 'failed'
  readonly physicalTransferIds?: readonly string[]
}

export interface EvidencePhysicalTransferEvent extends EvidenceEventBase {
  readonly type: 'physical-transfer'
  readonly start: number
  readonly end: number
  readonly transferredBytes: number
  readonly status: number
  readonly durationMicroseconds: number
  readonly firstByteMicroseconds?: number
  readonly outcome: 'complete' | 'aborted' | 'failed'
  readonly policy: 'fixed' | 'adaptive'
  readonly retry?: boolean
  readonly validatorFailure?: boolean
}

export interface EvidenceCacheEvent extends EvidenceEventBase {
  readonly type: 'cache'
  readonly action: 'hit' | 'miss' | 'join' | 'evict'
  readonly start?: number
  readonly end?: number
  readonly bytes?: number
}

export interface EvidenceOperationEvent extends EvidenceEventBase {
  readonly type: 'operation'
  readonly operationId: string
  readonly phase:
    | 'planned'
    | 'start'
    | 'complete'
    | 'eliminated'
    | 'fused'
    | 'fallback'
    | 'cancelled'
    | 'failed'
  readonly detail?: string
  /** Stable structured code only. Error messages and source data are never retained. */
  readonly failureCode?: string
}

export interface EvidenceBlockEvent extends EvidenceEventBase {
  readonly type: 'block'
  readonly stage: 'decoded' | 'encoded'
  readonly blockId: string
  readonly width: number
  readonly height: number
  readonly pixels: number
}

export interface EvidenceAllocationEvent extends EvidenceEventBase {
  readonly type: 'allocation'
  readonly allocationId: number
  readonly category: string
  readonly bytes: number
}

export interface EvidenceReleaseEvent extends EvidenceEventBase {
  readonly type: 'release'
  readonly allocationId: number
  readonly category: string
  readonly bytes: number
}

export interface EvidenceDependencyEvent extends EvidenceEventBase {
  readonly type: 'dependency'
  readonly outputId: string
  readonly inputIds: readonly string[]
  readonly granularity: 'block' | 'tile'
}

export interface EvidenceProviderEvent extends EvidenceEventBase {
  readonly type: 'provider'
  readonly operationId: string
  readonly semanticVersion: number
  readonly providerId: string
  readonly buildFingerprint: string
  readonly reproducibilityClass:
    | 'bit-exact'
    | 'backend-stable'
    | 'tolerance-based'
    | 'provider-pinned'
}

export interface EvidenceCancellationEvent extends EvidenceEventBase {
  readonly type: 'cancellation'
  readonly target: string
}

export interface EvidenceSourceSummary {
  readonly kind: SourceIdentity['kind']
  readonly size: number
  readonly strength: SourceIdentity['strength']
  readonly stability: SourceIdentity['stability']
  readonly name?: string
  readonly validator?: { readonly kind: string; readonly value: string }
}

export interface EvidenceScopeSummary {
  readonly id: number
  readonly parentId: number
  readonly label?: string
}

export interface EvidenceLogicalReadSummary {
  readonly count: number
  readonly requestedBytes: number
  readonly returnedBytes: number
  readonly uniqueBytes: number
  readonly uniqueBytesMeasurement: EvidenceMeasurement
  readonly zeroLengthReads: number
  readonly abortedReads: number
  readonly failedReads: number
  readonly ranges: readonly EvidenceRange[]
}

export interface EvidencePhysicalTransferSummary {
  readonly availability: EvidenceMeasurement
  readonly requestCount: number
  readonly transferBytes: number
  readonly uniqueBytes: number
  readonly uniqueBytesMeasurement: EvidenceMeasurement
  readonly overfetchBytes: number
  readonly overfetchMeasurement: EvidenceMeasurement
  readonly cacheHits: number
  readonly cacheMisses: number
  readonly coalescedConsumers: number
  readonly abortedConsumers: number
  readonly retries: number
  readonly validatorFailures: number
  readonly totalDurationMicroseconds: number
  readonly firstByte: {
    readonly measurement: EvidenceMeasurement
    readonly minimumMicroseconds?: number
  }
  readonly statusClasses: {
    readonly unavailable: number
    readonly informational: number
    readonly successful: number
    readonly redirection: number
    readonly clientError: number
    readonly serverError: number
  }
  readonly ranges: readonly EvidenceRange[]
}

export interface EvidenceManagedMemorySummary {
  readonly scope: 'purejsimage-managed'
  readonly allocationCount: number
  readonly releaseCount: number
  readonly currentLiveBytes: number
  readonly peakLiveBytes: number
  readonly largestAllocation: number
  readonly stillLiveLeases: number
  readonly retainedCacheBytes: number
  readonly temporaryStorageBytes: number
  readonly categories: Readonly<
    Record<
      string,
      {
        readonly kind: EvidenceManagedAllocationKind
        readonly currentBytes: number
        readonly peakBytes: number
      }
    >
  >
}

export type EvidenceManagedAllocationKind = 'buffer' | 'cache' | 'temporary-storage'

export interface EvidenceOperationSummary {
  readonly scopeId: number
  readonly operationId: string
  readonly phase: EvidenceOperationEvent['phase']
  readonly count: number
  readonly firstMicroseconds: number
  readonly lastMicroseconds: number
  readonly detail?: string
  readonly failureCode?: string
}

export interface EvidenceProviderSummary {
  readonly scopeId: number
  readonly operationId: string
  readonly semanticVersion: number
  readonly providerId: string
  readonly buildFingerprint: string
  readonly reproducibilityClass: EvidenceProviderEvent['reproducibilityClass']
  readonly count: number
}

export interface EvidenceCancellationSummary {
  readonly scopeId: number
  readonly target: string
  readonly count: number
}

export interface EvidenceCollectionSummary {
  readonly retainedEventBytes: number
  readonly retainedEvents: number
}

export interface EvidenceExecutionSummary {
  readonly decodedBlocks: number
  readonly decodedPixels: number
  readonly encodedBlocks: number
  readonly encodedPixels: number
  readonly firstDecodedBlockMicroseconds?: number
  readonly firstOutputBlockMicroseconds?: number
}

export interface ExecutionEvidenceReport {
  readonly schemaVersion: typeof executionEvidenceSchemaVersion
  readonly session: {
    readonly id: string
    readonly mode: EvidenceMode
    readonly startMicroseconds: 0
    readonly endMicroseconds: number
    readonly status: EvidenceStatus
    readonly limits: ResolvedEvidenceLimits
    readonly droppedEvents: number
    readonly droppedRanges: number
    readonly droppedAllocations: number
    readonly droppedLabels: number
    readonly droppedChildSpans: number
    readonly warnings: readonly string[]
  }
  readonly scopes: readonly EvidenceScopeSummary[]
  readonly sources: readonly EvidenceSourceSummary[]
  readonly logicalReads: EvidenceLogicalReadSummary
  readonly physicalTransfers: EvidencePhysicalTransferSummary
  readonly managedMemory: EvidenceManagedMemorySummary
  readonly execution: EvidenceExecutionSummary
  readonly operations: readonly EvidenceOperationSummary[]
  readonly providers: readonly EvidenceProviderSummary[]
  readonly dependencies: readonly EvidenceDependencyEvent[]
  readonly cancellations: readonly EvidenceCancellationSummary[]
  readonly collection: EvidenceCollectionSummary
  readonly events?: readonly EvidenceEvent[]
}

export interface EvidenceManagedLease {
  readonly id?: number
  readonly bytes: number
  readonly category: string
  release(): void
}

export interface EvidenceContext {
  readonly mode: EvidenceMode
  readonly scopeId: number
  nowMicroseconds(): number
  child(label: string): EvidenceContext
  source(identity: SourceIdentity): void
  logicalRead(input: {
    readonly offset: number
    readonly requestedBytes: number
    readonly returnedBytes: number
    readonly outcome: 'complete' | 'aborted' | 'failed'
    readonly physicalTransferIds?: readonly string[]
  }): string | undefined
  physicalTransfer(input: {
    readonly start: number
    readonly end: number
    readonly transferredBytes: number
    readonly status: number
    readonly durationMicroseconds: number
    readonly firstByteMicroseconds?: number
    readonly outcome: 'complete' | 'aborted' | 'failed'
    readonly policy?: 'fixed' | 'adaptive'
    readonly retry?: boolean
    readonly validatorFailure?: boolean
  }): string | undefined
  cache(input: Omit<EvidenceCacheEvent, keyof EvidenceEventBase | 'type'>): string | undefined
  operation(input: Omit<EvidenceOperationEvent, keyof EvidenceEventBase | 'type'>): void
  block(input: Omit<EvidenceBlockEvent, keyof EvidenceEventBase | 'type' | 'pixels'>): void
  dependency(input: Omit<EvidenceDependencyEvent, keyof EvidenceEventBase | 'type'>): void
  provider(input: Omit<EvidenceProviderEvent, keyof EvidenceEventBase | 'type'>): void
  cancellation(target: string): void
  allocate(
    category: string,
    bytes: number,
    kind?: EvidenceManagedAllocationKind,
  ): EvidenceManagedLease
}

export interface EvidenceSession {
  readonly context: EvidenceContext
  subscribe(listener: (event: EvidenceEvent) => void): () => void
  finalize(status?: EvidenceStatus): ExecutionEvidenceReport
}

const defaultLimits: ResolvedEvidenceLimits = Object.freeze({
  maxEvents: 4_096,
  maxSerializedBytes: 1_048_576,
  maxSourceRanges: 2_048,
  maxAllocationLeases: 4_096,
  maxLabels: 512,
  maxSubscribers: 8,
  maxChildSpans: 1_024,
})

const positive = (value: number | undefined, fallback: number, label: string): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1)
    throw invalidInput(`${label} must be a positive safe integer`)
  return value
}

const nonNegativeInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0)
    throw invalidInput(`${label} must be a non-negative safe integer`)
  return value
}

const boundedString = (value: string, label: string, maximum = 256): string => {
  if (value.length === 0 || value.length > maximum)
    throw invalidInput(`${label} must contain 1 to ${maximum} characters`)
  return value
}

export const resolveEvidenceLimits = (
  value: Readonly<EvidenceLimits> = {},
): ResolvedEvidenceLimits =>
  Object.freeze({
    maxEvents: positive(value.maxEvents, defaultLimits.maxEvents, 'maxEvents'),
    maxSerializedBytes: positive(
      value.maxSerializedBytes,
      defaultLimits.maxSerializedBytes,
      'maxSerializedBytes',
    ),
    maxSourceRanges: positive(
      value.maxSourceRanges,
      defaultLimits.maxSourceRanges,
      'maxSourceRanges',
    ),
    maxAllocationLeases: positive(
      value.maxAllocationLeases,
      defaultLimits.maxAllocationLeases,
      'maxAllocationLeases',
    ),
    maxLabels: positive(value.maxLabels, defaultLimits.maxLabels, 'maxLabels'),
    maxSubscribers: positive(value.maxSubscribers, defaultLimits.maxSubscribers, 'maxSubscribers'),
    maxChildSpans: positive(value.maxChildSpans, defaultLimits.maxChildSpans, 'maxChildSpans'),
  })

const addRange = (ranges: EvidenceRange[], start: number, end: number): void => {
  if (end <= start) return
  let nextStart = start
  let nextEnd = end
  let index = 0
  while (index < ranges.length) {
    const current = ranges[index]
    if (current === undefined || current.end >= nextStart) break
    index += 1
  }
  while (index < ranges.length) {
    const current = ranges[index]
    if (current === undefined || current.start > nextEnd) break
    nextStart = Math.min(nextStart, current.start)
    nextEnd = Math.max(nextEnd, current.end)
    ranges.splice(index, 1)
  }
  ranges.splice(index, 0, { start: nextStart, end: nextEnd })
}

const rangeBytes = (ranges: readonly EvidenceRange[]): number => {
  let total = 0
  for (const range of ranges) total += range.end - range.start
  return total
}

const rangeIntersectionBytes = (
  left: readonly EvidenceRange[],
  right: readonly EvidenceRange[],
): number => {
  let total = 0
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftRange = left[leftIndex]
    const rightRange = right[rightIndex]
    if (leftRange === undefined || rightRange === undefined) break
    total += Math.max(
      0,
      Math.min(leftRange.end, rightRange.end) - Math.max(leftRange.start, rightRange.start),
    )
    if (leftRange.end <= rightRange.end) leftIndex += 1
    else rightIndex += 1
  }
  return total
}

const redactUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return undefined
  }
}

const defaultClock: EvidenceClock = Object.freeze({ now: () => performance.now() })

class EvidenceCollector {
  readonly mode: EvidenceMode
  readonly limits: ResolvedEvidenceLimits
  readonly clock: EvidenceClock
  readonly started: number
  readonly sessionId: string
  readonly includeSourceNames: boolean
  readonly logicalRanges: EvidenceRange[] = []
  readonly physicalRanges: EvidenceRange[] = []
  readonly events: EvidenceEvent[] = []
  readonly warnings: string[] = []
  readonly sources: EvidenceSourceSummary[] = []
  readonly seenSources = new WeakSet<object>()
  readonly scopes: EvidenceScopeSummary[] = []
  readonly labels = new Set<string>()
  readonly subscribers = new Set<(event: EvidenceEvent) => void>()
  readonly live = new Map<number, { bytes: number; category: string }>()
  readonly categories = new Map<
    string,
    {
      kind: EvidenceManagedAllocationKind
      currentBytes: number
      peakBytes: number
    }
  >()
  readonly operationSummaries = new Map<string, EvidenceOperationSummary>()
  readonly providerSummaries = new Map<string, EvidenceProviderSummary>()
  readonly cancellationSummaries = new Map<string, EvidenceCancellationSummary>()
  readonly dependencies: EvidenceDependencyEvent[] = []
  #nextEvent = 1
  #nextScope = 1
  #nextAllocation = 1
  #estimatedSerializedBytes = 0
  #finalized = false
  #logicalRangesComplete = true
  #physicalRangesComplete = true
  droppedEvents = 0
  droppedRanges = 0
  droppedAllocations = 0
  droppedLabels = 0
  droppedChildSpans = 0
  logicalCount = 0
  logicalRequested = 0
  logicalReturned = 0
  zeroLengthReads = 0
  abortedReads = 0
  failedReads = 0
  physicalCount = 0
  transferBytes = 0
  totalTransferDuration = 0
  minimumFirstByte: number | undefined
  readonly physicalStatusClasses = {
    unavailable: 0,
    informational: 0,
    successful: 0,
    redirection: 0,
    clientError: 0,
    serverError: 0,
  }
  cacheHits = 0
  cacheMisses = 0
  coalescedConsumers = 0
  abortedConsumers = 0
  retries = 0
  validatorFailures = 0
  allocationCount = 0
  releaseCount = 0
  currentBytes = 0
  peakBytes = 0
  largestAllocation = 0
  decodedBlocks = 0
  decodedPixels = 0
  encodedBlocks = 0
  encodedPixels = 0
  firstDecodedBlockMicroseconds: number | undefined
  firstOutputBlockMicroseconds: number | undefined

  constructor(options: Readonly<EvidenceSessionOptions>) {
    this.mode = options.mode ?? 'summary'
    if (this.mode !== 'summary' && this.mode !== 'trace')
      throw invalidInput('Evidence mode must be summary or trace')
    this.limits = resolveEvidenceLimits(options.limits)
    this.clock = options.clock ?? defaultClock
    this.started = this.clock.now()
    if (!Number.isFinite(this.started))
      throw invalidInput('Evidence clock must return a finite number')
    this.sessionId = options.id ?? `evidence-${Math.round(this.started * 1_000)}`
    if (this.sessionId.length === 0 || this.sessionId.length > 128)
      throw invalidInput('Evidence session id is invalid')
    this.includeSourceNames = options.includeSourceNames === true
  }

  time(): number {
    const value = this.clock.now()
    if (!Number.isFinite(value) || value < this.started)
      throw invalidInput('Evidence clock must be monotonic')
    return Math.round((value - this.started) * 1_000)
  }

  scope(parentId: number, label: string): number {
    if (label.length === 0 || label.length > 96)
      throw invalidInput('Evidence child scope label is invalid')
    if (this.#nextScope > this.limits.maxChildSpans) {
      this.droppedChildSpans += 1
      this.warn('child-span-limit', 'Child evidence span limit reached')
      return parentId
    }
    const retainedLabel = this.retainLabel(label)
    const id = this.#nextScope++
    this.scopes.push(
      Object.freeze({
        id,
        parentId,
        ...(retainedLabel === undefined ? {} : { label: retainedLabel }),
      }),
    )
    return id
  }

  retainLabel(label: string): string | undefined {
    if (this.labels.has(label)) return label
    if (this.labels.size >= this.limits.maxLabels) {
      this.droppedLabels += 1
      this.warn('label-limit', 'Evidence label limit reached')
      return undefined
    }
    this.labels.add(label)
    return label
  }

  emit(scopeId: number, event: EvidenceEventInput): number | undefined {
    if (this.mode !== 'trace') return undefined
    if (
      this.events.length >= this.limits.maxEvents ||
      this.#estimatedSerializedBytes >= this.limits.maxSerializedBytes
    ) {
      this.droppedEvents += 1
      this.warn('event-limit', 'Detailed evidence limit reached; aggregates remain active')
      return undefined
    }
    const complete = Object.freeze({
      ...event,
      id: this.#nextEvent++,
      timeMicroseconds: this.time(),
      scopeId,
    }) as EvidenceEvent
    const estimate = JSON.stringify(complete).length
    if (this.#estimatedSerializedBytes + estimate > this.limits.maxSerializedBytes) {
      this.droppedEvents += 1
      this.warn(
        'serialized-byte-limit',
        'Serialized evidence byte limit reached; aggregates remain active',
      )
      return undefined
    }
    this.#estimatedSerializedBytes += estimate
    this.events.push(complete)
    for (const subscriber of this.subscribers) {
      try {
        subscriber(complete)
      } catch {
        this.subscribers.delete(subscriber)
        this.warn('subscriber-failure', 'A failing evidence subscriber was removed')
      }
    }
    return complete.id
  }

  warn(code: string, message: string): void {
    if (this.warnings.some((warning) => warning.startsWith(`${code}:`))) return
    if (this.warnings.length < 32) this.warnings.push(`${code}: ${message}`)
  }

  recordRange(target: EvidenceRange[], start: number, end: number): void {
    addRange(target, start, end)
    if (target.length <= this.limits.maxSourceRanges) return
    target.length = this.limits.maxSourceRanges
    if (target === this.logicalRanges) this.#logicalRangesComplete = false
    if (target === this.physicalRanges) this.#physicalRangesComplete = false
    this.droppedRanges += 1
    this.warn('range-limit', 'Source range detail was truncated')
  }

  context(scopeId: number): EvidenceContext {
    return Object.freeze({
      mode: this.mode,
      scopeId,
      nowMicroseconds: () => this.time(),
      child: (label: string) => this.context(this.scope(scopeId, label)),
      source: (identity: SourceIdentity) => this.addSource(identity),
      logicalRead: (input: Parameters<EvidenceContext['logicalRead']>[0]) =>
        this.logical(scopeId, input),
      physicalTransfer: (input: Parameters<EvidenceContext['physicalTransfer']>[0]) =>
        this.physical(scopeId, input),
      cache: (input: Parameters<EvidenceContext['cache']>[0]) => this.recordCache(scopeId, input),
      operation: (input: Parameters<EvidenceContext['operation']>[0]) =>
        this.operation(scopeId, input),
      block: (input: Parameters<EvidenceContext['block']>[0]) => this.block(scopeId, input),
      dependency: (input: Parameters<EvidenceContext['dependency']>[0]) =>
        this.dependency(scopeId, input),
      provider: (input: Parameters<EvidenceContext['provider']>[0]) =>
        this.provider(scopeId, input),
      cancellation: (target: string) => this.cancellation(scopeId, target),
      allocate: (category: string, bytes: number, kind?: EvidenceManagedAllocationKind) =>
        this.allocate(scopeId, category, bytes, kind),
    })
  }

  addSource(identity: SourceIdentity): void {
    if (this.#finalized) return
    if (this.seenSources.has(identity)) return
    this.seenSources.add(identity)
    if (this.sources.length >= 64) {
      this.warn('source-limit', 'Source identity detail was truncated')
      return
    }
    let name: string | undefined
    if (this.includeSourceNames) {
      if (identity.kind === 'remote') name = redactUrl(identity.url)
      if (identity.kind === 'local-file') name = identity.nameOrPath.split(/[\\/]/u).pop()
    }
    this.sources.push(
      Object.freeze({
        kind: identity.kind,
        size: identity.size,
        strength: identity.strength,
        stability: identity.stability,
        ...(name === undefined ? {} : { name }),
        ...(identity.kind === 'remote' && identity.validator !== undefined
          ? { validator: Object.freeze({ ...identity.validator }) }
          : {}),
      }),
    )
  }

  logical(
    scopeId: number,
    input: Parameters<EvidenceContext['logicalRead']>[0],
  ): string | undefined {
    nonNegativeInteger(input.offset, 'Logical read offset')
    nonNegativeInteger(input.requestedBytes, 'Logical requested bytes')
    nonNegativeInteger(input.returnedBytes, 'Logical returned bytes')
    if (input.returnedBytes > input.requestedBytes)
      throw invalidInput('Logical returned bytes cannot exceed requested bytes')
    this.logicalCount += 1
    this.logicalRequested += input.requestedBytes
    this.logicalReturned += input.returnedBytes
    if (input.requestedBytes === 0) this.zeroLengthReads += 1
    if (input.outcome === 'aborted') this.abortedReads += 1
    if (input.outcome === 'failed') this.failedReads += 1
    const physicalTransferIds = input.physicalTransferIds?.slice(0, 256)
    const physicalTransferIdCount = input.physicalTransferIds?.length ?? 0
    if (physicalTransferIdCount > 256) {
      this.droppedEvents += physicalTransferIdCount - 256
      this.warn('dependency-input-limit', 'Evidence dependency input detail was truncated')
    }
    for (const id of physicalTransferIds ?? [])
      boundedString(id, 'Logical read physical transfer id')
    if (input.returnedBytes > 0)
      this.recordRange(this.logicalRanges, input.offset, input.offset + input.returnedBytes)
    const id = this.emit(scopeId, {
      type: 'logical-read',
      ...input,
      ...(physicalTransferIds === undefined
        ? {}
        : { physicalTransferIds: Object.freeze(physicalTransferIds) }),
    })
    return id === undefined ? undefined : `logical-read:${id}`
  }

  physical(
    scopeId: number,
    input: Parameters<EvidenceContext['physicalTransfer']>[0],
  ): string | undefined {
    nonNegativeInteger(input.start, 'Physical transfer start')
    nonNegativeInteger(input.end, 'Physical transfer end')
    nonNegativeInteger(input.transferredBytes, 'Physical transfer bytes')
    nonNegativeInteger(input.status, 'Physical transfer status')
    nonNegativeInteger(input.durationMicroseconds, 'Physical transfer duration')
    if (input.status > 599) throw invalidInput('Physical transfer status exceeds 599')
    if (input.end < input.start) throw invalidInput('Physical transfer end precedes its start')
    if (input.transferredBytes > input.end - input.start)
      throw invalidInput('Physical transfer bytes exceed its source range')
    if (input.firstByteMicroseconds !== undefined) {
      nonNegativeInteger(input.firstByteMicroseconds, 'Physical first-byte duration')
      if (input.firstByteMicroseconds > input.durationMicroseconds)
        throw invalidInput('Physical first-byte duration exceeds transfer duration')
    }
    this.physicalCount += 1
    this.transferBytes += input.transferredBytes
    this.totalTransferDuration += input.durationMicroseconds
    if (input.firstByteMicroseconds !== undefined)
      this.minimumFirstByte = Math.min(
        this.minimumFirstByte ?? input.firstByteMicroseconds,
        input.firstByteMicroseconds,
      )
    if (input.status === 0) this.physicalStatusClasses.unavailable += 1
    else if (input.status < 200) this.physicalStatusClasses.informational += 1
    else if (input.status < 300) this.physicalStatusClasses.successful += 1
    else if (input.status < 400) this.physicalStatusClasses.redirection += 1
    else if (input.status < 500) this.physicalStatusClasses.clientError += 1
    else this.physicalStatusClasses.serverError += 1
    if (input.outcome === 'aborted') this.abortedConsumers += 1
    if (input.retry === true) this.retries += 1
    if (input.validatorFailure === true) this.validatorFailures += 1
    if (input.transferredBytes > 0) {
      this.recordRange(
        this.physicalRanges,
        input.start,
        Math.min(input.end, input.start + input.transferredBytes),
      )
    }
    const id = this.emit(scopeId, {
      type: 'physical-transfer',
      policy: input.policy ?? 'fixed',
      ...input,
    })
    return id === undefined ? undefined : `physical-transfer:${id}`
  }

  recordCache(scopeId: number, input: Parameters<EvidenceContext['cache']>[0]): string | undefined {
    if (input.start !== undefined) nonNegativeInteger(input.start, 'Cache range start')
    if (input.end !== undefined) nonNegativeInteger(input.end, 'Cache range end')
    if (input.bytes !== undefined) nonNegativeInteger(input.bytes, 'Cache bytes')
    if (input.start !== undefined && input.end !== undefined && input.end < input.start)
      throw invalidInput('Cache range end precedes its start')
    if (input.action === 'hit') this.cacheHits += 1
    if (input.action === 'miss') this.cacheMisses += 1
    if (input.action === 'join') this.coalescedConsumers += 1
    const id = this.emit(scopeId, { type: 'cache', ...input })
    return id === undefined ? undefined : `cache:${id}`
  }

  operation(scopeId: number, input: Parameters<EvidenceContext['operation']>[0]): void {
    boundedString(input.operationId, 'Evidence operation id')
    if (input.detail !== undefined) boundedString(input.detail, 'Evidence operation detail', 1_024)
    if (input.failureCode !== undefined) {
      boundedString(input.failureCode, 'Evidence operation failure code', 128)
      if (input.phase !== 'failed')
        throw invalidInput('Evidence operation failure code requires the failed phase')
    }
    const timeMicroseconds = this.time()
    const key = `${scopeId}\0${input.operationId}\0${input.phase}\0${input.detail ?? ''}\0${input.failureCode ?? ''}`
    const previous = this.operationSummaries.get(key)
    if (previous === undefined) {
      if (this.operationSummaries.size < this.limits.maxEvents) {
        this.operationSummaries.set(
          key,
          Object.freeze({
            scopeId,
            operationId: input.operationId,
            phase: input.phase,
            count: 1,
            firstMicroseconds: timeMicroseconds,
            lastMicroseconds: timeMicroseconds,
            ...(input.detail === undefined ? {} : { detail: input.detail }),
            ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
          }),
        )
      } else {
        this.droppedEvents += 1
        this.warn('operation-summary-limit', 'Operation summary limit reached')
      }
    } else {
      this.operationSummaries.set(
        key,
        Object.freeze({
          ...previous,
          count: previous.count + 1,
          lastMicroseconds: timeMicroseconds,
        }),
      )
    }
    this.emit(scopeId, { type: 'operation', ...input })
  }

  block(scopeId: number, input: Parameters<EvidenceContext['block']>[0]): void {
    boundedString(input.blockId, 'Evidence block id')
    nonNegativeInteger(input.width, 'Evidence block width')
    nonNegativeInteger(input.height, 'Evidence block height')
    if (input.width === 0 || input.height === 0)
      throw invalidInput('Evidence block dimensions must be positive')
    const pixels = input.width * input.height
    if (!Number.isSafeInteger(pixels)) throw invalidInput('Evidence block pixel count is unsafe')
    const timeMicroseconds = this.time()
    if (input.stage === 'decoded') {
      this.decodedBlocks += 1
      this.decodedPixels += pixels
      this.firstDecodedBlockMicroseconds ??= timeMicroseconds
    } else {
      this.encodedBlocks += 1
      this.encodedPixels += pixels
      this.firstOutputBlockMicroseconds ??= timeMicroseconds
    }
    this.emit(scopeId, { type: 'block', ...input, pixels })
  }

  dependency(scopeId: number, input: Parameters<EvidenceContext['dependency']>[0]): void {
    boundedString(input.outputId, 'Evidence dependency output id')
    const retainedInputIds = input.inputIds.slice(0, 256)
    if (input.inputIds.length > 256) {
      this.droppedEvents += input.inputIds.length - 256
      this.warn('dependency-input-limit', 'Evidence dependency input detail was truncated')
    }
    for (const inputId of retainedInputIds) boundedString(inputId, 'Evidence dependency input id')
    const frozenInputIds = Object.freeze(retainedInputIds)
    const eventId = this.emit(scopeId, {
      type: 'dependency',
      ...input,
      inputIds: frozenInputIds,
    })
    const retained = eventId === undefined ? undefined : this.events.at(-1)
    if (
      retained?.type === 'dependency' &&
      retained.id === eventId &&
      this.dependencies.length < this.limits.maxEvents
    ) {
      this.dependencies.push(retained)
    }
  }

  provider(scopeId: number, input: Parameters<EvidenceContext['provider']>[0]): void {
    boundedString(input.operationId, 'Evidence provider operation id')
    nonNegativeInteger(input.semanticVersion, 'Evidence provider semantic version')
    boundedString(input.providerId, 'Evidence provider id')
    boundedString(input.buildFingerprint, 'Evidence provider build fingerprint')
    if (
      input.reproducibilityClass !== 'bit-exact' &&
      input.reproducibilityClass !== 'backend-stable' &&
      input.reproducibilityClass !== 'tolerance-based' &&
      input.reproducibilityClass !== 'provider-pinned'
    ) {
      throw invalidInput('Evidence provider reproducibility class is invalid')
    }
    const key = `${scopeId}\0${input.operationId}\0${input.semanticVersion}\0${input.providerId}\0${input.buildFingerprint}\0${input.reproducibilityClass}`
    const previous = this.providerSummaries.get(key)
    if (previous === undefined) {
      if (this.providerSummaries.size < this.limits.maxLabels) {
        this.providerSummaries.set(key, Object.freeze({ scopeId, ...input, count: 1 }))
      } else {
        this.droppedLabels += 1
        this.warn('provider-summary-limit', 'Provider summary limit reached')
      }
    } else {
      this.providerSummaries.set(key, Object.freeze({ ...previous, count: previous.count + 1 }))
    }
    this.emit(scopeId, { type: 'provider', ...input })
  }

  cancellation(scopeId: number, target: string): void {
    const retainedTarget = boundedString(target, 'Evidence cancellation target')
    const key = `${scopeId}\0${retainedTarget}`
    const previous = this.cancellationSummaries.get(key)
    if (previous === undefined) {
      if (this.cancellationSummaries.size < this.limits.maxLabels) {
        this.cancellationSummaries.set(
          key,
          Object.freeze({ scopeId, target: retainedTarget, count: 1 }),
        )
      } else {
        this.droppedLabels += 1
        this.warn('cancellation-summary-limit', 'Cancellation summary limit reached')
      }
    } else {
      this.cancellationSummaries.set(key, Object.freeze({ ...previous, count: previous.count + 1 }))
    }
    this.emit(scopeId, { type: 'cancellation', target: retainedTarget })
  }

  allocate(
    scopeId: number,
    category: string,
    bytes: number,
    kind: EvidenceManagedAllocationKind = 'buffer',
  ): EvidenceManagedLease {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw invalidInput('Managed allocation bytes must be a non-negative safe integer')
    if (category.length === 0 || category.length > 96)
      throw invalidInput('Managed allocation category is invalid')
    if (kind !== 'buffer' && kind !== 'cache' && kind !== 'temporary-storage')
      throw invalidInput('Managed allocation kind is invalid')
    const retainedCategory = this.retainLabel(category) ?? `[other-${kind}]`
    this.allocationCount += 1
    this.currentBytes += bytes
    this.peakBytes = Math.max(this.peakBytes, this.currentBytes)
    this.largestAllocation = Math.max(this.largestAllocation, bytes)
    const existing = this.categories.get(retainedCategory)
    if (existing !== undefined && existing.kind !== kind)
      throw invalidInput(`Managed allocation category ${retainedCategory} changed kind`)
    const aggregate = existing ?? { kind, currentBytes: 0, peakBytes: 0 }
    aggregate.currentBytes += bytes
    aggregate.peakBytes = Math.max(aggregate.peakBytes, aggregate.currentBytes)
    this.categories.set(retainedCategory, aggregate)
    let id: number | undefined
    if (this.mode === 'trace' && this.live.size < this.limits.maxAllocationLeases) {
      id = this.#nextAllocation++
      this.live.set(id, { bytes, category: retainedCategory })
      this.emit(scopeId, {
        type: 'allocation',
        allocationId: id,
        category: retainedCategory,
        bytes,
      })
    } else if (this.mode === 'trace') {
      this.droppedAllocations += 1
      this.warn('allocation-limit', 'Managed allocation detail limit reached')
    }
    let released = false
    return Object.freeze({
      ...(id === undefined ? {} : { id }),
      bytes,
      category,
      release: (): void => {
        if (released) throw invalidInput(`Managed allocation ${id ?? category} was released twice`)
        released = true
        this.releaseCount += 1
        this.currentBytes -= bytes
        if (this.currentBytes < 0) throw invalidInput('Managed allocation accounting underflow')
        aggregate.currentBytes -= bytes
        if (aggregate.currentBytes < 0)
          throw invalidInput('Managed allocation category accounting underflow')
        if (id !== undefined) {
          this.live.delete(id)
          this.emit(scopeId, {
            type: 'release',
            allocationId: id,
            category: retainedCategory,
            bytes,
          })
        }
      },
    })
  }

  finalize(status: EvidenceStatus): ExecutionEvidenceReport {
    if (this.#finalized) throw invalidInput('Evidence session was already finalized')
    this.#finalized = true
    if (this.currentBytes > 0)
      this.warn('live-managed-leases', 'Managed allocations remain live at finalization')
    const categories: Record<
      string,
      {
        kind: EvidenceManagedAllocationKind
        currentBytes: number
        peakBytes: number
      }
    > = {}
    let retainedCacheBytes = 0
    let temporaryStorageBytes = 0
    for (const [name, value] of [...this.categories].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      categories[name] = Object.freeze({ ...value })
      if (value.kind === 'cache') retainedCacheBytes += value.currentBytes
      if (value.kind === 'temporary-storage') temporaryStorageBytes += value.currentBytes
    }
    const logicalRanges = Object.freeze(
      this.logicalRanges.map((range) => Object.freeze({ ...range })),
    )
    const physicalRanges = Object.freeze(
      this.physicalRanges.map((range) => Object.freeze({ ...range })),
    )
    return Object.freeze({
      schemaVersion: executionEvidenceSchemaVersion,
      session: Object.freeze({
        id: this.sessionId,
        mode: this.mode,
        startMicroseconds: 0 as const,
        endMicroseconds: this.time(),
        status,
        limits: this.limits,
        droppedEvents: this.droppedEvents,
        droppedRanges: this.droppedRanges,
        droppedAllocations: this.droppedAllocations,
        droppedLabels: this.droppedLabels,
        droppedChildSpans: this.droppedChildSpans,
        warnings: Object.freeze([...this.warnings]),
      }),
      scopes: Object.freeze([...this.scopes]),
      sources: Object.freeze([...this.sources]),
      logicalReads: Object.freeze({
        count: this.logicalCount,
        requestedBytes: this.logicalRequested,
        returnedBytes: this.logicalReturned,
        uniqueBytes: rangeBytes(logicalRanges),
        uniqueBytesMeasurement: this.#logicalRangesComplete ? 'measured' : 'estimated',
        zeroLengthReads: this.zeroLengthReads,
        abortedReads: this.abortedReads,
        failedReads: this.failedReads,
        ranges: logicalRanges,
      }),
      physicalTransfers: Object.freeze({
        availability: this.physicalCount === 0 ? 'unavailable' : 'measured',
        requestCount: this.physicalCount,
        transferBytes: this.transferBytes,
        uniqueBytes: rangeBytes(physicalRanges),
        uniqueBytesMeasurement: this.#physicalRangesComplete ? 'measured' : 'estimated',
        overfetchBytes: Math.max(
          0,
          rangeBytes(physicalRanges) - rangeIntersectionBytes(physicalRanges, logicalRanges),
        ),
        overfetchMeasurement:
          this.#logicalRangesComplete && this.#physicalRangesComplete ? 'measured' : 'estimated',
        cacheHits: this.cacheHits,
        cacheMisses: this.cacheMisses,
        coalescedConsumers: this.coalescedConsumers,
        abortedConsumers: this.abortedConsumers,
        retries: this.retries,
        validatorFailures: this.validatorFailures,
        totalDurationMicroseconds: this.totalTransferDuration,
        firstByte: Object.freeze({
          measurement: this.minimumFirstByte === undefined ? 'unavailable' : 'measured',
          ...(this.minimumFirstByte === undefined
            ? {}
            : { minimumMicroseconds: this.minimumFirstByte }),
        }),
        statusClasses: Object.freeze({ ...this.physicalStatusClasses }),
        ranges: physicalRanges,
      }),
      managedMemory: Object.freeze({
        scope: 'purejsimage-managed' as const,
        allocationCount: this.allocationCount,
        releaseCount: this.releaseCount,
        currentLiveBytes: this.currentBytes,
        peakLiveBytes: this.peakBytes,
        largestAllocation: this.largestAllocation,
        stillLiveLeases: this.allocationCount - this.releaseCount,
        retainedCacheBytes,
        temporaryStorageBytes,
        categories: Object.freeze(categories),
      }),
      execution: Object.freeze({
        decodedBlocks: this.decodedBlocks,
        decodedPixels: this.decodedPixels,
        encodedBlocks: this.encodedBlocks,
        encodedPixels: this.encodedPixels,
        ...(this.firstDecodedBlockMicroseconds === undefined
          ? {}
          : { firstDecodedBlockMicroseconds: this.firstDecodedBlockMicroseconds }),
        ...(this.firstOutputBlockMicroseconds === undefined
          ? {}
          : { firstOutputBlockMicroseconds: this.firstOutputBlockMicroseconds }),
      }),
      operations: Object.freeze([...this.operationSummaries.values()]),
      providers: Object.freeze([...this.providerSummaries.values()]),
      dependencies: Object.freeze([...this.dependencies]),
      cancellations: Object.freeze([...this.cancellationSummaries.values()]),
      collection: Object.freeze({
        retainedEventBytes: this.#estimatedSerializedBytes,
        retainedEvents: this.events.length,
      }),
      ...(this.mode === 'trace' ? { events: Object.freeze([...this.events]) } : {}),
    })
  }
}

export const createEvidenceSession = (
  options: Readonly<EvidenceSessionOptions> = {},
): EvidenceSession => {
  const collector = new EvidenceCollector(options)
  return Object.freeze({
    context: collector.context(0),
    subscribe: (listener: (event: EvidenceEvent) => void): (() => void) => {
      if (collector.subscribers.size >= collector.limits.maxSubscribers)
        throw invalidInput('Evidence subscriber limit reached')
      collector.subscribers.add(listener)
      return (): void => {
        collector.subscribers.delete(listener)
      }
    },
    finalize: (status: EvidenceStatus = 'complete') => collector.finalize(status),
  })
}

interface InstrumentedSource extends ImageSource {
  readonly [stableSourceBuffers]?: true
  [sourceSessionStart]?(): void
  [sourceSessionEnd]?(): Promise<void>
}

interface StableSourceLike extends ImageSource {
  readonly [stableSourceBuffers]: true
}

interface SessionSourceLike extends ImageSource {
  [sourceSessionStart](): void
  [sourceSessionEnd](): Promise<void>
}

export const instrumentImageSource = (
  source: ImageSource,
  evidence: EvidenceContext,
): ImageSource => {
  const completedReadIds: string[] = []
  const wrapped: InstrumentedSource = {
    size: source.size,
    [imageSourceIdentity]: () => inheritImageSourceIdentity(source),
    [drainSourceEvidenceDependencies]: (): readonly string[] => {
      const ids = Object.freeze([...completedReadIds])
      completedReadIds.length = 0
      return ids
    },
    async read(
      offset: number,
      length: number,
      options: Readonly<ImageSourceReadOptions> = {},
    ): Promise<Uint8Array> {
      const physicalTransferIds: string[] = []
      const originalDependencyReceiver = options[sourceReadEvidenceDependencies]
      const readOptions: Readonly<ImageSourceReadOptions> = {
        ...options,
        [sourceReadEvidenceDependencies]: (ids: readonly string[]): void => {
          physicalTransferIds.push(...ids)
          originalDependencyReceiver?.(ids)
        },
      }
      try {
        const bytes = await source.read(offset, length, readOptions)
        const id = evidence.logicalRead({
          offset,
          requestedBytes: length,
          returnedBytes: bytes.byteLength,
          outcome: 'complete',
          ...(physicalTransferIds.length === 0
            ? {}
            : { physicalTransferIds: Object.freeze([...new Set(physicalTransferIds)]) }),
        })
        if (id !== undefined) {
          completedReadIds.push(id)
          originalDependencyReceiver?.([id])
        }
        return bytes
      } catch (error) {
        const aborted = options.signal?.aborted === true
        const id = evidence.logicalRead({
          offset,
          requestedBytes: length,
          returnedBytes: 0,
          outcome: aborted ? 'aborted' : 'failed',
          ...(physicalTransferIds.length === 0
            ? {}
            : { physicalTransferIds: Object.freeze([...new Set(physicalTransferIds)]) }),
        })
        if (id !== undefined) {
          completedReadIds.push(id)
          originalDependencyReceiver?.([id])
        }
        if (aborted) evidence.cancellation('source-read')
        throw error
      }
    },
  }
  if (stableSourceBuffers in source && (source as StableSourceLike)[stableSourceBuffers] === true) {
    Object.defineProperty(wrapped, stableSourceBuffers, { value: true })
  }
  if (
    sourceSessionStart in source &&
    sourceSessionEnd in source &&
    typeof (source as SessionSourceLike)[sourceSessionStart] === 'function' &&
    typeof (source as SessionSourceLike)[sourceSessionEnd] === 'function'
  ) {
    const sessionSource = source as SessionSourceLike
    wrapped[sourceSessionStart] = (): void => sessionSource[sourceSessionStart]()
    wrapped[sourceSessionEnd] = (): Promise<void> => sessionSource[sourceSessionEnd]()
  }
  const identify = source[imageSourceIdentity]
  if (identify !== undefined) {
    const identity = identify.call(source)
    if (identity instanceof Promise) {
      void identity.then((resolved) => evidence.source(resolved)).catch(() => undefined)
    } else {
      evidence.source(identity)
    }
  }
  return wrapped
}
