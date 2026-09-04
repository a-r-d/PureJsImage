import type { ImageCodec, ImageDecoder } from './codec.ts'
import type { PixelColorSemantics } from './color.ts'
import { convertedPixelColorSemantics } from './convert.ts'
import { unsupportedOperation } from './errors.ts'
import { normalizedRotation, type PipelineOperation, rotationDimensions } from './pipeline.ts'
import { normalizedPixelFormat, type PixelFormat, pixelStorage } from './pixel.ts'
import { createResizeTransform, resizedPixelColorSemantics } from './resize.ts'

export type PrecisionPlanMemoryClass = 'streaming-rows' | 'temporary-storage' | 'full-frame'
export type PrecisionPlanStageReason =
  | 'decoder-output'
  | 'byte-preserving-transform'
  | 'native-transform'
  | 'caller-conversion'
  | 'encoder-required'

export interface PrecisionPlanStageDescription {
  readonly operation: string
  readonly reason: PrecisionPlanStageReason
  readonly inputWidth: number
  readonly inputHeight: number
  readonly outputWidth: number
  readonly outputHeight: number
  readonly inputFormat: PixelFormat
  readonly outputFormat: PixelFormat
  readonly inputColorSemantics?: PixelColorSemantics
  readonly outputColorSemantics?: PixelColorSemantics
  readonly exactBytes: boolean
  readonly precisionLoss: boolean
  readonly precisionLossReason?: string
  readonly memoryClass: PrecisionPlanMemoryClass
}

export interface PrecisionExecutionPlanDescription {
  readonly version: 1
  readonly stages: readonly PrecisionPlanStageDescription[]
  readonly outputFormat: PixelFormat
  readonly outputColorSemantics?: PixelColorSemantics
}

const bytePreservingOperation = (operation: PipelineOperation): boolean => {
  if (
    operation.type === 'crop' ||
    operation.type === 'autoOrient' ||
    operation.type === 'flip' ||
    operation.type === 'flop'
  ) {
    return true
  }
  return operation.type === 'rotate' && normalizedRotation(operation.degrees) % 90 === 0
}

const nativeResizeFormat = (format: PixelFormat): boolean =>
  format === 'gray8' ||
  format === 'rgb8' ||
  format === 'rgba8' ||
  format === 'gray16' ||
  format === 'rgb16' ||
  format === 'rgba16' ||
  format === 'grayf32' ||
  format === 'rgbf32' ||
  format === 'rgbaf32'

export const transformAcceptsPixelFormat = (
  operation: PipelineOperation,
  format: PixelFormat,
): boolean => {
  if (
    operation.type === 'encode' ||
    operation.type === 'keepExif' ||
    operation.type === 'keepIcc'
  ) {
    return true
  }
  if (operation.type === 'window') return format.startsWith('gray')
  if (operation.type === 'convertPixelFormat') return true
  if (operation.type === 'lut') {
    return format === 'gray8' || (format === 'rgba8' && operation.options.format === 'rgba8')
  }
  if (operation.type === 'resize') return nativeResizeFormat(format)
  if (bytePreservingOperation(operation)) return pixelStorage(format).layout === 'interleaved'
  if (operation.type === 'rotate') {
    return format === 'gray8' || format === 'rgb8' || format === 'rgba8'
  }
  return false
}

const stage = (
  operation: string,
  reason: PrecisionPlanStageReason,
  inputWidth: number,
  inputHeight: number,
  outputWidth: number,
  outputHeight: number,
  inputFormat: PixelFormat,
  outputFormat: PixelFormat,
  inputSemantics: PixelColorSemantics | undefined,
  outputSemantics: PixelColorSemantics | undefined,
  exactBytes: boolean,
  memoryClass: PrecisionPlanMemoryClass,
  precisionLossReason?: string,
): PrecisionPlanStageDescription =>
  Object.freeze({
    operation,
    reason,
    inputWidth,
    inputHeight,
    outputWidth,
    outputHeight,
    inputFormat,
    outputFormat,
    ...(inputSemantics === undefined ? {} : { inputColorSemantics: inputSemantics }),
    ...(outputSemantics === undefined ? {} : { outputColorSemantics: outputSemantics }),
    exactBytes,
    precisionLoss: precisionLossReason !== undefined,
    ...(precisionLossReason === undefined ? {} : { precisionLossReason }),
    memoryClass,
  })

