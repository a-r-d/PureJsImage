import { createDerivedTileSource } from '../../src/analysis/tile-source.ts'
import { canonicalTileKey, createTileRuntime } from '../../src/analysis/tile-runtime.ts'
import type { TileAddress, TileRequest, TileSource } from '../../src/analysis/tile-runtime.ts'
import type {
  OperationImplementation,
  OperationJsonObject,
  OperationExecutionRequest,
  OperationProviderSelection,
  PreparedOperationProvider,
} from '../../src/operations/index.ts'
import { createOperationDefinition } from '../../src/operations/index.ts'
import type { NumericTile } from '../../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  numericTileSampleOffset,
} from '../../src/scientific/index.ts'

const planeWidth = 1_024
const planeHeight = 1_024
const tileSize = 256
const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 1,
  axes: [
    { id: 'x', kind: 'space', length: planeWidth, coordinates: { type: 'index' } },
    { id: 'y', kind: 'space', length: planeHeight, coordinates: { type: 'index' } },
  ],
  sampleType: 'float32',
  components: [{ id: 'value', kind: 'scalar' }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' },
  },
})

const dataset = Object.freeze({
  semantic: Object.freeze({
    kind: 'scientific-dataset' as const,
    reader: Object.freeze({ id: 'benchmark.reader', version: '1' }),
    datasetId: 'tile-runtime-benchmark',
    resources: Object.freeze([
      Object.freeze({
        id: 'primary',
        identity: Object.freeze({
          kind: 'content' as const,
          strength: 'strong' as const,
          stability: 'content-addressed' as const,
          algorithm: 'sha256' as const,
          digest: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          size: planeWidth * planeHeight * 4,
        }),
      }),
    ]),
  }),
  generation: 0,
})

const tileAddress = (
  cacheClass: 'source' | 'derived',
  namespace: string,
  x: number,
  y: number,
): TileAddress => ({
  cacheClass,
  namespace,
  dataset,
  displayAxes: ['x', 'y'],
  fixedIndices: [],
  resolutionLevel: 0,
  x,
  y,
  width: tileSize,
  height: tileSize,
})

const tileRequest = (
  cacheClass: 'source' | 'derived',
  namespace: string,
  x: number,
  y: number,
): TileRequest => ({
  address: tileAddress(cacheClass, namespace, x, y),
  priority: 'visible',
  signal: new AbortController().signal,
  target: { sampleType: 'float32', layout: 'interleaved' },
})

const valueAt = (x: number, y: number): number => x * 0.25 + y * 0.5

const source: TileSource = {
  descriptor,
  tileKey: canonicalTileKey,
  estimate: (request) => ({
    outputRetainedBytes: request.address.width * request.address.height * 4,
    peakWorkingBytes: request.address.width * request.address.height * 4,
    retainedAuxiliaryBytes: 0,
  }),
  async readTile(request) {
    const region = request.address
    const data = new Float32Array(region.width * region.height)
    for (let y = 0; y < region.height; y += 1) {
      const globalY = region.y + y
      for (let x = 0; x < region.width; x += 1) {
        data[y * region.width + x] = valueAt(region.x + x, globalY)
      }
    }
    return {
      tile: Object.freeze({
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        sampleType: 'float32',
        componentCount: 1,
        layout: 'interleaved',
        rowStrideElements: region.width,
        data,
        release: () => undefined,
      }),
      accounting: { decodedInputBytes: data.byteLength },
    }
  },
}

const operation = createOperationDefinition({
  descriptor: {
    id: 'benchmark.mean-three-by-three',
    version: 1,
    title: 'Benchmark 3x3 mean',
    category: 'benchmark',
    tags: [],
    inputs: [{ name: 'source', valueType: { id: 'benchmark.numeric-tile', version: 1 } }],
    outputs: [{ name: 'result', valueType: { id: 'benchmark.numeric-tile', version: 1 } }],
    parameters: { type: 'object', properties: {}, closed: true },
    execution: 'neighborhood',
    reproducibility: { class: 'backend-stable' },
  },
})

