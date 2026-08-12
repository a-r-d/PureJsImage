import { invalidInput } from '../errors.ts'
import type { OperationJsonObject, OperationJsonValue } from '../operations/descriptor.ts'
import type {
  OperationCostEstimate,
  OperationProvider,
  OperationProviderPolicy,
  OperationProviderSelection,
  OperationProviderRequest,
} from '../operations/provider.ts'
import { prepareOperationRuntime } from '../operations/provider.ts'
import type { OperationRegistry, ValueTypeRegistry } from '../operations/registry.ts'
import type { ImageSource } from '../source.ts'
import type { SourceIdentity } from '../source-identity.ts'
import { getImageSourceIdentity, normalizeSourceIdentity } from '../source-identity.ts'
import { hashCanonicalJson } from './canonical-json.ts'
import type {
  AnalysisGraph,
  AnalysisGraphValidation,
  AnalysisIssue,
  AnalysisLimits,
  AnalysisValueReference,
} from './graph.ts'
import { hashAnalysisGraph, validateGraph } from './graph.ts'

export interface AnalysisInputBinding {
  readonly value: unknown
  readonly valueType?: { readonly id: string; readonly version: number }
  readonly identity?: SourceIdentity
  readonly characteristics?: OperationJsonObject
}

export interface AnalysisPlanCost extends OperationJsonObject {
  readonly setupMilliseconds: number
  readonly transferMilliseconds: number
  readonly computeMilliseconds: number
  readonly readbackMilliseconds: number
  readonly retainedBytes: number
  readonly confidence: number
}

export interface AnalysisPlanNode extends OperationJsonObject {
  readonly nodeId: string
  readonly operation: OperationJsonObject
  readonly parameterHash: string
  readonly provider: OperationJsonObject
  readonly implementation: OperationJsonObject
  readonly execution: string
  readonly estimate: AnalysisPlanCost
  readonly outputValueTypes: readonly OperationJsonObject[]
  readonly outputShapes: readonly OperationJsonValue[] | null
}

export interface AnalysisRequiredInputIdentity extends OperationJsonObject {
  readonly input: string
  readonly identity: OperationJsonObject
}

export interface AnalysisUnresolvedEstimate extends OperationJsonObject {
  readonly nodeId: string
  readonly field: 'cost' | 'outputShapes'
  readonly reason: string
}

export interface AnalysisPlan extends OperationJsonObject {
  readonly schemaVersion: 1
  readonly graphHash: string
  readonly nodeOrder: readonly string[]
  readonly nodes: readonly AnalysisPlanNode[]
  readonly totalEstimate: AnalysisPlanCost
  readonly requiredInputIdentities: readonly AnalysisRequiredInputIdentity[]
  readonly unresolvedEstimates: readonly AnalysisUnresolvedEstimate[]
  readonly warnings: readonly AnalysisIssue[]
}

export interface PreparedAnalysisPlan {
  readonly graph: AnalysisGraph
  readonly validation: AnalysisGraphValidation
  readonly operations: OperationRegistry
  readonly bindings: ReadonlyMap<string, AnalysisInputBinding>
  readonly selections: ReadonlyMap<string, OperationProviderSelection>
  readonly summary: AnalysisPlan
}

export interface PlanGraphOptions {
  readonly graph: unknown
  readonly operations: OperationRegistry
  readonly valueTypes?: ValueTypeRegistry
  readonly providers: Iterable<OperationProvider>
  readonly bindings: Readonly<Record<string, AnalysisInputBinding>>
  readonly policy?: OperationProviderPolicy
  readonly limits?: Readonly<AnalysisLimits>
  readonly signal?: AbortSignal
}

