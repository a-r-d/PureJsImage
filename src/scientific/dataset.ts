import type { RasterBlock, RasterSampleType } from '../raster.ts'

/** Metadata for one logical channel of a native numeric raster. */
export interface RasterChannelInfo {
  readonly id?: string
  readonly name?: string
  readonly color?: number
  readonly samplesPerPixel: number
  readonly unit?: string
  readonly spectral?: {
    readonly center: number
    readonly unit?: string
    readonly fwhm?: number
  }
}

export interface PhysicalPixelSize {
  readonly value: number
  readonly unit?: string
}

/**
 * Selects one Z/C/T plane and an optional spatial region. Coordinates are
 * zero-based. Readers may return the plane as several bounded `RasterBlock`s.
 */
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

/**
 * A lazy native-sample raster with explicit X/Y/Z/channel/time dimensions.
 * `readPlane()` preserves the declared sample type and metadata unless a format
 * requires a lossless quantitative conversion, such as FITS BSCALE/BZERO.
 */
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
  readonly physicalSizeZ?: PhysicalPixelSize
  readonly originX?: PhysicalPixelSize
  readonly originY?: PhysicalPixelSize
  readonly originZ?: PhysicalPixelSize
  readonly noDataValue?: number
  readonly metadata?: Readonly<Record<string, string>>

  readPlane(options: Readonly<RasterPlaneRequest>): AsyncIterable<RasterBlock>
}
