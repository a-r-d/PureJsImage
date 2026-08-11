export interface WsiLevelMetadata {
  readonly index: number
  readonly width: number
  readonly height: number
  readonly downsample: number
  readonly tileWidth: number
  readonly tileHeight: number
}

export interface WsiAssociatedImageMetadata {
  readonly id: string
  readonly label: string
  readonly width: number
  readonly height: number
}

export interface WsiMetadata {
  readonly url: string
  readonly name: string
  readonly size: number
  readonly width: number
  readonly height: number
  readonly micronsPerPixel?: number
  readonly objectivePower?: number
  readonly levels: readonly WsiLevelMetadata[]
  readonly associatedImages: readonly WsiAssociatedImageMetadata[]
  readonly properties: Readonly<Record<string, string>>
}

export interface WsiStats {
  readonly requests: number
  readonly bytesFetched: number
  readonly sourceCacheBytes: number
  readonly tilesDecoded: number
  readonly tilesCancelled: number
}

export type WsiWorkerRequest =
  | { readonly type: 'open'; readonly url: string }
  | {
      readonly type: 'tile'
      readonly requestId: number
      readonly level: number
      readonly column: number
      readonly row: number
    }
  | { readonly type: 'cancel'; readonly requestId: number }
  | { readonly type: 'reset' }
  | { readonly type: 'stats' }

export type WsiWorkerResponse =
  | { readonly type: 'opening'; readonly message: string }
  | { readonly type: 'opened'; readonly metadata: WsiMetadata; readonly stats: WsiStats }
  | {
      readonly type: 'tile'
      readonly requestId: number
      readonly level: number
      readonly column: number
      readonly row: number
      readonly width: number
      readonly height: number
      readonly decodeMilliseconds: number
      readonly bitmap: ImageBitmap
      readonly stats: WsiStats
    }
  | {
      readonly type: 'tile-cancelled'
      readonly requestId: number
      readonly stats: WsiStats
    }
  | {
      readonly type: 'error'
      readonly requestId?: number
      readonly message: string
      readonly stats?: WsiStats
    }
  | { readonly type: 'stats'; readonly stats: WsiStats }
