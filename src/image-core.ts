import type { AbortOptions } from './abort.ts'
import { throwIfAborted } from './abort.ts'
import { type ImageLibraryRegistration, resolveCodecRegistration } from './accelerator.ts'
import { CodecRegistry, type ImageCodec, type ImageMetadata } from './codec.ts'
import { invalidInput, unsupportedOperation } from './errors.ts'
import type { EvidenceContext } from './evidence.ts'
import { imageExecutionPlanInput } from './execution-plan-contract.ts'
import type { ImageLimitOptions, ImageLimits } from './limits.ts'
import { resolveLimits } from './limits.ts'
import type {
  AvifEncodeOptions,
  BmpEncodeOptions,
  ConvertPixelFormatOptions,
  CropOptions,
  HdrEncodeOptions,
  JpegEncodeOptions,
  JpegXlEncodeOptions,
  LutOptions,
  NetpbmEncodeOptions,
  PamEncodeOptions,
  PbmEncodeOptions,
  PfmEncodeOptions,
  PgmEncodeOptions,
  PipelineOperation,
  PngEncodeOptions,
  PpmEncodeOptions,
  QoiEncodeOptions,
  ResizeOptions,
  RotateOptions,
  TgaEncodeOptions,
  TiffEncodeOptions,
  WebpEncodeOptions,
  WindowOptions,
} from './pipeline.ts'
import {
  createAvifEncodeOperation,
  createBmpEncodeOperation,
  createConvertPixelFormatOperation,
  createCropOperation,
  createHdrEncodeOperation,
  createJpegEncodeOperation,
  createJpegXlEncodeOperation,
  createLutOperation,
  createNetpbmEncodeOperation,
  createPngEncodeOperation,
  createQoiEncodeOperation,
  createResizeOperation,
  createRotateOperation,
  createTgaEncodeOperation,
  createTiffEncodeOperation,
  createWebpEncodeOperation,
  createWindowOperation,
  planMetadata,
} from './pipeline.ts'
import type { CollectedOutput, ImageRuntime } from './runtime.ts'
import type { ImageSink } from './sink.ts'
import { bindImageSourceSignal, type ImageSource, withSourceSession } from './source.ts'

export interface ImageExecutionOptions extends AbortOptions {
  /** Explicit caller-owned evidence context. Omit for the allocation-free default path. */
  readonly evidence?: EvidenceContext
}

export interface ImageOpenOptions extends AbortOptions {
  readonly limits?: ImageLimitOptions
  readonly frame?: number
  readonly resolutionLevel?: number
  readonly tolerantDecoding?: boolean
}

export interface ImagePlatform<Input, Output extends Uint8Array> {
  readonly runtime: ImageRuntime
  createImageSource(
    input: Input,
    limits: ImageLimits,
    options?: Readonly<AbortOptions>,
  ): Promise<ImageSource>
  createCollectedOutput(): CollectedOutput<Output>
  createFileSink?(path: string): ImageSink
}

export interface ImageLibrary<Input, Output extends Uint8Array> {
  formats(): readonly string[]
  open(input: Input, options?: ImageOpenOptions): Promise<Image<Input, Output>>
}

interface ImageContext<Input, Output extends Uint8Array> {
  readonly source: ImageSource
  readonly codec: ImageCodec
  readonly registry: CodecRegistry
  readonly limits: Readonly<ImageLimits>
  readonly frame: number | undefined
  readonly resolutionLevel: number | undefined
  readonly tolerantDecoding: boolean
  readonly platform: ImagePlatform<Input, Output>
  readonly runtime: ImageRuntime
  metadataPromise: Promise<ImageMetadata> | undefined
}

export class Image<Input, Output extends Uint8Array> {
  readonly #context: ImageContext<Input, Output>
  readonly #operations: readonly PipelineOperation[]

  private constructor(
    context: ImageContext<Input, Output>,
    operations: readonly PipelineOperation[] = [],
  ) {
    this.#context = context
    this.#operations = operations
  }

