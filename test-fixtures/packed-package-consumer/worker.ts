import { createAnalysisController, createTileRuntime } from 'purejsimage/analysis'
import { createExtensionHost } from 'purejsimage/extensions'
import { createScientificLibrary, gsfReader } from 'purejsimage/scientific'
import { HttpRangeSource } from 'purejsimage/sources/http-range'

const capabilities = Object.freeze({
  analysis: createAnalysisController,
  extensions: createExtensionHost,
  ranges: HttpRangeSource,
  readers: createScientificLibrary({ readers: [gsfReader] }).capabilities,
  runtime: createTileRuntime,
})

globalThis.postMessage({ kind: 'packed-worker-ready', capabilities })
