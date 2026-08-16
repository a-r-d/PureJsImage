import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import type { RasterBlock, RasterSampleType } from '../../src/raster.ts'
import type { NormalizedScientificDatasetDescriptor } from '../../src/scientific/dataset.ts'
import type {
  ScientificCompanionRequest,
  ScientificDocument,
  ScientificDatasetSummary,
  ScientificReaderDetection,
  ScientificResource,
} from '../../src/scientific/reader.ts'
import type { ImageSource } from '../../src/source.ts'
import type { InstrumentedResourceSet, SourceReadSnapshot } from './sources.ts'
import type {
  CorrectnessRunSummary,
  FixedIndex,
  PlaneSelection,
  PreparedFixture,
  ScientificBenchmarkStatus,
  ScientificOperationKind,
  ScientificRunResult,
  ScientificSelection,
  ScientificWorkload,
} from './types.ts'

let FileSource: typeof import('../../src/node-source.ts').FileSource
let rasterSampleBytes: typeof import('../../src/raster.ts').rasterSampleBytes
let validateRasterBlock: typeof import('../../src/scientific/samples.ts').validateRasterBlock
let rasterSampleOffset: typeof import('../../src/scientific/samples.ts').rasterSampleOffset
let readRasterSample: typeof import('../../src/scientific/samples.ts').readRasterSample
let createInstrumentedResourceSet: typeof import('./sources.ts').createInstrumentedResourceSet
let CountingImageSource: typeof import('./sources.ts').CountingImageSource
let FragmentingImageSource: typeof import('./sources.ts').FragmentingImageSource
let LatencyImageSource: typeof import('./sources.ts').LatencyImageSource
let resourceRunMetrics: typeof import('./sources.ts').resourceRunMetrics
let allScientificReaders: typeof import('./registry.ts').allScientificReaders
let scientificEngine: typeof import('./registry.ts').scientificEngine
type CountingImageSourceInstance = InstanceType<typeof import('./sources.ts').CountingImageSource>

interface WorkerConfiguration {
  readonly workload: ScientificWorkload
  readonly fixture: PreparedFixture
  readonly sourceLatencyMilliseconds: number
  readonly fragmentBytes: number
  readonly warmups: number
}

interface PreparedRunConfiguration extends WorkerConfiguration {
  readonly operation: ScientificOperationKind
}

interface InitializedMessage {
  readonly type: 'initialized'
  readonly moduleImportMilliseconds: number
  readonly registryConstructionMilliseconds: number
  readonly engine: typeof scientificEngine
}

interface ReadyMessage {
  readonly type: 'ready'
  readonly baselineMemory: NodeJS.MemoryUsage
}

interface MeasurementCompleteMessage {
  readonly type: 'measurement-complete'
  readonly result: ScientificRunResult
}

interface PrepareMessage {
  readonly type: 'prepare'
  readonly configuration: WorkerConfiguration
}

interface RunMessage {
  readonly type: 'run'
}

interface AcknowledgedMessage {
  readonly type: 'measurement-acknowledged'
}

type WorkerMessage = PrepareMessage | RunMessage | AcknowledgedMessage

const send = (message: InitializedMessage | ReadyMessage | MeasurementCompleteMessage): void => {
  if (process.send === undefined) throw new Error('Scientific benchmark worker IPC is unavailable')
  process.send(message)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isWorkerMessage = (value: unknown): value is WorkerMessage => {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  return (
    value.type === 'prepare' || value.type === 'run' || value.type === 'measurement-acknowledged'
  )
}

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value)
  const record = value
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}

const descriptorHash = (descriptor: NormalizedScientificDatasetDescriptor): string =>
  createHash('sha256').update(stableJson(descriptor)).digest('hex')

const representativeValue = (value: number): CorrectnessRunSummary['firstRepresentativeValue'] => {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Number.POSITIVE_INFINITY) return 'Infinity'
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity'
  return value
}

const errorCode = (error: unknown): string | null => {
  if (!isRecord(error) || typeof error.code !== 'string') return null
  return error.code
}

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message
  return String(error)
}

const classifyError = (error: unknown): ScientificBenchmarkStatus => {
  const code = errorCode(error)
  return code === 'UNSUPPORTED_FORMAT' || code === 'UNSUPPORTED_OPERATION' ? 'unsupported' : 'error'
}

