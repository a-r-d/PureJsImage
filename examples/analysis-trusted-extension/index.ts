import type { PureJsImageExtension } from '../../src/extensions/index.ts'
import type { OperationJsonObject, OperationJsonValue } from '../../src/operations/index.ts'
import { createOperationDefinition, createOperationProvider } from '../../src/operations/index.ts'
import type {
  DirectNumericTileDataset,
  NumericTile,
  NumericTileReadRequest,
  ScientificDataset,
  ScientificPlaneReadRequest,
} from '../../src/scientific/index.ts'
import {
  normalizeScientificDatasetDescriptor,
  normalizeScientificPlaneReadRequest,
  resolveNumericTileSource,
} from '../../src/scientific/index.ts'
import {
  scientificDatasetCharacteristics,
  scientificDatasetValueTypeId,
} from '../../src/analysis/index.ts'

export const affineScalarOperationId = 'example.analysis-pointwise.affine-scalar'

const isJsonObject = (value: OperationJsonValue | undefined): value is OperationJsonObject =>
  value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value)

const isScientificDataset = (value: unknown): value is ScientificDataset =>
  value !== null &&
  typeof value === 'object' &&
  'descriptor' in value &&
  value.descriptor !== null &&
  typeof value.descriptor === 'object' &&
  'readPlane' in value &&
  typeof value.readPlane === 'function'

const dataset = (value: unknown): ScientificDataset => {
  if (!isScientificDataset(value)) {
    throw new TypeError('Affine scalar input must be a ScientificDataset')
  }
  return value
}

const parameters = (
  value: OperationJsonValue,
): { readonly scale: number; readonly offset: number } => {
  if (!isJsonObject(value)) throw new TypeError('Affine parameters must be an object')
  const scale = value.scale
  const offset = value.offset
  if (typeof scale !== 'number' || !Number.isFinite(scale))
    throw new TypeError('Affine scale must be finite')
  if (typeof offset !== 'number' || !Number.isFinite(offset))
    throw new TypeError('Affine offset must be finite')
  return Object.freeze({ scale, offset })
}

