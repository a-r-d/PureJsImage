import { describe, expect, it, vi } from 'vitest'
import { createResizeOperation } from '../src/pipeline.ts'
import {
  builtInOperationDefinitions,
  createOperationDefinition,
  createOperationProvider,
  createOperationRegistry,
  createValueTypeDefinition,
  createValueTypeRegistry,
  normalizeOperationDescriptor,
  OperationRuntime,
  prepareOperationRuntime,
  validateOperationDescriptor,
  validateOperationOwnedOutputs,
  validateValueTypeDescriptor,
} from '../src/operations/index.ts'
import type {
  OperationDescriptor,
  OperationImplementation,
  OperationJsonValue,
  OperationProviderKind,
} from '../src/operations/index.ts'

const descriptor = (version = 1): OperationDescriptor => ({
  id: 'example.analysis.sum',
  version,
  title: 'Sum',
  category: 'analysis',
  tags: ['analysis'],
  inputs: [{ name: 'tile', valueType: { id: 'purejsimage.numeric-tile', version: 1 } }],
  outputs: [{ name: 'result', valueType: { id: 'example.result.sum', version: 1 } }],
  parameters: {
    type: 'object',
    properties: {
      scale: { type: 'number', default: 1, minimum: 0, finiteOnly: true },
      labels: {
        type: 'array',
        items: { type: 'string', maxLength: 8 },
        maxItems: 4,
      },
    },
    closed: true,
  },
  execution: 'reduction',
  reproducibility: { class: 'tolerance-based', absolute: 0.001, relative: 0.001 },
})

describe('operation descriptors', () => {
  it('normalizes defaults and reports all safely discoverable parameter issues', () => {
    const definition = createOperationDefinition({ descriptor: descriptor() })
    expect(definition.normalizeParameters({}).value).toEqual({ scale: 1 })
    const result = definition.normalizeParameters({ scale: Number.POSITIVE_INFINITY, extra: true })
    expect(result.valid).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unknown-field', 'non-finite']),
    )
  })

  it('rejects duplicate ports, bad defaults, unknown schema fields, and unnamespaced types', () => {
    const invalid = {
      ...descriptor(),
      inputs: [
        { name: 'tile', valueType: { id: 'purejsimage.numeric-tile' } },
        { name: 'tile', valueType: { id: 'purejsimage.numeric-tile' } },
      ],
      parameters: {
        type: 'object',
        properties: { count: { type: 'integer', default: 1.5, mystery: true } },
      },
    }
    const result = validateOperationDescriptor(invalid)
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['duplicate', 'invalid-default', 'unknown-field']),
    )
    expect(validateValueTypeDescriptor({ id: 'histogram', version: 1, title: 'Bad' }).valid).toBe(
      false,
    )
  })

  it('bounds hostile descriptor and parameter traversal', () => {
    let nested: unknown = { type: 'number' }
    for (let index = 0; index < 20; index += 1) {
      nested = { type: 'array', items: nested, maxItems: 2 }
    }
    const result = validateOperationDescriptor(
      { ...descriptor(), parameters: nested },
      { maxDepth: 5, maxInspectedValues: 20, maxIssues: 3 },
    )
    expect(result.valid).toBe(false)
    expect(result.issues.length).toBeLessThanOrEqual(3)
    expect(result.issues.some((issue) => issue.code === 'limit-exceeded')).toBe(true)
  })

  it('keeps representative resize and histogram descriptors plain JSON', () => {
    const resize = builtInOperationDefinitions.find(
      (definition) => definition.descriptor.id === 'purejsimage.transform.resize',
    )
    expect(resize).toBeDefined()
    expect(JSON.parse(JSON.stringify(resize?.descriptor))).toEqual(resize?.descriptor)
    const histogram = normalizeOperationDescriptor({
      id: 'example.analysis.histogram',
      version: 1,
      title: 'Histogram',
      category: 'analysis',
      tags: ['analysis', 'reduction'],
      inputs: [{ name: 'image', valueType: { id: 'purejsimage.image', version: 1 } }],
      outputs: [
        {
          name: 'histogram',
          valueType: { id: 'purejsimage.result.histogram', version: 1 },
        },
      ],
      parameters: {
        type: 'object',
        properties: {
          bins: { type: 'integer', minimum: 2, maximum: 65_536, default: 256 },
        },
        closed: true,
      },
      execution: 'reduction',
      reproducibility: { class: 'bit-exact' },
    })
    expect(JSON.parse(JSON.stringify(histogram))).toEqual(histogram)
  })
})

