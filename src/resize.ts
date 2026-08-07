import { invalidInput, truncatedInput } from './errors.ts'
import type { ResizeKernel, ResizeOptions } from './pipeline.ts'
import { calculateResizeDimensions } from './pipeline.ts'
import type { PixelBlock, PixelFormat } from './pixel.ts'

interface AxisCoefficients {
  readonly offsets: Uint32Array
  readonly indices: Uint32Array
  readonly weights: Float64Array
}

interface ResizePlan {
  readonly canvasWidth: number
  readonly canvasHeight: number
  readonly scaledWidth: number
  readonly scaledHeight: number
  readonly cropX: number
  readonly cropY: number
  readonly contentWidth: number
  readonly contentHeight: number
  readonly padX: number
  readonly padY: number
  readonly background: readonly [number, number, number, number] | undefined
  readonly kernel: ResizeKernel
}

export interface ResizeTransform {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  apply(blocks: AsyncIterable<PixelBlock>): AsyncIterable<PixelBlock>
}

const outputBlockRows = 32
const coefficientCache = new Map<string, AxisCoefficients>()
const maximumCachedAxes = 16

const channels = (format: PixelFormat): number => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  throw invalidInput(`Resize does not support ${format} pixels`)
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value))

const byte = (value: number): number => clamp(Math.round(value), 0, 255)

const sinc = (value: number): number => {
  if (Math.abs(value) < 1e-12) return 1
  const radians = Math.PI * value
  return Math.sin(radians) / radians
}

const lanczos = (distance: number, scale: number): number => {
  const value = distance * scale
  return Math.abs(value) < 3 ? sinc(value) * sinc(value / 3) * scale : 0
}

const appendSample = (
  sampleIndices: number[],
  sampleWeights: number[],
  sampleStart: number,
  index: number,
  weight: number,
): void => {
  const last = sampleIndices.length - 1
  if (last >= sampleStart && sampleIndices[last] === index) {
    sampleWeights[last] = (sampleWeights[last] ?? 0) + weight
  } else {
    sampleIndices.push(index)
    sampleWeights.push(weight)
  }
}

const calculateAxis = (
  sourceSize: number,
  scaledSize: number,
  outputStart: number,
  outputSize: number,
  kernel: ResizeKernel,
): AxisCoefficients => {
  const offsets = new Uint32Array(outputSize + 1)
  const sampleIndices: number[] = []
  const sampleWeights: number[] = []

  for (let output = 0; output < outputSize; output += 1) {
    const scaledCoordinate = outputStart + output
    const center = ((scaledCoordinate + 0.5) * sourceSize) / scaledSize - 0.5
    offsets[output] = sampleIndices.length

    if (kernel === 'nearest') {
      sampleIndices.push(clamp(Math.floor(center + 0.5), 0, sourceSize - 1))
      sampleWeights.push(1)
      continue
    }

    if (kernel === 'bilinear') {
      const lower = Math.floor(center)
      const fraction = center - lower
      const sampleStart = sampleIndices.length
      appendSample(
        sampleIndices,
        sampleWeights,
        sampleStart,
        clamp(lower, 0, sourceSize - 1),
        1 - fraction,
      )
      appendSample(
        sampleIndices,
        sampleWeights,
        sampleStart,
        clamp(lower + 1, 0, sourceSize - 1),
        fraction,
      )
      continue
    }

    const filterScale = Math.min(1, scaledSize / sourceSize)
    const support = 3 / filterScale
    const first = Math.ceil(center - support)
    const last = Math.floor(center + support)
    const weightStart = sampleWeights.length
    let total = 0
    for (let source = first; source <= last; source += 1) {
      const weight = lanczos(center - source, filterScale)
      if (Math.abs(weight) < 1e-12) continue
      appendSample(
        sampleIndices,
        sampleWeights,
        weightStart,
        clamp(source, 0, sourceSize - 1),
        weight,
      )
      total += weight
    }
    if (Math.abs(total) < 1e-12) {
      sampleIndices.push(clamp(Math.floor(center + 0.5), 0, sourceSize - 1))
      sampleWeights.push(1)
    } else {
      for (let index = weightStart; index < sampleWeights.length; index += 1) {
        sampleWeights[index] = (sampleWeights[index] ?? 0) / total
      }
    }
  }
  offsets[outputSize] = sampleIndices.length
  return {
    offsets,
    indices: Uint32Array.from(sampleIndices),
    weights: Float64Array.from(sampleWeights),
  }
}

