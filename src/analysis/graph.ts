import type {
  OperationJsonObject,
  OperationJsonValue,
  OperationValueTypeReference,
} from '../operations/descriptor.ts'
import type {
  OperationDefinition,
  OperationRegistry,
  ValueTypeRegistry,
} from '../operations/registry.ts'
import { canonicalJson, sha256Text } from './canonical-json.ts'

export const analysisGraphSchemaVersion = 1
export const analysisGraphHashDomain = 'purejsimage.analysis-graph.canonical-json.v2'

export interface AnalysisValueTypeReference {
  readonly id: string
  readonly version: number
}

export interface AnalysisGraphInput {
  readonly name: string
  readonly valueType: AnalysisValueTypeReference
  readonly label?: string
}

export type AnalysisValueReference =
  | { readonly kind: 'input'; readonly input: string }
  | { readonly kind: 'node'; readonly nodeId: string; readonly output: string }

export interface AnalysisNodeInput {
  readonly port: string
  readonly source: AnalysisValueReference
}

export interface AnalysisGraphNode {
  readonly id: string
  readonly operation: { readonly id: string; readonly version: number }
  readonly inputs: readonly AnalysisNodeInput[]
  readonly parameters: OperationJsonValue
  readonly label?: string
}

export interface AnalysisGraphOutput {
  readonly name: string
  readonly source: AnalysisValueReference
  readonly label?: string
}

export interface AnalysisGraph {
  readonly schemaVersion: 1
  readonly inputs: readonly AnalysisGraphInput[]
  readonly nodes: readonly AnalysisGraphNode[]
  readonly outputs: readonly AnalysisGraphOutput[]
  readonly label?: string
}

export type AnalysisIssueSeverity = 'error' | 'warning'
export type AnalysisIssueCode =
  | 'cycle'
  | 'duplicate'
  | 'invalid-graph'
  | 'invalid-parameter'
  | 'invalid-reference'
  | 'invalid-type'
  | 'limit-exceeded'
  | 'missing-input'
  | 'stale-revision'
  | 'unknown-operation'
  | 'unknown-port'
  | 'unsupported-migration'
  | 'unresolved-estimate'

export interface AnalysisIssue extends OperationJsonObject {
  readonly code: AnalysisIssueCode
  readonly severity: AnalysisIssueSeverity
  readonly path: string
  readonly message: string
}

export interface AnalysisLimits {
  readonly maxNodes?: number
  readonly maxEdges?: number
  readonly maxParameterBytes?: number
  readonly maxParameterDepth?: number
  readonly maxStringLength?: number
  readonly maxGraphJsonBytes?: number
  readonly maxIssues?: number
  readonly maxParallelism?: number
}

export interface ResolvedAnalysisLimits {
  readonly maxNodes: number
  readonly maxEdges: number
  readonly maxParameterBytes: number
  readonly maxParameterDepth: number
  readonly maxStringLength: number
  readonly maxGraphJsonBytes: number
  readonly maxIssues: number
  readonly maxParallelism: number
}

export const defaultGraphAnalysisLimits: ResolvedAnalysisLimits = Object.freeze({
  maxNodes: 10_000,
  maxEdges: 100_000,
  maxParameterBytes: 1_048_576,
  maxParameterDepth: 32,
  maxStringLength: 4_096,
  maxGraphJsonBytes: 16 * 1_024 * 1_024,
  maxIssues: 256,
  maxParallelism: 8,
})

