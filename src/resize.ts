import type { ImageResizeAccelerator } from './accelerator.ts'
import type { PixelColorSemantics } from './color.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from './errors.ts'
import type { ResizeKernel, ResizeOptions } from './pipeline.ts'
import { calculateResizeDimensions } from './pipeline.ts'
import { type PixelBlock, type PixelFormat, pixelBytesPerPixel, pixelStorage } from './pixel.ts'

/** Samples for output x occupy [offsets[x], offsets[x + 1]) in both tables. */
interface AxisCoefficients {
  readonly offsets: Uint32Array
  readonly indices: Uint32Array
  readonly weights: Float64Array
}

export interface ResizeFilterRequest {
  readonly sourceWidth: number
  readonly format: 'rgb8' | 'rgba8'
  readonly outputChannels: 3 | 4
  /** Decoder guarantees alpha 255 and the reference uses a three-channel ring. */
  readonly opaque: boolean
  readonly horizontal: AxisCoefficients
  readonly capacity: number
}

export interface ResizeFilterSession {
  /** Return scratch to the accelerator after the last output row or early cancellation. */
  release?(): void
  /** One Float32 row per slot. Source row y uses slot y % capacity. Completed rows
   * remain readable after failure so the reference can finish without replaying input. */
  readonly rows: readonly Float32Array[]
  /** Write every filtered channel, including zeroes in transparent spans. */
  horizontal(source: Uint8Array, slot: number): void
  vertical(
    axis: AxisCoefficients,
    first: number,
    last: number,
    output: Uint8Array,
    offset: number,
  ): void
}

export interface ResizeBoxSession {
  release?(): void
  /** Last committed group prefix. A failed add must leave these sums intact for recovery. */
  readonly sums: Float64Array
  add(source: Uint8Array, first: boolean): void
  write(rows: number, output: Uint8Array, offset: number): void
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

// At this range binary64 addition by one half preserves every byte boundary.
const byte = (value: number): number => (value < 0.5 ? 0 : value >= 254.5 ? 255 : (value + 0.5) | 0)

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
  const kernel = options.kernel ?? 'lanczos3'

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
  if (sourceFormat === 'gray16' || sourceFormat === 'rgb16' || sourceFormat === 'rgba16') {
    if (sourceFormat === 'rgba16' || background[3] < 255) return 'rgba16'
    return 'rgb16'
  }
  if (sourceFormat === 'grayf32' || sourceFormat === 'rgbf32' || sourceFormat === 'rgbaf32') {
    throw invalidInput('Float32 contain resize requires an explicit pixel conversion for padding')
  }
  if (sourceFormat === 'rgba8' || background[3] < 255) return 'rgba8'
  return 'rgb8'
}

const nativeResizeFormat = (format: PixelFormat): boolean =>
  format === 'gray16' ||
  format === 'rgb16' ||
  format === 'rgba16' ||
  format === 'grayf32' ||
  format === 'rgbf32' ||
  format === 'rgbaf32'

export const decodeSrgbSample = (encoded: number): number =>
  encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4

export const encodeSrgbSample = (linear: number): number =>
  linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055

const srgb8ToLinear = Float64Array.from({ length: 256 }, (_value, index) =>
  decodeSrgbSample(index / 255),
)

const linearLightFormat = (format: PixelFormat): boolean =>
  format === 'rgb8' || format === 'rgba8' || format === 'rgb16' || format === 'rgba16'

const validateLinearLightSemantics = (
  format: PixelFormat,
  semantics: PixelColorSemantics | undefined,
): 'srgb' | 'linear' => {
  if (!linearLightFormat(format)) {
    throw unsupportedOperation(`Linear-light resize does not support ${format} pixels`)
  }
  if (
    semantics?.family !== 'rgb' ||
    (semantics.transfer.kind !== 'srgb' && semantics.transfer.kind !== 'linear')
  ) {
    throw unsupportedOperation(
      'Linear-light resize requires RGB pixels with known sRGB or linear transfer semantics',
    )
  }
  if (format.startsWith('rgba') && semantics.alpha !== 'straight') {
    throw unsupportedOperation('Linear-light RGBA resize requires straight alpha semantics')
  }
  return semantics.transfer.kind
}

const horizontalLinearLight = (
  source: Uint8Array,
  outputWidth: number,
  axis: AxisCoefficients,
  output: Float64Array,
  format: PixelFormat,
  transfer: 'srgb' | 'linear',
  samples: ResizeSamples,
): void => {
  const descriptor = pixelStorage(format)
  const maximum = samples.colorMaximum
  const hasAlpha = descriptor.channels === 4
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let red = 0
    let green = 0
    let blue = 0
    let alpha = 0
    for (let index = first; index < last; index += 1) {
      const sourceOffset =
        (axis.indices[index] ?? 0) * descriptor.channels * descriptor.bytesPerSample
      const weight = axis.weights[index] ?? 0
      const redSample =
        descriptor.bytesPerSample === 1
          ? (source[sourceOffset] ?? 0)
          : uint16Sample(source, sourceOffset)
      const greenSample =
        descriptor.bytesPerSample === 1
          ? (source[sourceOffset + 1] ?? 0)
          : uint16Sample(source, sourceOffset + 2)
      const blueSample =
        descriptor.bytesPerSample === 1
          ? (source[sourceOffset + 2] ?? 0)
          : uint16Sample(source, sourceOffset + 4)
      const alphaSample = hasAlpha
        ? descriptor.bytesPerSample === 1
          ? (source[sourceOffset + 3] ?? 0)
          : uint16Sample(source, sourceOffset + 6)
        : samples.alphaMaximum
      const sourceAlpha = alphaSample / samples.alphaMaximum
      const linearRed =
        transfer === 'linear'
          ? redSample / maximum
          : maximum === 255
            ? (srgb8ToLinear[redSample] ?? 0)
            : decodeSrgbSample(redSample / maximum)
      const linearGreen =
        transfer === 'linear'
          ? greenSample / maximum
          : maximum === 255
            ? (srgb8ToLinear[greenSample] ?? 0)
            : decodeSrgbSample(greenSample / maximum)
      const linearBlue =
        transfer === 'linear'
          ? blueSample / maximum
          : maximum === 255
            ? (srgb8ToLinear[blueSample] ?? 0)
            : decodeSrgbSample(blueSample / maximum)
      red += linearRed * sourceAlpha * weight
      green += linearGreen * sourceAlpha * weight
      blue += linearBlue * sourceAlpha * weight
      alpha += sourceAlpha * weight
    }
    const target = x * descriptor.channels
    output[target] = red
    output[target + 1] = green
    output[target + 2] = blue
    if (hasAlpha) output[target + 3] = alpha
  }
}

const writeLinearLightContent = (
  source: Float64Array,
  sourceFormat: PixelFormat,
  output: Uint8Array,
  outputOffset: number,
  width: number,
  outputFormat: PixelFormat,
  transfer: 'srgb' | 'linear',
  samples: ResizeSamples,
): void => {
  const sourceDescriptor = pixelStorage(sourceFormat)
  const outputDescriptor = pixelStorage(outputFormat)
  const maximum = samples.colorMaximum
  const outputSample = (target: number, linear: number): void => {
    const encoded = transfer === 'linear' ? linear : encodeSrgbSample(Math.max(0, linear))
    if (outputDescriptor.bytesPerSample === 1)
      output[target] = clamp(Math.round(encoded * maximum), 0, maximum)
    else writeUint16(output, target, clamp(encoded * maximum, 0, maximum))
  }
  for (let x = 0; x < width; x += 1) {
    const sourceOffset = x * sourceDescriptor.channels
    const target = outputOffset + x * outputDescriptor.channels * outputDescriptor.bytesPerSample
    const alpha = sourceDescriptor.channels === 4 ? clamp(source[sourceOffset + 3] ?? 0, 0, 1) : 1
    const unpremultiply = alpha > 0 ? 1 / alpha : 0
    outputSample(target, (source[sourceOffset] ?? 0) * unpremultiply)
    outputSample(
      target + outputDescriptor.bytesPerSample,
      (source[sourceOffset + 1] ?? 0) * unpremultiply,
    )
    outputSample(
      target + outputDescriptor.bytesPerSample * 2,
      (source[sourceOffset + 2] ?? 0) * unpremultiply,
    )
    if (outputDescriptor.channels === 4) {
      const alphaTarget = target + outputDescriptor.bytesPerSample * 3
      if (outputDescriptor.bytesPerSample === 1)
        output[alphaTarget] = Math.round(alpha * samples.alphaMaximum)
      else writeUint16(output, alphaTarget, alpha * samples.alphaMaximum)
    }
  }
}

