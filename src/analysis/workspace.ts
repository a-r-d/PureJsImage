import type { OperationJsonObject, OperationJsonValue } from '../operations/descriptor.ts'
import { normalizeOperationJsonValue } from '../operations/descriptor.ts'
import type { NormalizedScientificDatasetDescriptor } from '../scientific/dataset-v2.ts'
import type {
  AnalysisGraph,
  AnalysisGraphInput,
  AnalysisGraphNode,
  AnalysisGraphOutput,
  AnalysisIssue,
  AnalysisLimits,
  AnalysisNodeInput,
  AnalysisValueReference,
} from './graph.ts'
import { validateGraph } from './graph.ts'
import type { OperationRegistry } from '../operations/registry.ts'
import type { Roi, RoiLimits, RoiSet } from './roi.ts'
import { createEmptyRoiSet, normalizeRoiSet, validateRoi, validateRoiSet } from './roi.ts'

export interface AnalysisWorkspaceRoiContext {
  readonly descriptor: NormalizedScientificDatasetDescriptor
  readonly limits?: Readonly<RoiLimits>
}

export interface AnalysisWorkspaceSnapshot {
  readonly schemaVersion: 1
  readonly revision: number
  readonly graph: AnalysisGraph
  readonly roiSet: RoiSet
}

interface CommandBase {
  readonly schemaVersion: 1
  readonly id: string
  readonly expectedRevision?: number
}

export type AnalysisCommand =
  | (CommandBase & { readonly kind: 'add-node'; readonly node: AnalysisGraphNode })
  | (CommandBase & { readonly kind: 'remove-node'; readonly nodeId: string })
  | (CommandBase & {
      readonly kind: 'connect'
      readonly nodeId: string
      readonly port: string
      readonly source: AnalysisValueReference
    })
  | (CommandBase & { readonly kind: 'disconnect'; readonly nodeId: string; readonly port: string })
  | (CommandBase & {
      readonly kind: 'update-parameters'
      readonly nodeId: string
      readonly parameters: OperationJsonValue
    })
  | (CommandBase & { readonly kind: 'bind-input'; readonly input: AnalysisGraphInput })
  | (CommandBase & { readonly kind: 'unbind-input'; readonly name: string })
  | (CommandBase & { readonly kind: 'set-output'; readonly output: AnalysisGraphOutput })
  | (CommandBase & { readonly kind: 'remove-output'; readonly name: string })
  | (CommandBase & { readonly kind: 'add-roi'; readonly roi: Roi })
  | (CommandBase & { readonly kind: 'update-roi'; readonly roiId: string; readonly roi: Roi })
  | (CommandBase & { readonly kind: 'remove-roi'; readonly roiId: string })
  | (CommandBase & { readonly kind: 'replace-roi-set'; readonly roiSet: RoiSet })

export type AnalysisCommandKind = AnalysisCommand['kind']

export interface AnalysisCommandDescriptor extends OperationJsonObject {
  readonly kind: AnalysisCommandKind
  readonly title: string
  readonly description: string
  readonly schema: OperationJsonObject
  readonly mutatesWorkspace: true
  readonly requiresExpectedRevision: false
}

const identifierSchema = Object.freeze({ type: 'string', minLength: 1, maxLength: 4_096 })
const revisionSchema = Object.freeze({ type: 'integer', minimum: 0 })
const contractSchema = (id: string): OperationJsonObject =>
  Object.freeze({ type: 'contract', id, version: 1 })

const commandDescriptor = (
  kind: AnalysisCommandKind,
  title: string,
  description: string,
  payload: Readonly<Record<string, OperationJsonObject>>,
): AnalysisCommandDescriptor =>
  Object.freeze({
    kind,
    title,
    description,
    schema: Object.freeze({
      type: 'object',
      closed: true,
      required: Object.freeze(['schemaVersion', 'id', 'kind', ...Object.keys(payload)]),
      properties: Object.freeze({
        schemaVersion: Object.freeze({ type: 'integer', minimum: 1, maximum: 1, default: 1 }),
        id: identifierSchema,
        expectedRevision: revisionSchema,
        kind: Object.freeze({ type: 'enum', values: Object.freeze([kind]) }),
        ...payload,
      }),
    }),
    mutatesWorkspace: true,
    requiresExpectedRevision: false,
  })

