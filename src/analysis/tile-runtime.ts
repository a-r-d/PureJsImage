import { invalidInput } from '../errors.ts'
import type { OperationJsonObject } from '../operations/descriptor.ts'
import type {
  NumericSampleType,
  NumericTile,
  NumericTileLayout,
} from '../scientific/numeric-tile.ts'
import { validateNumericTile } from '../scientific/numeric-tile.ts'
import type { ScientificAxisIndex } from '../scientific/dataset-v2.ts'
import type { NormalizedScientificDatasetDescriptor } from '../scientific/dataset-v2.ts'
import type { SourceIdentity } from '../source-identity.ts'
import { normalizeSourceIdentity } from '../source-identity.ts'
import { canonicalJson } from './canonical-json.ts'

export type TileCacheClass = 'source' | 'derived'
export type TilePriority = 'visible' | 'near-visible' | 'background'

export interface TileDatasetIdentity {
  readonly datasetId: string
  readonly source: SourceIdentity
  readonly sessionId?: string
  readonly generation: number
}

export interface TileAddress {
  readonly cacheClass: TileCacheClass
  readonly namespace: string
  readonly dataset: TileDatasetIdentity
  readonly displayAxes: readonly [horizontal: string, vertical: string]
  readonly fixedIndices: readonly ScientificAxisIndex[]
  readonly resolutionLevel: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface TileTarget {
  readonly sampleType?: NumericSampleType
  readonly layout?: NumericTileLayout
}

export interface TileRequest {
  readonly address: TileAddress
  readonly priority: TilePriority
  readonly signal: AbortSignal
  readonly target?: TileTarget
}

export interface TileProviderTiming {
  readonly setupMillisecondsEstimate: number
  readonly transferMillisecondsEstimate: number
  readonly computeMillisecondsEstimate: number
  readonly readbackMillisecondsEstimate: number
  readonly computeMillisecondsMeasured: number
}

export interface TileSourceAccounting {
  readonly retainedAuxiliaryBytes?: number
  readonly bytesRequested?: number
  readonly providerTiming?: TileProviderTiming
}

export interface TileSourceResult {
  readonly tile: NumericTile
  readonly accounting?: TileSourceAccounting
}

/** A lazy tile producer. Implementations must create no work before readTile is called. */
export interface TileSource {
  readonly descriptor?: NormalizedScientificDatasetDescriptor
  tileKey(request: Readonly<TileRequest>): string
  readTile(request: Readonly<TileRequest>): Promise<TileSourceResult>
}

export interface TileRuntimeLimits {
  readonly maxCacheBytes?: number
  readonly maxCacheEntries?: number
  readonly maxConcurrency?: number
  readonly maxQueuedTasks?: number
  readonly maxKeyBytes?: number
  readonly maxTilePixels?: number
  readonly starvationInterval?: number
}

export interface ResolvedTileRuntimeLimits {
  readonly maxCacheBytes: number
  readonly maxCacheEntries: number
  readonly maxConcurrency: number
  readonly maxQueuedTasks: number
  readonly maxKeyBytes: number
  readonly maxTilePixels: number
  readonly starvationInterval: number
}

export const defaultTileRuntimeLimits: ResolvedTileRuntimeLimits = Object.freeze({
  maxCacheBytes: 32 * 1_024 * 1_024,
  maxCacheEntries: 1_024,
  maxConcurrency: 4,
  maxQueuedTasks: 4_096,
  maxKeyBytes: 16_384,
  maxTilePixels: 16_777_216,
  starvationInterval: 16,
})

const positiveSafeInteger = (value: number | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

export const resolveTileRuntimeLimits = (
  limits: Readonly<TileRuntimeLimits> = {},
): ResolvedTileRuntimeLimits =>
  Object.freeze({
    maxCacheBytes: positiveSafeInteger(
      limits.maxCacheBytes,
      defaultTileRuntimeLimits.maxCacheBytes,
      'maxCacheBytes',
    ),
    maxCacheEntries: positiveSafeInteger(
      limits.maxCacheEntries,
      defaultTileRuntimeLimits.maxCacheEntries,
      'maxCacheEntries',
    ),
    maxConcurrency: positiveSafeInteger(
      limits.maxConcurrency,
      defaultTileRuntimeLimits.maxConcurrency,
      'maxConcurrency',
    ),
    maxQueuedTasks: positiveSafeInteger(
      limits.maxQueuedTasks,
      defaultTileRuntimeLimits.maxQueuedTasks,
      'maxQueuedTasks',
    ),
    maxKeyBytes: positiveSafeInteger(
      limits.maxKeyBytes,
      defaultTileRuntimeLimits.maxKeyBytes,
      'maxKeyBytes',
    ),
    maxTilePixels: positiveSafeInteger(
      limits.maxTilePixels,
      defaultTileRuntimeLimits.maxTilePixels,
      'maxTilePixels',
    ),
    starvationInterval: positiveSafeInteger(
      limits.starvationInterval,
      defaultTileRuntimeLimits.starvationInterval,
      'starvationInterval',
    ),
  })

const boundedString = (value: string, name: string): string => {
  if (value.trim().length === 0 || value.length > 4_096) {
    throw invalidInput(`${name} must be a bounded non-empty string`)
  }
  return value
}

const safeNonNegative = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`${name} must be a non-negative safe integer`)
  }
  return value
}