const coefficients = (
  sourceSize: number,
  scaledSize: number,
  outputStart: number,
  outputSize: number,
  kernel: ResizeKernel,
): AxisCoefficients => {
  const key = `${sourceSize}:${scaledSize}:${outputStart}:${outputSize}:${kernel}`
  const cached = coefficientCache.get(key)
  if (cached) return cached
  const created = calculateAxis(sourceSize, scaledSize, outputStart, outputSize, kernel)
  coefficientCache.set(key, created)
  if (coefficientCache.size > maximumCachedAxes) {
    const oldest = coefficientCache.keys().next().value
    if (oldest !== undefined) coefficientCache.delete(oldest)
  }
  return created
}

const parseBackground = (
  background: ResizeOptions['background'],
): readonly [number, number, number, number] => {
  if (background === undefined || background === 'transparent') return [0, 0, 0, 0]
  const red = Number.parseInt(background.slice(1, 3), 16)
  const green = Number.parseInt(background.slice(3, 5), 16)
  const blue = Number.parseInt(background.slice(5, 7), 16)
  const alpha = background.length === 9 ? Number.parseInt(background.slice(7, 9), 16) : 255
  return [red, green, blue, alpha]
}

const resizePlan = (width: number, height: number, options: ResizeOptions): ResizePlan => {
  const output = calculateResizeDimensions(width, height, options)
  const fit =
    options.width !== undefined && options.height !== undefined
      ? (options.fit ?? 'cover')
      : undefined
  const kernel = options.kernel ?? 'bilinear'

  if (fit === 'contain') {
    const requestedWidth = options.width ?? output.width
    const requestedHeight = options.height ?? output.height
    const scale = Math.min(requestedWidth / width, requestedHeight / height)
    const boundedScale = options.withoutEnlargement ? Math.min(1, scale) : scale
    const scaledWidth = Math.max(1, Math.round(width * boundedScale))
    const scaledHeight = Math.max(1, Math.round(height * boundedScale))
    return {
      canvasWidth: requestedWidth,
      canvasHeight: requestedHeight,
      scaledWidth,
      scaledHeight,
      cropX: 0,
      cropY: 0,
      contentWidth: scaledWidth,
      contentHeight: scaledHeight,
      padX: Math.floor((requestedWidth - scaledWidth) / 2),
      padY: Math.floor((requestedHeight - scaledHeight) / 2),
      background: parseBackground(options.background),
      kernel,
    }
  }

  if (fit === 'cover') {
    const requestedWidth = options.width ?? output.width
    const requestedHeight = options.height ?? output.height
    const scale = Math.max(requestedWidth / width, requestedHeight / height)
    const scaledWidth = Math.max(requestedWidth, Math.round(width * scale))
    const scaledHeight = Math.max(requestedHeight, Math.round(height * scale))
    return {
      canvasWidth: requestedWidth,
      canvasHeight: requestedHeight,
      scaledWidth,
      scaledHeight,
      cropX: Math.floor((scaledWidth - requestedWidth) / 2),
      cropY: Math.floor((scaledHeight - requestedHeight) / 2),
      contentWidth: requestedWidth,
      contentHeight: requestedHeight,
      padX: 0,
      padY: 0,
      background: undefined,
      kernel,
    }
  }

  return {
    canvasWidth: output.width,
    canvasHeight: output.height,
    scaledWidth: output.width,
    scaledHeight: output.height,
    cropX: 0,
    cropY: 0,
    contentWidth: output.width,
    contentHeight: output.height,
    padX: 0,
    padY: 0,
    background: undefined,
    kernel,
  }
}

const resultFormat = (
  sourceFormat: PixelFormat,
  background: ResizePlan['background'],
): PixelFormat => {
  if (background === undefined) return sourceFormat
  if (sourceFormat === 'rgba8' || background[3] < 255) return 'rgba8'
  return 'rgb8'
}

const rows = async function* (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
  format: PixelFormat,
): AsyncGenerator<Uint8Array> {
  const rowBytes = width * channels(format)
  let expectedY = 0
  for await (const block of blocks) {
    try {
      if (
        block.x !== 0 ||
        block.y !== expectedY ||
        block.width !== width ||
        block.height < 1 ||
        block.format !== format ||
        block.stride < rowBytes ||
        block.data.byteLength < block.stride * (block.height - 1) + rowBytes
      ) {
        throw invalidInput('Resize requires ordered, full-width pixel blocks')
      }
      for (let row = 0; row < block.height; row += 1) {
        yield block.data.subarray(row * block.stride, row * block.stride + rowBytes)
        expectedY += 1
      }
    } finally {
      block.release?.()
    }
  }
  if (expectedY !== height) throw truncatedInput(`Resize received ${expectedY} of ${height} rows`)
}

