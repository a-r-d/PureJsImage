import type { PixelColorSemantics } from './color.ts'
import { ImageError, invalidInput, truncatedInput } from './errors.ts'
import { type PixelBlock, type PixelFormat, pixelBytesPerPixel } from './pixel.ts'
import type { ImageRuntime, TemporaryStore } from './runtime.ts'

export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface OrientationTransform {
  readonly width: number
  readonly height: number
  apply(blocks: AsyncIterable<PixelBlock>): AsyncIterable<PixelBlock>
}

const tileSize = 32

const temporaryStorageError = (operation: string, error: unknown): ImageError => {
  if (error instanceof ImageError) return error
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
  const bytesPerPixel = pixelBytesPerPixel(format)
  const stride = width * bytesPerPixel
  let receivedRows = 0
  for await (const block of blocks) {
    try {
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
          const sourceOffset = row * block.stride + (width - 1 - x) * bytesPerPixel
          const outputOffset = row * stride + x * bytesPerPixel
          data.set(block.data.subarray(sourceOffset, sourceOffset + bytesPerPixel), outputOffset)
        }
      }
      yield {
        x: 0,
        y: block.y,
        width,
        height: block.height,
        stride,
        format,
        data,
        ...(block.displayRanges === undefined ? {} : { displayRanges: block.displayRanges }),
        ...(block.colorSemantics === undefined ? {} : { colorSemantics: block.colorSemantics }),
      }
      receivedRows += block.height
    } finally {
      block.release?.()
    }
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
  bytesPerPixel: number,
): Promise<{
  readonly displayRanges?: PixelBlock['displayRanges']
  readonly colorSemantics?: PixelColorSemantics
}> => {
  const stride = width * bytesPerPixel
  const tileStride = tileSize * bytesPerPixel
  const tileBytes = tileStride * tileSize
  const tilesAcross = Math.ceil(width / tileSize)
  const tileRow = new Uint8Array(tilesAcross * tileBytes)
  let receivedRows = 0
  let tileY = 0
  let displayRanges: PixelBlock['displayRanges']
  let colorSemantics: PixelColorSemantics | undefined

  for await (const block of blocks) {
    try {
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
      displayRanges ??= block.displayRanges
      colorSemantics ??= block.colorSemantics
      for (let row = 0; row < block.height; row += 1) {
        const tileRowY = receivedRows % tileSize
        for (let tileX = 0; tileX < tilesAcross; tileX += 1) {
          const sourceX = tileX * tileSize
          const pixels = Math.min(tileSize, width - sourceX)
          const sourceOffset = row * block.stride + sourceX * bytesPerPixel
          const targetOffset = tileX * tileBytes + tileRowY * tileStride
          tileRow.set(
            block.data.subarray(sourceOffset, sourceOffset + pixels * bytesPerPixel),
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
    } finally {
      block.release?.()
    }
  }
  if (receivedRows !== height) {
    throw truncatedInput(`Orientation received ${receivedRows} of ${height} rows`)
  }
  if (receivedRows % tileSize !== 0) await writeAll(store, tileRow, tileY * tileRow.byteLength)
  return {
    ...(displayRanges === undefined ? {} : { displayRanges }),
    ...(colorSemantics === undefined ? {} : { colorSemantics }),
  }
}

const orientedBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
  format: PixelFormat,
  orientation: ExifOrientation,
  runtime: ImageRuntime,
): AsyncGenerator<PixelBlock> {
  const bytesPerPixel = pixelBytesPerPixel(format)
  const outputWidth = orientation >= 5 ? height : width
  const outputHeight = orientation >= 5 ? width : height
  const outputStride = outputWidth * bytesPerPixel
  const tilesAcross = Math.ceil(width / tileSize)
  const tileRows = Math.ceil(height / tileSize)
  const tileBytes = tileSize * tileSize * bytesPerPixel
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
    const spooled = await spoolTiles(store, blocks, width, height, format, bytesPerPixel)
    const tile = new Uint8Array(tileBytes)
    const transpose = orientation >= 5
    const reverseX = orientation === 3 || orientation === 6 || orientation === 7
    const reverseY =
      orientation === 3 || orientation === 4 || orientation === 7 || orientation === 8
    const stepX = (transpose ? tileSize : 1) * bytesPerPixel * (reverseX ? -1 : 1)
    const stepY = (transpose ? 1 : tileSize) * bytesPerPixel * (reverseY ? -1 : 1)

    // Work in source-aligned bands so each tile is read exactly once, including partial edges.
    const bands = Math.ceil(outputHeight / tileSize)
    let spare: Uint8Array | undefined
    for (let band = 0; band < bands; band += 1) {
      const sourceBand = reverseY ? bands - 1 - band : band
      const bandStart = sourceBand * tileSize
      const blockHeight = Math.min(tileSize, outputHeight - bandStart)
      const outputY = reverseY ? outputHeight - bandStart - blockHeight : bandStart
      const length = outputStride * blockHeight
      const data: Uint8Array = spare?.length === length ? spare : new Uint8Array(length)
      spare = undefined
      for (let spanStart = 0; spanStart < outputWidth; spanStart += tileSize) {
        const span = spanStart / tileSize
        const tileIndex = transpose
          ? span * tilesAcross + sourceBand
          : sourceBand * tilesAcross + span
        await readAll(store, tile, tileIndex * tileBytes)
        const spanWidth = Math.min(tileSize, outputWidth - spanStart)
        const outputX = reverseX ? outputWidth - spanStart - spanWidth : spanStart
        const first =
          (reverseY ? (1 - blockHeight) * stepY : 0) + (reverseX ? (1 - spanWidth) * stepX : 0)
        for (let row = 0; row < blockHeight; row += 1) {
          let source = first + row * stepY
          let target = row * outputStride + outputX * bytesPerPixel
          if (bytesPerPixel === 3) {
            for (let x = 0; x < spanWidth; x += 1) {
              data[target++] = tile[source] ?? 0
              data[target++] = tile[source + 1] ?? 0
              data[target++] = tile[source + 2] ?? 0
              source += stepX
            }
            continue
          }
          for (let x = 0; x < spanWidth; x += 1) {
            for (let byte = 0; byte < bytesPerPixel; byte += 1) {
              data[target++] = tile[source + byte] ?? 0
            }
            source += stepX
          }
        }
      }
      let released = false
      yield {
        release() {
          if (released) return
          released = true
          spare = data
        },
        x: 0,
        y: outputY,
        width: outputWidth,
        height: blockHeight,
        stride: outputStride,
        format,
        data,
        ...(spooled.displayRanges === undefined ? {} : { displayRanges: spooled.displayRanges }),
        ...(spooled.colorSemantics === undefined ? {} : { colorSemantics: spooled.colorSemantics }),
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
  pixelBytesPerPixel(format)
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
