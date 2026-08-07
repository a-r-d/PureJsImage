import type {
  DecodeRequest,
  EncodeRequest,
  ImageCodec,
  ImageDecoder,
  ImageEncoder,
  ImageMetadata,
} from '../codec.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import type { ImageSink } from '../sink.ts'
import { decodeLosslessWebp, decodeLosslessWebpAlpha } from './webp-lossless.ts'
import { createLosslessWebpEncoder } from './webp-lossless-encode.ts'
import { LossyWebpEncoder } from './webp-lossy-encode.ts'
import { decodeVp8 } from './vp8.ts'
import { ColorManagedDecoder, parseRgbIccTransform, type RgbIccTransform } from './icc.ts'

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
  readonly alpha: WebpChunk | undefined
  readonly colorTransform: RgbIccTransform | undefined
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
  if (riffLength < 4 || (riffLength & 1) !== 0) throw invalidInput('WebP RIFF size is invalid')
  if (end > data.byteLength) throw truncatedInput('WebP RIFF payload is truncated')

  let canvasWidth: number | undefined
  let canvasHeight: number | undefined
  let extended = false
  let extendedAlpha = false
  let extendedIcc = false
  let animated = false
  let frames = 0
  let image: WebpChunk | undefined
  let alpha: WebpChunk | undefined
  let icc: WebpChunk | undefined
  let imageDataStarted = false
  let offset = 12
  while (offset < end) {
    if (offset + 8 > end) throw truncatedInput('WebP chunk header is truncated')
    const type = ascii(data, offset)
    const length = uint32(data, offset + 4)
    const payload = offset + 8
    const next = payload + length + (length & 1)
    if (next > end) throw truncatedInput(`WebP ${type} chunk is truncated`)
    if ((length & 1) !== 0 && byte(data, payload + length) !== 0) {
      throw invalidInput(`WebP ${type} chunk padding is invalid`)
    }
    const chunk = { type, offset: payload, length }
    if (type === 'VP8X') {
      if (extended || offset !== 12)
        throw invalidInput('WebP extended header is duplicated or late')
      if (length !== 10) throw invalidInput('WebP extended header size is invalid')
      const flags = byte(data, payload)
      if (
        (flags & 0xc1) !== 0 ||
        byte(data, payload + 1) !== 0 ||
        byte(data, payload + 2) !== 0 ||
        byte(data, payload + 3) !== 0
      ) {
        throw invalidInput('WebP extended header reserved bits are set')
      }
      extended = true
      extendedIcc = (flags & 0x20) !== 0
      extendedAlpha = (flags & 0x10) !== 0
      animated = (flags & 0x02) !== 0
      canvasWidth = uint24(data, payload + 4) + 1
      canvasHeight = uint24(data, payload + 7) + 1
    } else if (type === 'ICCP') {
      if (!extended || imageDataStarted)
        throw invalidInput('WebP ICCP chunk is missing VP8X or appears late')
      if (icc) throw invalidInput('WebP contains multiple ICCP chunks')
      icc = chunk
    } else if (type === 'ANIM') imageDataStarted = true
    else if (type === 'ANMF') {
      imageDataStarted = true
      frames += 1
    } else if (type === 'ALPH') {
      imageDataStarted = true
      if (alpha || image) throw invalidInput('WebP alpha chunk is duplicated or late')
      alpha = chunk
    } else if (type === 'VP8 ' || type === 'VP8L') {
      imageDataStarted = true
      if (image) throw invalidInput('WebP contains multiple image bitstreams')
      image = chunk
    }
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
  if (width * height > 0xffff_ffff) throw invalidInput('WebP canvas area is invalid')
  if (dimensions && (dimensions.width !== width || dimensions.height !== height)) {
    throw invalidInput('WebP canvas and image bitstream dimensions do not match')
  }
  if (alpha && (!extended || !extendedAlpha || image?.type !== 'VP8 ')) {
    throw invalidInput('WebP alpha chunk is inconsistent with the extended header')
  }
  if (extendedAlpha && image?.type === 'VP8 ' && !alpha) {
    throw invalidInput('WebP extended alpha chunk is missing')
  }
  if (extendedIcc !== (icc !== undefined)) {
    throw invalidInput('WebP ICCP chunk is inconsistent with the extended header')
  }
  return {
    width,
    height,
    hasAlpha:
      extendedAlpha ||
      (image?.type === 'VP8L' && losslessDimensions(data, image).hasAlpha === true),
    animated,
    frames: animated ? Math.max(1, frames) : 1,
    image,
    alpha,
    colorTransform: icc
      ? parseRgbIccTransform(data.subarray(icc.offset, icc.offset + icc.length))
      : undefined,
  }
}

