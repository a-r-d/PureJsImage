import { invalidInput } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import type { EnviDataset } from './formats/envi.ts'
import { rasterBlockToNumericTile, validateNumericTile } from './numeric-tile.ts'

export interface EnviClassificationRenderOptions {
  readonly maxWidth: number
  readonly maxHeight: number
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
}

export interface EnviClassificationRenderedImage {
  readonly width: number
  readonly height: number
  readonly sourceRegion: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly pixels: AsyncIterable<PixelBlock>
}

interface ResolvedClassificationRender {
  readonly sourceX: number
  readonly sourceY: number
  readonly sourceWidth: number
  readonly sourceHeight: number
  readonly outputWidth: number
  readonly outputHeight: number
}

const positiveSize = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const resolveRender = (
  dataset: EnviDataset,
  options: Readonly<EnviClassificationRenderOptions>,
): ResolvedClassificationRender => {
  const sourceX = options.x ?? 0
  const sourceY = options.y ?? 0
  const sourceWidth = options.width ?? dataset.sizeX - sourceX
  const sourceHeight = options.height ?? dataset.sizeY - sourceY
  const maxWidth = positiveSize('ENVI classification maxWidth', options.maxWidth)
  const maxHeight = positiveSize('ENVI classification maxHeight', options.maxHeight)
  if (
    !Number.isSafeInteger(sourceX) ||
    !Number.isSafeInteger(sourceY) ||
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceX < 0 ||
    sourceY < 0 ||
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    sourceX + sourceWidth > dataset.sizeX ||
    sourceY + sourceHeight > dataset.sizeY
  ) {
    throw invalidInput('ENVI classification render region is outside the dataset')
  }
  const boundedWidth = Math.min(maxWidth, sourceWidth)
  const boundedHeight = Math.min(maxHeight, sourceHeight)
  const widthLimited = sourceWidth * boundedHeight > sourceHeight * boundedWidth
  return {
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    outputWidth: widthLimited
      ? boundedWidth
      : Math.max(1, Math.floor((sourceWidth * boundedHeight) / sourceHeight)),
    outputHeight: widthLimited
      ? Math.max(1, Math.floor((sourceHeight * boundedWidth) / sourceWidth))
      : boundedHeight,
  }
}

const sourceCoordinates = (sourceSize: number, outputSize: number): Uint32Array => {
  const coordinates = new Uint32Array(outputSize)
  for (let index = 0; index < outputSize; index += 1) {
    coordinates[index] = Math.min(
      sourceSize - 1,
      Math.floor(((index + 0.5) * sourceSize) / outputSize),
    )
  }
  return coordinates
}

const classificationRows = async function* (
  dataset: EnviDataset,
  render: ResolvedClassificationRender,
): AsyncGenerator<PixelBlock> {
  const classes = dataset.classes
  if (classes === undefined) throw invalidInput('ENVI dataset has no classification metadata')
  const sourceColumns = sourceCoordinates(render.sourceWidth, render.outputWidth)
  const sourceRows = sourceCoordinates(render.sourceHeight, render.outputHeight)
  for (let outputY = 0; outputY < render.outputHeight; outputY += 1) {
    const sourceRow = sourceRows[outputY]
    if (sourceRow === undefined) throw invalidInput('ENVI classification row mapping is invalid')
    let emitted = false
    for await (const block of dataset.readPlane({
      z: 0,
      c: 0,
      t: 0,
      x: render.sourceX,
      y: render.sourceY + sourceRow,
      width: render.sourceWidth,
      height: 1,
    })) {
      const tile = rasterBlockToNumericTile(block, {
        ...(block.format.sampleType === 'uint64' ? { targetSampleType: 'float64' } : {}),
      })
      try {
        if (
          emitted ||
          tile.x !== render.sourceX ||
          tile.y !== render.sourceY + sourceRow ||
          tile.width !== render.sourceWidth ||
          tile.height !== 1 ||
          tile.componentCount !== 1
        ) {
          throw invalidInput('ENVI classification reader emitted an unexpected source row')
        }
        emitted = true
        validateNumericTile(tile)
        if (tile.data instanceof BigUint64Array) {
          throw invalidInput('ENVI classification uint64 values must convert exactly to float64')
        }
        const output = new Uint8Array(render.outputWidth * 3)
        for (let outputX = 0; outputX < render.outputWidth; outputX += 1) {
          const sourceColumn = sourceColumns[outputX]
          if (sourceColumn === undefined) {
            throw invalidInput('ENVI classification column mapping is invalid')
          }
          const value = tile.data[sourceColumn] ?? Number.NaN
          if (!Number.isSafeInteger(value) || value < 0 || value >= classes.length) {
            throw invalidInput(`ENVI classification sample ${value} has no declared class`)
          }
          const entry = classes[value]
          if (entry === undefined)
            throw invalidInput(`ENVI classification class ${value} is missing`)
          const target = outputX * 3
          output[target] = entry.color.red
          output[target + 1] = entry.color.green
          output[target + 2] = entry.color.blue
        }
        yield {
          x: 0,
          y: outputY,
          width: render.outputWidth,
          height: 1,
          stride: render.outputWidth * 3,
          format: 'rgb8',
          data: output,
        }
      } finally {
        tile.release()
      }
    }
    if (!emitted) throw invalidInput('ENVI classification reader emitted an incomplete source row')
  }
}

/**
 * Renders an ENVI Classification dataset with its declared RGB lookup table.
 * Nearest-neighbor sampling preserves categorical values, reads at most one
 * source row at a time, and never creates a source-sized display bitmap.
 */
export const renderEnviClassification = (
  dataset: EnviDataset,
  options: Readonly<EnviClassificationRenderOptions>,
): EnviClassificationRenderedImage => {
  if (dataset.fileType !== 'ENVI Classification' || dataset.classes === undefined) {
    throw invalidInput('renderEnviClassification requires an ENVI Classification dataset')
  }
  const render = resolveRender(dataset, options)
  return Object.freeze({
    width: render.outputWidth,
    height: render.outputHeight,
    sourceRegion: Object.freeze({
      x: render.sourceX,
      y: render.sourceY,
      width: render.sourceWidth,
      height: render.sourceHeight,
    }),
    pixels: classificationRows(dataset, render),
  })
}
