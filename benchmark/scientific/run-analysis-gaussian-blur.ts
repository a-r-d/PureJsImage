import {
  analysisGaussianBlurOperationId,
  createAnalysisController,
  createBuiltInAnalysisOperationRegistry,
  createBuiltInAnalysisValueTypeRegistry,
  createReferenceAnalysisProvider,
  createTileRuntime,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
} from '../../src/analysis/index.ts'
import type { AnalysisGraph } from '../../src/analysis/index.ts'
import type {
  DirectNumericTileDataset,
  NumericTile,
  NumericTileReadRequest,
  ScientificDataset,
} from '../../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  resolveNumericTileSource,
} from '../../src/scientific/index.ts'

const width = 1_024
const height = 1_024
const tileSize = 256
const sigma = 3
const iterations = 3
const expectedValue = 7
const tolerance = 1e-5

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 2,
  axes: [
    { id: 'x', kind: 'space', length: width, coordinates: { type: 'index' } },
    { id: 'y', kind: 'space', length: height, coordinates: { type: 'index' } },
  ],
  sampleType: 'float32',
  components: [{ id: 'signal', kind: 'scalar' }],
  capabilities: { regionReads: true, resolutionLevels: false },
})

let sourceReads = 0
let sourceReleases = 0
const source: DirectNumericTileDataset = Object.freeze({
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
    async *readNumericTiles(input: Readonly<NumericTileReadRequest>): AsyncGenerator<NumericTile> {
      const { targetSampleType, ...planeRequest } = input
      const request = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
      sourceReads += 1
      request.signal?.throwIfAborted()
      const data =
        targetSampleType === 'float64'
          ? new Float64Array(request.width * request.height)
          : new Float32Array(request.width * request.height)
      data.fill(expectedValue)
      yield Object.freeze({
        x: request.x,
        y: request.y,
        width: request.width,
        height: request.height,
        sampleType: targetSampleType ?? 'float32',
        componentCount: 1,
        layout: 'interleaved' as const,
        rowStrideElements: request.width,
        data,
        release() {
          sourceReleases += 1
        },
      })
    },
  }),
  readPlane() {
    throw new Error('Gaussian benchmark expects direct native tile reads')
  },
})

const graph: AnalysisGraph = {
  schemaVersion: 1,
  inputs: [{ name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
  nodes: [
    {
      id: 'blur',
      operation: { id: analysisGaussianBlurOperationId, version: 1 },
      inputs: [{ port: 'dataset', source: { kind: 'input', input: 'source' } }],
      parameters: {
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        sigma,
        boundary: 'clamp',
        invalidPolicy: 'propagate',
      },
    },
  ],
  outputs: [{ name: 'dataset', source: { kind: 'node', nodeId: 'blur', output: 'dataset' } }],
}

const isScientificDataset = (value: unknown): value is ScientificDataset =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  'readPlane' in value &&
  typeof value.readPlane === 'function'

const runtime = createTileRuntime()
const controller = createAnalysisController({
  operations: createBuiltInAnalysisOperationRegistry(),
  valueTypes: createBuiltInAnalysisValueTypeRegistry(descriptor),
  providers: [
    createReferenceAnalysisProvider({
      runtime,
      tileWidth: tileSize,
      tileHeight: tileSize,
      sessionId: 'gaussian-benchmark',
    }),
  ],
  library: { version: '0.9.0', buildFingerprint: 'gaussian-benchmark' },
})

const plan = await controller.planGraph(graph, {
  bindings: {
    source: {
      value: source,
      identity: {
        kind: 'application-defined',
        namespace: 'purejsimage.benchmark.dataset',
        value: 'gaussian-blur',
      },
      characteristics: scientificDatasetCharacteristics(source),
    },
  },
  policy: {
    mode: 'pinned',
    providerId: 'purejsimage.analysis.reference',
    providerVersion: 1,
  },
})
const execution = await controller.executeGraph(plan).result
const output = execution.outputs.get('dataset')
if (!isScientificDataset(output)) throw new Error('Gaussian benchmark output is not a dataset')

let totalMilliseconds = 0
let checksum = 0
let maximumAbsoluteError = 0
for (let iteration = -1; iteration < iterations; iteration += 1) {
  runtime.invalidate({ cacheClass: 'source' })
  let iterationChecksum = 0
  let iterationMaximumError = 0
  const start = performance.now()
  for await (const tile of resolveNumericTileSource(output).readNumericTiles({
    displayAxes: ['x', 'y'],
    fixedIndices: [],
    signal: new AbortController().signal,
  })) {
    try {
      for (let index = 0; index < tile.data.length; index += 1) {
        const raw = tile.data[index]
        const value = typeof raw === 'bigint' ? Number(raw) : (raw ?? Number.NaN)
        iterationChecksum += value
        iterationMaximumError = Math.max(iterationMaximumError, Math.abs(value - expectedValue))
      }
    } finally {
      tile.release()
    }
  }
  const elapsed = performance.now() - start
  if (iterationMaximumError > tolerance) {
    throw new Error(`Gaussian blur correctness error ${iterationMaximumError} exceeds ${tolerance}`)
  }
  if (iteration >= 0) totalMilliseconds += elapsed
  checksum = iterationChecksum
  maximumAbsoluteError = iterationMaximumError
}

const expectedChecksum = width * height * expectedValue
if (Math.abs(checksum - expectedChecksum) > expectedChecksum * tolerance) {
  throw new Error(`Gaussian blur checksum ${checksum} does not match ${expectedChecksum}`)
}
const metrics = runtime.metrics()
const plannedRetainedBytes = plan.summary.nodes[0]?.estimate.retainedBytes
await execution.release()
runtime.clear()

console.log(
  JSON.stringify(
    {
      fixture: { width, height, tileSize, sigma, radius: Math.ceil(3 * sigma), iterations },
      correctness: {
        checksum,
        expectedChecksum,
        maximumAbsoluteError,
        tolerance: { absolute: tolerance, relative: 1e-6 },
        passed: true,
      },
      measuredMilliseconds: Number(totalMilliseconds.toFixed(3)),
      averageMilliseconds: Number((totalMilliseconds / iterations).toFixed(3)),
      sourceReads,
      sourceReleasesAfterClear: sourceReleases,
      plannerRetainedBytesEstimate:
        typeof plannedRetainedBytes === 'number' ? plannedRetainedBytes : null,
      runtime: metrics,
      note: 'Local wall-clock and bounded tile/cache accounting; not process peak memory.',
    },
    null,
    2,
  ),
)
