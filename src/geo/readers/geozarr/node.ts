import type { AbortOptions } from '../../../abort.ts'
import { ZarrDirectoryObjectStore } from '../../../zarr/node.ts'
import type { GeoZarrDocument, GeoZarrReaderOptions } from './index.ts'
import { openGeoZarrObjectStore } from './index.ts'

export interface OpenGeoZarrDirectoryOptions extends GeoZarrReaderOptions, AbortOptions {}

/** Node-only local directory entry. The portable GeoZarr reader does not import filesystem APIs. */
export const openGeoZarrDirectory = async (
  path: string,
  options: Readonly<OpenGeoZarrDirectoryOptions> = {},
): Promise<GeoZarrDocument> => {
  const store = await ZarrDirectoryObjectStore.open(path)
  return openGeoZarrObjectStore(store, { ...options, storeKind: 'directory' })
}
