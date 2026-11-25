import type { ImageCodec, ImageMetadata } from '../codec.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import { type ImageSource, readExactly } from '../source.ts'

const isBmp = (header: Uint8Array): boolean => header[0] === 0x42 && header[1] === 0x4d
export const bitmapFileHeaderBytes = 14
export const rgb = 0
export const rle8 = 1
export const rle4 = 2
export const bitfields = 3
const alphaBitfields = 6

const supportedHeaders = new Set([12, 40, 52, 56, 64, 108, 124])

interface ChannelMask {
  readonly mask: number
  readonly shift: number
  readonly maximum: number
}

export interface BmpDescription {
  readonly width: number
  readonly height: number
  readonly topDown: boolean
  readonly bitDepth: number
  readonly compression: number
  readonly pixelOffset: number
  readonly rowStride: number
  readonly palette: Uint8Array | undefined
  readonly red: ChannelMask | undefined
  readonly green: ChannelMask | undefined
  readonly blue: ChannelMask | undefined
  readonly alpha: ChannelMask | undefined
  readonly pixelFormat: 'rgb8' | 'rgba8'
}

const uint16 = (data: Uint8Array, offset: number): number => {
  const low = data[offset]
  const high = data[offset + 1]
  if (low === undefined || high === undefined) throw truncatedInput('BMP 16-bit value is truncated')
  return low + high * 256
}

const uint32 = (data: Uint8Array, offset: number): number => {
  const first = data[offset]
  const second = data[offset + 1]
  const third = data[offset + 2]
  const fourth = data[offset + 3]
  if (first === undefined || second === undefined || third === undefined || fourth === undefined) {
    throw truncatedInput('BMP 32-bit value is truncated')
  }
  return (first + second * 256 + third * 65_536 + fourth * 16_777_216) >>> 0
}

const int32 = (data: Uint8Array, offset: number): number => {
  const value = uint32(data, offset)
  return value >= 0x80000000 ? value - 0x100000000 : value
}

const mask = (value: number, name: string): ChannelMask => {
  const normalizedMask = value >>> 0
  if (normalizedMask === 0) throw invalidInput(`BMP ${name} channel mask is empty`)
  let shift = 0
  while (((normalizedMask >>> shift) & 1) === 0) shift += 1
  const maximum = normalizedMask >>> shift
  if ((maximum & (maximum + 1)) !== 0) {
    throw invalidInput(`BMP ${name} channel mask is not contiguous`)
  }
  return { mask: normalizedMask, shift, maximum }
}

const masksDoNotOverlap = (channels: readonly ChannelMask[]): void => {
  for (let left = 0; left < channels.length; left += 1) {
    for (let right = left + 1; right < channels.length; right += 1) {
      const first = channels[left]
      const second = channels[right]
      if (first && second && (first.mask & second.mask) !== 0) {
        throw invalidInput('BMP channel masks overlap')
      }
    }
  }
}

const readMasks = async ({
  source,
  dib,
  headerSize,
  compression,
  bitDepth,
}: {
  source: ImageSource
  dib: Uint8Array
  headerSize: number
  compression: number
  bitDepth: number
}): Promise<{
  red: ChannelMask | undefined
  green: ChannelMask | undefined
  blue: ChannelMask | undefined
  alpha: ChannelMask | undefined
  bytesAfterHeader: number
}> => {
  if (bitDepth !== 16 && bitDepth !== 32) {
    return {
      red: undefined,
      green: undefined,
      blue: undefined,
      alpha: undefined,
      bytesAfterHeader: 0,
    }
  }

  let redValue = bitDepth === 16 ? 0x7c00 : 0x00ff0000
  let greenValue = bitDepth === 16 ? 0x03e0 : 0x0000ff00
  let blueValue = bitDepth === 16 ? 0x001f : 0x000000ff
  let alphaValue = 0
  let bytesAfterHeader = 0

  if (compression === bitfields || compression === alphaBitfields) {
    if (headerSize >= 52) {
      redValue = uint32(dib, 40)
      greenValue = uint32(dib, 44)
      blueValue = uint32(dib, 48)
      if (headerSize >= 56) alphaValue = uint32(dib, 52)
    } else {
      bytesAfterHeader = compression === alphaBitfields ? 16 : 12
      const values = await readExactly(source, bitmapFileHeaderBytes + headerSize, bytesAfterHeader)
      redValue = uint32(values, 0)
      greenValue = uint32(values, 4)
      blueValue = uint32(values, 8)
      if (bytesAfterHeader === 16) alphaValue = uint32(values, 12)
    }
  }

  if (compression === alphaBitfields && alphaValue === 0) {
    throw invalidInput('BMP alpha-bitfields compression requires an alpha mask')
  }
  const red = mask(redValue, 'red')
  const green = mask(greenValue, 'green')
  const blue = mask(blueValue, 'blue')
  const alpha = alphaValue === 0 ? undefined : mask(alphaValue, 'alpha')
  masksDoNotOverlap(alpha ? [red, green, blue, alpha] : [red, green, blue])
  return { red, green, blue, alpha, bytesAfterHeader }
}