const safePositive = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const normalizeDatasetIdentity = (value: TileDatasetIdentity): TileDatasetIdentity => {
  const source = normalizeSourceIdentity(value.source)
  const datasetId = boundedString(value.datasetId, 'datasetId')
  const generation = safeNonNegative(value.generation, 'generation')
  const sessionId =
    value.sessionId === undefined ? undefined : boundedString(value.sessionId, 'sessionId')
  if (source.strength !== 'strong' && sessionId === undefined) {
    throw invalidInput('Weak or session source identity requires a tile sessionId')
  }
  return Object.freeze({
    datasetId,
    source,
    ...(sessionId === undefined ? {} : { sessionId }),
    generation,
  })
}

export const normalizeTileAddress = (
  value: Readonly<TileAddress>,
  maxTilePixels = defaultTileRuntimeLimits.maxTilePixels,
): TileAddress => {
  if (value.cacheClass !== 'source' && value.cacheClass !== 'derived') {
    throw invalidInput('Tile cacheClass must be source or derived')
  }
  if (!Array.isArray(value.displayAxes) || value.displayAxes.length !== 2) {
    throw invalidInput('Tile address requires two display axes')
  }
  const horizontal = boundedString(value.displayAxes[0], 'horizontal display axis')
  const vertical = boundedString(value.displayAxes[1], 'vertical display axis')
  if (horizontal === vertical) throw invalidInput('Tile display axes must be distinct')
  if (!Array.isArray(value.fixedIndices)) throw invalidInput('Tile fixedIndices must be an array')
  const seen = new Set<string>()
  const fixedIndices: ScientificAxisIndex[] = []
  for (const entry of value.fixedIndices) {
    const axisId = boundedString(entry.axisId, 'fixed axis id')
    if (axisId === horizontal || axisId === vertical || seen.has(axisId)) {
      throw invalidInput('Tile fixed axes must be distinct from display axes and each other')
    }
    seen.add(axisId)
    fixedIndices.push(Object.freeze({ axisId, index: safeNonNegative(entry.index, 'fixed index') }))
  }
  fixedIndices.sort((left, right) => left.axisId.localeCompare(right.axisId))
  const x = safeNonNegative(value.x, 'tile x')
  const y = safeNonNegative(value.y, 'tile y')
  const width = safePositive(value.width, 'tile width')
  const height = safePositive(value.height, 'tile height')
  const pixels = width * height
  if (!Number.isSafeInteger(x + width) || !Number.isSafeInteger(y + height)) {
    throw invalidInput('Tile extent exceeds the safe integer range')
  }
  if (!Number.isSafeInteger(pixels) || pixels > maxTilePixels) {
    throw invalidInput('Tile exceeds maxTilePixels')
  }
  const displayAxes: readonly [string, string] = Object.freeze([horizontal, vertical])
  return Object.freeze({
    cacheClass: value.cacheClass,
    namespace: boundedString(value.namespace, 'tile namespace'),
    dataset: normalizeDatasetIdentity(value.dataset),
    displayAxes,
    fixedIndices: Object.freeze(fixedIndices),
    resolutionLevel: safeNonNegative(value.resolutionLevel, 'resolutionLevel'),
    x,
    y,
    width,
    height,
  })
}

const normalizeTarget = (value: TileTarget | undefined): TileTarget | undefined => {
  if (value === undefined) return undefined
  const sampleType = value.sampleType
  const layout = value.layout
  if (
    sampleType !== undefined &&
    sampleType !== 'uint8' &&
    sampleType !== 'uint16' &&
    sampleType !== 'uint32' &&
    sampleType !== 'uint64' &&
    sampleType !== 'int8' &&
    sampleType !== 'int16' &&
    sampleType !== 'int32' &&
    sampleType !== 'float32' &&
    sampleType !== 'float64'
  ) {
    throw invalidInput('Tile target sampleType is invalid')
  }
  if (layout !== undefined && layout !== 'interleaved' && layout !== 'planar') {
    throw invalidInput('Tile target layout is invalid')
  }
  return Object.freeze({
    ...(sampleType === undefined ? {} : { sampleType }),
    ...(layout === undefined ? {} : { layout }),
  })
}

export const normalizeTileRequest = (
  value: Readonly<TileRequest>,
  maxTilePixels = defaultTileRuntimeLimits.maxTilePixels,
): TileRequest => {
  if (
    value.priority !== 'visible' &&
    value.priority !== 'near-visible' &&
    value.priority !== 'background'
  ) {
    throw invalidInput('Tile priority is invalid')
  }
  if (!(value.signal instanceof AbortSignal))
    throw invalidInput('Tile request requires AbortSignal')
  const target = normalizeTarget(value.target)
  return Object.freeze({
    address: normalizeTileAddress(value.address, maxTilePixels),
    priority: value.priority,
    signal: value.signal,
    ...(target === undefined ? {} : { target }),
  })
}