export const describePrecisionExecution = (options: {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly colorSemantics?: PixelColorSemantics
  readonly operations: readonly PipelineOperation[]
  readonly encoderFormat: string
  readonly encoderPixelFormats?: readonly PixelFormat[]
  readonly encoderAcceptsColorSemantics?: (semantics: PixelColorSemantics) => boolean
  readonly decoderExecution?: ImageDecoder['execution']
  readonly requireExplicitConversion?: boolean
  readonly sourceOrientation?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
}): PrecisionExecutionPlanDescription => {
  let width = options.width
  let height = options.height
  let format = options.pixelFormat
  let semantics = options.colorSemantics
  const stages: PrecisionPlanStageDescription[] = [
    stage(
      'decode',
      'decoder-output',
      width,
      height,
      width,
      height,
      options.decoderExecution?.nativePixelFormat ?? format,
      format,
      options.decoderExecution?.inputColorSemantics ?? semantics,
      semantics,
      options.decoderExecution?.precisionLoss !== true,
      options.decoderExecution?.fullFrameFallbackReasons.length ? 'full-frame' : 'streaming-rows',
      options.decoderExecution?.precisionLoss
        ? 'Requested decoder output changes native numeric or color values'
        : undefined,
    ),
  ]

  for (const operation of options.operations) {
    if (
      operation.type === 'encode' ||
      operation.type === 'keepExif' ||
      operation.type === 'keepIcc'
    ) {
      continue
    }
    if (!transformAcceptsPixelFormat(operation, format)) {
      throw unsupportedOperation(`${operation.type} does not support ${format} pixels`)
    }
    const inputWidth = width
    const inputHeight = height
    const inputFormat = format
    const inputSemantics = semantics
    if (operation.type === 'crop') {
      width = operation.width
      height = operation.height
    } else if (operation.type === 'resize') {
      const dimensions = createResizeTransform(width, height, format, operation, semantics)
      width = dimensions.width
      height = dimensions.height
      format = dimensions.pixelFormat
      semantics = resizedPixelColorSemantics(semantics, format)
    } else if (operation.type === 'rotate') {
      const dimensions = rotationDimensions(width, height, operation.degrees)
      width = dimensions.width
      height = dimensions.height
    } else if (operation.type === 'autoOrient' && (options.sourceOrientation ?? 1) >= 5) {
      const originalWidth = width
      width = height
      height = originalWidth
    }
    if (operation.type === 'window') format = normalizedPixelFormat(format)
    if (operation.type === 'convertPixelFormat') {
      format = operation.options.format
      semantics = convertedPixelColorSemantics(semantics, format)
    }
    if (operation.type === 'lut') format = operation.options.format
    const exactBytes = bytePreservingOperation(operation)
    const memoryClass: PrecisionPlanMemoryClass =
      operation.type === 'autoOrient' ||
      operation.type === 'flip' ||
      operation.type === 'flop' ||
      operation.type === 'rotate'
        ? operation.type === 'flop' ||
          (operation.type === 'rotate' && normalizedRotation(operation.degrees) === 0)
          ? 'streaming-rows'
          : 'temporary-storage'
        : 'streaming-rows'
    stages.push(
      stage(
        operation.type,
        operation.type === 'convertPixelFormat'
          ? 'caller-conversion'
          : exactBytes
            ? 'byte-preserving-transform'
            : 'native-transform',
        inputWidth,
        inputHeight,
        width,
        height,
        inputFormat,
        format,
        inputSemantics,
        semantics,
        exactBytes,
        memoryClass,
        operation.type === 'window' && inputFormat !== format
          ? 'Caller-requested window maps native samples to display bytes'
          : operation.type === 'convertPixelFormat' && inputFormat !== format
            ? `Caller requested ${inputFormat} to ${format} conversion`
            : undefined,
      ),
    )
  }

  if (!options.encoderPixelFormats?.includes(format)) {
    const converted = normalizedPixelFormat(format)
    if (options.requireExplicitConversion && pixelStorage(format).bytesPerSample > 1) {
      throw unsupportedOperation(
        `${options.encoderFormat} requires an explicit convertPixelFormat from ${format}; precision is never reduced implicitly`,
      )
    }
    stages.push(
      stage(
        `encode:${options.encoderFormat}:conversion`,
        'encoder-required',
        width,
        height,
        width,
        height,
        format,
        converted,
        semantics,
        undefined,
        false,
        'streaming-rows',
        `${options.encoderFormat} encoder does not accept ${format} pixels directly`,
      ),
    )
    format = converted
    semantics = undefined
  }
  if (semantics !== undefined && options.encoderAcceptsColorSemantics?.(semantics) === false) {
    throw unsupportedOperation(
      `${options.encoderFormat} encoder does not accept the current pixel color semantics`,
    )
  }

  return Object.freeze({
    version: 1,
    stages: Object.freeze(stages),
    outputFormat: format,
    ...(semantics === undefined ? {} : { outputColorSemantics: semantics }),
  })
}

