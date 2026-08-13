import { readFile, writeFile } from 'node:fs/promises'
import { arch, platform, release } from 'node:os'
import {
  analysisGaussianBlurOperationId,
  analysisLineProfileOperationId,
  analysisStatisticsOperationId,
  analysisThresholdOperationId,
  canonicalTileKey,
  createAnalysisController,
  createBuiltInAnalysisBundle,
  createTileRuntime,
  normalizeRoi,
  roiValueTypeId,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
  summarizeResult,
  validateAnalysisResult,
} from '../../src/analysis/index.ts'
import type {
  AnalysisGraph,
  AnalysisResultSummary,
  Roi,
  TileRequest,
  TileRuntimeMetrics,
  TileSource,
} from '../../src/analysis/index.ts'
import { openAperioSvs } from '../../src/pathology/index.ts'
import type { OperationJsonObject } from '../../src/operations/index.ts'
import type {
  DirectNumericTileDataset,
  NumericTile,
  NumericTileReadRequest,
  ScientificDataset,
  ScientificReader,
} from '../../src/scientific/index.ts'
import {
  cbfReader,
  createScientificLibrary,
  encodeGsf,
  gsfReader,
  mrcReader,
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  renderScientificPlane,
  resolveNumericTileSource,
} from '../../src/scientific/index.ts'
import { HttpRangeSource } from '../../src/sources/http-range.ts'
import { MemorySource } from '../../src/source.ts'
import { openTiffDocument } from '../../src/tiff/index.ts'

interface TimedValue<Value> {
  readonly milliseconds: number
  readonly value: Value
}

interface DocumentMeasurement {
  readonly reader: string
  readonly bytes: number
  readonly detectionMilliseconds: number
  readonly summaryMilliseconds: number
  readonly firstTileMilliseconds: number
  readonly checksum: number
}

interface OperationMeasurement {
  readonly coldMilliseconds: number
  readonly warmMilliseconds: number
  readonly summary: AnalysisResultSummary
  readonly provider: ProviderMeasurement
}

interface DatasetOutputMeasurement {
  readonly planningMilliseconds: number
  readonly firstTileMilliseconds: number
  readonly warmTileMilliseconds: number
  readonly checksum: number
  readonly runtime: TileRuntimeMetrics
  readonly provider: ProviderMeasurement
}

interface ProviderMeasurement {
  readonly id: string
  readonly version: number
  readonly implementationVersion: string
}

interface WsiRangeMeasurement {
  readonly sourceBytes: number
  readonly sourceOpenMilliseconds: number
  readonly tiffOpenMilliseconds: number
  readonly slideOpenMilliseconds: number
  readonly firstTileMilliseconds: number
  readonly checksum: number
  readonly httpRange: {
    readonly requests: number
    readonly bytesFetched: number
    readonly cacheBytes: number
  }
}

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const timed = async <Value>(work: () => Promise<Value>): Promise<TimedValue<Value>> => {
  const started = performance.now()
  const value = await work()
  return { milliseconds: Number((performance.now() - started).toFixed(3)), value }
}

const checksumTile = (tile: NumericTile): number => {
  let checksum = 0
  for (let index = 0; index < tile.data.length; index += 1) {
    const raw = tile.data[index]
    checksum += typeof raw === 'bigint' ? Number(raw) : (raw ?? 0)
  }
  return checksum
}

const firstNumericTile = async (
  dataset: ScientificDataset,
  request: Readonly<NumericTileReadRequest>,
): Promise<number> => {
  const iterator = resolveNumericTileSource(dataset)
    .readNumericTiles(request)
    [Symbol.asyncIterator]()
  const next = await iterator.next()
  if (next.done) throw new Error('Expected a numeric tile')
  try {
    return checksumTile(next.value)
  } finally {
    next.value.release()
    await iterator.return?.()
  }
}