const graphNodeSchema = contractSchema('purejsimage.analysis.graph-node')
const graphValueReferenceSchema = contractSchema('purejsimage.analysis.value-reference')
const graphInputSchema = contractSchema('purejsimage.analysis.graph-input')
const graphOutputSchema = contractSchema('purejsimage.analysis.graph-output')
const operationParametersSchema = Object.freeze({
  type: 'json',
  description: 'JSON parameters validated against the selected operation descriptor',
})

export const describeAnalysisCommands = (
  includeRoi = false,
): readonly AnalysisCommandDescriptor[] =>
  Object.freeze([
    commandDescriptor('add-node', 'Add node', 'Add a versioned operation node.', {
      node: graphNodeSchema,
    }),
    commandDescriptor('remove-node', 'Remove node', 'Remove a node and its dependent edges.', {
      nodeId: identifierSchema,
    }),
    commandDescriptor('connect', 'Connect input', 'Connect a node input port to a graph value.', {
      nodeId: identifierSchema,
      port: identifierSchema,
      source: graphValueReferenceSchema,
    }),
    commandDescriptor('disconnect', 'Disconnect input', 'Disconnect a node input port.', {
      nodeId: identifierSchema,
      port: identifierSchema,
    }),
    commandDescriptor(
      'update-parameters',
      'Update parameters',
      'Replace normalized parameters for one operation node.',
      { nodeId: identifierSchema, parameters: operationParametersSchema },
    ),
    commandDescriptor('bind-input', 'Bind graph input', 'Add a typed external graph input.', {
      input: graphInputSchema,
    }),
    commandDescriptor('unbind-input', 'Unbind graph input', 'Remove an external graph input.', {
      name: identifierSchema,
    }),
    commandDescriptor('set-output', 'Set graph output', 'Add or replace a named graph output.', {
      output: graphOutputSchema,
    }),
    commandDescriptor('remove-output', 'Remove graph output', 'Remove a named graph output.', {
      name: identifierSchema,
    }),
    ...(includeRoi
      ? [
          commandDescriptor('add-roi', 'Add ROI', 'Add a versioned region of interest.', {
            roi: contractSchema('purejsimage.roi'),
          }),
          commandDescriptor('update-roi', 'Update ROI', 'Replace one region of interest.', {
            roiId: identifierSchema,
            roi: contractSchema('purejsimage.roi'),
          }),
          commandDescriptor('remove-roi', 'Remove ROI', 'Remove one region of interest.', {
            roiId: identifierSchema,
          }),
          commandDescriptor('replace-roi-set', 'Replace ROI set', 'Replace the complete ROI set.', {
            roiSet: contractSchema('purejsimage.roi-set'),
          }),
        ]
      : []),
  ])

export interface AnalysisCommandValidation {
  readonly valid: boolean
  readonly issues: readonly AnalysisIssue[]
  readonly command?: AnalysisCommand
}

export interface AnalysisCommandApplication {
  readonly snapshot: AnalysisWorkspaceSnapshot
  readonly issues: readonly AnalysisIssue[]
  readonly applied: boolean
}

type UnknownRecord = Readonly<Record<string, unknown>>
const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const hasOnlyKeys = (value: UnknownRecord, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key))

const issue = (code: AnalysisIssue['code'], path: string, message: string): AnalysisIssue =>
  Object.freeze({ code, severity: 'error', path, message })

const string = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && value.length <= 4_096 ? value : undefined

const safeRevision = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined

const reference = (value: unknown): AnalysisValueReference | undefined => {
  if (!isRecord(value)) return undefined
  if (value.kind === 'input') {
    if (!hasOnlyKeys(value, ['kind', 'input'])) return undefined
    const input = string(value.input)
    return input === undefined ? undefined : Object.freeze({ kind: 'input', input })
  }
  if (value.kind === 'node') {
    if (!hasOnlyKeys(value, ['kind', 'nodeId', 'output'])) return undefined
    const nodeId = string(value.nodeId)
    const output = string(value.output)
    return nodeId === undefined || output === undefined
      ? undefined
      : Object.freeze({ kind: 'node', nodeId, output })
  }
  return undefined
}