const memoryUsage = (): NodeJS.MemoryUsage => process.memoryUsage()

const emptyCorrectness = (): CorrectnessRunSummary => ({
  normalizedDescriptorSha256: null,
  selectedSampleSha256: null,
  selectedSampleCount: null,
  outputSampleType: null,
  outputComponentCount: null,
  blockCount: null,
  firstRepresentativeValue: null,
  lastRepresentativeValue: null,
  relevantCalibrationAssertions: Object.freeze([]),
  exactErrorClassification: null,
})

const emptyRunResult = (
  status: ScientificBenchmarkStatus,
  reason: string,
): ScientificRunResult => ({
  status,
  statusReason: reason,
  processStartupMilliseconds: 0,
  moduleImportMilliseconds: 0,
  registryConstructionMilliseconds: 0,
  timing: {
    detectionMilliseconds: 0,
    documentOpenMilliseconds: 0,
    datasetEnumerationMilliseconds: 0,
    datasetOpenMilliseconds: 0,
    timeToFirstEmittedBlockMilliseconds: null,
    completeSelectedOperationMilliseconds: 0,
    closeAndCleanupMilliseconds: 0,
    totalWallMilliseconds: 0,
    cpuUserMilliseconds: 0,
    cpuSystemMilliseconds: 0,
  },
  memory: {
    baselineRssBytes: 0,
    absolutePeakRssBytes: 0,
    peakHeapUsedBytes: 0,
    peakExternalBytes: 0,
    peakArrayBufferBytes: 0,
    outputBytes: 0,
    maximumEmittedBlockBytes: 0,
  },
  source: {
    readCalls: 0,
    requestedBytes: 0,
    returnedBytes: 0,
    uniqueSourceBytesTouched: 0,
    largestIndividualReadBytes: 0,
    overfetchRatio: null,
    companionResolutionCount: 0,
    perResource: Object.freeze([]),
    completePrimarySourceRead: false,
    payloadBytesReadDuringDetection: null,
    payloadBytesReadDuringMetadataOnlyOpen: null,
  },
  correctness: emptyCorrectness(),
})

const intervalIntersection = (
  intervals: readonly (readonly [number, number])[],
  ranges: readonly (readonly [number, number])[],
): number => {
  const intersections = intervals.flatMap(([readStart, readEnd]) =>
    ranges
      .map(
        ([rangeStart, rangeEnd]) =>
          [Math.max(readStart, rangeStart), Math.min(readEnd, rangeEnd)] as const,
      )
      .filter(([start, end]) => end > start),
  )
  if (intersections.length === 0) return 0
  intersections.sort((left, right) => left[0] - right[0] || left[1] - right[1])
  let total = 0
  let start = intersections[0]?.[0] ?? 0
  let end = intersections[0]?.[1] ?? 0
  for (let index = 1; index < intersections.length; index += 1) {
    const interval = intersections[index]
    if (interval === undefined) continue
    if (interval[0] > end) {
      total += end - start
      start = interval[0]
      end = interval[1]
    } else {
      end = Math.max(end, interval[1])
    }
  }
  return total + end - start
}

const fixedIndices = (
  descriptor: NormalizedScientificDatasetDescriptor,
  selectedAxes: readonly string[],
  requested: readonly FixedIndex[] | undefined,
): readonly FixedIndex[] => {
  const output: FixedIndex[] = []
  const seen = new Set<string>()
  for (const entry of requested ?? []) {
    if (seen.has(entry.axisId)) continue
    seen.add(entry.axisId)
    output.push(Object.freeze({ axisId: entry.axisId, index: entry.index }))
  }
  for (const axis of descriptor.axes) {
    if (selectedAxes.includes(axis.id) || seen.has(axis.id)) continue
    output.push(Object.freeze({ axisId: axis.id, index: 0 }))
  }
  return Object.freeze(output)
}

