import { MemorySource } from 'purejsimage'
import {
  analysisStatisticsOperationId,
  createAnalysisController,
  createBuiltInAnalysisBundle,
  createTileRuntime,
  getImageSourceIdentity,
  normalizeRoi,
  roiValueTypeId,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
  summarizeResult,
  validateAnalysisResult,
} from 'purejsimage/analysis'
import type { AnalysisGraph } from 'purejsimage/analysis'
import {
  createScientificLibrary,
  encodeGsf,
  gsfReader,
  resolveNumericTileSource,
} from 'purejsimage/scientific'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const source = new MemorySource(
  encodeGsf({
    width: 4,
    height: 4,
    values: [0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33],
  }),
)
const library = createScientificLibrary({ readers: [gsfReader] })
const document = await library.open({ primary: { id: 'surface.gsf', source } })
assert(document.reader.id === 'purejsimage/gsf', 'Expected the installed GSF reader')
assert(document.datasets.length === 1, 'Expected one dataset summary without sample reads')
const summary = document.datasets[0]
assert(summary !== undefined, 'Expected a dataset summary')
const dataset = await document.openDataset(summary.id)
const fixedIndices = Object.freeze([
  Object.freeze({ axisId: 'z', index: 0 }),
  Object.freeze({ axisId: 'channel', index: 0 }),
  Object.freeze({ axisId: 'time', index: 0 }),
])

const numericSource = resolveNumericTileSource(dataset)
const tiles = numericSource
  .readNumericTiles({
    displayAxes: ['x', 'y'],
    fixedIndices,
    x: 1,
    y: 1,
    width: 2,
    height: 2,
  })
  [Symbol.asyncIterator]()
const firstTile = await tiles.next()
assert(!firstTile.done, 'Expected a numeric tile')
assert(firstTile.value.data[0] === 11, 'Expected numeric tile values from the packed reader')
firstTile.value.release()
await tiles.return?.()

const runtime = createTileRuntime({ limits: { maxCacheBytes: 4_096 } })
const bundle = createBuiltInAnalysisBundle({
  descriptor: dataset.descriptor,
  runtime,
  tileWidth: 2,
  tileHeight: 2,
  sessionId: 'packed-consumer',
})
const controller = createAnalysisController({
  ...bundle,
  roi: { descriptor: dataset.descriptor },
  library: { version: '0.9.0', buildFingerprint: 'packed-consumer' },
})
const roi = normalizeRoi(
  {
    schemaVersion: 1,
    id: 'selection',
    axisIds: ['x', 'y'],
    fixedIndices,
    coordinateSpace: 'pixel',
    geometry: { kind: 'rectangle', x: 0, y: 0, width: 4, height: 4 },
  },
  dataset.descriptor,
)
const graph: AnalysisGraph = {
  schemaVersion: 1,
  inputs: [
    { name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
    { name: 'selection', valueType: { id: roiValueTypeId, version: 1 } },
  ],
  nodes: [
    {
      id: 'statistics',
      operation: { id: analysisStatisticsOperationId, version: 1 },
      inputs: [
        { port: 'dataset', source: { kind: 'input', input: 'source' } },
        { port: 'roi', source: { kind: 'input', input: 'selection' } },
      ],
      parameters: {
        displayAxes: ['x', 'y'],
        fixedIndices,
        component: 0,
        percentiles: [50],
        percentileMaxSamples: 64,
        emptyPolicy: 'error',
      },
    },
  ],
  outputs: [
    {
      name: 'statistics',
      source: { kind: 'node', nodeId: 'statistics', output: 'statistics' },
    },
  ],
}
const validation = controller.validateGraph(graph)
assert(validation.valid, `Expected valid graph: ${JSON.stringify(validation.issues)}`)
const bindings = {
  source: {
    value: dataset,
    characteristics: scientificDatasetCharacteristics(dataset),
    identity: await getImageSourceIdentity(source),
  },
  selection: { value: roi },
}
const plan = await controller.planGraph(graph, {
  bindings,
  policy: {
    mode: 'pinned',
    providerId: 'purejsimage.analysis.reference',
    providerVersion: 1,
  },
})
const execution = await controller.executeGraph(plan).result
const result = validateAnalysisResult(execution.outputs.get('statistics'))
const resultSummary = summarizeResult(result, { maxPreviewValues: 16 })
assert(resultSummary.kind === 'collection', 'Expected a bounded statistics result summary')
assert(execution.provenance.nodes.length === 1, 'Expected one provenance node')
assert(
  execution.provenance.nodes[0]?.provider.id === 'purejsimage.analysis.reference',
  'Expected reference-provider provenance',
)
assert(execution.provenance.inputs.length === 2, 'Expected identity provenance for every binding')
assert(runtime.metrics().cache.misses > 0, 'Expected the operation to use the tile runtime')
await execution.release()
runtime.clear()
await document.close?.()

console.log(
  JSON.stringify({
    reader: document.reader.id,
    dataset: summary.id,
    result: resultSummary.kind,
    provider: execution.provenance.nodes[0]?.provider.id,
  }),
)
