import { throwIfAborted } from '../../src/abort.ts'
import type { SourceIdentity } from '../../src/source-identity-contract.ts'
import { imageSourceIdentity } from '../../src/source-identity-contract.ts'
import type { ImageSource, ImageSourceReadOptions } from '../../src/source.ts'
import { sourceSessionEnd, sourceSessionStart } from '../../src/source.ts'
import type { PreparedFixture, PreparedResource, ResourceSourceRunMetrics } from './types.ts'

export interface SourceReadSnapshot {
  readonly readCalls: number
  readonly requestedBytes: number
  readonly returnedBytes: number
  readonly uniqueSourceBytesTouched: number
  readonly largestIndividualReadBytes: number
  readonly intervals: readonly (readonly [number, number])[]
}

const availableLength = (size: number, offset: number, length: number): number => {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Source offset is invalid')
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('Source length is invalid')
  return offset >= size ? 0 : Math.min(length, size - offset)
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

const delegatedIdentity = (
  source: ImageSource,
): (() => SourceIdentity | Promise<SourceIdentity>) => {
  const identify = source[imageSourceIdentity]
  return identify === undefined
    ? () => ({
        kind: 'session',
        strength: 'session',
        stability: 'instance',
        id: `scientific-reader-benchmark-${source.size}`,
        size: source.size,
      })
    : () => identify.call(source)
}

const intervalUnion = (intervals: readonly (readonly [number, number])[]): number => {
  if (intervals.length === 0) return 0
  const sorted = [...intervals].sort((left, right) => left[0] - right[0] || left[1] - right[1])
  let total = 0
  let start = sorted[0]?.[0] ?? 0
  let end = sorted[0]?.[1] ?? 0
  for (let index = 1; index < sorted.length; index += 1) {
    const interval = sorted[index]
    if (interval === undefined) continue
    if (interval[0] > end) {
      total += end - start
      start = interval[0]
      end = interval[1]
    } else if (interval[1] > end) {
      end = interval[1]
    }
  }
  return total + end - start
}

const snapshot = (
  readCalls: number,
  requestedBytes: number,
  returnedBytes: number,
  largestIndividualReadBytes: number,
  intervals: readonly (readonly [number, number])[],
): SourceReadSnapshot =>
  Object.freeze({
    readCalls,
    requestedBytes,
    returnedBytes,
    uniqueSourceBytesTouched: intervalUnion(intervals),
    largestIndividualReadBytes,
    intervals: Object.freeze(intervals.map((interval) => Object.freeze(interval))),
  })

/** Records the physical reads made by a reader, including interval-union coverage. */
export class CountingImageSource implements ImageSource {
  readonly size: number
  readonly [imageSourceIdentity]: () => SourceIdentity | Promise<SourceIdentity>
  readonly #source: ImageSource
  #readCalls = 0
  #requestedBytes = 0
  #returnedBytes = 0
  #largestIndividualReadBytes = 0
  readonly #intervals: (readonly [number, number])[] = []

  constructor(source: ImageSource) {
    this.#source = source
    this.size = source.size
    this[imageSourceIdentity] = delegatedIdentity(source)
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
    throwIfAborted(options.signal)
    const requested = availableLength(this.size, offset, length)
    const data = await this.#source.read(offset, length, options)
    throwIfAborted(options.signal)
    this.#readCalls += 1
    this.#requestedBytes += requested
    this.#returnedBytes += data.byteLength
    this.#largestIndividualReadBytes = Math.max(this.#largestIndividualReadBytes, data.byteLength)
    if (data.byteLength > 0) this.#intervals.push(Object.freeze([offset, offset + data.byteLength]))
    return data
  }

  get snapshot(): SourceReadSnapshot {
    return snapshot(
      this.#readCalls,
      this.#requestedBytes,
      this.#returnedBytes,
      this.#largestIndividualReadBytes,
      this.#intervals,
    )
  }
}

/** Adds bounded deterministic fragmentation while preserving ImageSource's exact-read contract. */
export class FragmentingImageSource implements ImageSource {
  readonly size: number
  readonly [imageSourceIdentity]: () => SourceIdentity | Promise<SourceIdentity>
  readonly #source: ImageSource
  readonly #fragmentBytes: number

  constructor(source: ImageSource, fragmentBytes: number) {
    if (!Number.isSafeInteger(fragmentBytes) || fragmentBytes < 1) {
      throw new Error('Fragment size must be a positive safe integer')
    }
    this.#source = source
    this.#fragmentBytes = fragmentBytes
    this.size = source.size
    this[imageSourceIdentity] = delegatedIdentity(source)
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
    throwIfAborted(options.signal)
    const available = availableLength(this.size, offset, length)
    if (available === 0) return new Uint8Array()
    const output = new Uint8Array(available)
    let position = 0
    while (position < available) {
      throwIfAborted(options.signal)
      const amount = Math.min(this.#fragmentBytes, available - position)
      const data = await this.#source.read(offset + position, amount, options)
      if (data.byteLength !== amount) {
        throw new Error(`Fragmented source returned ${data.byteLength} of ${amount} bytes`)
      }
      output.set(data, position)
      position += amount
    }
    return output
  }
}

/** Applies latency to physical underlying reads; exact cached and coalesced reads wait once. */
export class LatencyImageSource implements ImageSource {
  readonly size: number
  readonly [imageSourceIdentity]: () => SourceIdentity | Promise<SourceIdentity>
  readonly #source: ImageSource
  readonly #latencyMilliseconds: number
  readonly #cache = new Map<string, Uint8Array>()
  readonly #inflight = new Map<string, Promise<Uint8Array>>()

  constructor(source: ImageSource, latencyMilliseconds: number) {
    if (!Number.isFinite(latencyMilliseconds) || latencyMilliseconds < 0) {
      throw new Error('Latency must be a non-negative finite number')
    }
    this.#source = source
    this.#latencyMilliseconds = latencyMilliseconds
    this.size = source.size
    this[imageSourceIdentity] = delegatedIdentity(source)
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
    throwIfAborted(options.signal)
    const available = availableLength(this.size, offset, length)
    if (available === 0) return new Uint8Array()
    const key = `${offset}:${available}`
    const cached = this.#cache.get(key)
    if (cached !== undefined) return cached.slice()
    const existing = this.#inflight.get(key)
    if (existing !== undefined) return (await existing).slice()

    const operation = (async (): Promise<Uint8Array> => {
      if (this.#latencyMilliseconds > 0) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, this.#latencyMilliseconds)
          if (options.signal === undefined) return
          const abort = (): void => {
            clearTimeout(timer)
            reject(options.signal?.reason)
          }
          if (options.signal.aborted) abort()
          else options.signal.addEventListener('abort', abort, { once: true })
        })
      }
      throwIfAborted(options.signal)
      const data = await this.#source.read(offset, available, options)
      if (data.byteLength !== available) {
        throw new Error(`Latency source returned ${data.byteLength} of ${available} bytes`)
      }
      const stable = Uint8Array.from(data)
      this.#cache.set(key, stable)
      return stable
    })()
    this.#inflight.set(key, operation)
    try {
      return (await operation).slice()
    } finally {
      this.#inflight.delete(key)
    }
  }
}

