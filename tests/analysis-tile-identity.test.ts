import { describe, expect, it } from 'vitest'
import { AnalysisDatasetOperationContext } from '../src/analysis/builtin-dataset-operations.ts'
import {
  canonicalTileKey,
  createDerivedTileDatasetIdentity,
  createTileDatasetIdentityForScientificDataset,
  createTileRuntime,
  normalizeTileDatasetIdentity,
} from '../src/analysis/runtime.ts'
import type { TileAddress } from '../src/analysis/runtime.ts'
import { identifyScientificDataset } from '../src/scientific/reader.ts'
import type {
  NumericTileSource,
  ScientificDataset,
  ScientificDatasetIdentity,
} from '../src/scientific/index.ts'
import { normalizeScientificDatasetDescriptor } from '../src/scientific/index.ts'

const descriptor = normalizeScientificDatasetDescriptor({
  schemaVersion: 1,
  axes: [
    { id: 'x', kind: 'space', length: 4, coordinates: { type: 'index' } },
    { id: 'y', kind: 'space', length: 4, coordinates: { type: 'index' } },
  ],
  sampleType: 'uint8',
  components: [{ id: 'value', kind: 'scalar' }],
  capabilities: {
    regionReads: true,
    resolutionLevels: false,
    planeReads: { kind: 'any-axis-pair' },
  },
})

const strongIdentity = (digest: string) => ({
  kind: 'scientific-dataset' as const,
  reader: { id: 'test.reader', version: '1.0.0' },
  datasetId: 'primary',
  resources: [
    {
      id: 'primary',
      identity: {
        kind: 'content' as const,
        strength: 'strong' as const,
        stability: 'content-addressed' as const,
        algorithm: 'sha256' as const,
        digest,
        size: 16,
      },
    },
  ],
})

const dataset = (
  reads: number[],
  identity: ScientificDatasetIdentity = strongIdentity('a'.repeat(64)),
): ScientificDataset => {
  const source: NumericTileSource = {
    descriptor,
    directSemantics: {
      sourceSampleType: 'uint8',
      nativeSampleType: 'uint8',
      componentCount: 1,
      layout: 'interleaved',
      supportedTargetSampleTypes: ['uint8'],
    },
    async *readNumericTiles(request) {
      reads.push(1)
      yield Object.freeze({
        x: request.x ?? 0,
        y: request.y ?? 0,
        width: request.width ?? 4,
        height: request.height ?? 4,
        sampleType: 'uint8' as const,
        componentCount: 1,
        layout: 'interleaved' as const,
        rowStrideElements: request.width ?? 4,
        data: new Uint8Array((request.width ?? 4) * (request.height ?? 4)),
        release() {},
      })
    },
  }
  return identifyScientificDataset(
    Object.freeze({ descriptor, numericTileSource: source, async *readPlane() {} }),
    identity,
  )
}

