import { describe, expect, it } from 'vitest'
import {
  analysisCropOperationId,
  analysisGaussianBlurOperationId,
  analysisHistogramOperationId,
  analysisStatisticsOperationId,
  createAnalysisController,
  createBuiltInAnalysisBundle,
  createTileRuntime,
  roiValueTypeId,
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
  summarizeResult,
  validateAnalysisResult,
} from '../src/analysis/index.ts'
import type { AnalysisResult, Roi } from '../src/analysis/index.ts'
import { createExtensionHost } from '../src/extensions/index.ts'
import type {
  DirectNumericTileDataset,
  NumericTile,
  NumericTileReadRequest,
} from '../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
} from '../src/scientific/index.ts'
import { trustedPointwiseExtension } from '../examples/analysis-trusted-extension/index.ts'

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 2,
  axes: [
    {
      id: 'x',
      kind: 'space',
      length: 4,
      unit: 'mm',
      coordinates: { type: 'linear', origin: 0, step: 1 },
    },
    {
      id: 'y',
      kind: 'space',
      length: 4,
      unit: 'mm',
      coordinates: { type: 'linear', origin: 0, step: 1 },
    },
  ],
  sampleType: 'float32',
  components: [{ id: 'signal', kind: 'scalar', unit: 'counts' }],
  capabilities: { regionReads: true, resolutionLevels: false },
})

const source = (): DirectNumericTileDataset =>
  Object.freeze({
    descriptor,
    numericTileSource: Object.freeze({
      descriptor,
      directSemantics: Object.freeze({
        sourceSampleType: 'float32' as const,
        nativeSampleType: 'float32' as const,
        componentCount: 1,
        layout: 'interleaved' as const,
        supportedTargetSampleTypes: ['float32', 'float64'] as const,
      }),
      async *readNumericTiles(
        input: Readonly<NumericTileReadRequest>,
      ): AsyncGenerator<NumericTile> {
        const { targetSampleType, ...planeRequest } = input
        const request = normalizeScientificPlaneReadRequest(descriptor, planeRequest)
        request.signal?.throwIfAborted()
        const data =
          targetSampleType === 'float64'
            ? new Float64Array(request.width * request.height)
            : new Float32Array(request.width * request.height)
        for (let y = 0; y < request.height; y += 1) {
          for (let x = 0; x < request.width; x += 1) {
            data[y * request.width + x] = request.x + x + (request.y + y) * 10
          }
        }
        yield Object.freeze({
          x: request.x,
          y: request.y,
          width: request.width,
          height: request.height,
          sampleType: targetSampleType ?? 'float32',
          componentCount: 1,
          layout: 'interleaved' as const,
          rowStrideElements: request.width,
          data,
          release() {},
        })
      },
    }),
    readPlane() {
      throw new Error('Workflow fixture expects native tile reads')
    },
  })

const polygon: Roi = Object.freeze({
  schemaVersion: 1,
  id: 'selection',
  axisIds: ['x', 'y'] as const,
  fixedIndices: Object.freeze([]),
  coordinateSpace: 'pixel',
  geometry: Object.freeze({
    kind: 'polygon',
    points: Object.freeze([
      Object.freeze({ x: 0, y: 0 }),
      Object.freeze({ x: 4, y: 0 }),
      Object.freeze({ x: 4, y: 1.5 }),
      Object.freeze({ x: 1.5, y: 1.5 }),
      Object.freeze({ x: 1.5, y: 4 }),
      Object.freeze({ x: 0, y: 4 }),
    ]),
  }),
})