const resizedLinearLightBlocks = async function* (
  input: AsyncIterable<PixelBlock>,
  sourceWidth: number,
  sourceHeight: number,
  sourceFormat: PixelFormat,
  plan: ResizePlan,
  outputFormat: PixelFormat,
  transfer: 'srgb' | 'linear',
  sampleBitDepths?: readonly number[],
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
  const samples = resizeSamples(sourceFormat, sampleBitDepths)
  const sourceRows = nativeRows(input, sourceWidth, sourceHeight, sourceFormat, samples)[
    Symbol.asyncIterator
  ]()
  const sourceChannels = pixelStorage(sourceFormat).channels
  const requiredSourceRows = new Uint8Array(sourceHeight)
  for (const sourceRow of vertical.indices) requiredSourceRows[sourceRow] = 1
  const ringCapacity = verticalRingCapacity(vertical, plan.contentHeight)
  const retainedSourceRows = new Int32Array(ringCapacity)
  retainedSourceRows.fill(-1)
  const retainedRows: (Float64Array | undefined)[] = new Array(ringCapacity)
  const outputBytesPerPixel = pixelBytesPerPixel(outputFormat)
  const outputStride = plan.canvasWidth * outputBytesPerPixel
  const blockCapacity = Math.min(outputBlockRows, plan.canvasHeight)
  let block = new Uint8Array(outputStride * blockCapacity)
  const accumulated = new Float64Array(plan.contentWidth * sourceChannels)
  let loadedRows = 0
  let blockHeight = 0
  let blockY = 0
  try {
    let pending: IteratorResult<Uint8Array> | undefined = await sourceRows.next()
    for (let canvasY = 0; canvasY < plan.canvasHeight; canvasY += 1) {
      const blockOffset = blockHeight * outputStride
      if (plan.background) {
        if (outputFormat.endsWith('16')) {
          fillNativeBackground(
            block,
            blockOffset,
            plan.canvasWidth,
            outputFormat,
            plan.background,
            samples,
          )
        } else {
          fillBackground(block, blockOffset, plan.canvasWidth, outputFormat, plan.background)
        }
      }
      const contentY = canvasY - plan.padY
      if (contentY >= 0 && contentY < plan.contentHeight) {
        const first = vertical.offsets[contentY] ?? 0
        const last = vertical.offsets[contentY + 1] ?? first
        const maximumSourceRow = vertical.indices[last - 1]
        if (maximumSourceRow === undefined)
          throw invalidInput('Resize vertical coefficients are empty')
        while (loadedRows <= maximumSourceRow) {
          const next = pending ?? (await sourceRows.next())
          pending = undefined
          if (next.done) throw truncatedInput(`Resize input ended before row ${loadedRows}`)
          if (requiredSourceRows[loadedRows] !== 0) {
            const slot = loadedRows % ringCapacity
            const row = retainedRows[slot] ?? new Float64Array(accumulated.length)
            horizontalLinearLight(
              next.value,
              plan.contentWidth,
              horizontal,
              row,
              sourceFormat,
              transfer,
              samples,
            )
            retainedRows[slot] = row
            retainedSourceRows[slot] = loadedRows
          }
          loadedRows += 1
        }
        accumulated.fill(0)
        for (let sampleIndex = first; sampleIndex < last; sampleIndex += 1) {
          const sourceY = vertical.indices[sampleIndex]
          const weight = vertical.weights[sampleIndex]
          const slot = sourceY === undefined ? -1 : sourceY % ringCapacity
          const row =
            slot >= 0 && retainedSourceRows[slot] === sourceY ? retainedRows[slot] : undefined
          if (!row || weight === undefined) throw invalidInput('Resize source row is unavailable')
          for (let index = 0; index < accumulated.length; index += 1) {
            accumulated[index] = (accumulated[index] ?? 0) + (row[index] ?? 0) * weight
          }
        }
        writeLinearLightContent(
          accumulated,
          sourceFormat,
          block,
          blockOffset + plan.padX * outputBytesPerPixel,
          plan.contentWidth,
          outputFormat,
          transfer,
          samples,
        )
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
          ...resizeOutputMetadata(samples, outputFormat),
          data: block,
        }
        blockY += blockHeight
        blockHeight = 0
        const remaining = plan.canvasHeight - blockY
        if (remaining > 0) block = new Uint8Array(outputStride * Math.min(blockCapacity, remaining))
      }
    }
    while (!(await sourceRows.next()).done) {}
    if (blockHeight > 0) {
      yield {
        x: 0,
        y: blockY,
        width: plan.canvasWidth,
        height: blockHeight,
        stride: outputStride,
        format: outputFormat,
        ...resizeOutputMetadata(samples, outputFormat),
        data: block.subarray(0, outputStride * blockHeight),
      }
    }
  } finally {
    await sourceRows.return?.(undefined)
  }
}

type NativeHorizontalKernel = (
  source: Uint8Array,
  outputWidth: number,
  axis: AxisCoefficients,
  output: Float64Array,
) => void

const uint16Sample = (source: Uint8Array, offset: number): number =>
  (source[offset] ?? 0) * 256 + (source[offset + 1] ?? 0)

const horizontalGray16: NativeHorizontalKernel = (source, outputWidth, axis, output): void => {
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let gray = 0
    for (let index = first; index < last; index += 1) {
      gray += uint16Sample(source, (axis.indices[index] ?? 0) * 2) * (axis.weights[index] ?? 0)
    }
    output[x] = gray
  }
}

const horizontalRgb16: NativeHorizontalKernel = (source, outputWidth, axis, output): void => {
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let red = 0
    let green = 0
    let blue = 0
    for (let index = first; index < last; index += 1) {
      const offset = (axis.indices[index] ?? 0) * 6
      const weight = axis.weights[index] ?? 0
      red += uint16Sample(source, offset) * weight
      green += uint16Sample(source, offset + 2) * weight
      blue += uint16Sample(source, offset + 4) * weight
    }
    const target = x * 3
    output[target] = red
    output[target + 1] = green
    output[target + 2] = blue
  }
}

const horizontalRgba16: NativeHorizontalKernel = (source, outputWidth, axis, output): void => {
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let red = 0
    let green = 0
    let blue = 0
    let alpha = 0
    for (let index = first; index < last; index += 1) {
      const offset = (axis.indices[index] ?? 0) * 8
      const weight = axis.weights[index] ?? 0
      const sourceAlpha = uint16Sample(source, offset + 6)
      const premultiply = sourceAlpha / 65_535
      red += uint16Sample(source, offset) * premultiply * weight
      green += uint16Sample(source, offset + 2) * premultiply * weight
      blue += uint16Sample(source, offset + 4) * premultiply * weight
      alpha += sourceAlpha * weight
    }
    const target = x * 4
    output[target] = red
    output[target + 1] = green
    output[target + 2] = blue
    output[target + 3] = alpha
  }
}

const horizontalGrayF32: NativeHorizontalKernel = (source, outputWidth, axis, output): void => {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let gray = 0
    for (let index = first; index < last; index += 1) {
      gray += view.getFloat32((axis.indices[index] ?? 0) * 4, false) * (axis.weights[index] ?? 0)
    }
    output[x] = gray
  }
}

const horizontalRgbF32: NativeHorizontalKernel = (source, outputWidth, axis, output): void => {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let red = 0
    let green = 0
    let blue = 0
    for (let index = first; index < last; index += 1) {
      const offset = (axis.indices[index] ?? 0) * 12
      const weight = axis.weights[index] ?? 0
      red += view.getFloat32(offset, false) * weight
      green += view.getFloat32(offset + 4, false) * weight
      blue += view.getFloat32(offset + 8, false) * weight
    }
    const target = x * 3
    output[target] = red
    output[target + 1] = green
    output[target + 2] = blue
  }
}