  static async open<Input, Output extends Uint8Array>(
    input: Input,
    registry: CodecRegistry,
    platform: ImagePlatform<Input, Output>,
    options: ImageOpenOptions = {},
  ): Promise<Image<Input, Output>> {
    if (
      options.frame !== undefined &&
      (!Number.isSafeInteger(options.frame) || options.frame < 0)
    ) {
      throw invalidInput('frame must be a non-negative safe integer')
    }
    if (
      options.resolutionLevel !== undefined &&
      (!Number.isSafeInteger(options.resolutionLevel) || options.resolutionLevel < 0)
    ) {
      throw invalidInput('resolutionLevel must be a non-negative safe integer')
    }
    if (options.tolerantDecoding !== undefined && typeof options.tolerantDecoding !== 'boolean') {
      throw invalidInput('tolerantDecoding must be a boolean')
    }
    const limits = resolveLimits(options.limits)
    throwIfAborted(options.signal)
    const source = await platform.createImageSource(input, limits, options)
    const codec = await withSourceSession(source, () => registry.detect(source, options))
    if (options.frame !== undefined && options.frame !== 0 && codec.selection?.frames !== true) {
      throw unsupportedOperation(
        'Only frame 0 can be selected; later frame selection is unsupported',
      )
    }
    if (
      options.resolutionLevel !== undefined &&
      options.resolutionLevel !== 0 &&
      codec.selection?.resolutionLevels !== true
    ) {
      throw unsupportedOperation(`${codec.format} does not support reduced-resolution selection`)
    }
    return new Image({
      source,
      codec,
      frame: options.frame,
      resolutionLevel: options.resolutionLevel,
      tolerantDecoding: options.tolerantDecoding ?? true,
      registry,
      limits,
      platform,
      runtime: platform.runtime,
      metadataPromise: undefined,
    })
  }

