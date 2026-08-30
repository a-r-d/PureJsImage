import { invalidInput } from './errors.ts'
import type { CropOptions } from './pipeline.ts'
import { type PixelBlock, type PixelFormat, pixelBytesPerPixel } from './pixel.ts'

const croppedBlocks = async function* (
  input: AsyncIterable<PixelBlock>,
  sourceWidth: number,
  sourceHeight: number,
  format: PixelFormat,
  crop: Readonly<CropOptions>,
): AsyncGenerator<PixelBlock> {
  const bytesPerPixel = pixelBytesPerPixel(format)
  const sourceStride = sourceWidth * bytesPerPixel
  const outputStride = crop.width * bytesPerPixel
  let expectedY = 0
  let outputY = 0

  for await (const block of input) {
    try {
      if (
        block.x !== 0 ||
        block.y !== expectedY ||
        block.width !== sourceWidth ||
        block.height < 1 ||
        block.format !== format ||
        block.stride < sourceStride ||
        block.data.byteLength < block.stride * (block.height - 1) + sourceStride
      ) {
        throw invalidInput('Crop requires ordered, full-width pixel blocks')
      }
      const firstRow = Math.max(crop.y, block.y)
      const lastRow = Math.min(crop.y + crop.height, block.y + block.height)
      if (firstRow < lastRow) {
        const height = lastRow - firstRow
        const data = new Uint8Array(outputStride * height)
        for (let row = 0; row < height; row += 1) {
          const sourceRow = firstRow - block.y + row
          const start = sourceRow * block.stride + crop.x * bytesPerPixel
          data.set(block.data.subarray(start, start + outputStride), row * outputStride)
        }
        yield {
          x: 0,
          y: outputY,
          width: crop.width,
          height,
          stride: outputStride,
          format,
          data,
          ...(block.colorSemantics === undefined ? {} : { colorSemantics: block.colorSemantics }),
        }
        outputY += height
      }
      expectedY += block.height
    } finally {
      block.release?.()
    }
  }
  if (expectedY !== sourceHeight || outputY !== crop.height) {
    throw invalidInput(
      `Crop received ${expectedY} of ${sourceHeight} source rows and produced ${outputY} of ${crop.height}`,
    )
  }
}

export const cropPixelBlocks = (
  input: AsyncIterable<PixelBlock>,
  sourceWidth: number,
  sourceHeight: number,
  format: PixelFormat,
  crop: Readonly<CropOptions>,
): AsyncIterable<PixelBlock> => {
  if (crop.x === 0 && crop.y === 0 && crop.width === sourceWidth && crop.height === sourceHeight) {
    return input
  }
  return croppedBlocks(input, sourceWidth, sourceHeight, format, crop)
}
