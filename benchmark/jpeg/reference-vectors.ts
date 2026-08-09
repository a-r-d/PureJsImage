import type { DecodeRequest, ImageErrorCode, ImageLimitOptions } from '../../src/index.ts'

export type JpegPixelRule =
  | { readonly kind: 'exact'; readonly sha256: string }
  | {
      readonly kind: 'tolerant'
      readonly referenceSha256: string
      readonly maximumMeanAbsoluteError: number
      readonly maximumChannelError: number
    }

export interface JpegReferenceVector {
  readonly id: string
  readonly file: string
  readonly request: Readonly<DecodeRequest>
  readonly limits?: Readonly<ImageLimitOptions>
  readonly mutation?: 'entropy-marker'
  readonly metadata?: Readonly<{
    width: number
    height: number
    colorSpace: string
    chromaSubsampling: string
  }>
  readonly pixels?: JpegPixelRule
  readonly expectedError?: ImageErrorCode
}

export const jpegReferenceVectors: readonly JpegReferenceVector[] = Object.freeze([
  {
    id: 'rgb-full-exact',
    file: 'generated-adobe-rgb.jpg',
    request: {},
    metadata: { width: 37, height: 23, colorSpace: 'rgb', chromaSubsampling: '444' },
    pixels: {
      kind: 'exact',
      sha256: '24e19e9d9756a8386773aa9988b643273096843debe507f75f28b7af056ad5ca',
    },
  },
  {
    id: 'yuv440-region-tolerant',
    file: 'generated-yuv440.jpg',
    request: { x: 3, y: 2, width: 29, height: 17 },
    metadata: { width: 37, height: 23, colorSpace: 'ycbcr', chromaSubsampling: '440' },
    pixels: {
      kind: 'tolerant',
      referenceSha256: '5e16d2dd9981259a6b43451151673b36c8430eae35cd62fadff2c5c214f5c42a',
      maximumMeanAbsoluteError: 1,
      maximumChannelError: 2,
    },
  },
  {
    id: 'progressive-scaled-region-tolerant',
    file: 'generated-progressive.jpg',
    request: { scaleDenominator: 2, x: 1, y: 1, width: 17, height: 10 },
    metadata: { width: 37, height: 23, colorSpace: 'ycbcr', chromaSubsampling: '420' },
    pixels: {
      kind: 'tolerant',
      referenceSha256: '494dc0a71a5b71380bf956f68a4b2fcb4c7119be612db50d6b9bd23e3c62df2d',
      maximumMeanAbsoluteError: 1,
      maximumChannelError: 2,
    },
  },
  {
    id: 'sequential-multiscan-scaled-tolerant',
    file: 'generated-sequential-multiscan.jpg',
    request: { scaleDenominator: 4 },
    metadata: { width: 37, height: 23, colorSpace: 'ycbcr', chromaSubsampling: '420' },
    pixels: {
      kind: 'tolerant',
      referenceSha256: 'e9e7f92541b775d546b0effd5115e6a39f0ccc3ba5359d58d344b2e4add1d9b3',
      maximumMeanAbsoluteError: 1,
      maximumChannelError: 2,
    },
  },
  {
    id: 'progressive-coefficient-limit',
    file: 'generated-progressive.jpg',
    request: {},
    limits: { maxDecodedBytes: 4_096 },
    expectedError: 'LIMIT_EXCEEDED',
  },
  {
    id: 'entropy-marker-failure',
    file: 'generated-sof1-8bit.jpg',
    request: {},
    mutation: 'entropy-marker',
    expectedError: 'INVALID_INPUT',
  },
])
