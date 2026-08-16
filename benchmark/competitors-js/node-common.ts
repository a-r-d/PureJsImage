import { createHash } from 'node:crypto'
import { open, readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

import type { PreparedFixture, PreparedResource } from '../scientific-readers/types.ts'
import type {
  ScientificCompetitorCorrectness,
  ScientificCompetitorSourceMetrics,
  ScientificCompetitorStageTiming,
  ScientificCompetitorWorkload,
} from '../scientific-readers/competitor-types.ts'

export const now = (): number => performance.now()

export const primaryResource = (fixture: PreparedFixture): PreparedResource => {
  const resource = fixture.resources.find(({ id }) => id === 'primary') ?? fixture.resources[0]
  if (resource === undefined) throw new Error(`Fixture ${fixture.id} has no primary resource`)
  return resource
}

const resourceForId = (fixture: PreparedFixture, resourceId: string): PreparedResource => {
  const resource = fixture.resources.find(
    ({ id, name }) => id === resourceId || name === resourceId,
  )
  if (resource === undefined) throw new Error(`Fixture ${fixture.id} has no resource ${resourceId}`)
  return resource
}

interface SourceInterval {
  readonly resourceId: string
  readonly start: number
  readonly end: number
}

export class NodeSourceTracker {
  private readonly fixture: PreparedFixture
  private readonly intervals: SourceInterval[] = []
  private requestCount = 0
  private requestedBytes = 0
  private returnedBytes = 0
  private requiredInputCopyBytes = 0
  private completeInputRead = false

  public constructor(fixture: PreparedFixture) {
    this.fixture = fixture
  }

  public async readComplete(resourceId = 'primary'): Promise<Uint8Array> {
    const resource = resourceForId(this.fixture, resourceId)
    const bytes = await readFile(resource.path)
    const output = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    this.record(resource.id, 0, output.byteLength, output.byteLength, true)
    return output
  }

  public async readRange(resourceId: string, start: number, length: number): Promise<Uint8Array> {
    const resource = resourceForId(this.fixture, resourceId)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 0 || length < 0) {
      throw new RangeError(`Invalid source range ${start}:${length}`)
    }
    const handle = await open(resource.path, 'r')
    try {
      const output = new Uint8Array(length)
      const { bytesRead } = await handle.read(output, 0, length, start)
      const returned = output.subarray(0, bytesRead)
      this.record(resource.id, start, length, returned.byteLength, false)
      return returned
    } finally {
      await handle.close()
    }
  }

  public recordInputCopy(bytes: number): void {
    this.requiredInputCopyBytes += bytes
  }

  public recordFilesystemRead(resourceId = 'primary'): void {
    const resource = resourceForId(this.fixture, resourceId)
    this.record(resource.id, 0, resource.sizeBytes, resource.sizeBytes, true)
  }

  public metrics(
    sourceInstrumentation: ScientificCompetitorSourceMetrics['sourceInstrumentation'],
  ): ScientificCompetitorSourceMetrics {
    return {
      requestCount: this.requestCount,
      requestedBytes: this.requestedBytes,
      returnedBytes: this.returnedBytes,
      uniqueBytesTouched: this.uniqueBytesTouched(),
      completeInputRead: this.completeInputRead,
      requiredInputCopyBytes: this.requiredInputCopyBytes,
      sourceInstrumentation,
    }
  }

  private record(
    resourceId: string,
    start: number,
    requested: number,
    returned: number,
    complete: boolean,
  ): void {
    this.requestCount += 1
    this.requestedBytes += requested
    this.returnedBytes += returned
    this.completeInputRead ||= complete && resourceId === primaryResource(this.fixture).id
    if (returned > 0) this.intervals.push({ resourceId, start, end: start + returned })
  }

  private uniqueBytesTouched(): number {
    const byResource = new Map<string, SourceInterval[]>()
    for (const interval of this.intervals) {
      const entries = byResource.get(interval.resourceId) ?? []
      entries.push(interval)
      byResource.set(interval.resourceId, entries)
    }
    let total = 0
    for (const intervals of byResource.values()) {
      intervals.sort((left, right) => left.start - right.start)
      let start = intervals[0]?.start ?? 0
      let end = intervals[0]?.end ?? 0
      for (const interval of intervals.slice(1)) {
        if (interval.start > end) {
          total += end - start
          start = interval.start
        }
        end = Math.max(end, interval.end)
      }
      total += end - start
    }
    return total
  }
}

