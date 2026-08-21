export type GeoDemoKind = 'cog' | 'geozarr'
export type GeoDisplayMode = 'grayscale' | 'rgb' | 'cir'
export type GeoAnalysisKind = 'normalized-difference' | 'hillshade' | 'statistics' | 'line-profile'

export interface GeoDemoRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface GeoDemoSelection {
  readonly datasetId: string
  readonly levelId: string
  readonly mode: GeoDisplayMode
  readonly band: number
  readonly time: number
  readonly vertical: number
  readonly region: GeoDemoRegion
  /** Explicit source-band order supplied by a documented curated preset. */
  readonly displayBands?: readonly number[]
}

export interface GeoDemoAxis {
  readonly id: string
  readonly kind: string
  readonly length: number
}

export interface GeoDemoLevel {
  readonly id: string
  readonly width: number
  readonly height: number
  readonly affine: readonly number[]
  readonly chunkShape?: readonly number[]
  readonly outerShardShape?: readonly number[]
  readonly compression?: string
}

export interface GeoDemoMetadata {
  readonly kind: GeoDemoKind
  readonly format: string
  readonly datasets: readonly { readonly id: string; readonly title: string }[]
  readonly datasetId: string
  readonly width: number
  readonly height: number
  readonly sampleType: string
  readonly crs: string
  readonly bounds: readonly number[]
  readonly registration: string
  readonly bands: readonly {
    readonly index: number
    readonly name: string
    readonly color: string
  }[]
  readonly axes: readonly GeoDemoAxis[]
  readonly levels: readonly GeoDemoLevel[]
  readonly container?: string
  readonly byteOrder?: string
  readonly tileDimensions?: string
  readonly conventions?: readonly string[]
  readonly zarrVersion?: number
  readonly codecs?: readonly string[]
  readonly objectSize?: number
  readonly sourceUrl: string
}

export interface GeoDemoTelemetry {
  readonly metadataRequests: number
  readonly dataRequests: number
  readonly transferredBytes: number
  readonly uniqueBytes: number
  readonly cacheHits: number
  readonly coalesced: number
  readonly cancelled: number
  readonly sourceBytes?: number
}

export type GeoDemoWorkerRequest =
  | {
      readonly kind: 'open'
      readonly requestId: number
      readonly sourceKind: GeoDemoKind
      readonly url: string
    }
  | {
      readonly kind: 'render'
      readonly requestId: number
      readonly selection: GeoDemoSelection
    }
  | { readonly kind: 'dataset'; readonly requestId: number; readonly datasetId: string }
  | {
      readonly kind: 'analyze'
      readonly requestId: number
      readonly analysis: GeoAnalysisKind
      readonly selection: GeoDemoSelection
    }
  | {
      readonly kind: 'sample'
      readonly requestId: number
      readonly selection: GeoDemoSelection
      readonly x: number
      readonly y: number
    }
  | { readonly kind: 'cancel'; readonly requestId: number }
  | { readonly kind: 'close'; readonly requestId: number }

export type GeoDemoWorkerResponse =
  | {
      readonly kind: 'opened'
      readonly requestId: number
      readonly metadata: GeoDemoMetadata
      readonly telemetry: GeoDemoTelemetry
    }
  | {
      readonly kind: 'frame'
      readonly requestId: number
      readonly width: number
      readonly height: number
      readonly rgba: Uint8ClampedArray
      readonly telemetry: GeoDemoTelemetry
    }
  | {
      readonly kind: 'analysis'
      readonly requestId: number
      readonly analysis: GeoAnalysisKind
      readonly summary: string
      readonly width?: number
      readonly height?: number
      readonly rgba?: Uint8ClampedArray
      readonly telemetry: GeoDemoTelemetry
    }
  | {
      readonly kind: 'sample'
      readonly requestId: number
      readonly world: readonly [number, number]
      readonly values: readonly number[]
    }
  | { readonly kind: 'cancelled'; readonly requestId: number }
  | { readonly kind: 'closed'; readonly requestId: number }
  | { readonly kind: 'error'; readonly requestId: number; readonly message: string }
