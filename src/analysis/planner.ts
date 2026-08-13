import { invalidInput } from '../errors.ts'
import type { OperationJsonObject, OperationJsonValue } from '../operations/descriptor.ts'
import type {
  OperationCostEstimate,
  OperationPlanningRequest,
  OperationProvider,
  OperationProviderPolicy,
  OperationProviderSelection,
} from '../operations/provider.ts'
import { prepareOperationRuntime } from '../operations/provider.ts'
import type { OperationRegistry, ValueTypeRegistry } from '../operations/registry.ts'
import type { ImageSource } from '../source.ts'
import type { ScientificDataset } from '../scientific/dataset-v2.ts'
import type { ScientificDatasetIdentity } from '../scientific/reader.ts'
import { getScientificDatasetIdentity } from '../scientific/reader.ts'
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
import { hashAnalysisGraph, validateGraphWithValueTypes } from './graph.ts'
import type { Roi, RoiSet } from './roi.ts'
import {
  canonicalNormalizedRoiSemanticsJson,
  canonicalNormalizedRoiSetSemanticsJson,
  roiSetValueTypeId,
  roiValueTypeId,
} from './roi.ts'

export type AnalysisSemanticIdentity =
  | SourceIdentity
  | ScientificDatasetIdentity
  | {
      readonly kind: 'semantic-json'
      readonly domain: string
      readonly sha256: string
    }
  | {
      readonly kind: 'application-defined'
      readonly namespace: string
      readonly value: string
    }

export interface AnalysisInputBinding {
  readonly value: unknown
  readonly valueType?: { readonly id: string; readonly version: number }
  readonly identity?: AnalysisSemanticIdentity
  readonly characteristics?: OperationJsonObject
}

export interface AnalysisPlanCost extends OperationJsonObject {
  readonly setupMilliseconds: number
  readonly transferMilliseconds: number
  readonly computeMilliseconds: number
  readonly readbackMilliseconds: number
  readonly retainedBytes: number
  readonly peakWorkingBytes: number
  readonly transferBytes: number
  readonly outputBytes: number
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
  readonly valueType: OperationJsonObject
  readonly identity: OperationJsonObject
}

export type AnalysisBindingIdentity = AnalysisRequiredInputIdentity

export interface AnalysisInvocationManifest extends OperationJsonObject {
  readonly schemaVersion: 1
  readonly graphHash: string
  readonly bindings: readonly AnalysisBindingIdentity[]
  readonly bindingHash: string
  readonly invocationHash: string
}

export const computeAnalysisInvocationManifest = async (
  graphHash: string,
  bindings: readonly AnalysisBindingIdentity[],
): Promise<AnalysisInvocationManifest> => {
  const frozenBindings = Object.freeze([...bindings])
  const bindingHash = await hashCanonicalJson('purejsimage.analysis-bindings.v1', frozenBindings)
  const invocationHash = await hashCanonicalJson('purejsimage.analysis-invocation.v1', {
    graphHash,
    bindingHash,
  })
  return Object.freeze({
    schemaVersion: 1,
    graphHash,
    bindings: frozenBindings,
    bindingHash,
    invocationHash,
  })
}

export interface AnalysisUnresolvedEstimate extends OperationJsonObject {
  readonly nodeId: string
  readonly field: 'cost' | 'outputShapes'
  readonly reason: string
}

export interface AnalysisPlan extends OperationJsonObject {
  readonly schemaVersion: 1
  readonly graphHash: string
  readonly invocation: AnalysisInvocationManifest
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
  readonly normalizedParameters: ReadonlyMap<string, OperationJsonValue>
  readonly inputCharacteristics: ReadonlyMap<string, readonly OperationJsonValue[]>
  readonly summary: AnalysisPlan
  acquireExecutionLease(): AnalysisPlanLease
  isDisposed(): boolean
  dispose(): Promise<void>
}

export interface AnalysisPlanLease {
  readonly plan: PreparedAnalysisPlan
  release(): Promise<void>
}