describe('public built-in analysis application workflow', () => {
  it('drives capabilities, commands, dry-run, cancellation, execution, and summaries', async () => {
    const input = source()
    const runtime = createTileRuntime()
    const bundle = createBuiltInAnalysisBundle({
      descriptor,
      runtime,
      tileWidth: 2,
      tileHeight: 2,
      sessionId: 'command-workflow',
    })
    const controller = createAnalysisController({
      ...bundle,
      roi: { descriptor },
      library: { version: '0.9.0', buildFingerprint: 'command-workflow-test' },
    })
    expect(controller.capabilities.operationDescriptors).toHaveLength(9)
    expect(controller.capabilities.valueTypeDescriptors.length).toBeGreaterThanOrEqual(8)
    expect(controller.capabilities.commandKinds).toContain('add-roi')
    expect(JSON.parse(JSON.stringify(controller.capabilities))).toEqual(controller.capabilities)

    const blurDescription = controller.describeOperation(analysisGaussianBlurOperationId, 1)
    expect(blurDescription).toMatchObject({
      id: analysisGaussianBlurOperationId,
      version: 1,
      execution: 'neighborhood',
      reproducibility: { class: 'tolerance-based', absolute: 1e-5, relative: 1e-6 },
    })
    const normalizedBlur = controller.normalizeOperationParameters(
      analysisGaussianBlurOperationId,
      1,
      { displayAxes: ['x', 'y'], fixedIndices: [], sigma: 0.5 },
    )
    expect(normalizedBlur.value).toEqual({
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      component: 0,
      sigma: 0.5,
      boundary: 'clamp',
      constantValue: 0,
      invalidPolicy: 'propagate',
    })

    let workspace = controller.createWorkspace()
    const apply = (command: Readonly<Record<string, unknown>>): void => {
      const result = controller.applyCommand(workspace, {
        schemaVersion: 1,
        id: `command-${workspace.revision + 1}`,
        expectedRevision: workspace.revision,
        ...command,
      })
      expect(result.issues).toEqual([])
      expect(result.applied).toBe(true)
      workspace = result.snapshot
    }
    apply({
      kind: 'bind-input',
      input: { name: 'source', valueType: { id: scientificDatasetValueTypeId, version: 1 } },
    })
    apply({
      kind: 'bind-input',
      input: { name: 'selection', valueType: { id: roiValueTypeId, version: 1 } },
    })
    apply({
      kind: 'add-node',
      node: {
        id: 'crop',
        operation: { id: analysisCropOperationId, version: 1 },
        inputs: [],
        parameters: { displayAxes: ['x', 'y'], x: 0, y: 0, width: 4, height: 4 },
      },
    })
    apply({
      kind: 'add-node',
      node: {
        id: 'blur',
        operation: { id: analysisGaussianBlurOperationId, version: 1 },
        inputs: [],
        parameters: normalizedBlur.value,
      },
    })
    apply({
      kind: 'add-node',
      node: {
        id: 'histogram',
        operation: { id: analysisHistogramOperationId, version: 1 },
        inputs: [],
        parameters: {
          displayAxes: ['x', 'y'],
          fixedIndices: [],
          component: 0,
          bins: 4,
        },
      },
    })
    apply({
      kind: 'add-node',
      node: {
        id: 'statistics',
        operation: { id: analysisStatisticsOperationId, version: 1 },
        inputs: [],
        parameters: {
          displayAxes: ['x', 'y'],
          fixedIndices: [],
          component: 0,
          percentiles: [50],
          percentileMaxSamples: 64,
          emptyPolicy: 'error',
        },
      },
    })
    apply({
      kind: 'connect',
      nodeId: 'crop',
      port: 'dataset',
      source: { kind: 'input', input: 'source' },
    })
    apply({
      kind: 'connect',
      nodeId: 'blur',
      port: 'dataset',
      source: { kind: 'node', nodeId: 'crop', output: 'dataset' },
    })
    for (const nodeId of ['histogram', 'statistics']) {
      apply({
        kind: 'connect',
        nodeId,
        port: 'dataset',
        source: { kind: 'node', nodeId: 'blur', output: 'dataset' },
      })
      apply({ kind: 'connect', nodeId, port: 'roi', source: { kind: 'input', input: 'selection' } })
    }
    apply({ kind: 'add-roi', roi: polygon })
    apply({
      kind: 'set-output',
      output: {
        name: 'histogram',
        source: { kind: 'node', nodeId: 'histogram', output: 'histogram' },
      },
    })
    apply({
      kind: 'set-output',
      output: {
        name: 'statistics',
        source: { kind: 'node', nodeId: 'statistics', output: 'statistics' },
      },
    })

    const stale = controller.applyCommand(workspace, {
      schemaVersion: 1,
      id: 'stale-command',
      expectedRevision: 0,
      kind: 'remove-output',
      name: 'statistics',
    })
    expect(stale.applied).toBe(false)
    expect(stale.snapshot).toBe(workspace)
    expect(stale.issues).toMatchObject([{ code: 'stale-revision', path: '/expectedRevision' }])
    expect(controller.validateGraph(workspace.graph).valid).toBe(true)

    const bindings = {
      source: {
        value: input,
        identity: {
          kind: 'application-defined' as const,
          namespace: 'purejsimage.tests.workflow-dataset',
          value: 'workflow-fixture',
        },
        characteristics: scientificDatasetCharacteristics(input),
      },
      selection: { value: polygon },
    }
    const policy = {
      mode: 'pinned' as const,
      providerId: 'purejsimage.analysis.reference',
      providerVersion: 1,
    }
    const dryRun = await controller.dryRun(workspace.graph, { bindings, policy })
    expect(dryRun.valid).toBe(true)
    expect(dryRun.plan?.nodes.every((node) => node.provider.id === policy.providerId)).toBe(true)
    const plan = await controller.planGraph(workspace.graph, { bindings, policy })
    const cancelled = controller.executeGraph(plan)
    expect(controller.cancel(cancelled.id, new Error('workflow cancellation'))).toBe(true)
    await expect(cancelled.result).rejects.toThrow('Analysis node crop failed')

    const execution = await controller.executeGraph(plan).result
    const summaries: Record<string, ReturnType<typeof summarizeResult>> = {}
    for (const [name, value] of execution.outputs) {
      const result: AnalysisResult = validateAnalysisResult(value)
      summaries[name] = summarizeResult(result, { maxPreviewValues: 16 })
    }
    expect(summaries.histogram).toMatchObject({ kind: 'histogram' })
    expect(summaries.statistics).toMatchObject({ kind: 'collection' })
    expect(JSON.stringify(summaries).length).toBeLessThan(8_192)
    expect(
      execution.provenance.nodes.every(
        (node) => node.provider.id === 'purejsimage.analysis.reference',
      ),
    ).toBe(true)
    expect(
      execution.provenance.nodes.map((node) => node.implementation.implementationVersion),
    ).toEqual(['1.0.0', '1.0.0', '1.0.0', '1.0.0'])
    await execution.release()
    runtime.clear()
  })

  it('composes the trusted pointwise example explicitly without global registration', async () => {
    const runtime = createTileRuntime()
    const first = createBuiltInAnalysisBundle({ descriptor, runtime, sessionId: 'bundle-one' })
    const second = createBuiltInAnalysisBundle({ descriptor, runtime, sessionId: 'bundle-two' })
    expect(first.operations.capabilitySnapshot.operations).toHaveLength(9)
    expect(second.operations.capabilitySnapshot.operations).toHaveLength(9)
    const host = createExtensionHost({
      extensions: [trustedPointwiseExtension],
      operations: first.operations.definitions(),
      valueTypes: first.valueTypes.definitions(),
      providers: first.providers,
    })
    expect(host.operations.capabilitySnapshot.operations).toHaveLength(10)
    expect(second.operations.capabilitySnapshot.operations).toHaveLength(9)
    const prepared = await host.prepare()
    expect(prepared.manifest.extensions).toMatchObject([{ id: 'example.analysis-pointwise' }])
    expect(prepared.manifest.providers.map((entry) => entry.id)).toEqual([
      'purejsimage.analysis.reference',
      'example.analysis-pointwise.affine-reference',
    ])
    expect(JSON.parse(JSON.stringify(prepared.manifest))).toEqual(prepared.manifest)
    runtime.clear()
  })
})
