import { File } from 'jsfive'

import {
  correctnessFromNumbers,
  exactArrayBuffer,
  now,
  type NodeCompetitorAdapter,
  type NodeCompetitorContext,
  type NodeCompetitorExecution,
} from './node-common.ts'

const flattenNumbers = (value: unknown, output: number[] = []): number[] => {
  if (typeof value === 'number') {
    output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    for (const child of value) flattenNumbers(child, output)
    return output
  }
  throw new Error('jsfive returned a non-numeric dataset value')
}

const nativeType = (dtype: string): string => {
  if (dtype.includes('i4')) return 'int32'
  if (dtype.includes('u2')) return 'uint16'
  if (dtype.includes('f4')) return 'float32'
  return dtype
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
  const file = new File(input, context.fixture.resources[0]?.name ?? context.fixture.id)
  const openMilliseconds = now() - openStarted
  if (context.workload.operation === 'hierarchy') {
    const hierarchyStarted = now()
    const keys = [...file.keys]
    const hierarchyMilliseconds = now() - hierarchyStarted
    if (keys.length === 0) throw new Error('jsfive returned an empty HDF5 hierarchy')
    return {
      stages: {
        moduleImportMilliseconds: 0,
        wasmInitializationMilliseconds: 0,
        inputCopyMilliseconds,
        inputBridgeMilliseconds: 0,
        openMilliseconds,
        hierarchyMilliseconds,
        readMilliseconds: sourceMilliseconds,
        outputTransferMilliseconds: 0,
        firstUsableDataMilliseconds: now() - started,
      },
      sourceInstrumentation: 'complete-buffer',
      correctness: {
        shape: null,
        nativeSampleType: null,
        sampleSha256: null,
        sampleCount: keys.length,
        outputBytes: 0,
        details: [`keys=${keys.join(',')}`],
      },
      cleanup: async () => undefined,
    }
  }

  const datasetPath = context.workload.datasetPath ?? 'dset_contiguous'
  const readStarted = now()
  const dataset = file.get(datasetPath)
  if (dataset === null) throw new Error(`jsfive dataset not found: ${datasetPath}`)
  const value = dataset.value
  const values = flattenNumbers(value)
  const readMilliseconds = now() - readStarted
  const shape = dataset.shape ?? []
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
    correctness: correctnessFromNumbers(values, nativeType(dataset.dtype), shape, [
      `dataset=${datasetPath}`,
      'fullDatasetValueMaterialized=true',
    ]),
    cleanup: async () => undefined,
  }
}

export const adapter: NodeCompetitorAdapter = {
  initialize: async () => 0,
  run,
}