const createMrcFixture = (width: number, height: number): Uint8Array => {
  const output = new Uint8Array(1_024 + width * height * 2)
  const view = new DataView(output.buffer)
  const integer = (offset: number, value: number): void => view.setInt32(offset, value, true)
  const real = (offset: number, value: number): void => view.setFloat32(offset, value, true)
  integer(0, width)
  integer(4, height)
  integer(8, 1)
  integer(12, 1)
  integer(28, width)
  integer(32, height)
  integer(36, 1)
  real(40, width)
  real(44, height)
  real(48, 1)
  real(52, 90)
  real(56, 90)
  real(60, 90)
  integer(64, 1)
  integer(68, 2)
  integer(72, 3)
  output.set(new TextEncoder().encode('MAP '), 208)
  output.set([0x44, 0x44, 0, 0], 212)
  for (let index = 0; index < width * height; index += 1) {
    view.setInt16(1_024 + index * 2, index % 32_000, true)
  }
  return output
}

const encodeCbfByteOffset = (values: readonly number[]): Uint8Array => {
  const encoded: number[] = []
  let previous = 0
  for (const value of values) {
    const delta = value - previous
    previous = value
    if (delta < -127 || delta > 127) throw new Error('Benchmark CBF delta is out of range')
    encoded.push(delta & 0xff)
  }
  return Uint8Array.from(encoded)
}

const createCbfFixture = (width: number, height: number): Uint8Array => {
  const values = Array.from({ length: width * height }, (_value, index) => index % 100)
  const binary = encodeCbfByteOffset(values)
  const header = new TextEncoder().encode(`###CBF: VERSION 1.5
data_benchmark
_array_data.data
;
--CIF-BINARY-FORMAT-SECTION--
Content-Type: application/octet-stream;
 conversions="x-CBF_BYTE_OFFSET"
Content-Transfer-Encoding: BINARY
X-Binary-Size: ${binary.byteLength}
X-Binary-ID: 1
X-Binary-Element-Type: "signed 32-bit integer"
X-Binary-Element-Byte-Order: LITTLE_ENDIAN
X-Binary-Number-of-Elements: ${width * height}
X-Binary-Size-Fastest-Dimension: ${width}
X-Binary-Size-Second-Dimension: ${height}
X-Binary-Size-Padding: 0

`)
  const marker = Uint8Array.of(0x0c, 0x1a, 0x04, 0xd5)
  const footer = new TextEncoder().encode('\n--CIF-BINARY-FORMAT-SECTION----\n;\n')
  const output = new Uint8Array(
    header.byteLength + marker.byteLength + binary.byteLength + footer.byteLength,
  )
  output.set(header)
  output.set(marker, header.byteLength)
  output.set(binary, header.byteLength + marker.byteLength)
  output.set(footer, header.byteLength + marker.byteLength + binary.byteLength)
  return output
}

const measureDocument = async (
  reader: ScientificReader,
  name: string,
  bytes: Uint8Array,
  fixedIndices: readonly { readonly axisId: string; readonly index: number }[],
): Promise<DocumentMeasurement> => {
  const library = createScientificLibrary({ readers: [reader] })
  const opened = await timed(() =>
    library.open({ primary: { id: name, source: new MemorySource(bytes) } }),
  )
  const summaries = await timed(async () => [...opened.value.datasets])
  const summary = summaries.value[0]
  if (summary === undefined) throw new Error(`${name} produced no dataset summary`)
  const dataset = await opened.value.openDataset(summary.id)
  const firstTile = await timed(() =>
    firstNumericTile(dataset, {
      displayAxes: ['x', 'y'],
      fixedIndices,
      x: 0,
      y: 0,
      width: Math.min(64, dataset.descriptor.axes.find((axis) => axis.id === 'x')?.length ?? 1),
      height: Math.min(64, dataset.descriptor.axes.find((axis) => axis.id === 'y')?.length ?? 1),
    }),
  )
  await opened.value.close?.()
  return {
    reader: opened.value.reader.id,
    bytes: bytes.byteLength,
    detectionMilliseconds: opened.milliseconds,
    summaryMilliseconds: summaries.milliseconds,
    firstTileMilliseconds: firstTile.milliseconds,
    checksum: firstTile.value,
  }
}

