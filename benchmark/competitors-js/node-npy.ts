import { parse } from 'npyjs'

import {
  correctnessFromView,
  exactArrayBuffer,
  now,
  type NodeCompetitorAdapter,
  type NodeCompetitorContext,
  type NodeCompetitorExecution,
} from './node-common.ts'

const nativeType = (dtype: string): string => {
  const code = dtype.slice(-2)
  if (code === 'u1') return 'uint8'
  if (code === 'i1') return 'int8'
  if (code === 'u2') return 'uint16'
  if (code === 'i2') return 'int16'
  if (code === 'u4') return 'uint32'
  if (code === 'i4') return 'int32'
  if (code === 'f4') return 'float32'
  if (code === 'f8') return 'float64'
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
  const parseStarted = now()
  const array = parse(input)
  const parseMilliseconds = now() - parseStarted
  const details = [
    `dtype=${array.dtype}`,
    `fortranOrder=${String(array.fortranOrder)}`,
    'parseMaterializesData=true',
  ]
  if (context.workload.operation === 'metadata') {
    return {
      stages: {
        moduleImportMilliseconds: 0,
        wasmInitializationMilliseconds: 0,
        inputCopyMilliseconds,
        inputBridgeMilliseconds: 0,
        openMilliseconds: parseMilliseconds,
        hierarchyMilliseconds: 0,
        readMilliseconds: sourceMilliseconds,
        outputTransferMilliseconds: 0,
        firstUsableDataMilliseconds: now() - started,
      },
      sourceInstrumentation: 'complete-buffer',
      correctness: {
        shape: array.shape,
        nativeSampleType: nativeType(array.dtype),
        sampleSha256: null,
        sampleCount: null,
        outputBytes: 0,
        details,
      },
      cleanup: async () => undefined,
    }
  }
  return {
    stages: {
      moduleImportMilliseconds: 0,
      wasmInitializationMilliseconds: 0,
      inputCopyMilliseconds,
      inputBridgeMilliseconds: 0,
      openMilliseconds: parseMilliseconds,
      hierarchyMilliseconds: 0,
      readMilliseconds: sourceMilliseconds + parseMilliseconds,
      outputTransferMilliseconds: 0,
      firstUsableDataMilliseconds: now() - started,
    },
    sourceInstrumentation: 'complete-buffer',
    correctness: correctnessFromView(array.data, array.shape, details),
    cleanup: async () => undefined,
  }
}

export const adapter: NodeCompetitorAdapter = {
  initialize: async () => 0,
  run,
}