const choosePlaneAxes = (
  descriptor: NormalizedScientificDatasetDescriptor,
  requested: readonly [string, string] | undefined,
): readonly [string, string] => {
  if (requested !== undefined) return requested
  const candidates = descriptor.axes.filter((axis) => axis.length > 1)
  const horizontal = candidates[0] ?? descriptor.axes[0]
  const vertical = candidates[1] ?? descriptor.axes[1]
  if (horizontal === undefined || vertical === undefined || horizontal.id === vertical.id) {
    throw new Error('Selected scientific dataset does not expose two plane axes')
  }
  return [horizontal.id, vertical.id]
}

const boundedRegion = (
  descriptor: NormalizedScientificDatasetDescriptor,
  axes: readonly [string, string],
  region: PlaneSelection['region'],
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
  const horizontal = descriptor.axes.find((axis) => axis.id === axes[0])
  const vertical = descriptor.axes.find((axis) => axis.id === axes[1])
  if (horizontal === undefined || vertical === undefined)
    throw new Error('Selected plane axis is absent')
  if (region === undefined) return { x: 0, y: 0, width: horizontal.length, height: vertical.length }
  if (
    !Number.isSafeInteger(region.x) ||
    !Number.isSafeInteger(region.y) ||
    !Number.isSafeInteger(region.width) ||
    !Number.isSafeInteger(region.height) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width < 1 ||
    region.height < 1 ||
    region.x + region.width > horizontal.length ||
    region.y + region.height > vertical.length
  ) {
    throw new Error('Selected plane region is outside the dataset')
  }
  return region
}

const randomRegions = (
  descriptor: NormalizedScientificDatasetDescriptor,
  axes: readonly [string, string],
  selection: NonNullable<PlaneSelection['randomRegions']>,
): readonly {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}[] => {
  const horizontal = descriptor.axes.find((axis) => axis.id === axes[0])
  const vertical = descriptor.axes.find((axis) => axis.id === axes[1])
  if (horizontal === undefined || vertical === undefined)
    throw new Error('Random-region axis is absent')
  if (
    selection.width < 1 ||
    selection.height < 1 ||
    selection.width > horizontal.length ||
    selection.height > vertical.length
  )
    throw new Error('Random region exceeds the selected dataset')
  let state = selection.seed >>> 0
  const next = (): number => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
  return Object.freeze(
    Array.from({ length: selection.count }, () =>
      Object.freeze({
        x: Math.floor(next() * (horizontal.length - selection.width + 1)),
        y: Math.floor(next() * (vertical.length - selection.height + 1)),
        width: selection.width,
        height: selection.height,
      }),
    ),
  )
}

const selectedSummary = (
  document: ScientificDocument,
  selection: ScientificSelection,
): ScientificDatasetSummary => {
  const datasetId = selection.datasetId
  const summary =
    datasetId === undefined
      ? document.datasets[0]
      : document.datasets.find((entry) => entry.id === datasetId)
  if (summary === undefined)
    throw new Error(`Scientific document has no selected dataset ${datasetId ?? ''}`)
  return summary
}

const descriptorAssertions = (
  descriptor: NormalizedScientificDatasetDescriptor,
  workload: ScientificWorkload,
): string[] => {
  const assertion = workload.descriptorAssertion
  const results: string[] = []
  if (assertion?.sampleType !== undefined) {
    if (descriptor.sampleType !== assertion.sampleType)
      throw new Error(
        `Expected sample type ${assertion.sampleType}, received ${descriptor.sampleType}`,
      )
    results.push(`sampleType=${descriptor.sampleType}`)
  }
  if (assertion?.componentCount !== undefined) {
    if (descriptor.components.length !== assertion.componentCount)
      throw new Error(
        `Expected ${assertion.componentCount} components, received ${descriptor.components.length}`,
      )
    results.push(`components=${descriptor.components.length}`)
  }
  if (assertion?.axisId !== undefined) {
    if (!descriptor.axes.some((axis) => axis.id === assertion.axisId))
      throw new Error(`Expected axis ${assertion.axisId}`)
    results.push(`axis=${assertion.axisId}`)
  }
  if (assertion?.axisUnit !== undefined || assertion?.axisKind !== undefined) {
    const axis = descriptor.axes.find((entry) => entry.id === assertion.axisId)
    if (axis === undefined) throw new Error('Axis assertion requires axisId')
    if (assertion.axisUnit !== undefined && axis.unit !== assertion.axisUnit)
      throw new Error(`Expected axis unit ${assertion.axisUnit}`)
    if (assertion.axisKind !== undefined && axis.kind !== assertion.axisKind)
      throw new Error(`Expected axis kind ${assertion.axisKind}`)
  }
  for (const axisId of workload.calibrationAxes ?? []) {
    const axis = descriptor.axes.find((entry) => entry.id === axisId)
    if (axis === undefined) throw new Error(`Expected calibration axis ${axisId}`)
    if (axis.calibration === undefined && axis.coordinates.type === 'index')
      throw new Error(`Axis ${axisId} has no calibration evidence`)
    results.push(`calibrated:${axisId}`)
  }
  return results
}