const directDataset = (
  axisLengths: Readonly<Record<string, number>>,
  valueAt: (indices: Readonly<Record<string, number>>) => number,
): DirectNumericTileDataset => {
  const axes = Object.entries(axisLengths).map(([id, length]) => ({
    id,
    kind: 'space' as const,
    length,
    coordinates: { type: 'index' as const },
  }))
  const descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 2,
    axes,
    sampleType: 'float32',
    components: [{ id: 'signal', kind: 'scalar' }],
    capabilities: { regionReads: true, resolutionLevels: false },
  })
  const dataset: DirectNumericTileDataset = Object.freeze({
    descriptor,
    numericTileSource: Object.freeze({
      descriptor,
      directSemantics: Object.freeze({
        sourceSampleType: 'float32' as const,
        nativeSampleType: 'float32' as const,
        componentCount: 1,
        layout: 'interleaved' as const,
        supportedTargetSampleTypes: ['float32', 'float64'] as const,
      }),
      async *readNumericTiles(request: Readonly<NumericTileReadRequest>) {
        const { targetSampleType, ...planeRequest } = request
        const normalized = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
        normalized.signal?.throwIfAborted()
        const data =
          targetSampleType === 'float64'
            ? new Float64Array(normalized.width * normalized.height)
            : new Float32Array(normalized.width * normalized.height)
        const fixed = Object.fromEntries(
          normalized.fixedIndices.map((entry) => [entry.axisId, entry.index]),
        )
        for (let y = 0; y < normalized.height; y += 1) {
          for (let x = 0; x < normalized.width; x += 1) {
            data[y * normalized.width + x] = valueAt({
              ...fixed,
              [normalized.displayAxes[0]]: normalized.x + x,
              [normalized.displayAxes[1]]: normalized.y + y,
            })
          }
        }
        yield Object.freeze({
          x: normalized.x,
          y: normalized.y,
          width: normalized.width,
          height: normalized.height,
          sampleType: targetSampleType ?? 'float32',
          componentCount: 1,
          layout: 'interleaved' as const,
          rowStrideElements: normalized.width,
          data,
          release() {},
        })
      },
    }),
    readPlane() {
      throw new Error('Application benchmark uses the direct native-tile path')
    },
  })
  return dataset
}

