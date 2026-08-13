import { describe, expect, it } from 'vitest'
import { planGraph } from '../src/analysis/index.ts'
import {
  createOperationRegistry,
  createValueTypeDefinition,
  createValueTypeRegistry,
} from '../src/operations/index.ts'
import {
  createScientificLibrary,
  encodeGsf,
  getScientificDatasetIdentity,
  gsfReader,
} from '../src/scientific/index.ts'
import { MemorySource } from '../src/source.ts'

const valueTypes = createValueTypeRegistry([
  createValueTypeDefinition({
    descriptor: { id: 'example.scientific.dataset', version: 1, title: 'Scientific dataset' },
  }),
])

describe('reader-derived scientific dataset identity', () => {
  it('identifies an opened dataset and lets the planner use it without an application identity', async () => {
    const source = new MemorySource(
      encodeGsf({ width: 2, height: 1, values: new Float32Array([1, 2]) }),
    )
    const library = createScientificLibrary({ readers: [gsfReader] })
    const document = await library.open({
      primary: { id: 'primary', name: 'surface.gsf', source },
      readerId: 'purejsimage/gsf',
    })
    const summary = document.datasets[0]
    expect(summary?.identity).toEqual({
      kind: 'scientific-dataset',
      reader: { id: 'purejsimage/gsf', version: '1.0.0' },
      datasetId: 'surface',
      resources: [{ id: 'primary', identity: expect.objectContaining({ size: source.size }) }],
    })

    const dataset = await document.openDataset('surface')
    expect(getScientificDatasetIdentity(dataset)).toBe(summary?.identity)
    const plan = await planGraph({
      graph: {
        schemaVersion: 1,
        inputs: [{ name: 'source', valueType: { id: 'example.scientific.dataset', version: 1 } }],
        nodes: [],
        outputs: [{ name: 'source', source: { kind: 'input', input: 'source' } }],
      },
      operations: createOperationRegistry([]),
      valueTypes,
      providers: [],
      bindings: { source: { value: dataset } },
    })
    expect(plan.summary.requiredInputIdentities[0]?.identity).toEqual(summary?.identity)
    await plan.dispose()
  })

  it('still requires an explicit identity for synthetic datasets', async () => {
    const synthetic = {
      descriptor: {
        schemaVersion: 2 as const,
        axes: [
          { id: 'x', kind: 'space' as const, length: 1, coordinates: { type: 'index' as const } },
          { id: 'y', kind: 'space' as const, length: 1, coordinates: { type: 'index' as const } },
        ],
        sampleType: 'uint8' as const,
        components: [{ id: 'value', kind: 'scalar' as const }],
        levels: [
          {
            level: 0,
            axisLengths: [
              { axisId: 'x', length: 1 },
              { axisId: 'y', length: 1 },
            ],
          },
        ],
        capabilities: { regionReads: true, resolutionLevels: false },
      },
      async *readPlane() {},
    }
    await expect(
      planGraph({
        graph: {
          schemaVersion: 1,
          inputs: [{ name: 'source', valueType: { id: 'example.scientific.dataset', version: 1 } }],
          nodes: [],
          outputs: [],
        },
        operations: createOperationRegistry([]),
        valueTypes,
        providers: [],
        bindings: { source: { value: synthetic } },
      }),
    ).rejects.toThrow('requires an explicit semantic identity')
  })
})
