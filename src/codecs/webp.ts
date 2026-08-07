import type { DecodeRequest, ImageCodec, ImageDecoder, ImageMetadata } from '../codec.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import { decodeLosslessWebp } from './webp-lossless.ts'

interface WebpChunk {
  readonly type: string
  readonly offset: number
  readonly length: number
}

interface ParsedWebp {
  readonly width: number
  readonly height: number
  readonly hasAlpha: boolean
  readonly animated: boolean
  readonly frames: number
  readonly image: WebpChunk | undefined
}

const byte = (data: Uint8Array, offset: number): number => data[offset] ?? 0
const ascii = (data: Uint8Array, offset: number): string =>
  String.fromCharCode(
    byte(data, offset),
    byte(data, offset + 1),
    byte(data, offset + 2),
    byte(data, offset + 3),
  )

const uint24 = (data: Uint8Array, offset: number): number =>
  byte(data, offset) + byte(data, offset + 1) * 256 + byte(data, offset + 2) * 65_536

const uint32 = (data: Uint8Array, offset: number): number =>
  (uint24(data, offset) + byte(data, offset + 3) * 16_777_216) >>> 0

const isWebp = (header: Uint8Array): boolean =>
  header.byteLength >= 12 && ascii(header, 0) === 'RIFF' && ascii(header, 8) === 'WEBP'

const losslessDimensions = (
  data: Uint8Array,
  chunk: WebpChunk,
): { width: number; height: number; hasAlpha: boolean } => {
  if (chunk.length < 5) throw truncatedInput('WebP lossless header is truncated')
  if (byte(data, chunk.offset) !== 0x2f) throw invalidInput('WebP lossless signature is invalid')
  const bits = uint32(data, chunk.offset + 1)
  if (bits >>> 29 !== 0) throw invalidInput('WebP lossless version is unsupported')
  return {
    width: (bits & 0x3fff) + 1,
    height: ((bits >>> 14) & 0x3fff) + 1,
    hasAlpha: ((bits >>> 28) & 1) === 1,
  }
}

const lossyDimensions = (data: Uint8Array, chunk: WebpChunk): { width: number; height: number } => {
  if (chunk.length < 10) throw truncatedInput('WebP VP8 frame header is truncated')
  if (
    byte(data, chunk.offset + 3) !== 0x9d ||
    byte(data, chunk.offset + 4) !== 0x01 ||
    byte(data, chunk.offset + 5) !== 0x2a
  ) {
    throw invalidInput('WebP VP8 key-frame signature is invalid')
  }
  return {
    width: (byte(data, chunk.offset + 6) + byte(data, chunk.offset + 7) * 256) & 0x3fff,
    height: (byte(data, chunk.offset + 8) + byte(data, chunk.offset + 9) * 256) & 0x3fff,
  }
}

const parseWebp = (data: Uint8Array): ParsedWebp => {
  if (!isWebp(data)) throw invalidInput('WebP RIFF header is invalid')
  const riffLength = uint32(data, 4)
  const end = riffLength + 8
  if (riffLength < 4 || end > data.byteLength)
    throw truncatedInput('WebP RIFF payload is truncated')

  let canvasWidth: number | undefined
  let canvasHeight: number | undefined
  let extendedAlpha = false
  let animated = false
  let frames = 0
  let image: WebpChunk | undefined
  let offset = 12
  while (offset < end) {
    if (offset + 8 > end) throw truncatedInput('WebP chunk header is truncated')
    const type = ascii(data, offset)
    const length = uint32(data, offset + 4)
    const payload = offset + 8
    const next = payload + length + (length & 1)
    if (next > end) throw truncatedInput(`WebP ${type} chunk is truncated`)
    const chunk = { type, offset: payload, length }
    if (type === 'VP8X') {
      if (length < 10) throw truncatedInput('WebP extended header is truncated')
      const flags = byte(data, payload)
      extendedAlpha = (flags & 0x10) !== 0
      animated = (flags & 0x02) !== 0
      canvasWidth = uint24(data, payload + 4) + 1
      canvasHeight = uint24(data, payload + 7) + 1
    } else if (type === 'ANMF') frames += 1
    else if ((type === 'VP8 ' || type === 'VP8L') && !image) image = chunk
    offset = next
  }
  if (!image && (canvasWidth === undefined || canvasHeight === undefined))
    throw invalidInput('WebP image bitstream is missing')

  const dimensions = image
    ? image.type === 'VP8L'
      ? losslessDimensions(data, image)
      : lossyDimensions(data, image)
    : undefined
  const width = canvasWidth ?? dimensions?.width
  const height = canvasHeight ?? dimensions?.height
  if (width === undefined || height === undefined) throw invalidInput('WebP dimensions are missing')
  if (width < 1 || height < 1) throw invalidInput('WebP dimensions are invalid')
  return {
    width,
    height,
    hasAlpha:
      extendedAlpha ||
      (image?.type === 'VP8L' && losslessDimensions(data, image).hasAlpha === true),
    animated,
    frames: animated ? Math.max(1, frames) : 1,
    image,
  }
}