export interface NodeCompetitorContext {
  readonly fixture: PreparedFixture
  readonly workload: ScientificCompetitorWorkload
  readonly source: NodeSourceTracker
}

export interface NodeCompetitorExecution {
  readonly stages: Omit<
    ScientificCompetitorStageTiming,
    'closeAndCleanupMilliseconds' | 'totalWallMilliseconds'
  >
  readonly sourceInstrumentation: ScientificCompetitorSourceMetrics['sourceInstrumentation']
  readonly correctness: ScientificCompetitorCorrectness
  readonly cleanup: () => Promise<void>
}

export interface NodeCompetitorAdapter {
  readonly initialize: () => Promise<number>
  readonly run: (context: NodeCompetitorContext) => Promise<NodeCompetitorExecution>
}

export const emptyCorrectness = (): ScientificCompetitorCorrectness => ({
  shape: null,
  nativeSampleType: null,
  sampleSha256: null,
  sampleCount: null,
  outputBytes: 0,
  details: [],
})

export const hashBytes = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

const typedArrayName = (value: ArrayBufferView): string => {
  if (value instanceof Uint8Array) return 'uint8'
  if (value instanceof Uint8ClampedArray) return 'uint8'
  if (value instanceof Int8Array) return 'int8'
  if (value instanceof Uint16Array) return 'uint16'
  if (value instanceof Int16Array) return 'int16'
  if (value instanceof Uint32Array) return 'uint32'
  if (value instanceof Int32Array) return 'int32'
  if (value instanceof Float32Array) return 'float32'
  if (value instanceof Float64Array) return 'float64'
  if (value instanceof BigInt64Array) return 'int64'
  if (value instanceof BigUint64Array) return 'uint64'
  return 'data-view'
}

export const bytesOfView = (value: ArrayBufferView): Uint8Array =>
  new Uint8Array(value.buffer, value.byteOffset, value.byteLength)

export const correctnessFromView = (
  value: ArrayBufferView,
  shape: readonly number[] | null,
  details: readonly string[] = [],
): ScientificCompetitorCorrectness => {
  const bytes = bytesOfView(value)
  const bytesPerSample =
    value instanceof DataView
      ? 1
      : value instanceof Uint8Array ||
          value instanceof Uint8ClampedArray ||
          value instanceof Int8Array
        ? 1
        : value instanceof Uint16Array || value instanceof Int16Array
          ? 2
          : value instanceof Uint32Array ||
              value instanceof Int32Array ||
              value instanceof Float32Array
            ? 4
            : 8
  return {
    shape,
    nativeSampleType: typedArrayName(value),
    sampleSha256: hashBytes(bytes),
    sampleCount: value.byteLength / bytesPerSample,
    outputBytes: value.byteLength,
    details,
  }
}

export const correctnessFromNumbers = (
  values: readonly number[],
  nativeSampleType: string,
  shape: readonly number[] | null,
  details: readonly string[] = [],
): ScientificCompetitorCorrectness => {
  const bytesPerSample = nativeSampleType === 'uint16' || nativeSampleType === 'int16' ? 2 : 4
  const bytes = new Uint8Array(values.length * bytesPerSample)
  const view = new DataView(bytes.buffer)
  for (const [index, value] of values.entries()) {
    if (bytesPerSample === 2) view.setInt16(index * 2, value, true)
    else view.setInt32(index * 4, value, true)
  }
  return {
    shape,
    nativeSampleType,
    sampleSha256: hashBytes(bytes),
    sampleCount: values.length,
    outputBytes: bytes.byteLength,
    details,
  }
}

export const flattenNumericValues = (value: unknown, output: number[] = []): number[] => {
  if (typeof value === 'number') {
    output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    for (const child of value) flattenNumericValues(child, output)
    return output
  }
  throw new Error('The competitor returned a non-numeric dataset value')
}

export const exactArrayBuffer = (bytes: Uint8Array, source: NodeSourceTracker): ArrayBuffer => {
  const copy = bytes.slice()
  source.recordInputCopy(copy.byteLength)
  return copy.buffer
}

export const stageDefaults = (
  partial: Partial<NodeCompetitorExecution['stages']>,
): NodeCompetitorExecution['stages'] => ({
  moduleImportMilliseconds: 0,
  wasmInitializationMilliseconds: 0,
  inputCopyMilliseconds: 0,
  inputBridgeMilliseconds: 0,
  openMilliseconds: 0,
  hierarchyMilliseconds: 0,
  readMilliseconds: 0,
  outputTransferMilliseconds: 0,
  firstUsableDataMilliseconds: null,
  ...partial,
})
