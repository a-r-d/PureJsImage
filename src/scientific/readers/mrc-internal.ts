import type { RasterBlock } from '../../raster.ts'

export const remapMrcYzRasterBlock = (block: RasterBlock, z: number): RasterBlock =>
  Object.freeze({
    ...block,
    x: block.y,
    y: z,
    width: block.height,
    height: 1,
    stride: block.data.byteLength,
  })
