import type { TiffEncodedCacheSource } from '../../codecs/tiff.ts'
import type { GeoTiffProfile } from '../../geotiff.ts'
import type { ImageSource } from '../../source.ts'
import type { TiffDirectory, TiffDocument } from '../../tiff/types.ts'
import type { ScientificDocument } from '../reader.ts'

export interface TiffScientificLevelBridge {
  readonly level: number
  readonly directory: TiffDirectory
  readonly georeferencing: 'explicit' | 'derived' | 'none'
  readonly geoTiffProfile?: GeoTiffProfile
  readonly warning?: string
}

export interface TiffScientificPageBridge {
  readonly page: number
  readonly levels: readonly TiffScientificLevelBridge[]
}

export interface TiffScientificDatasetBridge {
  readonly datasetId: string
  readonly pages: readonly TiffScientificPageBridge[]
}

export interface TiffScientificDocumentBridge {
  readonly document: TiffDocument
  readonly source: ImageSource
  readonly encodedSource: TiffEncodedCacheSource
  readonly datasets: readonly TiffScientificDatasetBridge[]
}

const bridges = new WeakMap<ScientificDocument, TiffScientificDocumentBridge>()

export const setTiffScientificDocumentBridge = (
  document: ScientificDocument,
  bridge: TiffScientificDocumentBridge,
): void => {
  bridges.set(document, bridge)
}

export const getTiffScientificDocumentBridge = (
  document: ScientificDocument,
): TiffScientificDocumentBridge | undefined => bridges.get(document)