const horizontalRgbaF32: NativeHorizontalKernel = (source, outputWidth, axis, output): void => {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength)
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let red = 0,
      green = 0,
      blue = 0,
      alpha = 0
    for (let index = first; index < last; index += 1) {
      const offset = (axis.indices[index] ?? 0) * 16
      const weight = axis.weights[index] ?? 0
      const a = view.getFloat32(offset + 12, false)
      red += view.getFloat32(offset, false) * a * weight
      green += view.getFloat32(offset + 4, false) * a * weight
      blue += view.getFloat32(offset + 8, false) * a * weight
      alpha += a * weight
    }
    output[x * 4] = red
    output[x * 4 + 1] = green
    output[x * 4 + 2] = blue
    output[x * 4 + 3] = alpha
  }
}

const nativeHorizontalKernel = (format: PixelFormat): NativeHorizontalKernel => {
  if (format === 'gray16') return horizontalGray16
  if (format === 'rgb16') return horizontalRgb16
  if (format === 'rgba16') return horizontalRgba16
  if (format === 'grayf32') return horizontalGrayF32
  if (format === 'rgbf32') return horizontalRgbF32
  if (format === 'rgbaf32') return horizontalRgbaF32
  throw invalidInput(`Resize does not support ${format} pixels natively`)
}

export const resizedPixelColorSemantics = (
  semantics: PixelColorSemantics | undefined,
  format: PixelFormat,
): PixelColorSemantics | undefined =>
  semantics === undefined
    ? undefined
    : Object.freeze({
        ...semantics,
        family: format.startsWith('gray') ? 'gray' : 'rgb',
        alpha: format.startsWith('rgba') ? 'straight' : 'none',
      })

const resizeOutputMetadata = (samples: ResizeSamples, format: PixelFormat) => {
  const count = pixelStorage(format).channels
  const ranges = samples.displayRanges
  const colorSemantics = resizedPixelColorSemantics(samples.colorSemantics, format)
  return {
    ...(ranges === undefined
      ? {}
      : {
          displayRanges:
            ranges.length === count
              ? ranges
              : Array.from({ length: count }, (_, c) =>
                  c === 3
                    ? { black: 0, white: samples.alphaMaximum }
                    : (ranges[ranges.length === 1 ? 0 : c] ?? {
                        black: 0,
                        white: samples.colorMaximum,
                      }),
                ),
        }),
    ...(colorSemantics === undefined ? {} : { colorSemantics }),
  }
}

interface ResizeSamples {
  displayRanges?: PixelBlock['displayRanges']
  colorSemantics?: PixelColorSemantics | undefined
  colorMaximum: number
  alphaMaximum: number
}

const resizeSamples = (format: PixelFormat, depths?: readonly number[]): ResizeSamples => ({
  colorMaximum: format.endsWith('f32')
    ? 1
    : 2 ** (depths?.[0] ?? pixelStorage(format).bytesPerSample * 8) - 1,
  alphaMaximum: format.endsWith('f32')
    ? 1
    : 2 ** (depths?.[3] ?? pixelStorage(format).bytesPerSample * 8) - 1,
})

const nativeRows = async function* (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
  format: PixelFormat,
  samples?: ResizeSamples,
): AsyncGenerator<Uint8Array> {
  const rowBytes = width * pixelBytesPerPixel(format)
  let expectedY = 0
  for await (const block of blocks) {
    try {
      if (
        block.x !== 0 ||
        block.y !== expectedY ||
        block.width !== width ||
        block.height < 1 ||
        block.y + block.height > height ||
        block.format !== format ||
        block.stride < rowBytes ||
        block.data.byteLength < block.stride * (block.height - 1) + rowBytes
      ) {
        throw invalidInput('Resize requires ordered, full-width pixel blocks')
      }
      if (samples) {
        samples.displayRanges = block.displayRanges
        samples.colorSemantics = block.colorSemantics
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

const nativeInteger = (value: number): number => clamp(Math.round(value), 0, 65_535)

const writeUint16 = (output: Uint8Array, offset: number, value: number): void => {
  const rounded = nativeInteger(value)
  output[offset] = rounded >>> 8
  output[offset + 1] = rounded & 0xff
}

const fillNativeBackground = (
  output: Uint8Array,
  offset: number,
  width: number,
  format: PixelFormat,
  background: readonly [number, number, number, number],
  samples: ResizeSamples,
): void => {
  const descriptor = pixelStorage(format)
  if (descriptor.bytesPerSample !== 2 || descriptor.sampleType !== 'unsigned-integer') {
    throw invalidInput('Native float resize does not support a background canvas')
  }
  for (let x = 0; x < width; x += 1) {
    const target = offset + x * descriptor.channels * 2
    writeUint16(output, target, (background[0] * samples.colorMaximum) / 255)
    if (descriptor.channels > 1) {
      writeUint16(output, target + 2, (background[1] * samples.colorMaximum) / 255)
      writeUint16(output, target + 4, (background[2] * samples.colorMaximum) / 255)
      if (descriptor.channels === 4)
        writeUint16(output, target + 6, (background[3] * samples.alphaMaximum) / 255)
    }
  }
}

const writeNativeContent = (
  source: Float64Array,
  sourceFormat: PixelFormat,
  output: Uint8Array,
  outputOffset: number,
  width: number,
  outputFormat: PixelFormat,
  samples: ResizeSamples,
): void => {
  const sourceDescriptor = pixelStorage(sourceFormat)
  const outputDescriptor = pixelStorage(outputFormat)
  if (sourceFormat === 'rgbaf32') {
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength)
    for (let x = 0; x < width; x += 1) {
      const alpha = clamp(source[x * 4 + 3] ?? 0, 0, 1)
      const factor = alpha > 0 ? 1 / alpha : 0
      for (let c = 0; c < 3; c += 1)
        view.setFloat32(outputOffset + x * 16 + c * 4, (source[x * 4 + c] ?? 0) * factor, false)
      view.setFloat32(outputOffset + x * 16 + 12, alpha, false)
    }
    return
  }
  if (sourceDescriptor.sampleType === 'floating-point') {
    const view = new DataView(output.buffer, output.byteOffset, output.byteLength)
    for (let index = 0; index < width * sourceDescriptor.channels; index += 1) {
      view.setFloat32(outputOffset + index * 4, source[index] ?? Number.NaN, false)
    }
    return
  }
  const color = (value: number): number => clamp(value, 0, samples.colorMaximum)
  for (let x = 0; x < width; x += 1) {
    const sourceOffset = x * sourceDescriptor.channels
    const target = outputOffset + x * outputDescriptor.channels * 2
    if (sourceFormat === 'gray16') {
      const gray = color(source[sourceOffset] ?? 0)
      writeUint16(output, target, gray)
      if (outputDescriptor.channels > 1) {
        writeUint16(output, target + 2, gray)
        writeUint16(output, target + 4, gray)
        if (outputDescriptor.channels === 4) writeUint16(output, target + 6, 65_535)
      }
    } else if (sourceFormat === 'rgb16') {
      writeUint16(output, target, color(source[sourceOffset] ?? 0))
      writeUint16(output, target + 2, color(source[sourceOffset + 1] ?? 0))
      writeUint16(output, target + 4, color(source[sourceOffset + 2] ?? 0))
      if (outputDescriptor.channels === 4) writeUint16(output, target + 6, 65_535)
    } else {
      const alphaValue = clamp(source[sourceOffset + 3] ?? 0, 0, samples.alphaMaximum)
      const unpremultiply = alphaValue > 0 ? 65_535 / alphaValue : 0
      writeUint16(output, target, color((source[sourceOffset] ?? 0) * unpremultiply))
      writeUint16(output, target + 2, color((source[sourceOffset + 1] ?? 0) * unpremultiply))
      writeUint16(output, target + 4, color((source[sourceOffset + 2] ?? 0) * unpremultiply))
      writeUint16(output, target + 6, alphaValue)
    }
  }
}

const resizedNativeBlocks = async function* (
  input: AsyncIterable<PixelBlock>,
  sourceWidth: number,
  sourceHeight: number,
  sourceFormat: PixelFormat,
  plan: ResizePlan,
  outputFormat: PixelFormat,
  sampleBitDepths?: readonly number[],
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
  const samples = resizeSamples(sourceFormat, sampleBitDepths)
  const sourceRows = nativeRows(input, sourceWidth, sourceHeight, sourceFormat, samples)[
    Symbol.asyncIterator
  ]()
  const sourceChannels = pixelStorage(sourceFormat).channels
  const requiredSourceRows = new Uint8Array(sourceHeight)
  for (const sourceRow of vertical.indices) requiredSourceRows[sourceRow] = 1
  const ringCapacity = verticalRingCapacity(vertical, plan.contentHeight)
  const retainedSourceRows = new Int32Array(ringCapacity)
  retainedSourceRows.fill(-1)
  const retainedRows: (Float64Array | undefined)[] = new Array(ringCapacity)
  const resizeHorizontal = nativeHorizontalKernel(sourceFormat)
  const outputBytesPerPixel = pixelBytesPerPixel(outputFormat)
  const outputStride = plan.canvasWidth * outputBytesPerPixel
  const blockCapacity = Math.min(outputBlockRows, plan.canvasHeight)
  let block = new Uint8Array(outputStride * blockCapacity)
  const accumulated = new Float64Array(plan.contentWidth * sourceChannels)
  let loadedRows = 0
  let blockHeight = 0
  let blockY = 0

  try {
    let pending: IteratorResult<Uint8Array> | undefined = await sourceRows.next()
    for (let canvasY = 0; canvasY < plan.canvasHeight; canvasY += 1) {
      const blockOffset = blockHeight * outputStride
      if (plan.background) {
        fillNativeBackground(
          block,
          blockOffset,
          plan.canvasWidth,
          outputFormat,
          plan.background,
          samples,
        )
      }
      const contentY = canvasY - plan.padY
      if (contentY >= 0 && contentY < plan.contentHeight) {
        const first = vertical.offsets[contentY] ?? 0
        const last = vertical.offsets[contentY + 1] ?? first
        const maximumSourceRow = vertical.indices[last - 1]
        if (maximumSourceRow === undefined)
          throw invalidInput('Resize vertical coefficients are empty')
        while (loadedRows <= maximumSourceRow) {
          const next = pending ?? (await sourceRows.next())
          pending = undefined
          if (next.done) throw truncatedInput(`Resize input ended before row ${loadedRows}`)
          if (requiredSourceRows[loadedRows] !== 0) {
            const slot = loadedRows % ringCapacity
            const resizedRow = retainedRows[slot] ?? new Float64Array(accumulated.length)
            resizeHorizontal(next.value, plan.contentWidth, horizontal, resizedRow)
            retainedRows[slot] = resizedRow
            retainedSourceRows[slot] = loadedRows
          }
          loadedRows += 1
        }
        accumulated.fill(0)
        for (let sampleIndex = first; sampleIndex < last; sampleIndex += 1) {
          const sourceY = vertical.indices[sampleIndex]
          const weight = vertical.weights[sampleIndex]
          const slot = sourceY === undefined ? -1 : sourceY % ringCapacity
          const row =
            slot >= 0 && retainedSourceRows[slot] === sourceY ? retainedRows[slot] : undefined
          if (!row || weight === undefined) throw invalidInput('Resize source row is unavailable')
          for (let index = 0; index < accumulated.length; index += 1) {
            accumulated[index] = (accumulated[index] ?? 0) + (row[index] ?? 0) * weight
          }
        }
        writeNativeContent(
          accumulated,
          sourceFormat,
          block,
          blockOffset + plan.padX * outputBytesPerPixel,
          plan.contentWidth,
          outputFormat,
          samples,
        )
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
          ...resizeOutputMetadata(samples, outputFormat),
          data: block,
        }
        blockY += blockHeight
        blockHeight = 0
        const remaining = plan.canvasHeight - blockY
        if (remaining > 0) block = new Uint8Array(outputStride * Math.min(blockCapacity, remaining))
      }
    }
    while (!(await sourceRows.next()).done) {}
    if (blockHeight > 0) {
      yield {
        x: 0,
        y: blockY,
        width: plan.canvasWidth,
        height: blockHeight,
        stride: outputStride,
        format: outputFormat,
        ...resizeOutputMetadata(samples, outputFormat),
        data: block.subarray(0, outputStride * blockHeight),
      }
    }
  } finally {
    await sourceRows.return?.(undefined)
  }
}

const rows = async function* (
  blocks: AsyncIterable<PixelBlock>,
  width: number,
  height: number,
  format: PixelFormat,
  cache?: RgbaRowCache,
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
      // Input views are valid only while the decoder lends us this block.
      if (cache) cache.source = undefined
      block.release?.()
    }
  }
  if (expectedY !== height) throw truncatedInput(`Resize received ${expectedY} of ${height} rows`)
}
const boxShrinkFactor = (sourceSize: number, scaledSize: number, kernel: ResizeKernel): number => {
  if (kernel !== 'lanczos3' || scaledSize >= sourceSize) return 1
  const ratio = sourceSize / scaledSize
  let factor = 1
  while (factor * 2 <= ratio && sourceSize % (factor * 2) === 0) factor *= 2
  return factor
}