export interface PlanGraphOptions {
  readonly graph: unknown
  readonly operations: OperationRegistry
  readonly valueTypes: ValueTypeRegistry
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

const isScientificDataset = (value: unknown): value is ScientificDataset =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  'readPlane' in value &&
  typeof value.readPlane === 'function'

const isNormalizedRoi = (value: unknown): value is Roi =>
  value !== null &&
  typeof value === 'object' &&
  'schemaVersion' in value &&
  value.schemaVersion === 1 &&
  'id' in value &&
  typeof value.id === 'string' &&
  'geometry' in value &&
  value.geometry !== null &&
  typeof value.geometry === 'object'

const isNormalizedRoiSet = (value: unknown): value is RoiSet =>
  value !== null &&
  typeof value === 'object' &&
  'schemaVersion' in value &&
  value.schemaVersion === 1 &&
  'rois' in value &&
  Array.isArray(value.rois) &&
  value.rois.every(isNormalizedRoi)

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

const boundedIdentityString = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 4_096) {
    throw invalidInput(`${name} must be a non-empty string no longer than 4096 characters`)
  }
  return value
}

export const normalizeAnalysisSemanticIdentity = (
  identity: AnalysisSemanticIdentity,
): OperationJsonObject => {
  if (identity.kind === 'scientific-dataset') {
    if (!Array.isArray(identity.resources) || identity.resources.length === 0) {
      throw invalidInput('Scientific dataset identity requires at least one resource')
    }
    const seen = new Set<string>()
    const resources = identity.resources.map((resource) => {
      const id = boundedIdentityString(resource.id, 'Scientific dataset resource id')
      if (seen.has(id)) throw invalidInput(`Scientific dataset identity repeats resource ${id}`)
      seen.add(id)
      return Object.freeze({
        id,
        identity: identityObject(normalizeSourceIdentity(resource.identity)),
      })
    })
    resources.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    return Object.freeze({
      kind: identity.kind,
      reader: Object.freeze({
        id: boundedIdentityString(identity.reader.id, 'Scientific dataset reader id'),
        version: boundedIdentityString(
          identity.reader.version,
          'Scientific dataset reader version',
        ),
      }),
      datasetId: boundedIdentityString(identity.datasetId, 'Scientific dataset id'),
      resources: Object.freeze(resources),
    })
  }
  if (identity.kind === 'semantic-json') {
    if (!/^[0-9a-f]{64}$/u.test(identity.sha256)) {
      throw invalidInput('Semantic JSON identity sha256 is invalid')
    }
    return Object.freeze({
      kind: identity.kind,
      domain: boundedIdentityString(identity.domain, 'Semantic identity domain'),
      sha256: identity.sha256,
    })
  }
  if (identity.kind === 'application-defined') {
    return Object.freeze({
      kind: identity.kind,
      namespace: boundedIdentityString(identity.namespace, 'Application identity namespace'),
      value: boundedIdentityString(identity.value, 'Application identity value'),
    })
  }
  return identityObject(normalizeSourceIdentity(identity))
}

const derivedBindingIdentity = async (
  input: AnalysisGraph['inputs'][number],
  binding: AnalysisInputBinding,
): Promise<OperationJsonObject | undefined> => {
  if (binding.identity !== undefined) return normalizeAnalysisSemanticIdentity(binding.identity)
  if (isImageSource(binding.value)) {
    return identityObject(await getImageSourceIdentity(binding.value))
  }
  if (isScientificDataset(binding.value)) {
    const identity = getScientificDatasetIdentity(binding.value)
    if (identity !== undefined) return normalizeAnalysisSemanticIdentity(identity)
  }
  let domain: string | undefined
  let value: unknown
  if (input.valueType.id === roiValueTypeId) {
    if (!isNormalizedRoi(binding.value)) throw invalidInput('ROI binding was not normalized')
    domain = 'purejsimage.roi-semantics.v1'
    value = canonicalNormalizedRoiSemanticsJson(binding.value)
  } else if (input.valueType.id === roiSetValueTypeId) {
    if (!isNormalizedRoiSet(binding.value)) throw invalidInput('ROI-set binding was not normalized')
    domain = 'purejsimage.roi-set-semantics.v1'
    value = canonicalNormalizedRoiSetSemanticsJson(binding.value)
  } else if (
    binding.value === null ||
    typeof binding.value === 'string' ||
    typeof binding.value === 'number' ||
    typeof binding.value === 'boolean'
  ) {
    domain = `purejsimage.scalar-binding.${input.valueType.id}.v${input.valueType.version}`
    value = binding.value
  } else if (input.valueType.id.startsWith('purejsimage.')) {
    domain = `purejsimage.binding.${input.valueType.id}.v${input.valueType.version}`
    value = binding.value
  }
  if (domain === undefined) return undefined
  try {
    return Object.freeze({
      kind: 'semantic-json',
      domain,
      sha256: await hashCanonicalJson(domain, value),
    })
  } catch {
    return undefined
  }
}

