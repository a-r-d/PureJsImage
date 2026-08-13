import { describe, expect, it } from 'vitest'
import { canonicalGraphJson, hashAnalysisGraph, validateGraph } from '../src/analysis/index.ts'
import { canonicalJson } from '../src/analysis/project-entry.ts'
import type { AnalysisGraph, AnalysisValueReference } from '../src/analysis/index.ts'
import { createOperationDefinition, createOperationRegistry } from '../src/operations/index.ts'

const operation = (version = 1) =>
  createOperationDefinition({
    descriptor: {
      id: 'example.math.add',
      version,
      title: 'Add',
      category: 'analysis',
      tags: [],
      inputs: [
        { name: 'left', valueType: { id: 'example.value.number', version: 1 } },
        { name: 'right', valueType: { id: 'example.value.number', version: 1 } },
      ],
      outputs: [{ name: 'sum', valueType: { id: 'example.value.number', version: 1 } }],
      parameters: {
        type: 'object',
        properties: { scale: { type: 'number', default: 1, finiteOnly: true } },
        closed: true,
      },
      execution: 'reduction',
      reproducibility: { class: 'bit-exact' },
    },
  })

const registry = createOperationRegistry([operation(1), operation(2)])

const inputReference = (input: string): AnalysisValueReference => ({ kind: 'input', input })
const nodeReference = (nodeId: string, output: string): AnalysisValueReference => ({
  kind: 'node',
  nodeId,
  output,
})

const graph = (): AnalysisGraph => ({
  schemaVersion: 1,
  label: 'Editable graph title',
  inputs: [
    { name: 'a', valueType: { id: 'example.value.number', version: 1 }, label: 'First' },
    { name: 'b', valueType: { id: 'example.value.number', version: 1 } },
  ],
  nodes: [
    {
      id: 'second',
      operation: { id: 'example.math.add', version: 1 },
      inputs: [
        { port: 'left', source: nodeReference('first', 'sum') },
        { port: 'right', source: inputReference('a') },
      ],
      parameters: { scale: 1 },
    },
    {
      id: 'first',
      label: 'Human-only label',
      operation: { id: 'example.math.add', version: 1 },
      inputs: [
        { port: 'left', source: inputReference('a') },
        { port: 'right', source: inputReference('b') },
      ],
      parameters: {},
    },
  ],
  outputs: [{ name: 'answer', source: nodeReference('second', 'sum'), label: 'Result' }],
})