const decodeAlpha = (
  data: Uint8Array,
  chunk: WebpChunk,
  width: number,
  height: number,
): Uint8Array => {
  if (chunk.length < 1) throw truncatedInput('WebP alpha chunk is truncated')
  const flags = byte(data, chunk.offset)
  if ((flags & 0xc0) !== 0) throw invalidInput('WebP alpha reserved bits are set')
  const compression = flags & 3
  const filter = (flags >>> 2) & 3
  const pixelCount = width * height
  let alpha: Uint8Array
  if (compression === 0) {
    if (chunk.length - 1 < pixelCount) throw truncatedInput('WebP raw alpha payload is truncated')
    alpha = data.slice(chunk.offset + 1, chunk.offset + 1 + pixelCount)
  } else if (compression === 1) {
    alpha = decodeLosslessWebpAlpha(data, chunk.offset + 1, chunk.length - 1, width, height)
  } else throw unsupportedOperation(`WebP alpha compression method ${compression} is unsupported`)

  if (filter === 0) return alpha
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const left = x > 0 ? (alpha[index - 1] ?? 0) : 0
      const above = y > 0 ? (alpha[index - width] ?? 0) : 0
      const upperLeft = x > 0 && y > 0 ? (alpha[index - width - 1] ?? 0) : 0
      const predictor =
        filter === 1
          ? x > 0
            ? left
            : above
          : filter === 2
            ? y > 0
              ? above
              : left
            : x === 0
              ? above
              : y === 0
                ? left
                : Math.max(0, Math.min(255, left + above - upperLeft))
      alpha[index] = ((alpha[index] ?? 0) + predictor) & 255
    }
  }
  return alpha
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

class WebpPixelDecoder implements ImageDecoder {
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

const createWebpEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
): Promise<ImageEncoder> => {
  if (
    typeof request.options === 'object' &&
    request.options !== null &&
    'lossless' in request.options &&
    request.options.lossless === true
  ) {
    return createLosslessWebpEncoder(sink, request)
  }
  if (
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width < 1 ||
    request.height < 1 ||
    request.width > 16_384 ||
    request.height > 16_384
  ) {
    throw invalidInput(`Invalid lossy WebP output dimensions: ${request.width}x${request.height}`)
  }
  const quality =
    typeof request.options === 'object' &&
    request.options !== null &&
    'quality' in request.options &&
    typeof request.options.quality === 'number'
      ? request.options.quality
      : 80
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw invalidInput('WebP quality must be an integer from 1 to 100')
  }
  return new LossyWebpEncoder(sink, request.width, request.height, request.pixelFormat, quality)
}

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
    const decoded =
      parsed.image.type === 'VP8L'
        ? decodeLosslessWebp(data, parsed.image.offset, parsed.image.length, (width, height) => {
            validateImageDimensions(width, height, 1, limits)
          })
        : decodeVp8(data, parsed.image.offset, parsed.image.length, (width, height) => {
            validateImageDimensions(width, height, 1, limits)
          })
    if (parsed.image.type === 'VP8 ' && parsed.hasAlpha) {
      if (!parsed.alpha) throw invalidInput('WebP extended alpha chunk is missing')
      const alpha = decodeAlpha(data, parsed.alpha, decoded.width, decoded.height)
      for (let index = 0; index < decoded.pixels.length; index += 1) {
        decoded.pixels[index] =
          ((alpha[index] ?? 0) << 24) | ((decoded.pixels[index] ?? 0) & 0x00ffffff)
      }
    }
    if (decoded.width !== parsed.width || decoded.height !== parsed.height) {
      throw invalidInput('WebP canvas and image bitstream dimensions do not match')
    }
    const decoder = new WebpPixelDecoder(decoded.width, decoded.height, decoded.pixels)
    return parsed.colorTransform ? new ColorManagedDecoder(decoder, parsed.colorTransform) : decoder
  },
  createEncoder: createWebpEncoder,
}
