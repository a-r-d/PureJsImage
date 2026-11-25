import { ImageError, invalidInput, truncatedInput } from './errors.ts'
import type { Background } from './pipeline.ts'
import { normalizedRotation, rotationDimensions } from './pipeline.ts'
import type { PixelBlock, PixelFormat } from './pixel.ts'
import type { ImageRuntime, TemporaryStore } from './runtime.ts'

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
  if (error instanceof ImageError) return error
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

const spoolTiles = async (
  store: TemporaryStore,
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
  format: PixelFormat,
  channelCount: number,
  trimTransparent: boolean,
): Promise<{ left: number; right: number; top: number; bottom: number }> => {
  let left = trimTransparent ? width : 0
  let right = trimTransparent ? -1 : width - 1
  let top = trimTransparent ? height : 0
  let bottom = trimTransparent ? -1 : height - 1
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
      // The caller enables trimming only when source and canvas transparency agree.
      if (trimTransparent) {
        const rowStart = row * block.stride + 3
        let first = 0
        while (first < width && block.data[rowStart + first * 4] === 0) first += 1
        if (first < width) {
          let last = width - 1
          while (last > right && block.data[rowStart + last * 4] === 0) last -= 1
          left = Math.min(left, first)
          right = Math.max(right, last)
          top = Math.min(top, receivedRows)
          bottom = receivedRows
        }
      }
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
        await writeAll(store, tileRow, tileY * tileRow.byteLength)
        tileRow.fill(0)
        tileY += 1
      }
    }
  }
  if (receivedRows !== height)
    throw truncatedInput(`Rotate received ${receivedRows} of ${height} rows`)
  if (receivedRows % tileSize !== 0) await writeAll(store, tileRow, tileY * tileRow.byteLength)
  return { left, right, top, bottom }
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
  runtime: ImageRuntime,
): AsyncGenerator<PixelBlock> {
  const sourceChannels = channels(sourceFormat)
  const outputChannels = channels(outputFormat)
  const outputStride = outputWidth * outputChannels
  const radians = (normalizedRotation(degrees) * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const tilesAcross = Math.ceil(sourceWidth / tileSize)
  const tileRows = Math.ceil(sourceHeight / tileSize)
  const tileBytes = tileSize * tileSize * sourceChannels
  let store: TemporaryStore | undefined
  let operationError: unknown
  let cleanupError: ImageError | undefined

  try {
    try {
      store = await runtime.createTemporaryStore({
        expectedBytes: tilesAcross * tileRows * tileBytes,
        prefix: 'purejsimage-rotate-',
      })
    } catch (error) {
      throw temporaryStorageError('setup', error)
    }
    const visible = await spoolTiles(
      store,
      blocks,
      sourceWidth,
      sourceHeight,
      sourceFormat,
      sourceChannels,
      sourceFormat === 'rgba8' && background[3] === 0,
    )
    // A rotated 32 by 32 output tile plus its bilinear taps spans at most
    // three source tiles on each axis, even when it straddles tile boundaries.
    const windowWidth = 3 * tileSize
    const windowStride = windowWidth * 4
    const backgroundPixel = new Uint32Array(Uint8Array.from(background).buffer)[0] ?? 0
    const window = new Uint8Array(3 * tileSize * windowStride)
    const windowPixels = new Uint32Array(window.buffer)
    const tileRowInput = new Uint8Array(3 * tileBytes)
    const rgbaTiles =
      sourceChannels === 4 ? tileRowInput : new Uint8Array(3 * tileSize * tileSize * 4)
    const tileStride = tileSize * 4
    const tileScanlines = Array.from({ length: 3 * tileSize }, (_, row) =>
      rgbaTiles.subarray(row * tileStride, (row + 1) * tileStride),
    )
    const sampleTile = (
      data: Uint8Array,
      outputPixels: Uint32Array | undefined,
      outputXStart: number,
      outputXEnd: number,
      outputY: number,
      blockHeight: number,
      originX: number,
      originY: number,
    ): void => {
      for (let row = 0; row < blockHeight; row += 1) {
        const outputYCentered = outputY + row + 0.5 - outputHeight / 2
        for (let x = outputXStart; x < outputXEnd; x += 1) {
          const outputX = x + 0.5 - outputWidth / 2
          const sourceX = cosine * outputX + sine * outputYCentered + sourceWidth / 2 - 0.5
          const sourceY = -sine * outputX + cosine * outputYCentered + sourceHeight / 2 - 0.5
          const left = Math.floor(sourceX)
          const top = Math.floor(sourceY)
          const index = (top - originY) * windowWidth + left - originX
          const first = windowPixels[index] ?? 0
          const offset = index * 4
          const target = row * outputStride + x * outputChannels
          // Equal RGBA taps yield exactly this pixel for every set of weights.
          if (
            first === windowPixels[index + 1] &&
            first === windowPixels[index + windowWidth] &&
            first === windowPixels[index + windowWidth + 1]
          ) {
            // Fully transparent taps produce transparent black, even with hidden RGB.
            if (window[offset + 3] === 0) continue
            if (outputPixels) outputPixels[row * outputWidth + x] = first
            else {
              data[target] = window[offset] ?? 0
              data[target + 1] = window[offset + 1] ?? 0
              data[target + 2] = window[offset + 2] ?? 0
            }
            continue
          }
          const fractionX = sourceX - left
          const fractionY = sourceY - top
          const below = offset + windowStride
          // Preserve the original tap order when weighting and rounding each channel.
          const w00 = ((window[offset + 3] ?? 0) / 255) * ((1 - fractionY) * (1 - fractionX))
          const w10 = ((window[offset + 7] ?? 0) / 255) * ((1 - fractionY) * fractionX)
          const w01 = ((window[below + 3] ?? 0) / 255) * (fractionY * (1 - fractionX))
          const w11 = ((window[below + 7] ?? 0) / 255) * (fractionY * fractionX)
          const alpha = w00 + w10 + w01 + w11
          if (alpha === 0) continue
          for (let c = 0; c < 3; c += 1) {
            const sum =
              (window[offset + c] ?? 0) * w00 +
              (window[offset + 4 + c] ?? 0) * w10 +
              (window[below + c] ?? 0) * w01 +
              (window[below + 4 + c] ?? 0) * w11
            data[target + c] = byte(sum / alpha)
          }
          if (outputPixels) data[target + 3] = byte(alpha * 255)
        }
      }
    }
    for (let outputY = 0; outputY < outputHeight; outputY += outputBlockRows) {
      const blockHeight = Math.min(outputBlockRows, outputHeight - outputY)
      const data = new Uint8Array(outputStride * blockHeight)
      const outputPixels = outputFormat === 'rgba8' ? new Uint32Array(data.buffer) : undefined
      for (let outputXStart = 0; outputXStart < outputWidth; outputXStart += tileSize) {
        const outputXEnd = Math.min(outputWidth, outputXStart + tileSize)
        const centeredLeft = outputXStart + 0.5 - outputWidth / 2
        const centeredRight = outputXEnd - 0.5 - outputWidth / 2
        const centeredTop = outputY + 0.5 - outputHeight / 2
        const centeredBottom = outputY + blockHeight - 0.5 - outputHeight / 2
        let minimumSourceX = Infinity
        let maximumSourceX = -Infinity
        let minimumSourceY = Infinity
        let maximumSourceY = -Infinity
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
        if (
          background[3] === 0 &&
          (maximumSourceX < visible.left ||
            minimumSourceX > visible.right ||
            maximumSourceY < visible.top ||
            minimumSourceY > visible.bottom)
        )
          continue
        const originX = Math.floor(minimumSourceX / tileSize) * tileSize
        const originY = Math.floor(minimumSourceY / tileSize) * tileSize
        if (
          minimumSourceX < 0 ||
          maximumSourceX >= sourceWidth ||
          minimumSourceY < 0 ||
          maximumSourceY >= sourceHeight
        ) {
          windowPixels.fill(backgroundPixel)
        }
        if (firstTileX <= lastTileX) {
          const readBytes = (lastTileX - firstTileX + 1) * tileBytes
          const input = tileRowInput.subarray(0, readBytes)
          for (let tileY = firstTileY; tileY <= lastTileY; tileY += 1) {
            await readAll(store, input, (tileY * tilesAcross + firstTileX) * tileBytes)
            if (sourceChannels !== 4) {
              const greenOffset = sourceChannels === 3 ? 1 : 0
              const blueOffset = sourceChannels === 3 ? 2 : 0
              for (let i = 0, dest = 0; i < input.length; i += sourceChannels, dest += 4) {
                rgbaTiles[dest] = input[i] ?? 0
                rgbaTiles[dest + 1] = input[i + greenOffset] ?? 0
                rgbaTiles[dest + 2] = input[i + blueOffset] ?? 0
                rgbaTiles[dest + 3] = 255
              }
            }
            for (let tileX = firstTileX; tileX <= lastTileX; tileX += 1) {
              const validWidth = Math.min(tileSize, sourceWidth - tileX * tileSize)
              const validRows = Math.min(tileSize, sourceHeight - tileY * tileSize)
              let target =
                (tileY * tileSize - originY) * windowStride + (tileX * tileSize - originX) * 4
              for (let row = 0; row < validRows; row += 1) {
                const scanline = tileScanlines[(tileX - firstTileX) * tileSize + row]
                if (!scanline) throw truncatedInput('Temporary rotation tile is missing')
                window.set(
                  validWidth === tileSize ? scanline : scanline.subarray(0, validWidth * 4),
                  target,
                )
                target += windowStride
              }
            }
          }
        }
        sampleTile(
          data,
          outputPixels,
          outputXStart,
          outputXEnd,
          outputY,
          blockHeight,
          originX,
          originY,
        )
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
    if (store) {
      try {
        await store.close()
      } catch (error) {
        cleanupError = temporaryStorageError('close', error)
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
  runtime: ImageRuntime,
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
        runtime,
      ),
  }
}
