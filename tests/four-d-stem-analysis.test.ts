import { describe, expect, it } from 'vitest'
import { createGeneratedFourDStemFixture } from '../benchmark/four-d-stem/generated-fixture.ts'
import {
  createFourDStemAnalysisBundle,
  fourDStemOperationParameters,
  inferFourDStemAxisRoles,
  scanDiffractionReductionOperationId,
  validateFourDStemAxisRoles,
  virtualDetectorMapOperationId,
  type DetectorRoi,
  type FourDStemAxisRoles,
  type NavigationRoi,
} from '../src/analysis/four-d-stem.ts'
import { createAnalysisController } from '../src/analysis/index.ts'
import type { AnalysisGraph } from '../src/analysis/index.ts'
import {
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
} from '../src/analysis/index.ts'
import { createTileRuntime } from '../src/analysis/runtime.ts'
import type {
  DirectNumericTileDataset,
  NumericTile,
  NumericTileReadRequest,
  ScientificDataset,
  ScientificResource,
} from '../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from '../src/scientific/index.ts'
import { MemorySource } from '../src/source.ts'
import { readRasterSample, validateRasterBlock } from '../src/scientific/samples.ts'
import { mibReader } from '../src/scientific/readers/mib.ts'

const roles: FourDStemAxisRoles = Object.freeze({
  navigationX: 'scanX',
  navigationY: 'scanY',
  detectorX: 'kx',
  detectorY: 'ky',
})

const fixtureDataset = async (): Promise<ScientificDataset> => {
  const fixture = createGeneratedFourDStemFixture()
  const hdr: ScientificResource = Object.freeze({
    id: 'hdr',
    name: 'synthetic.hdr',
    source: new MemorySource(fixture.hdr),
  })
  const document = await mibReader.open({
    primary: {
      id: 'mib',
      name: 'synthetic.mib',
      source: new MemorySource(fixture.mib),
    },
    companions: {
      async resolve(request) {
        return request.kind === 'relative-name' && request.name === 'synthetic.hdr'
          ? hdr
          : undefined
      },
    },
  })
  return document.openDataset('diffraction')
}

const uint64Dataset = (samples: readonly bigint[]): DirectNumericTileDataset => {
  const descriptor = normalizeScientificDatasetDescriptor({
    schemaVersion: 1,
    axes: [
      {
        id: 'kx',
        kind: 'reciprocal-space',
        length: samples.length,
        coordinates: { type: 'index' },
      },
      { id: 'ky', kind: 'reciprocal-space', length: 1, coordinates: { type: 'index' } },
      { id: 'scanX', kind: 'space', length: 1, coordinates: { type: 'index' } },
      { id: 'scanY', kind: 'space', length: 1, coordinates: { type: 'index' } },
    ],
    sampleType: 'uint64',
    components: [{ id: 'intensity', kind: 'intensity', unit: 'counts' }],
    capabilities: {
      regionReads: true,
      resolutionLevels: false,
      planeReads: { kind: 'ordered-axis-pairs', pairs: [['kx', 'ky']] },
    },
  })
  const numericTileSource = Object.freeze({
    descriptor,
    directSemantics: Object.freeze({
      sourceSampleType: 'uint64' as const,
      nativeSampleType: 'uint64' as const,
      componentCount: 1,
      layout: 'interleaved' as const,
      supportedTargetSampleTypes: Object.freeze(['uint64'] as const),
    }),
    async *readNumericTiles(
      request: Readonly<NumericTileReadRequest>,
    ): AsyncGenerator<NumericTile> {
      const normalized = normalizeScientificPlaneReadRequest(descriptor, request)
      const data = new BigUint64Array(normalized.width * normalized.height)
      for (let y = 0; y < normalized.height; y += 1) {
        for (let x = 0; x < normalized.width; x += 1) {
          data[y * normalized.width + x] = samples[normalized.x + x] ?? 0n
        }
      }
      yield Object.freeze({
        x: normalized.x,
        y: normalized.y,
        width: normalized.width,
        height: normalized.height,
        sampleType: 'uint64' as const,
        componentCount: 1,
        layout: 'interleaved' as const,
        rowStrideElements: normalized.width,
        data,
        release() {},
      })
    },
  })
  return Object.freeze({
    descriptor,
    numericTileSource,
    readPlane() {
      throw new Error('The direct uint64 test dataset should use numeric tiles')
    },
  })
}