// Specialized monomorphic kernel for the common rgb8 factor-4 box shrink.
// The box factor always divides the source width, so every output pixel
// reads exactly twelve bytes. Integer sums are exact and match the generic
// Float64 accumulation byte for byte; the caller guards factorY so
// 255 * 4 * factorY stays inside Uint32 range.
const accumulateBoxRowRgb8x4 = (
  source: Uint8Array,
  outputWidth: number,
  sums: Uint32Array,
): void => {
  let sourceOffset = 0
  for (let outputX = 0; outputX < outputWidth; outputX += 1) {
    const target = outputX * 3
    sums[target] =
      (sums[target] ?? 0) +
      (source[sourceOffset] ?? 0) +
      (source[sourceOffset + 3] ?? 0) +
      (source[sourceOffset + 6] ?? 0) +
      (source[sourceOffset + 9] ?? 0)
    sums[target + 1] =
      (sums[target + 1] ?? 0) +
      (source[sourceOffset + 1] ?? 0) +
      (source[sourceOffset + 4] ?? 0) +
      (source[sourceOffset + 7] ?? 0) +
      (source[sourceOffset + 10] ?? 0)
    sums[target + 2] =
      (sums[target + 2] ?? 0) +
      (source[sourceOffset + 2] ?? 0) +
      (source[sourceOffset + 5] ?? 0) +
      (source[sourceOffset + 8] ?? 0) +
      (source[sourceOffset + 11] ?? 0)
    sourceOffset += 12
  }
}

const writeBoxRowRgb8x4 = (
  sums: Uint32Array,
  outputWidth: number,
  sourceRows: number,
  output: Uint8Array,
  outputOffset: number,
): void => {
  const area = 4 * sourceRows
  for (let outputX = 0; outputX < outputWidth; outputX += 1) {
    const sourceOffset = outputX * 3
    const target = outputOffset + sourceOffset
    output[target] = byte((sums[sourceOffset] ?? 0) / area)
    output[target + 1] = byte((sums[sourceOffset + 1] ?? 0) / area)
    output[target + 2] = byte((sums[sourceOffset + 2] ?? 0) / area)
  }
}

