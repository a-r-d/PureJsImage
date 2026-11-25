import type { ImageCodec } from '../codec.ts'
import type { ImageSink } from '../sink.ts'
import type { ImageSource } from '../source.ts'
import type { TiffDocument, TiffDocumentOptions } from '../tiff/types.ts'
import type { TiffDocumentEncodeRequest } from './tiff-encode.ts'
import { isTiff } from './tiff-signature.ts'

export type {
  TiffDocumentEncodeRequest,
  TiffEncodeOptions,
  TiffPageEncodeRequest,
} from './tiff-encode.ts'

export const openTiffDocument = async (
  source: ImageSource,
  options?: Readonly<TiffDocumentOptions>,
): Promise<TiffDocument> => {
  const { readTiffDocument } = await import('./tiff-read.ts')
  return readTiffDocument(source, options)
}

export const encodeTiffDocument = async (
  sink: ImageSink,
  request: Readonly<TiffDocumentEncodeRequest>,
): Promise<void> => {
  const writer = await import('./tiff-encode.ts')
  return writer.encodeTiffDocument(sink, request)
}

export interface TiffCodecOptions {
  readonly embeddedCodecs?: readonly ImageCodec[]
}

export const createTiffCodec = (options: Readonly<TiffCodecOptions> = {}): ImageCodec => {
  const webpCodec = options.embeddedCodecs?.find((codec) => codec.format === 'webp')
  return {
    format: 'tiff',
    mimeTypes: ['image/tiff', 'image/x-tiff'],
    minimumBytes: 4,
    selection: { frames: true, resolutionLevels: true },
    detect: isTiff,
    async metadata(source, limits, decoderOptions) {
      const { readTiffMetadata } = await import('./tiff-read.ts')
      return readTiffMetadata(source, limits, decoderOptions)
    },
    async preservedMetadata(source, limits, preserveOptions) {
      const { preserveTiffMetadata } = await import('./tiff-read.ts')
      return preserveTiffMetadata(source, limits, preserveOptions)
    },
    async createDecoder(source, limits, decoderOptions) {
      const { createTiffDecoder } = await import('./tiff-read.ts')
      return createTiffDecoder(source, limits, decoderOptions, webpCodec)
    },
    async createEncoder(sink, request) {
      const { TiffEncoder } = await import('./tiff-encode.ts')
      return TiffEncoder.create(sink, request)
    },
  }
}

export const tiffCodec = createTiffCodec()
