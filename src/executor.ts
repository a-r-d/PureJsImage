import type { CodecRegistry, ImageCodec, ImageEncoder } from './codec.ts'
import { invalidInput, unsupportedOperation } from './errors.ts'
import type { ImageLimits } from './limits.ts'
import type { PipelineOperation } from './pipeline.ts'
import type { ImageSink } from './sink.ts'
import type { ImageSource } from './source.ts'

interface ExecutionContext {
  readonly source: ImageSource
  readonly codec: ImageCodec
  readonly registry: CodecRegistry
  readonly limits: ImageLimits
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
  readonly region: Region
}

const planOutput = (
  width: number,
  height: number,
  inputFormat: string,
  operations: readonly PipelineOperation[],
): OutputPlan => {
  let region: Region = { x: 0, y: 0, width, height }
  let format = inputFormat
  let options: unknown = {}

  for (const operation of operations) {
    if (operation.type === 'crop') {
      if (
        operation.x + operation.width > region.width ||
        operation.y + operation.height > region.height
      ) {
        throw invalidInput(
          `Crop ${operation.x},${operation.y} ${operation.width}x${operation.height} exceeds ${region.width}x${region.height}`,
        )
      }
      region = {
        x: region.x + operation.x,
        y: region.y + operation.y,
        width: operation.width,
        height: operation.height,
      }
    } else if (operation.type === 'resize') {
      throw unsupportedOperation('Pixel resize execution begins in Phase 3')
    } else if (operation.type === 'encode') {
      format = operation.format
      options = operation.options
    }
  }

  return { format, options, region }
}

export const executePipeline = async (
  context: ExecutionContext,
  operations: readonly PipelineOperation[],
  sink: ImageSink,
): Promise<void> => {
  let encoder: ImageEncoder | undefined
  try {
    if (operations.some((operation) => operation.type === 'resize')) {
      throw unsupportedOperation('Pixel resize execution begins in Phase 3')
    }
    if (!context.codec.createDecoder) {
      throw unsupportedOperation(`${context.codec.format} decoding is not implemented`)
    }
    const decoder = await context.codec.createDecoder(context.source, context.limits)
    const output = planOutput(decoder.width, decoder.height, context.codec.format, operations)
    const outputCodec = context.registry.get(output.format)
    if (!outputCodec?.createEncoder) {
      throw unsupportedOperation(`${output.format} encoding is not implemented`)
    }
    encoder = await outputCodec.createEncoder(sink, {
      width: output.region.width,
      height: output.region.height,
      pixelFormat: decoder.pixelFormat,
      options: output.options,
    })
    for await (const block of decoder.decode(output.region)) await encoder.write(block)
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