const graphInput = (value: unknown): AnalysisGraphInput | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['name', 'valueType', 'label']) ||
    !isRecord(value.valueType) ||
    !hasOnlyKeys(value.valueType, ['id', 'version'])
  )
    return undefined
  const name = string(value.name)
  const id = string(value.valueType.id)
  const version = value.valueType.version
  const label = value.label
  if (
    name === undefined ||
    id === undefined ||
    typeof version !== 'number' ||
    !Number.isSafeInteger(version) ||
    version < 1 ||
    (label !== undefined && (typeof label !== 'string' || label.length > 4_096))
  )
    return undefined
  return Object.freeze({
    name,
    valueType: Object.freeze({ id, version }),
    ...(label === undefined ? {} : { label }),
  })
}

const graphOutput = (value: unknown): AnalysisGraphOutput | undefined => {
  if (!isRecord(value) || !hasOnlyKeys(value, ['name', 'source', 'label'])) return undefined
  const name = string(value.name)
  const source = reference(value.source)
  const label = value.label
  if (
    name === undefined ||
    source === undefined ||
    (label !== undefined && (typeof label !== 'string' || label.length > 4_096))
  )
    return undefined
  return Object.freeze({ name, source, ...(label === undefined ? {} : { label }) })
}

const graphNode = (value: unknown): AnalysisGraphNode | undefined => {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ['id', 'operation', 'inputs', 'parameters', 'label']) ||
    !isRecord(value.operation) ||
    !hasOnlyKeys(value.operation, ['id', 'version']) ||
    !Array.isArray(value.inputs)
  )
    return undefined
  const id = string(value.id)
  const operationId = string(value.operation.id)
  const operationVersion = value.operation.version
  const label = value.label
  if (
    id === undefined ||
    operationId === undefined ||
    typeof operationVersion !== 'number' ||
    !Number.isSafeInteger(operationVersion) ||
    operationVersion < 1 ||
    (label !== undefined && (typeof label !== 'string' || label.length > 4_096))
  )
    return undefined
  const inputs: AnalysisNodeInput[] = []
  for (const raw of value.inputs) {
    if (!isRecord(raw) || !hasOnlyKeys(raw, ['port', 'source'])) return undefined
    const port = string(raw.port)
    const source = reference(raw.source)
    if (port === undefined || source === undefined) return undefined
    inputs.push(Object.freeze({ port, source }))
  }
  let parameters: OperationJsonValue
  try {
    parameters = normalizeOperationJsonValue(value.parameters)
  } catch {
    return undefined
  }
  return Object.freeze({
    id,
    operation: Object.freeze({ id: operationId, version: operationVersion }),
    inputs: Object.freeze(inputs),
    parameters,
    ...(label === undefined ? {} : { label }),
  })
}

const roiValidationFailure = (
  prefix: string,
  issues: readonly { readonly code: string; readonly path: string; readonly message: string }[],
): AnalysisCommandValidation =>
  Object.freeze({
    valid: false,
    issues: Object.freeze(
      issues.map((entry) =>
        issue(
          entry.code === 'limit-exceeded'
            ? 'limit-exceeded'
            : entry.code === 'duplicate'
              ? 'duplicate'
              : 'invalid-parameter',
          `${prefix}${entry.path}`,
          entry.message,
        ),
      ),
    ),
  })

