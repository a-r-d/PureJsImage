import type { AbortOptions } from './abort.ts'
import { throwIfAborted } from './abort.ts'
import type { CodecRegistry, ImageCodec, ImageEncoder } from './codec.ts'
import { convertedPixelColorSemantics, convertPixelBlocks } from './convert.ts'
import { cropPixelBlocks } from './crop.ts'
import { ImageError, invalidInput, unsupportedOperation } from './errors.ts'
import type { ImageLimits } from './limits.ts'
import { validateImageDimensions } from './limits.ts'
import { applyLutPixelBlocks } from './lut.ts'
import { normalizeExifOrientation } from './metadata.ts'
import { createOrientationTransform, type ExifOrientation } from './orient.ts'
import {
  calculateResizeDimensions,
  normalizedRotation,
  type PipelineOperation,
} from './pipeline.ts'
import { normalizedPixelFormat, normalizePixelBlocks, type PixelBlock } from './pixel.ts'
import { describePrecisionExecution, transformAcceptsPixelFormat } from './precision-plan.ts'
import { createResizeTransform } from './resize.ts'
import { createRotationTransform } from './rotate.ts'
import type { ImageRuntime } from './runtime.ts'
import type { ImageSink } from './sink.ts'
import { drainSourceEvidenceDependencies, type ImageSource } from './source.ts'
import type { EvidenceContext } from './evidence.ts'

export interface ExecutionContext {
  readonly source: ImageSource
  readonly codec: ImageCodec
  readonly registry: CodecRegistry
  readonly frame: number | undefined
  readonly resolutionLevel: number | undefined
  readonly tolerantDecoding: boolean
  readonly limits: ImageLimits
  readonly runtime: ImageRuntime
}

export interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface OutputPlan {
  readonly format: string
  readonly options: unknown
  readonly decoderRegion: Region
  readonly stages: readonly PipelineOperation[]
  readonly window?: Extract<PipelineOperation, { type: 'window' }>
}

export interface PipelineExecutionOptions extends AbortOptions {
  readonly evidence?: EvidenceContext
}

export type DecodeScaleDenominator = 1 | 2 | 4 | 8

export const containingAlignedRegion = (
  region: Region,
  sourceWidth: number,
  sourceHeight: number,
  step: number,
): Region | undefined => {
  const x = ((region.x / step) | 0) * step
  const y = ((region.y / step) | 0) * step
  const width = Math.min(sourceWidth, Math.ceil((region.x + region.width) / step) * step) - x
  const height = Math.min(sourceHeight, Math.ceil((region.y + region.height) / step) * step) - y
  return width < step || height < step || width % step || height % step
    ? undefined
    : { x, y, width, height }
}

export const selectDecodeScaleDenominator = (
  sourceWidth: number,
  sourceHeight: number,
  decoderRegion: Region,
  stages: readonly PipelineOperation[],
  scaledDecode: boolean,
): DecodeScaleDenominator => {
  const firstStage = stages[0]
  if (!scaledDecode || firstStage?.type !== 'resize') return 1
  const target = calculateResizeDimensions(decoderRegion.width, decoderRegion.height, firstStage)
  for (const denominator of [8, 4, 2] as const) {
    const region = containingAlignedRegion(decoderRegion, sourceWidth, sourceHeight, denominator)
    if (!region) continue
    const scaledWidth = region.width / denominator
    const scaledHeight = region.height / denominator
    if (scaledWidth < target.width || scaledHeight < target.height) continue
    const scaled = calculateResizeDimensions(scaledWidth, scaledHeight, firstStage)
    if (scaled.width === target.width && scaled.height === target.height) return denominator
  }
  return 1
}

