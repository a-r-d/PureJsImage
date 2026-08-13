import { describe, expect, it } from 'vitest'
import {
  AnalysisMigrationRegistry,
  applyCommand,
  applyMigrationPlan,
  createAnalysisWorkspaceSnapshot,
  inspectMigrationPlan,
  validateCommand,
} from '../src/analysis/index.ts'
import type { AnalysisGraph, OperationMigration } from '../src/analysis/index.ts'
import { createOperationDefinition, createOperationRegistry } from '../src/operations/index.ts'

const operation = (version: number) =>
  createOperationDefinition({
    descriptor: {
      id: 'example.number.scale',
      version,
      title: 'Scale',
      category: 'analysis',
      tags: [],
      inputs: [{ name: 'value', valueType: { id: 'example.value.number', version: 1 } }],
      outputs: [{ name: 'result', valueType: { id: 'example.value.number', version: 1 } }],
      parameters: {
        type: 'object',
        properties: { factor: { type: 'number', default: version } },
        closed: true,
      },
      execution: 'tile-local',
      reproducibility: { class: 'bit-exact' },
    },
  })

const operations = createOperationRegistry([operation(1), operation(2), operation(3)])

const graph = (): AnalysisGraph => ({
  schemaVersion: 1,
  inputs: [{ name: 'value', valueType: { id: 'example.value.number', version: 1 } }],
  nodes: [
    {
      id: 'scale',
      operation: { id: 'example.number.scale', version: 1 },
      inputs: [{ port: 'value', source: { kind: 'input', input: 'value' } }],
      parameters: { factor: 1 },
    },
  ],
  outputs: [{ name: 'result', source: { kind: 'node', nodeId: 'scale', output: 'result' } }],
})

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const record = (value: unknown): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) {
    throw new TypeError('Expected an object')
  }
  return value
}

const operationMigration = (fromVersion: number, toVersion: number): OperationMigration => ({
  kind: 'operation',
  id: `example.scale.${fromVersion}-to-${toVersion}`,
  version: 1,
  operationId: 'example.number.scale',
  fromVersion,
  toVersion,
  migrate(node: unknown): unknown {
    const value = record(node)
    return {
      ...value,
      operation: { id: 'example.number.scale', version: toVersion },
      parameters: { factor: toVersion },
    }
  },
})

describe('explicit analysis migrations', () => {
  it('inspects and explicitly applies exact migration chains, then revalidates and rehashes', async () => {
    const registry = new AnalysisMigrationRegistry([
      operationMigration(1, 2),
      operationMigration(2, 3),
    ])
    const plan = inspectMigrationPlan(graph(), registry, {
      targetSchemaVersion: 1,
      operationTargets: { 'example.number.scale': 3 },
    })
    expect(plan.steps.map((step) => [step.fromVersion, step.toVersion])).toEqual([
      [1, 2],
      [2, 3],
    ])
    const applied = await applyMigrationPlan(graph(), plan, registry, operations)
    expect(applied.graph.nodes[0]).toMatchObject({
      operation: { id: 'example.number.scale', version: 3 },
      parameters: { factor: 3 },
    })
    expect(applied.graphHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan)
  })

  it('rejects ambiguous, missing, cyclic, downgrade, and tampered plans', async () => {
    const ambiguous = new AnalysisMigrationRegistry([
      operationMigration(1, 2),
      operationMigration(2, 3),
      operationMigration(1, 3),
    ])
    expect(() =>
      inspectMigrationPlan(graph(), ambiguous, {
        targetSchemaVersion: 1,
        operationTargets: { 'example.number.scale': 3 },
      }),
    ).toThrow('Ambiguous')
    expect(() =>
      inspectMigrationPlan(graph(), new AnalysisMigrationRegistry([]), {
        targetSchemaVersion: 1,
        operationTargets: { 'example.number.scale': 2 },
      }),
    ).toThrow('Missing')
    expect(() => new AnalysisMigrationRegistry([operationMigration(2, 1)])).toThrow('invalid')
    const newerGraph: AnalysisGraph = {
      ...graph(),
      nodes: graph().nodes.map((node) => ({
        ...node,
        operation: { ...node.operation, version: 2 },
      })),
    }
    expect(() =>
      inspectMigrationPlan(newerGraph, new AnalysisMigrationRegistry([]), {
        targetSchemaVersion: 1,
        operationTargets: { 'example.number.scale': 1 },
      }),
    ).toThrow('downgrade')

    const registry = new AnalysisMigrationRegistry([operationMigration(1, 2)])
    const plan = inspectMigrationPlan(graph(), registry, {
      targetSchemaVersion: 1,
      operationTargets: { 'example.number.scale': 2 },
    })
    await expect(
      applyMigrationPlan(graph(), { ...plan, sourceSchemaVersion: 2 }, registry, operations),
    ).rejects.toThrow('does not match')
  })
})