const sourceIdentityKey = (identity: SourceIdentity): OperationJsonObject => {
  if (identity.kind === 'content') return Object.freeze({ ...identity })
  if (identity.kind === 'local-file') return Object.freeze({ ...identity })
  if (identity.kind === 'session') return Object.freeze({ ...identity })
  return Object.freeze({
    kind: identity.kind,
    strength: identity.strength,
    stability: identity.stability,
    url: identity.url,
    size: identity.size,
    ...(identity.validator === undefined
      ? {}
      : { validator: Object.freeze({ ...identity.validator }) }),
  })
}

export const tileRequestKeyData = (request: Readonly<TileRequest>): OperationJsonObject => {
  const normalized = normalizeTileRequest(request, Number.MAX_SAFE_INTEGER)
  return Object.freeze({
    schemaVersion: 1,
    address: Object.freeze({
      cacheClass: normalized.address.cacheClass,
      namespace: normalized.address.namespace,
      dataset: Object.freeze({
        datasetId: normalized.address.dataset.datasetId,
        source: sourceIdentityKey(normalized.address.dataset.source),
        ...(normalized.address.dataset.sessionId === undefined
          ? {}
          : { sessionId: normalized.address.dataset.sessionId }),
        generation: normalized.address.dataset.generation,
      }),
      displayAxes: normalized.address.displayAxes,
      fixedIndices: Object.freeze(
        normalized.address.fixedIndices.map((entry) => Object.freeze({ ...entry })),
      ),
      resolutionLevel: normalized.address.resolutionLevel,
      x: normalized.address.x,
      y: normalized.address.y,
      width: normalized.address.width,
      height: normalized.address.height,
    }),
    ...(normalized.target === undefined ? {} : { target: Object.freeze({ ...normalized.target }) }),
  })
}

export const canonicalTileKey = (
  request: Readonly<TileRequest>,
  semanticExtension?: OperationJsonObject,
): string =>
  canonicalJson(
    Object.freeze({
      request: tileRequestKeyData(request),
      ...(semanticExtension === undefined ? {} : { semanticExtension }),
    }),
    { maxDepth: 32, maxValues: 100_000, maxBytes: 1_048_576 },
  )

export interface TileCacheMetrics extends OperationJsonObject {
  readonly hits: number
  readonly misses: number
  readonly admissions: number
  readonly evictions: number
  readonly replacements: number
  readonly currentEntries: number
  readonly currentBytes: number
  readonly highWaterBytes: number
  readonly sourceRetainedBytes: number
  readonly derivedRetainedBytes: number
}

export interface TileTaskMetrics extends OperationJsonObject {
  readonly inFlightRequests: number
  readonly queued: number
  readonly running: number
  readonly completed: number
  readonly cancelled: number
  readonly failed: number
  readonly consumerCancellations: number
  readonly bytesRequested: number
  readonly bytesProduced: number
  readonly releaseFailures: number
}

export interface TileProviderTimingMetrics extends OperationJsonObject {
  readonly setupMillisecondsEstimate: number
  readonly transferMillisecondsEstimate: number
  readonly computeMillisecondsEstimate: number
  readonly readbackMillisecondsEstimate: number
  readonly computeMillisecondsMeasured: number
}

export interface TileRuntimeMetrics extends OperationJsonObject {
  readonly enabled: boolean
  readonly cache: TileCacheMetrics
  readonly tasks: TileTaskMetrics
  readonly providerTiming: TileProviderTimingMetrics
  readonly timeToFirstCompletedTileMilliseconds: number | null
  readonly memoryScope: string
  readonly timingScope: string
}

interface MutableMetrics {
  hits: number
  misses: number
  admissions: number
  evictions: number
  replacements: number
  highWaterBytes: number
  queued: number
  running: number
  completed: number
  cancelled: number
  failed: number
  consumerCancellations: number
  bytesRequested: number
  bytesProduced: number
  releaseFailures: number
  setupMillisecondsEstimate: number
  transferMillisecondsEstimate: number
  computeMillisecondsEstimate: number
  readbackMillisecondsEstimate: number
  computeMillisecondsMeasured: number
  firstCompletedAt: number | undefined
}

const newMutableMetrics = (): MutableMetrics => ({
  hits: 0,
  misses: 0,
  admissions: 0,
  evictions: 0,
  replacements: 0,
  highWaterBytes: 0,
  queued: 0,
  running: 0,
  completed: 0,
  cancelled: 0,
  failed: 0,
  consumerCancellations: 0,
  bytesRequested: 0,
  bytesProduced: 0,
  releaseFailures: 0,
  setupMillisecondsEstimate: 0,
  transferMillisecondsEstimate: 0,
  computeMillisecondsEstimate: 0,
  readbackMillisecondsEstimate: 0,
  computeMillisecondsMeasured: 0,
  firstCompletedAt: undefined,
})

const once = (callback: () => void): (() => void) => {
  let called = false
  return () => {
    if (called) return
    called = true
    callback()
  }
}

class ManagedTile {
  readonly tile: NumericTile
  #references = 1
  #released = false
  readonly #onReleaseError: () => void

  constructor(tile: NumericTile, onReleaseError: () => void) {
    this.tile = tile
    this.#onReleaseError = onReleaseError
  }

