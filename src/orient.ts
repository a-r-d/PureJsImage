import { ImageError, invalidInput, truncatedInput } from './errors.ts'
import type { PixelBlock, PixelFormat } from './pixel.ts'
import type { ImageRuntime, TemporaryStore } from './runtime.ts'

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

const temporaryStorageError = (operation: string, error: unknown): ImageError => {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
  const capacityError = code === 'ENOSPC' || code === 'EDQUOT' || code === 'EFBIG'
  return new ImageError(
    capacityError ? 'LIMIT_EXCEEDED' : 'UNSUPPORTED_OPERATION',
    `Auto-orient temporary storage ${operation} failed${code ? ` (${code})` : ''}`,
    { cause: error },
  )
}

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

const writeAll = async (
  store: TemporaryStore,
  data: Uint8Array,
  position: number,
): Promise<void> => {
  try {
    await store.write(position, data)
  } catch (error) {
    throw temporaryStorageError('write', error)
  }
}

const readAll = async (
  store: TemporaryStore,
  data: Uint8Array,
  position: number,
): Promise<void> => {
  try {
    await store.read(position, data)
  } catch (error) {
    throw temporaryStorageError('read', error)
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
  store: TemporaryStore,
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
        await writeAll(store, tileRow, tileY * tileRow.byteLength)
        tileRow.fill(0)
        tileY += 1
      }
    }
  }
  if (receivedRows !== height) {
    throw truncatedInput(`Orientation received ${receivedRows} of ${height} rows`)
  }
  if (receivedRows % tileSize !== 0) await writeAll(store, tileRow, tileY * tileRow.byteLength)
  return { tilesAcross, tileBytes }
}

const orientedBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
  format: PixelFormat,
  orientation: ExifOrientation,
  runtime: ImageRuntime,
): AsyncGenerator<PixelBlock> {
  const channelCount = channels(format)
  const outputWidth = orientation >= 5 ? height : width
  const outputHeight = orientation >= 5 ? width : height
  const outputStride = outputWidth * channelCount
  const tilesAcross = Math.ceil(width / tileSize)
  const tileRows = Math.ceil(height / tileSize)
  const tileBytes = tileSize * tileSize * channelCount
  let store: TemporaryStore | undefined
  let operationFailed = false
  let operationError: unknown
  let cleanupError: ImageError | undefined

  try {
    try {
      store = await runtime.createTemporaryStore({
        expectedBytes: tilesAcross * tileRows * tileBytes,
        prefix: 'purejsimage-orient-',
      })
    } catch (error) {
      throw temporaryStorageError('setup', error)
    }
    const spooled = await spoolTiles(store, blocks, width, height, format, channelCount)
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
            tile = new Uint8Array(spooled.tileBytes)
            await readAll(store, tile, tileIndex * spooled.tileBytes)
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
  } catch (error) {
    operationFailed = true
    operationError = error
  } finally {
    if (store) {
      try {
        await store.close()
      } catch (error) {
        cleanupError = temporaryStorageError('close', error)
      }
    }
  }
  if (operationFailed) throw operationError
  if (cleanupError) throw cleanupError
}

export const createOrientationTransform = (
  width: number,
  height: number,
  format: PixelFormat,
  orientation: ExifOrientation,
  runtime: ImageRuntime,
): OrientationTransform => {
  channels(format)
  return {
    width: orientation >= 5 ? height : width,
    height: orientation >= 5 ? width : height,
    apply(blocks: AsyncIterable<PixelBlock>): AsyncIterable<PixelBlock> {
      if (orientation === 1) return blocks
      if (orientation === 2) return flipHorizontal(blocks, width, height, format)
      return orientedBlocks(blocks, width, height, format, orientation, runtime)
    },
  }
}
