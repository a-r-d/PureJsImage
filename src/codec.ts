import { unsupportedFormat } from './errors.ts'
import type { ImageLimits } from './limits.ts'
import type { PixelBlock, PixelFormat } from './pixel.ts'
import type { ImageSink } from './sink.ts'
import type { ImageSource } from './source.ts'

export type BuiltInFormat = 'avif' | 'bmp' | 'gif' | 'heif' | 'jpeg' | 'png' | 'tiff' | 'webp'

export type ChromaSubsampling = '400' | '420' | '422' | '444'

export interface ImageMetadata {
  width: number
  height: number
  format: string
  mimeType: string
  hasAlpha: boolean
  orientation?: number
  colorSpace?: string
  bitDepth?: number
  chromaSubsampling?: ChromaSubsampling
  codecProfile?: number
  frames?: number
}

export interface DecoderCapabilities {
  sequential: boolean
  regionDecode: boolean
  scaledDecode: boolean
  progressive: boolean
}

export interface DecodeRequest {
  x?: number
  y?: number
  width?: number
  height?: number
}

export interface ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly capabilities: DecoderCapabilities
  decode(request?: DecodeRequest): AsyncIterable<PixelBlock>
}

export interface ImageEncoder {
  write(block: PixelBlock): Promise<void>
  finish(): Promise<void>
  abort?(reason: unknown): Promise<void>
}

export interface EncodeRequest {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly options: unknown
}

export interface ImageCodec {
  readonly format: string
  readonly mimeTypes: readonly string[]
  readonly minimumBytes: number
  detect(header: Uint8Array): boolean
  metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata>
  createDecoder?(source: ImageSource, limits: ImageLimits): Promise<ImageDecoder>
  createEncoder?(sink: ImageSink, request: EncodeRequest): Promise<ImageEncoder>
}

export class CodecRegistry {
  readonly #codecs: ImageCodec[] = []

  constructor(codecs: Iterable<ImageCodec> = []) {
    for (const codec of codecs) this.register(codec)
  }

  register(codec: ImageCodec): this {
    if (this.#codecs.some((candidate) => candidate.format === codec.format)) {
      throw new Error(`Codec already registered for format: ${codec.format}`)
    }
    this.#codecs.push(codec)
    return this
  }

  get(format: string): ImageCodec | undefined {
    return this.#codecs.find((codec) => codec.format === format)
  }

  formats(): readonly string[] {
    return this.#codecs.map((codec) => codec.format)
  }

  async detect(source: ImageSource): Promise<ImageCodec> {
    const probeLength = Math.min(
      source.size,
      this.#codecs.reduce((maximum, codec) => Math.max(maximum, codec.minimumBytes), 0),
    )
    const header = await source.read(0, probeLength)
    const codec = this.#codecs.find(
      (candidate) => header.byteLength >= candidate.minimumBytes && candidate.detect(header),
    )
    if (!codec) throw unsupportedFormat('Input does not match a registered image format')
    return codec
  }
}
