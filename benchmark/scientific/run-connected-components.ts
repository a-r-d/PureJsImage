import {
  analysisConnectedComponentsOperationId,
  createAnalysisController,
  createBuiltInAnalysisBundle,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
  type AnalysisGraph,
} from '../../src/analysis/index.ts'
import { validateTableResult } from '../../src/analysis/results.ts'
import { createTileRuntime } from '../../src/analysis/runtime.ts'
import type {
  DirectNumericTileDataset,
  NumericTile,
  NumericTileReadRequest,
} from '../../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from '../../src/scientific/index.ts'

const width = 256
const height = 256
const tileSize = 64

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 1,
  axes: [
    { id: 'x', kind: 'space', length: width, coordinates: { type: 'index' } },
    { id: 'y', kind: 'space', length: height, coordinates: { type: 'index' } },
  ],
  sampleType: 'uint8',
  components: [{ id: 'mask', kind: 'scalar' }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
  },
})

const dataset = (mask: Uint8Array): DirectNumericTileDataset =>
  Object.freeze({
    descriptor,
    numericTileSource: Object.freeze({
      descriptor,
      directSemantics: Object.freeze({
        sourceSampleType: 'uint8' as const,
        nativeSampleType: 'uint8' as const,
        componentCount: 1,
        layout: 'interleaved' as const,
        supportedTargetSampleTypes: ['uint8'] as const,
      }),
      async *readNumericTiles(
        input: Readonly<NumericTileReadRequest>,
      ): AsyncGenerator<NumericTile> {
        const { targetSampleType: _targetSampleType, ...planeRequest } = input
        const request = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
        const data = new Uint8Array(request.width * request.height)
        for (let y = 0; y < request.height; y += 1) {
          data.set(
            mask.subarray(
              (request.y + y) * width + request.x,
              (request.y + y) * width + request.x + request.width,
            ),
            y * request.width,
          )
        }
        yield Object.freeze({
          x: request.x,
          y: request.y,
          width: request.width,
          height: request.height,
          sampleType: 'uint8' as const,
          componentCount: 1,
          layout: 'interleaved' as const,
          rowStrideElements: request.width,
          data,
          release() {},
        })
      },
    }),
    readPlane() {
      throw new Error('Connected-components benchmark expects native tiles')
    },
  })

const graph: AnalysisGraph = Object.freeze({
  schemaVersion: 1,
  inputs: Object.freeze([
    Object.freeze({
      name: 'source',
      valueType: { id: scientificDatasetValueTypeId, version: 1 },
    }),
  ]),
  nodes: Object.freeze([
    Object.freeze({
      id: 'components',
      operation: { id: analysisConnectedComponentsOperationId, version: 1 },
      inputs: Object.freeze([
        Object.freeze({ port: 'dataset', source: { kind: 'input' as const, input: 'source' } }),
      ]),
      parameters: Object.freeze({
        displayAxes: ['x', 'y'],
        fixedIndices: [],
        component: 0,
        connectivity: 4,
      }),
    }),
  ]),
  outputs: Object.freeze([
    Object.freeze({
      name: 'objects',
      source: { kind: 'node' as const, nodeId: 'components', output: 'objects' },
    }),
  ]),
})

interface Fixture {
  readonly name: string
  readonly mask: Uint8Array
  readonly expectedObjects: number
}

const fixtures = (): readonly Fixture[] => {
  const sparse = new Uint8Array(width * height)
  sparse[1 * width + 1] = 1
  sparse[64 * width + 64] = 1
  sparse[height * width - 2] = 1
  const dense = new Uint8Array(width * height)
  dense.fill(1)
  const boundary = new Uint8Array(width * height)
  for (let x = 0; x < width; x += 1) boundary[127 * width + x] = 1
  for (let y = 0; y < height; y += 1) boundary[y * width + 127] = 1
  const checkerboard = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) checkerboard[y * width + x] = (x + y) % 2
  }
  return Object.freeze([
    { name: 'sparse', mask: sparse, expectedObjects: 3 },
    { name: 'dense', mask: dense, expectedObjects: 1 },
    { name: 'boundary-spanning', mask: boundary, expectedObjects: 1 },
    { name: 'checkerboard-adversarial', mask: checkerboard, expectedObjects: (width * height) / 2 },
  ])
}

const results: unknown[] = []
for (const fixture of fixtures()) {
  const source = dataset(fixture.mask)
  const runtime = createTileRuntime({
    limits: {
      maxOperationWorkingBytes: 64 * 1_024 * 1_024,
      maxTotalManagedBytes: 96 * 1_024 * 1_024,
      maxConcurrency: 1,
    },
  })
  const bundle = createBuiltInAnalysisBundle({
    descriptor,
    runtime,
    tileWidth: tileSize,
    tileHeight: tileSize,
    sessionId: `connected-components-benchmark-${fixture.name}`,
  })
  const controller = createAnalysisController({
    ...bundle,
    library: { version: '0.9.0', buildFingerprint: 'connected-components-benchmark-v1' },
  })
  const plan = await controller.planGraph(graph, {
    bindings: {
      source: {
        value: source,
        identity: {
          kind: 'application-defined',
          namespace: 'purejsimage.benchmark.connected-components',
          value: fixture.name,
        },
        characteristics: scientificDatasetCharacteristics(source),
      },
    },
  })
  const start = performance.now()
  const execution = await controller.executeGraph(plan).result
  const elapsedMilliseconds = performance.now() - start
  const objects = validateTableResult(execution.outputs.get('objects'))
  if (objects.rowCount !== fixture.expectedObjects) {
    throw new Error(
      `${fixture.name} produced ${objects.rowCount} objects; expected ${fixture.expectedObjects}`,
    )
  }
  results.push(
    Object.freeze({
      fixture: fixture.name,
      foregroundPixels: fixture.mask.reduce((sum, value) => sum + value, 0),
      objectCount: objects.rowCount,
      elapsedMilliseconds: Number(elapsedMilliseconds.toFixed(3)),
      memory: runtime.metrics().memory,
      correctness: 'passed',
    }),
  )
  await execution.release()
  await plan.dispose()
  runtime.clear()
  await runtime.dispose()
}

console.log(
  JSON.stringify(
    {
      fixture: { width, height, tileSize, connectivity: 4 },
      results,
      note: 'Correctness is validated before timing and managed-memory results are reported.',
    },
    null,
    2,
  ),
)
