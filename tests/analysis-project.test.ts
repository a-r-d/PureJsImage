import { describe, expect, it } from 'vitest'
import {
  canonicalNormalizedRoiSemanticsJson,
  computeAnalysisProjectHashes,
  createBuiltInAnalysisValueTypeRegistry,
  executeGraph,
  hashCanonicalJson,
  normalizeAnalysisProjectV1,
  planGraph,
  roiSetValueTypeId,
  roiValueTypeId,
  scientificDatasetValueTypeId,
  validateAnalysisProjectV1,
  type AnalysisProjectV1,
  type AnalysisSemanticIdentity,
} from '../src/analysis/index.ts'
import {
  createOperationRegistry,
  createValueTypeDefinition,
  createValueTypeRegistry,
} from '../src/operations/index.ts'
import { normalizeScientificDatasetDescriptor } from '../src/scientific/index.ts'

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 2,
  axes: [
    { id: 'x', kind: 'space', length: 8, coordinates: { type: 'index' } },
    { id: 'y', kind: 'space', length: 6, coordinates: { type: 'index' } },
  ],
  sampleType: 'float32',
  components: [{ id: 'value', kind: 'scalar' }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' },
  },
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

  it('normalizes inline values before persisted and execution identities are used', async () => {
    const valueType = createValueTypeDefinition({
      descriptor: { id: 'purejsimage.test.threshold', version: 1, title: 'Threshold' },
      validate(value) {
        if (
          value === null ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          !('threshold' in value) ||
          typeof value.threshold !== 'number'
        ) {
          return {
            valid: false,
            issues: [{ code: 'invalid-type', path: '', message: 'Expected a threshold object' }],
          }
        }
        return {
          valid: true,
          issues: [],
          value: Object.freeze({ threshold: value.threshold, inclusive: true }),
        }
      },
    })
    const valueTypes = createValueTypeRegistry([valueType])
    const graph = Object.freeze({
      schemaVersion: 1 as const,
      inputs: Object.freeze([
        Object.freeze({ name: 'input', valueType: { id: valueType.descriptor.id, version: 1 } }),
      ]),
      nodes: Object.freeze([]),
      outputs: Object.freeze([
        Object.freeze({ name: 'output', source: { kind: 'input' as const, input: 'input' } }),
      ]),
    })
    const normalizedValue = Object.freeze({ threshold: 5, inclusive: true })
    const domain = `purejsimage.binding.${valueType.descriptor.id}.v1`
    const identity: AnalysisSemanticIdentity = Object.freeze({
      kind: 'semantic-json',
      domain,
      sha256: await hashCanonicalJson(domain, normalizedValue),
    })
    const base = {
      schemaVersion: 1 as const,
      graph,
      roiSet: { schemaVersion: 1 as const, rois: [] },
      bindings: [
        {
          input: 'input',
          valueType: { id: valueType.descriptor.id, version: 1 },
          identity,
          value: { kind: 'inline-json' as const, value: { threshold: 5 } },
        },
      ],
      sourceReferences: [],
      createdWith: { packageVersion: '0.10.0-alpha', buildFingerprint: 'test-build' },
    }
    const hashes = await computeAnalysisProjectHashes(base)
    const project = await normalizeAnalysisProjectV1(
      { ...base, hashes },
      {
        operations: createOperationRegistry([]),
        valueTypes,
        roi: { descriptor },
      },
    )
    expect(project.bindings[0]?.value).toEqual({ kind: 'inline-json', value: normalizedValue })
    expect(await computeAnalysisProjectHashes(project)).toEqual(project.hashes)
    const persistedBinding = project.bindings[0]
    if (persistedBinding?.value.kind !== 'inline-json') {
      throw new Error('Expected a normalized inline binding')
    }

    const plan = await planGraph({
      graph: project.graph,
      operations: createOperationRegistry([]),
      valueTypes,
      providers: [],
      bindings: {
        input: {
          value: persistedBinding.value.value,
          valueType: persistedBinding.valueType,
          identity: persistedBinding.identity,
        },
      },
    })
    expect(plan.summary.invocation.bindingHash).toBe(project.hashes.bindings)
    const result = await executeGraph({
      plan,
      library: { version: '0.10.0-alpha', buildFingerprint: 'test-build' },
    }).result
    expect(result.outputs.get('output')).toEqual(normalizedValue)
    await result.release()
    await plan.dispose()
  })
})
