import type { DecodeRequest, ImageCodec, ImageDecoder, ImageMetadata } from '../codec.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSource } from '../source.ts'
import { readExactly, SourceReader } from '../source.ts'
import { uint16BigEndian } from './helpers.ts'
import { type BaselineJpeg, decodeBaselineJpeg, parseBaselineJpeg } from './jpeg-baseline.ts'
import { createBaselineJpegEncoder } from './jpeg-encode.ts'

const startOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
])
const standaloneMarkers = new Set([
  0x01, 0xd8, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7,
])

const isJpeg = (header: Uint8Array): boolean =>
  header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff

const exifOrientation = (segment: Uint8Array): number | undefined => {
  if (
    segment.byteLength < 14 ||
    segment[0] !== 0x45 ||
    segment[1] !== 0x78 ||
    segment[2] !== 0x69 ||
    segment[3] !== 0x66 ||
    segment[4] !== 0 ||
    segment[5] !== 0
  ) {
    return undefined
  }

  const tiff = 6
  const littleEndian = segment[tiff] === 0x49 && segment[tiff + 1] === 0x49
  const bigEndian = segment[tiff] === 0x4d && segment[tiff + 1] === 0x4d
  if (!littleEndian && !bigEndian) return undefined

  const read16 = (offset: number): number | undefined => {
    const first = segment[offset]
    const second = segment[offset + 1]
    if (first === undefined || second === undefined) return undefined
    return littleEndian ? first + second * 256 : first * 256 + second
  }
  const read32 = (offset: number): number | undefined => {
    const first = read16(offset)
    const second = read16(offset + 2)
    if (first === undefined || second === undefined) return undefined
    return littleEndian ? first + second * 65_536 : first * 65_536 + second
  }

  if (read16(tiff + 2) !== 42) return undefined
  const relativeIfd = read32(tiff + 4)
  if (relativeIfd === undefined) return undefined
  const ifd = tiff + relativeIfd
  const entries = read16(ifd)
  if (entries === undefined || entries > 4_096) return undefined

  for (let index = 0; index < entries; index += 1) {
    const entry = ifd + 2 + index * 12
    if (entry + 12 > segment.byteLength) return undefined
    if (read16(entry) !== 0x0112 || read16(entry + 2) !== 3 || read32(entry + 4) !== 1) continue
    const orientation = read16(entry + 8)
    return orientation !== undefined && orientation >= 1 && orientation <= 8
      ? orientation
      : undefined
  }
  return undefined
}

const jpegColorSpace = (components: number): string => {
  if (components === 1) return 'gray'
  if (components === 4) return 'cmyk'
  return 'ycbcr'
}

const region = (
  width: number,
  height: number,
  request: DecodeRequest = {},
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
    outputHeight < 1
  ) {
    throw invalidInput('JPEG decode region is invalid')
  }
  if (x + outputWidth > width || y + outputHeight > height) {
    throw invalidInput(
      `Decode region ${x},${y} ${outputWidth}x${outputHeight} exceeds ${width}x${height}`,
    )
  }
  return { x, y, width: outputWidth, height: outputHeight }
}

class JpegDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgb8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #jpeg: BaselineJpeg

  constructor(jpeg: BaselineJpeg) {
    this.width = jpeg.width
    this.height = jpeg.height
    this.#jpeg = jpeg
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const output = region(this.width, this.height, request)
    yield* decodeBaselineJpeg(this.#jpeg, output)
  }
}

const decodeJpeg = async (source: ImageSource, limits: ImageLimits): Promise<ImageDecoder> => {
  const input = await readExactly(source, 0, source.size)
  const baseline = parseBaselineJpeg(input)
  if (!baseline) {
    throw unsupportedOperation(
      'Only single-scan baseline JPEG decoding is implemented; progressive JPEG is unsupported',
    )
  }
  validateImageDimensions(baseline.width, baseline.height, 1, limits)
  return new JpegDecoder(baseline)
}

export const jpegCodec: ImageCodec = {
  format: 'jpeg',
  mimeTypes: ['image/jpeg'],
  minimumBytes: 3,
  detect: isJpeg,
  async metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> {
    const reader = new SourceReader(source, 2)
    let width: number | undefined
    let height: number | undefined
    let bitDepth: number | undefined
    let components: number | undefined
    let orientation: number | undefined

    for (let segments = 0; reader.position < source.size && segments < 10_000; segments += 1) {
      let prefix = await reader.readByte()
      while (prefix !== 0xff && reader.position < source.size) prefix = await reader.readByte()
      if (prefix !== 0xff) break

      let marker = await reader.readByte()
      while (marker === 0xff) marker = await reader.readByte()
      if (marker === 0x00 || standaloneMarkers.has(marker)) continue

      const length = uint16BigEndian(await reader.read(2), 0)
      if (length < 2)
        throw invalidInput(`JPEG marker 0x${marker.toString(16)} has an invalid length`)
      const payloadLength = length - 2

      if (marker === 0xda) {
        reader.skip(payloadLength)
        break
      }
      if (marker === 0xe1 && orientation === undefined) {
        orientation = exifOrientation(await reader.read(payloadLength))
        continue
      }
      if (startOfFrameMarkers.has(marker)) {
        const frame = await reader.read(payloadLength)
        if (frame.byteLength < 6) throw invalidInput('JPEG start-of-frame marker is truncated')
        bitDepth = frame[0]
        height = uint16BigEndian(frame, 1)
        width = uint16BigEndian(frame, 3)
        components = frame[5]
        continue
      }
      reader.skip(payloadLength)
    }

    if (
      width === undefined ||
      height === undefined ||
      bitDepth === undefined ||
      components === undefined
    ) {
      throw invalidInput('JPEG dimensions were not found before image data')
    }
    validateImageDimensions(width, height, 1, limits)
    return {
      width,
      height,
      format: 'jpeg',
      mimeType: 'image/jpeg',
      hasAlpha: false,
      ...(orientation ? { orientation } : {}),
      colorSpace: jpegColorSpace(components),
      bitDepth,
      frames: 1,
    }
  },
  createDecoder: decodeJpeg,
  createEncoder: createBaselineJpegEncoder,
}
