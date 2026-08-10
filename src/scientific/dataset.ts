import type { RasterBlock, RasterSampleType } from '../raster.ts'

export interface RasterChannelInfo {
  readonly id?: string
  readonly name?: string
  readonly color?: number
  readonly samplesPerPixel: number
}

export interface PhysicalPixelSize {
  readonly value: number
  readonly unit?: string
}

export interface RasterPlaneRequest {
  readonly z: number
  readonly c?: number | readonly number[]
  readonly t: number
  readonly resolutionLevel?: number
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
}

export interface MultidimensionalRasterDataset {
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ: number
  readonly sizeC: number
  readonly sizeT: number
  readonly sampleType: RasterSampleType
  readonly dimensionOrder: string
  readonly channels: readonly RasterChannelInfo[]
  readonly physicalSizeX?: PhysicalPixelSize
  readonly physicalSizeY?: PhysicalPixelSize

  readPlane(options: Readonly<RasterPlaneRequest>): AsyncIterable<RasterBlock>
}