interface OutputAccumulator {
  readonly hash: ReturnType<typeof createHash>
  sampleCount: number
  blockCount: number
  outputBytes: number
  maximumBlockBytes: number
  firstValue: CorrectnessRunSummary['firstRepresentativeValue']
  lastValue: CorrectnessRunSummary['lastRepresentativeValue']
  firstBlockMilliseconds: number | null
  sampleType: RasterSampleType | null
  componentCount: number | null
}

const createAccumulator = (): OutputAccumulator => ({
  hash: createHash('sha256'),
  sampleCount: 0,
  blockCount: 0,
  outputBytes: 0,
  maximumBlockBytes: 0,
  firstValue: null,
  lastValue: null,
  firstBlockMilliseconds: null,
  sampleType: null,
  componentCount: null,
})

const consumeRasterBlock = (
  accumulator: OutputAccumulator,
  block: RasterBlock,
  startedAt: number,
): void => {
  const layout = validateRasterBlock(block)
  accumulator.hash.update(block.data)
  accumulator.blockCount += 1
  accumulator.outputBytes += block.data.byteLength
  accumulator.maximumBlockBytes = Math.max(accumulator.maximumBlockBytes, block.data.byteLength)
  accumulator.sampleType = block.format.sampleType
  accumulator.componentCount = block.format.channels
  accumulator.sampleCount += block.width * block.height * block.format.channels
  if (accumulator.firstBlockMilliseconds === null) {
    accumulator.firstBlockMilliseconds = performance.now() - startedAt
    accumulator.firstValue = representativeValue(
      readRasterSample(
        block.data,
        new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength),
        rasterSampleOffset(block, layout, 0, 0, 0),
        block.format.sampleType,
      ),
    )
  }
  accumulator.lastValue = representativeValue(
    readRasterSample(
      block.data,
      new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength),
      rasterSampleOffset(
        block,
        layout,
        block.width - 1,
        block.height - 1,
        block.format.channels - 1,
      ),
      block.format.sampleType,
    ),
  )
}

const consumeSeriesBlock = (
  accumulator: OutputAccumulator,
  block: {
    readonly length: number
    readonly format: {
      readonly sampleType: RasterSampleType
      readonly channels: number
      readonly planar: boolean
    }
    readonly data: Uint8Array
    readonly release?: () => void
  },
  startedAt: number,
): void => {
  const bytesPerSample = rasterSampleBytes(block.format.sampleType)
  const bytesPerEntry = bytesPerSample * block.format.channels
  if (block.format.planar || block.data.byteLength < block.length * bytesPerEntry)
    throw new Error('Scientific series block layout is invalid')
  accumulator.hash.update(block.data)
  accumulator.blockCount += 1
  accumulator.outputBytes += block.data.byteLength
  accumulator.maximumBlockBytes = Math.max(accumulator.maximumBlockBytes, block.data.byteLength)
  accumulator.sampleType = block.format.sampleType
  accumulator.componentCount = block.format.channels
  accumulator.sampleCount += block.length * block.format.channels
  const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
  if (accumulator.firstBlockMilliseconds === null) {
    accumulator.firstBlockMilliseconds = performance.now() - startedAt
    accumulator.firstValue = representativeValue(
      readRasterSample(block.data, view, 0, block.format.sampleType),
    )
  }
  accumulator.lastValue = representativeValue(
    readRasterSample(
      block.data,
      view,
      (block.length - 1) * bytesPerEntry + (block.format.channels - 1) * bytesPerSample,
      block.format.sampleType,
    ),
  )
}