describe('semantic tile dataset identities', () => {
  it('reuses strong reader-backed source tiles across dataset objects and contexts', async () => {
    const firstReads: number[] = []
    const secondReads: number[] = []
    const first = dataset(firstReads)
    const second = dataset(secondReads)
    const runtime = createTileRuntime()
    const firstContext = new AnalysisDatasetOperationContext({ runtime, sessionId: 'first' })
    const secondContext = new AnalysisDatasetOperationContext({ runtime, sessionId: 'second' })
    const request = {
      displayAxes: ['x', 'y'] as const,
      fixedIndices: [],
      x: 0,
      y: 0,
      width: 2,
      height: 2,
    }
    const firstTile = await firstContext.readSourceTile(first, request)
    firstTile.release()
    const secondTile = await secondContext.readSourceTile(second, request)
    secondTile.release()
    expect(firstReads).toHaveLength(1)
    expect(secondReads).toHaveLength(0)
    runtime.clear()
  })

  it('scopes weak and synthetic identities while preserving full semantic key fields', () => {
    const identified = dataset([])
    const strong = createTileDatasetIdentityForScientificDataset(identified, {
      sessionId: 'unused',
    })
    expect(strong.sessionId).toBeUndefined()
    const weakDataset = dataset([], {
      kind: 'scientific-dataset',
      reader: { id: 'test.reader', version: '1.0.0' },
      datasetId: 'primary',
      resources: [
        {
          id: 'header',
          identity: {
            kind: 'local-file',
            strength: 'weak',
            stability: 'metadata',
            nameOrPath: 'fixture.hdr',
            size: 16,
            lastModified: 1,
          },
        },
      ],
    })
    const weakA = createTileDatasetIdentityForScientificDataset(weakDataset, { sessionId: 'a' })
    const weakB = createTileDatasetIdentityForScientificDataset(weakDataset, { sessionId: 'b' })
    expect(weakA).not.toEqual(weakB)
    const synthetic = Object.freeze({ descriptor, async *readPlane() {} })
    expect(
      createTileDatasetIdentityForScientificDataset(synthetic, {
        sessionId: 'scope',
        unidentifiedDatasetId: '1',
      }),
    ).not.toEqual(
      createTileDatasetIdentityForScientificDataset(synthetic, {
        sessionId: 'scope',
        unidentifiedDatasetId: '2',
      }),
    )
    const runtime = createTileRuntime()
    const firstContext = new AnalysisDatasetOperationContext({ runtime, sessionId: 'same-session' })
    const secondContext = new AnalysisDatasetOperationContext({
      runtime,
      sessionId: 'same-session',
    })
    expect(firstContext.identity(synthetic)).not.toEqual(secondContext.identity(synthetic))
    const primary = strongIdentity('a'.repeat(64)).resources[0]
    const companionSource = strongIdentity('b'.repeat(64)).resources[0]
    if (primary === undefined || companionSource === undefined) {
      throw new Error('Expected identity resources')
    }
    const resources = [primary, { ...companionSource, id: 'companion' }]
    const normalized = normalizeTileDatasetIdentity({
      semantic: { ...strongIdentity('a'.repeat(64)), resources: [...resources].reverse() },
      generation: 0,
    })
    expect(
      normalized.semantic.kind === 'scientific-dataset'
        ? normalized.semantic.resources.map((resource) => resource.id)
        : [],
    ).toEqual(['companion', 'primary'])
    expect(() =>
      normalizeTileDatasetIdentity({
        semantic: { ...strongIdentity('a'.repeat(64)), resources: [primary, primary] },
        generation: 0,
      }),
    ).toThrow('repeats resource')
  })

  it('hashes complete normalized derived semantics and canonical parameters', async () => {
    const source = createTileDatasetIdentityForScientificDataset(dataset([]), { sessionId: 'none' })
    const base = {
      source,
      operation: { id: 'example.threshold', version: 1 },
      outputPort: 'dataset',
      provider: {
        id: 'example.provider',
        version: 1,
        kind: 'reference' as const,
        buildFingerprint: 'build-1',
      },
      implementation: {
        operationId: 'example.threshold',
        operationVersion: 1,
        implementationVersion: '1.0.0',
      },
    }
    const first = await createDerivedTileDatasetIdentity({
      ...base,
      normalizedParameters: { threshold: 2, mode: 'greater-than' },
    })
    const reordered = await createDerivedTileDatasetIdentity({
      ...base,
      normalizedParameters: { mode: 'greater-than', threshold: 2 },
    })
    const changed = await createDerivedTileDatasetIdentity({
      ...base,
      normalizedParameters: { mode: 'greater-than', threshold: 3 },
    })
    const changedProvider = await createDerivedTileDatasetIdentity({
      ...base,
      provider: { ...base.provider, buildFingerprint: 'build-2' },
      normalizedParameters: { mode: 'greater-than', threshold: 2 },
    })
    const changedImplementation = await createDerivedTileDatasetIdentity({
      ...base,
      implementation: { ...base.implementation, implementationVersion: '1.0.1' },
      normalizedParameters: { mode: 'greater-than', threshold: 2 },
    })
    const changedSource = await createDerivedTileDatasetIdentity({
      ...base,
      source: createTileDatasetIdentityForScientificDataset(
        dataset([], strongIdentity('b'.repeat(64))),
        { sessionId: 'none' },
      ),
      normalizedParameters: { mode: 'greater-than', threshold: 2 },
    })
    expect(first).toEqual(reordered)
    expect(first).not.toEqual(changed)
    expect(first).not.toEqual(changedProvider)
    expect(first).not.toEqual(changedImplementation)
    expect(first).not.toEqual(changedSource)
    const address = (identity: typeof first): TileAddress => ({
      cacheClass: 'derived',
      namespace: 'test',
      dataset: identity,
      displayAxes: ['x', 'y'],
      fixedIndices: [],
      resolutionLevel: 0,
      x: 0,
      y: 0,
      width: 2,
      height: 2,
    })
    expect(
      canonicalTileKey({
        address: address(first),
        priority: 'visible',
        signal: new AbortController().signal,
      }),
    ).not.toBe(
      canonicalTileKey({
        address: address(changed),
        priority: 'visible',
        signal: new AbortController().signal,
      }),
    )
  })
})
