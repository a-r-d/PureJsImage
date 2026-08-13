import { describe, expect, it } from 'vitest'
import {
  canonicalNormalizedRoiSemanticsJson,
  computeAnalysisProjectHashes,
  createBuiltInAnalysisValueTypeRegistry,
  hashCanonicalJson,
  normalizeAnalysisProjectV1,
  roiSetValueTypeId,
  roiValueTypeId,
  scientificDatasetValueTypeId,
  validateAnalysisProjectV1,
  type AnalysisProjectV1,
  type AnalysisSemanticIdentity,
} from '../src/analysis/index.ts'
import { createOperationRegistry } from '../src/operations/index.ts'
import { normalizeScientificDatasetDescriptor } from '../src/scientific/index.ts'

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 2,
  axes: [
    { id: 'x', kind: 'space', length: 8, coordinates: { type: 'index' } },
    { id: 'y', kind: 'space', length: 6, coordinates: { type: 'index' } },
  ],
  sampleType: 'float32',
  components: [{ id: 'value', kind: 'scalar' }],
  capabilities: { regionReads: true, resolutionLevels: false },
})

const sourceIdentity = Object.freeze({
  kind: 'content' as const,
  strength: 'strong' as const,
  stability: 'content-addressed' as const,
  algorithm: 'sha256' as const,
  digest: 'a'.repeat(64),
  size: 128,
})
const companionIdentity = Object.freeze({
  ...sourceIdentity,
  digest: 'b'.repeat(64),
  size: 4_096,
})

const roi = Object.freeze({
  schemaVersion: 1 as const,
  id: 'selection-1',
  axisIds: ['x', 'y'] as const,
  fixedIndices: Object.freeze([]),
  coordinateSpace: 'pixel' as const,
  geometry: Object.freeze({ kind: 'rectangle' as const, x: 1, y: 2, width: 3, height: 2 }),
})

const options = Object.freeze({
  operations: createOperationRegistry([]),
  valueTypes: createBuiltInAnalysisValueTypeRegistry(descriptor),
  roi: Object.freeze({ descriptor }),
})

const validProject = async (): Promise<AnalysisProjectV1> => {
  const roiDomain = 'purejsimage.roi-semantics.v1'
  const roiIdentity: AnalysisSemanticIdentity = Object.freeze({
    kind: 'semantic-json',
    domain: roiDomain,
    sha256: await hashCanonicalJson(roiDomain, canonicalNormalizedRoiSemanticsJson(roi)),
  })
  const datasetIdentity = Object.freeze({
    kind: 'scientific-dataset' as const,
    reader: Object.freeze({ id: 'purejsimage/envi', version: '1.0.0' }),
    datasetId: 'raster',
    resources: Object.freeze([
      { id: 'header', identity: companionIdentity },
      { id: 'data', identity: sourceIdentity },
    ]),
  })
  const project = {
    schemaVersion: 1 as const,
    graph: {
      schemaVersion: 1 as const,
      inputs: [
        { name: 'surface', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
        { name: 'selection', valueType: { id: roiValueTypeId, version: 1 } },
      ],
      nodes: [],
      outputs: [{ name: 'surface', source: { kind: 'input' as const, input: 'surface' } }],
    },
    roiSet: { schemaVersion: 1 as const, rois: [roi] },
    bindings: [
      {
        input: 'surface',
        valueType: { id: scientificDatasetValueTypeId, version: 1 },
        identity: datasetIdentity,
        value: { kind: 'source' as const, sourceReference: 'scene' },
      },
      {
        input: 'selection',
        valueType: { id: roiValueTypeId, version: 1 },
        identity: roiIdentity,
        value: { kind: 'roi' as const, roiId: roi.id },
      },
    ],
    sourceReferences: [{ id: 'scene', identity: datasetIdentity }],
    display: { activePanel: 'profile' },
    createdWith: { packageVersion: '0.10.0-alpha', buildFingerprint: 'test-build' },
  }
  const hashes = await computeAnalysisProjectHashes(project)
  return Object.freeze({ ...project, hashes })
}

describe('AnalysisProject V1', () => {
  it('normalizes the normative envelope and resolves source and ROI references', async () => {
    const project = await validProject()
    const validation = await validateAnalysisProjectV1(project, options)
    expect(validation.valid).toBe(true)
    expect(
      validation.project?.bindings.find((binding) => binding.input === 'selection')?.value,
    ).toEqual({ kind: 'roi', roiId: 'selection-1' })
    expect(await normalizeAnalysisProjectV1(project, options)).toEqual(validation.project)
  })

  it('rejects unresolved references and stale semantic hashes without repairing them', async () => {
    const project = await validProject()
    const unresolved = {
      ...project,
      bindings: project.bindings.map((binding) =>
        binding.input === 'selection'
          ? { ...binding, value: { kind: 'roi', roiId: 'missing' } }
          : binding,
      ),
    }
    expect((await validateAnalysisProjectV1(unresolved, options)).issues[0]?.message).toContain(
      'Unknown ROI missing',
    )

    const stale = { ...project, hashes: { ...project.hashes, invocation: '0'.repeat(64) } }
    const staleValidation = await validateAnalysisProjectV1(stale, options)
    expect(staleValidation.valid).toBe(false)
    expect(staleValidation.issues[0]?.path).toBe('/hashes/invocation')
    expect(stale.hashes.invocation).toBe('0'.repeat(64))
  })

  it('rejects duplicate ROI ids in a persisted ROI-set binding', async () => {
    const project = await validProject()
    const duplicateSubset = {
      ...project,
      graph: {
        ...project.graph,
        inputs: project.graph.inputs.map((input) =>
          input.name === 'selection'
            ? { ...input, valueType: { id: roiSetValueTypeId, version: 1 } }
            : input,
        ),
      },
      bindings: project.bindings.map((binding) =>
        binding.input === 'selection'
          ? {
              ...binding,
              valueType: { id: roiSetValueTypeId, version: 1 },
              value: { kind: 'roi-set', roiIds: [roi.id, roi.id] },
            }
          : binding,
      ),
    }
    expect((await validateAnalysisProjectV1(duplicateSubset, options)).issues[0]).toMatchObject({
      code: 'duplicate',
      path: '/bindings/1/value/roiIds',
    })
  })

  it('enforces document and presentation limits before any execution boundary', async () => {
    const project = await validProject()
    expect(
      (await validateAnalysisProjectV1(project, { ...options, maxDisplayBytes: 4 })).issues[0],
    ).toMatchObject({ code: 'limit-exceeded', path: '/display' })
    expect(
      (await validateAnalysisProjectV1(project, { ...options, maxDocumentBytes: 4 })).issues[0],
    ).toMatchObject({ code: 'limit-exceeded', path: '' })
  })
})
