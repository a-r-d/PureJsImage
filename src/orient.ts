import { invalidInput, truncatedInput } from './errors.ts'
import type { PixelBlock, PixelFormat } from './pixel.ts'

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface OrientationTransform {
  readonly width: number
  readonly height: number
  apply(blocks: AsyncIterable<PixelBlock>): AsyncIterable<PixelBlock>
}

const channels = (format: PixelFormat): number => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  throw invalidInput(`Orientation does not support ${format} pixels`)
}

const sourceCoordinate = (
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: ExifOrientation,
): readonly [number, number] => {
  if (orientation === 2) return [width - 1 - x, y]
  if (orientation === 3) return [width - 1 - x, height - 1 - y]
  if (orientation === 4) return [x, height - 1 - y]
  if (orientation === 5) return [y, x]
  if (orientation === 6) return [y, height - 1 - x]
  if (orientation === 7) return [width - 1 - y, height - 1 - x]
  if (orientation === 8) return [width - 1 - y, x]
  return [x, y]
}

const orientedBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
  format: PixelFormat,
  orientation: ExifOrientation,
): AsyncGenerator<PixelBlock> {
  const channelCount = channels(format)
  const stride = width * channelCount
  const source = new Uint8Array(stride * height)
  let receivedRows = 0
  for await (const block of blocks) {
    if (
      block.x !== 0 ||
      block.y !== receivedRows ||
      block.width !== width ||
      block.height < 1 ||
      block.format !== format ||
      block.stride < stride ||
      block.data.byteLength < block.stride * (block.height - 1) + stride
    ) {
      throw invalidInput('Orientation requires ordered, full-width pixel blocks')
    }
    for (let row = 0; row < block.height; row += 1) {
      source.set(
        block.data.subarray(row * block.stride, row * block.stride + stride),
        (receivedRows + row) * stride,
      )
    }
    receivedRows += block.height
  }
  if (receivedRows !== height) {
    throw truncatedInput(`Orientation received ${receivedRows} of ${height} rows`)
  }

  const outputWidth = orientation >= 5 ? height : width
  const outputHeight = orientation >= 5 ? width : height
  const outputStride = outputWidth * channelCount
  for (let outputY = 0; outputY < outputHeight; outputY += 32) {
    const blockHeight = Math.min(32, outputHeight - outputY)
    const data = new Uint8Array(outputStride * blockHeight)
    for (let row = 0; row < blockHeight; row += 1) {
      for (let x = 0; x < outputWidth; x += 1) {
        const [sourceX, sourceY] = sourceCoordinate(x, outputY + row, width, height, orientation)
        const sourceOffset = (sourceY * width + sourceX) * channelCount
        const outputOffset = row * outputStride + x * channelCount
        data.set(source.subarray(sourceOffset, sourceOffset + channelCount), outputOffset)
      }
    }
    yield {
      x: 0,
      y: outputY,
      width: outputWidth,
      height: blockHeight,
      stride: outputStride,
      format,
      data,
    }
  }
}

export const createOrientationTransform = (
  width: number,
  height: number,
  format: PixelFormat,
  orientation: ExifOrientation,
): OrientationTransform => {
  channels(format)
  return {
    width: orientation >= 5 ? height : width,
    height: orientation >= 5 ? width : height,
    apply(blocks: AsyncIterable<PixelBlock>): AsyncIterable<PixelBlock> {
      return orientation === 1 ? blocks : orientedBlocks(blocks, width, height, format, orientation)
    },
  }
}
