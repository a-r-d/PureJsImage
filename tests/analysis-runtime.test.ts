import { describe, expect, it } from 'vitest'
import {
  AnalysisNodeExecutionError,
  createAnalysisController,
  dryRun,
  executeGraph,
  planGraph,
} from '../src/analysis/index.ts'
import type { AnalysisGraph } from '../src/analysis/index.ts'
import {
  createOperationDefinition,
  createOperationProvider,
  createOperationRegistry,
  createValueTypeDefinition,
  createValueTypeRegistry,
} from '../src/operations/index.ts'
import type { OperationProviderKind } from '../src/operations/index.ts'

const numberType = createValueTypeDefinition({
  descriptor: { id: 'example.value.number', version: 1, title: 'Number' },
})

const multiply = createOperationDefinition({
  descriptor: {
    id: 'example.number.multiply',
    version: 1,
    title: 'Multiply',
    category: 'analysis',
    tags: [],
    inputs: [{ name: 'value', valueType: { id: 'example.value.number', version: 1 } }],
    outputs: [{ name: 'result', valueType: { id: 'example.value.number', version: 1 } }],
    parameters: {
      type: 'object',
      properties: { factor: { type: 'number', default: 2, finiteOnly: true } },
      closed: true,
    },
    execution: 'tile-local',
    reproducibility: { class: 'bit-exact' },
  },
  inferOutputShapes: () => ({
    valid: true,
    issues: Object.freeze([]),
    value: Object.freeze([Object.freeze({ kind: 'scalar' })]),
  }),
})

const operations = createOperationRegistry([multiply])
const valueTypes = createValueTypeRegistry([numberType])

const graph = (): AnalysisGraph => ({
  schemaVersion: 1,
  inputs: [{ name: 'source', valueType: { id: 'example.value.number', version: 1 } }],
  nodes: [
    {
      id: 'first',
      operation: { id: 'example.number.multiply', version: 1 },
      inputs: [{ port: 'value', source: { kind: 'input', input: 'source' } }],
      parameters: { factor: 2 },
    },
    {
      id: 'second',
      operation: { id: 'example.number.multiply', version: 1 },
      inputs: [{ port: 'value', source: { kind: 'node', nodeId: 'first', output: 'result' } }],
      parameters: { factor: 3 },
    },
  ],
  outputs: [{ name: 'answer', source: { kind: 'node', nodeId: 'second', output: 'result' } }],
})

const numberParameter = (value: unknown): number => {
  if (value === null || typeof value !== 'object' || !('factor' in value)) {
    throw new TypeError('Missing factor')
  }
  const result = value.factor
  if (typeof result !== 'number') throw new TypeError('factor must be a number')
  return result
}

const numberInput = (value: unknown): number => {
  if (typeof value !== 'number') throw new TypeError('Input must be a number')
  return value
}

const provider = (options: {
  readonly id: string
  readonly kind: OperationProviderKind
  readonly cost: number
  readonly confidence?: number
  readonly events: string[]
  readonly releases: number[]
}) =>
  createOperationProvider({
    descriptor: {
      id: options.id,
      version: 1,
      kind: options.kind,
      buildFingerprint: `${options.id}-build-1`,
    },
    prepare: async () => [
      {
        descriptor: {
          operationId: 'example.number.multiply',
          operationVersion: 1,
          implementationVersion: '1.0.0',
          bitExactConformance: true,
        },
        supports: () => true,
        estimate: () => ({
          setupMilliseconds: options.cost,
          transferMilliseconds: 0,
          computeMilliseconds: options.cost,
          readbackMilliseconds: 0,
          retainedBytes: 8,
          peakWorkingBytes: 8,
          transferBytes: 0,
          outputBytes: 8,
          confidence: options.confidence ?? 1,
        }),
        async execute(request) {
          const input = numberInput(request.inputs[0])
          const factor = numberParameter(request.parameters)
          options.events.push(`execute:${input}:${factor}`)
          const output = input * factor
          return Object.freeze([
            Object.freeze({
              value: output,
              release(): void {
                options.releases.push(output)
              },
            }),
          ])
        },
      },
    ],
  })