export const describeBmp = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<BmpDescription> => {
  if (source.size < 26) throw truncatedInput('BMP header is truncated')
  const fileHeader = await readExactly(source, 0, 26)
  if (!isBmp(fileHeader)) throw invalidInput('BMP signature is invalid')
  const fileSize = uint32(fileHeader, 2)
  const pixelOffset = uint32(fileHeader, 10)
  const headerSize = uint32(fileHeader, 14)
  if (!supportedHeaders.has(headerSize)) {
    throw unsupportedOperation(`BMP DIB header size ${headerSize} is unsupported`)
  }
  if (fileSize > source.size) throw truncatedInput('BMP declared file size exceeds input size')
  if (fileSize !== 0 && fileSize < pixelOffset) throw invalidInput('BMP file size precedes pixels')

  const dib = await readExactly(source, bitmapFileHeaderBytes, headerSize)
  const os2 = headerSize === 12
  const width = os2 ? uint16(dib, 4) : int32(dib, 4)
  const storedHeight = os2 ? uint16(dib, 6) : int32(dib, 8)
  const planes = os2 ? uint16(dib, 8) : uint16(dib, 12)
  const bitDepth = os2 ? uint16(dib, 10) : uint16(dib, 14)
  const compression = os2 ? rgb : uint32(dib, 16)
  const colorsUsed = headerSize >= 40 ? uint32(dib, 32) : 0
  if (width < 1 || storedHeight === 0)
    throw invalidInput(`Invalid BMP dimensions: ${width}x${storedHeight}`)
  if (planes !== 1) throw invalidInput(`BMP plane count must be 1, received ${planes}`)
  if (![1, 4, 8, 16, 24, 32].includes(bitDepth)) {
    throw unsupportedOperation(`BMP bit depth ${bitDepth} is unsupported`)
  }
  if (![rgb, rle8, rle4, bitfields, alphaBitfields].includes(compression)) {
    throw unsupportedOperation(`BMP compression method ${compression} is unsupported`)
  }
  if ((compression === rle8 && bitDepth !== 8) || (compression === rle4 && bitDepth !== 4)) {
    throw invalidInput('BMP RLE compression does not match its bit depth')
  }
  if (
    (compression === bitfields || compression === alphaBitfields) &&
    bitDepth !== 16 &&
    bitDepth !== 32
  ) {
    throw invalidInput('BMP bitfields require 16-bit or 32-bit pixels')
  }
  if (compression === rgb && ![1, 4, 8, 16, 24, 32].includes(bitDepth)) {
    throw invalidInput('BMP RGB bit depth is invalid')
  }

  const topDown = !os2 && storedHeight < 0
  const height = Math.abs(storedHeight)
  if (topDown && (compression === rle4 || compression === rle8)) {
    throw invalidInput('BMP RLE images cannot be top-down')
  }
  validateImageDimensions(width, height, 1, limits)

  const channelMasks = await readMasks({ source, dib, headerSize, compression, bitDepth })
  let palette: Uint8Array | undefined
  const paletteOffset = bitmapFileHeaderBytes + headerSize + channelMasks.bytesAfterHeader
  if (bitDepth <= 8) {
    const maximumColors = 2 ** bitDepth
    const paletteColors = colorsUsed === 0 ? maximumColors : colorsUsed
    if (paletteColors < 1 || paletteColors > maximumColors) {
      throw invalidInput(`BMP palette contains ${paletteColors} colors for ${bitDepth}-bit pixels`)
    }
    const entryBytes = os2 ? 3 : 4
    const paletteBytes = paletteColors * entryBytes
    if (paletteOffset + paletteBytes > pixelOffset) {
      throw truncatedInput('BMP palette overlaps pixel data')
    }
    const encoded = await readExactly(source, paletteOffset, paletteBytes)
    palette = new Uint8Array(paletteColors * 3)
    for (let index = 0; index < paletteColors; index += 1) {
      const sourceOffset = index * entryBytes
      const targetOffset = index * 3
      palette[targetOffset] = encoded[sourceOffset + 2] ?? 0
      palette[targetOffset + 1] = encoded[sourceOffset + 1] ?? 0
      palette[targetOffset + 2] = encoded[sourceOffset] ?? 0
    }
  }
  if (pixelOffset < paletteOffset || pixelOffset >= source.size) {
    throw invalidInput('BMP pixel offset is invalid')
  }

  const rowStride = Math.floor((width * bitDepth + 31) / 32) * 4
  if (compression === rgb || compression === bitfields || compression === alphaBitfields) {
    const requiredBytes = BigInt(pixelOffset) + BigInt(rowStride) * BigInt(height)
    if (requiredBytes > BigInt(source.size)) throw truncatedInput('BMP pixel array is truncated')
  }

  return {
    width,
    height,
    topDown,
    bitDepth,
    compression,
    pixelOffset,
    rowStride,
    palette,
    red: channelMasks.red,
    green: channelMasks.green,
    blue: channelMasks.blue,
    alpha: channelMasks.alpha,
    pixelFormat: channelMasks.alpha ? 'rgba8' : 'rgb8',
  }
}

export const channel = (value: number, description: ChannelMask | undefined): number => {
  if (!description) return 255
  const sample = (value & description.mask) >>> description.shift
  return Math.round((sample * 255) / description.maximum)
}

const metadata = (description: BmpDescription): ImageMetadata => ({
  width: description.width,
  height: description.height,
  format: 'bmp',
  mimeType: 'image/bmp',
  hasAlpha: description.pixelFormat === 'rgba8',
  bitDepth: description.bitDepth,
  frames: 1,
})

export const bmpCodec: ImageCodec = {
  format: 'bmp',
  mimeTypes: ['image/bmp', 'image/x-ms-bmp'],
  minimumBytes: 2,
  detect: isBmp,
  metadata: async (source, limits) => metadata(await describeBmp(source, limits)),
  async createDecoder(source, limits) {
    const { createBmpDecoder } = await import('./bmp-pixels.ts')
    return createBmpDecoder(source, limits)
  },
  async createEncoder(sink, request) {
    const { createBmpEncoder } = await import('./bmp-pixels.ts')
    return createBmpEncoder(sink, request)
  },
}