  async metadata(options: Readonly<AbortOptions> = {}): Promise<ImageMetadata> {
    const load = (): Promise<ImageMetadata> => {
      const source = bindImageSourceSignal(this.#context.source, options.signal)
      return withSourceSession(source, () =>
        this.#context.codec.metadata(source, this.#context.limits, {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(this.#context.frame === undefined ? {} : { frame: this.#context.frame }),
          ...(this.#context.resolutionLevel === undefined
            ? {}
            : { resolutionLevel: this.#context.resolutionLevel }),
        }),
      )
    }
    let metadataPromise: Promise<ImageMetadata>
    if (options.signal === undefined) {
      metadataPromise = this.#context.metadataPromise ?? load()
      this.#context.metadataPromise = metadataPromise
    } else {
      metadataPromise = load()
    }
    const sourceMetadata = await metadataPromise
    throwIfAborted(options.signal)
    return planMetadata(sourceMetadata, this.#operations, this.#context.limits)
  }

  autoOrient(): Image<Input, Output> {
    return this.#append(Object.freeze({ type: 'autoOrient' }))
  }

  keepExif(): Image<Input, Output> {
    return this.#append(Object.freeze({ type: 'keepExif' }))
  }

  keepIcc(): Image<Input, Output> {
    return this.#append(Object.freeze({ type: 'keepIcc' }))
  }

  crop(options: CropOptions): Image<Input, Output> {
    return this.#append(createCropOperation(options))
  }

  resize(options: ResizeOptions): Image<Input, Output> {
    return this.#append(createResizeOperation(options))
  }
  window(options: WindowOptions): Image<Input, Output> {
    return this.#append(createWindowOperation(options))
  }

  convertPixelFormat(options: ConvertPixelFormatOptions): Image<Input, Output> {
    return this.#append(createConvertPixelFormatOperation(options))
  }

  lut(options: LutOptions): Image<Input, Output> {
    return this.#append(createLutOperation(options))
  }

  rotate(degrees: number, options: RotateOptions = {}): Image<Input, Output> {
    return this.#append(createRotateOperation(degrees, options))
  }

  flip(): Image<Input, Output> {
    return this.#append(Object.freeze({ type: 'flip' }))
  }

  flop(): Image<Input, Output> {
    return this.#append(Object.freeze({ type: 'flop' }))
  }

  encode(format: 'avif', options?: AvifEncodeOptions): Image<Input, Output>
  encode(format: 'bmp', options?: BmpEncodeOptions): Image<Input, Output>
  encode(format: 'hdr', options?: HdrEncodeOptions): Image<Input, Output>
  encode(format: 'jpeg', options?: JpegEncodeOptions): Image<Input, Output>
  encode(format: 'jpegxl', options?: JpegXlEncodeOptions): Image<Input, Output>
  encode(format: 'netpbm', options?: NetpbmEncodeOptions): Image<Input, Output>
  encode(format: 'png', options?: PngEncodeOptions): Image<Input, Output>
  encode(format: 'qoi', options?: QoiEncodeOptions): Image<Input, Output>
  encode(format: 'tga', options?: TgaEncodeOptions): Image<Input, Output>
  encode(format: 'tiff', options?: TiffEncodeOptions): Image<Input, Output>
  encode(format: 'webp', options?: WebpEncodeOptions): Image<Input, Output>
  encode(
    format:
      | 'avif'
      | 'bmp'
      | 'hdr'
      | 'jpeg'
      | 'jpegxl'
      | 'netpbm'
      | 'png'
      | 'qoi'
      | 'tga'
      | 'tiff'
      | 'webp',
    options:
      | AvifEncodeOptions
      | BmpEncodeOptions
      | HdrEncodeOptions
      | JpegEncodeOptions
      | JpegXlEncodeOptions
      | NetpbmEncodeOptions
      | PngEncodeOptions
      | QoiEncodeOptions
      | TgaEncodeOptions
      | TiffEncodeOptions
      | WebpEncodeOptions = {},
  ): Image<Input, Output> {
    if (format === 'avif') {
      return this.#append(
        createAvifEncodeOperation(
          'background' in options ? { background: options.background } : {},
        ),
      )
    }
    if (format === 'hdr') {
      return this.#append(
        createHdrEncodeOperation({
          ...('exposure' in options && options.exposure !== undefined
            ? { exposure: options.exposure }
            : {}),
          ...('gamma' in options && options.gamma !== undefined ? { gamma: options.gamma } : {}),
        }),
      )
    }
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
          ...('restartInterval' in options && options.restartInterval !== undefined
            ? { restartInterval: options.restartInterval }
            : {}),
        }),
      )
    }
    if (format === 'jpegxl') {
      return this.#append(
        createJpegXlEncodeOperation({
          ...('mode' in options && options.mode !== undefined ? { mode: options.mode } : {}),
          ...('effort' in options && options.effort === 1 ? { effort: options.effort } : {}),
          ...('container' in options && options.container !== undefined
            ? { container: options.container }
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
    if (format === 'netpbm') {
      return this.#append(
        createNetpbmEncodeOperation({
          ...('format' in options &&
          (options.format === 'pbm' ||
            options.format === 'pgm' ||
            options.format === 'ppm' ||
            options.format === 'pam' ||
            options.format === 'pfm')
            ? { format: options.format }
            : {}),
          ...('ascii' in options && options.ascii !== undefined ? { ascii: options.ascii } : {}),
          ...('bitDepth' in options && options.bitDepth !== undefined
            ? { bitDepth: options.bitDepth }
            : {}),
          ...('endian' in options && options.endian !== undefined
            ? { endian: options.endian }
            : {}),
          ...('scale' in options && options.scale !== undefined ? { scale: options.scale } : {}),
        }),
      )
    }
    if (format === 'qoi') {
      return this.#append(
        createQoiEncodeOperation({
          ...('channels' in options && options.channels !== undefined
            ? { channels: options.channels }
            : {}),
          ...('colorspace' in options && options.colorspace !== undefined
            ? { colorspace: options.colorspace }
            : {}),
        }),
      )
    }
    if (format === 'tga') {
      return this.#append(
        createTgaEncodeOperation({
          ...('alpha' in options && options.alpha !== undefined ? { alpha: options.alpha } : {}),
          ...('rle' in options && options.rle !== undefined ? { rle: options.rle } : {}),
        }),
      )
    }
    if (format === 'tiff') {
      return this.#append(
        createTiffEncodeOperation({
          ...('compression' in options && options.compression !== undefined
            ? { compression: options.compression }
            : {}),
          ...('predictor' in options && options.predictor !== undefined
            ? { predictor: options.predictor }
            : {}),
          ...('layout' in options && options.layout !== undefined
            ? { layout: options.layout }
            : {}),
          ...('compressionLevel' in options && options.compressionLevel !== undefined
            ? { compressionLevel: options.compressionLevel }
            : {}),
          ...('rowsPerStrip' in options && options.rowsPerStrip !== undefined
            ? { rowsPerStrip: options.rowsPerStrip }
            : {}),
          ...('tileWidth' in options && options.tileWidth !== undefined
            ? { tileWidth: options.tileWidth }
            : {}),
          ...('tileHeight' in options && options.tileHeight !== undefined
            ? { tileHeight: options.tileHeight }
            : {}),
          ...('format' in options &&
          (options.format === 'auto' ||
            options.format === 'classic' ||
            options.format === 'bigtiff')
            ? { format: options.format }
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

  avif(options: AvifEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createAvifEncodeOperation(options))
  }

  jpeg(options: JpegEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createJpegEncodeOperation(options))
  }

  jpegxl(options: JpegXlEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createJpegXlEncodeOperation(options))
  }

  png(options: PngEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createPngEncodeOperation(options))
  }

  webp(options: WebpEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createWebpEncodeOperation(options))
  }

  bmp(options: BmpEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createBmpEncodeOperation(options))
  }

  hdr(options: HdrEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createHdrEncodeOperation(options))
  }

  qoi(options: QoiEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createQoiEncodeOperation(options))
  }

  netpbm(options: NetpbmEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createNetpbmEncodeOperation(options))
  }

  pbm(options: PbmEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createNetpbmEncodeOperation({ ...options, format: 'pbm' }))
  }

  pgm(options: PgmEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createNetpbmEncodeOperation({ ...options, format: 'pgm' }))
  }

  ppm(options: PpmEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createNetpbmEncodeOperation({ ...options, format: 'ppm' }))
  }

  pam(options: PamEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createNetpbmEncodeOperation({ ...options, format: 'pam' }))
  }

  pfm(options: PfmEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createNetpbmEncodeOperation({ ...options, format: 'pfm' }))
  }

  tga(options: TgaEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createTgaEncodeOperation(options))
  }

  tiff(options: TiffEncodeOptions = {}): Image<Input, Output> {
    return this.#append(createTiffEncodeOperation(options))
  }

  [imageExecutionPlanInput](): {
    readonly context: ImageContext<Input, Output>
    readonly operations: readonly PipelineOperation[]
  } {
    return Object.freeze({ context: this.#context, operations: this.#operations })
  }

  async toBuffer(options: Readonly<ImageExecutionOptions> = {}): Promise<Output> {
    const output = this.#context.platform.createCollectedOutput()
    await this.toSink(output.sink, options)
    throwIfAborted(options.signal)
    return output.result()
  }

  async toUint8Array(options: Readonly<ImageExecutionOptions> = {}): Promise<Uint8Array> {
    return this.toBuffer(options)
  }

  async toBlob(options: Readonly<ImageExecutionOptions> = {}): Promise<Blob> {
    const metadata = await this.metadata(options)
    const mimeType = this.#context.registry.get(metadata.format)?.mimeTypes[0]
    const output = await this.toBuffer(options)
    throwIfAborted(options.signal)
    return new Blob([Uint8Array.from(output)], {
      type: mimeType ?? 'application/octet-stream',
    })
  }

  async toSink(sink: ImageSink, options: Readonly<ImageExecutionOptions> = {}): Promise<void> {
    const source = bindImageSourceSignal(this.#context.source, options.signal)
    await withSourceSession(source, async () => {
      const { executePipeline } = await import('./executor.ts')
      await executePipeline({ ...this.#context, source }, this.#operations, sink, options)
    })
  }

  async toFile(path: string, options: Readonly<ImageExecutionOptions> = {}): Promise<void> {
    const createFileSink = this.#context.platform.createFileSink
    if (!createFileSink) {
      throw unsupportedOperation('File path output is not available in this runtime')
    }
    await this.toSink(createFileSink(path), options)
  }

  #append(operation: PipelineOperation): Image<Input, Output> {
    return new Image(this.#context, Object.freeze([...this.#operations, operation]))
  }
}

export const createImageLibraryForPlatform = <Input, Output extends Uint8Array>(
  registration: ImageLibraryRegistration,
  platform: ImagePlatform<Input, Output>,
): ImageLibrary<Input, Output> => {
  const registry = new CodecRegistry(resolveCodecRegistration(registration))
  return Object.freeze({
    formats: (): readonly string[] => registry.formats(),
    open: (input: Input, options?: ImageOpenOptions): Promise<Image<Input, Output>> =>
      Image.open(input, registry, platform, options),
  })
}