const isDataset = (value: unknown): value is ScientificDataset =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  'readPlane' in value &&
  typeof value.readPlane === 'function'

const execute = async (
  source: ScientificDataset,
  operationId: string,
  roi: DetectorRoi | NavigationRoi,
  reduction: 'sum' | 'mean',
): Promise<{
  readonly dataset: ScientificDataset
  readonly release: () => Promise<void>
  readonly clear: () => void
}> => {
  const runtime = createTileRuntime({
    limits: { maxCacheBytes: 4_194_304, maxTileBytes: 1_048_576 },
  })
  const bundle = createFourDStemAnalysisBundle({
    runtime,
    tileWidth: 3,
    tileHeight: 2,
    sessionId: 'four-d-stem-test',
  })
  const controller = createAnalysisController({
    ...bundle,
    library: { version: '0.17.0', buildFingerprint: 'four-d-stem-test' },
  })
  const graph: AnalysisGraph = {
    schemaVersion: 1,
    inputs: [{ name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
    nodes: [
      {
        id: 'reduction',
        operation: { id: operationId, version: 1 },
        inputs: [{ port: 'dataset', source: { kind: 'input', input: 'source' } }],
        parameters: fourDStemOperationParameters({ roles, roi, reduction }),
      },
    ],
    outputs: [
      {
        name: 'dataset',
        source: { kind: 'node', nodeId: 'reduction', output: 'dataset' },
      },
    ],
  }
  const bindings = {
    source: {
      value: source,
      identity: {
        kind: 'application-defined' as const,
        namespace: 'purejsimage.tests.4d-stem',
        value: 'generated-mib-v1',
      },
      characteristics: scientificDatasetCharacteristics(source),
    },
  }
  const plan = await controller.planGraph(graph, {
    bindings,
    policy: {
      mode: 'pinned',
      providerId: 'purejsimage.analysis.four-d-stem.reference',
      providerVersion: 1,
    },
  })
  const execution = await controller.executeGraph(plan).result
  const dataset = execution.outputs.get('dataset')
  if (!isDataset(dataset)) throw new Error('4D-STEM operation did not return a dataset')
  return Object.freeze({
    dataset,
    release: () => execution.release(),
    clear: () => runtime.clear(),
  })
}

const values = async (dataset: ScientificDataset): Promise<number[]> => {
  const output: number[] = []
  const horizontal = dataset.descriptor.axes[0]?.id
  const vertical = dataset.descriptor.axes[1]?.id
  if (horizontal === undefined || vertical === undefined) {
    throw new Error('Derived dataset omitted display axes')
  }
  const width = dataset.descriptor.axes[0]?.length
  if (width === undefined) throw new Error('Derived dataset omitted its horizontal axis length')
  const displayAxes = Object.freeze([horizontal, vertical] as const)
  for await (const block of dataset.readPlane({ displayAxes, fixedIndices: [] })) {
    try {
      const layout = validateRasterBlock(block)
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let y = 0; y < block.height; y += 1) {
        for (let x = 0; x < block.width; x += 1) {
          output[(block.y + y) * width + block.x + x] = readRasterSample(
            block.data,
            view,
            y * block.stride + x * layout.bytesPerSample,
            block.format.sampleType,
          )
        }
      }
    } finally {
      block.release?.()
    }
  }
  return output
}

const includes = (roi: DetectorRoi | NavigationRoi, x: number, y: number): boolean => {
  if (roi.kind === 'point') return x === roi.x && y === roi.y
  const sampleX = x + 0.5
  const sampleY = y + 0.5
  if (roi.kind === 'rectangle') {
    return (
      sampleX >= roi.x &&
      sampleX < roi.x + roi.width &&
      sampleY >= roi.y &&
      sampleY < roi.y + roi.height
    )
  }
  const squared = (sampleX - roi.x) ** 2 + (sampleY - roi.y) ** 2
  if (roi.kind === 'circle') return squared <= roi.radius ** 2
  return squared >= roi.innerRadius ** 2 && squared <= roi.outerRadius ** 2
}

const expectedVirtual = (roi: DetectorRoi, reduction: 'sum' | 'mean'): number[] => {
  const fixture = createGeneratedFourDStemFixture()
  const [scanWidth, scanHeight] = fixture.manifest.scanShape
  const [detectorWidth, detectorHeight] = fixture.manifest.detectorShape
  const output: number[] = []
  for (let scanY = 0; scanY < scanHeight; scanY += 1) {
    for (let scanX = 0; scanX < scanWidth; scanX += 1) {
      let sum = 0
      let count = 0
      for (let detectorY = 0; detectorY < detectorHeight; detectorY += 1) {
        for (let detectorX = 0; detectorX < detectorWidth; detectorX += 1) {
          if (!includes(roi, detectorX, detectorY)) continue
          sum += fixture.valueAt(scanX, scanY, detectorX, detectorY)
          count += 1
        }
      }
      output.push(reduction === 'mean' ? sum / count : sum)
    }
  }
  return output
}

const expectedScan = (roi: NavigationRoi, reduction: 'sum' | 'mean'): number[] => {
  const fixture = createGeneratedFourDStemFixture()
  const [scanWidth, scanHeight] = fixture.manifest.scanShape
  const [detectorWidth, detectorHeight] = fixture.manifest.detectorShape
  const positions: (readonly [number, number])[] = []
  for (let scanY = 0; scanY < scanHeight; scanY += 1) {
    for (let scanX = 0; scanX < scanWidth; scanX += 1) {
      if (includes(roi, scanX, scanY)) positions.push([scanX, scanY])
    }
  }
  const output: number[] = []
  for (let detectorY = 0; detectorY < detectorHeight; detectorY += 1) {
    for (let detectorX = 0; detectorX < detectorWidth; detectorX += 1) {
      let sum = 0
      for (const [scanX, scanY] of positions) {
        sum += fixture.valueAt(scanX, scanY, detectorX, detectorY)
      }
      output.push(reduction === 'mean' ? sum / positions.length : sum)
    }
  }
  return output
}

describe('explicit 4D-STEM analysis bundle', () => {
  it('recognizes only strongly labeled spatial and reciprocal-space axis pairs', async () => {
    const dataset = await fixtureDataset()
    expect(inferFourDStemAxisRoles(dataset.descriptor)).toEqual({
      status: 'recognized',
      roles,
      reason: 'Two labeled space axes and two labeled reciprocal-space axes were recognized',
    })
    expect(validateFourDStemAxisRoles(dataset.descriptor, roles)).toEqual(roles)
  })

  it('requires an override when semantic axis pairs have no X/Y evidence', () => {
    const descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: [
        { id: 'a', kind: 'reciprocal-space', length: 2, coordinates: { type: 'index' } },
        { id: 'b', kind: 'reciprocal-space', length: 2, coordinates: { type: 'index' } },
        { id: 'c', kind: 'space', length: 2, coordinates: { type: 'index' } },
        { id: 'd', kind: 'space', length: 2, coordinates: { type: 'index' } },
      ],
      sampleType: 'uint16',
      components: [{ id: 'counts', kind: 'intensity' }],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [['a', 'b']] },
      },
    })
    expect(inferFourDStemAxisRoles(descriptor)).toMatchObject({ status: 'ambiguous' })
    expect(
      validateFourDStemAxisRoles(descriptor, {
        navigationX: 'c',
        navigationY: 'd',
        detectorX: 'a',
        detectorY: 'b',
      }),
    ).toEqual({ navigationX: 'c', navigationY: 'd', detectorX: 'a', detectorY: 'b' })
  })

  it('does not classify an ordinary four-axis volume as 4D-STEM', () => {
    const descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: [
        { id: 'x', kind: 'space', length: 2, coordinates: { type: 'index' } },
        { id: 'y', kind: 'space', length: 2, coordinates: { type: 'index' } },
        { id: 'z', kind: 'space', length: 2, coordinates: { type: 'index' } },
        { id: 'time', kind: 'time', length: 2, coordinates: { type: 'index' } },
      ],
      sampleType: 'float32',
      components: [{ id: 'value', kind: 'scalar' }],
      capabilities: {
        regionReads: true,
        resolutionLevels: false,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
      },
    })
    expect(inferFourDStemAxisRoles(descriptor)).toEqual({
      status: 'unsupported',
      reason: '4D-STEM recognition requires exactly two space and two reciprocal-space axes',
    })
  })

  it.each([
    [{ kind: 'point', x: 8, y: 7 } as const, 'sum' as const],
    [{ kind: 'rectangle', x: 5, y: 4, width: 6, height: 5 } as const, 'mean' as const],
    [{ kind: 'circle', x: 8.5, y: 7.5, radius: 3.25 } as const, 'sum' as const],
    [
      { kind: 'annulus', x: 8.5, y: 7.5, innerRadius: 3.5, outerRadius: 6 } as const,
      'mean' as const,
    ],
  ])('matches exact virtual detector output for %o %s', async (roi, reduction) => {
    const source = await fixtureDataset()
    const result = await execute(source, virtualDetectorMapOperationId, roi, reduction)
    try {
      expect(result.dataset.descriptor.axes.map(({ id, length }) => ({ id, length }))).toEqual([
        { id: 'scanX', length: 7 },
        { id: 'scanY', length: 5 },
      ])
      expect(await values(result.dataset)).toEqual(expectedVirtual(roi, reduction))
    } finally {
      await result.release()
      result.clear()
    }
  })

  it.each([
    [{ kind: 'point', x: 2, y: 1 } as const, 'sum' as const],
    [{ kind: 'rectangle', x: 1, y: 1, width: 5, height: 3 } as const, 'mean' as const],
    [{ kind: 'circle', x: 3.5, y: 2.5, radius: 2.25 } as const, 'sum' as const],
  ])('matches exact scan-region diffraction output for %o %s', async (roi, reduction) => {
    const source = await fixtureDataset()
    const result = await execute(source, scanDiffractionReductionOperationId, roi, reduction)
    try {
      expect(result.dataset.descriptor.axes.map(({ id, length }) => ({ id, length }))).toEqual([
        { id: 'kx', length: 17 },
        { id: 'ky', length: 15 },
      ])
      expect(await values(result.dataset)).toEqual(expectedScan(roi, reduction))
    } finally {
      await result.release()
      result.clear()
    }
  })

  it('keeps the bundle explicit and rejects false 4D-STEM roles before reading', async () => {
    const source = await fixtureDataset()
    const runtime = createTileRuntime()
    const bundle = createFourDStemAnalysisBundle({ runtime })
    expect(bundle.operations.capabilitySnapshot.operations.map(({ id }) => id)).toEqual([
      virtualDetectorMapOperationId,
      scanDiffractionReductionOperationId,
    ])
    const parameters = fourDStemOperationParameters({
      roles: { ...roles, detectorX: 'scanX' },
      roi: { kind: 'point', x: 0, y: 0 },
      reduction: 'sum',
    })
    const normalized = bundle.operations
      .get(virtualDetectorMapOperationId, 1)
      ?.normalizeParameters(parameters)
    expect(normalized?.valid).toBe(false)
    expect(source.descriptor.metadata).not.toHaveProperty('purejsimage:4d-stem')
    runtime.clear()
  })

  it('honors cancellation before a derived tile starts', async () => {
    const source = await fixtureDataset()
    const result = await execute(
      source,
      virtualDetectorMapOperationId,
      { kind: 'annulus', x: 8.5, y: 7.5, innerRadius: 2, outerRadius: 7 },
      'sum',
    )
    const controller = new AbortController()
    controller.abort(new Error('stale viewport'))
    const iterator = result.dataset
      .readPlane({
        displayAxes: ['scanX', 'scanY'],
        fixedIndices: [],
        signal: controller.signal,
      })
      [Symbol.asyncIterator]()
    await expect(iterator.next()).rejects.toThrow('stale viewport')
    await result.release()
    result.clear()
  })

  it('keeps uint64 point reductions exact and rejects an unsafe virtual-detector mean', async () => {
    const source = uint64Dataset([7n, 9n])
    const point = await execute(
      source,
      scanDiffractionReductionOperationId,
      { kind: 'point', x: 0, y: 0 },
      'sum',
    )
    try {
      expect(await values(point.dataset)).toEqual([7, 9])
    } finally {
      await point.release()
      point.clear()
    }

    const unsafe = await execute(
      uint64Dataset([BigInt(Number.MAX_SAFE_INTEGER), 1n]),
      virtualDetectorMapOperationId,
      { kind: 'rectangle', x: 0, y: 0, width: 2, height: 1 },
      'mean',
    )
    try {
      await expect(values(unsafe.dataset)).rejects.toThrow('exceeds exact float64 integer output')
    } finally {
      await unsafe.release()
      unsafe.clear()
    }
  })
})
