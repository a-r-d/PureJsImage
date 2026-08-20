import type { RasterSampleType } from '../../../src/raster.ts'

export interface OmeZarrLevelMetadata {
  readonly index: number
  readonly path: string
  readonly width: number
  readonly height: number
  readonly downsample: number
  readonly downsampleX: number
  readonly downsampleY: number
  readonly tileWidth: number
  readonly tileHeight: number
  readonly logicalChunkShape: readonly number[]
  readonly storageChunkShape: readonly number[]
  readonly sharded: boolean
  readonly codecs: readonly string[]
  readonly shardIndexLocation?: 'start' | 'end'
}

export interface OmeZarrChannelMetadata {
  readonly index: number
  readonly id: string
  readonly name: string
  readonly color: number
  readonly minimum: number
  readonly maximum: number
}

export interface OmeZarrAxisMetadata {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly length: number
  readonly unit?: string
  readonly coordinateType: 'index' | 'linear' | 'lookup' | 'labels'
  readonly origin?: number
  readonly step?: number
  readonly values?: readonly (number | string)[]
}

export interface OmeZarrDatasetMetadata {
  readonly id: string
  readonly name: string
  readonly kind: 'image' | 'label'
  readonly displayable: boolean
  readonly wellPath?: string
  readonly field?: string
  readonly rowIndex?: number
  readonly columnIndex?: number
  readonly acquisition?: number
  readonly sourceImage?: string
}

export interface OmeZarrLabelColor {
  readonly value: number
  readonly rgba: readonly [number, number, number, number]
}

export interface OmeZarrLabelMetadata {
  readonly datasetId: string
  readonly name: string
  readonly sourceImage?: string
  readonly colors: readonly OmeZarrLabelColor[]
  readonly compatible: boolean
}

export interface OmeZarrPlateMetadata {
  readonly name?: string
  readonly wellCount: number
}

export interface OmeZarrMetadata {
  readonly url: string
  readonly name: string
  readonly datasetId: string
  readonly datasetName: string
  readonly publishedStoreBytes?: number
  readonly width: number
  readonly height: number
  readonly axes: readonly OmeZarrAxisMetadata[]
  readonly channels: readonly OmeZarrChannelMetadata[]
  readonly levels: readonly OmeZarrLevelMetadata[]
  readonly datasets: readonly OmeZarrDatasetMetadata[]
  readonly labels: readonly OmeZarrLabelMetadata[]
  readonly plate?: OmeZarrPlateMetadata
  readonly omeNgffVersion: string
  readonly zarrFormat: number
  readonly sampleType: RasterSampleType
}

export interface OmeZarrChannelConfiguration {
  readonly index: number
  readonly enabled: boolean
  readonly color: number
  readonly minimum: number
  readonly maximum: number
  readonly gamma: number
}

export interface OmeZarrAxisIndexConfiguration {
  readonly axisId: string
  readonly index: number
}

export interface OmeZarrLabelConfiguration {
  readonly datasetId: string
  readonly opacity: number
}

export interface OmeZarrRenderConfiguration {
  readonly generation: number
  readonly datasetId: string
  readonly fixedIndices: readonly OmeZarrAxisIndexConfiguration[]
  readonly channels: readonly OmeZarrChannelConfiguration[]
  readonly label?: OmeZarrLabelConfiguration
}

export interface OmeZarrChannelHistogram {
  readonly channel: number
  readonly minimum: number
  readonly maximum: number
  readonly finiteSamples: number
  readonly bins: readonly number[]
}

export interface OmeZarrStats {
  readonly objectRequests: number
  readonly rangeRequests: number
  readonly bytesFetched: number
  readonly uniqueBytes: number
  readonly metadataBytesFetched: number
  readonly arrayBytesFetched: number
  readonly sourceCacheHits: number
  readonly sourceCacheBytes: number
  readonly coalescedConsumers: number
  readonly abortedConsumers: number
  readonly objectsOpened: number
  readonly viewportTilesDecoded: number
  readonly viewportTilesCancelled: number
  readonly viewportTilesFailed: number
  readonly inFlightTileJobs: number
  readonly decodeMillisecondsTotal: number
  readonly lastDecodeMilliseconds: number
}

export type OmeZarrWorkerRequest =
  | { readonly type: 'open'; readonly url: string; readonly publishedStoreBytes?: number }
  | { readonly type: 'select-dataset'; readonly datasetId: string; readonly generation: number }
  | { readonly type: 'configure'; readonly configuration: OmeZarrRenderConfiguration }
  | {
      readonly type: 'tile'
      readonly requestId: number
      readonly generation: number
      readonly level: number
      readonly column: number
      readonly row: number
    }
  | { readonly type: 'cancel'; readonly requestId: number }
  | { readonly type: 'reset' }
  | { readonly type: 'stats' }

export type OmeZarrWorkerResponse =
  | { readonly type: 'opening'; readonly message: string }
  | {
      readonly type: 'opened'
      readonly metadata: OmeZarrMetadata
      readonly configuration: OmeZarrRenderConfiguration
      readonly stats: OmeZarrStats
    }
  | {
      readonly type: 'configured'
      readonly metadata: OmeZarrMetadata
      readonly configuration: OmeZarrRenderConfiguration
      readonly stats: OmeZarrStats
    }
  | {
      readonly type: 'tile'
      readonly requestId: number
      readonly generation: number
      readonly level: number
      readonly column: number
      readonly row: number
      readonly width: number
      readonly height: number
      readonly decodeMilliseconds: number
      readonly histograms: readonly OmeZarrChannelHistogram[]
      readonly bitmap: ImageBitmap
      readonly stats: OmeZarrStats
    }
  | {
      readonly type: 'tile-cancelled'
      readonly requestId: number
      readonly generation: number
      readonly stats: OmeZarrStats
    }
  | {
      readonly type: 'error'
      readonly requestId?: number
      readonly generation?: number
      readonly message: string
      readonly stats?: OmeZarrStats
    }
  | { readonly type: 'stats'; readonly stats: OmeZarrStats }