const positiveLimit = (value: number | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be positive`)
  return value
}

export const resolveAnalysisLimits = (
  limits: Readonly<AnalysisLimits> = {},
): ResolvedAnalysisLimits =>
  Object.freeze({
    maxNodes: positiveLimit(limits.maxNodes, defaultGraphAnalysisLimits.maxNodes, 'maxNodes'),
    maxEdges: positiveLimit(limits.maxEdges, defaultGraphAnalysisLimits.maxEdges, 'maxEdges'),
    maxParameterBytes: positiveLimit(
      limits.maxParameterBytes,
      defaultGraphAnalysisLimits.maxParameterBytes,
      'maxParameterBytes',
    ),
    maxParameterDepth: positiveLimit(
      limits.maxParameterDepth,
      defaultGraphAnalysisLimits.maxParameterDepth,
      'maxParameterDepth',
    ),
    maxStringLength: positiveLimit(
      limits.maxStringLength,
      defaultGraphAnalysisLimits.maxStringLength,
      'maxStringLength',
    ),
    maxGraphJsonBytes: positiveLimit(
      limits.maxGraphJsonBytes,
      defaultGraphAnalysisLimits.maxGraphJsonBytes,
      'maxGraphJsonBytes',
    ),
    maxIssues: positiveLimit(limits.maxIssues, defaultGraphAnalysisLimits.maxIssues, 'maxIssues'),
    maxParallelism: positiveLimit(
      limits.maxParallelism,
      defaultGraphAnalysisLimits.maxParallelism,
      'maxParallelism',
    ),
  })

export interface AnalysisGraphValidation {
  readonly valid: boolean
  readonly issues: readonly AnalysisIssue[]
  readonly graph?: AnalysisGraph
  readonly nodeOrder?: readonly string[]
}

type UnknownRecord = Readonly<Record<string, unknown>>
const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

class GraphValidationContext {
  readonly issues: AnalysisIssue[] = []
  readonly limits: ResolvedAnalysisLimits
  constructor(limits: ResolvedAnalysisLimits) {
    this.limits = limits
  }
  issue(code: AnalysisIssueCode, path: string, message: string): void {
    if (this.issues.length >= this.limits.maxIssues) return
    this.issues.push(Object.freeze({ code, severity: 'error', path, message }))
  }
}

const identifier = (
  value: unknown,
  path: string,
  context: GraphValidationContext,
): string | undefined => {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > context.limits.maxStringLength ||
    !/^[A-Za-z][A-Za-z0-9._-]*$/u.test(value)
  ) {
    context.issue('invalid-type', path, 'Expected a bounded identifier')
    return undefined
  }
  return value
}

const label = (
  value: unknown,
  path: string,
  context: GraphValidationContext,
): string | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > context.limits.maxStringLength) {
    context.issue('invalid-type', path, 'Expected a bounded label string')
    return undefined
  }
  return value
}

const exactKeys = (
  value: UnknownRecord,
  allowed: readonly string[],
  path: string,
  context: GraphValidationContext,
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) context.issue('invalid-graph', `${path}/${key}`, 'Unknown field')
  }
}

const version = (
  value: unknown,
  path: string,
  context: GraphValidationContext,
): number | undefined => {
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1) {
    context.issue('invalid-type', path, 'Expected a positive version')
    return undefined
  }
  return value
}

const valueType = (
  value: unknown,
  path: string,
  context: GraphValidationContext,
): AnalysisValueTypeReference | undefined => {
  if (!isRecord(value)) {
    context.issue('invalid-type', path, 'Expected a value type reference')
    return undefined
  }
  exactKeys(value, ['id', 'version'], path, context)
  const id = identifier(value.id, `${path}/id`, context)
  const resolvedVersion = version(value.version, `${path}/version`, context)
  return id === undefined || resolvedVersion === undefined
    ? undefined
    : Object.freeze({ id, version: resolvedVersion })
}

const valueReference = (
  value: unknown,
  path: string,
  context: GraphValidationContext,
): AnalysisValueReference | undefined => {
  if (!isRecord(value)) {
    context.issue('invalid-type', path, 'Expected a value reference')
    return undefined
  }
  if (value.kind === 'input') {
    exactKeys(value, ['kind', 'input'], path, context)
    const input = identifier(value.input, `${path}/input`, context)
    return input === undefined ? undefined : Object.freeze({ kind: 'input', input })
  }
  if (value.kind === 'node') {
    exactKeys(value, ['kind', 'nodeId', 'output'], path, context)
    const nodeId = identifier(value.nodeId, `${path}/nodeId`, context)
    const output = identifier(value.output, `${path}/output`, context)
    return nodeId === undefined || output === undefined
      ? undefined
      : Object.freeze({ kind: 'node', nodeId, output })
  }
  context.issue('invalid-type', `${path}/kind`, 'Expected input or node reference kind')
  return undefined
}

const compatible = (
  source: AnalysisValueTypeReference | OperationValueTypeReference,
  target: OperationValueTypeReference,
): boolean =>
  source.id === target.id && (target.version === undefined || source.version === target.version)

const operationOutput = (
  definition: OperationDefinition,
  name: string,
): OperationValueTypeReference | undefined =>
  definition.descriptor.outputs.find((port) => port.name === name)?.valueType

const parameterStringsWithinLimit = (
  value: OperationJsonValue,
  path: string,
  context: GraphValidationContext,
): void => {
  const pending: OperationJsonValue[] = [value]
  while (pending.length > 0) {
    const current = pending.pop()
    if (typeof current === 'string') {
      if (current.length > context.limits.maxStringLength) {
        context.issue('limit-exceeded', path, 'Parameters exceed maxStringLength')
        return
      }
    } else if (Array.isArray(current)) pending.push(...current)
    else if (current !== null && typeof current === 'object') {
      for (const [key, nested] of Object.entries(current)) {
        if (key.length > context.limits.maxStringLength) {
          context.issue('limit-exceeded', path, 'Parameter key exceeds maxStringLength')
          return
        }
        pending.push(nested)
      }
    }
  }
}

const stableTopologicalOrder = (
  nodes: readonly AnalysisGraphNode[],
  context: GraphValidationContext,
): readonly string[] | undefined => {
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]))
  for (const node of nodes) {
    for (const input of node.inputs) {
      if (input.source.kind !== 'node' || !indegree.has(input.source.nodeId)) continue
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1)
      outgoing.get(input.source.nodeId)?.push(node.id)
    }
  }
  const ready = [...indegree]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort()
  const order: string[] = []
  while (ready.length > 0) {
    const id = ready.shift()
    if (id === undefined) break
    order.push(id)
    for (const next of outgoing.get(id)?.sort() ?? []) {
      const count = (indegree.get(next) ?? 0) - 1
      indegree.set(next, count)
      if (count === 0) {
        ready.push(next)
        ready.sort()
      }
    }
  }
  if (order.length !== nodes.length) {
    context.issue('cycle', '/nodes', 'Analysis graph contains a cycle')
    return undefined
  }
  return Object.freeze(order)
}

export const validateGraph = (
  input: unknown,
  operations: OperationRegistry,
  limits: Readonly<AnalysisLimits> = {},
): AnalysisGraphValidation => {
  const resolvedLimits = resolveAnalysisLimits(limits)
  const context = new GraphValidationContext(resolvedLimits)
  if (!isRecord(input)) {
    context.issue('invalid-graph', '', 'Analysis graph must be an object')
    return Object.freeze({ valid: false, issues: Object.freeze(context.issues) })
  }
  try {
    const graphBytes = new TextEncoder().encode(
      canonicalJson(input, {
        maxDepth: resolvedLimits.maxParameterDepth + 8,
        maxValues: resolvedLimits.maxNodes * 32 + resolvedLimits.maxEdges * 8 + 1_024,
        maxBytes: resolvedLimits.maxGraphJsonBytes,
      }),
    ).byteLength
    if (graphBytes > resolvedLimits.maxGraphJsonBytes) {
      context.issue('limit-exceeded', '', 'Graph exceeds maxGraphJsonBytes')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Graph is not JSON-safe'
    context.issue(message.includes('exceeds') ? 'limit-exceeded' : 'invalid-graph', '', message)
  }
  if (context.issues.some((entry) => entry.code === 'limit-exceeded')) {
    return Object.freeze({ valid: false, issues: Object.freeze(context.issues) })
  }
  exactKeys(input, ['schemaVersion', 'inputs', 'nodes', 'outputs', 'label'], '', context)
  if (input.schemaVersion !== analysisGraphSchemaVersion) {
    context.issue(
      'invalid-graph',
      '/schemaVersion',
      `Expected graph schemaVersion ${analysisGraphSchemaVersion}`,
    )
  }
  const graphLabel = label(input.label, '/label', context)
  const inputs: AnalysisGraphInput[] = []
  const inputNames = new Set<string>()
  if (!Array.isArray(input.inputs))
    context.issue('invalid-type', '/inputs', 'Graph inputs must be an array')
  else {
    for (let index = 0; index < input.inputs.length; index += 1) {
      const entry = input.inputs[index]
      const path = `/inputs/${index}`
      if (!isRecord(entry)) {
        context.issue('invalid-type', path, 'Graph input must be an object')
        continue
      }
      exactKeys(entry, ['name', 'valueType', 'label'], path, context)
      const name = identifier(entry.name, `${path}/name`, context)
      const type = valueType(entry.valueType, `${path}/valueType`, context)
      const inputLabel = label(entry.label, `${path}/label`, context)
      if (name === undefined || type === undefined) continue
      if (inputNames.has(name))
        context.issue('duplicate', `${path}/name`, `Duplicate graph input ${name}`)
      inputNames.add(name)
      inputs.push(
        Object.freeze({
          name,
          valueType: type,
          ...(inputLabel === undefined ? {} : { label: inputLabel }),
        }),
      )
    }
  }
  if (!Array.isArray(input.nodes))
    context.issue('invalid-type', '/nodes', 'Graph nodes must be an array')
  else if (input.nodes.length > resolvedLimits.maxNodes) {
    context.issue('limit-exceeded', '/nodes', 'Graph exceeds maxNodes')
    return Object.freeze({ valid: false, issues: Object.freeze(context.issues) })
  } else {
    let declaredEdges = 0
    for (const rawNode of input.nodes) {
      if (isRecord(rawNode) && Array.isArray(rawNode.inputs)) {
        declaredEdges += rawNode.inputs.length
        if (declaredEdges > resolvedLimits.maxEdges) {
          context.issue('limit-exceeded', '/nodes', 'Graph exceeds maxEdges')
          return Object.freeze({ valid: false, issues: Object.freeze(context.issues) })
        }
      }
    }
  }
  const nodes: AnalysisGraphNode[] = []
  const nodeIds = new Set<string>()
  const definitions = new Map<string, OperationDefinition>()
  if (Array.isArray(input.nodes)) {
    let edgeCount = 0
    for (let index = 0; index < input.nodes.length; index += 1) {
      const entry = input.nodes[index]
      const path = `/nodes/${index}`
      if (!isRecord(entry)) {
        context.issue('invalid-type', path, 'Graph node must be an object')
        continue
      }
      exactKeys(entry, ['id', 'operation', 'inputs', 'parameters', 'label'], path, context)
      const id = identifier(entry.id, `${path}/id`, context)
      if (id !== undefined) {
        if (nodeIds.has(id)) context.issue('duplicate', `${path}/id`, `Duplicate node id ${id}`)
        nodeIds.add(id)
      }
      let operation: AnalysisGraphNode['operation'] | undefined
      let definition: OperationDefinition | undefined
      if (!isRecord(entry.operation))
        context.issue('invalid-type', `${path}/operation`, 'Operation reference must be an object')
      else {
        exactKeys(entry.operation, ['id', 'version'], `${path}/operation`, context)
        const operationId = identifier(entry.operation.id, `${path}/operation/id`, context)
        const operationVersion = version(
          entry.operation.version,
          `${path}/operation/version`,
          context,
        )
        if (operationId !== undefined && operationVersion !== undefined) {
          operation = Object.freeze({ id: operationId, version: operationVersion })
          definition = operations.get(operationId, operationVersion)
          if (definition === undefined)
            context.issue(
              'unknown-operation',
              `${path}/operation`,
              `Unknown operation ${operationId}@${operationVersion}`,
            )
        }
      }
      const nodeInputs: AnalysisNodeInput[] = []
      const ports = new Set<string>()
      if (!Array.isArray(entry.inputs))
        context.issue('invalid-type', `${path}/inputs`, 'Node inputs must be an array')
      else {
        edgeCount += entry.inputs.length
        for (let inputIndex = 0; inputIndex < entry.inputs.length; inputIndex += 1) {
          const connection = entry.inputs[inputIndex]
          const inputPath = `${path}/inputs/${inputIndex}`
          if (!isRecord(connection)) {
            context.issue('invalid-type', inputPath, 'Node input must be an object')
            continue
          }
          exactKeys(connection, ['port', 'source'], inputPath, context)
          const port = identifier(connection.port, `${inputPath}/port`, context)
          const source = valueReference(connection.source, `${inputPath}/source`, context)
          if (port === undefined || source === undefined) continue
          const declaredPort = definition?.descriptor.inputs.find(
            (candidate) => candidate.name === port,
          )
          if (ports.has(port) && declaredPort?.variadic !== true)
            context.issue('duplicate', `${inputPath}/port`, `Duplicate node input port ${port}`)
          ports.add(port)
          nodeInputs.push(Object.freeze({ port, source }))
        }
      }
      if (edgeCount > resolvedLimits.maxEdges)
        context.issue('limit-exceeded', `${path}/inputs`, 'Graph exceeds maxEdges')
      let parameters: OperationJsonValue | undefined
      if (definition !== undefined) {
        const result = definition.normalizeParameters(entry.parameters, {
          maxDepth: resolvedLimits.maxParameterDepth,
          maxInspectedValues: Math.max(1, Math.floor(resolvedLimits.maxParameterBytes / 2)),
          maxIssues: resolvedLimits.maxIssues,
        })
        for (const issue of result.issues)
          context.issue('invalid-parameter', `${path}/parameters${issue.path}`, issue.message)
        parameters = result.value
        if (parameters !== undefined) {
          parameterStringsWithinLimit(parameters, `${path}/parameters`, context)
          try {
            canonicalJson(parameters, {
              maxDepth: resolvedLimits.maxParameterDepth,
              maxBytes: resolvedLimits.maxParameterBytes,
            })
          } catch (error) {
            context.issue(
              'limit-exceeded',
              `${path}/parameters`,
              error instanceof Error ? error.message : 'Parameters exceed limits',
            )
          }
        }
      }
      const nodeLabel = label(entry.label, `${path}/label`, context)
      if (id === undefined || operation === undefined || parameters === undefined) continue
      const node = Object.freeze({
        id,
        operation,
        inputs: Object.freeze(nodeInputs),
        parameters,
        ...(nodeLabel === undefined ? {} : { label: nodeLabel }),
      })
      nodes.push(node)
      if (definition !== undefined) definitions.set(id, definition)
    }
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const inputByName = new Map(inputs.map((entry) => [entry.name, entry]))
  const sourceType = (
    source: AnalysisValueReference,
    path: string,
  ): OperationValueTypeReference | undefined => {
    if (source.kind === 'input') {
      const found = inputByName.get(source.input)
      if (found === undefined)
        context.issue('invalid-reference', path, `Unknown graph input ${source.input}`)
      return found?.valueType
    }
    const sourceNode = nodeById.get(source.nodeId)
    if (sourceNode === undefined) {
      context.issue('invalid-reference', path, `Unknown source node ${source.nodeId}`)
      return undefined
    }
    const definition = definitions.get(sourceNode.id)
    const output = definition === undefined ? undefined : operationOutput(definition, source.output)
    if (definition !== undefined && output === undefined)
      context.issue('unknown-port', path, `Unknown output port ${source.output}`)
    return output
  }
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]
    if (node === undefined) continue
    const definition = definitions.get(node.id)
    if (definition === undefined) continue
    for (const port of definition.descriptor.inputs) {
      const connections = node.inputs.filter((entry) => entry.port === port.name)
      if (connections.length === 0) {
        if (port.optional !== true)
          context.issue(
            'missing-input',
            `/nodes/${index}/inputs`,
            `Missing input port ${port.name}`,
          )
        continue
      }
      for (const connection of connections) {
        const source = sourceType(
          connection.source,
          `/nodes/${index}/inputs/${node.inputs.indexOf(connection)}/source`,
        )
        if (source !== undefined && !compatible(source, port.valueType)) {
          context.issue(
            'invalid-type',
            `/nodes/${index}/inputs/${node.inputs.indexOf(connection)}/source`,
            `Input ${port.name} expects ${port.valueType.id}${port.valueType.version === undefined ? '' : `@${port.valueType.version}`}`,
          )
        }
      }
    }
    for (const connection of node.inputs) {
      if (!definition.descriptor.inputs.some((port) => port.name === connection.port)) {
        context.issue(
          'unknown-port',
          `/nodes/${index}/inputs`,
          `Unknown input port ${connection.port}`,
        )
      }
    }
  }
  const outputs: AnalysisGraphOutput[] = []
  const outputNames = new Set<string>()
  if (!Array.isArray(input.outputs))
    context.issue('invalid-type', '/outputs', 'Graph outputs must be an array')
  else {
    for (let index = 0; index < input.outputs.length; index += 1) {
      const entry = input.outputs[index]
      const path = `/outputs/${index}`
      if (!isRecord(entry)) {
        context.issue('invalid-type', path, 'Graph output must be an object')
        continue
      }
      exactKeys(entry, ['name', 'source', 'label'], path, context)
      const name = identifier(entry.name, `${path}/name`, context)
      const source = valueReference(entry.source, `${path}/source`, context)
      const outputLabel = label(entry.label, `${path}/label`, context)
      if (name === undefined || source === undefined) continue
      if (outputNames.has(name))
        context.issue('duplicate', `${path}/name`, `Duplicate graph output ${name}`)
      outputNames.add(name)
      sourceType(source, `${path}/source`)
      outputs.push(
        Object.freeze({
          name,
          source,
          ...(outputLabel === undefined ? {} : { label: outputLabel }),
        }),
      )
    }
  }
  const order = stableTopologicalOrder(nodes, context)
  const normalized: AnalysisGraph = Object.freeze({
    schemaVersion: analysisGraphSchemaVersion,
    inputs: Object.freeze(inputs),
    nodes: Object.freeze(nodes),
    outputs: Object.freeze(outputs),
    ...(graphLabel === undefined ? {} : { label: graphLabel }),
  })
  const issues = Object.freeze(context.issues)
  return Object.freeze({
    valid: issues.length === 0,
    issues,
    ...(issues.length === 0 && order !== undefined ? { graph: normalized, nodeOrder: order } : {}),
  })
}

/** Controller/planner validation that additionally requires every declared input type to exist. */
export const validateGraphWithValueTypes = (
  value: unknown,
  operations: OperationRegistry,
  valueTypes: ValueTypeRegistry,
  limits: Readonly<AnalysisLimits> = {},
): AnalysisGraphValidation => {
  const validation = validateGraph(value, operations, limits)
  const graph = validation.graph
  if (graph === undefined) return validation
  const issues = [...validation.issues]
  const maxIssues = resolveAnalysisLimits(limits).maxIssues
  for (let index = 0; index < graph.inputs.length && issues.length < maxIssues; index += 1) {
    const input = graph.inputs[index]
    if (input === undefined) continue
    if (valueTypes.get(input.valueType.id, input.valueType.version) === undefined) {
      issues.push(
        Object.freeze({
          code: 'invalid-type',
          severity: 'error',
          path: `/inputs/${index}/valueType`,
          message: `Unknown value type ${input.valueType.id}@${input.valueType.version}`,
        }),
      )
    }
  }
  if (issues.length === 0) return validation
  return Object.freeze({ valid: false, issues: Object.freeze(issues) })
}

export interface SemanticAnalysisGraph extends OperationJsonObject {
  readonly schemaVersion: 1
  readonly inputs: readonly OperationJsonValue[]
  readonly nodes: readonly OperationJsonValue[]
  readonly outputs: readonly OperationJsonValue[]
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const semanticNodeInputs = (node: AnalysisGraph['nodes'][number]): readonly OperationJsonValue[] =>
  Object.freeze(
    node.inputs
      .map((input, index) => ({ input, index }))
      .sort(
        (left, right) => compareText(left.input.port, right.input.port) || left.index - right.index,
      )
      .map(({ input }) =>
        Object.freeze({
          port: input.port,
          source:
            input.source.kind === 'input'
              ? Object.freeze({ kind: 'input', input: input.source.input })
              : Object.freeze({
                  kind: 'node',
                  nodeId: input.source.nodeId,
                  output: input.source.output,
                }),
        }),
      ),
  )

export const semanticAnalysisGraph = (graph: AnalysisGraph): SemanticAnalysisGraph =>
  Object.freeze({
    schemaVersion: graph.schemaVersion,
    inputs: Object.freeze(
      [...graph.inputs]
        .sort((left, right) => compareText(left.name, right.name))
        .map((input) =>
          Object.freeze({
            name: input.name,
            valueType: Object.freeze({ id: input.valueType.id, version: input.valueType.version }),
          }),
        ),
    ),
    nodes: Object.freeze(
      [...graph.nodes]
        .sort((left, right) => compareText(left.id, right.id))
        .map((node) =>
          Object.freeze({
            id: node.id,
            operation: Object.freeze({ id: node.operation.id, version: node.operation.version }),
            inputs: semanticNodeInputs(node),
            parameters: node.parameters,
          }),
        ),
    ),
    outputs: Object.freeze(
      [...graph.outputs]
        .sort((left, right) => compareText(left.name, right.name))
        .map((output) =>
          Object.freeze({
            name: output.name,
            source:
              output.source.kind === 'input'
                ? Object.freeze({ kind: 'input', input: output.source.input })
                : Object.freeze({
                    kind: 'node',
                    nodeId: output.source.nodeId,
                    output: output.source.output,
                  }),
          }),
        ),
    ),
  })

export const canonicalGraphJson = (graph: AnalysisGraph): string =>
  canonicalJson(semanticAnalysisGraph(graph))

export const hashAnalysisGraph = async (graph: AnalysisGraph): Promise<string> =>
  sha256Text(analysisGraphHashDomain, canonicalGraphJson(graph))
