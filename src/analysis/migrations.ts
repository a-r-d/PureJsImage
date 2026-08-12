import { invalidInput } from '../errors.ts'
import type { OperationJsonObject } from '../operations/descriptor.ts'
import type { OperationRegistry } from '../operations/registry.ts'
import type { AnalysisGraph, AnalysisLimits } from './graph.ts'
import { hashAnalysisGraph, validateGraph } from './graph.ts'

interface MigrationBase {
  readonly id: string
  readonly version: number
  readonly fromVersion: number
  readonly toVersion: number
}

export interface GraphSchemaMigration extends MigrationBase {
  readonly kind: 'graph-schema'
  migrate(graph: unknown): unknown
}

export interface OperationMigration extends MigrationBase {
  readonly kind: 'operation'
  readonly operationId: string
  migrate(node: unknown): unknown
}

export type AnalysisMigrationDefinition = GraphSchemaMigration | OperationMigration

export interface AnalysisMigrationDescriptor extends OperationJsonObject {
  readonly kind: 'graph-schema' | 'operation'
  readonly id: string
  readonly version: number
  readonly fromVersion: number
  readonly toVersion: number
  readonly operationId: string | null
}

export const describeAnalysisMigration = (
  migration: AnalysisMigrationDefinition,
): AnalysisMigrationDescriptor =>
  Object.freeze({
    kind: migration.kind,
    id: migration.id,
    version: migration.version,
    fromVersion: migration.fromVersion,
    toVersion: migration.toVersion,
    operationId: migration.kind === 'operation' ? migration.operationId : null,
  })

interface AnalysisMigrationStepBase extends OperationJsonObject {
  readonly migrationId: string
  readonly migrationVersion: number
  readonly fromVersion: number
  readonly toVersion: number
}

export interface GraphSchemaMigrationStep extends AnalysisMigrationStepBase {
  readonly kind: 'graph-schema'
}

export interface OperationMigrationStep extends AnalysisMigrationStepBase {
  readonly kind: 'operation'
  readonly operationId: string
  readonly nodeId: string
}

export type AnalysisMigrationStep = GraphSchemaMigrationStep | OperationMigrationStep

export interface AnalysisMigrationPlan extends OperationJsonObject {
  readonly steps: readonly AnalysisMigrationStep[]
  readonly sourceSchemaVersion: number
  readonly targetSchemaVersion: number
}

const positive = (value: number): boolean => Number.isSafeInteger(value) && value > 0
const key = (migration: AnalysisMigrationDefinition): string =>
  migration.kind === 'graph-schema'
    ? `graph\u0000${migration.fromVersion}\u0000${migration.toVersion}`
    : `operation\u0000${migration.operationId}\u0000${migration.fromVersion}\u0000${migration.toVersion}`

export class AnalysisMigrationRegistry {
  readonly #definitions: ReadonlyMap<string, AnalysisMigrationDefinition>
  readonly #ordered: readonly AnalysisMigrationDefinition[]

  constructor(definitions: Iterable<AnalysisMigrationDefinition>) {
    const normalized = new Map<string, AnalysisMigrationDefinition>()
    const ordered: AnalysisMigrationDefinition[] = []
    const ids = new Set<string>()
    for (const definition of definitions) {
      if (
        typeof definition.id !== 'string' ||
        definition.id.trim().length === 0 ||
        !positive(definition.version) ||
        !positive(definition.fromVersion) ||
        !positive(definition.toVersion) ||
        (definition.kind !== 'graph-schema' && definition.kind !== 'operation') ||
        typeof definition.migrate !== 'function' ||
        definition.toVersion <= definition.fromVersion ||
        (definition.kind === 'operation' &&
          (typeof definition.operationId !== 'string' ||
            definition.operationId.trim().length === 0))
      ) {
        throw invalidInput('Analysis migration definition is invalid')
      }
      const identity = `${definition.id}\u0000${definition.version}`
      if (ids.has(identity))
        throw invalidInput(
          `Analysis migration already registered: ${definition.id}@${definition.version}`,
        )
      ids.add(identity)
      const edge = key(definition)
      if (normalized.has(edge)) throw invalidInput('Analysis migration edge is ambiguous')
      const frozen = Object.freeze({ ...definition })
      normalized.set(edge, frozen)
      ordered.push(frozen)
    }
    this.#definitions = normalized
    this.#ordered = Object.freeze(ordered)
    Object.freeze(this)
  }