const makeContext = (
  resources: InstrumentedResourceSet,
  fixture: PreparedFixture,
): {
  readonly primary: ScientificResource
  readonly companions: {
    resolve(request: Readonly<ScientificCompanionRequest>): Promise<ScientificResource | undefined>
  }
  readonly probeLimits: {
    readonly maxTotalBytes: number
    readonly maxTotalReads: number
    readonly maxReaders: number
    readonly maxReadBytes: number
    readonly maxCompanionResolutions: number
  }
} => ({
  primary: Object.freeze({
    id: resources.primary.prepared.id,
    ...(resources.primary.prepared.name === null ? {} : { name: resources.primary.prepared.name }),
    source: resources.primary.source,
  }),
  companions: {
    async resolve(request) {
      const relativeName = request.kind === 'relative-name' ? request.name : request.relativeName
      const resource = resources.resolve({
        kind: request.kind,
        ...(relativeName === undefined ? {} : { relativeName }),
      })
      return resource === undefined
        ? undefined
        : Object.freeze({
            id: resource.prepared.id,
            ...(resource.prepared.name === null ? {} : { name: resource.prepared.name }),
            source: resource.source,
          })
    },
  },
  probeLimits: {
    maxTotalBytes: Math.max(
      64 * 1024 * 1024,
      fixture.resources.reduce((total, resource) => total + resource.sizeBytes, 0),
    ),
    maxTotalReads: 256,
    maxReaders: allScientificReaders.length,
    maxReadBytes: Math.max(1_048_576, ...fixture.resources.map((resource) => resource.sizeBytes)),
    maxCompanionResolutions: 64,
  },
})

const sourceSnapshots = (
  resources: InstrumentedResourceSet,
): ReadonlyMap<string, SourceReadSnapshot> =>
  new Map(
    resources.resources.map((resource) => [
      resource.prepared.id,
      resource.physicalCounter.snapshot,
    ]),
  )

const payloadBytes = (
  fixture: PreparedFixture,
  before: ReadonlyMap<string, SourceReadSnapshot>,
  after: ReadonlyMap<string, SourceReadSnapshot>,
): number => {
  let total = 0
  for (const resource of fixture.resources) {
    const start = before.get(resource.id)
    const end = after.get(resource.id)
    if (start === undefined || end === undefined) continue
    total += intervalIntersection(end.intervals, fixture.payloadRanges[resource.id] ?? [])
  }
  return total
}

const buildResources = async (
  fixture: PreparedFixture,
  latencyMilliseconds: number,
  fragmentBytes: number,
): Promise<InstrumentedResourceSet> => {
  const physicalCounters = new Map<string, CountingImageSourceInstance>()
  const readerSources = new Map<string, ImageSource>()
  for (const resource of fixture.resources) {
    const file = await FileSource.open(resource.path)
    const fragmented = fragmentBytes > 0 ? new FragmentingImageSource(file, fragmentBytes) : file
    const physicalCounter = new CountingImageSource(fragmented)
    const source =
      latencyMilliseconds > 0
        ? new LatencyImageSource(physicalCounter, latencyMilliseconds)
        : physicalCounter
    physicalCounters.set(resource.id, physicalCounter)
    readerSources.set(resource.id, source)
  }
  return createInstrumentedResourceSet({
    fixture,
    sourceFactory(resource) {
      const source = readerSources.get(resource.id)
      const physicalCounter = physicalCounters.get(resource.id)
      if (source === undefined || physicalCounter === undefined)
        throw new Error(`Prepared source ${resource.id} is unavailable`)
      return { source, physicalCounter }
    },
  })
}