const operationGraph = (
  operationId: string,
  outputPort: string,
  parameters: OperationJsonObject,
  includeRoi: boolean,
): AnalysisGraph => ({
  schemaVersion: 1,
  inputs: [
    { name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
    ...(includeRoi ? [{ name: 'selection', valueType: { id: roiValueTypeId, version: 1 } }] : []),
  ],
  nodes: [
    {
      id: 'operation',
      operation: { id: operationId, version: 1 },
      inputs: [
        { port: 'dataset', source: { kind: 'input', input: 'source' } },
        ...(includeRoi
          ? [{ port: 'roi', source: { kind: 'input' as const, input: 'selection' } }]
          : []),
      ],
      parameters,
    },
  ],
  outputs: [{ name: 'result', source: { kind: 'node', nodeId: 'operation', output: outputPort } }],
})

const isScientificDataset = (value: unknown): value is ScientificDataset =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  'readPlane' in value &&
  typeof value.readPlane === 'function'

const measuredProvider = (
  provenance: Readonly<{
    readonly provider: Readonly<Record<string, unknown>>
    readonly implementation: Readonly<Record<string, unknown>>
  }>,
): ProviderMeasurement => {
  const id = provenance.provider.id
  const version = provenance.provider.version
  const implementationVersion = provenance.implementation.implementationVersion
  assert(typeof id === 'string', 'Execution provenance omitted provider ID')
  assert(typeof version === 'number', 'Execution provenance omitted provider version')
  assert(
    typeof implementationVersion === 'string',
    'Execution provenance omitted implementation version',
  )
  return { id, version, implementationVersion }
}

const measureResultOperation = async (
  controller: ReturnType<typeof createAnalysisController>,
  dataset: ScientificDataset,
  roi: Roi,
  graph: AnalysisGraph,
): Promise<OperationMeasurement> => {
  const bindings = {
    source: { value: dataset, characteristics: scientificDatasetCharacteristics(dataset) },
    selection: { value: roi },
  }
  const run = async (): Promise<{
    readonly summary: AnalysisResultSummary
    readonly provider: ProviderMeasurement
  }> => {
    const plan = await controller.planGraph(graph, { bindings })
    const execution = await controller.executeGraph(plan).result
    try {
      const provenance = execution.provenance.nodes[0]
      if (provenance === undefined) throw new Error('Result operation omitted provenance')
      return {
        summary: summarizeResult(validateAnalysisResult(execution.outputs.get('result')), {
          maxPreviewValues: 32,
        }),
        provider: measuredProvider(provenance),
      }
    } finally {
      await execution.release()
    }
  }
  const cold = await timed(run)
  const warm = await timed(run)
  assert(cold.value.summary.kind === warm.value.summary.kind, 'Cold and warm result kinds differ')
  return {
    coldMilliseconds: cold.milliseconds,
    warmMilliseconds: warm.milliseconds,
    summary: warm.value.summary,
    provider: warm.value.provider,
  }
}

const measureDatasetOperation = async (
  controller: ReturnType<typeof createAnalysisController>,
  dataset: ScientificDataset,
  runtime: ReturnType<typeof createTileRuntime>,
  graph: AnalysisGraph,
  width: number,
  height: number,
  expected?: number,
): Promise<DatasetOutputMeasurement> => {
  const planned = await timed(() =>
    controller.planGraph(graph, {
      bindings: {
        source: { value: dataset, characteristics: scientificDatasetCharacteristics(dataset) },
      },
    }),
  )
  const execution = await controller.executeGraph(planned.value).result
  try {
    const output = execution.outputs.get('result')
    if (!isScientificDataset(output)) throw new Error('Expected a derived scientific dataset')
    const provenance = execution.provenance.nodes[0]
    if (provenance === undefined) throw new Error('Dataset operation omitted provenance')
    const request = {
      displayAxes: ['x', 'y'] as const,
      fixedIndices: [],
      x: 0,
      y: 0,
      width,
      height,
    }
    const cold = await timed(() => firstNumericTile(output, request))
    const warm = await timed(() => firstNumericTile(output, request))
    assert(cold.value === warm.value, 'Cold and warm derived-tile checksums differ')
    if (expected !== undefined) {
      const expectedChecksum = expected * width * height
      assert(
        Math.abs(warm.value - expectedChecksum) <= Math.max(1e-5, expectedChecksum * 1e-6),
        `Derived checksum ${warm.value} does not match ${expectedChecksum}`,
      )
    }
    return {
      planningMilliseconds: planned.milliseconds,
      firstTileMilliseconds: cold.milliseconds,
      warmTileMilliseconds: warm.milliseconds,
      checksum: warm.value,
      runtime: runtime.metrics(),
      provider: measuredProvider(provenance),
    }
  } finally {
    await execution.release()
  }
}

const measureWsiRange = async (): Promise<WsiRangeMeasurement> => {
  const bytes = new Uint8Array(await readFile('tests/fixtures/aperio-cmu-1-small-region.svs'))
  const fetchRange: typeof fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get('range')
    const match = range?.match(/^bytes=(\d+)-(\d+)$/u)
    if (match === undefined || match === null) return new Response(null, { status: 416 })
    const start = Number(match[1])
    const end = Math.min(Number(match[2]), bytes.byteLength - 1)
    return new Response(bytes.slice(start, end + 1), {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${bytes.byteLength}` },
    })
  }
  const opened = await timed(() =>
    HttpRangeSource.open('https://benchmark.invalid/aperio.svs', {
      blockBytes: 64 * 1_024,
      maxCacheBytes: 512 * 1_024,
      fetch: fetchRange,
    }),
  )
  const document = await timed(() => openTiffDocument(opened.value))
  const slide = await timed(() => openAperioSvs(document.value))
  const level = slide.value.levels[0]
  if (level === undefined) throw new Error('Aperio benchmark fixture has no level')
  const firstTile = await timed(async () => {
    let checksum = 0
    for await (const block of level.tile(0, 0)) {
      try {
        for (let index = 0; index < block.data.length; index += 97) {
          checksum += block.data[index] ?? 0
        }
      } finally {
        block.release?.()
      }
    }
    return checksum
  })
  assert(opened.value.stats.bytesFetched < bytes.byteLength, 'Range workflow fetched the whole SVS')
  assert(firstTile.value > 0, 'Range-backed WSI tile checksum is empty')
  return {
    sourceBytes: bytes.byteLength,
    sourceOpenMilliseconds: opened.milliseconds,
    tiffOpenMilliseconds: document.milliseconds,
    slideOpenMilliseconds: slide.milliseconds,
    firstTileMilliseconds: firstTile.milliseconds,
    checksum: firstTile.value,
    httpRange: opened.value.stats,
  }
}

const measureCacheClasses = async (): Promise<TileRuntimeMetrics> => {
  const cacheRuntime = createTileRuntime({ limits: { maxCacheBytes: 1_024 * 1_024 } })
  const source: TileSource = Object.freeze({
    descriptor: large.descriptor,
    tileKey: canonicalTileKey,
    async readTile(request: Readonly<TileRequest>) {
      const { x, y, width, height } = request.address
      const data = new Float32Array(width * height)
      data.fill(request.address.cacheClass === 'source' ? 1 : 2)
      return {
        tile: Object.freeze({
          x,
          y,
          width,
          height,
          sampleType: 'float32' as const,
          componentCount: 1,
          layout: 'interleaved' as const,
          rowStrideElements: width,
          data,
          release() {},
        }),
        accounting: { bytesRequested: data.byteLength },
      }
    },
  })
  const request = (cacheClass: 'source' | 'derived'): TileRequest => ({
    address: {
      cacheClass,
      namespace: `application-benchmark:${cacheClass}`,
      dataset: {
        datasetId: 'application-cache-classes',
        source: {
          kind: 'content',
          strength: 'strong',
          stability: 'content-addressed',
          algorithm: 'sha256',
          digest: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          size: 1_024 * 1_024 * 4,
        },
        generation: 0,
      },
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      resolutionLevel: 0,
      x: 0,
      y: 0,
      width: 128,
      height: 128,
    },
    priority: 'visible',
    signal: new AbortController().signal,
  })
  for (const cacheClass of ['source', 'derived'] as const) {
    for (let read = 0; read < 2; read += 1) {
      const tile = await cacheRuntime.request(source, request(cacheClass))
      tile.release()
    }
  }
  for (let turn = 0; turn < 10 && cacheRuntime.metrics().tasks.running !== 0; turn += 1) {
    await Promise.resolve()
  }
  const metrics = cacheRuntime.metrics()
  assert(metrics.cache.hits === 2, 'Expected one warm hit in each cache class')
  assert(metrics.cache.sourceRetainedBytes > 0, 'Expected source cache accounting')
  assert(metrics.cache.derivedRetainedBytes > 0, 'Expected derived cache accounting')
  cacheRuntime.clear()
  return metrics
}

const gsfBytes = encodeGsf({
  width: 256,
  height: 256,
  values: Array.from({ length: 256 * 256 }, (_value, index) => index % 1_024),
})
const fixedLegacyAxes = [
  { axisId: 'z', index: 0 },
  { axisId: 'channel', index: 0 },
  { axisId: 'time', index: 0 },
] as const
const documents = {
  gsf: await measureDocument(gsfReader, 'surface.gsf', gsfBytes, fixedLegacyAxes),
  mrc: await measureDocument(mrcReader, 'volume.mrc', createMrcFixture(128, 128), fixedLegacyAxes),
  cbf: await measureDocument(
    cbfReader,
    'detector.cbf',
    createCbfFixture(128, 128),
    fixedLegacyAxes,
  ),
}

const displayLibrary = createScientificLibrary({ readers: [gsfReader] })
const displayDocument = await displayLibrary.open({
  primary: { id: 'display.gsf', source: new MemorySource(gsfBytes) },
})
const displaySummary = displayDocument.datasets[0]
if (displaySummary === undefined) throw new Error('Display benchmark has no GSF dataset')
const displayDataset = await displayDocument.openDataset(displaySummary.id)
const display = await timed(async () => {
  const rendered = await renderScientificPlane(displayDataset, {
    plane: { displayAxes: ['x', 'y'], fixedIndices: fixedLegacyAxes },
    x: 0,
    y: 0,
    width: 128,
    height: 128,
    range: { mode: 'explicit', min: 0, max: 1_023 },
  })
  const iterator = rendered.pixels[Symbol.asyncIterator]()
  const first = await iterator.next()
  if (first.done) throw new Error('Display render produced no pixel block')
  let checksum = 0
  for (let index = 0; index < first.value.data.length; index += 1) {
    checksum += first.value.data[index] ?? 0
  }
  first.value.release?.()
  await iterator.return?.()
  return checksum
})
assert(display.value > 0, 'Display tile checksum is empty')
await displayDocument.close?.()

const fourDimensional = directDataset(
  { scanX: 16, scanY: 12, kx: 64, ky: 64 },
  (indices) =>
    (indices.scanX ?? 0) * 10_000 +
    (indices.scanY ?? 0) * 1_000 +
    (indices.ky ?? 0) * 64 +
    (indices.kx ?? 0),
)
const stemTile = await timed(() =>
  firstNumericTile(fourDimensional, {
    displayAxes: ['kx', 'ky'],
    fixedIndices: [
      { axisId: 'scanX', index: 3 },
      { axisId: 'scanY', index: 4 },
    ],
    width: 64,
    height: 64,
  }),
)
assert(stemTile.value > 0, '4D-STEM tile checksum is empty')

const large = directDataset({ x: 1_024, y: 1_024 }, (indices) => {
  const x = indices.x ?? 0
  const y = indices.y ?? 0
  return x * 0.25 + y * 0.5
})
const constant = directDataset({ x: 1_024, y: 1_024 }, () => 7)
const runtime = createTileRuntime({ limits: { maxCacheBytes: 32 * 1_024 * 1_024 } })
const bundle = createBuiltInAnalysisBundle({
  descriptor: large.descriptor,
  runtime,
  tileWidth: 256,
  tileHeight: 256,
  sessionId: 'application-benchmark',
})
const providerPreparation = await timed(async () => bundle.providers[0]?.prepare())
assert(providerPreparation.value !== undefined, 'Reference provider preparation failed')
const controller = createAnalysisController({
  ...bundle,
  roi: { descriptor: large.descriptor },
  library: { version: '0.9.0', buildFingerprint: 'application-benchmark' },
})
const rectangle = normalizeRoi(
  {
    schemaVersion: 1,
    id: 'measurement',
    axisIds: ['x', 'y'],
    fixedIndices: [],
    coordinateSpace: 'pixel',
    geometry: { kind: 'rectangle', x: 128, y: 128, width: 768, height: 768 },
  },
  large.descriptor,
)
const line = normalizeRoi(
  {
    schemaVersion: 1,
    id: 'profile',
    axisIds: ['x', 'y'],
    fixedIndices: [],
    coordinateSpace: 'pixel',
    geometry: { kind: 'line-segment', start: { x: 0.5, y: 0.5 }, end: { x: 999.5, y: 999.5 } },
  },
  large.descriptor,
)
const statisticsGraph = operationGraph(
  analysisStatisticsOperationId,
  'statistics',
  {
    displayAxes: ['x', 'y'],
    fixedIndices: [],
    component: 0,
    percentiles: [5, 50, 95],
    percentileMaxSamples: 4_096,
    emptyPolicy: 'error',
  },
  true,
)
const validation = timed(async () => controller.validateGraph(statisticsGraph))
const validationMeasurement = await validation
assert(validationMeasurement.value.valid, 'Benchmark statistics graph is invalid')
runtime.clear()
runtime.resetMetrics()
const statistics = await measureResultOperation(controller, large, rectangle, statisticsGraph)
runtime.clear()
runtime.resetMetrics()
const profile = await measureResultOperation(
  controller,
  large,
  line,
  operationGraph(
    analysisLineProfileOperationId,
    'profile',
    {
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      component: 0,
      components: [0],
      interpolation: 'bilinear',
      spacing: 2,
      spacingSpace: 'pixel',
      maxSamples: 2_048,
      outside: 'error',
      invalidPolicy: 'nan',
    },
    true,
  ),
)
runtime.clear()
runtime.resetMetrics()
const threshold = await measureDatasetOperation(
  controller,
  large,
  runtime,
  operationGraph(
    analysisThresholdOperationId,
    'dataset',
    { mode: 'greater-or-equal', threshold: 64, invalidOutput: 0 },
    false,
  ),
  256,
  256,
)

const blurRuntime = createTileRuntime({ limits: { maxCacheBytes: 32 * 1_024 * 1_024 } })
const blurBundle = createBuiltInAnalysisBundle({
  descriptor: constant.descriptor,
  runtime: blurRuntime,
  tileWidth: 256,
  tileHeight: 256,
  sessionId: 'application-blur-benchmark',
})
const blurController = createAnalysisController({
  ...blurBundle,
  library: { version: '0.9.0', buildFingerprint: 'application-blur-benchmark' },
})
const blurSizes: Record<string, DatasetOutputMeasurement> = {}
for (const size of [64, 128, 256]) {
  blurRuntime.clear()
  blurRuntime.resetMetrics()
  blurSizes[String(size)] = await measureDatasetOperation(
    blurController,
    constant,
    blurRuntime,
    operationGraph(
      analysisGaussianBlurOperationId,
      'dataset',
      {
        displayAxes: ['x', 'y'],
        component: 0,
        sigma: 3,
        boundary: 'clamp',
        constantValue: 0,
        invalidPolicy: 'propagate',
      },
      false,
    ),
    size,
    size,
    7,
  )
}

const rangeWsi = await measureWsiRange()
const cacheClasses = await measureCacheClasses()
const report = {
  schemaVersion: 1,
  fixtureVersion: 'application-platform-v1',
  environment: {
    node: process.version,
    platform: platform(),
    platformRelease: release(),
    arch: arch(),
    provider: {
      id: 'purejsimage.analysis.reference',
      version: 1,
      implementationVersion: '1.0.0',
    },
  },
  correctness: {
    passed: true,
    policy:
      'Every timing is admitted only after dataset, checksum, result-kind, provenance, or bounded-range validation.',
  },
  documents,
  arbitraryAxes: {
    shape: { scanX: 16, scanY: 12, kx: 64, ky: 64 },
    displayAxes: ['kx', 'ky'],
    fixedIndices: { scanX: 3, scanY: 4 },
    firstTileMilliseconds: stemTile.milliseconds,
    checksum: stemTile.value,
  },
  firstDisplayTile: {
    width: 128,
    height: 128,
    milliseconds: display.milliseconds,
    checksum: display.value,
  },
  rangeWsi,
  cacheClasses,
  controller: {
    validationMilliseconds: validationMeasurement.milliseconds,
    providerPreparationMilliseconds: providerPreparation.milliseconds,
    operationCount: controller.capabilities.operationDescriptors.length,
  },
  operations: { statistics, profile, threshold, gaussianBlurByTileSize: blurSizes },
  measurementScope: {
    timing: 'Local wall-clock measurements with one cold and one warm application invocation.',
    memory:
      'Tile runtime managed-byte metrics and planner estimates are bounded accounting, not process peak RSS.',
    coldWarm:
      'Cold includes first plan/read for the constructed controller; warm repeats the same semantic request with cache residency visible in runtime metrics.',
  },
}

const allTimes = [
  ...Object.values(documents).flatMap((entry) => [
    entry.detectionMilliseconds,
    entry.summaryMilliseconds,
    entry.firstTileMilliseconds,
  ]),
  display.milliseconds,
  stemTile.milliseconds,
  statistics.coldMilliseconds,
  statistics.warmMilliseconds,
  profile.coldMilliseconds,
  profile.warmMilliseconds,
  threshold.firstTileMilliseconds,
  threshold.warmTileMilliseconds,
  ...Object.values(blurSizes).flatMap((entry) => [
    entry.firstTileMilliseconds,
    entry.warmTileMilliseconds,
  ]),
]
assert(
  allTimes.every((value) => Number.isFinite(value) && value < 60_000),
  'Catastrophic timing gate failed',
)
assert(statistics.summary.kind === 'collection', 'Statistics benchmark returned the wrong result')
assert(profile.summary.kind === 'profile', 'Line-profile benchmark returned the wrong result')
assert(threshold.checksum > 0 && threshold.checksum < 256 * 256, 'Threshold mask is degenerate')
assert(threshold.runtime.cache.hits > 0, 'Threshold warm read did not hit the tile cache')

const markdown = `# Application platform benchmark

- Fixture: \`${report.fixtureVersion}\`
- Runtime: ${report.environment.node} on ${report.environment.platform}/${report.environment.arch}
- Provider: \`${report.environment.provider.id}@${report.environment.provider.version}\`, implementation \`${report.environment.provider.implementationVersion}\`

All measurements passed correctness gates. Times are local wall-clock samples, and runtime cache
bytes are bounded cache accounting rather than process peak memory.

| Workflow | Cold / first ms | Warm ms | Evidence |
| --- | ---: | ---: | --- |
| GSF detect + first tile | ${documents.gsf.detectionMilliseconds.toFixed(3)} | ${documents.gsf.firstTileMilliseconds.toFixed(3)} | checksum ${documents.gsf.checksum} |
| MRC detect + first tile | ${documents.mrc.detectionMilliseconds.toFixed(3)} | ${documents.mrc.firstTileMilliseconds.toFixed(3)} | checksum ${documents.mrc.checksum} |
| CBF detect + first tile | ${documents.cbf.detectionMilliseconds.toFixed(3)} | ${documents.cbf.firstTileMilliseconds.toFixed(3)} | checksum ${documents.cbf.checksum} |
| First display tile | ${display.milliseconds.toFixed(3)} | n/a | checksum ${display.value} |
| 4D-STEM diffraction tile | ${stemTile.milliseconds.toFixed(3)} | n/a | checksum ${stemTile.value} |
| ROI statistics | ${statistics.coldMilliseconds.toFixed(3)} | ${statistics.warmMilliseconds.toFixed(3)} | ${statistics.summary.kind} |
| Calibrated line profile | ${profile.coldMilliseconds.toFixed(3)} | ${profile.warmMilliseconds.toFixed(3)} | ${profile.summary.kind} |
| Threshold tile | ${threshold.firstTileMilliseconds.toFixed(3)} | ${threshold.warmTileMilliseconds.toFixed(3)} | ${threshold.runtime.cache.hits} cache hits |
| Gaussian 256 tile | ${blurSizes['256']?.firstTileMilliseconds.toFixed(3) ?? 'n/a'} | ${blurSizes['256']?.warmTileMilliseconds.toFixed(3) ?? 'n/a'} | constant-field exactness |

The range-backed Aperio workflow fetched ${String(rangeWsi.httpRange.bytesFetched)} of ${String(rangeWsi.sourceBytes)} source bytes across ${String(rangeWsi.httpRange.requests)} HTTP range requests. See the JSON companion for source/derived cache counters, Gaussian tile-size scaling, setup/planning splits, and exact fixture descriptors.
`

if (process.argv.includes('--write')) {
  await writeFile(
    'benchmark/results/application-platform.json',
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await writeFile('benchmark/results/application-platform.md', markdown)
}

console.log(JSON.stringify(report, null, 2))
runtime.clear()
blurRuntime.clear()