export const validateCommand = (
  input: unknown,
  roiContext?: Readonly<AnalysisWorkspaceRoiContext>,
): AnalysisCommandValidation => {
  if (!isRecord(input))
    return Object.freeze({
      valid: false,
      issues: Object.freeze([issue('invalid-graph', '', 'Command must be an object')]),
    })
  if (input.schemaVersion !== 1)
    return Object.freeze({
      valid: false,
      issues: Object.freeze([
        issue('invalid-graph', '/schemaVersion', 'Command schemaVersion must be 1'),
      ]),
    })
  const id = string(input.id)
  if (id === undefined)
    return Object.freeze({
      valid: false,
      issues: Object.freeze([issue('invalid-type', '/id', 'Command id is invalid')]),
    })
  const expectedRevision =
    input.expectedRevision === undefined ? undefined : safeRevision(input.expectedRevision)
  if (input.expectedRevision !== undefined && expectedRevision === undefined)
    return Object.freeze({
      valid: false,
      issues: Object.freeze([
        issue('invalid-type', '/expectedRevision', 'Expected revision is invalid'),
      ]),
    })
  const base = {
    schemaVersion: 1 as const,
    id,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  }
  const payloadKeys: Readonly<Record<string, readonly string[]>> = Object.freeze({
    'add-node': Object.freeze(['node']),
    'remove-node': Object.freeze(['nodeId']),
    connect: Object.freeze(['nodeId', 'port', 'source']),
    disconnect: Object.freeze(['nodeId', 'port']),
    'update-parameters': Object.freeze(['nodeId', 'parameters']),
    'bind-input': Object.freeze(['input']),
    'unbind-input': Object.freeze(['name']),
    'set-output': Object.freeze(['output']),
    'remove-output': Object.freeze(['name']),
    'add-roi': Object.freeze(['roi']),
    'update-roi': Object.freeze(['roiId', 'roi']),
    'remove-roi': Object.freeze(['roiId']),
    'replace-roi-set': Object.freeze(['roiSet']),
  })
  const keys = typeof input.kind === 'string' ? payloadKeys[input.kind] : undefined
  if (
    keys === undefined ||
    !hasOnlyKeys(input, ['schemaVersion', 'id', 'expectedRevision', 'kind', ...keys])
  ) {
    return Object.freeze({
      valid: false,
      issues: Object.freeze([issue('invalid-graph', '', 'Command fields are invalid')]),
    })
  }
  let command: AnalysisCommand | undefined
  if (input.kind === 'add-node') {
    const node = graphNode(input.node)
    if (node !== undefined) command = Object.freeze({ ...base, kind: 'add-node', node })
  } else if (input.kind === 'remove-node') {
    const nodeId = string(input.nodeId)
    if (nodeId !== undefined) command = Object.freeze({ ...base, kind: 'remove-node', nodeId })
  } else if (input.kind === 'connect') {
    const nodeId = string(input.nodeId)
    const port = string(input.port)
    const source = reference(input.source)
    if (nodeId !== undefined && port !== undefined && source !== undefined)
      command = Object.freeze({ ...base, kind: 'connect', nodeId, port, source })
  } else if (input.kind === 'disconnect') {
    const nodeId = string(input.nodeId)
    const port = string(input.port)
    if (nodeId !== undefined && port !== undefined)
      command = Object.freeze({ ...base, kind: 'disconnect', nodeId, port })
  } else if (input.kind === 'update-parameters') {
    const nodeId = string(input.nodeId)
    try {
      const parameters = normalizeOperationJsonValue(input.parameters)
      if (nodeId !== undefined)
        command = Object.freeze({
          ...base,
          kind: 'update-parameters',
          nodeId,
          parameters,
        })
    } catch {
      command = undefined
    }
  } else if (input.kind === 'bind-input') {
    const normalized = graphInput(input.input)
    if (normalized !== undefined)
      command = Object.freeze({ ...base, kind: 'bind-input', input: normalized })
  } else if (input.kind === 'unbind-input') {
    const name = string(input.name)
    if (name !== undefined) command = Object.freeze({ ...base, kind: 'unbind-input', name })
  } else if (input.kind === 'set-output') {
    const output = graphOutput(input.output)
    if (output !== undefined) command = Object.freeze({ ...base, kind: 'set-output', output })
  } else if (input.kind === 'remove-output') {
    const name = string(input.name)
    if (name !== undefined) command = Object.freeze({ ...base, kind: 'remove-output', name })
  } else if (input.kind === 'add-roi' || input.kind === 'update-roi') {
    if (roiContext === undefined) {
      return Object.freeze({
        valid: false,
        issues: Object.freeze([
          issue('invalid-parameter', '/roi', 'ROI commands require a scientific axis context'),
        ]),
      })
    }
    const result = validateRoi(input.roi, roiContext.descriptor, roiContext.limits)
    if (result.value === undefined) return roiValidationFailure('/roi', result.issues)
    if (input.kind === 'add-roi') {
      command = Object.freeze({ ...base, kind: 'add-roi', roi: result.value })
    } else {
      const roiId = string(input.roiId)
      if (roiId !== undefined && roiId === result.value.id) {
        command = Object.freeze({ ...base, kind: 'update-roi', roiId, roi: result.value })
      } else if (roiId !== undefined) {
        return Object.freeze({
          valid: false,
          issues: Object.freeze([
            issue('invalid-parameter', '/roi/id', 'Updated ROI id must match roiId'),
          ]),
        })
      }
    }
  } else if (input.kind === 'remove-roi') {
    if (roiContext === undefined) {
      return Object.freeze({
        valid: false,
        issues: Object.freeze([
          issue('invalid-parameter', '/roiId', 'ROI commands require a scientific axis context'),
        ]),
      })
    }
    const roiId = string(input.roiId)
    if (roiId !== undefined) command = Object.freeze({ ...base, kind: 'remove-roi', roiId })
  } else if (input.kind === 'replace-roi-set') {
    if (roiContext === undefined) {
      return Object.freeze({
        valid: false,
        issues: Object.freeze([
          issue('invalid-parameter', '/roiSet', 'ROI commands require a scientific axis context'),
        ]),
      })
    }
    const result = validateRoiSet(input.roiSet, roiContext.descriptor, roiContext.limits)
    if (result.value === undefined) return roiValidationFailure('/roiSet', result.issues)
    command = Object.freeze({ ...base, kind: 'replace-roi-set', roiSet: result.value })
  }
  return command === undefined
    ? Object.freeze({
        valid: false,
        issues: Object.freeze([issue('invalid-graph', '', 'Command payload is invalid')]),
      })
    : Object.freeze({ valid: true, issues: Object.freeze([]), command })
}

