import type { FileHandle } from 'node:fs/promises'

import { ImageError, invalidInput, truncatedInput } from './errors.ts'
import type { Background } from './pipeline.ts'
import { normalizedRotation, rotationDimensions } from './pipeline.ts'
import type { PixelBlock, PixelFormat } from './pixel.ts'

export interface RotationTransform {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  apply(blocks: AsyncIterable<PixelBlock>): AsyncIterable<PixelBlock>
}

const tileSize = 32
const outputBlockRows = 32

const channels = (format: PixelFormat): number => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  throw invalidInput(`Rotate does not support ${format} pixels`)
}

const temporaryStorageError = (operation: string, error: unknown): ImageError => {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
  return new ImageError(
    code === 'ENOSPC' || code === 'EDQUOT' || code === 'EFBIG'
      ? 'LIMIT_EXCEEDED'
      : 'UNSUPPORTED_OPERATION',
    `Rotate temporary storage ${operation} failed${code ? ` (${code})` : ''}`,
    { cause: error },
  )
}

const writeAll = async (file: FileHandle, data: Uint8Array, position: number): Promise<void> => {
  let written = 0
  while (written < data.byteLength) {
    let bytesWritten: number
    try {
      ;({ bytesWritten } = await file.write(
        data,
        written,
        data.byteLength - written,
        position + written,
      ))
    } catch (error) {
      throw temporaryStorageError('write', error)
    }
    if (bytesWritten < 1) throw temporaryStorageError('write', new Error('Write made no progress'))
    written += bytesWritten
  }
}

const readAll = async (file: FileHandle, data: Uint8Array, position: number): Promise<void> => {
  let read = 0
  while (read < data.byteLength) {
    let bytesRead: number
    try {
      ;({ bytesRead } = await file.read(data, read, data.byteLength - read, position + read))
    } catch (error) {
      throw temporaryStorageError('read', error)
    }
    if (bytesRead < 1) throw truncatedInput('Temporary rotation data is truncated')
    read += bytesRead
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
  const sourceStride = width * channelCount
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
      block.stride < sourceStride ||
      block.data.byteLength < block.stride * (block.height - 1) + sourceStride
    ) {
      throw invalidInput('Rotate requires ordered, full-width pixel blocks')
    }
    for (let row = 0; row < block.height; row += 1) {
      const tileRowY = receivedRows % tileSize
      for (let tileX = 0; tileX < tilesAcross; tileX += 1) {
        const sourceX = tileX * tileSize
        const pixels = Math.min(tileSize, width - sourceX)
        tileRow.set(
          block.data.subarray(
            row * block.stride + sourceX * channelCount,
            row * block.stride + (sourceX + pixels) * channelCount,
          ),
          tileX * tileBytes + tileRowY * tileStride,
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
  if (receivedRows !== height)
    throw truncatedInput(`Rotate received ${receivedRows} of ${height} rows`)
  if (receivedRows % tileSize !== 0) await writeAll(file, tileRow, tileY * tileRow.byteLength)
  return { tilesAcross, tileBytes }
}

const backgroundRgba = (
  background: Background | undefined,
): readonly [number, number, number, number] => {
  if (background === undefined || background === 'transparent') return [0, 0, 0, 0]
  return [
    Number.parseInt(background.slice(1, 3), 16),
    Number.parseInt(background.slice(3, 5), 16),
    Number.parseInt(background.slice(5, 7), 16),
    background.length === 9 ? Number.parseInt(background.slice(7, 9), 16) : 255,
  ]
}

const byte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)))

const rotatedBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  sourceWidth: number,
  sourceHeight: number,
  sourceFormat: PixelFormat,
  degrees: number,
  background: readonly [number, number, number, number],
  outputWidth: number,
  outputHeight: number,
  outputFormat: PixelFormat,
): AsyncGenerator<PixelBlock> {
  const sourceChannels = channels(sourceFormat)
  const outputChannels = channels(outputFormat)
  const outputStride = outputWidth * outputChannels
  const radians = (normalizedRotation(degrees) * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { mkdtemp, open, rm } = await import('node:fs/promises')
  let directory: string | undefined
  let file: FileHandle | undefined
  let operationError: unknown
  let cleanupError: ImageError | undefined

  try {
    try {
      directory = await mkdtemp(join(tmpdir(), 'purejsimage-rotate-'))
      file = await open(join(directory, 'tiles'), 'w+')
    } catch (error) {
      throw temporaryStorageError('setup', error)
    }
    if (!file) throw temporaryStorageError('setup', new Error('Temporary file was not opened'))
    const activeFile = file
    const { tilesAcross, tileBytes } = await spoolTiles(
      activeFile,
      blocks,
      sourceWidth,
      sourceHeight,
      sourceFormat,
      sourceChannels,
    )
    for (let outputY = 0; outputY < outputHeight; outputY += outputBlockRows) {
      const blockHeight = Math.min(outputBlockRows, outputHeight - outputY)
      const data = new Uint8Array(outputStride * blockHeight)
      const cachedTiles = new Map<number, Uint8Array>()
      for (let outputXStart = 0; outputXStart < outputWidth; outputXStart += tileSize) {
        const outputXEnd = Math.min(outputWidth, outputXStart + tileSize)
        const centeredLeft = outputXStart + 0.5 - outputWidth / 2
        const centeredRight = outputXEnd - 0.5 - outputWidth / 2
        const centeredTop = outputY + 0.5 - outputHeight / 2
        const centeredBottom = outputY + blockHeight - 0.5 - outputHeight / 2
        let minimumSourceX = sourceWidth
        let maximumSourceX = -1
        let minimumSourceY = sourceHeight
        let maximumSourceY = -1
        for (const centeredX of [centeredLeft, centeredRight]) {
          for (const centeredY of [centeredTop, centeredBottom]) {
            const sourceX = cosine * centeredX + sine * centeredY + sourceWidth / 2 - 0.5
            const sourceY = -sine * centeredX + cosine * centeredY + sourceHeight / 2 - 0.5
            minimumSourceX = Math.min(minimumSourceX, Math.floor(sourceX))
            maximumSourceX = Math.max(maximumSourceX, Math.floor(sourceX) + 1)
            minimumSourceY = Math.min(minimumSourceY, Math.floor(sourceY))
            maximumSourceY = Math.max(maximumSourceY, Math.floor(sourceY) + 1)
          }
        }
        const firstTileX = Math.floor(Math.max(0, minimumSourceX) / tileSize)
        const lastTileX = Math.floor(Math.min(sourceWidth - 1, maximumSourceX) / tileSize)
        const firstTileY = Math.floor(Math.max(0, minimumSourceY) / tileSize)
        const lastTileY = Math.floor(Math.min(sourceHeight - 1, maximumSourceY) / tileSize)
        cachedTiles.clear()
        if (firstTileX <= lastTileX && firstTileY <= lastTileY) {
          for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
            for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
              const tileIndex = tileY * tilesAcross + tileX
              const tile = new Uint8Array(tileBytes)
              await readAll(activeFile, tile, tileIndex * tileBytes)
              cachedTiles.set(tileIndex, tile)
            }
          }
        }
        for (let row = 0; row < blockHeight; row += 1) {
          const y = outputY + row
          for (let x = outputXStart; x < outputXEnd; x += 1) {
            const outputX = x + 0.5 - outputWidth / 2
            const outputYCentered = y + 0.5 - outputHeight / 2
            const sourceX = cosine * outputX + sine * outputYCentered + sourceWidth / 2 - 0.5
            const sourceY = -sine * outputX + cosine * outputYCentered + sourceHeight / 2 - 0.5
            const left = Math.floor(sourceX)
            const top = Math.floor(sourceY)
            const fractionX = sourceX - left
            const fractionY = sourceY - top
            let alpha = 0
            let red = 0
            let green = 0
            let blue = 0
            for (let yOffset = 0; yOffset < 2; yOffset += 1) {
              const sampleY = top + yOffset
              const weightY = yOffset === 0 ? 1 - fractionY : fractionY
              for (let xOffset = 0; xOffset < 2; xOffset += 1) {
                const sampleX = left + xOffset
                const weight = weightY * (xOffset === 0 ? 1 - fractionX : fractionX)
                let sampleRed = background[0]
                let sampleGreen = background[1]
                let sampleBlue = background[2]
                let sampleAlpha = background[3]
                if (
                  sampleX >= 0 &&
                  sampleY >= 0 &&
                  sampleX < sourceWidth &&
                  sampleY < sourceHeight
                ) {
                  const tileIndex =
                    Math.floor(sampleY / tileSize) * tilesAcross + Math.floor(sampleX / tileSize)
                  const tile = cachedTiles.get(tileIndex)
                  if (!tile) throw truncatedInput('Temporary rotation tile is missing')
                  const offset =
                    ((sampleY % tileSize) * tileSize + (sampleX % tileSize)) * sourceChannels
                  sampleRed = tile[offset] ?? 0
                  sampleGreen = sourceFormat === 'gray8' ? sampleRed : (tile[offset + 1] ?? 0)
                  sampleBlue = sourceFormat === 'gray8' ? sampleRed : (tile[offset + 2] ?? 0)
                  sampleAlpha = sourceFormat === 'rgba8' ? (tile[offset + 3] ?? 0) : 255
                }
                const weightedAlpha = (sampleAlpha / 255) * weight
                alpha += weightedAlpha
                red += sampleRed * weightedAlpha
                green += sampleGreen * weightedAlpha
                blue += sampleBlue * weightedAlpha
              }
            }
            const target = row * outputStride + x * outputChannels
            const outputRed = alpha === 0 ? 0 : byte(red / alpha)
            const outputGreen = alpha === 0 ? 0 : byte(green / alpha)
            const outputBlue = alpha === 0 ? 0 : byte(blue / alpha)
            if (outputFormat === 'gray8') {
              data[target] = outputRed
            } else {
              data[target] = outputRed
              data[target + 1] = outputGreen
              data[target + 2] = outputBlue
              if (outputFormat === 'rgba8') data[target + 3] = byte(alpha * 255)
            }
          }
        }
      }
      yield {
        x: 0,
        y: outputY,
        width: outputWidth,
        height: blockHeight,
        stride: outputStride,
        format: outputFormat,
        data,
      }
    }
  } catch (error) {
    operationError = error
  } finally {
    if (file) {
      try {
        await file.close()
      } catch (error) {
        cleanupError = temporaryStorageError('close', error)
      }
    }
    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true })
      } catch (error) {
        cleanupError ??= temporaryStorageError('cleanup', error)
      }
    }
  }
  if (operationError !== undefined) throw operationError
  if (cleanupError) throw cleanupError
}

export const createRotationTransform = (
  width: number,
  height: number,
  format: PixelFormat,
  degrees: number,
  backgroundOption: Background | undefined,
): RotationTransform => {
  channels(format)
  const dimensions = rotationDimensions(width, height, degrees)
  const background = backgroundRgba(backgroundOption)
  const pixelFormat: PixelFormat =
    format === 'rgba8' || background[3] < 255 ? 'rgba8' : format === 'gray8' ? 'rgb8' : format
  return {
    ...dimensions,
    pixelFormat,
    apply: (blocks) =>
      rotatedBlocks(
        blocks,
        width,
        height,
        format,
        degrees,
        background,
        dimensions.width,
        dimensions.height,
        pixelFormat,
      ),
  }
}
