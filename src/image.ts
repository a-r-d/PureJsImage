import type { CodecRegistry, ImageCodec, ImageMetadata } from './codec.ts'
import { createDefaultCodecRegistry } from './codecs/index.ts'
import { unsupportedOperation } from './errors.ts'
import type { ImageLimitOptions, ImageLimits } from './limits.ts'
import { resolveLimits } from './limits.ts'
import type {
  CropOptions,
  JpegEncodeOptions,
  PipelineOperation,
  PngEncodeOptions,
  ResizeOptions,
} from './pipeline.ts'
import {
  createCropOperation,
  createJpegEncodeOperation,
  createPngEncodeOperation,
  createResizeOperation,
  planMetadata,
} from './pipeline.ts'
import type { ImageInput, ImageSource } from './source.ts'
import { createImageSource } from './source.ts'

export interface ImageOpenOptions {
  limits?: ImageLimitOptions
  registry?: CodecRegistry
}

interface ImageContext {
  readonly source: ImageSource
  readonly codec: ImageCodec
  readonly limits: Readonly<ImageLimits>
  metadataPromise: Promise<ImageMetadata> | undefined
}

const builtInRegistry = createDefaultCodecRegistry()

export class Image {
  readonly #context: ImageContext
  readonly #operations: readonly PipelineOperation[]

  private constructor(context: ImageContext, operations: readonly PipelineOperation[] = []) {
    this.#context = context
    this.#operations = operations
  }

  static async open(input: ImageInput, options: ImageOpenOptions = {}): Promise<Image> {
    const limits = resolveLimits(options.limits)
    const source = await createImageSource(input, limits)
    const registry = options.registry ?? builtInRegistry
    const codec = await registry.detect(source)
    return new Image({ source, codec, limits, metadataPromise: undefined })
  }

  async metadata(): Promise<ImageMetadata> {
    this.#context.metadataPromise ??= this.#context.codec.metadata(
      this.#context.source,
      this.#context.limits,
    )
    return planMetadata(await this.#context.metadataPromise, this.#operations, this.#context.limits)
  }

  autoOrient(): Image {
    return this.#append(Object.freeze({ type: 'autoOrient' }))
  }

  crop(options: CropOptions): Image {
    return this.#append(createCropOperation(options))
  }

  resize(options: ResizeOptions): Image {
    return this.#append(createResizeOperation(options))
  }

  encode(format: 'jpeg', options?: JpegEncodeOptions): Image
  encode(format: 'png', options?: PngEncodeOptions): Image
  encode(format: 'jpeg' | 'png', options: JpegEncodeOptions | PngEncodeOptions = {}): Image {
    if (format === 'jpeg') {
      return this.#append(
        createJpegEncodeOperation({
          ...('quality' in options && options.quality !== undefined
            ? { quality: options.quality }
            : {}),
          ...('progressive' in options && options.progressive !== undefined
            ? { progressive: options.progressive }
            : {}),
          ...('background' in options && options.background !== undefined
            ? { background: options.background }
            : {}),
        }),
      )
    }
    return this.#append(
      createPngEncodeOperation({
        ...('compressionLevel' in options && options.compressionLevel !== undefined
          ? { compressionLevel: options.compressionLevel }
          : {}),
      }),
    )
  }

  jpeg(options: JpegEncodeOptions = {}): Image {
    return this.#append(createJpegEncodeOperation(options))
  }

  png(options: PngEncodeOptions = {}): Image {
    return this.#append(createPngEncodeOperation(options))
  }

  async toBuffer(): Promise<Buffer> {
    throw unsupportedOperation('Pixel execution begins in Phase 2 with PNG decoding and encoding')
  }

  async toFile(_path: string): Promise<void> {
    throw unsupportedOperation('Pixel execution begins in Phase 2 with PNG decoding and encoding')
  }

  #append(operation: PipelineOperation): Image {
    return new Image(this.#context, Object.freeze([...this.#operations, operation]))
  }
}