describe('local immutable registries and built-in lowering', () => {
  it('supports versions, deterministic snapshots, and independent registries', () => {
    const first = createOperationDefinition({ descriptor: descriptor(1) })
    const second = createOperationDefinition({ descriptor: descriptor(2) })
    const registry = createOperationRegistry([second, first])
    const independent = createOperationRegistry([first])
    expect(registry.capabilitySnapshot.operations.map((entry) => entry.version)).toEqual([2, 1])
    expect(registry.get('example.analysis.sum', 2)).toBeDefined()
    expect(independent.get('example.analysis.sum', 2)).toBeUndefined()
    expect(JSON.stringify(registry.capabilitySnapshot)).not.toContain('normalizeParameters')
    expect(() => createOperationRegistry([first, first])).toThrow('already registered')
  })

  it('enforces value-type collisions and registry limits atomically', () => {
    const definition = createValueTypeDefinition({
      descriptor: { id: 'example.result.sum', version: 1, title: 'Sum result' },
    })
    const original = createValueTypeRegistry([definition])
    expect(() => createValueTypeRegistry([definition, definition])).toThrow('already registered')
    expect(() => createValueTypeRegistry([definition], { maxDescriptorBytes: 8 })).toThrow(
      'maxDescriptorBytes',
    )
    expect(original.get('example.result.sum', 1)?.descriptor).toEqual(definition.descriptor)
  })

  it('lowers through existing validated constructors without changing the pipeline IR', () => {
    const definition = builtInOperationDefinitions.find(
      (entry) => entry.descriptor.id === 'purejsimage.transform.resize',
    )
    const normalized = definition?.normalizeParameters({ width: 64, kernel: 'nearest' })
    expect(normalized?.valid).toBe(true)
    if (normalized?.value === undefined || definition?.lower === undefined) {
      throw new Error('Resize definition is incomplete')
    }
    expect(definition.lower({ parameters: normalized.value })).toEqual(
      createResizeOperation({ width: 64, kernel: 'nearest' }),
    )
    expect(definition.normalizeParameters({ width: 0 }).valid).toBe(false)
    expect(definition.normalizeParameters({ width: 10, background: '#ffffff' })).toMatchObject({
      valid: false,
      issues: [
        { code: 'invalid-value', path: '', message: expect.stringContaining('require both') },
      ],
    })
    expect(() => definition.lower?.({ parameters: { width: 0 } })).toThrow(
      'Resize width must be a positive safe integer',
    )
  })
})

const implementation = (options: {
  readonly providerId: string
  readonly operation?: OperationDescriptor
  readonly time: number
  readonly retainedBytes?: number
  readonly peakWorkingBytes?: number
  readonly supported?: boolean
  readonly bitExact?: boolean
  readonly execute?: OperationImplementation['execute']
}): OperationImplementation => ({
  descriptor: {
    operationId: (options.operation ?? descriptor()).id,
    operationVersion: (options.operation ?? descriptor()).version,
    implementationVersion: `${options.providerId}-implementation`,
    ...(options.bitExact === true ? { bitExactConformance: true } : {}),
  },
  supports: () => options.supported !== false,
  estimate: () => ({
    setupMilliseconds: options.time,
    transferMilliseconds: 0,
    computeMilliseconds: 0,
    readbackMilliseconds: 0,
    retainedBytes: options.retainedBytes ?? 0,
    peakWorkingBytes: options.peakWorkingBytes ?? options.retainedBytes ?? 0,
    transferBytes: 0,
    outputBytes: options.retainedBytes ?? 0,
    confidence: 1,
  }),
  execute: options.execute ?? (async () => [{ value: options.providerId, release: vi.fn() }]),
})

const provider = (
  id: string,
  kind: OperationProviderKind,
  implementations: readonly OperationImplementation[] | undefined,
) =>
  createOperationProvider({
    descriptor: { id, version: 1, kind, buildFingerprint: `${id}-build` },
    prepare: async () => implementations,
  })