describe('analysis graph validation and canonical hashing', () => {
  it('normalizes parameters and returns a stable topological order', () => {
    const result = validateGraph(graph(), registry)
    expect(result.valid).toBe(true)
    expect(result.nodeOrder).toEqual(['first', 'second'])
    expect(result.graph?.nodes[1]?.parameters).toEqual({ scale: 1 })
  })

  it('hashes semantic fields while excluding human labels', async () => {
    const first = validateGraph(graph(), registry).graph
    const original = graph()
    const firstNode = original.nodes[0]
    if (firstNode === undefined) throw new Error('Expected a node')
    const relabeled: AnalysisGraph = {
      ...original,
      label: 'Another title',
      nodes: [{ ...firstNode, label: 'Changed' }, ...original.nodes.slice(1)],
    }
    const second = validateGraph(relabeled, registry).graph
    if (first === undefined || second === undefined) throw new Error('Expected valid graphs')
    expect(await hashAnalysisGraph(first)).toBe(await hashAnalysisGraph(second))
    expect(canonicalGraphJson(first)).not.toContain('Editable graph title')
    expect(canonicalGraphJson(first)).not.toContain('Human-only label')
  })

  it('produces the same graph hash across non-semantic object key order', async () => {
    const original = graph()
    const firstNode = original.nodes[0]
    if (firstNode === undefined) throw new Error('Expected a node')
    const reordered = {
      outputs: original.outputs,
      nodes: [
        {
          parameters: firstNode.parameters,
          inputs: firstNode.inputs,
          operation: firstNode.operation,
          id: firstNode.id,
        },
        ...original.nodes.slice(1),
      ],
      inputs: original.inputs,
      schemaVersion: 1,
    }
    const left = validateGraph(original, registry).graph
    const right = validateGraph(reordered, registry).graph
    if (left === undefined || right === undefined) throw new Error('Expected valid graphs')
    expect(await hashAnalysisGraph(left)).toBe(await hashAnalysisGraph(right))
  })

  it('ignores ID-addressed collection insertion order while preserving variadic order', async () => {
    const original = graph()
    const reordered: AnalysisGraph = {
      ...original,
      inputs: [...original.inputs].reverse(),
      nodes: [...original.nodes]
        .reverse()
        .map((node) => ({ ...node, inputs: [...node.inputs].reverse() })),
      outputs: [{ name: 'copy', source: inputReference('a') }, ...original.outputs].reverse(),
    }
    const withMatchingOutput: AnalysisGraph = {
      ...original,
      outputs: [...original.outputs, { name: 'copy', source: inputReference('a') }],
    }
    const left = validateGraph(withMatchingOutput, registry).graph
    const right = validateGraph(reordered, registry).graph
    if (left === undefined || right === undefined) throw new Error('Expected valid graphs')
    expect(canonicalGraphJson(left)).toBe(canonicalGraphJson(right))
    expect(await hashAnalysisGraph(left)).toBe(await hashAnalysisGraph(right))

    const variadicOrder = {
      ...left,
      nodes: left.nodes.map((node) =>
        node.id === 'first'
          ? {
              ...node,
              inputs: node.inputs.map((input) => ({ ...input, port: 'left' })),
            }
          : node,
      ),
    }
    const reversedVariadicOrder = {
      ...variadicOrder,
      nodes: variadicOrder.nodes.map((node) =>
        node.id === 'first' ? { ...node, inputs: [...node.inputs].reverse() } : node,
      ),
    }
    expect(canonicalGraphJson(variadicOrder)).not.toBe(canonicalGraphJson(reversedVariadicOrder))
  })

  it('keeps the canonical v2 graph hash fixture stable', async () => {
    const fixture = validateGraph(
      {
        schemaVersion: 1,
        inputs: [
          { name: 'a', valueType: { id: 'example.value.number', version: 1 } },
          { name: 'b', valueType: { id: 'example.value.number', version: 1 } },
        ],
        nodes: [
          {
            id: 'first',
            operation: { id: 'example.math.add', version: 1 },
            inputs: [
              { port: 'left', source: { kind: 'input', input: 'a' } },
              { port: 'right', source: { kind: 'input', input: 'b' } },
            ],
            parameters: {},
          },
        ],
        outputs: [{ name: 'answer', source: { kind: 'node', nodeId: 'first', output: 'sum' } }],
      },
      registry,
    ).graph
    if (fixture === undefined) throw new Error('Expected a valid fixture')
    await expect(hashAnalysisGraph(fixture)).resolves.toBe(
      'f6c7706c4ffb94265c40da147269ca47942fb91a40a587dc3f605354b35796a5',
    )
  })

  it('sorts object keys, preserves arrays, and rejects the unsupported JSON domain', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}')
    expect(canonicalJson([2, 1])).toBe('[2,1]')
    expect(() => canonicalJson({ value: Number.NaN })).toThrow('finite')
    expect(() => canonicalJson({ value: 1n })).toThrow('unsupported')
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    expect(() => canonicalJson(cyclic)).toThrow('cycle')
  })

  it('reports cycles, exact-version failures, ports, types, and parameters with stable paths', () => {
    const baseCyclic = graph()
    const cyclic: AnalysisGraph = {
      ...baseCyclic,
      nodes: baseCyclic.nodes.map((node) =>
        node.id === 'first'
          ? {
              ...node,
              inputs: [
                { port: 'left', source: nodeReference('second', 'sum') },
                node.inputs[1] ?? {
                  port: 'right',
                  source: inputReference('b'),
                },
              ],
            }
          : node,
      ),
    }
    expect(validateGraph(cyclic, registry).issues.map((entry) => entry.code)).toContain('cycle')

    const invalidBase = graph()
    const invalidNode = invalidBase.nodes[0]
    if (invalidNode === undefined) throw new Error('Expected a node')
    const invalid: AnalysisGraph = {
      ...invalidBase,
      nodes: [
        {
          ...invalidNode,
          operation: { id: 'example.math.add', version: 3 },
          inputs: [{ port: 'mystery', source: inputReference('missing') }],
          parameters: { scale: Number.POSITIVE_INFINITY },
        },
      ],
    }
    const issues = validateGraph(invalid, registry).issues
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'unknown-operation', path: '/nodes/0/operation' }),
      ]),
    )

    const invalidParametersBase = graph()
    const invalidParametersNode = invalidParametersBase.nodes[0]
    if (invalidParametersNode === undefined) throw new Error('Expected a node')
    const invalidParameters: AnalysisGraph = {
      ...invalidParametersBase,
      nodes: [
        { ...invalidParametersNode, parameters: { scale: Number.POSITIVE_INFINITY } },
        ...invalidParametersBase.nodes.slice(1),
      ],
    }
    expect(validateGraph(invalidParameters, registry).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid-parameter',
          path: '/nodes/0/parameters/scale',
        }),
      ]),
    )

    const wrongTypeBase = graph()
    const wrongType: AnalysisGraph = {
      ...wrongTypeBase,
      inputs: [
        { name: 'a', valueType: { id: 'example.value.string', version: 1 } },
        ...wrongTypeBase.inputs.slice(1),
      ],
    }
    expect(validateGraph(wrongType, registry).issues.map((entry) => entry.code)).toContain(
      'invalid-type',
    )
  })

  it('enforces limits before registry-heavy work', () => {
    let parameterNormalizations = 0
    const counted = createOperationDefinition({
      descriptor: operation(1).descriptor,
      normalizeParameters: () => {
        parameterNormalizations += 1
        return { valid: true, issues: Object.freeze([]), value: Object.freeze({}) }
      },
    })
    const bomb: AnalysisGraph = {
      ...graph(),
      nodes: Array.from({ length: 20 }, (_value, index) => ({
        id: `node-${index}`,
        operation: { id: 'example.math.add', version: 1 },
        inputs: [],
        parameters: { nested: { value: index } },
      })),
    }
    const result = validateGraph(bomb, createOperationRegistry([counted]), {
      maxNodes: 4,
      maxEdges: 4,
      maxGraphJsonBytes: 2_000,
      maxIssues: 5,
    })
    expect(result.valid).toBe(false)
    expect(result.issues.length).toBeLessThanOrEqual(5)
    expect(result.issues.some((entry) => entry.code === 'limit-exceeded')).toBe(true)
    expect(parameterNormalizations).toBe(0)
  })
})
