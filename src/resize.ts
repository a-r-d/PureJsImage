import type { PixelColorSemantics } from './color.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from './errors.ts'
import type { ResizeKernel, ResizeOptions } from './pipeline.ts'
import { calculateResizeDimensions } from './pipeline.ts'
import { type PixelBlock, type PixelFormat, pixelBytesPerPixel, pixelStorage } from './pixel.ts'

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
  let block = new Uint8Array(outputStride * blockCapacity)
  let sourceY = 0
  let rowsInGroup = 0
  let blockHeight = 0
  let blockY = 0

  // Iterating input blocks directly keeps the per-row work synchronous; an
  // async row iterator costs one microtask hop per source row.
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
        if (rowsInGroup === 0) {
          integerSums?.fill(0)
          sums?.fill(0)
        }
        if (integerSums !== undefined) {
          accumulateBoxRowRgb8x4(source, outputWidth, integerSums)
        } else if (sums !== undefined) {
          accumulateBoxRow(source, format, sourceWidth, factorX, sums)
        }
        sourceY += 1
        rowsInGroup += 1
        if (rowsInGroup < factorY && sourceY < sourceHeight) continue

        if (integerSums !== undefined) {
          writeBoxRowRgb8x4(
            integerSums,
            outputWidth,
            rowsInGroup,
            block,
            blockHeight * outputStride,
          )
        } else if (sums !== undefined) {
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
          yield {
            x: 0,
            y: blockY,
            width: outputWidth,
            height: blockHeight,
            stride: outputStride,
            format,
            data: block,
          }
          blockY += blockHeight
          blockHeight = 0
          const remaining = outputHeight - blockY
          if (remaining > 0)
            block = new Uint8Array(outputStride * Math.min(blockCapacity, remaining))
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
}

type HorizontalKernel = (
  source: Uint8Array,
  outputWidth: number,
  axis: AxisCoefficients,
  output: Float32Array,
) => void

const horizontalGray8: HorizontalKernel = (source, outputWidth, axis, output): void => {
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

const horizontalRgb8: HorizontalKernel = (source, outputWidth, axis, output): void => {
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

const horizontalRgba8: HorizontalKernel = (source, outputWidth, axis, output): void => {
  let opaque = true
  for (let offset = 3; offset < source.length; offset += 4) {
    if (source[offset] !== 255) {
      opaque = false
      break
    }
  }
  if (opaque) {
    horizontalRgbaOpaque(source, outputWidth, axis, output)
    return
  }
  for (let x = 0; x < outputWidth; x += 1) {
    const first = axis.offsets[x] ?? 0
    const last = axis.offsets[x + 1] ?? first
    let red = 0
    let green = 0
    let blue = 0
    let alpha = 0
    for (let sampleIndex = first; sampleIndex < last; sampleIndex += 1) {
      const sourceOffset = (axis.indices[sampleIndex] ?? 0) * 4
      const weight = axis.weights[sampleIndex] ?? 0
      const sourceAlpha = source[sourceOffset + 3] ?? 0
      const alphaScale = sourceAlpha / 255
      red += (source[sourceOffset] ?? 0) * alphaScale * weight
      green += (source[sourceOffset + 1] ?? 0) * alphaScale * weight
      blue += (source[sourceOffset + 2] ?? 0) * alphaScale * weight
      alpha += sourceAlpha * weight
    }
    const outputOffset = x * 4
    output[outputOffset] = red
    output[outputOffset + 1] = green
    output[outputOffset + 2] = blue
    output[outputOffset + 3] = alpha
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
  const sourceChannels = channels(sourceFormat)
  const requiredSourceRows = new Uint8Array(sourceHeight)
  for (const sourceRow of vertical.indices) requiredSourceRows[sourceRow] = 1
  const ringCapacity = verticalRingCapacity(vertical, plan.contentHeight)
  const retainedSourceRows = new Int32Array(ringCapacity)
  retainedSourceRows.fill(-1)
  const retainedRows: (Float32Array | undefined)[] = new Array(ringCapacity)
  const resizeHorizontal = horizontalKernel(sourceFormat)
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
            const slot = loadedRows % ringCapacity
            const resizedRow =
              retainedRows[slot] ?? new Float32Array(plan.contentWidth * sourceChannels)
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
        writeContent(
          accumulated,
          sourceFormat,
          block,
          blockOffset + plan.padX * outputChannels,
          plan.contentWidth,
          outputFormat,
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
          : boxShrinkBlocks(blocks, width, height, pixelFormat, factorX, factorY)
      if (shrinkCompletesPlan) return shrunk
      return resizedBlocks(shrunk, resizedWidth, resizedHeight, pixelFormat, plan, format)
    },
  }
}
