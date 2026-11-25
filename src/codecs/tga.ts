import type { ImageCodec, ImageMetadata } from '../codec.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import { type ImageSource, readExactly } from '../source.ts'
export const headerBytes = 18
export const uncompressedColorMapped = 1
export const uncompressedTruecolor = 2
export const uncompressedGrayscale = 3
export const rleColorMapped = 9
export const rleTruecolor = 10
export const rleGrayscale = 11

const supportedTypes = new Set([
  uncompressedColorMapped,
  uncompressedTruecolor,
  uncompressedGrayscale,
  rleColorMapped,
  rleTruecolor,
  rleGrayscale,
])

export const uint16 = (data: Uint8Array, offset: number): number =>
  (data[offset] ?? 0) + (data[offset + 1] ?? 0) * 256

const isTga = (header: Uint8Array): boolean => {
  if (header.byteLength < headerBytes) return false
  const colorMapType = header[1]
  const imageType = header[2]
  const width = uint16(header, 12)
  const height = uint16(header, 14)
  const pixelDepth = header[16]
  const descriptor = header[17]
  if (
    (colorMapType !== 0 && colorMapType !== 1) ||
    imageType === undefined ||
    !supportedTypes.has(imageType) ||
    width === 0 ||
    height === 0 ||
    descriptor === undefined ||
    (descriptor & 0xc0) !== 0
  ) {
    return false
  }
  if (
    (imageType === uncompressedColorMapped || imageType === rleColorMapped) &&
    colorMapType !== 1
  ) {
    return false
  }
  if (imageType === uncompressedGrayscale || imageType === rleGrayscale) return pixelDepth === 8
  if (imageType === uncompressedColorMapped || imageType === rleColorMapped) {
    return pixelDepth === 8 || pixelDepth === 16
  }
  return pixelDepth === 15 || pixelDepth === 16 || pixelDepth === 24 || pixelDepth === 32
}

export interface TgaDescription {
  readonly width: number
  readonly height: number
  readonly imageType: number
  readonly pixelDepth: number
  readonly bytesPerPixel: number
  readonly attributeBits: number
  readonly topOrigin: boolean
  readonly rightOrigin: boolean
  readonly pixelOffset: number
  readonly paletteOrigin: number
  readonly palette: Uint8Array | undefined
  readonly paletteHasAlpha: boolean
  readonly pixelFormat: 'gray8' | 'rgb8' | 'rgba8'
  readonly imageId: string | undefined
}

export const fiveBit = (value: number): number => Math.round((value * 255) / 31)

const paletteEntry = (
  encoded: Uint8Array,
  offset: number,
  bits: number,
  alphaMeaningful: boolean,
  output: Uint8Array,
  target: number,
): void => {
  if (bits === 15 || bits === 16) {
    const value = uint16(encoded, offset)
    output[target] = fiveBit((value >>> 10) & 31)
    output[target + 1] = fiveBit((value >>> 5) & 31)
    output[target + 2] = fiveBit(value & 31)
    output[target + 3] = alphaMeaningful ? ((value & 0x8000) === 0 ? 0 : 255) : 255
    return
  }
  output[target] = encoded[offset + 2] ?? 0
  output[target + 1] = encoded[offset + 1] ?? 0
  output[target + 2] = encoded[offset] ?? 0
  output[target + 3] = bits === 32 && alphaMeaningful ? (encoded[offset + 3] ?? 0) : 255
}