const accumulateBoxRow = (
  source: Uint8Array,
  format: PixelFormat,
  sourceWidth: number,
  factorX: number,
  sums: Float64Array,
): void => {
  const outputWidth = Math.ceil(sourceWidth / factorX)
  if (format === 'gray8') {
    for (let outputX = 0; outputX < outputWidth; outputX += 1) {
      const first = outputX * factorX
      const last = Math.min(first + factorX, sourceWidth)
      let gray = 0
      for (let sourceX = first; sourceX < last; sourceX += 1) {
        gray += source[sourceX] ?? 0
      }
      sums[outputX] = (sums[outputX] ?? 0) + gray
    }
    return
  }
  if (format === 'rgb8') {
    for (let outputX = 0; outputX < outputWidth; outputX += 1) {
      const first = outputX * factorX
      const last = Math.min(first + factorX, sourceWidth)
      let red = 0
      let green = 0
      let blue = 0
      for (let sourceX = first; sourceX < last; sourceX += 1) {
        const sourceOffset = sourceX * 3
        red += source[sourceOffset] ?? 0
        green += source[sourceOffset + 1] ?? 0
        blue += source[sourceOffset + 2] ?? 0
      }
      const outputOffset = outputX * 3
      sums[outputOffset] = (sums[outputOffset] ?? 0) + red
      sums[outputOffset + 1] = (sums[outputOffset + 1] ?? 0) + green
      sums[outputOffset + 2] = (sums[outputOffset + 2] ?? 0) + blue
    }
    return
  }
  for (let outputX = 0; outputX < outputWidth; outputX += 1) {
    const first = outputX * factorX
    const last = Math.min(first + factorX, sourceWidth)
    let redAlpha = 0
    let greenAlpha = 0
    let blueAlpha = 0
    let alpha = 0
    for (let sourceX = first; sourceX < last; sourceX += 1) {
      const sourceOffset = sourceX * 4
      const sourceAlpha = source[sourceOffset + 3] ?? 0
      redAlpha += (source[sourceOffset] ?? 0) * sourceAlpha
      greenAlpha += (source[sourceOffset + 1] ?? 0) * sourceAlpha
      blueAlpha += (source[sourceOffset + 2] ?? 0) * sourceAlpha
      alpha += sourceAlpha
    }
    const outputOffset = outputX * 4
    sums[outputOffset] = (sums[outputOffset] ?? 0) + redAlpha
    sums[outputOffset + 1] = (sums[outputOffset + 1] ?? 0) + greenAlpha
    sums[outputOffset + 2] = (sums[outputOffset + 2] ?? 0) + blueAlpha
    sums[outputOffset + 3] = (sums[outputOffset + 3] ?? 0) + alpha
  }
}

const writeBoxRow = (
  sums: Float64Array,
  format: PixelFormat,
  sourceWidth: number,
  factorX: number,
  sourceRows: number,
  output: Uint8Array,
  outputOffset: number,
): void => {
  const outputWidth = Math.ceil(sourceWidth / factorX)
  if (format === 'gray8') {
    for (let outputX = 0; outputX < outputWidth; outputX += 1) {
      const columns = Math.min(factorX, sourceWidth - outputX * factorX)
      output[outputOffset + outputX] = byte((sums[outputX] ?? 0) / (columns * sourceRows))
    }
    return
  }
  if (format === 'rgb8') {
    for (let outputX = 0; outputX < outputWidth; outputX += 1) {
      const columns = Math.min(factorX, sourceWidth - outputX * factorX)
      const area = columns * sourceRows
      const sourceOffset = outputX * 3
      const target = outputOffset + sourceOffset
      output[target] = byte((sums[sourceOffset] ?? 0) / area)
      output[target + 1] = byte((sums[sourceOffset + 1] ?? 0) / area)
      output[target + 2] = byte((sums[sourceOffset + 2] ?? 0) / area)
    }
    return
  }
  for (let outputX = 0; outputX < outputWidth; outputX += 1) {
    const columns = Math.min(factorX, sourceWidth - outputX * factorX)
    const area = columns * sourceRows
    const sourceOffset = outputX * 4
    const target = outputOffset + sourceOffset
    const alpha = sums[sourceOffset + 3] ?? 0
    const unpremultiply = alpha > 0 ? 1 / alpha : 0
    output[target] = byte((sums[sourceOffset] ?? 0) * unpremultiply)
    output[target + 1] = byte((sums[sourceOffset + 1] ?? 0) * unpremultiply)
    output[target + 2] = byte((sums[sourceOffset + 2] ?? 0) * unpremultiply)
    output[target + 3] = byte(alpha / area)
  }
}

const boxShrinkBlocks = async function* (
  input: AsyncIterable<PixelBlock>,
  sourceWidth: number,
  sourceHeight: number,
  format: PixelFormat,
  factorX: number,
  factorY: number,
  accelerator?: ImageResizeAccelerator,
): AsyncGenerator<PixelBlock> {
  const outputWidth = Math.ceil(sourceWidth / factorX)
  const outputHeight = Math.ceil(sourceHeight / factorY)
  const channelCount = channels(format)
  const outputStride = outputWidth * channelCount
  const blockCapacity = Math.min(outputBlockRows, outputHeight)
  const rowBytes = sourceWidth * channelCount
  // 255 * 4 * factorY must stay inside Uint32 for exact integer sums; 65536
  // is far beyond any realistic vertical box factor.
  const rgb8x4 = format === 'rgb8' && factorX === 4 && factorY <= 65_536
  const integerSums = rgb8x4 ? new Uint32Array(outputStride) : undefined
  const sums = rgb8x4 ? undefined : new Float64Array(outputStride)
  let box: ResizeBoxSession | undefined
  if (accelerator?.createBox && (format === 'rgb8' || format === 'rgba8')) {
    try {
      box = await accelerator.createBox(sourceWidth, format, factorX)
    } catch {
      // Initialization failed before reading input.
    }
  }
  const boxLease = box
  let block = new Uint8Array(outputStride * blockCapacity)
  let sourceY = 0
  let rowsInGroup = 0
  let blockHeight = 0
  let blockY = 0

  // Iterating input blocks directly keeps the per-row work synchronous; an
  // async row iterator costs one microtask hop per source row.
  try {
    for await (const inputBlock of input) {
      try {
        if (
          inputBlock.x !== 0 ||
          inputBlock.y !== sourceY ||
          inputBlock.width !== sourceWidth ||
          inputBlock.height < 1 ||
          inputBlock.format !== format ||
          inputBlock.stride < rowBytes ||
          inputBlock.data.byteLength < inputBlock.stride * (inputBlock.height - 1) + rowBytes
        ) {
          throw invalidInput('Resize requires ordered, full-width pixel blocks')
        }
        if (sourceY + inputBlock.height > sourceHeight) {
          throw invalidInput('Resize requires ordered, full-width pixel blocks')
        }
        for (let row = 0; row < inputBlock.height; row += 1) {
          const source = inputBlock.data.subarray(
            row * inputBlock.stride,
            row * inputBlock.stride + rowBytes,
          )
          if (box) {
            try {
              box.add(source, rowsInGroup === 0)
            } catch {
              if (rowsInGroup > 0) (integerSums ?? sums)?.set(box.sums)
              box = undefined
            }
          }
          if (!box) {
            if (rowsInGroup === 0) {
              integerSums?.fill(0)
              sums?.fill(0)
            }
            if (integerSums !== undefined) {
              accumulateBoxRowRgb8x4(source, outputWidth, integerSums)
            } else if (sums !== undefined) {
              accumulateBoxRow(source, format, sourceWidth, factorX, sums)
            }
          }
          sourceY += 1
          rowsInGroup += 1
          if (rowsInGroup < factorY && sourceY < sourceHeight) continue

          if (box) {
            try {
              box.write(rowsInGroup, block, blockHeight * outputStride)
            } catch {
              ;(integerSums ?? sums)?.set(box.sums)
              box = undefined
            }
          }
          if (!box && integerSums !== undefined) {
            writeBoxRowRgb8x4(
              integerSums,
              outputWidth,
              rowsInGroup,
              block,
              blockHeight * outputStride,
            )
          } else if (!box && sums !== undefined) {
            writeBoxRow(
              sums,
              format,
              sourceWidth,
              factorX,
              rowsInGroup,
              block,
              blockHeight * outputStride,
            )
          }
          rowsInGroup = 0
          blockHeight += 1

          if (blockHeight === blockCapacity) {
            let released = false
            yield {
              x: 0,
              y: blockY,
              width: outputWidth,
              height: blockHeight,
              stride: outputStride,
              format,
              data: block,
              ...(box && {
                release: () => {
                  released = true
                },
              }),
            }
            blockY += blockHeight
            blockHeight = 0
            const remaining = outputHeight - blockY
            const nextSize = outputStride * Math.min(blockCapacity, remaining)
            // A consumer may retain several blocks. Refill this buffer only after release.
            if (remaining > 0 && (!released || block.length !== nextSize))
              block = new Uint8Array(nextSize)
          }
        }
      } finally {
        inputBlock.release?.()
      }
    }
    if (sourceY !== sourceHeight) {
      throw truncatedInput(`Resize received ${sourceY} of ${sourceHeight} rows`)
    }
    if (blockHeight > 0) {
      yield {
        x: 0,
        y: blockY,
        width: outputWidth,
        height: blockHeight,
        stride: outputStride,
        format,
        data: block.subarray(0, outputStride * blockHeight),
      }
    }
  } finally {
    boxLease?.release?.()
  }
}