const horizontalRow = (
  source: Uint8Array,
  sourceFormat: PixelFormat,
  outputWidth: number,
  axis: AxisCoefficients,
  output: Float32Array,
): void => {
  const channelCount = channels(sourceFormat)
  output.fill(0)
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    for (let sampleIndex = first; sampleIndex < last; sampleIndex += 1) {
      const sourceX = axis.indices[sampleIndex] ?? 0
      const weight = axis.weights[sampleIndex] ?? 0
      const sourceOffset = sourceX * channelCount
      const outputOffset = x * channelCount
      if (sourceFormat === 'rgba8') {
        const alpha = source[sourceOffset + 3] ?? 0
        const alphaScale = alpha / 255
        output[outputOffset] =
          (output[outputOffset] ?? 0) + (source[sourceOffset] ?? 0) * alphaScale * weight
        output[outputOffset + 1] =
          (output[outputOffset + 1] ?? 0) + (source[sourceOffset + 1] ?? 0) * alphaScale * weight
        output[outputOffset + 2] =
          (output[outputOffset + 2] ?? 0) + (source[sourceOffset + 2] ?? 0) * alphaScale * weight
        output[outputOffset + 3] = (output[outputOffset + 3] ?? 0) + alpha * weight
      } else {
        for (let channel = 0; channel < channelCount; channel += 1) {
          output[outputOffset + channel] =
            (output[outputOffset + channel] ?? 0) + (source[sourceOffset + channel] ?? 0) * weight
        }
      }
    }
  }
}

const fillBackground = (
  output: Uint8Array,
  offset: number,
  width: number,
  format: PixelFormat,
  background: readonly [number, number, number, number],
): void => {
  const outputChannels = channels(format)
  for (let x = 0; x < width; x += 1) {
    const pixel = offset + x * outputChannels
    output[pixel] = background[0]
    output[pixel + 1] = background[1]
    output[pixel + 2] = background[2]
    if (outputChannels === 4) output[pixel + 3] = background[3]
  }
}

const writeContent = (
  source: Float32Array,
  sourceFormat: PixelFormat,
  output: Uint8Array,
  outputOffset: number,
  width: number,
  outputFormat: PixelFormat,
): void => {
  const sourceChannels = channels(sourceFormat)
  const outputChannels = channels(outputFormat)
  for (let x = 0; x < width; x += 1) {
    const sourceOffset = x * sourceChannels
    const target = outputOffset + x * outputChannels
    if (sourceFormat === 'gray8') {
      const gray = byte(source[sourceOffset] ?? 0)
      output[target] = gray
      if (outputChannels > 1) {
        output[target + 1] = gray
        output[target + 2] = gray
        if (outputChannels === 4) output[target + 3] = 255
      }
    } else if (sourceFormat === 'rgb8') {
      output[target] = byte(source[sourceOffset] ?? 0)
      output[target + 1] = byte(source[sourceOffset + 1] ?? 0)
      output[target + 2] = byte(source[sourceOffset + 2] ?? 0)
      if (outputChannels === 4) output[target + 3] = 255
    } else {
      const alphaValue = clamp(source[sourceOffset + 3] ?? 0, 0, 255)
      const alpha = Math.round(alphaValue)
      const unpremultiply = alphaValue > 0 ? 255 / alphaValue : 0
      output[target] = byte((source[sourceOffset] ?? 0) * unpremultiply)
      output[target + 1] = byte((source[sourceOffset + 1] ?? 0) * unpremultiply)
      output[target + 2] = byte((source[sourceOffset + 2] ?? 0) * unpremultiply)
      output[target + 3] = alpha
    }
  }
}

