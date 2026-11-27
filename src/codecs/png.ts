import type {
  DecoderOptions,
  EncodeRequest,
  ImageCodec,
  ImageDecoder,
  ImageEncoder,
} from '../codec.ts'
import type { ImageLimits } from '../limits.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import type { ImageSource } from '../source.ts'
import { isPng, signature } from './png-common.ts'

export type PngColorType = 0 | 2 | 3 | 4 | 6

export interface PngRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PngAccelerationRequest {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colorType: PngColorType
  readonly interlace: 0 | 1
  readonly frames: number
  readonly transparency: boolean
  readonly pixelFormat: PixelFormat
  readonly region: PngRegion
  readonly inflated: AsyncIterable<Uint8Array>
}

export interface PngRowFilter {
  /** Each result has independent storage that the compressor can retain. */
  readonly transfersOutput?: boolean
  filter(data: Uint8Array, stride: number, rows: number): Uint8Array
  release(): void
}

export interface PngEncodeAccelerationRequest {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly adaptiveFiltering: boolean
}

/** Consume each compressed view before requesting the next one. */
export type PngInflater = (
  compressed: AsyncIterable<Uint8Array<ArrayBuffer>>,
  maximumDecodedBytes: number,
) => AsyncIterable<Uint8Array>

export interface PngAcceleration {
  decode?(request: PngAccelerationRequest): Promise<AsyncIterable<PixelBlock> | undefined>
  encode?(request: PngEncodeAccelerationRequest): Promise<PngRowFilter | undefined>
}

export interface PngDecodeAcceleration extends PngAcceleration {
  decode(request: PngAccelerationRequest): Promise<AsyncIterable<PixelBlock> | undefined>
}

export interface PngEncodeAcceleration extends PngAcceleration {
  encode(request: PngEncodeAccelerationRequest): Promise<PngRowFilter | undefined>
}

const decodePng = async (
  source: ImageSource,
  limits: ImageLimits,
  options?: Readonly<DecoderOptions>,
  accelerations?: readonly PngAcceleration[],
  inflate?: PngInflater,
): Promise<ImageDecoder> => {
  const { createPngDecoder } = await import('./png-decode.ts')
  return createPngDecoder(source, limits, options, accelerations, inflate)
}

const encodePng = async (
  sink: ImageSink,
  request: EncodeRequest,
  accelerations?: readonly PngAcceleration[],
): Promise<ImageEncoder> => {
  const { createPngEncoder } = await import('./png-encode.ts')
  return createPngEncoder(sink, request, accelerations)
}

// Bind after application accelerators are resolved so their reference-codec identity is preserved.
const pngRuntimeBinding = {
  withPngInflater(this: ImageCodec, inflate: PngInflater): ImageCodec {
    const accelerations = registeredPngAccelerations(this)
    // A custom codec can spread pngCodec and supply its own decoder.
    if (!accelerations) return this
    return Object.freeze({
      ...this,
      createDecoder: (
        source: ImageSource,
        limits: ImageLimits,
        options?: Readonly<DecoderOptions>,
      ) => decodePng(source, limits, options, accelerations, inflate),
    })
  },
}

export const pngCodec: ImageCodec = {
  ...pngRuntimeBinding,
  format: 'png',
  mimeTypes: ['image/png'],
  minimumBytes: signature.length,
  encoderPixelFormats: ['gray8', 'rgb8', 'rgba8', 'gray16', 'rgb16', 'rgba16'],
  acceptsColorSemantics: (semantics) =>
    (semantics.family === 'gray' || semantics.family === 'rgb') &&
    semantics.matrix === 'identity' &&
    semantics.range === 'full' &&
    (semantics.alpha === 'none' || semantics.alpha === 'straight'),
  detect: isPng,
  async metadata(source, limits) {
    const { readPngMetadata } = await import('./png-metadata.ts')
    return readPngMetadata(source, limits)
  },
  async preservedMetadata(source, limits) {
    const { preservePngMetadata } = await import('./png-metadata.ts')
    return preservePngMetadata(source, limits)
  },
  createDecoder: decodePng,
  createEncoder: encodePng,
}

const acceleratedPngCodecs = new WeakMap<ImageCodec, readonly PngAcceleration[]>()

const registeredPngAccelerations = (codec: ImageCodec): readonly PngAcceleration[] | undefined => {
  if (codec === pngCodec) return []
  return acceleratedPngCodecs.get(codec)
}

export const acceleratePngCodec = (
  reference: ImageCodec,
  acceleration: PngAcceleration,
): ImageCodec => {
  const registered = registeredPngAccelerations(reference)
  if (!registered) {
    throw new Error('PNG acceleration requires the PureJsImage reference PNG codec')
  }
  const accelerations = Object.freeze([...registered, acceleration])
  const accelerated: ImageCodec = Object.freeze({
    ...reference,
    createDecoder: (
      source: ImageSource,
      limits: ImageLimits,
      options?: Readonly<DecoderOptions>,
    ): Promise<ImageDecoder> => decodePng(source, limits, options, accelerations),
    createEncoder: (sink: ImageSink, request: EncodeRequest): Promise<ImageEncoder> =>
      encodePng(sink, request, accelerations),
  })
  acceleratedPngCodecs.set(accelerated, accelerations)
  return accelerated
}
