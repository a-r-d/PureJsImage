import { describe, expect, it } from 'vitest'
import {
  analysisSelectResolutionLevelOperationId,
  createBuiltInAnalysisOperationRegistry,
  createReferenceAnalysisProvider,
  scientificDatasetCharacteristics,
} from '../src/analysis/index.ts'
import { createTileRuntime } from '../src/analysis/runtime.ts'
import type { RasterBlock } from '../src/raster.ts'
import type { ScientificDataset, ScientificPlaneReadRequest } from '../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from '../src/scientific/index.ts'

describe('select-resolution-level operation', () => {
  it('returns calibrated single-level metadata and forwards blocks without copying', async () => {
    const descriptor = normalizeScientificDatasetDescriptor({
      schemaVersion: 1,
      axes: [
        {
          id: 'x',
          kind: 'space',
          length: 8,
          unit: 'µm',
          coordinates: { type: 'linear', origin: 0, step: 0.5 },
        },
        {
          id: 'y',
          kind: 'space',
          length: 6,
          unit: 'µm',
          coordinates: { type: 'linear', origin: 0, step: 0.5 },
        },
      ],
      sampleType: 'uint8',
      components: [{ id: 'signal', kind: 'scalar' }],
      levels: [
        {
          level: 0,
          axisLengths: [
            { axisId: 'x', length: 8 },
            { axisId: 'y', length: 6 },
          ],
        },
        {
          level: 1,
          axisLengths: [
            { axisId: 'x', length: 4 },
            { axisId: 'y', length: 2 },
          ],
          axisCoordinates: [
            { axisId: 'x', coordinates: { type: 'linear', origin: 0, step: 1 } },
            { axisId: 'y', coordinates: { type: 'linear', origin: 0, step: 1.5 } },
          ],
        },
      ],
      metadata: { source: 'pyramid-fixture' },
      capabilities: {
        regionReads: true,
        resolutionLevels: true,
        planeReads: { kind: 'ordered-axis-pairs', pairs: [['x', 'y']] },
      },
    })
    const data = Uint8Array.of(1, 2, 3, 4)
    let selectedLevel = -1
    let releases = 0
    const source: ScientificDataset = Object.freeze({
      descriptor,
      async *readPlane(request: Readonly<ScientificPlaneReadRequest>): AsyncGenerator<RasterBlock> {
        const normalized = normalizeScientificPlaneReadRequest(descriptor, request)
        selectedLevel = normalized.resolutionLevel
        yield {
          x: normalized.x,
          y: normalized.y,
          width: normalized.width,
          height: normalized.height,
          stride: normalized.width,
          format: { sampleType: 'uint8', channels: 1, planar: false },
          data,
          release: () => {
            releases += 1
          },
        }
      },
    })
    const runtime = createTileRuntime()
    const provider = createReferenceAnalysisProvider({ runtime, sessionId: 'select-level-test' })
    const prepared = await provider.prepare()
    const implementation = prepared?.implementations.find(
      (entry) => entry.descriptor.operationId === analysisSelectResolutionLevelOperationId,
    )
    const definition = createBuiltInAnalysisOperationRegistry().get(
      analysisSelectResolutionLevelOperationId,
      1,
    )
    if (prepared === undefined || implementation === undefined || definition === undefined) {
      throw new Error('Select-resolution-level implementation was unavailable')
    }
    const normalized = definition.normalizeParameters({ level: 1 })
    if (normalized.value === undefined) throw new Error('Level parameter failed normalization')
    const outputs = await implementation.execute({
      descriptor: definition.descriptor,
      parameters: normalized.value,
      inputs: [source],
      plannedInputCharacteristics: [scientificDatasetCharacteristics(source)],
      provider: prepared.descriptor,
      implementation: implementation.descriptor,
      signal: new AbortController().signal,
    })
    const selected = outputs[0]?.value as ScientificDataset
    expect(selected.descriptor).toMatchObject({
      metadata: { source: 'pyramid-fixture' },
      axes: [
        { id: 'x', length: 4, coordinates: { step: 1 } },
        { id: 'y', length: 2, coordinates: { step: 1.5 } },
      ],
      levels: [
        {
          level: 0,
          axisLengths: [
            { axisId: 'x', length: 4 },
            { axisId: 'y', length: 2 },
          ],
        },
      ],
      capabilities: { resolutionLevels: false },
    })
    for await (const block of selected.readPlane({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      x: 0,
      y: 0,
      width: 2,
      height: 2,
    })) {
      expect(block.data).toBe(data)
      block.release?.()
    }
    expect(selectedLevel).toBe(1)
    expect(releases).toBe(1)
    await outputs[0]?.release()
    await runtime.dispose()
  })
})
