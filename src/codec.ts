import { invalidInput, unsupportedFormat, unsupportedOperation } from './errors.ts'
import { recognizeInputFormat } from './input-format.ts'
import type { ImageLimits } from './limits.ts'
import type { PixelBlock, PixelFormat } from './pixel.ts'
import type { ImageRuntime } from './runtime.ts'
import type { ImageSink } from './sink.ts'
import type { ImageSource } from './source.ts'

const baseProbeBytes = 32
const diagnosticProbeBytes = 1024
const maximumFtypProbeBytes = 65_536

const probeByte = (data: Uint8Array, offset: number): number => data[offset] ?? 0
const probeUint32 = (data: Uint8Array, offset: number): number =>
  (probeByte(data, offset) * 16_777_216 +
    probeByte(data, offset + 1) * 65_536 +
    probeByte(data, offset + 2) * 256 +
    probeByte(data, offset + 3)) >>>
  0

const ftypProbeLength = (header: Uint8Array, sourceSize: number): number => {
  if (
    header.byteLength < 8 ||
    probeByte(header, 4) !== 0x66 ||
    probeByte(header, 5) !== 0x74 ||
    probeByte(header, 6) !== 0x79 ||
    probeByte(header, 7) !== 0x70
  ) {
    return header.byteLength
  }

  const size32 = probeUint32(header, 0)
  let declaredSize = size32
  if (size32 === 0) declaredSize = sourceSize
  else if (size32 === 1) {
    if (header.byteLength < 16) return header.byteLength
    const high = probeUint32(header, 8)
    const low = probeUint32(header, 12)
    const extended = BigInt(high) * 0x1_0000_0000n + BigInt(low)
    declaredSize =
      extended > BigInt(Number.MAX_SAFE_INTEGER) ? maximumFtypProbeBytes : Number(extended)
  }
  if (declaredSize < 16) return header.byteLength
  return Math.min(sourceSize, declaredSize, maximumFtypProbeBytes)
}

export type BuiltInFormat =
  | 'avif'
  | 'bmp'
  | 'gif'
  | 'heif'
  | 'ico'
  | 'jpeg'
  | 'jp2'
  | 'png'
  | 'tiff'
  | 'webp'

export type ChromaSubsampling = '400' | '411' | '420' | '422' | '440' | '444'

export type ColorProfile =
  | {
      readonly kind: 'icc'
      readonly description?: string
    }
  | {
      readonly kind: 'nclx'
      readonly primaries: number
      readonly transferCharacteristics: number
      readonly matrixCoefficients: number
      readonly fullRange: boolean
    }

export interface ImageMetadata {
  width: number
  height: number
  format: string
  mimeType: string
  hasAlpha: boolean
  orientation?: number
  colorSpace?: string
  colorProfile?: ColorProfile
  bitDepth?: number
  chromaSubsampling?: ChromaSubsampling
  codecProfile?: number
  frames?: number
  components?: number
  channels?: number
  channelBitDepths?: readonly number[]
  lossless?: boolean
  tiles?: number
  resolutionLevels?: number
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
  scaleDenominator?: 1 | 2 | 4 | 8
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

export interface PreservedMetadata {
  readonly exif?: Uint8Array
  readonly icc?: Uint8Array
}

export interface DecoderOptions {
  readonly frame?: number
  readonly preserveIcc?: boolean
}

export interface MetadataPreservationOptions {
  readonly exif: boolean
  readonly icc: boolean
}

export interface EncodeRequest {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly options: unknown
  readonly metadata?: Readonly<PreservedMetadata>
  readonly runtime?: ImageRuntime
  readonly limits?: Readonly<ImageLimits>
}

export interface ImageCodec {
  readonly format: string
  readonly mimeTypes: readonly string[]
  readonly minimumBytes: number
  detect(header: Uint8Array): boolean
  metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata>
  preservedMetadata?(
    source: ImageSource,
    limits: ImageLimits,
    options?: Readonly<MetadataPreservationOptions>,
  ): Promise<Readonly<PreservedMetadata>>
  createDecoder?(
    source: ImageSource,
    limits: ImageLimits,
    options?: Readonly<DecoderOptions>,
  ): Promise<ImageDecoder>
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
    const initialProbeLength = Math.min(
      source.size,
      this.#codecs.reduce(
        (maximum, codec) => Math.max(maximum, codec.minimumBytes),
        baseProbeBytes,
      ),
    )
    let header = await source.read(0, initialProbeLength)
    const expandedProbeLength = ftypProbeLength(header, source.size)
    if (expandedProbeLength > header.byteLength) {
      header = await source.read(0, expandedProbeLength)
    }
    const codec = this.#codecs.find(
      (candidate) => header.byteLength >= candidate.minimumBytes && candidate.detect(header),
    )
    if (!codec) {
      const diagnosticLength = Math.min(source.size, diagnosticProbeBytes)
      const diagnostic =
        header.byteLength >= diagnosticLength ? header : await source.read(0, diagnosticLength)
      const recognized = recognizeInputFormat(diagnostic)
      if (!recognized) throw unsupportedFormat('Input format is not recognized')
      if (recognized.malformedMessage) throw invalidInput(recognized.malformedMessage)
      if (!recognized.registeredFormat) {
        throw unsupportedOperation(
          `${recognized.name} input was recognized, but decoding is not implemented`,
        )
      }
      if (!this.get(recognized.registeredFormat)) {
        throw unsupportedFormat(
          `${recognized.name} input was recognized, but its codec is not registered`,
        )
      }
      throw invalidInput(
        `${recognized.name} input was recognized, but the registered codec rejected its header`,
      )
    }
    return codec
  }
}
