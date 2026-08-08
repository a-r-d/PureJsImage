import { CodecRegistry, type ImageCodec, type ImageMetadata } from './codec.ts'
import { executePipeline } from './executor.ts'
import type { ImageLimitOptions, ImageLimits } from './limits.ts'
import { resolveLimits } from './limits.ts'
import type {
  BmpEncodeOptions,
  CropOptions,
  JpegEncodeOptions,
  PipelineOperation,
  PngEncodeOptions,
  ResizeOptions,
  RotateOptions,
  TiffEncodeOptions,
  WebpEncodeOptions,
} from './pipeline.ts'
import {
  createBmpEncodeOperation,
  createCropOperation,
  createJpegEncodeOperation,
  createPngEncodeOperation,
  createResizeOperation,
  createRotateOperation,
  createTiffEncodeOperation,
  createWebpEncodeOperation,
  planMetadata,
} from './pipeline.ts'
import { BufferSink, FileSink } from './sink.ts'
import type { ImageInput, ImageSource } from './source.ts'
import { createImageSource } from './source.ts'

export interface ImageOpenOptions {
  limits?: ImageLimitOptions
}

export interface ImageLibrary {
  formats(): readonly string[]
  open(input: ImageInput, options?: ImageOpenOptions): Promise<Image>
}

interface ImageContext {
  readonly source: ImageSource
  readonly codec: ImageCodec
  readonly registry: CodecRegistry
  readonly limits: Readonly<ImageLimits>
  metadataPromise: Promise<ImageMetadata> | undefined
}

export class Image {
  readonly #context: ImageContext
  readonly #operations: readonly PipelineOperation[]

  private constructor(context: ImageContext, operations: readonly PipelineOperation[] = []) {
    this.#context = context
    this.#operations = operations
  }

  static async open(
    input: ImageInput,
    registry: CodecRegistry,
    options: ImageOpenOptions = {},
  ): Promise<Image> {
    const limits = resolveLimits(options.limits)
    const source = await createImageSource(input, limits)
    const codec = await registry.detect(source)
    return new Image({ source, codec, registry, limits, metadataPromise: undefined })
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

  keepExif(): Image {
    return this.#append(Object.freeze({ type: 'keepExif' }))
  }

  keepIcc(): Image {
    return this.#append(Object.freeze({ type: 'keepIcc' }))
  }

  crop(options: CropOptions): Image {
    return this.#append(createCropOperation(options))
  }

  resize(options: ResizeOptions): Image {
    return this.#append(createResizeOperation(options))
  }

  rotate(degrees: number, options: RotateOptions = {}): Image {
    return this.#append(createRotateOperation(degrees, options))
  }

  flip(): Image {
    return this.#append(Object.freeze({ type: 'flip' }))
  }

  flop(): Image {
    return this.#append(Object.freeze({ type: 'flop' }))
  }

  encode(format: 'jpeg', options?: JpegEncodeOptions): Image
  encode(format: 'png', options?: PngEncodeOptions): Image
  encode(format: 'webp', options?: WebpEncodeOptions): Image
  encode(format: 'bmp', options?: BmpEncodeOptions): Image
  encode(format: 'tiff', options?: TiffEncodeOptions): Image
  encode(
    format: 'bmp' | 'jpeg' | 'png' | 'tiff' | 'webp',
    options:
      | BmpEncodeOptions
      | JpegEncodeOptions
      | PngEncodeOptions
      | TiffEncodeOptions
      | WebpEncodeOptions = {},
  ): Image {
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
          ...('chromaSubsampling' in options && options.chromaSubsampling !== undefined
            ? { chromaSubsampling: options.chromaSubsampling }
            : {}),
        }),
      )
    }
    if (format === 'png') {
      return this.#append(
        createPngEncodeOperation({
          ...('compressionLevel' in options && options.compressionLevel !== undefined
            ? { compressionLevel: options.compressionLevel }
            : {}),
        }),
      )
    }
    if (format === 'bmp') {
      return this.#append(
        createBmpEncodeOperation({
          ...('alpha' in options && options.alpha !== undefined ? { alpha: options.alpha } : {}),
        }),
      )
    }
    if (format === 'tiff') {
      return this.#append(
        createTiffEncodeOperation({
          ...('compression' in options && options.compression !== undefined
            ? { compression: options.compression }
            : {}),
        }),
      )
    }
    return this.#append(
      createWebpEncodeOperation({
        ...('lossless' in options && options.lossless !== undefined
          ? { lossless: options.lossless }
          : {}),
        ...('quality' in options && options.quality !== undefined
          ? { quality: options.quality }
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

  webp(options: WebpEncodeOptions = {}): Image {
    return this.#append(createWebpEncodeOperation(options))
  }

  bmp(options: BmpEncodeOptions = {}): Image {
    return this.#append(createBmpEncodeOperation(options))
  }

  tiff(options: TiffEncodeOptions = {}): Image {
    return this.#append(createTiffEncodeOperation(options))
  }

  async toBuffer(): Promise<Buffer> {
    const sink = new BufferSink()
    await executePipeline(this.#context, this.#operations, sink)
    return sink.toBuffer()
  }

  async toFile(path: string): Promise<void> {
    await executePipeline(this.#context, this.#operations, new FileSink(path))
  }

  #append(operation: PipelineOperation): Image {
    return new Image(this.#context, Object.freeze([...this.#operations, operation]))
  }
}

export const createImageLibrary = (codecs: Iterable<ImageCodec>): ImageLibrary => {
  const registry = new CodecRegistry(codecs)
  return Object.freeze({
    formats: (): readonly string[] => registry.formats(),
    open: (input: ImageInput, options?: ImageOpenOptions): Promise<Image> =>
      Image.open(input, registry, options),
  })
}
