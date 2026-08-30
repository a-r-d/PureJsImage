import { createHash } from 'node:crypto'
import { createGeneratedFourDStemFixture } from './generated-fixture.ts'
import {
  createFourDStemAnalysisBundle,
  fourDStemOperationParameters,
  scanDiffractionReductionOperationId,
  virtualDetectorMapOperationId,
  type DetectorRoi,
  type NavigationRoi,
} from '../../src/analysis/four-d-stem.ts'
import {
  createAnalysisController,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
  type AnalysisGraph,
} from '../../src/analysis/index.ts'
import { createTileRuntime } from '../../src/analysis/runtime.ts'
import { createEvidenceSession, instrumentImageSource } from '../../src/evidence.ts'
import type {
  ScientificDataset,
  ScientificDocument,
  ScientificResource,
} from '../../src/scientific/index.ts'
import { ScientificReaderRegistry } from '../../src/scientific/index.ts'
import { mibReader } from '../../src/scientific/readers/mib.ts'
import { MemorySource, type ImageSource, type ImageSourceReadOptions } from '../../src/source.ts'

interface SourceRead {
  readonly offset: number
  readonly length: number
}

class SimulatedRangeSource implements ImageSource {
  readonly #source: MemorySource
  readonly reads: SourceRead[] = []

  constructor(bytes: Uint8Array) {
    this.#source = new MemorySource(bytes)
  }

  get size(): number {
    return this.#source.size
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    const data = await this.#source.read(offset, length, options)
    this.reads.push(Object.freeze({ offset, length: data.byteLength }))
    return data
  }
}

const roles = Object.freeze({
  navigationX: 'scanX',
  navigationY: 'scanY',
  detectorX: 'kx',
  detectorY: 'ky',
})

const isDataset = (value: unknown): value is ScientificDataset =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  'readPlane' in value &&
  typeof value.readPlane === 'function'

const readSummary = (
  reads: readonly SourceRead[],
): Readonly<{
  count: number
  requestedBytes: number
  uniqueBytes: number
  largestReadBytes: number
}> => {
  const ranges = [...reads]
    .filter((read) => read.length > 0)
    .map((read) => [read.offset, read.offset + read.length] as const)
    .sort((left, right) => left[0] - right[0])
  let uniqueBytes = 0
  let start = ranges[0]?.[0] ?? 0
  let end = ranges[0]?.[1] ?? 0
  for (const range of ranges.slice(1)) {
    if (range[0] <= end) {
      end = Math.max(end, range[1])
    } else {
      uniqueBytes += end - start
      ;[start, end] = range
    }
  }
  uniqueBytes += end - start
  return Object.freeze({
    count: reads.length,
    requestedBytes: reads.reduce((total, read) => total + read.length, 0),
    uniqueBytes,
    largestReadBytes: Math.max(0, ...reads.map((read) => read.length)),
  })
}