const providerAllowed = (provider: OperationProvider, policy: OperationProviderPolicy): boolean => {
  const descriptor = provider.descriptor
  if (policy.mode === 'reference-only') return descriptor.kind === 'reference'
  if (policy.mode === 'pinned') {
    return (
      descriptor.id === policy.providerId &&
      descriptor.version === policy.providerVersion &&
      (policy.buildFingerprint === undefined ||
        descriptor.buildFingerprint === policy.buildFingerprint)
    )
  }
  return (
    (policy.allowedProviderIds === undefined ||
      policy.allowedProviderIds.includes(descriptor.id)) &&
    (policy.allowedProviderKinds === undefined ||
      policy.allowedProviderKinds.includes(descriptor.kind))
  )
}

const isImageSource = (value: unknown): value is ImageSource =>
  value !== null &&
  typeof value === 'object' &&
  'size' in value &&
  typeof value.size === 'number' &&
  'read' in value &&
  typeof value.read === 'function'

const identityObject = (identity: SourceIdentity): OperationJsonObject => {
  if (identity.kind === 'content') return Object.freeze({ ...identity })
  if (identity.kind === 'local-file') return Object.freeze({ ...identity })
  if (identity.kind === 'session') return Object.freeze({ ...identity })
  return Object.freeze({
    kind: identity.kind,
    strength: identity.strength,
    stability: identity.stability,
    url: identity.url,
    size: identity.size,
    ...(identity.validator === undefined
      ? {}
      : { validator: Object.freeze({ ...identity.validator }) }),
  })
}

const costObject = (estimate: OperationCostEstimate): AnalysisPlanCost =>
  Object.freeze({
    setupMilliseconds: estimate.setupMilliseconds,
    transferMilliseconds: estimate.transferMilliseconds,
    computeMilliseconds: estimate.computeMilliseconds,
    readbackMilliseconds: estimate.readbackMilliseconds,
    retainedBytes: estimate.retainedBytes,
    confidence: estimate.confidence,
  })

const placeholder = (nodeId: string, output: string): OperationJsonObject =>
  Object.freeze({ plannedNode: nodeId, output })

const resolvePlanningInput = (
  source: AnalysisValueReference,
  bindings: ReadonlyMap<string, AnalysisInputBinding>,
): unknown =>
  source.kind === 'input'
    ? bindings.get(source.input)?.value
    : placeholder(source.nodeId, source.output)

const resolveCharacteristics = (
  source: AnalysisValueReference,
  bindings: ReadonlyMap<string, AnalysisInputBinding>,
  inferred: ReadonlyMap<string, OperationJsonValue>,
): OperationJsonValue =>
  source.kind === 'input'
    ? (bindings.get(source.input)?.characteristics ?? Object.freeze({}))
    : (inferred.get(`${source.nodeId}\u0000${source.output}`) ??
      placeholder(source.nodeId, source.output))

const warning = (path: string, message: string): AnalysisIssue =>
  Object.freeze({ code: 'unresolved-estimate', severity: 'warning', path, message })

const addCost = (target: number[], estimate: OperationCostEstimate): void => {
  target[0] = (target[0] ?? 0) + estimate.setupMilliseconds
  target[1] = (target[1] ?? 0) + estimate.transferMilliseconds
  target[2] = (target[2] ?? 0) + estimate.computeMilliseconds
  target[3] = (target[3] ?? 0) + estimate.readbackMilliseconds
  target[4] = Math.max(target[4] ?? 0, estimate.retainedBytes)
  target[5] = Math.min(target[5] ?? 1, estimate.confidence)
}

