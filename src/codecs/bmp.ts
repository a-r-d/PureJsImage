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
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'

const bitmapFileHeaderBytes = 14
const blockRows = 32
const rgb = 0
const rle8 = 1
const rle4 = 2
const bitfields = 3
const alphaBitfields = 6
const supportedHeaders = new Set([12, 40, 52, 56, 64, 108, 124])

interface ChannelMask {
  readonly mask: number
  readonly shift: number
  readonly maximum: number
}

interface BmpDescription {
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

interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const isBmp = (header: Uint8Array): boolean => header[0] === 0x42 && header[1] === 0x4d

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

const describeBmp = async (source: ImageSource, limits: ImageLimits): Promise<BmpDescription> => {
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

const regionFor = (description: BmpDescription, request: DecodeRequest): Region => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const width = request.width ?? description.width - x
  const height = request.height ?? description.height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    x < 0 ||
    y < 0 ||
    width < 1 ||
    height < 1 ||
    x + width > description.width ||
    y + height > description.height
  ) {
    throw invalidInput('BMP decode region is invalid')
  }
  return { x, y, width, height }
}

const channel = (value: number, description: ChannelMask | undefined): number => {
  if (!description) return 255
  const sample = (value & description.mask) >>> description.shift
  return Math.round((sample * 255) / description.maximum)
}

const convertRow = (
  row: Uint8Array,
  description: BmpDescription,
  cropX: number,
  width: number,
  output: Uint8Array,
  outputOffset: number,
): void => {
  const channels = description.pixelFormat === 'rgba8' ? 4 : 3
  let target = outputOffset
  if (description.bitDepth === 24) {
    let source = cropX * 3
    const end = source + width * 3
    for (; source < end; source += 3) {
      output[target] = row[source + 2] ?? 0
      output[target + 1] = row[source + 1] ?? 0
      output[target + 2] = row[source] ?? 0
      target += 3
    }
    return
  }
  if (description.bitDepth <= 8) {
    const palette = description.palette
    const indexMask = (1 << description.bitDepth) - 1
    for (let targetX = 0; targetX < width; targetX += 1) {
      const x = cropX + targetX
      const packed = row[Math.floor((x * description.bitDepth) / 8)]
      if (packed === undefined) throw truncatedInput('BMP packed row is truncated')
      const shift = 8 - description.bitDepth - ((x * description.bitDepth) & 7)
      const paletteOffset = ((packed >>> shift) & indexMask) * 3
      const red = palette?.[paletteOffset]
      const green = palette?.[paletteOffset + 1]
      const blue = palette?.[paletteOffset + 2]
      if (red === undefined || green === undefined || blue === undefined) {
        throw invalidInput(`BMP palette index ${paletteOffset / 3} is out of range`)
      }
      output[target] = red
      output[target + 1] = green
      output[target + 2] = blue
      target += 3
    }
    return
  }

  const bytes = description.bitDepth / 8
  for (let targetX = 0; targetX < width; targetX += 1) {
    const x = cropX + targetX
    const sourceOffset = x * bytes
    const first = row[sourceOffset]
    const second = row[sourceOffset + 1]
    if (first === undefined || second === undefined) throw truncatedInput('BMP pixel is truncated')
    let value = first + second * 256
    if (bytes === 4) {
      const third = row[sourceOffset + 2]
      const fourth = row[sourceOffset + 3]
      if (third === undefined || fourth === undefined)
        throw truncatedInput('BMP pixel is truncated')
      value = (value + third * 65_536 + fourth * 16_777_216) >>> 0
    }
    output[target] = channel(value, description.red)
    output[target + 1] = channel(value, description.green)
    output[target + 2] = channel(value, description.blue)
    if (channels === 4) output[target + 3] = channel(value, description.alpha)
    target += channels
  }
}

