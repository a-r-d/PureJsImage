import { combineAbortSignals } from '../abort.ts'
import { invalidInput } from '../errors.ts'
import type { OperationJsonObject, OperationJsonValue } from '../operations/descriptor.ts'
import type { OperationExecutionRequest, OperationOwnedOutput } from '../operations/provider.ts'
import { validateOperationOwnedOutputs } from '../operations/provider.ts'
import type { AnalysisLimits, AnalysisValueReference } from './graph.ts'
import { resolveAnalysisLimits } from './graph.ts'
import type { PreparedAnalysisPlan } from './planner.ts'

export interface AnalysisLibraryBuild extends OperationJsonObject {
  readonly version: string
  readonly buildFingerprint: string
}

export interface AnalysisNodeProvenance extends OperationJsonObject {
  readonly nodeId: string
  readonly operation: OperationJsonObject
  readonly parameterHash: string
  readonly provider: OperationJsonObject
  readonly implementation: OperationJsonObject
  readonly reproducibility: OperationJsonObject
  readonly estimate: OperationJsonObject
  readonly executionPhase: 'graph-invocation'
  readonly materialization: 'complete' | 'lazy' | 'global-prepared-lazy'
}

export interface AnalysisExecutionProvenance extends OperationJsonObject {
  readonly graphHash: string
  readonly bindingHash: string
  readonly invocationHash: string
  readonly graphSchemaVersion: number
  readonly inputs: readonly OperationJsonValue[]
  readonly nodes: readonly AnalysisNodeProvenance[]
  readonly library: AnalysisLibraryBuild
  readonly startedAt: string
  readonly endedAt: string
  readonly elapsedMilliseconds: number
  readonly warnings: readonly OperationJsonValue[]
  readonly fallbacks: readonly OperationJsonValue[]
  readonly timingScope: string
}

export interface AnalysisExecutionResult {
  readonly outputs: AnalysisExecutionOutputs
  readonly provenance: AnalysisExecutionProvenance
  release(): Promise<void>
}

export interface AnalysisExecutionOutputs extends Iterable<readonly [string, unknown]> {
  readonly size: number
  get(name: string): unknown
  has(name: string): boolean
  entries(): IterableIterator<readonly [string, unknown]>
  keys(): IterableIterator<string>
  values(): IterableIterator<unknown>
}

const executionOutputsView = (values: ReadonlyMap<string, unknown>): AnalysisExecutionOutputs => {
  const view: AnalysisExecutionOutputs = {
    get size(): number {
      return values.size
    },
    get: (name) => values.get(name),
    has: (name) => values.has(name),
    entries: () => values.entries(),
    keys: () => values.keys(),
    values: () => values.values(),
    [Symbol.iterator]: () => values.entries(),
  }
  return Object.freeze(view)
}

export interface ExecuteGraphOptions {
  readonly plan: PreparedAnalysisPlan
  readonly library: AnalysisLibraryBuild
  readonly limits?: Readonly<AnalysisLimits>
  readonly signal?: AbortSignal
}

export interface AnalysisExecutionTask {
  readonly id: string
  readonly result: Promise<AnalysisExecutionResult>
  cancel(reason?: unknown): void
}

export class AnalysisNodeExecutionError extends Error {
  readonly nodeId: string
  readonly operation: { readonly id: string; readonly version: number }
  readonly providerFingerprint: string

  constructor(options: {
    readonly nodeId: string
    readonly operation: { readonly id: string; readonly version: number }
    readonly providerFingerprint: string
    readonly cause: unknown
  }) {
    super(
      `Analysis node ${options.nodeId} failed in ${options.operation.id}@${options.operation.version} using ${options.providerFingerprint}`,
      { cause: options.cause },
    )
    this.name = 'AnalysisNodeExecutionError'
    this.nodeId = options.nodeId
    this.operation = Object.freeze({ ...options.operation })
    this.providerFingerprint = options.providerFingerprint
  }
}

const sourceKey = (source: AnalysisValueReference): string =>
  source.kind === 'input'
    ? `input\u0000${source.input}`
    : `node\u0000${source.nodeId}\u0000${source.output}`

const scientificDatasetValueTypeId = 'purejsimage.scientific.dataset'

const releaseOwned = async (outputs: Iterable<OperationOwnedOutput>): Promise<void> => {
  let firstError: unknown
  for (const output of new Set(outputs)) {
    try {
      await output.release()
    } catch (error) {
      firstError ??= error
    }
  }
  if (firstError !== undefined) throw firstError
}

const reproducibilityObject = (value: Readonly<Record<string, unknown>>): OperationJsonObject => {
  if (value.class === 'tolerance-based') {
    return Object.freeze({
      class: 'tolerance-based',
      absolute: typeof value.absolute === 'number' ? value.absolute : 0,
      relative: typeof value.relative === 'number' ? value.relative : 0,
    })
  }
  return Object.freeze({ class: typeof value.class === 'string' ? value.class : 'backend-stable' })
}

