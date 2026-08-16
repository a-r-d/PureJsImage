import { decode } from 'tiff'

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
  const pages = decode(bytes)
  const openMilliseconds = now() - openStarted
  const page = pages[0]
  if (page === undefined || page.data === undefined)
    throw new Error('tiff returned no decoded first page')
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
      page.data,
      [page.width, page.height, page.components],
      [`bitsPerSample=${page.bitsPerSample}`, `components=${page.components}`],
    ),
    cleanup: async () => undefined,
  }
}

export const adapter: NodeCompetitorAdapter = {
  initialize: async () => 0,
  run,
}
