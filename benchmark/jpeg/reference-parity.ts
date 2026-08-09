import { createHash } from 'node:crypto'

import type {
  DecodeRequest,
  ImageErrorCode,
  ImageLimitOptions,
  ImageMetadata,
  PixelBlock,
} from '../../src/index.ts'
import { ImageError } from '../../src/index.ts'
import type { JpegReferenceVector } from './reference-vectors.ts'

export interface JpegReferenceProvider {
  metadata(input: Uint8Array, limits?: Readonly<ImageLimitOptions>): Promise<ImageMetadata>
  decode(
    input: Uint8Array,
    request: Readonly<DecodeRequest>,
    limits?: Readonly<ImageLimitOptions>,
  ): AsyncIterable<PixelBlock>
}

export interface JpegReferenceObservation {
  readonly metadata?: ImageMetadata
  readonly pixels?: Uint8Array
  readonly sha256?: string
  readonly error?: ImageErrorCode
}

const mutate = (input: Uint8Array, mutation: JpegReferenceVector['mutation']): Uint8Array => {
  if (!mutation) return input
  const output = Uint8Array.from(input)
  for (let offset = 0; offset + 1 < output.byteLength; offset += 1) {
    if (output[offset] === 0xff && output[offset + 1] === 0) {
      output[offset + 1] = 0xe0
      return output
    }
  }
  throw new Error('JPEG parity mutation could not find a stuffed entropy byte')
}

const collectPixels = async (blocks: AsyncIterable<PixelBlock>): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const block of blocks) {
    const channels = block.format === 'gray8' ? 1 : block.format === 'rgb8' ? 3 : 4
    const rowBytes = block.width * channels
    for (let row = 0; row < block.height; row += 1) {
      const chunk = Uint8Array.from(
        block.data.subarray(row * block.stride, row * block.stride + rowBytes),
      )
      chunks.push(chunk)
      length += chunk.byteLength
    }
    block.release?.()
  }
  const output = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export const observeJpegReferenceVector = async (
  provider: JpegReferenceProvider,
  vector: JpegReferenceVector,
  source: Uint8Array,
): Promise<JpegReferenceObservation> => {
  const input = mutate(source, vector.mutation)
  try {
    const metadata = vector.metadata ? await provider.metadata(input, vector.limits) : undefined
    const pixels =
      vector.pixels || vector.expectedError
        ? await collectPixels(provider.decode(input, vector.request, vector.limits))
        : undefined
    return {
      ...(metadata ? { metadata } : {}),
      ...(pixels ? { pixels, sha256: createHash('sha256').update(pixels).digest('hex') } : {}),
    }
  } catch (error) {
    if (!(error instanceof ImageError)) throw error
    return { error: error.code }
  }
}

export const compareJpegReferencePixels = (
  actual: Uint8Array,
  reference: Uint8Array,
): Readonly<{ meanAbsoluteError: number; maximumChannelError: number }> => {
  if (actual.byteLength !== reference.byteLength) {
    throw new Error(
      `JPEG parity pixel lengths differ: ${actual.byteLength} versus ${reference.byteLength}`,
    )
  }
  let total = 0
  let maximumChannelError = 0
  for (let offset = 0; offset < actual.byteLength; offset += 1) {
    const error = Math.abs((actual[offset] ?? 0) - (reference[offset] ?? 0))
    total += error
    maximumChannelError = Math.max(maximumChannelError, error)
  }
  return {
    meanAbsoluteError: actual.byteLength === 0 ? 0 : total / actual.byteLength,
    maximumChannelError,
  }
}