const executeOperation = async (
  document: ScientificDocument,
  workload: ScientificWorkload,
  accumulator: OutputAccumulator,
  operationStartedAt: number,
): Promise<void> => {
  const selection = workload.selection
  if (workload.operation === 'metadata-only') return
  const summary = selectedSummary(document, selection)
  const dataset = await document.openDataset(summary.id)
  const descriptor = dataset.descriptor
  if (selection.kind === 'plane') {
    const axes = choosePlaneAxes(descriptor, selection.displayAxes)
    const regions =
      selection.randomRegions === undefined
        ? [boundedRegion(descriptor, axes, selection.region)]
        : randomRegions(descriptor, axes, selection.randomRegions)
    const fixed = fixedIndices(descriptor, axes, selection.fixedIndices)
    for (const region of regions) {
      const blocks = dataset.readPlane({
        displayAxes: axes,
        fixedIndices: fixed,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      })
      for await (const block of blocks) {
        try {
          consumeRasterBlock(accumulator, block, operationStartedAt)
        } finally {
          block.release?.()
        }
        if (workload.operation === 'first-block') return
      }
    }
    return
  }
  const readSeries = dataset.readSeries
  if (readSeries === undefined) throw new Error('Selected scientific dataset has no series reader')
  const axis = selection.axisId ?? descriptor.axes[0]?.id
  if (axis === undefined) throw new Error('Selected scientific dataset has no series axis')
  const axisDescriptor = descriptor.axes.find((entry) => entry.id === axis)
  if (axisDescriptor === undefined) throw new Error(`Series axis ${axis} is absent`)
  const start = selection.start ?? 0
  const length = selection.length ?? Math.min(axisDescriptor.length, 64)
  const fixed = fixedIndices(descriptor, [axis], selection.fixedIndices)
  for await (const block of readSeries.call(dataset, {
    axisId: axis,
    fixedIndices: fixed,
    start,
    length,
  })) {
    try {
      consumeSeriesBlock(accumulator, block, operationStartedAt)
    } finally {
      block.release?.()
    }
    if (workload.operation === 'first-block') return
  }
}

