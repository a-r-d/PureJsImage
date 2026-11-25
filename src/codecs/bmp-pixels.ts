import type { DecodeRequest, EncodeRequest, ImageDecoder, ImageEncoder } from '../codec.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { type ImageSource, readExactly } from '../source.ts'
import {
  bitmapFileHeaderBytes,
  rgb,
  rle8,
  rle4,
  bitfields,
  type BmpDescription,
  describeBmp,
  channel,
} from './bmp.ts'
const blockRows = 32

interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
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
      const writable = Math.min(count, description.width - x)
      const paddedRle4Row =
        description.compression === rle4 &&
        (description.width & 1) === 1 &&
        x + count === description.width + 1
      if (writable !== count && !paddedRle4Row) {
        throw invalidInput('BMP RLE encoded run exceeds its row')
      }
      for (let index = 0; index < writable; index += 1) {
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
    if (request.metadata?.exif || request.metadata?.icc) {
      throw unsupportedOperation('BMP output cannot preserve EXIF or ICC metadata')
    }
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

export const createBmpDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<ImageDecoder> => new BmpDecoder(source, await describeBmp(source, limits))

export const createBmpEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
): Promise<ImageEncoder> => BmpEncoder.create(sink, request)
