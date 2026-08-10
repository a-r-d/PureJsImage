import type { PixelBlock } from '../pixel.ts'

export interface WholeSlideLevel {
  readonly index: number
  readonly width: number
  readonly height: number
  readonly downsample: number
  readonly tileWidth?: number
  readonly tileHeight?: number
}

export interface WholeSlideRegionRequest {
  readonly level: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface WholeSlideAssociatedImageRequest {
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
}

export interface WholeSlideAssociatedImage {
  readonly id: string
  readonly label: string
  readonly width: number
  readonly height: number

  read(options?: Readonly<WholeSlideAssociatedImageRequest>): AsyncIterable<PixelBlock>
}

export interface WholeSlideImage {
  readonly width: number
  readonly height: number
  readonly levels: readonly WholeSlideLevel[]
  readonly associatedImages: readonly WholeSlideAssociatedImage[]
  readonly properties: Readonly<Record<string, string>>
  readonly micronsPerPixel?: number
  readonly objectivePower?: number

  readRegion(options: Readonly<WholeSlideRegionRequest>): AsyncIterable<PixelBlock>
}