const decodeRegion = (
  width: number,
  height: number,
  request: DecodeRequest,
): Required<DecodeRequest> => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const outputWidth = request.width ?? width - x
  const outputHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(outputWidth) ||
    !Number.isSafeInteger(outputHeight) ||
    x < 0 ||
    y < 0 ||
    outputWidth < 1 ||
    outputHeight < 1 ||
    x + outputWidth > width ||
    y + outputHeight > height
  ) {
    throw invalidInput('WebP decode region is invalid')
  }
  return { x, y, width: outputWidth, height: outputHeight }
}

class LosslessWebpDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgba8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #pixels: Uint32Array

  constructor(width: number, height: number, pixels: Uint32Array) {
    this.width = width
    this.height = height
    this.#pixels = pixels
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = decodeRegion(this.width, this.height, request)
    const rowsPerBlock = 32
    for (let rowStart = 0; rowStart < region.height; rowStart += rowsPerBlock) {
      const blockHeight = Math.min(rowsPerBlock, region.height - rowStart)
      const stride = region.width * 4
      const data = new Uint8Array(stride * blockHeight)
      for (let row = 0; row < blockHeight; row += 1) {
        const sourceY = region.y + rowStart + row
        for (let x = 0; x < region.width; x += 1) {
          const color = this.#pixels[sourceY * this.width + region.x + x] ?? 0
          const target = row * stride + x * 4
          data[target] = (color >>> 16) & 255
          data[target + 1] = (color >>> 8) & 255
          data[target + 2] = color & 255
          data[target + 3] = color >>> 24
        }
      }
      yield {
        x: 0,
        y: rowStart,
        width: region.width,
        height: blockHeight,
        stride,
        format: 'rgba8',
        data,
      }
    }
  }
}

const input = async (source: ImageSource): Promise<Uint8Array> =>
  readExactly(source, 0, source.size)

export const webpCodec: ImageCodec = {
  format: 'webp',
  mimeTypes: ['image/webp'],
  minimumBytes: 12,
  detect: isWebp,
  async metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> {
    const parsed = parseWebp(await input(source))
    validateImageDimensions(parsed.width, parsed.height, parsed.frames, limits)
    return {
      width: parsed.width,
      height: parsed.height,
      format: 'webp',
      mimeType: 'image/webp',
      hasAlpha: parsed.hasAlpha,
      colorSpace: 'srgb',
      bitDepth: 8,
      frames: parsed.frames,
    }
  },
  async createDecoder(source: ImageSource, limits: ImageLimits): Promise<ImageDecoder> {
    const data = await input(source)
    const parsed = parseWebp(data)
    validateImageDimensions(parsed.width, parsed.height, parsed.frames, limits)
    if (parsed.animated) throw unsupportedOperation('Animated WebP decoding is not implemented')
    if (!parsed.image) throw invalidInput('WebP image bitstream is missing')
    if (parsed.image.type !== 'VP8L')
      throw unsupportedOperation('Lossy WebP decoding is not implemented yet')
    const decoded = decodeLosslessWebp(
      data,
      parsed.image.offset,
      parsed.image.length,
      (width, height) => {
        validateImageDimensions(width, height, 1, limits)
      },
    )
    if (decoded.width !== parsed.width || decoded.height !== parsed.height)
      throw invalidInput('WebP canvas and lossless bitstream dimensions do not match')
    return new LosslessWebpDecoder(decoded.width, decoded.height, decoded.pixels)
  },
}
