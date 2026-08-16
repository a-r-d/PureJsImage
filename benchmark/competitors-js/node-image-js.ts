import { decode } from 'image-js'

import {
  correctnessFromView,
  now,
  type NodeCompetitorAdapter,
  type NodeCompetitorContext,
  type NodeCompetitorExecution,
} from './node-common.ts'

const run = async (context: NodeCompetitorContext): Promise<NodeCompetitorExecution> => {
  const started = now()
  const inputStarted = now()
  const bytes = await context.source.readComplete()
  const inputCopyMilliseconds = now() - inputStarted
  const openStarted = now()
  const image = decode(bytes)
  const openMilliseconds = now() - openStarted
  const raw = image.getRawImage()
  return {
    stages: {
      moduleImportMilliseconds: 0,
      wasmInitializationMilliseconds: 0,
      inputCopyMilliseconds,
      inputBridgeMilliseconds: 0,
      openMilliseconds,
      hierarchyMilliseconds: 0,
      readMilliseconds: now() - openStarted,
      outputTransferMilliseconds: 0,
      firstUsableDataMilliseconds: now() - started,
    },
    sourceInstrumentation: 'complete-buffer',
    correctness: correctnessFromView(
      raw.data,
      [raw.width, raw.height, raw.channels],
      [`bitDepth=${raw.bitDepth}`, `channels=${raw.channels}`],
    ),
    cleanup: async () => undefined,
  }
}

export const adapter: NodeCompetitorAdapter = {
  initialize: async () => 0,
  run,
}
