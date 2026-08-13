import { describe, expect, it } from 'vitest'
import {
  canonicalJson,
  createAnalysisController,
  createRoiValueTypeDefinitions,
  hashAnalysisGraph,
  roiValueTypeId,
} from '../src/analysis/index.ts'
import {
  createOperationDefinition,
  createOperationProvider,
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
  sampleType: 'uint16',
  components: [{ id: 'value', kind: 'scalar' }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' },
  },
})

const operation = createOperationDefinition({
  descriptor: {
    id: 'example.roi.consume',
    version: 1,
    title: 'Consume ROI',
    category: 'analysis',
    tags: ['roi'],
    inputs: [{ name: 'roi', valueType: { id: roiValueTypeId, version: 1 } }],
    outputs: [],
    parameters: { type: 'object', properties: {}, closed: true },
    execution: 'metadata-only',
    reproducibility: { class: 'bit-exact' },
  },
})

const polygon = (name = 'Selection') => ({
  schemaVersion: 1,
  id: 'selection',
  name,
  axisIds: ['x', 'y'],
  fixedIndices: [],
  coordinateSpace: 'pixel',
  geometry: {
    kind: 'polygon',
    points: [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 2, y: 3 },
    ],
  },
})

describe('ROI value types and immutable workspace commands', () => {
  it('requires explicit ROI context and the core ROI value types', () => {
    const options = {
      operations: createOperationRegistry([]),
      library: { version: '0.9.0', buildFingerprint: 'roi-context-test' },
    }
    expect(() =>
      createAnalysisController({
        ...options,
        valueTypes: createValueTypeRegistry([]),
        roi: { descriptor },
      }),
    ).toThrow('requires the core ROI and ROI-set value types')

    const controller = createAnalysisController({
      ...options,
      valueTypes: createValueTypeRegistry([]),
    })
    expect(
      controller.validateCommand({
        schemaVersion: 1,
        id: 'remove-without-context',
        expectedRevision: 0,
        kind: 'remove-roi',
        roiId: 'selection',
      }),
    ).toMatchObject({ valid: false, issues: [{ path: '/roiId' }] })
  })

  it('creates, edits, binds, plans, and explicitly executes an ROI through one controller', async () => {
    let executions = 0
    const provider = createOperationProvider({
      descriptor: {
        id: 'example.roi.reference',
        version: 1,
        kind: 'reference',
        buildFingerprint: 'roi-reference-1',
      },
      prepare: async () => [
        {
          descriptor: {
            operationId: 'example.roi.consume',
            operationVersion: 1,
            implementationVersion: '1.0.0',
            bitExactConformance: true,
          },
          supportsPlan: () => true,
          estimatePlan: () => ({
            setupMilliseconds: 0,
            transferMilliseconds: 0,
            computeMilliseconds: 0,
            readbackMilliseconds: 0,
            retainedBytes: 0,
            peakWorkingBytes: 0,
            transferBytes: 0,
            outputBytes: 0,
            confidence: 1,
          }),
          execute: async () => {
            executions += 1
            return []
          },
        },
      ],
    })
    const roiLimits = { maxRois: 10, maxPointsPerGeometry: 20 }
    const controller = createAnalysisController({
      operations: createOperationRegistry([operation]),
      valueTypes: createValueTypeRegistry(createRoiValueTypeDefinitions(descriptor, roiLimits)),
      providers: [provider],
      roi: { descriptor, limits: roiLimits },
      library: { version: '0.9.0', buildFingerprint: 'roi-test' },
    })
    let workspace = controller.createWorkspace()
    const commands: readonly unknown[] = [
      {
        schemaVersion: 1,
        id: 'add-selection',
        kind: 'add-roi',
        expectedRevision: 0,
        roi: polygon(),
      },
      {
        schemaVersion: 1,
        id: 'rename-selection',
        kind: 'update-roi',
        expectedRevision: 1,
        roiId: 'selection',
        roi: polygon('Renamed selection'),
      },
      {
        schemaVersion: 1,
        id: 'bind-selection',
        kind: 'bind-input',
        expectedRevision: 2,
        input: { name: 'selection', valueType: { id: roiValueTypeId, version: 1 } },
      },
      {
        schemaVersion: 1,
        id: 'add-consumer',
        kind: 'add-node',
        expectedRevision: 3,
        node: {
          id: 'consume',
          operation: { id: 'example.roi.consume', version: 1 },
          inputs: [],
          parameters: {},
        },
      },
      {
        schemaVersion: 1,
        id: 'connect-selection',
        kind: 'connect',
        expectedRevision: 4,
        nodeId: 'consume',
        port: 'roi',
        source: { kind: 'input', input: 'selection' },
      },
    ]
    for (const command of commands) {
      const application = controller.applyCommand(workspace, command)
      expect(application.issues).toEqual([])
      expect(application.applied).toBe(true)
      workspace = application.snapshot
    }
    expect(workspace.revision).toBe(5)
    expect(workspace.roiSet.rois[0]?.name).toBe('Renamed selection')
    expect(executions).toBe(0)
    expect(controller.capabilities.roi).toMatchObject({
      schemaVersion: 1,
      limits: { maxRois: 10, maxPointsPerGeometry: 20 },
    })
    expect(controller.capabilities.commandDescriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'update-roi',
          schema: expect.objectContaining({ type: 'object' }),
        }),
      ]),
    )
    expect(JSON.parse(JSON.stringify(controller.capabilities))).toEqual(controller.capabilities)
    expect(controller.capabilities.valueTypeDescriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: roiValueTypeId,
          capabilities: expect.objectContaining({
            limits: expect.objectContaining({ maxRois: 10 }),
          }),
        }),
      ]),
    )
    expect(canonicalJson(workspace)).toContain('"roiSet"')
    await expect(hashAnalysisGraph(workspace.graph)).resolves.toMatch(/^[0-9a-f]{64}$/u)
    const selected = workspace.roiSet.rois[0]
    if (selected === undefined) throw new Error('Expected ROI state')
    const plan = await controller.planGraph(workspace.graph, {
      bindings: {
        selection: {
          value: selected,
          valueType: { id: roiValueTypeId, version: 1 },
        },
      },
    })
    expect(executions).toBe(0)
    const renamedPlan = await controller.planGraph(workspace.graph, {
      bindings: {
        selection: {
          value: polygon('Presentation-only rename'),
          valueType: { id: roiValueTypeId, version: 1 },
        },
      },
    })
    expect(renamedPlan.summary.invocation.bindingHash).toBe(plan.summary.invocation.bindingHash)
    const execution = await controller.executeGraph(plan).result
    expect(executions).toBe(1)
    await execution.release()
    await plan.dispose()
    await renamedPlan.dispose()
  })

  it('rejects stale, invalid, duplicate, and unknown ROI edits without mutation', () => {
    const controller = createAnalysisController({
      operations: createOperationRegistry([]),
      valueTypes: createValueTypeRegistry(createRoiValueTypeDefinitions(descriptor)),
      roi: { descriptor },
      library: { version: '0.9.0', buildFingerprint: 'roi-test' },
    })
    const empty = controller.createWorkspace()
    const added = controller.applyCommand(empty, {
      schemaVersion: 1,
      id: 'add',
      kind: 'add-roi',
      expectedRevision: 0,
      roi: polygon(),
    })
    expect(added.applied).toBe(true)
    const stale = controller.applyCommand(added.snapshot, {
      schemaVersion: 1,
      id: 'stale',
      kind: 'remove-roi',
      expectedRevision: 0,
      roiId: 'selection',
    })
    expect(stale.snapshot).toBe(added.snapshot)
    expect(stale.issues[0]).toMatchObject({ code: 'stale-revision', path: '/expectedRevision' })
    const duplicate = controller.applyCommand(added.snapshot, {
      schemaVersion: 1,
      id: 'duplicate',
      expectedRevision: 1,
      kind: 'add-roi',
      roi: polygon(),
    })
    expect(duplicate.snapshot).toBe(added.snapshot)
    expect(duplicate.issues[0]).toMatchObject({ code: 'duplicate', path: '/roi/id' })
    const invalid = controller.applyCommand(added.snapshot, {
      schemaVersion: 1,
      id: 'invalid',
      expectedRevision: 1,
      kind: 'update-roi',
      roiId: 'selection',
      roi: { ...polygon(), geometry: { kind: 'polygon', points: [] } },
    })
    expect(invalid.snapshot).toBe(added.snapshot)
    expect(invalid.issues[0]?.path).toContain('/roi/geometry/points')
    const missing = controller.applyCommand(added.snapshot, {
      schemaVersion: 1,
      id: 'missing',
      expectedRevision: 1,
      kind: 'remove-roi',
      roiId: 'missing',
    })
    expect(missing.issues[0]).toMatchObject({ code: 'invalid-reference', path: '/roiId' })
  })

  it('enforces the set-wide ROI limit during command application', () => {
    const controller = createAnalysisController({
      operations: createOperationRegistry([]),
      valueTypes: createValueTypeRegistry(
        createRoiValueTypeDefinitions(descriptor, { maxRois: 1 }),
      ),
      roi: { descriptor, limits: { maxRois: 1 } },
      library: { version: '0.9.0', buildFingerprint: 'roi-limit-test' },
    })
    const first = controller.applyCommand(controller.createWorkspace(), {
      schemaVersion: 1,
      id: 'first',
      expectedRevision: 0,
      kind: 'add-roi',
      roi: polygon(),
    })
    expect(first.applied).toBe(true)
    const second = controller.applyCommand(first.snapshot, {
      schemaVersion: 1,
      id: 'second',
      expectedRevision: 1,
      kind: 'add-roi',
      roi: { ...polygon(), id: 'selection-2' },
    })
    expect(second.applied).toBe(false)
    expect(second.snapshot).toBe(first.snapshot)
    expect(second.issues[0]).toMatchObject({ code: 'limit-exceeded', path: '/rois' })
  })

  it('keeps core ROI value types local and protected from extension-style replacement', () => {
    const definitions = createRoiValueTypeDefinitions(descriptor)
    const custom = createValueTypeDefinition({
      descriptor: { id: 'example.roi.annotation', version: 1, title: 'Custom annotation' },
    })
    expect(
      createValueTypeRegistry([...definitions, custom]).get(custom.descriptor.id, 1),
    ).toBeDefined()
    const replacement = createValueTypeDefinition({
      descriptor: { id: roiValueTypeId, version: 2, title: 'Replacement ROI' },
    })
    expect(() => createValueTypeRegistry([...definitions, replacement])).toThrow(
      'cannot replace a built-in',
    )
  })
})