export interface InstrumentedResource {
  readonly prepared: PreparedResource
  readonly source: ImageSource
  readonly counter: CountingImageSource
  readonly physicalCounter: CountingImageSource
}

export interface InstrumentedResourceSet {
  readonly primary: InstrumentedResource
  readonly resources: readonly InstrumentedResource[]
  readonly companionResolutionCount: number
  readonly resolve: (request: {
    readonly kind: 'relative-name' | 'role'
    readonly relativeName?: string
  }) => InstrumentedResource | undefined
}

export const createInstrumentedResourceSet = (options: {
  readonly fixture: PreparedFixture
  readonly sourceFactory: (resource: PreparedResource) => {
    readonly source: ImageSource
    readonly physicalCounter?: CountingImageSource
  }
}): InstrumentedResourceSet => {
  const counters = options.fixture.resources.map((prepared) => {
    const built = options.sourceFactory(prepared)
    const counter = new CountingImageSource(built.source)
    return Object.freeze({
      prepared,
      source: counter,
      counter,
      physicalCounter: built.physicalCounter ?? counter,
    })
  })
  const byId = new Map(counters.map((resource) => [resource.prepared.id, resource]))
  const byName = new Map(
    counters.flatMap((resource) =>
      resource.prepared.name === null ? [] : [[resource.prepared.name, resource] as const],
    ),
  )
  const primary = counters[0]
  if (primary === undefined)
    throw new Error(`Fixture ${options.fixture.id} has no primary resource`)
  let companionResolutionCount = 0
  return {
    primary,
    resources: Object.freeze(counters),
    get companionResolutionCount() {
      return companionResolutionCount
    },
    resolve(request) {
      companionResolutionCount += 1
      if (request.relativeName !== undefined) {
        const byRelativeName = byName.get(request.relativeName)
        if (byRelativeName !== undefined) return byRelativeName
        if (request.kind === 'role' && request.relativeName.lastIndexOf('.') < 0) {
          for (const suffix of ['.bin', '.dat', '.raw', '.img']) {
            const byRoleSuffix = byName.get(`${request.relativeName}${suffix}`)
            if (byRoleSuffix !== undefined) return byRoleSuffix
          }
        }
      }
      if (request.kind === 'role' && request.relativeName === undefined) return undefined
      return request.relativeName === undefined ? undefined : byId.get(request.relativeName)
    },
  }
}

export const resourceRunMetrics = (
  resource: InstrumentedResource,
  payloadRanges: readonly (readonly [number, number])[],
): ResourceSourceRunMetrics => {
  const current = resource.physicalCounter.snapshot
  const overfetchRatio =
    current.uniqueSourceBytesTouched === 0
      ? null
      : current.requestedBytes / current.uniqueSourceBytesTouched
  const payloadIntersections: (readonly [number, number])[] = []
  for (const [start, end] of payloadRanges) {
    for (const [readStart, readEnd] of current.intervals) {
      const intersectionStart = Math.max(start, readStart)
      const intersectionEnd = Math.min(end, readEnd)
      if (intersectionEnd > intersectionStart)
        payloadIntersections.push([intersectionStart, intersectionEnd])
    }
  }
  return Object.freeze({
    resourceId: resource.prepared.id,
    name: resource.prepared.name,
    sizeBytes: resource.prepared.sizeBytes,
    readCalls: current.readCalls,
    requestedBytes: current.requestedBytes,
    returnedBytes: current.returnedBytes,
    uniqueSourceBytesTouched: current.uniqueSourceBytesTouched,
    largestIndividualReadBytes: current.largestIndividualReadBytes,
    overfetchRatio,
    completeSourceRead: current.uniqueSourceBytesTouched >= resource.prepared.sizeBytes,
    payloadBytesRead: intervalUnion(payloadIntersections),
  })
}
