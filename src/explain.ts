import { unsupportedOperation } from './errors.ts'
import {
  containingAlignedRegion,
  orientationValue,
  planOutput,
  selectDecodeScaleDenominator,
  type DecodeScaleDenominator,
  type ExecutionContext,
  type Region,
} from './executor.ts'
import {
  imageExecutionPlanInput,
  type ExplainImageOptions,
  type ImageExecutionPlanTarget,
} from './execution-plan-contract.ts'
import {
  describePrecisionExecution,
  type PrecisionExecutionPlanDescription,
} from './precision-plan.ts'
import { withSourceSession } from './source.ts'

export interface ImageExecutionPlanDescription {
  readonly version: 1
  readonly source: {
    readonly format: string
    readonly width: number
    readonly height: number
    readonly pixelFormat: string
  }
  readonly requestedOperations: readonly string[]
  readonly decoderCapabilities: {
    readonly sequential: boolean
    readonly regionDecode: boolean
    readonly scaledDecode: boolean
    readonly progressive: boolean
  }
  readonly decoderRegion: Region
  readonly scaleDenominator: DecodeScaleDenominator
  readonly pushedOperations: readonly string[]
  readonly remainingStages: readonly string[]
  readonly eliminatedStages: readonly string[]
  readonly fullFrameFallbackReasons: readonly string[]
  readonly output: { readonly format: string; readonly width: number; readonly height: number }
  readonly precision: PrecisionExecutionPlanDescription
  readonly io: { readonly metadataReads: 'codec-dependent'; readonly pixelDecode: false }
}

const explainImageInSession = async (
  input: ReturnType<ImageExecutionPlanTarget[typeof imageExecutionPlanInput]>,
  options: Readonly<ExplainImageOptions> = {},
): Promise<ImageExecutionPlanDescription> => {
  const context: ExecutionContext = input.context
  const operations = input.operations
  if (!context.codec.createDecoder)
    throw unsupportedOperation(`${context.codec.format} decoding is not implemented`)
  const needsOrientation = operations.some((operation) => operation.type === 'autoOrient')
  const sourceOrientation = needsOrientation
    ? orientationValue(
        (await context.codec.metadata(context.source, context.limits, options)).orientation,
      )
    : 1
  const decoder = await context.codec.createDecoder(context.source, context.limits, {
    tolerantDecoding: context.tolerantDecoding,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(context.frame === undefined ? {} : { frame: context.frame }),
    ...(context.resolutionLevel === undefined ? {} : { resolutionLevel: context.resolutionLevel }),
  })
  const planned = planOutput(
    decoder.width,
    decoder.height,
    context.codec.format,
    operations,
    sourceOrientation,
  )
  const requestedRegion = planned.decoderRegion
  const isFullFrame =
    requestedRegion.x === 0 &&
    requestedRegion.y === 0 &&
    requestedRegion.width === decoder.width &&
    requestedRegion.height === decoder.height
  const fallback = !decoder.capabilities.regionDecode && !isFullFrame
  const output = fallback
    ? {
        ...planned,
        decoderRegion: { x: 0, y: 0, width: decoder.width, height: decoder.height },
        stages: [{ type: 'crop' as const, ...requestedRegion }, ...planned.stages],
      }
    : planned
  const outputCodec = context.registry.get(output.format)
  if (!outputCodec?.createEncoder)
    throw unsupportedOperation(`${output.format} encoding is not implemented`)
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
  const width = decoderRegion.width / scaleDenominator
  const height = decoderRegion.height / scaleDenominator
  const precision = describePrecisionExecution({
    width,
    height,
    pixelFormat: decoder.pixelFormat,
    ...(decoder.colorSemantics === undefined ? {} : { colorSemantics: decoder.colorSemantics }),
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
  const finalStage = precision.stages[precision.stages.length - 1]
  const pushedCrop = !fallback && !isFullFrame
  return Object.freeze({
    version: 1,
    source: Object.freeze({
      format: context.codec.format,
      width: decoder.width,
      height: decoder.height,
      pixelFormat: decoder.pixelFormat,
    }),
    requestedOperations: Object.freeze(
      operations.map((operation) =>
        operation.type === 'encode' ? `encode:${operation.format}` : operation.type,
      ),
    ),
    decoderCapabilities: Object.freeze({ ...decoder.capabilities }),
    decoderRegion: Object.freeze({ ...decoderRegion }),
    scaleDenominator,
    pushedOperations: Object.freeze([
      ...(pushedCrop ? ['crop'] : []),
      ...(scaleDenominator === 1 ? [] : ['resize']),
    ]),
    remainingStages: Object.freeze(output.stages.map((operation) => operation.type)),
    eliminatedStages: Object.freeze(
      operations
        .filter(
          (operation) =>
            operation.type === 'keepExif' ||
            operation.type === 'keepIcc' ||
            (operation.type === 'autoOrient' && sourceOrientation === 1),
        )
        .map((operation) => operation.type),
    ),
    fullFrameFallbackReasons: Object.freeze(
      fallback ? ['decoder does not support region decoding'] : [],
    ),
    output: Object.freeze({
      format: output.format,
      width: finalStage?.outputWidth ?? width,
      height: finalStage?.outputHeight ?? height,
    }),
    precision,
    io: Object.freeze({ metadataReads: 'codec-dependent' as const, pixelDecode: false as const }),
  })
}

export const explainImage = async (
  image: ImageExecutionPlanTarget,
  options: Readonly<ExplainImageOptions> = {},
): Promise<ImageExecutionPlanDescription> => {
  const input = image[imageExecutionPlanInput]()
  return withSourceSession(input.context.source, () => explainImageInSession(input, options))
}
