import { createAnalysisController, createTileRuntime } from 'purejsimage/analysis'
import { createExtensionHost } from 'purejsimage/extensions'
import { createScientificLibrary } from 'purejsimage/scientific'
import { gsfReader } from 'purejsimage/scientific/readers/gsf'
import { HttpRangeSource } from 'purejsimage/sources/http-range'

const capabilities = Object.freeze({
  analysis: createAnalysisController,
  extensions: createExtensionHost,
  ranges: HttpRangeSource,
  readers: createScientificLibrary({ readers: [gsfReader] }).capabilities,
  runtime: createTileRuntime,
})

globalThis.postMessage({ kind: 'packed-worker-ready', capabilities })
