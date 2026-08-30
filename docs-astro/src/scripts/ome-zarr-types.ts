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
  readonly active?: boolean
  readonly coefficient?: number
  readonly family?: string
  readonly inverted?: boolean
}

export interface OmeZarrDisplayDefaultsMetadata {
  readonly defaultT?: number
  readonly defaultZ?: number
  readonly model?: 'color' | 'greyscale'
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
  readonly displayDefaults?: OmeZarrDisplayDefaultsMetadata
}

export interface OmeZarrChannelConfiguration {
  readonly index: number
  readonly enabled: boolean
  readonly color: number
  readonly minimum: number
  readonly maximum: number
  readonly gamma: number
  readonly coefficient: number
  readonly inverted: boolean
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
  | {
      readonly type: 'open'
      readonly epoch: number
      readonly url: string
      readonly publishedStoreBytes?: number
    }
  | {
      readonly type: 'select-dataset'
      readonly epoch: number
      readonly datasetId: string
      readonly generation: number
    }
  | {
      readonly type: 'configure'
      readonly epoch: number
      readonly configuration: OmeZarrRenderConfiguration
    }
  | {
      readonly type: 'tile'
      readonly epoch: number
      readonly requestId: number
      readonly generation: number
      readonly level: number
      readonly column: number
      readonly row: number
    }
  | { readonly type: 'cancel'; readonly epoch: number; readonly requestId: number }
  | { readonly type: 'reset'; readonly epoch: number }
  | { readonly type: 'stats'; readonly epoch: number }

export type OmeZarrWorkerResponse =
  | { readonly type: 'opening'; readonly epoch: number; readonly message: string }
  | {
      readonly type: 'opened'
      readonly epoch: number
      readonly metadata: OmeZarrMetadata
      readonly configuration: OmeZarrRenderConfiguration
      readonly stats: OmeZarrStats
    }
  | {
      readonly type: 'configured'
      readonly epoch: number
      readonly metadata: OmeZarrMetadata
      readonly configuration: OmeZarrRenderConfiguration
      readonly stats: OmeZarrStats
    }
  | {
      readonly type: 'tile'
      readonly epoch: number
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
      readonly epoch: number
      readonly requestId: number
      readonly generation: number
      readonly stats: OmeZarrStats
    }
  | {
      readonly type: 'error'
      readonly epoch: number
      readonly requestId?: number
      readonly generation?: number
      readonly message: string
      readonly stats?: OmeZarrStats
    }
  | { readonly type: 'stats'; readonly epoch: number; readonly stats: OmeZarrStats }
  | { readonly type: 'reset'; readonly epoch: number; readonly stats: OmeZarrStats }

type UnknownRecord = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const exactKeys = (
  value: UnknownRecord,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean => {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every((key) => keys.includes(key)) && keys.every((key) => allowed.has(key))
}

const integer = (value: unknown, minimum = 0): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isAxisIndex = (value: unknown): value is OmeZarrAxisIndexConfiguration =>
  isRecord(value) &&
  exactKeys(value, ['axisId', 'index']) &&
  typeof value.axisId === 'string' &&
  value.axisId.length > 0 &&
  integer(value.index)

const isChannel = (value: unknown): value is OmeZarrChannelConfiguration =>
  isRecord(value) &&
  exactKeys(value, [
    'index',
    'enabled',
    'color',
    'minimum',
    'maximum',
    'gamma',
    'coefficient',
    'inverted',
  ]) &&
  integer(value.index) &&
  typeof value.enabled === 'boolean' &&
  integer(value.color) &&
  finite(value.minimum) &&
  finite(value.maximum) &&
  finite(value.gamma) &&
  finite(value.coefficient) &&
  typeof value.inverted === 'boolean'

const isLabel = (value: unknown): value is OmeZarrLabelConfiguration =>
  isRecord(value) &&
  exactKeys(value, ['datasetId', 'opacity']) &&
  typeof value.datasetId === 'string' &&
  value.datasetId.length > 0 &&
  finite(value.opacity)

const isConfiguration = (value: unknown): value is OmeZarrRenderConfiguration =>
  isRecord(value) &&
  exactKeys(value, ['generation', 'datasetId', 'fixedIndices', 'channels'], ['label']) &&
  integer(value.generation, 1) &&
  typeof value.datasetId === 'string' &&
  value.datasetId.length > 0 &&
  Array.isArray(value.fixedIndices) &&
  value.fixedIndices.every(isAxisIndex) &&
  Array.isArray(value.channels) &&
  value.channels.every(isChannel) &&
  (value.label === undefined || isLabel(value.label))

export const isOmeZarrWorkerRequest = (value: unknown): value is OmeZarrWorkerRequest => {
  if (!isRecord(value) || !integer(value.epoch, 1) || typeof value.type !== 'string') return false
  if (value.type === 'open') {
    return (
      exactKeys(value, ['type', 'epoch', 'url'], ['publishedStoreBytes']) &&
      typeof value.url === 'string' &&
      value.url.trim().length > 0 &&
      (value.publishedStoreBytes === undefined || integer(value.publishedStoreBytes, 1))
    )
  }
  if (value.type === 'select-dataset') {
    return (
      exactKeys(value, ['type', 'epoch', 'datasetId', 'generation']) &&
      typeof value.datasetId === 'string' &&
      value.datasetId.length > 0 &&
      integer(value.generation, 1)
    )
  }
  if (value.type === 'configure') {
    return (
      exactKeys(value, ['type', 'epoch', 'configuration']) && isConfiguration(value.configuration)
    )
  }
  if (value.type === 'tile') {
    return (
      exactKeys(value, ['type', 'epoch', 'requestId', 'generation', 'level', 'column', 'row']) &&
      integer(value.requestId, 1) &&
      integer(value.generation, 1) &&
      integer(value.level) &&
      integer(value.column) &&
      integer(value.row)
    )
  }
  if (value.type === 'cancel') {
    return exactKeys(value, ['type', 'epoch', 'requestId']) && integer(value.requestId, 1)
  }
  return (value.type === 'reset' || value.type === 'stats') && exactKeys(value, ['type', 'epoch'])
}
