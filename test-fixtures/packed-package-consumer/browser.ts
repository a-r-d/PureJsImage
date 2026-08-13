import { createImageLibrary } from 'purejsimage/browser'
import { createAnalysisController, createTileRuntime } from 'purejsimage/analysis'
import { createExtensionHost } from 'purejsimage/extensions'
import { createOperationRegistry, createValueTypeRegistry } from 'purejsimage/operations'
import { createScientificFileContext } from 'purejsimage/scientific/browser'
import { HttpRangeSource } from 'purejsimage/sources/http-range'

export const browserSurface = {
  createImageLibrary,
  createAnalysisController,
  createExtensionHost,
  createOperationRegistry,
  createScientificFileContext,
  createTileRuntime,
  createValueTypeRegistry,
  HttpRangeSource,
}