export const planGraph = async (
  options: Readonly<PlanGraphOptions>,
): Promise<PreparedAnalysisPlan> => {
  options.signal?.throwIfAborted()
  const validation = validateGraph(options.graph, options.operations, options.limits)
  if (validation.graph === undefined || validation.nodeOrder === undefined) {
    throw invalidInput(validation.issues[0]?.message ?? 'Analysis graph is invalid')
  }
  const graph = validation.graph
  const bindingEntries = Object.entries(options.bindings)
  const graphInputNames = new Set(graph.inputs.map((input) => input.name))
  const bindings = new Map<string, AnalysisInputBinding>()
  for (const input of graph.inputs) {
    const binding = options.bindings[input.name]
    if (binding === undefined) throw invalidInput(`Graph input ${input.name} is not bound`)
    if (
      binding.valueType !== undefined &&
      (binding.valueType.id !== input.valueType.id ||
        binding.valueType.version !== input.valueType.version)
    ) {
      throw invalidInput(`Graph input ${input.name} binding has an incompatible value type`)
    }
    const valueType = options.valueTypes?.get(input.valueType.id, input.valueType.version)
    if (valueType?.validate !== undefined) {
      const result = valueType.validate(binding.value)
      if (result.value === undefined) {
        const issue = result.issues[0]
        throw invalidInput(
          `Graph input ${input.name} is invalid at ${issue?.path ?? ''}: ${issue?.message ?? 'value validation failed'}`,
        )
      }
      bindings.set(input.name, Object.freeze({ ...binding, value: result.value }))
    } else {
      bindings.set(input.name, binding)
    }
  }
  for (const [name] of bindingEntries) {
    if (!graphInputNames.has(name)) throw invalidInput(`Unknown graph input binding ${name}`)
  }
  const requiredInputIdentities: AnalysisRequiredInputIdentity[] = []
  for (const input of graph.inputs) {
    options.signal?.throwIfAborted()
    const binding = bindings.get(input.name)
    if (binding === undefined) continue
    const identity =
      binding.identity === undefined
        ? isImageSource(binding.value)
          ? await getImageSourceIdentity(binding.value)
          : undefined
        : normalizeSourceIdentity(binding.identity)
    options.signal?.throwIfAborted()
    if (identity !== undefined) {
      requiredInputIdentities.push(
        Object.freeze({ input: input.name, identity: identityObject(identity) }),
      )
    }
  }
  const policy = options.policy ?? { mode: 'automatic' }
  const allowedProviders = [...options.providers].filter((provider) =>
    providerAllowed(provider, policy),
  )
  const runtime = await prepareOperationRuntime(allowedProviders, options.signal)
  options.signal?.throwIfAborted()
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const selections = new Map<string, OperationProviderSelection>()
  const nodes: AnalysisPlanNode[] = []
  const warnings: AnalysisIssue[] = []
  const unresolvedEstimates: AnalysisUnresolvedEstimate[] = []
  const inferredCharacteristics = new Map<string, OperationJsonValue>()
  const totals = [0, 0, 0, 0, 0, 1]
  const signal = options.signal ?? new AbortController().signal
  for (const nodeId of validation.nodeOrder) {
    signal.throwIfAborted()
    const node = nodeById.get(nodeId)
    if (node === undefined) throw invalidInput(`Planned node ${nodeId} is unavailable`)
    const definition = options.operations.get(node.operation.id, node.operation.version)
    if (definition === undefined)
      throw invalidInput(`Operation ${node.operation.id}@${node.operation.version} is unavailable`)
    const inputs = node.inputs.map((input) => resolvePlanningInput(input.source, bindings))
    const inputCharacteristics = Object.freeze({
      inputs: Object.freeze(
        node.inputs.map((input) =>
          resolveCharacteristics(input.source, bindings, inferredCharacteristics),
        ),
      ),
    })
    const request: OperationProviderRequest = {
      descriptor: definition.descriptor,
      parameters: node.parameters,
      inputs,
      inputCharacteristics,
      signal,
    }
    const selected = runtime.select(request, policy)
    selections.set(node.id, selected)
    addCost(totals, selected.estimate)
    if (selected.estimate.confidence === 0) {
      const reason = 'Provider reported zero confidence for its cost estimate'
      warnings.push(warning(`/nodes/${node.id}/estimate`, reason))
      unresolvedEstimates.push(Object.freeze({ nodeId: node.id, field: 'cost', reason }))
    }
    let outputShapes: readonly OperationJsonValue[] | null = null
    if (definition.inferOutputShapes !== undefined) {
      const inferred = definition.inferOutputShapes({
        parameters: node.parameters,
        inputs: node.inputs.map((input) =>
          resolveCharacteristics(input.source, bindings, inferredCharacteristics),
        ),
      })
      if (
        inferred.valid &&
        inferred.value !== undefined &&
        inferred.value.length === definition.descriptor.outputs.length
      ) {
        outputShapes = inferred.value
        for (let index = 0; index < inferred.value.length; index += 1) {
          const port = definition.descriptor.outputs[index]
          const shape = inferred.value[index]
          if (port !== undefined && shape !== undefined) {
            inferredCharacteristics.set(`${node.id}\u0000${port.name}`, shape)
          }
        }
      } else {
        const reason =
          inferred.issues[0]?.message ?? 'Output shape inference returned an invalid result'
        warnings.push(warning(`/nodes/${node.id}/outputShapes`, reason))
        unresolvedEstimates.push(Object.freeze({ nodeId: node.id, field: 'outputShapes', reason }))
      }
    } else {
      const reason = 'Operation does not provide metadata-only output inference'
      warnings.push(warning(`/nodes/${node.id}/outputShapes`, reason))
      unresolvedEstimates.push(Object.freeze({ nodeId: node.id, field: 'outputShapes', reason }))
    }
    nodes.push(
      Object.freeze({
        nodeId: node.id,
        operation: Object.freeze({ id: node.operation.id, version: node.operation.version }),
        parameterHash: await hashCanonicalJson(
          'purejsimage.operation-parameters.v1',
          node.parameters,
        ),
        provider: Object.freeze({ ...selected.provider.descriptor }),
        implementation: Object.freeze({ ...selected.implementation.descriptor }),
        execution: definition.descriptor.execution,
        estimate: costObject(selected.estimate),
        outputValueTypes: Object.freeze(
          definition.descriptor.outputs.map((output) =>
            Object.freeze({
              name: output.name,
              id: output.valueType.id,
              version: output.valueType.version ?? null,
            }),
          ),
        ),
        outputShapes,
      }),
    )
  }
  const summary: AnalysisPlan = Object.freeze({
    schemaVersion: 1,
    graphHash: await hashAnalysisGraph(graph),
    nodeOrder: validation.nodeOrder,
    nodes: Object.freeze(nodes),
    totalEstimate: Object.freeze({
      setupMilliseconds: totals[0] ?? 0,
      transferMilliseconds: totals[1] ?? 0,
      computeMilliseconds: totals[2] ?? 0,
      readbackMilliseconds: totals[3] ?? 0,
      retainedBytes: totals[4] ?? 0,
      confidence: totals[5] ?? 0,
    }),
    requiredInputIdentities: Object.freeze(requiredInputIdentities),
    unresolvedEstimates: Object.freeze(unresolvedEstimates),
    warnings: Object.freeze(warnings),
  })
  return Object.freeze({
    graph,
    validation,
    operations: options.operations,
    bindings,
    selections,
    summary,
  })
}

export interface AnalysisDryRun extends OperationJsonObject {
  readonly valid: boolean
  readonly issues: readonly AnalysisIssue[]
  readonly warnings: readonly AnalysisIssue[]
  readonly plan: AnalysisPlan | null
}

export const dryRun = async (options: Readonly<PlanGraphOptions>): Promise<AnalysisDryRun> => {
  const validation = validateGraph(options.graph, options.operations, options.limits)
  if (!validation.valid) {
    return Object.freeze({
      valid: false,
      issues: validation.issues,
      warnings: Object.freeze([]),
      plan: null,
    })
  }
  try {
    const prepared = await planGraph(options)
    return Object.freeze({
      valid: true,
      issues: Object.freeze([]),
      warnings: prepared.summary.warnings,
      plan: prepared.summary,
    })
  } catch (error) {
    return Object.freeze({
      valid: false,
      issues: Object.freeze([
        Object.freeze({
          code: 'invalid-graph',
          severity: 'error',
          path: '',
          message: error instanceof Error ? error.message : 'Analysis planning failed',
        }),
      ]),
      warnings: Object.freeze([]),
      plan: null,
    })
  }
}