const executePrepared = async (
  options: Readonly<ExecuteGraphOptions>,
  taskSignal: AbortSignal,
): Promise<AnalysisExecutionResult> => {
  const plan = options.plan
  if (plan.isDisposed()) throw invalidInput('Prepared analysis plan is disposed')
  const limits = resolveAnalysisLimits(options.limits)
  const startedAt = new Date()
  const startTime = performance.now()
  const nodeById = new Map(plan.graph.nodes.map((node) => [node.id, node]))
  const order = plan.validation.nodeOrder ?? []
  const depth = new Map<string, number>()
  for (const nodeId of order) {
    const node = nodeById.get(nodeId)
    let value = 0
    for (const input of node?.inputs ?? []) {
      if (input.source.kind === 'node')
        value = Math.max(value, (depth.get(input.source.nodeId) ?? 0) + 1)
    }
    depth.set(nodeId, value)
  }
  const levels = new Map<number, string[]>()
  for (const nodeId of order) {
    const level = depth.get(nodeId) ?? 0
    const ids = levels.get(level) ?? []
    ids.push(nodeId)
    levels.set(level, ids)
  }
  const consumers = new Map<string, number>()
  for (const node of plan.graph.nodes) {
    for (const input of node.inputs) {
      if (input.source.kind === 'node') {
        const key = sourceKey(input.source)
        consumers.set(key, (consumers.get(key) ?? 0) + 1)
      }
    }
  }
  for (const output of plan.graph.outputs) {
    if (output.source.kind === 'node') {
      const key = sourceKey(output.source)
      consumers.set(key, (consumers.get(key) ?? 0) + 1)
    }
  }
  const values = new Map<string, OperationOwnedOutput>()
  const allOwned = new Set<OperationOwnedOutput>()
  const datasetOutputs = new Set<string>()
  const deferredDatasetDependencies = new Set<OperationOwnedOutput>()
  const releaseInput = async (source: AnalysisValueReference): Promise<void> => {
    if (source.kind !== 'node') return
    const key = sourceKey(source)
    const remaining = (consumers.get(key) ?? 0) - 1
    consumers.set(key, remaining)
    if (remaining !== 0) return
    const owned = values.get(key)
    if (owned === undefined) return
    values.delete(key)
    if (datasetOutputs.delete(key)) {
      deferredDatasetDependencies.add(owned)
      return
    }
    allOwned.delete(owned)
    await owned.release()
  }
  const resolveValue = (source: AnalysisValueReference): unknown => {
    if (source.kind === 'input') return plan.bindings.get(source.input)?.value
    const owned = values.get(sourceKey(source))
    if (owned === undefined)
      throw invalidInput(`Planned value ${source.nodeId}.${source.output} is unavailable`)
    return owned.value
  }
  const executeNode = async (nodeId: string): Promise<void> => {
    taskSignal.throwIfAborted()
    const node = nodeById.get(nodeId)
    const selection = plan.selections.get(nodeId)
    const definition =
      node === undefined
        ? undefined
        : plan.operations.get(node.operation.id, node.operation.version)
    if (node === undefined || selection === undefined || definition === undefined)
      throw invalidInput(`Prepared node ${nodeId} is incomplete`)
    const request: OperationExecutionRequest = {
      descriptor: definition.descriptor,
      parameters: plan.normalizedParameters.get(nodeId) ?? node.parameters,
      inputs: node.inputs.map((input) => resolveValue(input.source)),
      plannedInputCharacteristics: plan.inputCharacteristics.get(nodeId) ?? Object.freeze([]),
      provider: selection.provider.descriptor,
      implementation: selection.implementation.descriptor,
      selection,
      signal: taskSignal,
    }
    const inputOwnershipIdentities: object[] = []
    for (const input of node.inputs) {
      if (input.source.kind !== 'node') continue
      const identity = values.get(sourceKey(input.source))?.ownershipIdentity
      if (identity !== undefined) inputOwnershipIdentities.push(identity)
    }
    let outputs: readonly OperationOwnedOutput[] | undefined
    try {
      selection.implementation.validateExecution?.(request)
      outputs = await selection.implementation.execute(request)
      taskSignal.throwIfAborted()
      if (outputs.length !== definition.descriptor.outputs.length) {
        throw invalidInput(
          `Provider returned ${outputs.length} outputs; expected ${definition.descriptor.outputs.length}`,
        )
      }
      validateOperationOwnedOutputs(outputs, request.inputs, inputOwnershipIdentities)
    } catch (cause) {
      if (outputs !== undefined) {
        try {
          await releaseOwned(outputs)
        } catch {
          // Preserve the execution failure as the primary cause.
        }
      }
      throw new AnalysisNodeExecutionError({
        nodeId,
        operation: node.operation,
        providerFingerprint: selection.provider.descriptor.buildFingerprint,
        cause,
      })
    }
    for (let index = 0; index < outputs.length; index += 1) {
      const output = outputs[index]
      const port = definition.descriptor.outputs[index]
      if (output === undefined || port === undefined) continue
      const key = sourceKey({ kind: 'node', nodeId, output: port.name })
      values.set(key, output)
      allOwned.add(output)
      if (port.valueType.id === scientificDatasetValueTypeId) datasetOutputs.add(key)
      if ((consumers.get(key) ?? 0) === 0) {
        values.delete(key)
        datasetOutputs.delete(key)
        allOwned.delete(output)
        await output.release()
      }
    }
    for (const input of node.inputs) await releaseInput(input.source)
  }
  const lease = plan.acquireExecutionLease()
  let leaseReleased = false
  const releaseLease = async (): Promise<void> => {
    if (leaseReleased) return
    leaseReleased = true
    await lease.release()
  }
  try {
    for (const ids of [...levels.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, ids]) => ids)) {
      for (let offset = 0; offset < ids.length; offset += limits.maxParallelism) {
        const batch = ids.slice(offset, offset + limits.maxParallelism)
        const settled = await Promise.allSettled(batch.map(executeNode))
        const failure = settled.find((result) => result.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
      }
    }
    const outputValues = new Map<string, unknown>()
    const outputView = executionOutputsView(outputValues)
    const retained = new Set<OperationOwnedOutput>(deferredDatasetDependencies)
    for (const output of plan.graph.outputs) {
      if (output.source.kind === 'input') {
        outputValues.set(output.name, plan.bindings.get(output.source.input)?.value)
        continue
      }
      const owned = values.get(sourceKey(output.source))
      if (owned === undefined) throw invalidInput(`Graph output ${output.name} is unavailable`)
      outputValues.set(output.name, owned.value)
      retained.add(owned)
    }
    const endedAt = new Date()
    const planNodes = new Map(plan.summary.nodes.map((node) => [node.nodeId, node]))
    const nodeProvenance: AnalysisNodeProvenance[] = []
    for (const nodeId of order) {
      const node = nodeById.get(nodeId)
      const planned = planNodes.get(nodeId)
      const definition =
        node === undefined
          ? undefined
          : plan.operations.get(node.operation.id, node.operation.version)
      if (node === undefined || planned === undefined || definition === undefined) continue
      nodeProvenance.push(
        Object.freeze({
          nodeId,
          operation: planned.operation,
          parameterHash: planned.parameterHash,
          provider: planned.provider,
          implementation: planned.implementation,
          reproducibility: reproducibilityObject(definition.descriptor.reproducibility),
          estimate: planned.estimate,
          executionPhase: 'graph-invocation',
          materialization:
            definition.descriptor.execution === 'global-transform'
              ? 'global-prepared-lazy'
              : definition.descriptor.outputs.some(
                    (output) => output.valueType.id === 'purejsimage.scientific.dataset',
                  )
                ? 'lazy'
                : 'complete',
        }),
      )
    }
    let released = false
    return Object.freeze({
      outputs: outputView,
      provenance: Object.freeze({
        graphHash: plan.summary.graphHash,
        bindingHash: plan.summary.invocation.bindingHash,
        invocationHash: plan.summary.invocation.invocationHash,
        graphSchemaVersion: plan.graph.schemaVersion,
        inputs: plan.summary.invocation.bindings,
        nodes: Object.freeze(nodeProvenance),
        library: Object.freeze({ ...options.library }),
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        elapsedMilliseconds: performance.now() - startTime,
        warnings: plan.summary.warnings,
        fallbacks: Object.freeze([]),
        timingScope:
          'Graph invocation only; lazy dataset tiles materialize later through the tile runtime',
      }),
      async release(): Promise<void> {
        if (released) return
        released = true
        try {
          await releaseOwned(retained)
        } finally {
          for (const output of retained) allOwned.delete(output)
          values.clear()
          datasetOutputs.clear()
          deferredDatasetDependencies.clear()
          outputValues.clear()
          retained.clear()
          await releaseLease()
        }
      },
    })
  } catch (error) {
    try {
      await releaseOwned(allOwned)
    } catch {
      // Preserve the graph or node failure as the primary error.
    }
    await releaseLease()
    throw error
  }
}

let taskCounter = 0

export const executeGraph = (options: Readonly<ExecuteGraphOptions>): AnalysisExecutionTask => {
  const controller = new AbortController()
  const signal = combineAbortSignals(controller.signal, options.signal) ?? controller.signal
  const id = `analysis-task-${++taskCounter}`
  return Object.freeze({
    id,
    result: executePrepared(options, signal),
    cancel(reason?: unknown): void {
      controller.abort(reason)
    },
  })
}
