import UTIF from 'utif2'

import {
  correctnessFromView,
  exactArrayBuffer,
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
  const copyStarted = now()
  const input = exactArrayBuffer(bytes, context.source)
  const inputCopyAfterReadMilliseconds = now() - copyStarted
  const openStarted = now()
  const pages = UTIF.decode(input)
  const page = pages[0]
  if (page === undefined) throw new Error('UTIF2 returned no decoded first page')
  UTIF.decodeImage(input, page)
  const openMilliseconds = now() - openStarted
  if (page.data === undefined) throw new Error('UTIF2 returned no native page data')
  const width = page.width ?? 0
  const height = page.height ?? 0
  return {
    stages: {
      moduleImportMilliseconds: 0,
      wasmInitializationMilliseconds: 0,
      inputCopyMilliseconds: inputCopyMilliseconds + inputCopyAfterReadMilliseconds,
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
      [width, height],
      ['native UTIF2 decodeImage output', 'RGBA conversion excluded'],
    ),
    cleanup: async () => undefined,
  }
}

export const adapter: NodeCompetitorAdapter = {
  initialize: async () => 0,
  run,
}
