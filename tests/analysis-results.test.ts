import { describe, expect, it } from 'vitest'
import {
  accountAnalysisResultMemory,
  analysisResultValueTypeDefinitions,
  createAnalysisResultValueTypeRegistry,
  histogramResultValueTypeId,
  resultCollectionValueTypeId,
  scalarResultValueTypeId,
  summarizeResult,
  tableResultValueTypeId,
  validateHistogramResult,
  validateResultCollection,
  validateScalarResult,
  validateTableResult,
} from '../src/analysis/results.ts'
import { createValueTypeDefinition, createValueTypeRegistry } from '../src/operations/index.ts'

describe('provider-neutral analysis results', () => {
  it('validates finite scalar semantics and an explicit NaN policy', () => {
    expect(
      validateScalarResult({
        kind: 'scalar',
        valueType: scalarResultValueTypeId,
        value: 12.5,
        uncertainty: 0.25,
        unit: 'K',
        nanPolicy: 'forbid',
      }),
    ).toMatchObject({ value: 12.5, uncertainty: 0.25, unit: 'K' })
    expect(() =>
      validateScalarResult({
        kind: 'scalar',
        valueType: scalarResultValueTypeId,
        value: Number.NaN,
        nanPolicy: 'forbid',
      }),
    ).toThrow('finite/NaN policy')
    const allowed = validateScalarResult({
      kind: 'scalar',
      valueType: scalarResultValueTypeId,
      value: Number.NaN,
      nanPolicy: 'allow',
    })
    expect(summarizeResult(allowed).preview).toBe('NaN')
    expect(JSON.parse(JSON.stringify(summarizeResult(allowed)))).toBeDefined()
  })

  it('requires explicit monotonic histogram edges and exact count lengths', () => {
    const result = validateHistogramResult({
      kind: 'histogram',
      valueType: histogramResultValueTypeId,
      binEdges: new Float64Array([0, 0.5, 1]),
      counts: new Uint32Array([2, 3]),
      underflow: 1,
      overflow: 4,
      unit: 'm',
    })
    expect(result.binEdges).toEqual(new Float64Array([0, 0.5, 1]))
    expect(() =>
      validateHistogramResult({
        ...result,
        binEdges: new Float64Array([0, 0, 1]),
      }),
    ).toThrow('strictly increasing')
    expect(() =>
      validateHistogramResult({
        ...result,
        counts: new Uint32Array([2]),
      }),
    ).toThrow('length')
  })

  it('supports bit-packed booleans and validity plus bounded UTF-8 and categories', () => {
    const encoded = new TextEncoder().encode('redblue')
    const result = validateTableResult({
      kind: 'table',
      valueType: tableResultValueTypeId,
      rowCount: 3,
      columns: [
        {
          kind: 'numeric',
          name: 'temperature',
          values: new Float32Array([1, Number.NaN, 3]),
          nanPolicy: 'forbid',
          validity: { bits: Uint8Array.of(0b0000_0101) },
          unit: 'K',
        },
        { kind: 'boolean', name: 'selected', values: Uint8Array.of(0b0000_0101) },
        {
          kind: 'string',
          name: 'label',
          offsets: new Uint32Array([0, 3, 3, 7]),
          data: encoded,
        },
        {
          kind: 'category',
          name: 'class',
          codes: Uint8Array.of(0, 1, 0),
          categories: ['land', 'water'],
        },
      ],
    })
    const summary = summarizeResult(result, { maxPreviewValues: 2 })
    expect(summary).toMatchObject({
      dimensions: { rows: 3, columns: 4 },
      preview: {
        temperature: [1, null],
        selected: [true, false],
        label: ['red', ''],
        class: ['land', 'water'],
      },
    })
    expect(JSON.stringify(summary)).not.toContain('redblue')
    expect(() =>
      validateTableResult({
        kind: 'table',
        valueType: tableResultValueTypeId,
        rowCount: 2,
        columns: [
          { kind: 'numeric', name: 'bad', values: new Float64Array(1), nanPolicy: 'forbid' },
        ],
      }),
    ).toThrow('rowCount')
    expect(() =>
      validateTableResult({
        kind: 'table',
        valueType: tableResultValueTypeId,
        rowCount: 1,
        columns: [
          {
            kind: 'string',
            name: 'badUtf8',
            offsets: new Uint32Array([0, 2]),
            data: Uint8Array.of(0xc0, 0xaf),
          },
        ],
      }),
    ).toThrow('invalid UTF-8')
  })

  it('validates a million-row table as columns and accounts retained backing buffers once', () => {
    const backing = new ArrayBuffer(8_000_016)
    const values = new Float64Array(backing, 8, 1_000_000)
    const result = validateTableResult({
      kind: 'table',
      valueType: tableResultValueTypeId,
      rowCount: values.length,
      columns: [
        { kind: 'numeric', name: 'x', values, nanPolicy: 'forbid' },
        { kind: 'numeric', name: 'xAgain', values, nanPolicy: 'forbid' },
      ],
    })
    expect(result.rowCount).toBe(1_000_000)
    expect('rows' in result).toBe(false)
    expect(accountAnalysisResultMemory(result).payloadBytes).toBe(backing.byteLength)
    expect(JSON.stringify(summarizeResult(result, { maxPreviewValues: 3 })).length).toBeLessThan(
      2_000,
    )
    expect(() => validateTableResult(result, { maxRows: 999_999 })).toThrow('maxRows')
    expect(() => validateTableResult(result, { maxRetainedBytes: 1_000_000 })).toThrow(
      'maxRetainedBytes',
    )
  })

  it('bounds metadata, retained bytes, and nested collections', () => {
    const scalar = validateScalarResult({
      kind: 'scalar',
      valueType: scalarResultValueTypeId,
      value: 1,
      nanPolicy: 'forbid',
    })
    const collection = validateResultCollection({
      kind: 'collection',
      valueType: resultCollectionValueTypeId,
      results: [{ name: 'one', result: scalar }],
      metadata: { purpose: 'preview' },
    })
    expect(summarizeResult(collection)).toMatchObject({ dimensions: { results: 1 } })
    expect(() => validateResultCollection(collection, { maxRetainedBytes: 1 })).toThrow(
      'maxRetainedBytes',
    )
    expect(() =>
      validateScalarResult({ ...scalar, metadata: { text: 'too long' } }, { maxMetadataBytes: 4 }),
    ).toThrow('maxMetadataBytes')
  })

  it('registers result value types explicitly without payloads or built-in replacement', () => {
    expect(createAnalysisResultValueTypeRegistry().definitions()).toHaveLength(5)
    const manifest = JSON.stringify(createAnalysisResultValueTypeRegistry().capabilitySnapshot)
    expect(manifest).toContain(histogramResultValueTypeId)
    expect(manifest).not.toContain('base64')
    expect(manifest).not.toContain('"payload":')
    const custom = createValueTypeDefinition({
      descriptor: { id: 'example.result.mask-area', version: 1, title: 'Mask area result' },
    })
    expect(
      createValueTypeRegistry([...analysisResultValueTypeDefinitions, custom]).get(
        custom.descriptor.id,
        1,
      ),
    ).toBeDefined()
    const replacement = createValueTypeDefinition({
      descriptor: { id: scalarResultValueTypeId, version: 2, title: 'Replacement scalar' },
    })
    expect(() =>
      createValueTypeRegistry([...analysisResultValueTypeDefinitions, replacement]),
    ).toThrow('cannot replace a built-in')
  })
})