interface FilteredRow {
  readonly data: Float32Array
  // Channel offsets [start, end). Values outside this interval are implicitly zero.
  start: number
  end: number
}

const alphaScales = Float64Array.from({ length: 256 }, (_, alpha) => alpha / 255)
const rgbaGroupWidth = 32

interface PairedFilters {
  readonly starts: Uint32Array
  readonly offsets: Uint32Array
  readonly weights: Float64Array
}

// Adjacent output pixels use many of the same source samples. Store both
// coefficients together so each source pixel is unpacked and premultiplied once.
const pairedFilters = (axis: AxisCoefficients, width: number): PairedFilters | null => {
  const count = Math.floor(width / 2)
  // Bound the extra axis storage for very wide images or downscales with large support.
  const weightCapacity = (512 * 1024 - (count * 2 + 1) * 4) / 8
  if (count === 0 || count * 2 > weightCapacity) return null
  const offsets = new Uint32Array(count + 1)
  const starts = new Uint32Array(count)
  for (let pair = 0; pair < count; pair += 1) {
    const x = pair * 2
    const a = axis.offsets[x] ?? 0
    const b = axis.offsets[x + 1] ?? 0
    const end = axis.offsets[x + 2] ?? 0
    const left = Math.min(axis.indices[a] ?? 0, axis.indices[b] ?? 0)
    const right = Math.max(axis.indices[b - 1] ?? 0, axis.indices[end - 1] ?? 0)
    starts[pair] = left
    const next = (offsets[pair] ?? 0) + (right - left + 1) * 2
    if (next > weightCapacity) return null
    offsets[pair + 1] = next
  }
  const weights = new Float64Array(offsets[count] ?? 0)
  for (let x = 0; x < count * 2; x++) {
    const pair = x >>> 1
    const begin = axis.offsets[x] ?? 0
    const end = axis.offsets[x + 1] ?? 0
    const left = starts[pair] ?? 0
    const offset = (offsets[pair] ?? 0) + (x & 1)
    for (let tap = begin; tap < end; tap++) {
      weights[offset + 2 * ((axis.indices[tap] ?? 0) - left)] = axis.weights[tap] ?? 0
    }
  }
  return { starts, offsets, weights }
}

interface RgbaRowCache {
  pairs: PairedFilters | null | undefined
  readonly sourceBounds: Uint32Array
  source: Uint8Array | undefined
  filtered: FilteredRow | undefined
}

// Interior Lanczos samples can have wider support than either endpoint.
const rgbaGroupSourceBounds = (axis: AxisCoefficients, width: number): Uint32Array => {
  const bounds = new Uint32Array(Math.ceil(width / rgbaGroupWidth) * 2)
  for (let x = 0, group = 0; x < width; x += rgbaGroupWidth, group += 2) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[Math.min(width, x + rgbaGroupWidth)] ?? first
    let left = Infinity
    let right = 0
    for (let tap = first; tap < last; tap += 1) {
      const sample = axis.indices[tap] ?? 0
      left = Math.min(left, sample)
      right = Math.max(right, sample)
    }
    bounds[group] = left
    bounds[group + 1] = right
  }
  return bounds
}

const equalSourceRange = (a: Uint8Array, b: Uint8Array, start: number, end: number): boolean => {
  for (let i = start; i < end; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

type HorizontalKernel = (
  source: Uint8Array,
  outputWidth: number,
  axis: AxisCoefficients,
  row: FilteredRow,
  cache?: RgbaRowCache,
) => void

const horizontalGray8: HorizontalKernel = (source, outputWidth, axis, { data: output }): void => {
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let gray = 0
    for (let sampleIndex = first; sampleIndex < last; sampleIndex += 1) {
      const sourceX = axis.indices[sampleIndex] ?? 0
      gray += (source[sourceX] ?? 0) * (axis.weights[sampleIndex] ?? 0)
    }
    output[x] = gray
  }
}

const horizontalRgb8: HorizontalKernel = (source, outputWidth, axis, { data: output }): void => {
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let red = 0
    let green = 0
    let blue = 0
    for (let sampleIndex = first; sampleIndex < last; sampleIndex += 1) {
      const sourceOffset = (axis.indices[sampleIndex] ?? 0) * 3
      const weight = axis.weights[sampleIndex] ?? 0
      red += (source[sourceOffset] ?? 0) * weight
      green += (source[sourceOffset + 1] ?? 0) * weight
      blue += (source[sourceOffset + 2] ?? 0) * weight
    }
    const outputOffset = x * 3
    output[outputOffset] = red
    output[outputOffset + 1] = green
    output[outputOffset + 2] = blue
  }
}

const horizontalRgbaOpaque = (
  source: Uint8Array,
  outputWidth: number,
  axis: AxisCoefficients,
  output: Float32Array,
): void => {
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let red = 0
    let green = 0
    let blue = 0
    for (let sampleIndex = first; sampleIndex < last; sampleIndex += 1) {
      const sourceOffset = (axis.indices[sampleIndex] ?? 0) * 4
      const weight = axis.weights[sampleIndex] ?? 0
      red += (source[sourceOffset] ?? 0) * weight
      green += (source[sourceOffset + 1] ?? 0) * weight
      blue += (source[sourceOffset + 2] ?? 0) * weight
    }
    const outputOffset = x * 4
    output[outputOffset] = red
    output[outputOffset + 1] = green
    output[outputOffset + 2] = blue
    output[outputOffset + 3] = 255
  }
}

const hasContiguousSamples = (axis: AxisCoefficients): boolean => {
  for (let x = 1; x < axis.offsets.length; x += 1) {
    const end = axis.offsets[x] ?? 0
    for (let k = (axis.offsets[x - 1] ?? 0) + 1; k < end; k += 1) {
      if (axis.indices[k] !== (axis.indices[k - 1] ?? 0) + 1) return false
    }
  }
  return true
}

// The plan has verified that each filter interval addresses adjacent RGBA pixels.
const horizontalOpaqueRgb: HorizontalKernel = (
  source: Uint8Array,
  outputWidth: number,
  axis: AxisCoefficients,
  { data: output }: FilteredRow,
): void => {
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let red = 0
    let green = 0
    let blue = 0
    let sourceOffset = (axis.indices[first] ?? 0) * 4
    let sampleIndex = first
    for (; sampleIndex + 1 < last; sampleIndex += 2) {
      const a = axis.weights[sampleIndex] ?? 0
      const b = axis.weights[sampleIndex + 1] ?? 0
      red = red + (source[sourceOffset] ?? 0) * a + (source[sourceOffset + 4] ?? 0) * b
      green = green + (source[sourceOffset + 1] ?? 0) * a + (source[sourceOffset + 5] ?? 0) * b
      blue = blue + (source[sourceOffset + 2] ?? 0) * a + (source[sourceOffset + 6] ?? 0) * b
      sourceOffset += 8
    }
    if (sampleIndex < last) {
      const weight = axis.weights[sampleIndex] ?? 0
      red += (source[sourceOffset] ?? 0) * weight
      green += (source[sourceOffset + 1] ?? 0) * weight
      blue += (source[sourceOffset + 2] ?? 0) * weight
    }
    const outputOffset = x * 3
    output[outputOffset] = red
    output[outputOffset + 1] = green
    output[outputOffset + 2] = blue
  }
}