describe('analysis planning and execution', () => {
  it('disposes prepared providers when planning fails after preparation', async () => {
    let disposals = 0
    const unavailable = createOperationProvider({
      descriptor: {
        id: 'example.unavailable',
        version: 1,
        kind: 'reference',
        buildFingerprint: 'unavailable-build-1',
      },
      prepare: async () => ({
        implementations: [],
        dispose: () => {
          disposals += 1
        },
      }),
    })
    await expect(
      planGraph({
        graph: graph(),
        operations,
        providers: [unavailable],
        bindings: { source: { value: 2 } },
      }),
    ).rejects.toThrow('No operation provider supports')
    expect(disposals).toBe(1)
  })

  it('plans without reading pixels and selects by measured policy rather than provider kind', async () => {
    let reads = 0
    const source = {
      size: 8,
      async read(): Promise<Uint8Array> {
        reads += 1
        throw new Error('Planning must not read values')
      },
    }
    const events: string[] = []
    const releases: number[] = []
    const reference = provider({
      id: 'example.reference',
      kind: 'reference',
      cost: 10,
      events,
      releases,
    })
    const wasm = provider({ id: 'example.wasm', kind: 'wasm', cost: 1, events, releases })
    const planned = await planGraph({
      graph: graph(),
      operations,
      providers: [reference, wasm],
      bindings: {
        source: {
          value: source,
          valueType: { id: 'example.value.number', version: 1 },
          characteristics: { shape: 'scalar' },
        },
      },
    })
    expect(reads).toBe(0)
    expect(planned.summary.nodes.map((node) => node.provider.id)).toEqual([
      'example.wasm',
      'example.wasm',
    ])
    expect(planned.summary.nodes[0]?.outputValueTypes).toEqual([
      { name: 'result', id: 'example.value.number', version: 1 },
    ])
    expect(planned.summary.requiredInputIdentities[0]).toMatchObject({
      input: 'source',
      identity: { kind: 'session', size: 8 },
    })
    const repeated = await planGraph({
      graph: graph(),
      operations,
      providers: [reference, wasm],
      bindings: {
        source: {
          value: source,
          valueType: { id: 'example.value.number', version: 1 },
          characteristics: { shape: 'scalar' },
        },
      },
    })
    expect(repeated.summary).toEqual(planned.summary)

    const referencePlan = await planGraph({
      graph: graph(),
      operations,
      providers: [reference, wasm],
      bindings: { source: { value: 2 } },
      policy: { mode: 'reference-only' },
    })
    expect(
      referencePlan.summary.nodes.every((node) => node.provider.id === 'example.reference'),
    ).toBe(true)
    expect(JSON.parse(JSON.stringify(referencePlan.summary))).toEqual(referencePlan.summary)

    const disallowed = createOperationProvider({
      descriptor: {
        id: 'example.disallowed',
        version: 1,
        kind: 'webgpu',
        buildFingerprint: 'must-not-prepare',
      },
      prepare: async () => {
        throw new Error('Disallowed provider was prepared')
      },
    })
    await expect(
      planGraph({
        graph: graph(),
        operations,
        providers: [reference, disallowed],
        bindings: { source: { value: 2 } },
        policy: { mode: 'automatic', allowedProviderIds: ['example.reference'] },
      }),
    ).resolves.toMatchObject({ summary: { nodeOrder: ['first', 'second'] } })
  })

  it('returns structured dry-run failure when a pinned provider is unavailable', async () => {
    const result = await dryRun({
      graph: graph(),
      operations,
      providers: [],
      bindings: { source: { value: 2 } },
      policy: { mode: 'pinned', providerId: 'missing.provider', providerVersion: 1 },
    })
    expect(result.valid).toBe(false)
    expect(result.plan).toBeNull()
    expect(result.issues[0]?.message).toContain('Pinned')
  })

  it('reports zero-confidence cost estimates explicitly in a JSON-safe plan', async () => {
    const uncertain = provider({
      id: 'example.uncertain',
      kind: 'reference',
      cost: 1,
      confidence: 0,
      events: [],
      releases: [],
    })
    const planned = await planGraph({
      graph: graph(),
      operations,
      providers: [uncertain],
      bindings: { source: { value: 2 } },
    })
    expect(planned.summary.unresolvedEstimates).toEqual([
      {
        nodeId: 'first',
        field: 'cost',
        reason: 'Provider reported zero confidence for its cost estimate',
      },
      {
        nodeId: 'second',
        field: 'cost',
        reason: 'Provider reported zero confidence for its cost estimate',
      },
    ])
    expect(planned.summary.warnings.every((entry) => entry.code === 'unresolved-estimate')).toBe(
      true,
    )
  })

  it('executes dependencies, releases intermediates at last use, and records provenance', async () => {
    const events: string[] = []
    const releases: number[] = []
    const reference = provider({
      id: 'example.reference',
      kind: 'reference',
      cost: 1,
      events,
      releases,
    })
    const planned = await planGraph({
      graph: graph(),
      operations,
      providers: [reference],
      bindings: { source: { value: 2 } },
    })
    const task = executeGraph({
      plan: planned,
      library: { version: '0.9.0', buildFingerprint: 'test-build' },
    })
    const result = await task.result
    expect(Object.isFrozen(result.outputs)).toBe(true)
    expect('set' in result.outputs).toBe(false)
    expect('delete' in result.outputs).toBe(false)
    expect('clear' in result.outputs).toBe(false)
    expect(events).toEqual(['execute:2:2', 'execute:4:3'])
    expect(result.outputs.get('answer')).toBe(12)
    expect(releases).toEqual([4])
    expect(result.provenance).toMatchObject({
      graphHash: planned.summary.graphHash,
      graphSchemaVersion: 1,
      library: { version: '0.9.0', buildFingerprint: 'test-build' },
    })
    expect(result.provenance.nodes[0]).toMatchObject({
      nodeId: 'first',
      provider: { id: 'example.reference', buildFingerprint: 'example.reference-build-1' },
      implementation: { implementationVersion: '1.0.0' },
      reproducibility: { class: 'bit-exact' },
      executionPhase: 'graph-invocation',
      materialization: 'complete',
    })
    expect(result.provenance.timingScope).toContain('Graph invocation only')
    await result.release()
    await result.release()
    expect(releases).toEqual([4, 12])
    expect(result.outputs.size).toBe(0)
    await planned.dispose()
    await planned.dispose()
    await expect(
      executeGraph({
        plan: planned,
        library: { version: '0.9.0', buildFingerprint: 'test-build' },
      }).result,
    ).rejects.toThrow('disposed')
  })

  it('keeps controller commands separate from execution and exposes JSON-only capabilities', async () => {
    let executions = 0
    const trackingProvider = createOperationProvider({
      descriptor: {
        id: 'example.reference',
        version: 1,
        kind: 'reference',
        buildFingerprint: 'controller-build',
      },
      prepare: async () => [
        {
          descriptor: {
            operationId: 'example.number.multiply',
            operationVersion: 1,
            implementationVersion: '1.0.0',
            bitExactConformance: true,
          },
          supports: () => true,
          estimate: () => ({
            setupMilliseconds: 0,
            transferMilliseconds: 0,
            computeMilliseconds: 1,
            readbackMilliseconds: 0,
            retainedBytes: 8,
            peakWorkingBytes: 8,
            transferBytes: 0,
            outputBytes: 8,
            confidence: 1,
          }),
          async execute(request) {
            executions += 1
            return [{ value: numberInput(request.inputs[0]) * 2, release: () => undefined }]
          },
        },
      ],
    })
    const controller = createAnalysisController({
      operations,
      valueTypes,
      providers: [trackingProvider],
      library: { version: '0.9.0', buildFingerprint: 'controller-test' },
    })
    let workspace = controller.createWorkspace()
    const commands: readonly unknown[] = [
      {
        schemaVersion: 1,
        id: 'input',
        kind: 'bind-input',
        expectedRevision: 0,
        input: { name: 'source', valueType: { id: 'example.value.number', version: 1 } },
      },
      {
        schemaVersion: 1,
        id: 'node',
        kind: 'add-node',
        expectedRevision: 1,
        node: {
          id: 'double',
          operation: { id: 'example.number.multiply', version: 1 },
          inputs: [],
          parameters: {},
        },
      },
      {
        schemaVersion: 1,
        id: 'edge',
        kind: 'connect',
        expectedRevision: 2,
        nodeId: 'double',
        port: 'value',
        source: { kind: 'input', input: 'source' },
      },
      {
        schemaVersion: 1,
        id: 'output',
        kind: 'set-output',
        expectedRevision: 3,
        output: { name: 'answer', source: { kind: 'node', nodeId: 'double', output: 'result' } },
      },
    ]
    for (const command of commands) {
      const application = controller.applyCommand(workspace, command)
      expect(application.applied).toBe(true)
      workspace = application.snapshot
    }
    expect(executions).toBe(0)
    expect(controller.validateGraph(workspace.graph).valid).toBe(true)
    expect(JSON.parse(JSON.stringify(controller.capabilities))).toEqual(controller.capabilities)
    expect(controller.capabilities.trustBoundary).toContain('not a sandbox')
    expect(controller.capabilities.commandDescriptors).toHaveLength(
      controller.capabilities.commandKinds.length,
    )
    expect(controller.capabilities.commandKinds).not.toContain('add-roi')
    expect(controller.capabilities.commandDescriptors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'add-node',
          mutatesWorkspace: true,
          requiresExpectedRevision: false,
          schema: expect.objectContaining({
            type: 'object',
            required: expect.arrayContaining(['schemaVersion', 'id', 'kind', 'node']),
          }),
        }),
      ]),
    )
    const planned = await controller.planGraph(workspace.graph, {
      bindings: { source: { value: 4 } },
    })
    expect(executions).toBe(0)
    const task = controller.executeGraph(planned)
    expect((await task.result).outputs.get('answer')).toBe(8)
    expect(executions).toBe(1)
  })

  it('preserves node and provider context when execution fails', async () => {
    const failing = createOperationProvider({
      descriptor: {
        id: 'example.failure',
        version: 1,
        kind: 'reference',
        buildFingerprint: 'failure-build',
      },
      prepare: async () => [
        {
          descriptor: {
            operationId: 'example.number.multiply',
            operationVersion: 1,
            implementationVersion: '1.0.0',
            bitExactConformance: true,
          },
          supports: () => true,
          estimate: () => ({
            setupMilliseconds: 0,
            transferMilliseconds: 0,
            computeMilliseconds: 1,
            readbackMilliseconds: 0,
            retainedBytes: 0,
            peakWorkingBytes: 0,
            transferBytes: 0,
            outputBytes: 0,
            confidence: 1,
          }),
          async execute() {
            throw new Error('private provider detail')
          },
        },
      ],
    })
    const planned = await planGraph({
      graph: graph(),
      operations,
      providers: [failing],
      bindings: { source: { value: 2 } },
    })
    const task = executeGraph({
      plan: planned,
      library: { version: '0.9.0', buildFingerprint: 'test' },
    })
    await expect(task.result).rejects.toMatchObject({
      name: 'AnalysisNodeExecutionError',
      nodeId: 'first',
      providerFingerprint: 'failure-build',
      operation: { id: 'example.number.multiply', version: 1 },
    })
    await task.result.catch((error: unknown) => {
      expect(error).toBeInstanceOf(AnalysisNodeExecutionError)
      if (error instanceof AnalysisNodeExecutionError) {
        expect(error.cause).toBeInstanceOf(Error)
      }
    })
  })

  it('honors cancellation and bounded parallelism without retrying work', async () => {
    let active = 0
    let maxActive = 0
    let executions = 0
    const controlled = createOperationProvider({
      descriptor: {
        id: 'example.controlled',
        version: 1,
        kind: 'reference',
        buildFingerprint: 'controlled-build',
      },
      prepare: async () => [
        {
          descriptor: {
            operationId: 'example.number.multiply',
            operationVersion: 1,
            implementationVersion: '1.0.0',
            bitExactConformance: true,
          },
          supports: () => true,
          estimate: () => ({
            setupMilliseconds: 0,
            transferMilliseconds: 0,
            computeMilliseconds: 1,
            readbackMilliseconds: 0,
            retainedBytes: 8,
            peakWorkingBytes: 8,
            transferBytes: 0,
            outputBytes: 8,
            confidence: 1,
          }),
          async execute(request) {
            executions += 1
            active += 1
            maxActive = Math.max(maxActive, active)
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(resolve, 5)
              request.signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(timeout)
                  reject(request.signal.reason)
                },
                { once: true },
              )
            })
            active -= 1
            return [{ value: numberInput(request.inputs[0]) * 2, release: () => undefined }]
          },
        },
      ],
    })
    const parallelGraph: AnalysisGraph = {
      schemaVersion: 1,
      inputs: [{ name: 'source', valueType: { id: 'example.value.number', version: 1 } }],
      nodes: [
        {
          id: 'left',
          operation: { id: 'example.number.multiply', version: 1 },
          inputs: [{ port: 'value', source: { kind: 'input', input: 'source' } }],
          parameters: {},
        },
        {
          id: 'right',
          operation: { id: 'example.number.multiply', version: 1 },
          inputs: [{ port: 'value', source: { kind: 'input', input: 'source' } }],
          parameters: {},
        },
      ],
      outputs: [
        { name: 'left', source: { kind: 'node', nodeId: 'left', output: 'result' } },
        { name: 'right', source: { kind: 'node', nodeId: 'right', output: 'result' } },
      ],
    }
    const parallelPlan = await planGraph({
      graph: parallelGraph,
      operations,
      providers: [controlled],
      bindings: { source: { value: 3 } },
    })
    const parallelTask = executeGraph({
      plan: parallelPlan,
      library: { version: '0.9.0', buildFingerprint: 'test' },
      limits: { maxParallelism: 1 },
    })
    const parallelResult = await parallelTask.result
    expect(maxActive).toBe(1)
    expect(executions).toBe(2)
    await parallelResult.release()

    const cancellationPlan = await planGraph({
      graph: {
        ...parallelGraph,
        nodes: parallelGraph.nodes.slice(0, 1),
        outputs: parallelGraph.outputs.slice(0, 1),
      },
      operations,
      providers: [controlled],
      bindings: { source: { value: 3 } },
    })
    const cancellationTask = executeGraph({
      plan: cancellationPlan,
      library: { version: '0.9.0', buildFingerprint: 'test' },
    })
    cancellationTask.cancel(new Error('cancel requested'))
    await expect(cancellationTask.result).rejects.toMatchObject({
      name: 'AnalysisNodeExecutionError',
      nodeId: 'left',
      cause: expect.objectContaining({ message: 'cancel requested' }),
    })
    expect(executions).toBe(3)
  })
})
