import * as nifti from 'nifti-reader-js'

import {
  correctnessFromView,
  exactArrayBuffer,
  now,
  type NodeCompetitorAdapter,
  type NodeCompetitorContext,
  type NodeCompetitorExecution,
} from './node-common.ts'

const typedImage = (datatypeCode: number, image: ArrayBuffer): ArrayBufferView => {
  switch (datatypeCode) {
    case 2:
      return new Uint8Array(image)
    case 4:
      return new Int16Array(image)
    case 8:
      return new Int32Array(image)
    case 16:
      return new Float32Array(image)
    case 64:
      return new Float64Array(image)
    case 256:
      return new Int8Array(image)
    case 512:
      return new Uint16Array(image)
    case 768:
      return new Uint32Array(image)
    default:
      throw new Error(`nifti-reader-js datatype ${datatypeCode} is outside this benchmark adapter`)
  }
}

const run = async (context: NodeCompetitorContext): Promise<NodeCompetitorExecution> => {
  const started = now()
  const sourceStarted = now()
  const bytes = await context.source.readComplete()
  const sourceMilliseconds = now() - sourceStarted
  const copyStarted = now()
  const input = exactArrayBuffer(bytes, context.source)
  const inputCopyMilliseconds = now() - copyStarted
  const openStarted = now()
  const uncompressed = nifti.isCompressed(input) ? await nifti.decompressAsync(input) : input
  const header = nifti.readHeader(uncompressed)
  const openMilliseconds = now() - openStarted
  const dimensionCount = header.dims[0] ?? 0
  const shape = header.dims.slice(1, dimensionCount + 1)
  const details = [
    `datatypeCode=${header.datatypeCode}`,
    `bitsPerVoxel=${header.numBitsPerVoxel}`,
    `scl_slope=${header.scl_slope}`,
    `scl_inter=${header.scl_inter}`,
    `pixDims=${header.pixDims.slice(1, shape.length + 1).join(',')}`,
    `affine=${JSON.stringify(header.affine)}`,
    `inputMaterialized=${String(bytes.byteLength)}`,
  ]
  if (context.fixture.id === 'nifti' && (header.scl_slope !== 2 || header.scl_inter !== 1)) {
    throw new Error('NIfTI scaling fields did not match the generated fixture')
  }
  if (context.workload.operation === 'metadata') {
    return {
      stages: {
        moduleImportMilliseconds: 0,
        wasmInitializationMilliseconds: 0,
        inputCopyMilliseconds,
        inputBridgeMilliseconds: 0,
        openMilliseconds,
        hierarchyMilliseconds: 0,
        readMilliseconds: sourceMilliseconds,
        outputTransferMilliseconds: 0,
        firstUsableDataMilliseconds: now() - started,
      },
      sourceInstrumentation: 'complete-buffer',
      correctness: {
        shape,
        nativeSampleType: null,
        sampleSha256: null,
        sampleCount: null,
        outputBytes: 0,
        details,
      },
      cleanup: async () => undefined,
    }
  }

  const readStarted = now()
  const imageBytes = nifti.readImage(header, uncompressed)
  const image = typedImage(header.datatypeCode, imageBytes)
  const readMilliseconds = now() - readStarted
  if (image.byteLength === 0) throw new Error('nifti-reader-js returned an empty image')
  if (context.workload.operation === 'selected') {
    details.push('selectedSlice=first-plane-after-complete-read')
  }
  return {
    stages: {
      moduleImportMilliseconds: 0,
      wasmInitializationMilliseconds: 0,
      inputCopyMilliseconds,
      inputBridgeMilliseconds: 0,
      openMilliseconds,
      hierarchyMilliseconds: 0,
      readMilliseconds: sourceMilliseconds + readMilliseconds,
      outputTransferMilliseconds: 0,
      firstUsableDataMilliseconds: now() - started,
    },
    sourceInstrumentation: 'complete-buffer',
    correctness: correctnessFromView(image, shape, details),
    cleanup: async () => undefined,
  }
}

export const adapter: NodeCompetitorAdapter = {
  initialize: async () => 0,
  run,
}
