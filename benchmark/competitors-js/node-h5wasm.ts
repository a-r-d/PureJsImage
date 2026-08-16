import h5wasm, { FS } from 'h5wasm/node'

import {
  correctnessFromNumbers,
  correctnessFromView,
  flattenNumericValues,
  now,
  type NodeCompetitorAdapter,
  type NodeCompetitorContext,
  type NodeCompetitorExecution,
} from './node-common.ts'

const virtualPath = (context: NodeCompetitorContext): string =>
  `/tmp/scientific-${context.fixture.id.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}.h5`

const run = async (context: NodeCompetitorContext): Promise<NodeCompetitorExecution> => {
  if (FS === null) throw new Error('h5wasm virtual filesystem is not initialized')
  const fileSystem = FS
  const started = now()
  const sourceStarted = now()
  const bytes = await context.source.readComplete()
  const sourceMilliseconds = now() - sourceStarted
  const path = virtualPath(context)
  const bridgeStarted = now()
  const bridgeBytes = bytes.slice()
  context.source.recordInputCopy(bridgeBytes.byteLength)
  fileSystem.writeFile(path, bridgeBytes)
  const inputBridgeMilliseconds = now() - bridgeStarted
  const openStarted = now()
  const file = new h5wasm.File(path, 'r')
  const openMilliseconds = now() - openStarted

  const cleanup = async (): Promise<void> => {
    file.close()
    try {
      fileSystem.unlink(path)
    } catch {
      // The close path is still reported even when Emscripten already removed the file.
    }
  }

  if (context.workload.operation === 'hierarchy') {
    const hierarchyStarted = now()
    const keys = file.keys()
    const hierarchyMilliseconds = now() - hierarchyStarted
    if (keys.length === 0) throw new Error('h5wasm returned an empty HDF5 hierarchy')
    return {
      stages: {
        moduleImportMilliseconds: 0,
        wasmInitializationMilliseconds: 0,
        inputCopyMilliseconds: 0,
        inputBridgeMilliseconds,
        openMilliseconds,
        hierarchyMilliseconds,
        readMilliseconds: sourceMilliseconds,
        outputTransferMilliseconds: 0,
        firstUsableDataMilliseconds: now() - started,
      },
      sourceInstrumentation: 'filesystem',
      correctness: {
        shape: null,
        nativeSampleType: null,
        sampleSha256: null,
        sampleCount: keys.length,
        outputBytes: 0,
        details: [`keys=${keys.join(',')}`, 'inputCopiedIntoEmscriptenFS=true'],
      },
      cleanup,
    }
  }

  const datasetPath = context.workload.datasetPath ?? 'dset_contiguous'
  const datasetEntity = file.get(datasetPath)
  if (!(datasetEntity instanceof h5wasm.Dataset)) {
    await cleanup()
    throw new Error(`h5wasm dataset not found: ${datasetPath}`)
  }
  const readStarted = now()
  const selected = context.workload.operation === 'selected'
  const output = selected
    ? datasetEntity.slice([
        [0, 2],
        [0, 3],
      ])
    : datasetEntity.value
  const readMilliseconds = now() - readStarted
  if (output === null) {
    await cleanup()
    throw new Error(`h5wasm returned no data for ${datasetPath}`)
  }
  const shape = selected ? [2, 3] : (datasetEntity.shape ?? [])
  const correctness = ArrayBuffer.isView(output)
    ? correctnessFromView(output, shape, [
        `dataset=${datasetPath}`,
        `selection=${selected ? '0:2,0:3' : 'full'}`,
        'inputCopiedIntoEmscriptenFS=true',
      ])
    : correctnessFromNumbers(flattenNumericValues(output), 'int32', shape, [
        `dataset=${datasetPath}`,
        `selection=${selected ? '0:2,0:3' : 'full'}`,
        'inputCopiedIntoEmscriptenFS=true',
      ])
  return {
    stages: {
      moduleImportMilliseconds: 0,
      wasmInitializationMilliseconds: 0,
      inputCopyMilliseconds: 0,
      inputBridgeMilliseconds,
      openMilliseconds,
      hierarchyMilliseconds: 0,
      readMilliseconds: sourceMilliseconds + readMilliseconds,
      outputTransferMilliseconds: 0,
      firstUsableDataMilliseconds: now() - started,
    },
    sourceInstrumentation: 'filesystem',
    correctness,
    cleanup,
  }
}

export const adapter: NodeCompetitorAdapter = {
  initialize: async () => {
    const started = now()
    await h5wasm.ready
    return now() - started
  },
  run,
}