const executeOnce = async (
  configuration: PreparedRunConfiguration,
  registry: InstanceType<typeof import('../../src/scientific/reader.ts').ScientificReaderRegistry>,
): Promise<ScientificRunResult> => {
  const resources = await buildResources(
    configuration.fixture,
    configuration.sourceLatencyMilliseconds,
    configuration.fragmentBytes,
  )
  const context = makeContext(resources, configuration.fixture)
  const startedAt = performance.now()
  const cpuStarted = process.cpuUsage()
  const beforeDetection = sourceSnapshots(resources)
  let detection: ScientificReaderDetection | undefined
  let document: ScientificDocument | undefined
  const accumulator = createAccumulator()
  let detectionMilliseconds = 0
  let documentOpenMilliseconds = 0
  let datasetEnumerationMilliseconds = 0
  let datasetOpenMilliseconds = 0
  let closeAndCleanupMilliseconds = 0
  let operationMilliseconds = 0
  let metadataPayload: number | null = null
  try {
    const detectionStartedAt = performance.now()
    detection = await registry.detect(context)
    detectionMilliseconds = performance.now() - detectionStartedAt
    const afterDetection = sourceSnapshots(resources)
    const documentStartedAt = performance.now()
    document = await registry.open({
      ...context,
      readerId: detection.reader.id,
      readerVersion: detection.reader.version,
    })
    documentOpenMilliseconds = performance.now() - documentStartedAt
    const enumerationStartedAt = performance.now()
    void document.datasets
    datasetEnumerationMilliseconds = performance.now() - enumerationStartedAt
    const summary = selectedSummary(document, configuration.workload.selection)
    const descriptor = summary.descriptor
    const calibrationAssertions = descriptorAssertions(descriptor, configuration.workload)
    const metadataOpenSnapshot = sourceSnapshots(resources)
    metadataPayload = payloadBytes(configuration.fixture, afterDetection, metadataOpenSnapshot)
    if (configuration.operation !== 'metadata-only') {
      const datasetStartedAt = performance.now()
      await document.openDataset(summary.id)
      datasetOpenMilliseconds = performance.now() - datasetStartedAt
      const beforeOperation = sourceSnapshots(resources)
      const operationStartedAt = performance.now()
      await executeOperation(document, configuration.workload, accumulator, operationStartedAt)
      operationMilliseconds = performance.now() - operationStartedAt
      if (beforeOperation.size === 0) throw new Error('Instrumented source set is empty')
    }
    const closeStartedAt = performance.now()
    await document.close?.()
    closeAndCleanupMilliseconds = performance.now() - closeStartedAt
    const cpu = process.cpuUsage(cpuStarted)
    const perResource = resources.resources.map((resource) =>
      resourceRunMetrics(resource, configuration.fixture.payloadRanges[resource.prepared.id] ?? []),
    )
    const readCalls = perResource.reduce((total, entry) => total + entry.readCalls, 0)
    const requestedBytes = perResource.reduce((total, entry) => total + entry.requestedBytes, 0)
    const returnedBytes = perResource.reduce((total, entry) => total + entry.returnedBytes, 0)
    const uniqueSourceBytesTouched = perResource.reduce(
      (total, entry) => total + entry.uniqueSourceBytesTouched,
      0,
    )
    const largestIndividualReadBytes = perResource.reduce(
      (maximum, entry) => Math.max(maximum, entry.largestIndividualReadBytes),
      0,
    )
    const correctness: CorrectnessRunSummary = {
      normalizedDescriptorSha256: descriptorHash(descriptor),
      selectedSampleSha256:
        configuration.operation === 'metadata-only' ? null : accumulator.hash.digest('hex'),
      selectedSampleCount:
        configuration.operation === 'metadata-only' ? null : accumulator.sampleCount,
      outputSampleType: accumulator.sampleType,
      outputComponentCount: accumulator.componentCount,
      blockCount: configuration.operation === 'metadata-only' ? null : accumulator.blockCount,
      firstRepresentativeValue: accumulator.firstValue,
      lastRepresentativeValue: accumulator.lastValue,
      relevantCalibrationAssertions: Object.freeze(calibrationAssertions),
      exactErrorClassification: null,
    }
    const finalMemory = memoryUsage()
    return {
      status:
        detection.reader.id === configuration.workload.readerId ? 'supported' : 'invalid-output',
      statusReason:
        detection.reader.id === configuration.workload.readerId
          ? null
          : `Detected ${detection.reader.id} instead of ${configuration.workload.readerId}`,
      processStartupMilliseconds: 0,
      moduleImportMilliseconds: 0,
      registryConstructionMilliseconds: 0,
      timing: {
        detectionMilliseconds,
        documentOpenMilliseconds,
        datasetEnumerationMilliseconds,
        datasetOpenMilliseconds,
        timeToFirstEmittedBlockMilliseconds: accumulator.firstBlockMilliseconds,
        completeSelectedOperationMilliseconds: operationMilliseconds,
        closeAndCleanupMilliseconds,
        totalWallMilliseconds: performance.now() - startedAt,
        cpuUserMilliseconds: cpu.user / 1_000,
        cpuSystemMilliseconds: cpu.system / 1_000,
      },
      memory: {
        baselineRssBytes: 0,
        absolutePeakRssBytes: finalMemory.rss,
        peakHeapUsedBytes: finalMemory.heapUsed,
        peakExternalBytes: finalMemory.external,
        peakArrayBufferBytes: finalMemory.arrayBuffers,
        outputBytes: accumulator.outputBytes,
        maximumEmittedBlockBytes: accumulator.maximumBlockBytes,
      },
      source: {
        readCalls,
        requestedBytes,
        returnedBytes,
        uniqueSourceBytesTouched,
        largestIndividualReadBytes,
        overfetchRatio:
          uniqueSourceBytesTouched === 0 ? null : requestedBytes / uniqueSourceBytesTouched,
        companionResolutionCount: resources.companionResolutionCount,
        perResource: Object.freeze(perResource),
        completePrimarySourceRead: perResource[0]?.completeSourceRead ?? false,
        payloadBytesReadDuringDetection: payloadBytes(
          configuration.fixture,
          beforeDetection,
          afterDetection,
        ),
        payloadBytesReadDuringMetadataOnlyOpen: metadataPayload,
      },
      correctness,
    }
  } catch (error) {
    const status = classifyError(error)
    const reason = errorMessage(error)
    try {
      await document?.close?.()
    } catch {
      // Preserve the original reader error for the result.
    }
    const result = emptyRunResult(status, reason)
    const cpu = process.cpuUsage(cpuStarted)
    const finalMemory = memoryUsage()
    return {
      ...result,
      timing: {
        ...result.timing,
        detectionMilliseconds,
        documentOpenMilliseconds,
        datasetEnumerationMilliseconds,
        datasetOpenMilliseconds,
        totalWallMilliseconds: performance.now() - startedAt,
        cpuUserMilliseconds: cpu.user / 1_000,
        cpuSystemMilliseconds: cpu.system / 1_000,
      },
      memory: {
        ...result.memory,
        absolutePeakRssBytes: finalMemory.rss,
        peakHeapUsedBytes: finalMemory.heapUsed,
        peakExternalBytes: finalMemory.external,
        peakArrayBufferBytes: finalMemory.arrayBuffers,
      },
      correctness: {
        ...result.correctness,
        exactErrorClassification: errorCode(error) ?? status,
      },
    }
  }
}