export const createAnalysisWorkspaceSnapshot = (
  graph: AnalysisGraph = Object.freeze({
    schemaVersion: 1,
    inputs: Object.freeze([]),
    nodes: Object.freeze([]),
    outputs: Object.freeze([]),
  }),
  revision = 0,
  roiSet: RoiSet = createEmptyRoiSet(),
  roiContext?: Readonly<AnalysisWorkspaceRoiContext>,
): AnalysisWorkspaceSnapshot => {
  if (!Number.isSafeInteger(revision) || revision < 0)
    throw new TypeError('Workspace revision must be non-negative')
  const copied: AnalysisGraph = Object.freeze({
    schemaVersion: 1,
    inputs: Object.freeze(
      graph.inputs.map((entry) =>
        Object.freeze({
          name: entry.name,
          valueType: Object.freeze({ ...entry.valueType }),
          ...(entry.label === undefined ? {} : { label: entry.label }),
        }),
      ),
    ),
    nodes: Object.freeze(
      graph.nodes.map((node) =>
        Object.freeze({
          id: node.id,
          operation: Object.freeze({ ...node.operation }),
          inputs: Object.freeze(
            node.inputs.map((entry) =>
              Object.freeze({ port: entry.port, source: Object.freeze({ ...entry.source }) }),
            ),
          ),
          parameters: normalizeOperationJsonValue(node.parameters),
          ...(node.label === undefined ? {} : { label: node.label }),
        }),
      ),
    ),
    outputs: Object.freeze(
      graph.outputs.map((entry) =>
        Object.freeze({
          name: entry.name,
          source: Object.freeze({ ...entry.source }),
          ...(entry.label === undefined ? {} : { label: entry.label }),
        }),
      ),
    ),
    ...(graph.label === undefined ? {} : { label: graph.label }),
  })
  if (roiSet.rois.length > 0 && roiContext === undefined) {
    throw new TypeError('Non-empty ROI state requires a scientific axis context')
  }
  const copiedRoiSet =
    roiContext === undefined
      ? createEmptyRoiSet()
      : normalizeRoiSet(roiSet, roiContext.descriptor, roiContext.limits)
  return Object.freeze({ schemaVersion: 1, revision, graph: copied, roiSet: copiedRoiSet })
}

const failure = (
  snapshot: AnalysisWorkspaceSnapshot,
  code: AnalysisIssue['code'],
  path: string,
  message: string,
): AnalysisCommandApplication =>
  Object.freeze({ snapshot, issues: Object.freeze([issue(code, path, message)]), applied: false })