export const affineScalarOperation = createOperationDefinition({
  descriptor: {
    id: affineScalarOperationId,
    version: 1,
    title: 'Example affine scalar transform',
    category: 'example-analysis',
    tags: ['example', 'scientific', 'pointwise'],
    inputs: [{ name: 'dataset', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
    outputs: [{ name: 'dataset', valueType: { id: scientificDatasetValueTypeId, version: 1 } }],
    parameters: {
      type: 'object',
      properties: {
        scale: { type: 'number', finiteOnly: true, default: 1 },
        offset: { type: 'number', finiteOnly: true, default: 0 },
      },
      closed: true,
    },
    execution: 'tile-local',
    reproducibility: { class: 'tolerance-based', absolute: 1e-6, relative: 1e-6 },
  },
  inferOutputShapes(request) {
    const input = request.inputs[0]
    if (!isJsonObject(input)) return Object.freeze({ valid: false, issues: Object.freeze([]) })
    return Object.freeze({ valid: true, issues: Object.freeze([]), value: Object.freeze([input]) })
  },
})

const affineDataset = (
  source: ScientificDataset,
  scale: number,
  offset: number,
): DirectNumericTileDataset => {
  if (source.descriptor.sampleType !== 'float32' || source.descriptor.components.length !== 1) {
    throw new TypeError('Example affine provider supports one-component float32 datasets')
  }
  const descriptor = normalizeScientificDatasetDescriptor({
    ...source.descriptor,
    metadata: {
      ...(source.descriptor.metadata ?? {}),
      exampleOperation: affineScalarOperationId,
      affineScale: scale,
      affineOffset: offset,
    },
  })
  const numericTileSource = Object.freeze({
    descriptor,
    directSemantics: Object.freeze({
      sourceSampleType: 'float32' as const,
      nativeSampleType: 'float32' as const,
      componentCount: 1,
      layout: 'interleaved' as const,
      supportedTargetSampleTypes: ['float32'] as const,
    }),
    async *readNumericTiles(input: Readonly<NumericTileReadRequest>): AsyncGenerator<NumericTile> {
      const request = normalizeScientificPlaneReadRequest(descriptor, input)
      for await (const tile of resolveNumericTileSource(source).readNumericTiles({
        ...request,
        targetSampleType: 'float32',
      })) {
        try {
          const data = new Float32Array(tile.width * tile.height)
          for (let y = 0; y < tile.height; y += 1) {
            request.signal?.throwIfAborted()
            for (let x = 0; x < tile.width; x += 1) {
              const raw = tile.data[y * tile.rowStrideElements + x]
              if (typeof raw !== 'number') throw new TypeError('Affine input sample is not numeric')
              data[y * tile.width + x] = raw * scale + offset
            }
          }
          yield Object.freeze({
            x: tile.x,
            y: tile.y,
            width: tile.width,
            height: tile.height,
            sampleType: 'float32' as const,
            componentCount: 1,
            layout: 'interleaved' as const,
            rowStrideElements: tile.width,
            data,
            release() {},
          })
        } finally {
          tile.release()
        }
      }
    },
  })
  return Object.freeze({
    descriptor,
    numericTileSource,
    async *readPlane(input: Readonly<ScientificPlaneReadRequest>) {
      for await (const tile of numericTileSource.readNumericTiles(input)) {
        if (!(tile.data instanceof Float32Array))
          throw new TypeError('Affine output tile must be float32')
        const data = new Uint8Array(tile.data.length * 4)
        const view = new DataView(data.buffer)
        for (let index = 0; index < tile.data.length; index += 1) {
          view.setFloat32(index * 4, tile.data[index] ?? Number.NaN, false)
        }
        yield Object.freeze({
          x: tile.x,
          y: tile.y,
          width: tile.width,
          height: tile.height,
          stride: tile.width * 4,
          format: Object.freeze({ sampleType: 'float32' as const, channels: 1, planar: false }),
          data,
        })
      }
    },
  })
}

export const affineScalarProvider = createOperationProvider({
  descriptor: {
    id: 'example.analysis-pointwise.affine-reference',
    version: 1,
    kind: 'reference',
    buildFingerprint: 'example-affine-typescript-v1',
  },
  prepare: async () => [
    {
      descriptor: {
        operationId: affineScalarOperationId,
        operationVersion: 1,
        implementationVersion: '1.0.0',
      },
      supportsPlan(request) {
        try {
          parameters(request.parameters)
          return request.inputCharacteristics.length === 1
        } catch {
          return false
        }
      },
      estimatePlan: () => ({
        setupMilliseconds: 0,
        transferMilliseconds: 0,
        computeMilliseconds: 0,
        readbackMilliseconds: 0,
        retainedBytes: 0,
        peakWorkingBytes: 0,
        transferBytes: 0,
        outputBytes: 0,
        confidence: 0,
      }),
      validateExecution(request) {
        const source = dataset(request.inputs[0])
        if (
          source.descriptor.sampleType !== 'float32' ||
          source.descriptor.components.length !== 1
        ) {
          throw new TypeError('Affine scalar requires a single-component float32 dataset')
        }
      },
      async execute(request) {
        request.signal.throwIfAborted()
        const source = dataset(request.inputs[0])
        const normalized = parameters(request.parameters)
        const output = affineDataset(source, normalized.scale, normalized.offset)
        return Object.freeze([Object.freeze({ value: output, release() {} })])
      },
    },
  ],
})

/** Trusted in-process example only: constructing this value does not register it anywhere. */
export const trustedPointwiseExtension: PureJsImageExtension = Object.freeze({
  descriptor: Object.freeze({
    id: 'example.analysis-pointwise',
    version: 1,
    apiVersion: 1,
    title: 'Example trusted pointwise analysis extension',
  }),
  operations: Object.freeze([affineScalarOperation]),
  providers: Object.freeze([affineScalarProvider]),
})

export const describeAffineInput = (source: ScientificDataset): OperationJsonObject =>
  scientificDatasetCharacteristics(source)