describe('operation providers', () => {
  it('prepares explicitly, ignores unavailable providers, and selects measured whole-job cost', async () => {
    const prepare = vi.fn(async () => [implementation({ providerId: 'reference', time: 2 })])
    const reference = createOperationProvider({
      descriptor: {
        id: 'reference',
        version: 1,
        kind: 'reference',
        buildFingerprint: 'reference-build',
      },
      prepare,
    })
    expect(prepare).not.toHaveBeenCalled()
    const runtime = await prepareOperationRuntime([
      reference,
      provider('webgpu', 'webgpu', [implementation({ providerId: 'webgpu', time: 20 })]),
      provider('missing', 'wasm', undefined),
    ])
    const request = {
      descriptor: descriptor(),
      parameters: {} satisfies OperationJsonValue,
      inputs: [],
      signal: new AbortController().signal,
    }
    expect(runtime.select(request).provider.descriptor.id).toBe('reference')
    expect(runtime.select(request, { mode: 'reference-only' }).provider.descriptor.id).toBe(
      'reference',
    )
    expect(runtime.capabilitySnapshot.providers.map((entry) => entry.id)).toEqual([
      'reference',
      'webgpu',
    ])
  })

  it('rejects a provider that changes identity during preparation', async () => {
    await expect(
      prepareOperationRuntime([
        {
          descriptor: {
            id: 'declared',
            version: 1,
            kind: 'reference',
            buildFingerprint: 'declared-build',
          },
          prepare: async () => ({
            descriptor: {
              id: 'different',
              version: 1,
              kind: 'reference',
              buildFingerprint: 'different-build',
            },
            implementations: [],
          }),
        },
      ]),
    ).rejects.toThrow('changed identity')
  })

  it('falls back on decline, rejects unavailable pins, and breaks cost ties deterministically', async () => {
    const runtime = await prepareOperationRuntime([
      provider('z-provider', 'wasm', [implementation({ providerId: 'z-provider', time: 1 })]),
      provider('declines', 'webgpu', [
        implementation({ providerId: 'declines', time: 0, supported: false }),
      ]),
      provider('a-provider', 'reference', [implementation({ providerId: 'a-provider', time: 1 })]),
    ])
    const request = {
      descriptor: descriptor(),
      parameters: {},
      inputs: [],
      signal: new AbortController().signal,
    }
    expect(runtime.select(request).provider.descriptor.id).toBe('a-provider')
    expect(() =>
      runtime.select(request, { mode: 'pinned', providerId: 'missing', providerVersion: 1 }),
    ).toThrow('Pinned')
  })

  it('uses confidence conservatively and requires a policy for provider-pinned semantics', async () => {
    const runtime = await prepareOperationRuntime([
      provider('uncertain', 'webgpu', [
        {
          ...implementation({ providerId: 'uncertain', time: 1 }),
          estimate: () => ({
            setupMilliseconds: 1,
            transferMilliseconds: 0,
            computeMilliseconds: 0,
            readbackMilliseconds: 0,
            retainedBytes: 0,
            peakWorkingBytes: 0,
            transferBytes: 0,
            outputBytes: 0,
            confidence: 0.1,
          }),
        },
      ]),
      provider('reference', 'reference', [implementation({ providerId: 'reference', time: 2 })]),
    ])
    const request = {
      descriptor: descriptor(),
      parameters: {},
      inputs: [],
      signal: new AbortController().signal,
    }
    expect(runtime.select(request).provider.descriptor.id).toBe('reference')
    expect(() =>
      runtime.select({
        ...request,
        descriptor: { ...descriptor(), reproducibility: { class: 'provider-pinned' } },
      }),
    ).toThrow('requires an exact pinned provider policy')
  })

  it('applies hard automatic memory constraints before comparing elapsed cost', async () => {
    const runtime = await prepareOperationRuntime([
      provider('fast-memory-hog', 'webgpu', [
        implementation({
          providerId: 'fast-memory-hog',
          time: 1,
          retainedBytes: 1_024,
          peakWorkingBytes: 4_096,
        }),
      ]),
      provider('bounded-reference', 'reference', [
        implementation({
          providerId: 'bounded-reference',
          time: 2,
          retainedBytes: 64,
          peakWorkingBytes: 128,
        }),
      ]),
    ])
    const request = {
      descriptor: descriptor(),
      parameters: {},
      inputs: [],
      signal: new AbortController().signal,
    }
    expect(runtime.select(request).provider.descriptor.id).toBe('fast-memory-hog')
    expect(
      runtime.select(request, {
        mode: 'automatic',
        maxRetainedBytes: 128,
        maxPeakWorkingBytes: 256,
      }).provider.descriptor.id,
    ).toBe('bounded-reference')
  })

  it('disposes prepared providers in reverse order exactly once', async () => {
    const order: string[] = []
    const disposable = (id: string) =>
      createOperationProvider({
        descriptor: { id, version: 1, kind: 'reference', buildFingerprint: `${id}-build` },
        prepare: async () => ({
          implementations: [implementation({ providerId: id, time: 1 })],
          dispose: async () => {
            order.push(id)
          },
        }),
      })
    const runtime = await prepareOperationRuntime([disposable('first'), disposable('second')])
    await runtime.dispose()
    await runtime.dispose()
    expect(order).toEqual(['second', 'first'])
    expect(() =>
      runtime.select({
        descriptor: descriptor(),
        parameters: {},
        inputs: [],
        signal: new AbortController().signal,
      }),
    ).toThrow('disposed')
  })

  it('disposes provider resources when prepared capabilities fail validation', async () => {
    let disposals = 0
    const malformed = createOperationProvider({
      descriptor: {
        id: 'malformed',
        version: 1,
        kind: 'reference',
        buildFingerprint: 'malformed-build',
      },
      prepare: async () => ({
        implementations: [
          {
            ...implementation({ providerId: 'malformed', time: 1 }),
            descriptor: {
              operationId: 'example.operation',
              operationVersion: 1,
              implementationVersion: '',
            },
          },
        ],
        dispose: () => {
          disposals += 1
        },
      }),
    })
    await expect(malformed.prepare()).rejects.toThrow('descriptor is invalid')
    expect(disposals).toBe(1)
  })

  it('requires exact conformance and releases provider output when cancellation wins', async () => {
    const controller = new AbortController()
    const release = vi.fn()
    const aborting = implementation({
      providerId: 'reference',
      operation: { ...descriptor(), reproducibility: { class: 'bit-exact' } },
      time: 1,
      bitExact: true,
      execute: async () => {
        controller.abort()
        return [{ value: 1, release }]
      },
    })
    const runtime = new OperationRuntime(
      [await provider('reference', 'reference', [aborting]).prepare()].filter(
        (entry) => entry !== undefined,
      ),
    )
    await expect(
      runtime.execute({
        descriptor: { ...descriptor(), reproducibility: { class: 'bit-exact' } },
        parameters: {},
        inputs: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(release).toHaveBeenCalledOnce()
  })

  it('rejects detectable output aliases and releases every rejected wrapper', async () => {
    const firstRelease = vi.fn()
    const secondRelease = vi.fn()
    const storage = new ArrayBuffer(16)
    const aliasing = implementation({
      providerId: 'reference',
      time: 1,
      execute: async () => [
        { value: new Uint8Array(storage), release: firstRelease },
        { value: new Uint16Array(storage), release: secondRelease },
      ],
    })
    const runtime = new OperationRuntime(
      [await provider('reference', 'reference', [aliasing]).prepare()].filter(
        (entry) => entry !== undefined,
      ),
    )
    await expect(
      runtime.execute({
        descriptor: descriptor(),
        parameters: {},
        inputs: [],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('alias the same storage')
    expect(firstRelease).toHaveBeenCalledOnce()
    expect(secondRelease).toHaveBeenCalledOnce()

    const inputRelease = vi.fn()
    const inputStorage = new Uint8Array(4)
    const inputAliasing = implementation({
      providerId: 'input-reference',
      time: 1,
      execute: async () => [{ value: inputStorage.subarray(0), release: inputRelease }],
    })
    const inputRuntime = new OperationRuntime(
      [await provider('input-reference', 'reference', [inputAliasing]).prepare()].filter(
        (entry) => entry !== undefined,
      ),
    )
    await expect(
      inputRuntime.execute({
        descriptor: descriptor(),
        parameters: {},
        inputs: [inputStorage],
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('input storage')
    expect(inputRelease).toHaveBeenCalledOnce()

    const opaqueIdentity = Object.freeze({ id: 'opaque-resource' })
    expect(() =>
      validateOperationOwnedOutputs(
        [
          {
            value: Object.freeze({ proxy: true }),
            ownershipIdentity: opaqueIdentity,
            release: () => undefined,
          },
        ],
        [],
        [opaqueIdentity],
      ),
    ).toThrow('input storage')
  })
})
