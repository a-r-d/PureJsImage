import type { CodecRegistry, ImageCodec, ImageEncoder } from './codec.ts'
import { cropPixelBlocks } from './crop.ts'
import { invalidInput, unsupportedOperation } from './errors.ts'
import type { ImageLimits } from './limits.ts'
import { validateImageDimensions } from './limits.ts'
import { normalizeExifOrientation } from './metadata.ts'
import { createOrientationTransform, type ExifOrientation } from './orient.ts'
import {
  calculateResizeDimensions,
  normalizedRotation,
  type PipelineOperation,
} from './pipeline.ts'
import type { PixelBlock } from './pixel.ts'
import type { ImageRuntime } from './runtime.ts'
import { createResizeTransform } from './resize.ts'
import { createRotationTransform } from './rotate.ts'
import type { ImageSink } from './sink.ts'
import type { ImageSource } from './source.ts'

interface ExecutionContext {
  readonly source: ImageSource
  readonly codec: ImageCodec
  readonly registry: CodecRegistry
  readonly limits: ImageLimits
  readonly runtime: ImageRuntime
}

interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface OutputPlan {
  readonly format: string
  readonly options: unknown
  readonly decoderRegion: Region
  readonly stages: readonly PipelineOperation[]
}

type DecodeScaleDenominator = 1 | 2 | 4 | 8

export const selectDecodeScaleDenominator = (
  sourceWidth: number,
  sourceHeight: number,
  decoderRegion: Region,
  stages: readonly PipelineOperation[],
  scaledDecode: boolean,
): DecodeScaleDenominator => {
  const firstStage = stages[0]
  if (
    !scaledDecode ||
    firstStage?.type !== 'resize' ||
    decoderRegion.x !== 0 ||
    decoderRegion.y !== 0 ||
    decoderRegion.width !== sourceWidth ||
    decoderRegion.height !== sourceHeight
  ) {
    return 1
  }

  const target = calculateResizeDimensions(sourceWidth, sourceHeight, firstStage)
  const candidates = [8, 4, 2] as const
  for (const denominator of candidates) {
    const scaledWidth = Math.ceil(sourceWidth / denominator)
    const scaledHeight = Math.ceil(sourceHeight / denominator)
    if (scaledWidth < target.width || scaledHeight < target.height) continue
    const scaledTarget = calculateResizeDimensions(scaledWidth, scaledHeight, firstStage)
    if (scaledTarget.width === target.width && scaledTarget.height === target.height) {
      return denominator
    }
  }
  return 1
}

const orientationValue = (value: number | undefined): ExifOrientation => {
  if (
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5 ||
    value === 6 ||
    value === 7 ||
    value === 8
  ) {
    return value
  }
  return 1
}

const planOutput = (
  width: number,
  height: number,
  inputFormat: string,
  operations: readonly PipelineOperation[],
  sourceOrientation: ExifOrientation,
): OutputPlan => {
  let decoderRegion: Region = { x: 0, y: 0, width, height }
  let format = inputFormat
  let options: unknown = {}
  let autoOrientSeen = false
  let canPushCrop = sourceOrientation === 1
  const stages: PipelineOperation[] = []

  for (const operation of operations) {
    if (operation.type === 'keepExif' || operation.type === 'keepIcc') continue
    if (operation.type === 'encode') {
      format = operation.format
      options = operation.options
      continue
    }
    if (operation.type === 'autoOrient') {
      if (autoOrientSeen)
        throw unsupportedOperation('Multiple auto-orient stages are not supported')
      autoOrientSeen = true
      if (sourceOrientation !== 1) {
        canPushCrop = false
        stages.push(operation)
      }
    } else if (operation.type === 'crop') {
      if (canPushCrop && stages.length === 0) {
        if (
          operation.x + operation.width > decoderRegion.width ||
          operation.y + operation.height > decoderRegion.height
        ) {
          throw invalidInput(
            `Crop ${operation.x},${operation.y} ${operation.width}x${operation.height} exceeds ${decoderRegion.width}x${decoderRegion.height}`,
          )
        }
        decoderRegion = {
          x: decoderRegion.x + operation.x,
          y: decoderRegion.y + operation.y,
          width: operation.width,
          height: operation.height,
        }
      } else {
        canPushCrop = false
        stages.push(operation)
      }
    } else {
      canPushCrop = false
      stages.push(operation)
    }
  }

  return { format, options, decoderRegion, stages }
}

const validateCrop = (
  width: number,
  height: number,
  operation: Extract<PipelineOperation, { type: 'crop' }>,
): void => {
  if (operation.x + operation.width > width || operation.y + operation.height > height) {
    throw invalidInput(
      `Crop ${operation.x},${operation.y} ${operation.width}x${operation.height} exceeds ${width}x${height}`,
    )
  }
}