const decodeRleIndices = (data: Uint8Array, description: BmpDescription): Uint8Array => {
  const indices = new Uint8Array(description.width * description.height)
  let offset = 0
  let x = 0
  let storedY = 0
  let ended = false

  const write = (index: number): void => {
    if (x >= description.width || storedY >= description.height) {
      throw invalidInput('BMP RLE run exceeds image dimensions')
    }
    indices[(description.height - 1 - storedY) * description.width + x] = index
    x += 1
  }

  while (offset < data.byteLength) {
    const count = data[offset]
    const value = data[offset + 1]
    if (count === undefined || value === undefined)
      throw truncatedInput('BMP RLE command is truncated')
    offset += 2
    if (count > 0) {
      if (x + count > description.width) throw invalidInput('BMP RLE encoded run exceeds its row')
      for (let index = 0; index < count; index += 1) {
        write(description.compression === rle8 ? value : index & 1 ? value & 15 : value >>> 4)
      }
      continue
    }
    if (value === 0) {
      x = 0
      storedY += 1
      if (storedY > description.height) throw invalidInput('BMP RLE contains too many rows')
      continue
    }
    if (value === 1) {
      ended = true
      break
    }
    if (value === 2) {
      const deltaX = data[offset]
      const deltaY = data[offset + 1]
      if (deltaX === undefined || deltaY === undefined)
        throw truncatedInput('BMP RLE delta is truncated')
      offset += 2
      x += deltaX
      storedY += deltaY
      if (x > description.width || storedY >= description.height) {
        throw invalidInput('BMP RLE delta exceeds image dimensions')
      }
      continue
    }

    const pixels = value
    const encodedBytes = description.compression === rle8 ? pixels : Math.ceil(pixels / 2)
    const paddedBytes = encodedBytes + (encodedBytes & 1)
    if (x + pixels > description.width) throw invalidInput('BMP RLE absolute run exceeds its row')
    if (offset + paddedBytes > data.byteLength)
      throw truncatedInput('BMP RLE absolute run is truncated')
    for (let index = 0; index < pixels; index += 1) {
      const encoded = data[offset + (description.compression === rle8 ? index : index >>> 1)]
      if (encoded === undefined) throw truncatedInput('BMP RLE absolute pixel is truncated')
      write(description.compression === rle8 ? encoded : index & 1 ? encoded & 15 : encoded >>> 4)
    }
    offset += paddedBytes
  }
  if (!ended) throw truncatedInput('BMP RLE end marker is missing')
  return indices
}

class BmpDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly capabilities
  readonly #source: ImageSource
  readonly #description: BmpDescription

  constructor(source: ImageSource, description: BmpDescription) {
    this.#source = source
    this.#description = description
    this.width = description.width
    this.height = description.height
    this.pixelFormat = description.pixelFormat
    this.capabilities = Object.freeze({
      sequential: true,
      regionDecode: description.compression !== rle4 && description.compression !== rle8,
      scaledDecode: false,
      progressive: false,
    })
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = regionFor(this.#description, request)
    const channels = this.pixelFormat === 'rgba8' ? 4 : 3
    const outputStride = region.width * channels

    if (this.#description.compression === rle4 || this.#description.compression === rle8) {
      const encoded = await readExactly(
        this.#source,
        this.#description.pixelOffset,
        this.#source.size - this.#description.pixelOffset,
      )
      const indices = decodeRleIndices(encoded, this.#description)
      for (let outputY = 0; outputY < region.height; outputY += blockRows) {
        const height = Math.min(blockRows, region.height - outputY)
        const output = new Uint8Array(outputStride * height)
        const palette = this.#description.palette
        for (let localY = 0; localY < height; localY += 1) {
          const sourceOffset = (region.y + outputY + localY) * this.width + region.x
          let target = localY * outputStride
          for (let x = 0; x < region.width; x += 1) {
            const paletteOffset = (indices[sourceOffset + x] ?? 0) * 3
            const red = palette?.[paletteOffset]
            const green = palette?.[paletteOffset + 1]
            const blue = palette?.[paletteOffset + 2]
            if (red === undefined || green === undefined || blue === undefined) {
              throw invalidInput(`BMP palette index ${paletteOffset / 3} is out of range`)
            }
            output[target] = red
            output[target + 1] = green
            output[target + 2] = blue
            target += 3
          }
        }
        yield {
          x: 0,
          y: outputY,
          width: region.width,
          height,
          stride: outputStride,
          format: this.pixelFormat,
          data: output,
        }
      }
      return
    }

    for (let outputY = 0; outputY < region.height; outputY += blockRows) {
      const height = Math.min(blockRows, region.height - outputY)
      const firstImageY = region.y + outputY
      const firstStoredRow = this.#description.topDown
        ? firstImageY
        : this.height - (firstImageY + height)
      const rows = await readExactly(
        this.#source,
        this.#description.pixelOffset + firstStoredRow * this.#description.rowStride,
        height * this.#description.rowStride,
      )
      const output = new Uint8Array(outputStride * height)
      for (let localY = 0; localY < height; localY += 1) {
        const storedLocalY = this.#description.topDown ? localY : height - 1 - localY
        const row = rows.subarray(
          storedLocalY * this.#description.rowStride,
          (storedLocalY + 1) * this.#description.rowStride,
        )
        convertRow(row, this.#description, region.x, region.width, output, localY * outputStride)
      }
      yield {
        x: 0,
        y: outputY,
        width: region.width,
        height,
        stride: outputStride,
        format: this.pixelFormat,
        data: output,
      }
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const encoderAlpha = (options: unknown, pixelFormat: PixelFormat): boolean => {
  if (!isRecord(options)) throw invalidInput('BMP encoder options must be an object')
  const value = options.alpha
  if (value !== undefined && typeof value !== 'boolean') {
    throw invalidInput('BMP alpha must be a boolean')
  }
  return value ?? pixelFormat === 'rgba8'
}

const bmpHeader = (width: number, height: number, alpha: boolean): Uint8Array => {
  const headerSize = alpha ? 108 : 40
  const pixelOffset = bitmapFileHeaderBytes + headerSize
  const bytesPerPixel = alpha ? 4 : 3
  const rowStride = (width * bytesPerPixel + 3) & ~3
  const imageBytes = rowStride * height
  const fileSize = pixelOffset + imageBytes
  const output = new Uint8Array(pixelOffset)
  const view = new DataView(output.buffer)
  output.set([0x42, 0x4d])
  view.setUint32(2, fileSize, true)
  view.setUint32(10, pixelOffset, true)
  view.setUint32(14, headerSize, true)
  view.setInt32(18, width, true)
  view.setInt32(22, -height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, alpha ? 32 : 24, true)
  view.setUint32(30, alpha ? bitfields : rgb, true)
  view.setUint32(34, imageBytes, true)
  view.setInt32(38, 2835, true)
  view.setInt32(42, 2835, true)
  if (alpha) {
    view.setUint32(54, 0x00ff0000, true)
    view.setUint32(58, 0x0000ff00, true)
    view.setUint32(62, 0x000000ff, true)
    view.setUint32(66, 0xff000000, true)
    view.setUint32(70, 0x73524742, true)
  }
  return output
}

class BmpEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #alpha: boolean
  readonly #row: Uint8Array
  #y = 0

  private constructor(sink: ImageSink, request: EncodeRequest, alpha: boolean) {
    this.#sink = sink
    this.#width = request.width
    this.#height = request.height
    this.#format = request.pixelFormat
    this.#alpha = alpha
    const bytesPerPixel = alpha ? 4 : 3
    this.#row = new Uint8Array((request.width * bytesPerPixel + 3) & ~3)
  }

  static async create(sink: ImageSink, request: EncodeRequest): Promise<BmpEncoder> {
    if (
      request.pixelFormat !== 'gray8' &&
      request.pixelFormat !== 'rgb8' &&
      request.pixelFormat !== 'rgba8'
    ) {
      throw unsupportedOperation(`BMP encoding does not support ${request.pixelFormat} pixels`)
    }
    const alpha = encoderAlpha(request.options, request.pixelFormat)
    await sink.write(bmpHeader(request.width, request.height, alpha))
    return new BmpEncoder(sink, request, alpha)
  }

  async write(block: PixelBlock): Promise<void> {
    const sourceChannels = this.#format === 'gray8' ? 1 : this.#format === 'rgb8' ? 3 : 4
    if (
      block.x !== 0 ||
      block.y !== this.#y ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.format !== this.#format ||
      block.stride < this.#width * sourceChannels ||
      block.data.byteLength < block.stride * block.height ||
      this.#y + block.height > this.#height
    ) {
      throw invalidInput('BMP encoder received a non-sequential or malformed pixel block')
    }

    const targetChannels = this.#alpha ? 4 : 3
    for (let y = 0; y < block.height; y += 1) {
      this.#row.fill(0)
      const sourceRow = y * block.stride
      for (let x = 0; x < this.#width; x += 1) {
        const source = sourceRow + x * sourceChannels
        const target = x * targetChannels
        const red = block.data[source] ?? 0
        const green = sourceChannels === 1 ? red : (block.data[source + 1] ?? 0)
        const blue = sourceChannels === 1 ? red : (block.data[source + 2] ?? 0)
        this.#row[target] = blue
        this.#row[target + 1] = green
        this.#row[target + 2] = red
        if (this.#alpha)
          this.#row[target + 3] = sourceChannels === 4 ? (block.data[source + 3] ?? 0) : 255
      }
      await this.#sink.write(this.#row)
      this.#y += 1
    }
  }

  async finish(): Promise<void> {
    if (this.#y !== this.#height) {
      throw truncatedInput(`BMP encoder received ${this.#y} of ${this.#height} rows`)
    }
  }
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
  createDecoder: async (source, limits) =>
    new BmpDecoder(source, await describeBmp(source, limits)),
  createEncoder: async (sink, request) => BmpEncoder.create(sink, request),
}