const graph = (operationId: string, roi: DetectorRoi | NavigationRoi): AnalysisGraph => ({
  schemaVersion: 1,
  inputs: [{ name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
  nodes: [
    {
      id: 'reduction',
      operation: { id: operationId, version: 1 },
      inputs: [{ port: 'dataset', source: { kind: 'input', input: 'source' } }],
      parameters: fourDStemOperationParameters({ roles, roi, reduction: 'sum' }),
    },
  ],
  outputs: [{ name: 'dataset', source: { kind: 'node', nodeId: 'reduction', output: 'dataset' } }],
})

const consume = async (
  dataset: ScientificDataset,
  displayAxes: readonly [string, string],
  viewport: Readonly<{
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }>,
  fixedIndices: readonly { readonly axisId: string; readonly index: number }[] = [],
): Promise<string> => {
  const hash = createHash('sha256')
  for await (const block of dataset.readPlane({ displayAxes, fixedIndices, ...viewport })) {
    try {
      hash.update(block.data)
    } finally {
      block.release?.()
    }
  }
  return hash.digest('hex')
}

const execute = async (
  document: ScientificDocument,
  source: SimulatedRangeSource,
  operationId: string,
  roi: DetectorRoi | NavigationRoi,
  displayAxes: readonly [string, string],
  viewport: Readonly<{
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }>,
) => {
  const dataset = await document.openDataset('diffraction')
  const evidence = createEvidenceSession({ mode: 'trace' })
  const runtime = createTileRuntime({ evidence: evidence.context, metrics: true })
  const bundle = createFourDStemAnalysisBundle({
    runtime,
    tileWidth: viewport.width,
    tileHeight: viewport.height,
    sessionId: `four-d-stem-benchmark-${operationId}`,
  })
  const controller = createAnalysisController({
    ...bundle,
    library: { version: '0.17.0', buildFingerprint: 'four-d-stem-benchmark-v1' },
  })
  const before = source.reads.length
  const started = performance.now()
  const plan = await controller.planGraph(graph(operationId, roi), {
    bindings: {
      source: { value: dataset, characteristics: scientificDatasetCharacteristics(dataset) },
    },
    policy: {
      mode: 'pinned',
      providerId: 'purejsimage.analysis.four-d-stem.reference',
      providerVersion: 1,
    },
  })
  const execution = await controller.executeGraph(plan).result
  const output = execution.outputs.get('dataset')
  if (!isDataset(output)) throw new Error('4D-STEM benchmark did not receive a dataset')
  const outputHash = await consume(output, displayAxes, viewport)
  const coldWallMilliseconds = performance.now() - started
  const warmBefore = source.reads.length
  const warmStarted = performance.now()
  const warmOutputHash = await consume(output, displayAxes, viewport)
  const warmWallMilliseconds = performance.now() - warmStarted
  if (warmOutputHash !== outputHash) throw new Error('Warm 4D-STEM result changed output bytes')
  const metrics = runtime.metrics()
  await execution.release()
  await runtime.clear()
  const report = evidence.finalize()
  return Object.freeze({
    wallMilliseconds: Number(coldWallMilliseconds.toFixed(3)),
    outputHash,
    source: readSummary(source.reads.slice(before, warmBefore)),
    warmRepeat: Object.freeze({
      wallMilliseconds: Number(warmWallMilliseconds.toFixed(3)),
      outputHash: warmOutputHash,
      source: readSummary(source.reads.slice(warmBefore)),
      cacheHits: metrics.cache.hits,
      cacheMisses: metrics.cache.misses,
    }),
    peakManagedBytes: report.managedMemory.peakLiveBytes,
    retainedCacheBytes: report.managedMemory.retainedCacheBytes,
  })
}

const fixture = createGeneratedFourDStemFixture()
const primarySource = new SimulatedRangeSource(fixture.mib)
const hdrSource = new SimulatedRangeSource(fixture.hdr)
const evidence = createEvidenceSession({ mode: 'summary' })
const primary: ScientificResource = Object.freeze({
  id: 'mib',
  name: 'generated-4d-stem.mib',
  source: instrumentImageSource(primarySource, evidence.context.child('mib')),
})
const hdr: ScientificResource = Object.freeze({
  id: 'hdr',
  name: 'generated-4d-stem.hdr',
  source: instrumentImageSource(hdrSource, evidence.context.child('hdr')),
})
const openStarted = performance.now()
const document = await new ScientificReaderRegistry([mibReader]).open({
  primary,
  companions: {
    async resolve() {
      return hdr
    },
  },
  readerId: mibReader.descriptor.id,
  evidence: evidence.context.child('reader'),
})
const openedDataset = await document.openDataset('diffraction')
const opening = Object.freeze({
  milliseconds: Number((performance.now() - openStarted).toFixed(3)),
  reader: `${document.reader.id}@${document.reader.version}`,
  axes: openedDataset.descriptor.axes.map(({ id, length }) => Object.freeze({ id, length })),
  source: readSummary(primarySource.reads),
})
const cursorBefore = primarySource.reads.length
const cursorStarted = performance.now()
const cursorHash = await consume(openedDataset, ['kx', 'ky'], { x: 5, y: 4, width: 4, height: 3 }, [
  { axisId: 'scanX', index: 3 },
  { axisId: 'scanY', index: 2 },
])
const cursor = Object.freeze({
  wallMilliseconds: Number((performance.now() - cursorStarted).toFixed(3)),
  outputHash: cursorHash,
  source: readSummary(primarySource.reads.slice(cursorBefore)),
})
const virtualDetector = await execute(
  document,
  primarySource,
  virtualDetectorMapOperationId,
  { kind: 'annulus', x: 8.5, y: 7.5, innerRadius: 3.5, outerRadius: 6 },
  ['scanX', 'scanY'],
  { x: 0, y: 0, width: 3, height: 2 },
)
const scanReduction = await execute(
  document,
  primarySource,
  scanDiffractionReductionOperationId,
  { kind: 'rectangle', x: 1, y: 1, width: 3, height: 2 },
  ['kx', 'ky'],
  { x: 5, y: 4, width: 4, height: 3 },
)
await document.close?.()
evidence.finalize()

if (virtualDetector.source.uniqueBytes >= fixture.mib.byteLength) {
  throw new Error('Bounded virtual detector viewport read the complete 4D source')
}
if (
  virtualDetector.source.largestReadBytes >=
  fixture.manifest.detectorShape[0] * fixture.manifest.detectorShape[1] * 2
) {
  throw new Error('Small detector ROI used a complete detector-frame read')
}
if (cursor.source.uniqueBytes >= fixture.mib.byteLength) {
  throw new Error('Cursor viewport read the complete 4D source')
}

process.stdout.write(
  `${JSON.stringify(
    {
      schemaVersion: 1,
      fixture: fixture.manifest,
      opening,
      cursor,
      virtualDetector,
      scanReduction,
      invariant: {
        request: '3 x 2 navigation tile with annular detector ROI',
        sourceReadFormula:
          'open metadata reads + bounded detector bounding-box row spans per requested scan position',
        completeSourceRead: false,
      },
    },
    null,
    2,
  )}\n`,
)