  definitions(): readonly AnalysisMigrationDefinition[] {
    return this.#ordered
  }

  resolve(step: AnalysisMigrationStep): AnalysisMigrationDefinition | undefined {
    const found = this.#definitions.get(
      step.kind === 'graph-schema'
        ? `graph\u0000${step.fromVersion}\u0000${step.toVersion}`
        : `operation\u0000${step.operationId ?? ''}\u0000${step.fromVersion}\u0000${step.toVersion}`,
    )
    return found?.id === step.migrationId && found.version === step.migrationVersion
      ? found
      : undefined
  }
}

export const createAnalysisMigrationRegistry = (
  definitions: Iterable<AnalysisMigrationDefinition> = [],
): AnalysisMigrationRegistry => new AnalysisMigrationRegistry(definitions)

type UnknownRecord = Readonly<Record<string, unknown>>
const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const record = (value: unknown): UnknownRecord | undefined => (isRecord(value) ? value : undefined)

const findPath = (
  definitions: readonly AnalysisMigrationDefinition[],
  kind: AnalysisMigrationDefinition['kind'],
  fromVersion: number,
  toVersion: number,
  operationId?: string,
): readonly AnalysisMigrationDefinition[] => {
  if (toVersion < fromVersion) throw invalidInput('Analysis migration downgrades are not supported')
  if (toVersion === fromVersion) return Object.freeze([])
  const candidates = definitions.filter(
    (definition) =>
      definition.kind === kind &&
      (definition.kind !== 'operation' || definition.operationId === operationId),
  )
  const paths: AnalysisMigrationDefinition[][] = []
  const visit = (
    current: number,
    path: AnalysisMigrationDefinition[],
    visited: ReadonlySet<number>,
  ): void => {
    if (paths.length > 1) return
    if (current === toVersion) {
      paths.push([...path])
      return
    }
    for (const candidate of candidates) {
      if (
        candidate.fromVersion !== current ||
        candidate.toVersion > toVersion ||
        visited.has(candidate.toVersion)
      )
        continue
      visit(candidate.toVersion, [...path, candidate], new Set([...visited, candidate.toVersion]))
    }
  }
  visit(fromVersion, [], new Set([fromVersion]))
  if (paths.length === 0)
    throw invalidInput(`Missing migration path from ${fromVersion} to ${toVersion}`)
  if (paths.length > 1)
    throw invalidInput(`Ambiguous migration path from ${fromVersion} to ${toVersion}`)
  return Object.freeze(paths[0] ?? [])
}

export interface InspectMigrationOptions {
  readonly targetSchemaVersion: number
  readonly operationTargets?: Readonly<Record<string, number>>
}

export const inspectMigrationPlan = (
  graph: unknown,
  registry: AnalysisMigrationRegistry,
  options: Readonly<InspectMigrationOptions>,
): AnalysisMigrationPlan => {
  const input = record(graph)
  const declaredSchemaVersion = input?.schemaVersion
  if (typeof declaredSchemaVersion !== 'number' || !positive(declaredSchemaVersion)) {
    throw invalidInput('Migrated graph must declare a positive schemaVersion')
  }
  const sourceSchemaVersion = declaredSchemaVersion
  if (!positive(options.targetSchemaVersion)) {
    throw invalidInput('Target graph schema version must be positive')
  }
  for (const [operationId, target] of Object.entries(options.operationTargets ?? {})) {
    if (operationId.trim().length === 0 || !positive(target)) {
      throw invalidInput('Operation migration targets must use non-empty IDs and positive versions')
    }
  }
  const steps: AnalysisMigrationStep[] = []
  for (const migration of findPath(
    registry.definitions(),
    'graph-schema',
    sourceSchemaVersion,
    options.targetSchemaVersion,
  )) {
    steps.push(
      Object.freeze({
        kind: 'graph-schema',
        migrationId: migration.id,
        migrationVersion: migration.version,
        fromVersion: migration.fromVersion,
        toVersion: migration.toVersion,
      }),
    )
  }
  if (Array.isArray(input?.nodes)) {
    for (const rawNode of input.nodes) {
      const node = record(rawNode)
      const operation = record(node?.operation)
      const nodeId = node?.id
      const operationId = operation?.id
      const fromVersion = operation?.version
      if (
        typeof nodeId !== 'string' ||
        typeof operationId !== 'string' ||
        typeof fromVersion !== 'number'
      )
        continue
      const target = options.operationTargets?.[operationId]
      if (target === undefined) continue
      for (const migration of findPath(
        registry.definitions(),
        'operation',
        fromVersion,
        target,
        operationId,
      )) {
        steps.push(
          Object.freeze({
            kind: 'operation',
            migrationId: migration.id,
            migrationVersion: migration.version,
            operationId,
            nodeId,
            fromVersion: migration.fromVersion,
            toVersion: migration.toVersion,
          }),
        )
      }
    }
  }
  return Object.freeze({
    steps: Object.freeze(steps),
    sourceSchemaVersion,
    targetSchemaVersion: options.targetSchemaVersion,
  })
}