/** Negotiate source sample precision before reading transform rows. */
export const negotiateEncoderOptions = (
  decoder: ImageDecoder,
  codec: ImageCodec,
  operations: readonly PipelineOperation[],
  requested: unknown,
  preserveIcc = false,
  outputFormat = decoder.pixelFormat,
): unknown => {
  const execution = decoder.execution
  if (!execution) return requested
  const converted = operations.some(
    (op) => op.type === 'convertPixelFormat' || op.type === 'window',
  )
  if (
    !converted &&
    codec.format !== execution.encodingDefaults?.format &&
    execution.sampleBitDepths.some(
      (depth) => depth !== pixelStorage(decoder.pixelFormat).bytesPerSample * 8,
    )
  ) {
    throw unsupportedOperation(
      `${codec.format} cannot preserve the source sample ranges; use explicit convertPixelFormat`,
    )
  }
  const semantics = decoder.colorSemantics
  if (
    !codec.acceptsColorSemantics &&
    semantics &&
    (semantics.primaries !== 'srgb' ||
      semantics.transfer.kind !== 'srgb' ||
      (semantics.alpha !== 'none' && semantics.alpha !== 'straight')) &&
    !(preserveIcc && semantics.icc?.relevance === 'emitted-pixels')
  ) {
    throw unsupportedOperation(`${codec.format} requires an explicit color or alpha conversion`)
  }
  if (
    codec.format !== execution.encodingDefaults?.format ||
    typeof requested !== 'object' ||
    requested === null ||
    Array.isArray(requested)
  )
    return requested
  const { intrinsicSize, ...defaults } = execution.encodingDefaults.options
  const geometryChanged = operations.some(
    (op) =>
      op.type === 'crop' ||
      op.type === 'resize' ||
      op.type === 'autoOrient' ||
      op.type === 'rotate',
  )
  const oriented = operations.some((op) => op.type === 'autoOrient')
  return {
    ...(!converted ? defaults : { orientation: defaults.orientation }),
    ...(!geometryChanged && intrinsicSize !== undefined ? { intrinsicSize } : {}),
    ...(oriented ? { orientation: 1 } : {}),
    ...(!converted && outputFormat.startsWith('rgba') && !decoder.pixelFormat.startsWith('rgba')
      ? { alphaBitDepth: pixelStorage(outputFormat).bytesPerSample * 8 }
      : {}),
    ...requested,
  }
}