const isJsonValue = (value: unknown): boolean => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value).every(isJsonValue)
}

const isJsonObject = (value: unknown): value is OperationJsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && isJsonValue(value)

const jsonObject = (value: unknown, label: string): OperationJsonObject => {
  if (!isJsonObject(value)) throw new Error(`${label} is not a JSON object`)
  return value
}

const numberField = (record: OperationJsonObject, field: string): number => {
  const value = record[field]
  if (typeof value !== 'number') throw new Error(`${field} is not numeric`)
  return value
}

const numericTile = (value: unknown): NumericTile => {
  if (
    value === null ||
    typeof value !== 'object' ||
    !('data' in value) ||
    !(value.data instanceof Float32Array) ||
    !('x' in value) ||
    typeof value.x !== 'number' ||
    !('y' in value) ||
    typeof value.y !== 'number' ||
    !('width' in value) ||
    typeof value.width !== 'number' ||
    !('height' in value) ||
    typeof value.height !== 'number' ||
    !('sampleType' in value) ||
    value.sampleType !== 'float32' ||
    !('componentCount' in value) ||
    value.componentCount !== 1 ||
    !('layout' in value) ||
    value.layout !== 'interleaved' ||
    !('rowStrideElements' in value) ||
    typeof value.rowStrideElements !== 'number' ||
    !('release' in value) ||
    typeof value.release !== 'function'
  ) {
    throw new Error('Provider input is not the expected NumericTile')
  }
  const release = value.release
  return Object.freeze({
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    sampleType: value.sampleType,
    componentCount: value.componentCount,
    layout: value.layout,
    rowStrideElements: value.rowStrideElements,
    data: value.data,
    release(): void {
      release()
    },
  })
}

const implementation: OperationImplementation = Object.freeze({
  descriptor: Object.freeze({
    operationId: operation.descriptor.id,
    operationVersion: operation.descriptor.version,
    implementationVersion: '1.0.0',
  }),
  supportsPlan: () => true,
  estimatePlan: () => ({
    setupMilliseconds: 0,
    transferMilliseconds: 0,
    computeMilliseconds: 0,
    readbackMilliseconds: 0,
    retainedBytes: tileSize * tileSize * 4,
    peakWorkingBytes: tileSize * tileSize * 8,
    transferBytes: tileSize * tileSize * 4,
    outputBytes: tileSize * tileSize * 4,
    confidence: 1,
  }),
  async execute(request: Readonly<OperationExecutionRequest>) {
    const input = numericTile(request.inputs[0])
    const context = jsonObject(request.plannedInputCharacteristics[0], 'inputCharacteristics')
    const requested = jsonObject(context.requested, 'requested')
    const outputAddress = jsonObject(requested.address, 'requested.address')
    const xStart = numberField(outputAddress, 'x')
    const yStart = numberField(outputAddress, 'y')
    const width = numberField(outputAddress, 'width')
    const height = numberField(outputAddress, 'height')
    const data = new Float32Array(width * height)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const globalX = xStart + x
        const globalY = yStart + y
        let sum = 0
        let count = 0
        for (
          let sampleY = Math.max(0, globalY - 1);
          sampleY <= Math.min(planeHeight - 1, globalY + 1);
          sampleY += 1
        ) {
          for (
            let sampleX = Math.max(0, globalX - 1);
            sampleX <= Math.min(planeWidth - 1, globalX + 1);
            sampleX += 1
          ) {
            sum += Number(
              input.data[numericTileSampleOffset(input, sampleX - input.x, sampleY - input.y, 0)],
            )
            count += 1
          }
        }
        data[y * width + x] = sum / count
      }
    }
    return Object.freeze([
      Object.freeze({
        value: Object.freeze({
          x: xStart,
          y: yStart,
          width,
          height,
          sampleType: 'float32',
          componentCount: 1,
          layout: 'interleaved',
          rowStrideElements: width,
          data,
          release: () => undefined,
        } satisfies NumericTile),
        release: () => undefined,
      }),
    ])
  },
})