let prepared: PreparedRunConfiguration | undefined
let readyMemory: NodeJS.MemoryUsage | undefined

const moduleImportStartedAt = performance.now()
const [nodeSourceModule, rasterModule, samplesModule, sourcesModule, registryModule, readerModule] =
  await Promise.all([
    import('../../src/node-source.ts'),
    import('../../src/raster.ts'),
    import('../../src/scientific/samples.ts'),
    import('./sources.ts'),
    import('./registry.ts'),
    import('../../src/scientific/reader.ts'),
  ])
FileSource = nodeSourceModule.FileSource
rasterSampleBytes = rasterModule.rasterSampleBytes
validateRasterBlock = samplesModule.validateRasterBlock
rasterSampleOffset = samplesModule.rasterSampleOffset
readRasterSample = samplesModule.readRasterSample
createInstrumentedResourceSet = sourcesModule.createInstrumentedResourceSet
CountingImageSource = sourcesModule.CountingImageSource
FragmentingImageSource = sourcesModule.FragmentingImageSource
LatencyImageSource = sourcesModule.LatencyImageSource
resourceRunMetrics = sourcesModule.resourceRunMetrics
allScientificReaders = registryModule.allScientificReaders
scientificEngine = registryModule.scientificEngine
const moduleImportMilliseconds = performance.now() - moduleImportStartedAt
const registryConstructionStartedAt = performance.now()
const registry = new readerModule.ScientificReaderRegistry(allScientificReaders)
const registryConstructionMilliseconds = performance.now() - registryConstructionStartedAt
const initialized: InitializedMessage = {
  type: 'initialized',
  moduleImportMilliseconds,
  registryConstructionMilliseconds,
  engine: scientificEngine,
}
send(initialized)

process.on('message', async (value: unknown) => {
  if (!isWorkerMessage(value)) return
  if (value.type === 'prepare') {
    const configuration = value.configuration
    for (let index = 0; index < configuration.warmups; index += 1) {
      await executeOnce(
        {
          ...configuration,
          operation: configuration.workload.operation ?? 'selected',
        },
        registry,
      )
    }
    if (typeof global.gc === 'function') global.gc()
    readyMemory = memoryUsage()
    prepared = {
      ...configuration,
      operation: configuration.workload.operation ?? 'selected',
    }
    send({ type: 'ready', baselineMemory: readyMemory })
    return
  }
  if (value.type === 'run') {
    if (prepared === undefined || readyMemory === undefined)
      throw new Error('Scientific worker is not prepared')
    const peak = {
      rss: readyMemory.rss,
      heapUsed: readyMemory.heapUsed,
      external: readyMemory.external,
      arrayBuffers: readyMemory.arrayBuffers,
    }
    const sampler = setInterval(() => {
      const current = memoryUsage()
      peak.rss = Math.max(peak.rss, current.rss)
      peak.heapUsed = Math.max(peak.heapUsed, current.heapUsed)
      peak.external = Math.max(peak.external, current.external)
      peak.arrayBuffers = Math.max(peak.arrayBuffers, current.arrayBuffers)
    }, 1)
    const result = await executeOnce(prepared, registry)
    clearInterval(sampler)
    const measured = {
      ...result,
      memory: {
        ...result.memory,
        baselineRssBytes: readyMemory.rss,
        absolutePeakRssBytes: Math.max(result.memory.absolutePeakRssBytes, peak.rss),
        peakHeapUsedBytes: Math.max(result.memory.peakHeapUsedBytes, peak.heapUsed),
        peakExternalBytes: Math.max(result.memory.peakExternalBytes, peak.external),
        peakArrayBufferBytes: Math.max(result.memory.peakArrayBufferBytes, peak.arrayBuffers),
      },
    }
    send({ type: 'measurement-complete', result: measured })
    return
  }
  process.exit(0)
})