const horizontalRgba8: HorizontalKernel = (source, outputWidth, axis, row, cache): void => {
  const output = row.data
  const previous = cache?.filtered
  if (cache) cache.filtered = undefined
  let opaque = true
  for (let offset = 3; offset < source.length; offset += 4) {
    if (source[offset] !== 255) {
      opaque = false
      break
    }
  }
  if (opaque) {
    row.start = 0
    row.end = output.length
    horizontalRgbaOpaque(source, outputWidth, axis, output)
    return
  }
  // A transparent source sample contributes zero to every premultiplied channel.
  let left = 0
  while (left < source.length && source[left + 3] === 0) left += 4
  if (left === source.length) {
    row.start = 0
    row.end = 0
    return
  }
  let right = source.length - 4
  while (source[right + 3] === 0) right -= 4
  let start = 0
  let end = outputWidth
  while (start < end && (axis.indices[(axis.offsets[start + 1] ?? 0) - 1] ?? 0) * 4 < left) {
    start += 1
  }
  while (end > start && (axis.indices[axis.offsets[end - 1] ?? 0] ?? 0) * 4 > right) {
    end -= 1
  }
  if (cache && cache.pairs === undefined) cache.pairs = pairedFilters(axis, outputWidth)
  const pixels = new DataView(source.buffer, source.byteOffset, source.byteLength)
  row.start = start * 4
  row.end = end * 4
  for (let x = start; x < end; ) {
    const group = Math.floor(x / rgbaGroupWidth)
    const stop = Math.min(end, (group + 1) * rgbaGroupWidth)
    if (
      cache?.source &&
      previous &&
      previous !== row &&
      x * 4 >= previous.start &&
      stop * 4 <= previous.end
    ) {
      const first = (cache.sourceBounds[group * 2] ?? 0) * 4
      const limit = ((cache.sourceBounds[group * 2 + 1] ?? 0) + 1) * 4
      if (equalSourceRange(source, cache.source, first, limit)) {
        output.set(previous.data.subarray(x * 4, stop * 4), x * 4)
        x = stop
        continue
      }
    }
    if (cache?.pairs && x % 2 === 0) {
      const { offsets, starts, weights } = cache.pairs
      for (; x + 1 < stop; x += 2) {
        const pair = x >>> 1
        const first = offsets[pair] ?? 0
        const last = offsets[pair + 1] ?? 0
        let pos = (starts[pair] ?? 0) * 4
        let red0 = 0
        let green0 = 0
        let blue0 = 0
        let alpha0 = 0
        let red1 = 0
        let green1 = 0
        let blue1 = 0
        let alpha1 = 0
        for (let tap = first; tap < last; tap += 2, pos += 4) {
          const pixel = pixels.getUint32(pos, true)
          const alpha = pixel >>> 24
          const scale = alphaScales[alpha] ?? 0
          const red = (pixel & 255) * scale
          const green = ((pixel >>> 8) & 255) * scale
          const blue = ((pixel >>> 16) & 255) * scale
          const weight0 = weights[tap] ?? 0
          const weight1 = weights[tap + 1] ?? 0
          red0 += red * weight0
          green0 += green * weight0
          blue0 += blue * weight0
          alpha0 += alpha * weight0
          red1 += red * weight1
          green1 += green * weight1
          blue1 += blue * weight1
          alpha1 += alpha * weight1
        }
        output[x * 4] = red0
        output[x * 4 + 1] = green0
        output[x * 4 + 2] = blue0
        output[x * 4 + 3] = alpha0
        output[x * 4 + 4] = red1
        output[x * 4 + 5] = green1
        output[x * 4 + 6] = blue1
        output[x * 4 + 7] = alpha1
      }
    }
    for (; x < stop; x += 1) {
      const first = axis.offsets[x] ?? 0
      const last = axis.offsets[x + 1] ?? first
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      for (let sampleIndex = first; sampleIndex < last; sampleIndex += 1) {
        const sourceOffset = (axis.indices[sampleIndex] ?? 0) * 4
        const weight = axis.weights[sampleIndex] ?? 0
        const pixel = pixels.getUint32(sourceOffset, true)
        const sourceAlpha = pixel >>> 24
        const alphaScale = alphaScales[sourceAlpha] ?? 0
        red += (pixel & 255) * alphaScale * weight
        green += ((pixel >>> 8) & 255) * alphaScale * weight
        blue += ((pixel >>> 16) & 255) * alphaScale * weight
        alpha += sourceAlpha * weight
      }
      const outputOffset = x * 4
      output[outputOffset] = red
      output[outputOffset + 1] = green
      output[outputOffset + 2] = blue
      output[outputOffset + 3] = alpha
    }
  }
  if (cache) {
    cache.source = source
    cache.filtered = row
  }
}

const horizontalKernel = (format: PixelFormat): HorizontalKernel => {
  if (format === 'gray8') return horizontalGray8
  if (format === 'rgb8') return horizontalRgb8
  return horizontalRgba8
}

const verticalRingCapacity = (axis: AxisCoefficients, outputHeight: number): number => {
  let capacity = 1
  for (let outputY = 0; outputY < outputHeight; outputY += 1) {
    const first = axis.offsets[outputY] ?? 0
    const last = axis.offsets[outputY + 1] ?? first
    const minimum = axis.indices[first]
    const maximum = axis.indices[last - 1]
    if (minimum !== undefined && maximum !== undefined) {
      capacity = Math.max(capacity, maximum - minimum + 1)
    }
  }
  return capacity
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
  startX: number,
  endX: number,
  outputFormat: PixelFormat,
): void => {
  const sourceChannels = channels(sourceFormat)
  const outputChannels = channels(outputFormat)
  for (let x = startX; x < endX; x += 1) {
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
      const alpha = byte(alphaValue)
      const unpremultiply = alphaValue > 0 ? 255 / alphaValue : 0
      output[target] = byte((source[sourceOffset] ?? 0) * unpremultiply)
      output[target + 1] = byte((source[sourceOffset + 1] ?? 0) * unpremultiply)
      output[target + 2] = byte((source[sourceOffset + 2] ?? 0) * unpremultiply)
      output[target + 3] = alpha
    }
  }
}

const writeOpaqueContent = (
  accumulated: Float32Array,
  block: Uint8Array,
  blockOffset: number,
  width: number,
  vertical: AxisCoefficients,
  first: number,
  last: number,
): void => {
  // Match the Float32 vertical alpha accumulation and the RGBA unpremultiply.
  let alphaValue = 0
  for (let tap = first; tap < last; tap += 1) {
    alphaValue = Math.fround(alphaValue + 255 * (vertical.weights[tap] ?? 0))
  }
  const alpha = clamp(alphaValue, 0, 255)
  const scale = alpha > 0 ? 255 / alpha : 0
  const opacity = Math.round(alpha)
  let source = 0
  let target = blockOffset
  for (let x = 0; x < width; x += 1) {
    block[target] = byte((accumulated[source] ?? 0) * scale)
    block[target + 1] = byte((accumulated[source + 1] ?? 0) * scale)
    block[target + 2] = byte((accumulated[source + 2] ?? 0) * scale)
    block[target + 3] = opacity
    source += 3
    target += 4
  }
}