export const applyCommand = (
  snapshot: AnalysisWorkspaceSnapshot,
  input: unknown,
  operations: OperationRegistry,
  limits: Readonly<AnalysisLimits> = {},
  roiContext?: Readonly<AnalysisWorkspaceRoiContext>,
): AnalysisCommandApplication => {
  const validation = validateCommand(input, roiContext)
  const command = validation.command
  if (command === undefined)
    return Object.freeze({ snapshot, issues: validation.issues, applied: false })
  if (command.expectedRevision !== undefined && command.expectedRevision !== snapshot.revision)
    return failure(
      snapshot,
      'stale-revision',
      '/expectedRevision',
      `Expected revision ${command.expectedRevision}; current revision is ${snapshot.revision}`,
    )
  let inputs = [...snapshot.graph.inputs]
  let nodes = [...snapshot.graph.nodes]
  let outputs = [...snapshot.graph.outputs]
  let roiSet = snapshot.roiSet
  const resolveSourceType = (
    source: AnalysisValueReference,
  ): { readonly id: string; readonly version?: number } | undefined => {
    if (source.kind === 'input') {
      return inputs.find((entry) => entry.name === source.input)?.valueType
    }
    const sourceNode = nodes.find((entry) => entry.id === source.nodeId)
    if (sourceNode === undefined) return undefined
    return operations
      .get(sourceNode.operation.id, sourceNode.operation.version)
      ?.descriptor.outputs.find((entry) => entry.name === source.output)?.valueType
  }
  const createsCycle = (nodeId: string, sourceNodeId: string): boolean => {
    const pending = [sourceNodeId]
    const seen = new Set<string>()
    while (pending.length > 0) {
      const current = pending.pop()
      if (current === undefined) break
      if (current === nodeId) return true
      if (seen.has(current)) continue
      seen.add(current)
      const node = nodes.find((entry) => entry.id === current)
      for (const connection of node?.inputs ?? []) {
        if (connection.source.kind === 'node') pending.push(connection.source.nodeId)
      }
    }
    return false
  }
  if (command.kind === 'add-roi') {
    if (roiSet.rois.some((entry) => entry.id === command.roi.id)) {
      return failure(snapshot, 'duplicate', '/roi/id', `ROI ${command.roi.id} already exists`)
    }
    roiSet = Object.freeze({ ...roiSet, rois: Object.freeze([...roiSet.rois, command.roi]) })
  } else if (command.kind === 'update-roi') {
    const index = roiSet.rois.findIndex((entry) => entry.id === command.roiId)
    if (index < 0) {
      return failure(snapshot, 'invalid-reference', '/roiId', `ROI ${command.roiId} does not exist`)
    }
    const rois = [...roiSet.rois]
    rois[index] = command.roi
    roiSet = Object.freeze({ ...roiSet, rois: Object.freeze(rois) })
  } else if (command.kind === 'remove-roi') {
    if (!roiSet.rois.some((entry) => entry.id === command.roiId)) {
      return failure(snapshot, 'invalid-reference', '/roiId', `ROI ${command.roiId} does not exist`)
    }
    roiSet = Object.freeze({
      ...roiSet,
      rois: Object.freeze(roiSet.rois.filter((entry) => entry.id !== command.roiId)),
    })
  } else if (command.kind === 'replace-roi-set') {
    roiSet = command.roiSet
  } else if (command.kind === 'add-node') {
    if (nodes.some((node) => node.id === command.node.id))
      return failure(snapshot, 'duplicate', '/node/id', `Node ${command.node.id} already exists`)
    const definition = operations.get(command.node.operation.id, command.node.operation.version)
    if (definition === undefined)
      return failure(
        snapshot,
        'unknown-operation',
        '/node/operation',
        'Command references an unknown operation',
      )
    const parameters = definition.normalizeParameters(command.node.parameters)
    if (parameters.value === undefined)
      return failure(
        snapshot,
        'invalid-parameter',
        '/node/parameters',
        parameters.issues[0]?.message ?? 'Node parameters are invalid',
      )
    const seenPorts = new Set<string>()
    for (const connection of command.node.inputs) {
      const port = definition.descriptor.inputs.find((entry) => entry.name === connection.port)
      if (port === undefined)
        return failure(
          snapshot,
          'unknown-port',
          '/node/inputs',
          `Input port ${connection.port} does not exist`,
        )
      if (seenPorts.has(connection.port) && port.variadic !== true)
        return failure(snapshot, 'duplicate', '/node/inputs', 'Input port is connected twice')
      seenPorts.add(connection.port)
      const sourceType = resolveSourceType(connection.source)
      if (sourceType === undefined)
        return failure(
          snapshot,
          'invalid-reference',
          '/node/inputs',
          'Connection source does not exist',
        )
      if (
        sourceType.id !== port.valueType.id ||
        (port.valueType.version !== undefined && sourceType.version !== port.valueType.version)
      )
        return failure(
          snapshot,
          'invalid-type',
          '/node/inputs',
          'Connection source type is incompatible',
        )
    }
    nodes.push(Object.freeze({ ...command.node, parameters: parameters.value }))
  } else if (command.kind === 'remove-node') {
    if (!nodes.some((node) => node.id === command.nodeId))
      return failure(
        snapshot,
        'invalid-reference',
        '/nodeId',
        `Node ${command.nodeId} does not exist`,
      )
    if (
      nodes.some((node) =>
        node.inputs.some(
          (entry) => entry.source.kind === 'node' && entry.source.nodeId === command.nodeId,
        ),
      ) ||
      outputs.some(
        (output) => output.source.kind === 'node' && output.source.nodeId === command.nodeId,
      )
    )
      return failure(
        snapshot,
        'invalid-reference',
        '/nodeId',
        `Node ${command.nodeId} is still referenced`,
      )
    nodes = nodes.filter((node) => node.id !== command.nodeId)
  } else if (command.kind === 'connect' || command.kind === 'disconnect') {
    const index = nodes.findIndex((node) => node.id === command.nodeId)
    const node = nodes[index]
    if (node === undefined)
      return failure(
        snapshot,
        'invalid-reference',
        '/nodeId',
        `Node ${command.nodeId} does not exist`,
      )
    const definition = operations.get(node.operation.id, node.operation.version)
    const port = definition?.descriptor.inputs.find((entry) => entry.name === command.port)
    if (port === undefined)
      return failure(snapshot, 'unknown-port', '/port', `Input port ${command.port} does not exist`)
    if (command.kind === 'disconnect' && !node.inputs.some((entry) => entry.port === command.port))
      return failure(
        snapshot,
        'invalid-reference',
        '/port',
        `Input port ${command.port} is not connected`,
      )
    const connected =
      command.kind === 'connect' && port.variadic === true
        ? [...node.inputs]
        : node.inputs.filter((entry) => entry.port !== command.port)
    if (command.kind === 'connect') {
      const sourceType = resolveSourceType(command.source)
      if (sourceType === undefined)
        return failure(snapshot, 'invalid-reference', '/source', 'Connection source does not exist')
      if (
        sourceType.id !== port.valueType.id ||
        (port.valueType.version !== undefined && sourceType.version !== port.valueType.version)
      )
        return failure(
          snapshot,
          'invalid-type',
          '/source',
          'Connection source type is incompatible',
        )
      if (command.source.kind === 'node' && createsCycle(command.nodeId, command.source.nodeId))
        return failure(snapshot, 'cycle', '/source', 'Connection would create a cycle')
      connected.push(Object.freeze({ port: command.port, source: command.source }))
    }
    nodes[index] = Object.freeze({ ...node, inputs: Object.freeze(connected) })
  } else if (command.kind === 'update-parameters') {
    const index = nodes.findIndex((node) => node.id === command.nodeId)
    const node = nodes[index]
    if (node === undefined)
      return failure(
        snapshot,
        'invalid-reference',
        '/nodeId',
        `Node ${command.nodeId} does not exist`,
      )
    const definition = operations.get(node.operation.id, node.operation.version)
    const parameters = definition?.normalizeParameters(command.parameters)
    if (parameters?.value === undefined)
      return failure(
        snapshot,
        'invalid-parameter',
        '/parameters',
        parameters?.issues[0]?.message ?? 'Parameters are invalid',
      )
    nodes[index] = Object.freeze({ ...node, parameters: parameters.value })
  } else if (command.kind === 'bind-input') {
    for (const node of nodes) {
      const definition = operations.get(node.operation.id, node.operation.version)
      for (const connection of node.inputs) {
        if (connection.source.kind !== 'input' || connection.source.input !== command.input.name)
          continue
        const port = definition?.descriptor.inputs.find((entry) => entry.name === connection.port)
        if (
          port !== undefined &&
          (port.valueType.id !== command.input.valueType.id ||
            (port.valueType.version !== undefined &&
              port.valueType.version !== command.input.valueType.version))
        )
          return failure(
            snapshot,
            'invalid-type',
            '/input/valueType',
            `Input ${command.input.name} is incompatible with ${node.id}.${connection.port}`,
          )
      }
    }
    inputs = [...inputs.filter((entry) => entry.name !== command.input.name), command.input]
  } else if (command.kind === 'unbind-input') {
    if (!inputs.some((entry) => entry.name === command.name))
      return failure(snapshot, 'invalid-reference', '/name', `Input ${command.name} does not exist`)
    if (
      nodes.some((node) =>
        node.inputs.some(
          (entry) => entry.source.kind === 'input' && entry.source.input === command.name,
        ),
      ) ||
      outputs.some(
        (output) => output.source.kind === 'input' && output.source.input === command.name,
      )
    )
      return failure(
        snapshot,
        'invalid-reference',
        '/name',
        `Input ${command.name} is still referenced`,
      )
    inputs = inputs.filter((entry) => entry.name !== command.name)
  } else if (command.kind === 'set-output') {
    if (resolveSourceType(command.output.source) === undefined)
      return failure(
        snapshot,
        'invalid-reference',
        '/output/source',
        'Output source does not exist',
      )
    outputs = [...outputs.filter((entry) => entry.name !== command.output.name), command.output]
  } else {
    if (!outputs.some((entry) => entry.name === command.name))
      return failure(
        snapshot,
        'invalid-reference',
        '/name',
        `Output ${command.name} does not exist`,
      )
    outputs = outputs.filter((entry) => entry.name !== command.name)
  }
  if (
    roiContext !== undefined &&
    (command.kind === 'add-roi' ||
      command.kind === 'update-roi' ||
      command.kind === 'remove-roi' ||
      command.kind === 'replace-roi-set')
  ) {
    const roiValidation = validateRoiSet(roiSet, roiContext.descriptor, roiContext.limits)
    if (roiValidation.value === undefined) {
      const roiIssue = roiValidation.issues[0]
      return failure(
        snapshot,
        roiIssue?.code === 'limit-exceeded'
          ? 'limit-exceeded'
          : roiIssue?.code === 'duplicate'
            ? 'duplicate'
            : 'invalid-parameter',
        roiIssue?.path ?? '/roiSet',
        roiIssue?.message ?? 'ROI set is invalid',
      )
    }
    roiSet = roiValidation.value
  }
  const maxNodes = limits.maxNodes ?? 10_000
  const maxEdges = limits.maxEdges ?? 100_000
  if (
    nodes.length > maxNodes ||
    nodes.reduce((sum, node) => sum + node.inputs.length, 0) > maxEdges
  )
    return failure(snapshot, 'limit-exceeded', '', 'Command would exceed workspace graph limits')
  const graph: AnalysisGraph = Object.freeze({
    ...snapshot.graph,
    inputs: Object.freeze(inputs),
    nodes: Object.freeze(nodes),
    outputs: Object.freeze(outputs),
  })
  const bounded = validateGraph(graph, operations, limits)
  const limitIssue = bounded.issues.find((entry) => entry.code === 'limit-exceeded')
  if (limitIssue !== undefined) {
    return failure(snapshot, limitIssue.code, limitIssue.path, limitIssue.message)
  }
  const next = Object.freeze({
    schemaVersion: 1 as const,
    revision: snapshot.revision + 1,
    graph,
    roiSet,
  })
  return Object.freeze({ snapshot: next, issues: Object.freeze([]), applied: true })
}