export const executePipeline = async (
  context: ExecutionContext,
  operations: readonly PipelineOperation[],
  sink: ImageSink,
): Promise<void> => {
  let encoder: ImageEncoder | undefined
  try {
    if (!context.codec.createDecoder) {
      throw unsupportedOperation(`${context.codec.format} decoding is not implemented`)
    }
    const needsOrientation = operations.some((operation) => operation.type === 'autoOrient')
    const keepExif = operations.some((operation) => operation.type === 'keepExif')
    const keepIcc = operations.some((operation) => operation.type === 'keepIcc')
    if ((keepExif || keepIcc) && !context.codec.preservedMetadata) {
      throw unsupportedOperation(`${context.codec.format} metadata preservation is not implemented`)
    }
    const sourcePreservedMetadata =
      (keepExif || keepIcc) && context.codec.preservedMetadata
        ? await context.codec.preservedMetadata(context.source, context.limits, {
            exif: keepExif,
            icc: keepIcc,
          })
        : {}
    const reoriented = operations.some(
      (operation) =>
        operation.type === 'autoOrient' ||
        operation.type === 'rotate' ||
        operation.type === 'flip' ||
        operation.type === 'flop',
    )
    const exif =
      keepExif && sourcePreservedMetadata.exif
        ? reoriented
          ? normalizeExifOrientation(sourcePreservedMetadata.exif)
          : sourcePreservedMetadata.exif
        : undefined
    const icc = keepIcc ? sourcePreservedMetadata.icc : undefined
    const sourceOrientation = needsOrientation
      ? orientationValue((await context.codec.metadata(context.source, context.limits)).orientation)
      : 1
    const decoder = await context.codec.createDecoder(context.source, context.limits, {
      preserveIcc: icc !== undefined,
    })
    const output = planOutput(
      decoder.width,
      decoder.height,
      context.codec.format,
      operations,
      sourceOrientation,
    )
    const scaleDenominator = selectDecodeScaleDenominator(
      decoder.width,
      decoder.height,
      output.decoderRegion,
      output.stages,
      decoder.capabilities.scaledDecode,
    )
    let width = Math.ceil(output.decoderRegion.width / scaleDenominator)
    let height = Math.ceil(output.decoderRegion.height / scaleDenominator)
    let pixelFormat = decoder.pixelFormat
    let blocks: AsyncIterable<PixelBlock> = decoder.decode(
      scaleDenominator === 1
        ? output.decoderRegion
        : {
            x: 0,
            y: 0,
            width,
            height,
            scaleDenominator,
          },
    )
    for (const operation of output.stages) {
      if (operation.type === 'encode') continue
      if (operation.type === 'crop') {
        validateCrop(width, height, operation)
        blocks = cropPixelBlocks(blocks, width, height, pixelFormat, operation)
        width = operation.width
        height = operation.height
      } else if (operation.type === 'resize') {
        const resize = createResizeTransform(width, height, pixelFormat, operation)
        width = resize.width
        height = resize.height
        pixelFormat = resize.pixelFormat
        blocks = resize.apply(blocks)
      } else if (operation.type === 'autoOrient') {
        const orientation = createOrientationTransform(
          width,
          height,
          pixelFormat,
          sourceOrientation,
          context.runtime,
        )
        width = orientation.width
        height = orientation.height
        blocks = orientation.apply(blocks)
      } else if (operation.type === 'flip' || operation.type === 'flop') {
        const orientation = createOrientationTransform(
          width,
          height,
          pixelFormat,
          operation.type === 'flip' ? 4 : 2,
          context.runtime,
        )
        blocks = orientation.apply(blocks)
      } else if (operation.type === 'rotate') {
        const degrees = normalizedRotation(operation.degrees)
        if (degrees === 0) continue
        if (degrees === 90 || degrees === 180 || degrees === 270) {
          const orientation = createOrientationTransform(
            width,
            height,
            pixelFormat,
            degrees === 90 ? 6 : degrees === 180 ? 3 : 8,
            context.runtime,
          )
          width = orientation.width
          height = orientation.height
          blocks = orientation.apply(blocks)
        } else {
          const rotation = createRotationTransform(
            width,
            height,
            pixelFormat,
            degrees,
            operation.options.background,
            context.runtime,
          )
          width = rotation.width
          height = rotation.height
          pixelFormat = rotation.pixelFormat
          blocks = rotation.apply(blocks)
        }
      }
      validateImageDimensions(width, height, 1, context.limits)
    }
    validateImageDimensions(width, height, 1, context.limits)
    const outputCodec = context.registry.get(output.format)
    if (!outputCodec?.createEncoder) {
      throw unsupportedOperation(`${output.format} encoding is not implemented`)
    }
    encoder = await outputCodec.createEncoder(sink, {
      width,
      height,
      pixelFormat,
      options: output.options,
      runtime: context.runtime,
      ...(!exif && !icc
        ? {}
        : {
            metadata: {
              ...(exif ? { exif } : {}),
              ...(icc ? { icc } : {}),
            },
          }),
    })
    for await (const block of blocks) await encoder.write(block)
    await encoder.finish()
    await sink.close()
  } catch (error) {
    try {
      await encoder?.abort?.(error)
    } finally {
      await sink.abort(error)
    }
    throw error
  }
}
