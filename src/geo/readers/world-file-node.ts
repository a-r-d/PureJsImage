import { createScientificPathContext } from '../../scientific/node.ts'
import type { GeoRasterDocument } from './index.ts'
import type { WorldFileReaderOptions } from './world-file.ts'
import { createWorldFileReader } from './world-file.ts'

export interface OpenWorldFilePathOptions extends WorldFileReaderOptions {
  readonly signal?: AbortSignal
}

/** Node-only local image opener using the bounded sibling resolver for its directory. */
export const openWorldFilePath = async (
  path: string,
  options: Readonly<OpenWorldFilePathOptions> = {},
): Promise<GeoRasterDocument> => {
  const context = await createScientificPathContext(path, {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  return createWorldFileReader(options).open(context)
}