const decodeImageId = (data: Uint8Array): string | undefined => {
  let value = ''
  for (const byte of data) {
    if (byte === 0) break
    value += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '\ufffd'
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

export const describeTga = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<TgaDescription> => {
  if (source.size < headerBytes) throw truncatedInput('TGA header is truncated')
  const header = await readExactly(source, 0, headerBytes)
  if (!isTga(header)) throw invalidInput('TGA header is invalid or unsupported')
  const idLength = header[0] ?? 0
  const colorMapType = header[1] ?? 0
  const imageType = header[2] ?? 0
  const paletteOrigin = uint16(header, 3)
  const paletteLength = uint16(header, 5)
  const paletteBits = header[7] ?? 0
  const width = uint16(header, 12)
  const height = uint16(header, 14)
  const pixelDepth = header[16] ?? 0
  const descriptor = header[17] ?? 0
  const attributeBits = descriptor & 15
  validateImageDimensions(width, height, 1, limits)

  const colorMapped = imageType === uncompressedColorMapped || imageType === rleColorMapped
  const grayscale = imageType === uncompressedGrayscale || imageType === rleGrayscale
  if (colorMapType === 1) {
    if (paletteLength === 0) throw invalidInput('TGA color map is empty')
    if (![15, 16, 24, 32].includes(paletteBits)) {
      throw unsupportedOperation(`TGA ${paletteBits}-bit color-map entries are unsupported`)
    }
    if (paletteOrigin + paletteLength > 65_536) {
      throw invalidInput('TGA color-map range exceeds 16-bit indices')
    }
  } else if (paletteLength !== 0 || paletteOrigin !== 0 || paletteBits !== 0) {
    throw invalidInput('TGA declares color-map fields without a color map')
  }
  if (colorMapped && colorMapType !== 1) throw invalidInput('Indexed TGA is missing its color map')
  if (grayscale && attributeBits !== 0) {
    throw unsupportedOperation('TGA grayscale attribute channels are unsupported')
  }
  if ((pixelDepth === 15 || pixelDepth === 16) && attributeBits > 1) {
    throw unsupportedOperation(
      `TGA ${pixelDepth}-bit pixels with ${attributeBits} attribute bits are unsupported`,
    )
  }
  if (pixelDepth === 15 && attributeBits !== 0) {
    throw invalidInput('TGA 15-bit pixels cannot declare attribute bits')
  }
  if (pixelDepth === 24 && attributeBits !== 0) {
    throw invalidInput('TGA 24-bit pixels cannot declare attribute bits')
  }
  if (pixelDepth === 32 && attributeBits !== 0 && attributeBits !== 8) {
    throw unsupportedOperation(
      `TGA 32-bit pixels with ${attributeBits} attribute bits are unsupported`,
    )
  }

  const imageId =
    idLength === 0 ? undefined : decodeImageId(await readExactly(source, headerBytes, idLength))
  const paletteEntryBytes = Math.ceil(paletteBits / 8)
  const paletteBytes = paletteLength * paletteEntryBytes
  const paletteOffset = headerBytes + idLength
  const pixelOffset = paletteOffset + paletteBytes
  if (pixelOffset >= source.size) throw truncatedInput('TGA image data is missing')
  const paletteHasAlpha =
    colorMapType === 1 && (paletteBits === 32 || (paletteBits === 16 && attributeBits > 0))
  let palette: Uint8Array | undefined
  if (colorMapType === 1) {
    const encoded = await readExactly(source, paletteOffset, paletteBytes)
    palette = new Uint8Array(paletteLength * 4)
    for (let index = 0; index < paletteLength; index += 1) {
      paletteEntry(
        encoded,
        index * paletteEntryBytes,
        paletteBits,
        paletteHasAlpha,
        palette,
        index * 4,
      )
    }
  }
  const bytesPerPixel = Math.ceil(pixelDepth / 8)
  const rle = imageType >= 9
  if (!rle) {
    const required = BigInt(pixelOffset) + BigInt(width) * BigInt(height) * BigInt(bytesPerPixel)
    if (required > BigInt(source.size)) throw truncatedInput('TGA pixel array is truncated')
  }
  const pixelFormat: 'gray8' | 'rgb8' | 'rgba8' = grayscale
    ? 'gray8'
    : colorMapped
      ? paletteHasAlpha
        ? 'rgba8'
        : 'rgb8'
      : (pixelDepth === 16 && attributeBits === 1) || (pixelDepth === 32 && attributeBits === 8)
        ? 'rgba8'
        : 'rgb8'
  return {
    width,
    height,
    imageType,
    pixelDepth,
    bytesPerPixel,
    attributeBits,
    topOrigin: (descriptor & 0x20) !== 0,
    rightOrigin: (descriptor & 0x10) !== 0,
    pixelOffset,
    paletteOrigin,
    palette,
    paletteHasAlpha,
    pixelFormat,
    imageId,
  }
}

const metadata = (description: TgaDescription): ImageMetadata => ({
  width: description.width,
  height: description.height,
  format: 'tga',
  mimeType: 'image/x-tga',
  hasAlpha: description.pixelFormat === 'rgba8',
  bitDepth: description.pixelDepth,
  components: description.pixelFormat === 'gray8' ? 1 : description.pixelFormat === 'rgb8' ? 3 : 4,
  channels: description.pixelFormat === 'gray8' ? 1 : description.pixelFormat === 'rgb8' ? 3 : 4,
  frames: 1,
  lossless: true,
  ...(description.imageId === undefined ? {} : { imageId: description.imageId }),
})

export const tgaCodec: ImageCodec = {
  format: 'tga',
  mimeTypes: ['image/x-tga', 'image/x-targa', 'image/tga'],
  minimumBytes: headerBytes,
  encoderPixelFormats: ['gray8', 'rgb8', 'rgba8'],
  detect: isTga,
  metadata: async (source, limits) => metadata(await describeTga(source, limits)),
  async createDecoder(source, limits) {
    const { createTgaDecoder } = await import('./tga-pixels.ts')
    return createTgaDecoder(source, limits)
  },
  async createEncoder(sink, request) {
    const { createTgaEncoder } = await import('./tga-pixels.ts')
    return createTgaEncoder(sink, request)
  },
}