const resizedBlocks = async function* (
  input: AsyncIterable<PixelBlock>,
  sourceWidth: number,
  sourceHeight: number,
  sourceFormat: PixelFormat,
  plan: ResizePlan,
  outputFormat: PixelFormat,
  opaqueRgba8: boolean,
  accelerator?: ImageResizeAccelerator,
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
  const contiguousOpaque = opaqueRgba8 && hasContiguousSamples(horizontal)
  const sourceChannels = contiguousOpaque ? 3 : channels(sourceFormat)
  const requiredSourceRows = new Uint8Array(sourceHeight)
  for (const sourceRow of vertical.indices) requiredSourceRows[sourceRow] = 1
  const ringCapacity = verticalRingCapacity(vertical, plan.contentHeight)
  const retainedSourceRows = new Int32Array(ringCapacity)
  retainedSourceRows.fill(-1)
  const retainedRows: (FilteredRow | undefined)[] = new Array(ringCapacity)
  let session: ResizeFilterSession | undefined
  if (
    accelerator &&
    (sourceFormat === 'rgb8' || sourceFormat === 'rgba8') &&
    plan.kernel === 'lanczos3'
  ) {
    try {
      session = await accelerator.createFilter({
        sourceWidth,
        format: sourceFormat,
        outputChannels: outputFormat === 'rgba8' ? 4 : 3,
        opaque: contiguousOpaque,
        horizontal,
        capacity: ringCapacity,
      })
    } catch {
      // Initialization failed before any source row was consumed.
    }
  }
  const filterLease = session
  const rowCache: RgbaRowCache | undefined =
    sourceFormat === 'rgba8' && !opaqueRgba8 && plan.kernel === 'lanczos3' && ringCapacity > 1
      ? {
          sourceBounds: rgbaGroupSourceBounds(horizontal, plan.contentWidth),
          pairs: undefined,
          source: undefined,
          filtered: undefined,
        }
      : undefined
  const sourceRows = rows(input, sourceWidth, sourceHeight, sourceFormat, rowCache)[
    Symbol.asyncIterator
  ]()
  const resizeHorizontal = contiguousOpaque ? horizontalOpaqueRgb : horizontalKernel(sourceFormat)
  const outputChannels = channels(outputFormat)
  const outputStride = plan.canvasWidth * outputChannels
  const blockCapacity = Math.min(outputBlockRows, plan.canvasHeight)
  let block = new Uint8Array(outputStride * blockCapacity)
  const accumulated = new Float32Array(plan.contentWidth * sourceChannels)
  const fullRow = (tap: number): Float32Array | undefined => {
    const y = vertical.indices[tap]
    if (y === undefined) return undefined
    const slot = y % ringCapacity
    const row = retainedRows[slot]
    return retainedSourceRows[slot] === y && row?.start === 0 && row.end === accumulated.length
      ? row.data
      : undefined
  }
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
            const slot = loadedRows % ringCapacity
            const resizedRow = retainedRows[slot] ?? {
              data: session?.rows[slot] ?? new Float32Array(plan.contentWidth * sourceChannels),
              start: 0,
              end: plan.contentWidth * sourceChannels,
            }
            if (session) {
              try {
                session.horizontal(next.value, slot)
              } catch {
                session = undefined
              }
            }
            if (!session)
              resizeHorizontal(next.value, plan.contentWidth, horizontal, resizedRow, rowCache)
            retainedRows[slot] = resizedRow
            retainedSourceRows[slot] = loadedRows
          }
          loadedRows += 1
        }

        if (session) {
          try {
            session.vertical(vertical, first, last, block, blockOffset + plan.padX * outputChannels)
          } catch {
            session = undefined
          }
        }
        if (!session) {
          let contentStart = accumulated.length
          let contentEnd = 0
          accumulated.fill(0)
          let sampleIndex = first
          if (sourceFormat === 'rgba8' && !contiguousOpaque) {
            for (; sampleIndex + 3 < last; sampleIndex += 4) {
              const a = fullRow(sampleIndex)
              const b = fullRow(sampleIndex + 1)
              const c = fullRow(sampleIndex + 2)
              const d = fullRow(sampleIndex + 3)
              if (!a || !b || !c || !d) break
              const wa = vertical.weights[sampleIndex] ?? 0
              const wb = vertical.weights[sampleIndex + 1] ?? 0
              const wc = vertical.weights[sampleIndex + 2] ?? 0
              const wd = vertical.weights[sampleIndex + 3] ?? 0
              // Match the Float32 store after each tap while keeping the sum in a register.
              for (let i = 0; i < accumulated.length; i += 1) {
                let sum = Math.fround((accumulated[i] ?? 0) + (a[i] ?? 0) * wa)
                sum = Math.fround(sum + (b[i] ?? 0) * wb)
                sum = Math.fround(sum + (c[i] ?? 0) * wc)
                accumulated[i] = sum + (d[i] ?? 0) * wd
              }
              contentStart = 0
              contentEnd = accumulated.length
            }
          }
          for (; sampleIndex < last; sampleIndex += 1) {
            const sourceY = vertical.indices[sampleIndex]
            const weight = vertical.weights[sampleIndex]
            const slot = sourceY === undefined ? -1 : sourceY % ringCapacity
            const row =
              slot >= 0 && retainedSourceRows[slot] === sourceY ? retainedRows[slot] : undefined
            if (!row || weight === undefined) throw invalidInput('Resize source row is unavailable')
            if (row.start < row.end) {
              contentStart = Math.min(contentStart, row.start)
              contentEnd = Math.max(contentEnd, row.end)
            }
            const data = row.data
            for (let index = row.start; index < row.end; index += 1) {
              accumulated[index] = (accumulated[index] ?? 0) + (data[index] ?? 0) * weight
            }
          }
          if (contiguousOpaque) {
            writeOpaqueContent(
              accumulated,
              block,
              blockOffset + plan.padX * outputChannels,
              plan.contentWidth,
              vertical,
              first,
              last,
            )
          } else
            writeContent(
              accumulated,
              sourceFormat,
              block,
              blockOffset + plan.padX * outputChannels,
              plan.background ? 0 : contentStart / sourceChannels,
              plan.background ? plan.contentWidth : contentEnd / sourceChannels,
              outputFormat,
            )
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
    filterLease?.release?.()
    await sourceRows.return?.(undefined)
  }
}

const boxShrinkCompletesPlan = (
  plan: ResizePlan,
  shrunkWidth: number,
  shrunkHeight: number,
  sourceFormat: PixelFormat,
  outputFormat: PixelFormat,
): boolean =>
  plan.scaledWidth === shrunkWidth &&
  plan.scaledHeight === shrunkHeight &&
  plan.cropX === 0 &&
  plan.cropY === 0 &&
  plan.contentWidth === shrunkWidth &&
  plan.contentHeight === shrunkHeight &&
  plan.padX === 0 &&
  plan.padY === 0 &&
  plan.canvasWidth === shrunkWidth &&
  plan.canvasHeight === shrunkHeight &&
  plan.background === undefined &&
  outputFormat === sourceFormat

export const createResizeTransform = (
  width: number,
  height: number,
  pixelFormat: PixelFormat,
  options: ResizeOptions,
  colorSemantics?: PixelColorSemantics,
  sampleBitDepths?: readonly number[],
  opaqueRgba8 = false,
  accelerator?: ImageResizeAccelerator,
): ResizeTransform => {
  const plan = resizePlan(width, height, options)
  const format = resultFormat(pixelFormat, plan.background)
  if (pixelFormat.startsWith('rgba') && colorSemantics?.alpha === 'premultiplied') {
    throw unsupportedOperation('Resize does not support explicitly premultiplied alpha input')
  }
  if (
    options.colorSpace === 'linear-light' &&
    !(pixelFormat.endsWith('f32') && colorSemantics?.transfer.kind === 'linear')
  ) {
    const transfer = validateLinearLightSemantics(pixelFormat, colorSemantics)
    return {
      width: plan.canvasWidth,
      height: plan.canvasHeight,
      pixelFormat: format,
      apply: (blocks) =>
        resizedLinearLightBlocks(
          blocks,
          width,
          height,
          pixelFormat,
          plan,
          format,
          transfer,
          sampleBitDepths,
        ),
    }
  }
  if (nativeResizeFormat(pixelFormat)) {
    return {
      width: plan.canvasWidth,
      height: plan.canvasHeight,
      pixelFormat: format,
      apply: (blocks) =>
        resizedNativeBlocks(blocks, width, height, pixelFormat, plan, format, sampleBitDepths),
    }
  }
  channels(pixelFormat)
  const factorX = boxShrinkFactor(width, plan.scaledWidth, plan.kernel)
  const factorY = boxShrinkFactor(height, plan.scaledHeight, plan.kernel)
  const resizedWidth = width / factorX
  const resizedHeight = height / factorY
  // When the box shrink lands exactly on the requested geometry, the Lanczos
  // pass would resample at scale 1, where every axis collapses to one
  // weight-1.0 sample per output pixel (integer-offset lanczos weights fall
  // under the 1e-12 cutoff). Skipping it is byte-exact and avoids a full
  // extra traversal of the shrunk image.
  const shrinkCompletesPlan =
    (factorX > 1 || factorY > 1) &&
    boxShrinkCompletesPlan(plan, resizedWidth, resizedHeight, pixelFormat, format)
  return {
    width: plan.canvasWidth,
    height: plan.canvasHeight,
    pixelFormat: format,
    apply(blocks: AsyncIterable<PixelBlock>): AsyncIterable<PixelBlock> {
      const shrunk =
        factorX === 1 && factorY === 1
          ? blocks
          : boxShrinkBlocks(blocks, width, height, pixelFormat, factorX, factorY, accelerator)
      if (shrinkCompletesPlan) return shrunk
      return resizedBlocks(
        shrunk,
        resizedWidth,
        resizedHeight,
        pixelFormat,
        plan,
        format,
        opaqueRgba8 && pixelFormat === 'rgba8',
        accelerator,
      )
    },
  }
}