const prepared: PreparedOperationProvider = Object.freeze({
  descriptor: Object.freeze({
    id: 'benchmark.reference',
    version: 1,
    kind: 'reference',
    buildFingerprint: 'benchmark-reference-1',
  }),
  implementations: Object.freeze([implementation]),
})
const selection: OperationProviderSelection = Object.freeze({
  provider: prepared,
  implementation,
  estimate: implementation.estimatePlan({
    descriptor: operation.descriptor,
    parameters: {},
    inputCharacteristics: [],
    signal: new AbortController().signal,
  }),
})

const runtime = createTileRuntime({ limits: { maxCacheBytes: 16 * 1_024 * 1_024 } })
const derived = createDerivedTileSource({
  runtime,
  source,
  sourceIdentity: dataset,
  descriptor,
  operation,
  selection,
  parameters: {},
  nodeSemanticHash: 'benchmark-node-1',
  executionFingerprint: 'benchmark-execution-1',
  sourceNamespace: 'benchmark:source',
  halo: () => ({ left: 1, right: 1, top: 1, bottom: 1 }),
})

const measure = async (
  sourceToRead: TileSource,
  request: TileRequest,
): Promise<{ readonly milliseconds: number; readonly tile: NumericTile }> => {
  const started = performance.now()
  const tile = await runtime.request(sourceToRead, request)
  return { milliseconds: performance.now() - started, tile }
}

const verifySource = (tile: NumericTile): void => {
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const actual = Number(tile.data[numericTileSampleOffset(tile, x, y, 0)])
      const expected = valueAt(tile.x + x, tile.y + y)
      if (actual !== expected)
        throw new Error(`Source tile mismatch at ${tile.x + x},${tile.y + y}`)
    }
  }
}

const verifyDerived = (tile: NumericTile): void => {
  for (let y = 0; y < tile.height; y += 1) {
    for (let x = 0; x < tile.width; x += 1) {
      const globalX = tile.x + x
      const globalY = tile.y + y
      let expected = 0
      let count = 0
      for (
        let sampleY = Math.max(0, globalY - 1);
        sampleY <= Math.min(planeHeight - 1, globalY + 1);
        sampleY += 1
      ) {
        for (
          let sampleX = Math.max(0, globalX - 1);
          sampleX <= Math.min(planeWidth - 1, globalX + 1);
          sampleX += 1
        ) {
          expected += valueAt(sampleX, sampleY)
          count += 1
        }
      }
      const actual = Number(tile.data[numericTileSampleOffset(tile, x, y, 0)])
      if (Math.abs(actual - expected / count) > 1e-6) {
        throw new Error(`Derived tile mismatch at ${globalX},${globalY}`)
      }
    }
  }
}

const first = await measure(source, tileRequest('source', 'benchmark:source', 0, 0))
verifySource(first.tile)
first.tile.release()
const cached = await measure(source, tileRequest('source', 'benchmark:source', 0, 0))
verifySource(cached.tile)
cached.tile.release()
const neighbor = await measure(source, tileRequest('source', 'benchmark:source', tileSize, 0))
verifySource(neighbor.tile)
neighbor.tile.release()
const halo = await measure(derived, tileRequest('derived', 'benchmark:derived', 0, 0))
verifyDerived(halo.tile)
halo.tile.release()
await new Promise((resolve) => setTimeout(resolve, 0))

console.log(
  JSON.stringify(
    {
      fixture: { planeWidth, planeHeight, tileSize, sampleType: 'float32' },
      correctness: { source: true, cached: true, neighbor: true, haloDerived: true },
      milliseconds: {
        uncachedFirstTile: Number(first.milliseconds.toFixed(3)),
        cachedRepeatTile: Number(cached.milliseconds.toFixed(3)),
        neighboringTile: Number(neighbor.milliseconds.toFixed(3)),
        haloDerivedTile: Number(halo.milliseconds.toFixed(3)),
      },
      metrics: runtime.metrics(),
      memoryNote:
        'Cache byte accounting is reported; this fixture does not claim process peak memory.',
    },
    null,
    2,
  ),
)
runtime.clear()