export interface AppliedMigration {
  readonly graph: AnalysisGraph
  readonly graphHash: string
  readonly plan: AnalysisMigrationPlan
}

export const applyMigrationPlan = async (
  input: unknown,
  plan: AnalysisMigrationPlan,
  migrations: AnalysisMigrationRegistry,
  operations: OperationRegistry,
  limits: Readonly<AnalysisLimits> = {},
): Promise<AppliedMigration> => {
  const source = record(input)
  if (source?.schemaVersion !== plan.sourceSchemaVersion) {
    throw invalidInput('Migration plan source schema version does not match the graph')
  }
  let migrated: unknown = input
  let schemaVersion = plan.sourceSchemaVersion
  for (const step of plan.steps) {
    const definition = migrations.resolve(step)
    if (definition === undefined)
      throw invalidInput(`Migration ${step.migrationId}@${step.migrationVersion} is unavailable`)
    if (definition.kind === 'graph-schema') {
      if (step.fromVersion !== schemaVersion) {
        throw invalidInput('Graph migration steps are not contiguous')
      }
      migrated = definition.migrate(migrated)
      const migratedGraph = record(migrated)
      if (migratedGraph?.schemaVersion !== step.toVersion) {
        throw invalidInput(
          `Graph migration ${step.migrationId}@${step.migrationVersion} did not produce schemaVersion ${step.toVersion}`,
        )
      }
      schemaVersion = step.toVersion
      continue
    }
    const graph = record(migrated)
    if (graph === undefined || !Array.isArray(graph.nodes))
      throw invalidInput('Operation migration requires graph nodes')
    let found = false
    migrated = {
      ...graph,
      nodes: graph.nodes.map((rawNode) => {
        const node = record(rawNode)
        if (node === undefined || node.id !== step.nodeId) return rawNode
        const operation = record(node.operation)
        if (operation?.id !== definition.operationId || operation.version !== step.fromVersion) {
          throw invalidInput(
            `Operation migration source ${step.nodeId ?? ''} does not match ${definition.operationId}@${step.fromVersion}`,
          )
        }
        found = true
        const output = definition.migrate(rawNode)
        const migratedNode = record(output)
        const migratedOperation = record(migratedNode?.operation)
        if (
          migratedNode?.id !== step.nodeId ||
          migratedOperation?.id !== definition.operationId ||
          migratedOperation.version !== step.toVersion
        ) {
          throw invalidInput(
            `Operation migration ${step.migrationId}@${step.migrationVersion} did not produce ${definition.operationId}@${step.toVersion}`,
          )
        }
        return output
      }),
    }
    if (!found) throw invalidInput(`Operation migration node ${step.nodeId ?? ''} is unavailable`)
  }
  if (schemaVersion !== plan.targetSchemaVersion) {
    throw invalidInput('Migration plan does not reach its target schema version')
  }
  const validation = validateGraph(migrated, operations, limits)
  if (validation.graph === undefined)
    throw invalidInput(validation.issues[0]?.message ?? 'Migrated graph is invalid')
  return Object.freeze({
    graph: validation.graph,
    graphHash: await hashAnalysisGraph(validation.graph),
    plan,
  })
}