describe('immutable analysis workspace commands', () => {
  it('returns unchanged snapshots for stale, malformed, and invalid graph edits', () => {
    const snapshot = createAnalysisWorkspaceSnapshot(graph(), 4)
    const stale = applyCommand(
      snapshot,
      {
        schemaVersion: 1,
        id: 'stale',
        kind: 'update-parameters',
        expectedRevision: 3,
        nodeId: 'scale',
        parameters: { factor: 2 },
      },
      operations,
    )
    expect(stale.applied).toBe(false)
    expect(stale.snapshot).toBe(snapshot)
    expect(stale.issues[0]?.code).toBe('stale-revision')

    expect(
      validateCommand({
        schemaVersion: 1,
        id: 'unknown-field',
        expectedRevision: 4,
        kind: 'remove-output',
        name: 'result',
        eval: 'doSomething()',
      }).valid,
    ).toBe(false)
    const missing = applyCommand(
      snapshot,
      {
        schemaVersion: 1,
        id: 'missing',
        expectedRevision: 4,
        kind: 'remove-output',
        name: 'unknown',
      },
      operations,
    )
    expect(missing.applied).toBe(false)
    expect(missing.snapshot).toBe(snapshot)
  })

  it('rejects unknown and cyclic connections without mutating the source snapshot', () => {
    const secondGraph: AnalysisGraph = {
      ...graph(),
      nodes: [
        ...graph().nodes,
        {
          id: 'second',
          operation: { id: 'example.number.scale', version: 1 },
          inputs: [{ port: 'value', source: { kind: 'node', nodeId: 'scale', output: 'result' } }],
          parameters: {},
        },
      ],
      outputs: [],
    }
    const snapshot = createAnalysisWorkspaceSnapshot(secondGraph)
    const unknown = applyCommand(
      snapshot,
      {
        schemaVersion: 1,
        id: 'unknown',
        expectedRevision: 0,
        kind: 'connect',
        nodeId: 'scale',
        port: 'value',
        source: { kind: 'node', nodeId: 'missing', output: 'result' },
      },
      operations,
    )
    expect(unknown.issues[0]?.code).toBe('invalid-reference')
    expect(unknown.snapshot).toBe(snapshot)
    const cycle = applyCommand(
      snapshot,
      {
        schemaVersion: 1,
        id: 'cycle',
        expectedRevision: 0,
        kind: 'connect',
        nodeId: 'scale',
        port: 'value',
        source: { kind: 'node', nodeId: 'second', output: 'result' },
      },
      operations,
    )
    expect(cycle.issues[0]?.code).toBe('cycle')
    expect(cycle.snapshot).toBe(snapshot)
  })

  it('produces deterministic JSON snapshots and increments revisions only on application', () => {
    const mutableGraph = {
      schemaVersion: 1 as const,
      inputs: [{ name: 'value', valueType: { id: 'example.value.number', version: 1 } }],
      nodes: [
        {
          id: 'scale',
          operation: { id: 'example.number.scale', version: 1 },
          inputs: [{ port: 'value', source: { kind: 'input' as const, input: 'value' } }],
          parameters: { factor: 1 },
        },
      ],
      outputs: [
        { name: 'result', source: { kind: 'node' as const, nodeId: 'scale', output: 'result' } },
      ],
    }
    const snapshot = createAnalysisWorkspaceSnapshot(mutableGraph)
    const mutableNode = mutableGraph.nodes[0]
    if (mutableNode === undefined) throw new Error('Expected a mutable node')
    mutableNode.parameters.factor = 99
    expect(snapshot.graph.nodes[0]?.parameters).toEqual({ factor: 1 })
    const command = {
      schemaVersion: 1,
      id: 'parameters',
      kind: 'update-parameters',
      expectedRevision: 0,
      nodeId: 'scale',
      parameters: { factor: 7 },
    }
    const first = applyCommand(snapshot, command, operations)
    const second = applyCommand(snapshot, command, operations)
    expect(first.applied).toBe(true)
    expect(first.snapshot.revision).toBe(1)
    expect(JSON.stringify(first.snapshot)).toBe(JSON.stringify(second.snapshot))
    expect(snapshot.revision).toBe(0)
    expect(snapshot.graph.nodes[0]?.parameters).toEqual({ factor: 1 })
  })
})
