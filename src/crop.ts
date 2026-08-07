import { invalidInput } from './errors.ts'
import type { CropOptions } from './pipeline.ts'
import type { PixelBlock, PixelFormat } from './pixel.ts'

const channels = (format: PixelFormat): number => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  throw invalidInput(`Crop does not support ${format} pixels`)
}

const croppedBlocks = async function* (
  input: AsyncIterable<PixelBlock>,
  sourceWidth: number,
  sourceHeight: number,
  format: PixelFormat,
  crop: Readonly<CropOptions>,
): AsyncGenerator<PixelBlock> {
  const channelCount = channels(format)
  const sourceStride = sourceWidth * channelCount
  const outputStride = crop.width * channelCount
  let expectedY = 0
  let outputY = 0

  for await (const block of input) {
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
        const start = sourceRow * block.stride + crop.x * channelCount
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
      }
      outputY += height
    }
    expectedY += block.height
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