export const orientationValue = (value: number | undefined): ExifOrientation => {
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

export const planOutput = (
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
  let window: Extract<PipelineOperation, { type: 'window' }> | undefined
  let canPushCrop = sourceOrientation === 1
  const stages: PipelineOperation[] = []

  for (const operation of operations) {
    if (operation.type === 'keepExif' || operation.type === 'keepIcc') continue
    if (operation.type === 'encode') {
      format = operation.format
      options = operation.options
      continue
    }
    if (operation.type === 'window') {
      if (window) throw unsupportedOperation('Multiple window stages are not supported')
      if (stages.length > 0) {
        throw unsupportedOperation(
          'Window must precede resize, rotation, flip, flop, and LUT stages',
        )
      }
      window = operation
    } else if (operation.type === 'autoOrient') {
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

  return { format, options, decoderRegion, stages, ...(window === undefined ? {} : { window }) }
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

const executionFailureCode = (error: unknown): string =>
  error instanceof ImageError ? error.code : 'UNKNOWN'

const instrumentDecodedBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  source: ImageSource,
  evidence: EvidenceContext,
  decodedIds: string[],
): AsyncIterable<PixelBlock> {
  evidence.operation({ operationId: 'decode', phase: 'start' })
  let blockIndex = 0
  try {
    for await (const block of blocks) {
      const decodedBlockId = `decoded-block:${blockIndex}`
      const sourceDependencies = source[drainSourceEvidenceDependencies]?.() ?? []
      evidence.dependency({
        outputId: decodedBlockId,
        inputIds: sourceDependencies,
        granularity: 'block',
      })
      evidence.block({
        stage: 'decoded',
        blockId: decodedBlockId,
        width: block.width,
        height: block.height,
      })
      if (decodedIds.length < 255) decodedIds.push(decodedBlockId)
      evidence.operation({
        operationId: blockIndex === 0 ? 'first-decoded-block' : 'decoded-block',
        phase: 'complete',
        detail: `${block.width}x${block.height} ${block.format}`,
      })
      blockIndex += 1
      yield block
    }
    evidence.operation({
      operationId: 'decode',
      phase: 'complete',
      detail: `${blockIndex} blocks`,
    })
  } catch (error) {
    evidence.operation({
      operationId: 'decode',
      phase: 'failed',
      failureCode: executionFailureCode(error),
    })
    throw error
  }
}

const instrumentOperationBlocks = async function* (
  blocks: AsyncIterable<PixelBlock>,
  evidence: EvidenceContext,
  operationId: string,
): AsyncIterable<PixelBlock> {
  evidence.operation({ operationId, phase: 'start' })
  try {
    yield* blocks
    evidence.operation({ operationId, phase: 'complete' })
  } catch (error) {
    evidence.operation({
      operationId,
      phase: 'failed',
      failureCode: executionFailureCode(error),
    })
    throw error
  }
}

export const executePipeline = async (
  context: ExecutionContext,
  operations: readonly PipelineOperation[],
  sink: ImageSink,
  options: Readonly<PipelineExecutionOptions> = {},
): Promise<void> => {
  let encoder: ImageEncoder | undefined
  options.evidence?.operation({ operationId: 'pipeline', phase: 'start' })
  try {
    throwIfAborted(options.signal)
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
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            ...(context.frame === undefined ? {} : { frame: context.frame }),
            ...(context.resolutionLevel === undefined
              ? {}
              : { resolutionLevel: context.resolutionLevel }),
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
      ? orientationValue(
          (
            await context.codec.metadata(context.source, context.limits, {
              ...(options.signal === undefined ? {} : { signal: options.signal }),
              ...(context.frame === undefined ? {} : { frame: context.frame }),
              ...(context.resolutionLevel === undefined
                ? {}
                : { resolutionLevel: context.resolutionLevel }),
            })
          ).orientation,
        )
      : 1
    options.evidence?.operation({ operationId: 'decoder-open', phase: 'start' })
    const decoder = await context.codec.createDecoder(context.source, context.limits, {
      preserveIcc: icc !== undefined,
      tolerantDecoding: context.tolerantDecoding,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(context.frame === undefined ? {} : { frame: context.frame }),
      ...(context.resolutionLevel === undefined
        ? {}
        : { resolutionLevel: context.resolutionLevel }),
      ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
    })
    options.evidence?.operation({ operationId: 'decoder-open', phase: 'complete' })
    const plannedOutput = planOutput(
      decoder.width,
      decoder.height,
      context.codec.format,
      operations,
      sourceOrientation,
    )
    const requestedRegion = plannedOutput.decoderRegion
    const isFullFrame =
      requestedRegion.x === 0 &&
      requestedRegion.y === 0 &&
      requestedRegion.width === decoder.width &&
      requestedRegion.height === decoder.height
    const output: OutputPlan =
      decoder.capabilities.regionDecode || isFullFrame
        ? plannedOutput
        : {
            ...plannedOutput,
            decoderRegion: {
              x: 0,
              y: 0,
              width: decoder.width,
              height: decoder.height,
            },
            stages: [
              {
                type: 'crop',
                x: requestedRegion.x,
                y: requestedRegion.y,
                width: requestedRegion.width,
                height: requestedRegion.height,
              },
              ...plannedOutput.stages,
            ],
          }
    const outputCodec = context.registry.get(output.format)
    if (!outputCodec?.createEncoder) {
      throw unsupportedOperation(`${output.format} encoding is not implemented`)
    }
    const scaleDenominator = selectDecodeScaleDenominator(
      decoder.width,
      decoder.height,
      output.decoderRegion,
      output.stages,
      decoder.capabilities.scaledDecode,
    )
    const decoderRegion =
      containingAlignedRegion(
        output.decoderRegion,
        decoder.width,
        decoder.height,
        scaleDenominator,
      ) ?? output.decoderRegion
    options.evidence?.operation({
      operationId: 'pipeline',
      phase: 'planned',
      detail: `${context.codec.format}->${output.format}`,
    })
    if (!decoder.capabilities.regionDecode && !isFullFrame) {
      options.evidence?.operation({
        operationId: 'decode',
        phase: 'fallback',
        detail: 'decoder does not support region decoding',
      })
    }
    let width = decoderRegion.width / scaleDenominator
    let height = decoderRegion.height / scaleDenominator
    const sourcePixelFormat = decoder.pixelFormat
    if (output.window && !sourcePixelFormat.startsWith('gray')) {
      throw unsupportedOperation(`Window input must be grayscale, received ${sourcePixelFormat}`)
    }
    let pixelFormat = sourcePixelFormat
    let colorSemantics = decoder.colorSemantics
    const precisionPlan = describePrecisionExecution({
      width,
      height,
      pixelFormat,
      ...(colorSemantics === undefined ? {} : { colorSemantics }),
      operations: [...(output.window === undefined ? [] : [output.window]), ...output.stages],
      encoderFormat: output.format,
      ...(outputCodec.encoderPixelFormats === undefined
        ? {}
        : { encoderPixelFormats: outputCodec.encoderPixelFormats }),
      ...(outputCodec.acceptsColorSemantics === undefined
        ? {}
        : { encoderAcceptsColorSemantics: outputCodec.acceptsColorSemantics }),
      sourceOrientation,
    })
    for (const stage of precisionPlan.stages) {
      options.evidence?.operation({
        operationId: stage.operation,
        phase: 'planned',
        ...(stage.precisionLossReason === undefined ? {} : { detail: stage.precisionLossReason }),
      })
    }
    const decodedIds: string[] | undefined = options.evidence === undefined ? undefined : []
    let blocks: AsyncIterable<PixelBlock> = decoder.decode(
      scaleDenominator === 1
        ? {
            ...decoderRegion,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          }
        : {
            x: decoderRegion.x / scaleDenominator,
            y: decoderRegion.y / scaleDenominator,
            width,
            height,
            scaleDenominator,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          },
    )
    if (options.evidence !== undefined && decodedIds !== undefined) {
      blocks = instrumentDecodedBlocks(blocks, context.source, options.evidence, decodedIds)
    }
    if (output.window) {
      blocks = normalizePixelBlocks(blocks, sourcePixelFormat, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
        displayRanges: [
          {
            black: output.window.options.center - output.window.options.width / 2,
            white: output.window.options.center + output.window.options.width / 2,
          },
        ],
      })
      pixelFormat = normalizedPixelFormat(sourcePixelFormat)
      colorSemantics = undefined
      if (options.evidence !== undefined)
        blocks = instrumentOperationBlocks(blocks, options.evidence, 'window')
    }
    for (const operation of output.stages) {
      if (operation.type === 'encode' || operation.type === 'window') continue
      if (!transformAcceptsPixelFormat(operation, pixelFormat)) {
        throw unsupportedOperation(`${operation.type} does not support ${pixelFormat} pixels`)
      }
      if (operation.type === 'convertPixelFormat') {
        blocks = convertPixelBlocks(blocks, pixelFormat, operation.options, options)
        pixelFormat = operation.options.format
        colorSemantics = convertedPixelColorSemantics(colorSemantics, pixelFormat)
      } else if (operation.type === 'lut') {
        blocks = applyLutPixelBlocks(blocks, pixelFormat, operation.options, options)
        pixelFormat = operation.options.format
      } else if (operation.type === 'crop') {
        validateCrop(width, height, operation)
        blocks = cropPixelBlocks(blocks, width, height, pixelFormat, operation)
        width = operation.width
        height = operation.height
      } else if (operation.type === 'resize') {
        const resize = createResizeTransform(width, height, pixelFormat, operation, colorSemantics)
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
      if (options.evidence !== undefined)
        blocks = instrumentOperationBlocks(blocks, options.evidence, operation.type)
      throwIfAborted(options.signal)
      validateImageDimensions(width, height, 1, context.limits)
    }
    validateImageDimensions(width, height, 1, context.limits)

    if (!outputCodec.encoderPixelFormats?.includes(pixelFormat)) {
      const inputFormat = pixelFormat
      blocks = normalizePixelBlocks(blocks, inputFormat, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      pixelFormat = normalizedPixelFormat(inputFormat)
      colorSemantics = undefined
      if (options.evidence !== undefined)
        blocks = instrumentOperationBlocks(blocks, options.evidence, 'encoder-input-conversion')
    }
    if (
      colorSemantics !== undefined &&
      outputCodec.acceptsColorSemantics?.(colorSemantics) === false
    ) {
      throw unsupportedOperation(
        `${output.format} encoder does not accept the current pixel color semantics`,
      )
    }

    options.evidence?.operation({ operationId: 'encoder-open', phase: 'start' })
    encoder = await outputCodec.createEncoder(sink, {
      width,
      height,
      pixelFormat,
      ...(colorSemantics === undefined ? {} : { colorSemantics }),
      options: output.options,
      runtime: context.runtime,
      limits: context.limits,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(!exif && !icc
        ? {}
        : {
            metadata: {
              ...(exif ? { exif } : {}),
              ...(icc ? { icc } : {}),
            },
          }),
    })
    options.evidence?.operation({ operationId: 'encoder-open', phase: 'complete' })
    let blockIndex = 0
    for await (const block of blocks) {
      const lease = options.evidence?.allocate('decoded-pixel-block', block.data.byteLength)
      try {
        throwIfAborted(options.signal)
        await encoder.write(block)
        options.evidence?.dependency({
          outputId: `encoded-block:${blockIndex}`,
          inputIds: Object.freeze([...(decodedIds ?? []), 'operation:pipeline']),
          granularity: 'block',
        })
        options.evidence?.block({
          stage: 'encoded',
          blockId: `encoded-block:${blockIndex}`,
          width: block.width,
          height: block.height,
        })
        options.evidence?.operation({
          operationId: blockIndex === 0 ? 'first-output-block' : 'encoded-block',
          phase: 'complete',
          detail: `${block.width}x${block.height} ${block.format}`,
        })
        throwIfAborted(options.signal)
      } finally {
        lease?.release()
        block.release?.()
      }
      blockIndex += 1
    }
    await encoder.finish()
    throwIfAborted(options.signal)
    await sink.close()
    options.evidence?.operation({ operationId: 'pipeline', phase: 'complete' })
  } catch (error) {
    if (options.signal?.aborted === true) {
      options.evidence?.cancellation('pipeline')
      options.evidence?.operation({ operationId: 'pipeline', phase: 'cancelled' })
    } else {
      options.evidence?.operation({
        operationId: 'pipeline',
        phase: 'failed',
        failureCode: executionFailureCode(error),
      })
    }
    try {
      await encoder?.abort?.(error)
    } finally {
      await sink.abort(error)
    }
    throw error
  }
}