const costObject = (estimate: OperationCostEstimate): AnalysisPlanCost =>
  Object.freeze({
    setupMilliseconds: estimate.setupMilliseconds,
    transferMilliseconds: estimate.transferMilliseconds,
    computeMilliseconds: estimate.computeMilliseconds,
    readbackMilliseconds: estimate.readbackMilliseconds,
    retainedBytes: estimate.retainedBytes,
    peakWorkingBytes: estimate.peakWorkingBytes,
    transferBytes: estimate.transferBytes,
    outputBytes: estimate.outputBytes,
    confidence: estimate.confidence,
  })

const placeholder = (nodeId: string, output: string): OperationJsonObject =>
  Object.freeze({ plannedNode: nodeId, output })

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
  target[5] = Math.max(target[5] ?? 0, estimate.peakWorkingBytes)
  target[6] = (target[6] ?? 0) + estimate.transferBytes
  target[7] = (target[7] ?? 0) + estimate.outputBytes
  target[8] = Math.min(target[8] ?? 1, estimate.confidence)
}

export const planGraph = async (
  options: Readonly<PlanGraphOptions>,
): Promise<PreparedAnalysisPlan> => {
  options.signal?.throwIfAborted()
  const validation = validateGraphWithValueTypes(
    options.graph,
    options.operations,
    options.valueTypes,
    options.limits,
  )
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
    const valueType = options.valueTypes.get(input.valueType.id, input.valueType.version)
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
    const identity = await derivedBindingIdentity(input, binding)
    options.signal?.throwIfAborted()
    if (identity === undefined) {
      throw invalidInput(
        `Graph input ${input.name} requires an explicit semantic identity for value type ${input.valueType.id}`,
      )
    }
    requiredInputIdentities.push(
      Object.freeze({
        input: input.name,
        valueType: Object.freeze({ ...input.valueType }),
        identity,
      }),
    )
  }
  requiredInputIdentities.sort((left, right) => left.input.localeCompare(right.input))
  const policy = options.policy ?? { mode: 'automatic' }
  const allowedProviders = [...options.providers].filter((provider) =>
    providerAllowed(provider, policy),
  )
  const runtime = await prepareOperationRuntime(allowedProviders, options.signal)
  try {
    options.signal?.throwIfAborted()
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
    const selections = new Map<string, OperationProviderSelection>()
    const normalizedParameters = new Map<string, OperationJsonValue>()
    const plannedInputCharacteristics = new Map<string, readonly OperationJsonValue[]>()
    const nodes: AnalysisPlanNode[] = []
    const warnings: AnalysisIssue[] = []
    const unresolvedEstimates: AnalysisUnresolvedEstimate[] = []
    const inferredCharacteristics = new Map<string, OperationJsonValue>()
    const totals = [0, 0, 0, 0, 0, 0, 0, 0, 1]
    const signal = options.signal ?? new AbortController().signal
    for (const nodeId of validation.nodeOrder) {
      signal.throwIfAborted()
      const node = nodeById.get(nodeId)
      if (node === undefined) throw invalidInput(`Planned node ${nodeId} is unavailable`)
      const definition = options.operations.get(node.operation.id, node.operation.version)
      if (definition === undefined)
        throw invalidInput(
          `Operation ${node.operation.id}@${node.operation.version} is unavailable`,
        )
      const parameterResult = definition.normalizeParameters(node.parameters)
      if (parameterResult.value === undefined) {
        throw invalidInput(parameterResult.issues[0]?.message ?? 'Operation parameters are invalid')
      }
      const parameters = parameterResult.value
      normalizedParameters.set(node.id, parameters)
      const inputCharacteristics = Object.freeze(
        node.inputs.map((input) =>
          resolveCharacteristics(input.source, bindings, inferredCharacteristics),
        ),
      )
      const request: OperationPlanningRequest = {
        descriptor: definition.descriptor,
        parameters,
        inputCharacteristics,
        signal,
      }
      const selected = runtime.select(request, policy)
      selections.set(node.id, selected)
      plannedInputCharacteristics.set(node.id, inputCharacteristics)
      addCost(totals, selected.estimate)
      if (selected.estimate.confidence === 0) {
        const reason = 'Provider reported zero confidence for its cost estimate'
        warnings.push(warning(`/nodes/${node.id}/estimate`, reason))
        unresolvedEstimates.push(Object.freeze({ nodeId: node.id, field: 'cost', reason }))
      }
      let outputShapes: readonly OperationJsonValue[] | null = null
      if (definition.inferOutputShapes !== undefined) {
        const inferred = definition.inferOutputShapes({
          parameters,
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
          unresolvedEstimates.push(
            Object.freeze({ nodeId: node.id, field: 'outputShapes', reason }),
          )
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
          parameterHash: await hashCanonicalJson('purejsimage.operation-parameters.v1', parameters),
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
    const graphHash = await hashAnalysisGraph(graph)
    const frozenBindings = Object.freeze(requiredInputIdentities)
    const invocation = await computeAnalysisInvocationManifest(graphHash, frozenBindings)
    const summary: AnalysisPlan = Object.freeze({
      schemaVersion: 1,
      graphHash,
      invocation,
      nodeOrder: validation.nodeOrder,
      nodes: Object.freeze(nodes),
      totalEstimate: Object.freeze({
        setupMilliseconds: totals[0] ?? 0,
        transferMilliseconds: totals[1] ?? 0,
        computeMilliseconds: totals[2] ?? 0,
        readbackMilliseconds: totals[3] ?? 0,
        retainedBytes: totals[4] ?? 0,
        peakWorkingBytes: totals[5] ?? 0,
        transferBytes: totals[6] ?? 0,
        outputBytes: totals[7] ?? 0,
        confidence: totals[8] ?? 0,
      }),
      requiredInputIdentities: frozenBindings,
      unresolvedEstimates: Object.freeze(unresolvedEstimates),
      warnings: Object.freeze(warnings),
    })
    let closing = false
    let activeLeases = 0
    let disposePromise: Promise<void> | undefined
    let notifyIdle: (() => void) | undefined
    let prepared: PreparedAnalysisPlan
    prepared = Object.freeze({
      graph,
      validation,
      operations: options.operations,
      bindings,
      selections,
      normalizedParameters,
      inputCharacteristics: plannedInputCharacteristics,
      summary,
      acquireExecutionLease(): AnalysisPlanLease {
        if (closing) throw invalidInput('Prepared analysis plan is disposed')
        activeLeases += 1
        let released = false
        return Object.freeze({
          plan: prepared,
          async release(): Promise<void> {
            if (released) return
            released = true
            activeLeases -= 1
            if (activeLeases === 0) notifyIdle?.()
          },
        })
      },
      isDisposed: () => closing,
      async dispose(): Promise<void> {
        if (disposePromise !== undefined) return disposePromise
        closing = true
        disposePromise = (async () => {
          if (activeLeases > 0) {
            await new Promise<void>((resolve) => {
              notifyIdle = resolve
            })
          }
          await runtime.dispose()
        })()
        try {
          await disposePromise
        } finally {
          notifyIdle = undefined
        }
      },
    })
    return prepared
  } catch (error) {
    try {
      await runtime.dispose()
    } catch {
      // Preserve the planning failure that triggered cleanup.
    }
    throw error
  }
}

export interface AnalysisDryRun extends OperationJsonObject {
  readonly valid: boolean
  readonly issues: readonly AnalysisIssue[]
  readonly warnings: readonly AnalysisIssue[]
  readonly plan: AnalysisPlan | null
}

export const dryRun = async (options: Readonly<PlanGraphOptions>): Promise<AnalysisDryRun> => {
  const validation = validateGraphWithValueTypes(
    options.graph,
    options.operations,
    options.valueTypes,
    options.limits,
  )
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
    try {
      return Object.freeze({
        valid: true,
        issues: Object.freeze([]),
        warnings: prepared.summary.warnings,
        plan: prepared.summary,
      })
    } finally {
      await prepared.dispose()
    }
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