const resizedBlocks = async function* (
  input: AsyncIterable<PixelBlock>,
  sourceWidth: number,
  sourceHeight: number,
  sourceFormat: PixelFormat,
  plan: ResizePlan,
  outputFormat: PixelFormat,
): AsyncGenerator<PixelBlock> {
  const horizontal = coefficients(
    sourceWidth,
    plan.scaledWidth,
    plan.cropX,
    plan.contentWidth,
    plan.kernel,
  )
  const vertical = coefficients(
    sourceHeight,
    plan.scaledHeight,
    plan.cropY,
    plan.contentHeight,
    plan.kernel,
  )
  const sourceRows = rows(input, sourceWidth, sourceHeight, sourceFormat)[Symbol.asyncIterator]()
  const retained = new Map<number, Float32Array>()
  const sourceChannels = channels(sourceFormat)
  const requiredSourceRows = new Uint8Array(sourceHeight)
  for (const sourceRow of vertical.indices) requiredSourceRows[sourceRow] = 1
  const recycledRows: Float32Array[] = []
  const outputChannels = channels(outputFormat)
  const outputStride = plan.canvasWidth * outputChannels
  const blockCapacity = Math.min(outputBlockRows, plan.canvasHeight)
  let block = new Uint8Array(outputStride * blockCapacity)
  const accumulated = new Float32Array(plan.contentWidth * sourceChannels)
  let loadedRows = 0
  let blockHeight = 0
  let blockY = 0

  try {
    for (let canvasY = 0; canvasY < plan.canvasHeight; canvasY += 1) {
      const blockOffset = blockHeight * outputStride
      if (plan.background) {
        fillBackground(block, blockOffset, plan.canvasWidth, outputFormat, plan.background)
      }
      const contentY = canvasY - plan.padY
      if (contentY >= 0 && contentY < plan.contentHeight) {
        const first = vertical.offsets[contentY] ?? 0
        const last = vertical.offsets[contentY + 1] ?? first
        const maximumSourceRow = vertical.indices[last - 1]
        if (maximumSourceRow === undefined)
          throw invalidInput('Resize vertical coefficients are empty')
        while (loadedRows <= maximumSourceRow) {
          const next = await sourceRows.next()
          if (next.done) throw truncatedInput(`Resize input ended before row ${loadedRows}`)
          if (requiredSourceRows[loadedRows] !== 0) {
            const resizedRow =
              recycledRows.pop() ?? new Float32Array(plan.contentWidth * sourceChannels)
            horizontalRow(next.value, sourceFormat, plan.contentWidth, horizontal, resizedRow)
            retained.set(loadedRows, resizedRow)
          }
          loadedRows += 1
        }

        accumulated.fill(0)
        for (let sampleIndex = first; sampleIndex < last; sampleIndex += 1) {
          const sourceY = vertical.indices[sampleIndex]
          const weight = vertical.weights[sampleIndex]
          const row = sourceY === undefined ? undefined : retained.get(sourceY)
          if (!row || weight === undefined) throw invalidInput('Resize source row is unavailable')
          for (let index = 0; index < accumulated.length; index += 1) {
            accumulated[index] = (accumulated[index] ?? 0) + (row[index] ?? 0) * weight
          }
        }
        writeContent(
          accumulated,
          sourceFormat,
          block,
          blockOffset + plan.padX * outputChannels,
          plan.contentWidth,
          outputFormat,
        )

        const nextFirst = vertical.offsets[contentY + 1] ?? last
        const nextMinimum = vertical.indices[nextFirst]
        if (nextMinimum !== undefined) {
          for (const row of retained.keys()) {
            if (row < nextMinimum) {
              const resizedRow = retained.get(row)
              retained.delete(row)
              if (resizedRow) recycledRows.push(resizedRow)
            }
          }
        }
      }

      blockHeight += 1
      if (blockHeight === blockCapacity) {
        yield {
          x: 0,
          y: blockY,
          width: plan.canvasWidth,
          height: blockHeight,
          stride: outputStride,
          format: outputFormat,
          data: block,
        }
        blockY += blockHeight
        blockHeight = 0
        const remaining = plan.canvasHeight - blockY
        if (remaining > 0) block = new Uint8Array(outputStride * Math.min(blockCapacity, remaining))
      }
    }

    while (!(await sourceRows.next()).done) {
      // Drain the decoder so compressed input and checksums are fully validated.
    }

    if (blockHeight > 0) {
      yield {
        x: 0,
        y: blockY,
        width: plan.canvasWidth,
        height: blockHeight,
        stride: outputStride,
        format: outputFormat,
        data: block.subarray(0, outputStride * blockHeight),
      }
    }
  } finally {
    await sourceRows.return?.(undefined)
  }
}

export const createResizeTransform = (
  width: number,
  height: number,
  pixelFormat: PixelFormat,
  options: ResizeOptions,
): ResizeTransform => {
  channels(pixelFormat)
  const plan = resizePlan(width, height, options)
  const format = resultFormat(pixelFormat, plan.background)
  return {
    width: plan.canvasWidth,
    height: plan.canvasHeight,
    pixelFormat: format,
    apply(blocks: AsyncIterable<PixelBlock>): AsyncIterable<PixelBlock> {
      return resizedBlocks(blocks, width, height, pixelFormat, plan, format)
    },
  }
}
