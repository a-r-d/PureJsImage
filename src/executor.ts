import type { CodecRegistry, ImageCodec, ImageEncoder } from './codec.ts'
import { invalidInput, unsupportedOperation } from './errors.ts'
import type { ImageLimits } from './limits.ts'
import { validateImageDimensions } from './limits.ts'
import type { PipelineOperation, ResizeOptions } from './pipeline.ts'
import type { PixelBlock } from './pixel.ts'
import { createResizeTransform } from './resize.ts'
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
  readonly resize: Readonly<ResizeOptions> | undefined
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
  let resize: Readonly<ResizeOptions> | undefined

  for (const operation of operations) {
    if (operation.type === 'crop') {
      if (resize) throw unsupportedOperation('Crop after resize is not implemented yet')
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
      if (resize) throw unsupportedOperation('Multiple resize stages are not implemented yet')
      resize = operation
    } else if (operation.type === 'encode') {
      format = operation.format
      options = operation.options
    }
  }

  return { format, options, region, resize }
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
    const decoder = await context.codec.createDecoder(context.source, context.limits)
    const output = planOutput(decoder.width, decoder.height, context.codec.format, operations)
    let width = output.region.width
    let height = output.region.height
    let pixelFormat = decoder.pixelFormat
    let blocks: AsyncIterable<PixelBlock> = decoder.decode(output.region)
    if (output.resize) {
      const resize = createResizeTransform(width, height, pixelFormat, output.resize)
      width = resize.width
      height = resize.height
      pixelFormat = resize.pixelFormat
      blocks = resize.apply(blocks)
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
