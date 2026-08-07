import type { FileHandle } from 'node:fs/promises'

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

const tileSize = 32

const sourcePixel = (
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: ExifOrientation,
): number => {
  if (orientation === 2) return y * width + width - 1 - x
  if (orientation === 3) return (height - 1 - y) * width + width - 1 - x
  if (orientation === 4) return (height - 1 - y) * width + x
  if (orientation === 5) return x * width + y
  if (orientation === 6) return (height - 1 - x) * width + y
  if (orientation === 7) return (height - 1 - x) * width + width - 1 - y
  if (orientation === 8) return x * width + width - 1 - y
  return y * width + x
}

const writeAll = async (file: FileHandle, data: Uint8Array, position: number): Promise<void> => {
  let written = 0
  while (written < data.byteLength) {
    const result = await file.write(data, written, data.byteLength - written, position + written)
    if (result.bytesWritten < 1) throw new Error('Temporary orientation write made no progress')
    written += result.bytesWritten
  }
}

const readAll = async (file: FileHandle, data: Uint8Array, position: number): Promise<void> => {
  let read = 0
  while (read < data.byteLength) {
    const result = await file.read(data, read, data.byteLength - read, position + read)
    if (result.bytesRead < 1) throw truncatedInput('Temporary orientation data is truncated')
    read += result.bytesRead
  }
}

const flipHorizontal = async function* (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
  format: PixelFormat,
): AsyncGenerator<PixelBlock> {
  const channelCount = channels(format)
  const stride = width * channelCount
  let receivedRows = 0
  for await (const block of blocks) {
    if (
      block.x !== 0 ||
      block.y !== receivedRows ||
      block.width !== width ||
      block.height < 1 ||
      block.y + block.height > height ||
      block.format !== format ||
      block.stride < stride ||
      block.data.byteLength < block.stride * (block.height - 1) + stride
    ) {
      throw invalidInput('Orientation requires ordered, full-width pixel blocks')
    }
    const data = new Uint8Array(stride * block.height)
    for (let row = 0; row < block.height; row += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = row * block.stride + (width - 1 - x) * channelCount
        const outputOffset = row * stride + x * channelCount
        for (let channel = 0; channel < channelCount; channel += 1) {
          data[outputOffset + channel] = block.data[sourceOffset + channel] ?? 0
        }
      }
    }
    yield { x: 0, y: block.y, width, height: block.height, stride, format, data }
    receivedRows += block.height
  }
  if (receivedRows !== height) {
    throw truncatedInput(`Orientation received ${receivedRows} of ${height} rows`)
  }
}

const spoolTiles = async (
  file: FileHandle,
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
  format: PixelFormat,
  channelCount: number,
): Promise<{ readonly tilesAcross: number; readonly tileBytes: number }> => {
  const stride = width * channelCount
  const tileStride = tileSize * channelCount
  const tileBytes = tileStride * tileSize
  const tilesAcross = Math.ceil(width / tileSize)
  const tileRow = new Uint8Array(tilesAcross * tileBytes)
  let receivedRows = 0
  let tileY = 0

  for await (const block of blocks) {
    if (
      block.x !== 0 ||
      block.y !== receivedRows ||
      block.width !== width ||
      block.height < 1 ||
      block.y + block.height > height ||
      block.format !== format ||
      block.stride < stride ||
      block.data.byteLength < block.stride * (block.height - 1) + stride
    ) {
      throw invalidInput('Orientation requires ordered, full-width pixel blocks')
    }
    for (let row = 0; row < block.height; row += 1) {
      const tileRowY = receivedRows % tileSize
      for (let tileX = 0; tileX < tilesAcross; tileX += 1) {
        const sourceX = tileX * tileSize
        const pixels = Math.min(tileSize, width - sourceX)
        const sourceOffset = row * block.stride + sourceX * channelCount
        const targetOffset = tileX * tileBytes + tileRowY * tileStride
        tileRow.set(
          block.data.subarray(sourceOffset, sourceOffset + pixels * channelCount),
          targetOffset,
        )
      }
      receivedRows += 1
      if (receivedRows % tileSize === 0) {
        await writeAll(file, tileRow, tileY * tileRow.byteLength)
        tileRow.fill(0)
        tileY += 1
      }
    }
  }
  if (receivedRows !== height) {
    throw truncatedInput(`Orientation received ${receivedRows} of ${height} rows`)
  }
  if (receivedRows % tileSize !== 0) await writeAll(file, tileRow, tileY * tileRow.byteLength)
  return { tilesAcross, tileBytes }
}

const orientedBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
  format: PixelFormat,
  orientation: ExifOrientation,
): AsyncGenerator<PixelBlock> {
  const channelCount = channels(format)
  const outputWidth = orientation >= 5 ? height : width
  const outputHeight = orientation >= 5 ? width : height
  const outputStride = outputWidth * channelCount
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { mkdtemp, open, rm } = await import('node:fs/promises')
  const directory = await mkdtemp(join(tmpdir(), 'purejsimage-orient-'))

  try {
    const file = await open(join(directory, 'tiles'), 'w+')
    try {
      const { tilesAcross, tileBytes } = await spoolTiles(
        file,
        blocks,
        width,
        height,
        format,
        channelCount,
      )
      for (let outputY = 0; outputY < outputHeight; outputY += tileSize) {
        const blockHeight = Math.min(tileSize, outputHeight - outputY)
        const data = new Uint8Array(outputStride * blockHeight)
        const cachedTiles = new Map<number, Uint8Array>()
        for (let row = 0; row < blockHeight; row += 1) {
          for (let x = 0; x < outputWidth; x += 1) {
            const pixel = sourcePixel(x, outputY + row, width, height, orientation)
            const sourceX = pixel % width
            const sourceY = Math.floor(pixel / width)
            const tileIndex =
              Math.floor(sourceY / tileSize) * tilesAcross + Math.floor(sourceX / tileSize)
            let tile = cachedTiles.get(tileIndex)
            if (!tile) {
              tile = new Uint8Array(tileBytes)
              await readAll(file, tile, tileIndex * tileBytes)
              cachedTiles.set(tileIndex, tile)
            }
            const sourceOffset =
              ((sourceY % tileSize) * tileSize + (sourceX % tileSize)) * channelCount
            const outputOffset = row * outputStride + x * channelCount
            for (let channel = 0; channel < channelCount; channel += 1) {
              data[outputOffset + channel] = tile[sourceOffset + channel] ?? 0
            }
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
    } finally {
      await file.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
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
      if (orientation === 1) return blocks
      if (orientation === 2) return flipHorizontal(blocks, width, height, format)
      return orientedBlocks(blocks, width, height, format, orientation)
    },
  }
}