  lease(): NumericTile {
    if (this.#released) throw invalidInput('Cannot lease a released tile')
    this.#references += 1
    return Object.freeze({ ...this.tile, release: once(() => this.releaseReference()) })
  }

  releaseReference(): void {
    if (this.#references < 1) return
    this.#references -= 1
    if (this.#references !== 0 || this.#released) return
    this.#released = true
    try {
      this.tile.release()
    } catch {
      this.#onReleaseError()
    }
  }
}

interface CacheEntry {
  readonly key: string
  readonly address: TileAddress
  readonly manager: ManagedTile
  readonly retainedBytes: number
}

class TileCache {
  readonly #entries = new Map<string, CacheEntry>()
  readonly #maxBytes: number
  readonly #maxEntries: number
  readonly #metrics: MutableMetrics
  readonly #metricsEnabled: boolean
  #bytes = 0
  #sourceBytes = 0
  #derivedBytes = 0

  constructor(limits: ResolvedTileRuntimeLimits, metrics: MutableMetrics, metricsEnabled: boolean) {
    this.#maxBytes = limits.maxCacheBytes
    this.#maxEntries = limits.maxCacheEntries
    this.#metrics = metrics
    this.#metricsEnabled = metricsEnabled
  }

  get bytes(): number {
    return this.#bytes
  }

  get sourceBytes(): number {
    return this.#sourceBytes
  }

  get derivedBytes(): number {
    return this.#derivedBytes
  }

  get size(): number {
    return this.#entries.size
  }

  has(key: string): boolean {
    return this.#entries.has(key)
  }

  get(key: string): NumericTile | undefined {
    const entry = this.#entries.get(key)
    if (entry === undefined) return undefined
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry.manager.lease()
  }

  put(entry: CacheEntry): boolean {
    const replaced = this.#entries.get(entry.key)
    if (replaced !== undefined) {
      this.#remove(replaced, false)
      if (this.#metricsEnabled) this.#metrics.replacements += 1
    }
    if (entry.retainedBytes > this.#maxBytes) {
      entry.manager.releaseReference()
      return false
    }
    this.#entries.set(entry.key, entry)
    this.#bytes += entry.retainedBytes
    if (entry.address.cacheClass === 'source') this.#sourceBytes += entry.retainedBytes
    else this.#derivedBytes += entry.retainedBytes
    if (this.#metricsEnabled) {
      this.#metrics.admissions += 1
      this.#metrics.highWaterBytes = Math.max(this.#metrics.highWaterBytes, this.#bytes)
    }
    while (this.#bytes > this.#maxBytes || this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.values().next().value
      if (oldest === undefined) break
      this.#remove(oldest, true)
    }
    return this.#entries.get(entry.key) === entry
  }

  delete(key: string): boolean {
    const entry = this.#entries.get(key)
    if (entry === undefined) return false
    this.#remove(entry, false)
    return true
  }

  invalidate(predicate: (address: Readonly<TileAddress>) => boolean): number {
    let removed = 0
    for (const entry of [...this.#entries.values()]) {
      if (!predicate(entry.address)) continue
      this.#remove(entry, false)
      removed += 1
    }
    return removed
  }

  clear(): void {
    for (const entry of [...this.#entries.values()]) this.#remove(entry, false)
  }

  #remove(entry: CacheEntry, eviction: boolean): void {
    if (!this.#entries.delete(entry.key)) return
    this.#bytes -= entry.retainedBytes
    if (entry.address.cacheClass === 'source') this.#sourceBytes -= entry.retainedBytes
    else this.#derivedBytes -= entry.retainedBytes
    if (eviction && this.#metricsEnabled) this.#metrics.evictions += 1
    entry.manager.releaseReference()
  }
}

interface QueueEntryBase {
  readonly sequence: number
  readonly enqueuedDispatch: number
  readonly priority: number
  readonly signal: AbortSignal
  readonly reject: (reason: unknown) => void
  removeAbortListener?: () => void
}

interface ScheduledTask extends QueueEntryBase {
  readonly kind: 'task'
  readonly run: (signal: AbortSignal) => Promise<void>
  started: boolean
  holdingPermit: boolean
}

interface ResumePermit extends QueueEntryBase {
  readonly kind: 'resume'
  readonly task: ScheduledTask
  readonly resolve: () => void
}

type QueueEntry = ScheduledTask | ResumePermit

const priorityRank = (priority: TilePriority): number =>
  priority === 'visible' ? 0 : priority === 'near-visible' ? 1 : 2

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new Error('Tile request aborted')

class TileScheduler {
  readonly #limits: ResolvedTileRuntimeLimits
  readonly #metrics: MutableMetrics
  readonly #metricsEnabled: boolean
  readonly #queue: QueueEntry[] = []
  readonly #active = new WeakMap<AbortSignal, ScheduledTask>()
  #running = 0
  #sequence = 0
  #dispatches = 0
  #drainQueued = false

  constructor(limits: ResolvedTileRuntimeLimits, metrics: MutableMetrics, metricsEnabled: boolean) {
    this.#limits = limits
    this.#metrics = metrics
    this.#metricsEnabled = metricsEnabled
  }

  get idle(): boolean {
    return this.#running === 0 && this.#queue.length === 0
  }

  schedule<Result>(
    priority: TilePriority,
    signal: AbortSignal,
    execute: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    if (signal.aborted) return Promise.reject(abortReason(signal))
    if (this.#queue.length >= this.#limits.maxQueuedTasks) {
      return Promise.reject(invalidInput('Tile scheduler exceeds maxQueuedTasks'))
    }
    return new Promise<Result>((resolve, reject) => {
      const task: ScheduledTask = {
        kind: 'task',
        sequence: this.#sequence,
        enqueuedDispatch: this.#dispatches,
        priority: priorityRank(priority),
        signal,
        run: async (taskSignal) => resolve(await execute(taskSignal)),
        reject,
        started: false,
        holdingPermit: false,
      }
      this.#sequence += 1
      const onAbort = (): void => {
        if (task.started) return
        const index = this.#queue.indexOf(task)
        if (index >= 0) this.#queue.splice(index, 1)
        task.removeAbortListener?.()
        if (this.#metricsEnabled) {
          this.#metrics.queued -= 1
          this.#metrics.cancelled += 1
        }
        reject(abortReason(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      task.removeAbortListener = () => signal.removeEventListener('abort', onAbort)
      this.#queue.push(task)
      if (this.#metricsEnabled) this.#metrics.queued += 1
      this.#queueDrain()
    })
  }

  async withDependency<Result>(
    signal: AbortSignal,
    dependency: () => Promise<Result>,
    releaseIfNotResumed: (result: Result) => void,
  ): Promise<Result> {
    const task = this.#active.get(signal)
    if (task === undefined || !task.holdingPermit) {
      throw invalidInput('Tile dependencies must be requested during scheduled tile execution')
    }
    task.holdingPermit = false
    this.#running -= 1
    if (this.#metricsEnabled) this.#metrics.running -= 1
    this.#queueDrain()
    let result: { readonly value: Result } | undefined
    try {
      result = { value: await dependency() }
      signal.throwIfAborted()
      await this.#reacquire(task)
      return result.value
    } catch (error) {
      if (result !== undefined) releaseIfNotResumed(result.value)
      throw error
    }
  }

  #reacquire(task: ScheduledTask): Promise<void> {
    if (task.signal.aborted) return Promise.reject(abortReason(task.signal))
    if (this.#queue.length >= this.#limits.maxQueuedTasks) {
      return Promise.reject(invalidInput('Tile scheduler exceeds maxQueuedTasks'))
    }
    return new Promise<void>((resolve, reject) => {
      const permit: ResumePermit = {
        kind: 'resume',
        sequence: this.#sequence,
        enqueuedDispatch: this.#dispatches,
        priority: task.priority,
        signal: task.signal,
        task,
        resolve,
        reject,
      }
      this.#sequence += 1
      const onAbort = (): void => {
        const index = this.#queue.indexOf(permit)
        if (index < 0) return
        this.#queue.splice(index, 1)
        permit.removeAbortListener?.()
        if (this.#metricsEnabled) this.#metrics.queued -= 1
        reject(abortReason(task.signal))
      }
      task.signal.addEventListener('abort', onAbort, { once: true })
      permit.removeAbortListener = () => task.signal.removeEventListener('abort', onAbort)
      this.#queue.push(permit)
      if (this.#metricsEnabled) this.#metrics.queued += 1
      this.#queueDrain()
    })
  }

  #queueDrain(): void {
    if (this.#drainQueued) return
    this.#drainQueued = true
    queueMicrotask(() => {
      this.#drainQueued = false
      this.#drain()
    })
  }

  #drain(): void {
    while (this.#running < this.#limits.maxConcurrency && this.#queue.length > 0) {
      let selectedIndex = 0
      let selectedScore = Number.POSITIVE_INFINITY
      let selectedSequence = Number.POSITIVE_INFINITY
      for (let index = 0; index < this.#queue.length; index += 1) {
        const task = this.#queue[index]
        if (task === undefined) continue
        const promotions = Math.floor(
          (this.#dispatches - task.enqueuedDispatch) / this.#limits.starvationInterval,
        )
        const score = Math.max(0, task.priority - promotions)
        if (
          score < selectedScore ||
          (score === selectedScore && task.sequence < selectedSequence)
        ) {
          selectedIndex = index
          selectedScore = score
          selectedSequence = task.sequence
        }
      }
      const entry = this.#queue.splice(selectedIndex, 1)[0]
      if (entry === undefined) break
      if (this.#metricsEnabled) this.#metrics.queued -= 1
      entry.removeAbortListener?.()
      if (entry.signal.aborted) {
        if (entry.kind === 'task' && this.#metricsEnabled) this.#metrics.cancelled += 1
        entry.reject(abortReason(entry.signal))
        continue
      }
      this.#running += 1
      this.#dispatches += 1
      if (this.#metricsEnabled) this.#metrics.running += 1
      if (entry.kind === 'resume') {
        entry.task.holdingPermit = true
        entry.resolve()
        continue
      }
      const task = entry
      task.started = true
      task.holdingPermit = true
      this.#active.set(task.signal, task)
      void task
        .run(task.signal)
        .then(() => {
          if (this.#metricsEnabled) this.#metrics.completed += 1
        })
        .catch((error: unknown) => {
          if (this.#metricsEnabled) {
            if (task.signal.aborted) this.#metrics.cancelled += 1
            else this.#metrics.failed += 1
          }
          task.reject(error)
        })
        .finally(() => {
          this.#active.delete(task.signal)
          if (task.holdingPermit) {
            task.holdingPermit = false
            this.#running -= 1
            if (this.#metricsEnabled) this.#metrics.running -= 1
          }
          this.#queueDrain()
        })
    }
  }
}

interface TileConsumer {
  readonly id: number
  readonly signal: AbortSignal
  readonly resolve: (tile: NumericTile) => void
  readonly reject: (reason: unknown) => void
  removeAbortListener?: () => void
}

interface InFlightTile {
  readonly key: string
  readonly address: TileAddress
  readonly request: TileRequest
  readonly controller: AbortController
  readonly consumers: Map<number, TileConsumer>
}

interface ValidatedTileAccounting {
  readonly bytesRequested: number
  readonly providerTiming: TileProviderTiming | undefined
}

export interface TileInvalidation {
  readonly namespace?: string
  readonly generation?: number
  readonly cacheClass?: TileCacheClass
  readonly predicate?: (address: Readonly<TileAddress>) => boolean
  readonly cancelInFlight?: boolean
}

export interface TileRuntimeOptions {
  readonly limits?: Readonly<TileRuntimeLimits>
  readonly metrics?: boolean
}

export class TileRuntime {
  readonly limits: ResolvedTileRuntimeLimits
  readonly #metricsEnabled: boolean
  #startedAt = performance.now()
  #metrics = newMutableMetrics()
  #cache: TileCache
  #scheduler: TileScheduler
  readonly #inFlight = new Map<string, InFlightTile>()
  #consumerId = 0

  constructor(options: Readonly<TileRuntimeOptions> = {}) {
    this.limits = resolveTileRuntimeLimits(options.limits)
    this.#metricsEnabled = options.metrics !== false
    this.#cache = new TileCache(this.limits, this.#metrics, this.#metricsEnabled)
    this.#scheduler = new TileScheduler(this.limits, this.#metrics, this.#metricsEnabled)
  }

  request(source: TileSource, input: Readonly<TileRequest>): Promise<NumericTile> {
    const request = normalizeTileRequest(input, this.limits.maxTilePixels)
    request.signal.throwIfAborted()
    const key = this.#key(source, request)
    const cached = this.#cache.get(key)
    if (cached !== undefined) {
      if (this.#metricsEnabled) this.#metrics.hits += 1
      return Promise.resolve(cached)
    }
    if (this.#metricsEnabled) this.#metrics.misses += 1
    let state = this.#inFlight.get(key)
    if (state === undefined) {
      const controller = new AbortController()
      state = {
        key,
        address: request.address,
        request,
        controller,
        consumers: new Map<number, TileConsumer>(),
      }
      this.#inFlight.set(key, state)
      const scheduledState = state
      void this.#scheduler
        .schedule(request.priority, controller.signal, async (signal) => {
          const result = await source.readTile(Object.freeze({ ...request, signal }))
          this.#complete(scheduledState, result)
        })
        .catch((error: unknown) => this.#fail(scheduledState, error))
    }
    return this.#subscribe(state, request.signal)
  }

  /** Request a cached dependency from inside TileSource.readTile without holding a scheduler slot. */
  requestDependency(source: TileSource, input: Readonly<TileRequest>): Promise<NumericTile> {
    return this.#scheduler.withDependency(
      input.signal,
      () => this.request(source, input),
      (tile) => tile.release(),
    )
  }

  has(request: Readonly<TileRequest>, source: TileSource): boolean {
    const normalized = normalizeTileRequest(request, this.limits.maxTilePixels)
    return this.#cache.has(this.#key(source, normalized))
  }

  delete(request: Readonly<TileRequest>, source: TileSource): boolean {
    const normalized = normalizeTileRequest(request, this.limits.maxTilePixels)
    return this.#cache.delete(this.#key(source, normalized))
  }

  getCached(source: TileSource, request: Readonly<TileRequest>): NumericTile | undefined {
    const normalized = normalizeTileRequest(request, this.limits.maxTilePixels)
    const tile = this.#cache.get(this.#key(source, normalized))
    if (this.#metricsEnabled) {
      if (tile === undefined) this.#metrics.misses += 1
      else this.#metrics.hits += 1
    }
    return tile
  }

  putCached(
    source: TileSource,
    request: Readonly<TileRequest>,
    tile: NumericTile,
    retainedAuxiliaryBytes = 0,
  ): boolean {
    const normalized = normalizeTileRequest(request, this.limits.maxTilePixels)
    let key: string
    try {
      this.#validateTile(tile, normalized, retainedAuxiliaryBytes)
      key = this.#key(source, normalized)
    } catch (error) {
      this.#releaseTile(tile)
      throw error
    }
    const manager = new ManagedTile(tile, () => {
      if (this.#metricsEnabled) this.#metrics.releaseFailures += 1
    })
    return this.#cache.put({
      key,
      address: normalized.address,
      manager,
      retainedBytes: tile.data.byteLength + retainedAuxiliaryBytes,
    })
  }

  invalidate(options: Readonly<TileInvalidation>): number {
    if (
      options.namespace === undefined &&
      options.generation === undefined &&
      options.cacheClass === undefined &&
      options.predicate === undefined
    ) {
      throw invalidInput('Tile invalidation requires a selector')
    }
    if (options.namespace !== undefined) boundedString(options.namespace, 'invalidation namespace')
    if (options.generation !== undefined)
      safeNonNegative(options.generation, 'invalidation generation')
    const matches = (address: Readonly<TileAddress>): boolean =>
      (options.namespace === undefined || address.namespace === options.namespace) &&
      (options.generation === undefined || address.dataset.generation === options.generation) &&
      (options.cacheClass === undefined || address.cacheClass === options.cacheClass) &&
      (options.predicate === undefined || options.predicate(address))
    const removed = this.#cache.invalidate(matches)
    if (options.cancelInFlight !== false) {
      for (const state of this.#inFlight.values()) {
        if (matches(state.address)) state.controller.abort(new Error('Tile request invalidated'))
      }
    }
    return removed
  }

  clear(): void {
    this.#cache.clear()
    for (const state of this.#inFlight.values()) {
      state.controller.abort(new Error('Tile runtime cleared'))
    }
  }

  resetMetrics(): void {
    if (this.#inFlight.size !== 0 || !this.#scheduler.idle) {
      throw invalidInput('Metrics can only be reset while the tile runtime is idle')
    }
    const reset = newMutableMetrics()
    reset.highWaterBytes = this.#cache.bytes
    Object.assign(this.#metrics, reset)
    this.#startedAt = performance.now()
  }

  metrics(): TileRuntimeMetrics {
    const enabled = this.#metricsEnabled
    const value = this.#metrics
    return Object.freeze({
      enabled,
      cache: Object.freeze({
        hits: enabled ? value.hits : 0,
        misses: enabled ? value.misses : 0,
        admissions: enabled ? value.admissions : 0,
        evictions: enabled ? value.evictions : 0,
        replacements: enabled ? value.replacements : 0,
        currentEntries: this.#cache.size,
        currentBytes: this.#cache.bytes,
        highWaterBytes: enabled ? value.highWaterBytes : 0,
        sourceRetainedBytes: this.#cache.sourceBytes,
        derivedRetainedBytes: this.#cache.derivedBytes,
      }),
      tasks: Object.freeze({
        inFlightRequests: this.#inFlight.size,
        queued: enabled ? value.queued : 0,
        running: enabled ? value.running : 0,
        completed: enabled ? value.completed : 0,
        cancelled: enabled ? value.cancelled : 0,
        failed: enabled ? value.failed : 0,
        consumerCancellations: enabled ? value.consumerCancellations : 0,
        bytesRequested: enabled ? value.bytesRequested : 0,
        bytesProduced: enabled ? value.bytesProduced : 0,
        releaseFailures: enabled ? value.releaseFailures : 0,
      }),
      providerTiming: Object.freeze({
        setupMillisecondsEstimate: enabled ? value.setupMillisecondsEstimate : 0,
        transferMillisecondsEstimate: enabled ? value.transferMillisecondsEstimate : 0,
        computeMillisecondsEstimate: enabled ? value.computeMillisecondsEstimate : 0,
        readbackMillisecondsEstimate: enabled ? value.readbackMillisecondsEstimate : 0,
        computeMillisecondsMeasured: enabled ? value.computeMillisecondsMeasured : 0,
      }),
      timeToFirstCompletedTileMilliseconds:
        enabled && value.firstCompletedAt !== undefined
          ? value.firstCompletedAt - this.#startedAt
          : null,
      memoryScope:
        'Retained NumericTile typed-array byteLength plus declared auxiliary bytes; not process peak memory',
      timingScope:
        'Provider estimates are labeled separately from measured wall-clock compute time',
    })
  }

  #subscribe(state: InFlightTile, signal: AbortSignal): Promise<NumericTile> {
    if (signal.aborted) return Promise.reject(abortReason(signal))
    return new Promise<NumericTile>((resolve, reject) => {
      const consumer: TileConsumer = {
        id: this.#consumerId,
        signal,
        resolve,
        reject,
      }
      this.#consumerId += 1
      const onAbort = (): void => {
        if (!state.consumers.delete(consumer.id)) return
        consumer.removeAbortListener?.()
        if (this.#metricsEnabled) this.#metrics.consumerCancellations += 1
        reject(abortReason(signal))
        if (state.consumers.size === 0) state.controller.abort(abortReason(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      consumer.removeAbortListener = () => signal.removeEventListener('abort', onAbort)
      state.consumers.set(consumer.id, consumer)
    })
  }

  #complete(state: InFlightTile, result: TileSourceResult): void {
    if (this.#inFlight.get(state.key) !== state) {
      this.#releaseTile(result.tile)
      throw state.controller.signal.aborted
        ? abortReason(state.controller.signal)
        : invalidInput('Tile request state was superseded')
    }
    this.#inFlight.delete(state.key)
    const consumers = [...state.consumers.values()]
    state.consumers.clear()
    if (state.controller.signal.aborted || consumers.length === 0) {
      this.#releaseTile(result.tile)
      for (const consumer of consumers) {
        consumer.removeAbortListener?.()
        consumer.reject(abortReason(state.controller.signal))
      }
      throw abortReason(state.controller.signal)
    }
    let auxiliaryBytes: number
    let accounting: ValidatedTileAccounting
    try {
      auxiliaryBytes = result.accounting?.retainedAuxiliaryBytes ?? 0
      this.#validateTile(result.tile, state.request, auxiliaryBytes)
      accounting = this.#validateAccounting(result.accounting)
    } catch (error) {
      this.#releaseTile(result.tile)
      for (const consumer of consumers) {
        consumer.removeAbortListener?.()
        consumer.reject(error)
      }
      throw error
    }
    const manager = new ManagedTile(result.tile, () => {
      if (this.#metricsEnabled) this.#metrics.releaseFailures += 1
    })
    const leases: NumericTile[] = []
    try {
      for (let index = 0; index < consumers.length; index += 1) leases.push(manager.lease())
      this.#cache.put({
        key: state.key,
        address: state.address,
        manager,
        retainedBytes: result.tile.data.byteLength + auxiliaryBytes,
      })
    } catch (error) {
      for (const lease of leases) lease.release()
      manager.releaseReference()
      for (const consumer of consumers) {
        consumer.removeAbortListener?.()
        consumer.reject(error)
      }
      throw error
    }
    if (this.#metricsEnabled) {
      this.#metrics.bytesProduced += result.tile.data.byteLength
      this.#metrics.bytesRequested += accounting.bytesRequested
      const timing = accounting.providerTiming
      if (timing !== undefined) {
        this.#metrics.setupMillisecondsEstimate += timing.setupMillisecondsEstimate
        this.#metrics.transferMillisecondsEstimate += timing.transferMillisecondsEstimate
        this.#metrics.computeMillisecondsEstimate += timing.computeMillisecondsEstimate
        this.#metrics.readbackMillisecondsEstimate += timing.readbackMillisecondsEstimate
        this.#metrics.computeMillisecondsMeasured += timing.computeMillisecondsMeasured
      }
      this.#metrics.firstCompletedAt ??= performance.now()
    }
    for (let index = 0; index < consumers.length; index += 1) {
      const consumer = consumers[index]
      const lease = leases[index]
      if (consumer === undefined || lease === undefined) continue
      consumer.removeAbortListener?.()
      consumer.resolve(lease)
    }
  }

  #fail(state: InFlightTile, error: unknown): void {
    if (this.#inFlight.get(state.key) !== state) return
    this.#inFlight.delete(state.key)
    for (const consumer of state.consumers.values()) {
      consumer.removeAbortListener?.()
      consumer.reject(error)
    }
    state.consumers.clear()
  }

  #key(source: TileSource, request: TileRequest): string {
    const key = source.tileKey(request)
    if (typeof key !== 'string' || key.length === 0) {
      throw invalidInput('Tile source returned an invalid cache key')
    }
    if (new TextEncoder().encode(key).byteLength > this.limits.maxKeyBytes) {
      throw invalidInput('Tile cache key exceeds maxKeyBytes')
    }
    return key
  }

  #validateTile(tile: NumericTile, request: TileRequest, auxiliaryBytes: number): void {
    validateNumericTile(tile)
    const address = request.address
    if (
      tile.x !== address.x ||
      tile.y !== address.y ||
      tile.width !== address.width ||
      tile.height !== address.height
    ) {
      throw invalidInput('Tile source returned a tile that does not match the requested address')
    }
    if (
      (request.target?.sampleType !== undefined && tile.sampleType !== request.target.sampleType) ||
      (request.target?.layout !== undefined && tile.layout !== request.target.layout)
    ) {
      throw invalidInput('Tile source returned unsupported target semantics')
    }
    if (!Number.isSafeInteger(auxiliaryBytes) || auxiliaryBytes < 0) {
      throw invalidInput('Tile source returned invalid auxiliary byte accounting')
    }
    if (!Number.isSafeInteger(tile.data.byteLength + auxiliaryBytes)) {
      throw invalidInput('Tile retained bytes overflowed')
    }
  }

  #validateAccounting(accounting: TileSourceAccounting | undefined): ValidatedTileAccounting {
    const bytesRequested = accounting?.bytesRequested ?? 0
    if (!Number.isSafeInteger(bytesRequested) || bytesRequested < 0) {
      throw invalidInput('Tile source returned invalid requested byte accounting')
    }
    const timing = accounting?.providerTiming
    let providerTiming: TileProviderTiming | undefined
    if (timing !== undefined) {
      providerTiming = Object.freeze({
        setupMillisecondsEstimate: timing.setupMillisecondsEstimate,
        transferMillisecondsEstimate: timing.transferMillisecondsEstimate,
        computeMillisecondsEstimate: timing.computeMillisecondsEstimate,
        readbackMillisecondsEstimate: timing.readbackMillisecondsEstimate,
        computeMillisecondsMeasured: timing.computeMillisecondsMeasured,
      })
      const values = Object.values(providerTiming)
      if (values.some((value) => !Number.isFinite(value) || value < 0)) {
        throw invalidInput('Tile source returned invalid provider timing')
      }
    }
    return { bytesRequested, providerTiming }
  }

  #releaseTile(tile: NumericTile): void {
    try {
      tile.release()
    } catch {
      if (this.#metricsEnabled) this.#metrics.releaseFailures += 1
    }
  }
}

export const createTileRuntime = (options: Readonly<TileRuntimeOptions> = {}): TileRuntime =>
  new TileRuntime(options)
