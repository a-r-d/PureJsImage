import type { Deflate } from 'node:zlib'

import type {
  DecodeRequest,
  EncodeRequest,
  ImageCodec,
  ImageDecoder,
  ImageEncoder,
  ImageMetadata,
} from '../codec.ts'
import { ImageError, invalidInput, limitExceeded, truncatedInput } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import { ascii, uint32BigEndian } from './helpers.ts'
import { crc32, updateCrc32 } from './crc32.ts'

const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
const idatType = Uint8Array.of(73, 68, 65, 84)
const scanlineBlockRows = 32
const sourceReadSize = 65_536

type PngColorType = 0 | 2 | 3 | 4 | 6

interface ChunkRange {
  readonly offset: number
  readonly length: number
  readonly expectedCrc: number
}

interface PngDescription {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colorType: PngColorType
  readonly hasAlpha: boolean
  readonly frames: number
  readonly palette: Uint8Array | undefined
  readonly transparency: Uint8Array | undefined
  readonly idat: readonly ChunkRange[]
}

interface CropRegion {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const isPng = (header: Uint8Array): boolean =>
  signature.every((byte, index) => header[index] === byte)

const isColorType = (value: number): value is PngColorType =>
  value === 0 || value === 2 || value === 3 || value === 4 || value === 6

const validBitDepth = (colorType: PngColorType, bitDepth: number): boolean => {
  if (colorType === 0)
    return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || bitDepth === 16
  if (colorType === 3) return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8
  return bitDepth === 8 || bitDepth === 16
}

const colorSpace = (colorType: PngColorType): string => {
  if (colorType === 0 || colorType === 4) return 'gray'
  if (colorType === 3) return 'indexed'
  return 'srgb'
}

const channelsForColorType = (colorType: PngColorType): number => {
  if (colorType === 0 || colorType === 3) return 1
  if (colorType === 2) return 3
  if (colorType === 4) return 2
  return 4
}

const outputFormat = (description: PngDescription): PixelFormat => {
  if (description.colorType === 0 && !description.hasAlpha) return 'gray8'
  if ((description.colorType === 2 || description.colorType === 3) && !description.hasAlpha) {
    return 'rgb8'
  }
  return 'rgba8'
}

const bytesPerPixel = (format: PixelFormat): number => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  throw invalidInput(`PNG does not support ${format} encoder input`)
}

const checkedChunkEnd = (offset: number, length: number, size: number, type: string): number => {
  const end = offset + length + 12
  if (!Number.isSafeInteger(end) || end > size)
    throw truncatedInput(`PNG ${type} chunk is truncated`)
  return end
}

const parsePng = async (
  source: ImageSource,
  limits: ImageLimits,
  requireImageData: boolean,
): Promise<PngDescription> => {
  const header = await readExactly(source, 0, 33)
  if (!isPng(header) || ascii(header, 12, 4) !== 'IHDR' || uint32BigEndian(header, 8) !== 13) {
    throw invalidInput('PNG is missing a valid IHDR chunk')
  }

  const width = uint32BigEndian(header, 16)
  const height = uint32BigEndian(header, 20)
  const bitDepth = header[24]
  const rawColorType = header[25]
  const compression = header[26]
  const filter = header[27]
  const interlace = header[28]
  if (
    bitDepth === undefined ||
    rawColorType === undefined ||
    !isColorType(rawColorType) ||
    !validBitDepth(rawColorType, bitDepth)
  ) {
    throw invalidInput('PNG has unsupported or invalid color metadata')
  }
  if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) {
    throw invalidInput('PNG uses unsupported compression, filtering, or interlace metadata')
  }

  validateImageDimensions(width, height, 1, limits)

  let frames = 1
  let hasAlpha = rawColorType === 4 || rawColorType === 6
  let palette: Uint8Array | undefined
  let transparency: Uint8Array | undefined
  const idat: ChunkRange[] = []
  let offset = 33
  let chunks = 0
  let foundEnd = false
  let leftImageData = false

  while (offset + 12 <= source.size && chunks < 10_000) {
    const chunkHeader = await readExactly(source, offset, 8)
    const length = uint32BigEndian(chunkHeader, 0)
    const type = ascii(chunkHeader, 4, 4)
    const end = checkedChunkEnd(offset, length, source.size, type)
    const dataOffset = offset + 8

    if (type === 'PLTE') {
      if (length < 3 || length > 768 || length % 3 !== 0)
        throw invalidInput('PNG palette is invalid')
      palette = (await readExactly(source, dataOffset, length)).slice()
    } else if (type === 'tRNS') {
      if (rawColorType === 4 || rawColorType === 6)
        throw invalidInput('PNG tRNS is invalid for an alpha color type')
      transparency = (await readExactly(source, dataOffset, length)).slice()
      hasAlpha = true
    } else if (type === 'acTL') {
      if (length !== 8) throw invalidInput('PNG acTL chunk is invalid')
      const animation = await readExactly(source, dataOffset, length)
      frames = uint32BigEndian(animation, 0)
      if (frames < 1) throw invalidInput('PNG animation has no frames')
      validateImageDimensions(width, height, frames, limits)
    } else if (type === 'IDAT') {
      if (leftImageData) throw invalidInput('PNG IDAT chunks must be consecutive')
      const crcBytes = await readExactly(source, dataOffset + length, 4)
      idat.push({ offset: dataOffset, length, expectedCrc: uint32BigEndian(crcBytes, 0) })
      if (!requireImageData) break
    } else if (type === 'IEND') {
      if (length !== 0) throw invalidInput('PNG IEND chunk is invalid')
      foundEnd = true
      break
    } else {
      if (idat.length > 0) leftImageData = true
      const typeByte = chunkHeader[4]
      if (typeByte !== undefined && (typeByte & 0x20) === 0) {
        throw invalidInput(`PNG contains unsupported critical chunk ${type}`)
      }
    }

    offset = end
    chunks += 1
  }

  if (chunks >= 10_000) throw invalidInput('PNG contains too many chunks')
  if (requireImageData) {
    if (interlace !== 0) throw invalidInput('Interlaced PNG decoding is not supported yet')
    if (idat.length === 0) throw invalidInput('PNG is missing image data')
    if (!foundEnd) throw truncatedInput('PNG is missing its IEND chunk')
    if (rawColorType === 3 && palette === undefined)
      throw invalidInput('Indexed PNG is missing its palette')
    if (rawColorType === 0 && transparency !== undefined && transparency.byteLength !== 2) {
      throw invalidInput('Grayscale PNG transparency is invalid')
    }
    if (rawColorType === 2 && transparency !== undefined && transparency.byteLength !== 6) {
      throw invalidInput('Truecolor PNG transparency is invalid')
    }
    if (
      rawColorType === 3 &&
      transparency !== undefined &&
      transparency.byteLength > (palette?.byteLength ?? 0) / 3
    ) {
      throw invalidInput('Indexed PNG transparency exceeds its palette')
    }
  }

  return {
    width,
    height,
    bitDepth,
    colorType: rawColorType,
    hasAlpha,
    frames,
    palette,
    transparency,
    idat,
  }
}

const readCompressedChunks = async function* (
  source: ImageSource,
  chunks: readonly ChunkRange[],
): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) {
    let crc = updateCrc32(0xffffffff, idatType)
    let position = 0
    while (position < chunk.length) {
      const data = await readExactly(
        source,
        chunk.offset + position,
        Math.min(sourceReadSize, chunk.length - position),
      )
      crc = updateCrc32(crc, data)
      position += data.byteLength
      yield data
    }
    if ((crc ^ 0xffffffff) >>> 0 !== chunk.expectedCrc) {
      throw invalidInput('PNG IDAT checksum does not match its data')
    }
  }
}

const arrayBufferView = (data: Uint8Array): Uint8Array<ArrayBuffer> =>
  data.buffer instanceof ArrayBuffer
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : Uint8Array.from(data)

const decompressedChunks = async function* (
  source: ImageSource,
  chunks: readonly ChunkRange[],
): AsyncGenerator<Uint8Array> {
  const decompressor = new DecompressionStream('deflate')
  const writer = decompressor.writable.getWriter()
  const reader = decompressor.readable.getReader()
  let feedError: unknown
  const feeding = (async () => {
    try {
      for await (const chunk of readCompressedChunks(source, chunks)) {
        await writer.write(arrayBufferView(chunk))
      }
      await writer.close()
    } catch (error) {
      feedError = error
      try {
        await writer.abort(error)
      } catch {
        // The stored feed error is reported after the readable side settles.
      }
    }
  })()
  let readError: unknown
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      yield next.value
    }
  } catch (error) {
    readError = error
  } finally {
    reader.releaseLock()
    await feeding
  }
  if (feedError instanceof ImageError) throw feedError
  if (feedError !== undefined || readError !== undefined) {
    throw invalidInput('PNG image data could not be decompressed')
  }
}

const paeth = (left: number, up: number, upperLeft: number): number => {
  const prediction = left + up - upperLeft
  const leftDistance = Math.abs(prediction - left)
  const upDistance = Math.abs(prediction - up)
  const upperLeftDistance = Math.abs(prediction - upperLeft)
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left
  return upDistance <= upperLeftDistance ? up : upperLeft
}

const unfilter = (
  scanline: Uint8Array,
  previous: Uint8Array,
  filterBytesPerPixel: number,
): void => {
  const filterType = scanline[0]
  if (filterType === undefined || filterType > 4)
    throw invalidInput(`PNG filter ${filterType ?? -1} is invalid`)
  for (let index = 0; index < previous.byteLength; index += 1) {
    const encoded = scanline[index + 1] ?? 0
    const left = index >= filterBytesPerPixel ? (scanline[index + 1 - filterBytesPerPixel] ?? 0) : 0
    const up = previous[index] ?? 0
    const upperLeft =
      index >= filterBytesPerPixel ? (previous[index - filterBytesPerPixel] ?? 0) : 0
    let predictor = 0
    if (filterType === 1) predictor = left
    else if (filterType === 2) predictor = up
    else if (filterType === 3) predictor = Math.floor((left + up) / 2)
    else if (filterType === 4) predictor = paeth(left, up, upperLeft)
    scanline[index + 1] = (encoded + predictor) & 0xff
  }
}

const sample = (row: Uint8Array, sampleIndex: number, bitDepth: number): number => {
  if (bitDepth === 16) {
    const offset = sampleIndex * 2
    const high = row[offset]
    const low = row[offset + 1]
    if (high === undefined || low === undefined)
      throw truncatedInput('PNG scanline sample is truncated')
    return high * 256 + low
  }
  if (bitDepth === 8) {
    const value = row[sampleIndex]
    if (value === undefined) throw truncatedInput('PNG scanline sample is truncated')
    return value
  }
  const bitOffset = sampleIndex * bitDepth
  const packed = row[Math.floor(bitOffset / 8)]
  if (packed === undefined) throw truncatedInput('PNG packed scanline sample is truncated')
  return (packed >>> (8 - bitDepth - (bitOffset % 8))) & ((1 << bitDepth) - 1)
}

const sampleToByte = (value: number, bitDepth: number): number => {
  if (bitDepth === 16) return value >>> 8
  if (bitDepth === 8) return value
  return Math.round((value * 255) / ((1 << bitDepth) - 1))
}

const uint16 = (data: Uint8Array, offset: number): number => {
  const high = data[offset]
  const low = data[offset + 1]
  if (high === undefined || low === undefined)
    throw invalidInput('PNG transparency data is truncated')
  return high * 256 + low
}

const convertRow = (
  row: Uint8Array,
  description: PngDescription,
  cropX: number,
  width: number,
  output: Uint8Array,
  outputOffset: number,
): void => {
  const { bitDepth, colorType, palette, transparency } = description
  let target = outputOffset

  for (let x = cropX; x < cropX + width; x += 1) {
    if (colorType === 0) {
      const gray = sample(row, x, bitDepth)
      const byte = sampleToByte(gray, bitDepth)
      if (transparency === undefined) output[target++] = byte
      else {
        output[target++] = byte
        output[target++] = byte
        output[target++] = byte
        output[target++] = gray === uint16(transparency, 0) ? 0 : 255
      }
      continue
    }

    if (colorType === 2) {
      const source = x * 3
      const red = sample(row, source, bitDepth)
      const green = sample(row, source + 1, bitDepth)
      const blue = sample(row, source + 2, bitDepth)
      output[target++] = sampleToByte(red, bitDepth)
      output[target++] = sampleToByte(green, bitDepth)
      output[target++] = sampleToByte(blue, bitDepth)
      if (transparency !== undefined) {
        output[target++] =
          red === uint16(transparency, 0) &&
          green === uint16(transparency, 2) &&
          blue === uint16(transparency, 4)
            ? 0
            : 255
      }
      continue
    }

    if (colorType === 3) {
      const paletteIndex = sample(row, x, bitDepth)
      const paletteOffset = paletteIndex * 3
      const red = palette?.[paletteOffset]
      const green = palette?.[paletteOffset + 1]
      const blue = palette?.[paletteOffset + 2]
      if (red === undefined || green === undefined || blue === undefined)
        throw invalidInput(`PNG palette index ${paletteIndex} is out of range`)
      output[target++] = red
      output[target++] = green
      output[target++] = blue
      if (transparency !== undefined) output[target++] = transparency[paletteIndex] ?? 255
      continue
    }

    if (colorType === 4) {
      const source = x * 2
      const gray = sampleToByte(sample(row, source, bitDepth), bitDepth)
      output[target++] = gray
      output[target++] = gray
      output[target++] = gray
      output[target++] = sampleToByte(sample(row, source + 1, bitDepth), bitDepth)
      continue
    }

    const source = x * 4
    output[target++] = sampleToByte(sample(row, source, bitDepth), bitDepth)
    output[target++] = sampleToByte(sample(row, source + 1, bitDepth), bitDepth)
    output[target++] = sampleToByte(sample(row, source + 2, bitDepth), bitDepth)
    output[target++] = sampleToByte(sample(row, source + 3, bitDepth), bitDepth)
  }
}

const cropRegion = (width: number, height: number, request: DecodeRequest = {}): CropRegion => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const cropWidth = request.width ?? width - x
  const cropHeight = request.height ?? height - y
  for (const [name, value] of Object.entries({ x, y, width: cropWidth, height: cropHeight })) {
    const minimum = name === 'x' || name === 'y' ? 0 : 1
    if (!Number.isSafeInteger(value) || value < minimum)
      throw invalidInput(`Decode ${name} is invalid`)
  }
  if (x + cropWidth > width || y + cropHeight > height) {
    throw invalidInput(
      `Decode region ${x},${y} ${cropWidth}x${cropHeight} exceeds ${width}x${height}`,
    )
  }
  return { x, y, width: cropWidth, height: cropHeight }
}

class PngDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #source: ImageSource
  readonly #description: PngDescription
  readonly #limits: ImageLimits

  constructor(source: ImageSource, description: PngDescription, limits: ImageLimits) {
    this.#source = source
    this.#description = description
    this.#limits = limits
    this.width = description.width
    this.height = description.height
    this.pixelFormat = outputFormat(description)
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = cropRegion(this.width, this.height, request)
    const sourceChannels = channelsForColorType(this.#description.colorType)
    const bitsPerPixel = sourceChannels * this.#description.bitDepth
    const rowBytes = Math.ceil((this.width * bitsPerPixel) / 8)
    const inflatedBytes = BigInt(rowBytes + 1) * BigInt(this.height)
    if (inflatedBytes > BigInt(this.#limits.maxDecodedBytes)) {
      throw limitExceeded(
        `PNG scanlines require ${inflatedBytes} bytes; maxDecodedBytes is ${this.#limits.maxDecodedBytes}`,
      )
    }

    const filterBytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8))
    const scanline = new Uint8Array(rowBytes + 1)
    const previous = new Uint8Array(rowBytes)
    const outputChannels = bytesPerPixel(this.pixelFormat)
    const outputStride = region.width * outputChannels
    const rowsPerBlock = Math.min(scanlineBlockRows, region.height)
    let block = new Uint8Array(outputStride * rowsPerBlock)
    let blockHeight = 0
    let outputY = 0
    let filled = 0
    let row = 0

    for await (const chunk of decompressedChunks(this.#source, this.#description.idat)) {
      let chunkOffset = 0
      while (chunkOffset < chunk.byteLength) {
        if (row >= this.height) throw invalidInput('PNG image data contains extra scanlines')
        const length = Math.min(scanline.byteLength - filled, chunk.byteLength - chunkOffset)
        scanline.set(chunk.subarray(chunkOffset, chunkOffset + length), filled)
        filled += length
        chunkOffset += length
        if (filled !== scanline.byteLength) continue

        unfilter(scanline, previous, filterBytesPerPixel)
        if (row >= region.y && row < region.y + region.height) {
          convertRow(
            scanline.subarray(1),
            this.#description,
            region.x,
            region.width,
            block,
            blockHeight * outputStride,
          )
          blockHeight += 1
          if (blockHeight === rowsPerBlock) {
            yield {
              x: 0,
              y: outputY,
              width: region.width,
              height: blockHeight,
              stride: outputStride,
              format: this.pixelFormat,
              data: block,
            }
            outputY += blockHeight
            blockHeight = 0
            const remainingRows = region.height - outputY
            if (remainingRows > 0)
              block = new Uint8Array(outputStride * Math.min(rowsPerBlock, remainingRows))
          }
        }
        previous.set(scanline.subarray(1))
        filled = 0
        row += 1
      }
    }

    if (filled !== 0 || row !== this.height)
      throw truncatedInput(`PNG ended after ${row} of ${this.height} scanlines`)
    if (blockHeight > 0) {
      yield {
        x: 0,
        y: outputY,
        width: region.width,
        height: blockHeight,
        stride: outputStride,
        format: this.pixelFormat,
        data: block.subarray(0, outputStride * blockHeight),
      }
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const compressionLevel = (options: unknown): number => {
  if (!isRecord(options)) throw invalidInput('PNG encoder options must be an object')
  const value = options.compressionLevel ?? 6
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0 || value > 9) {
    throw invalidInput('PNG compressionLevel must be an integer from 0 to 9')
  }
  return value
}

const typeBytes = (type: string): Uint8Array => {
  if (type.length !== 4) throw new Error('PNG chunk types contain four bytes')
  return Uint8Array.from(type, (character) => character.charCodeAt(0))
}

const uint32Bytes = (value: number): Uint8Array => {
  const output = new Uint8Array(4)
  new DataView(output.buffer).setUint32(0, value)
  return output
}

const writeChunk = async (sink: ImageSink, type: string, data: Uint8Array): Promise<void> => {
  const encodedType = typeBytes(type)
  await sink.write(uint32Bytes(data.byteLength))
  await sink.write(encodedType)
  await sink.write(data)
  await sink.write(uint32Bytes(crc32(encodedType, data)))
}

const waitForDrain = (deflater: Deflate): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = (): void => {
      deflater.off('drain', drained)
      deflater.off('error', failed)
    }
    const drained = (): void => {
      cleanup()
      resolve()
    }
    const failed = (error: unknown): void => {
      cleanup()
      reject(error)
    }
    deflater.once('drain', drained)
    deflater.once('error', failed)
  })

class PngEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #deflater: Deflate
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #channels: number
  readonly #completion: Promise<void>
  #expectedY = 0
  #finished = false

  constructor(
    sink: ImageSink,
    deflater: Deflate,
    width: number,
    height: number,
    format: PixelFormat,
  ) {
    this.#sink = sink
    this.#deflater = deflater
    this.#width = width
    this.#height = height
    this.#format = format
    this.#channels = bytesPerPixel(format)
    this.#completion = new Promise((resolve, reject) => {
      let writes = Promise.resolve()
      deflater.on('data', (chunk: unknown) => {
        deflater.pause()
        if (!(chunk instanceof Uint8Array)) {
          reject(invalidInput('PNG compressor returned invalid data'))
          return
        }
        writes = writes.then(() => writeChunk(sink, 'IDAT', chunk))
        writes.then(
          () => deflater.resume(),
          (error: unknown) => {
            reject(error)
            deflater.destroy(error instanceof Error ? error : new Error('PNG output failed'))
          },
        )
      })
      deflater.once('error', (error: unknown) => reject(error))
      deflater.once('end', () => writes.then(resolve, reject))
    })
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished PNG encoder')
    if (
      block.x !== 0 ||
      block.y !== this.#expectedY ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.y + block.height > this.#height ||
      block.format !== this.#format
    ) {
      throw invalidInput('PNG encoder requires ordered, full-width pixel blocks')
    }
    const rowBytes = this.#width * this.#channels
    if (
      block.stride < rowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + rowBytes
    ) {
      throw invalidInput('PNG encoder pixel block data is truncated')
    }

    const scanlines = new Uint8Array((rowBytes + 1) * block.height)
    for (let row = 0; row < block.height; row += 1) {
      scanlines.set(
        block.data.subarray(row * block.stride, row * block.stride + rowBytes),
        row * (rowBytes + 1) + 1,
      )
    }
    if (!this.#deflater.write(scanlines)) await waitForDrain(this.#deflater)
    this.#expectedY += block.height
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('PNG encoder is already finished')
    this.#finished = true
    if (this.#expectedY !== this.#height) {
      throw invalidInput(`PNG encoder received ${this.#expectedY} of ${this.#height} rows`)
    }
    this.#deflater.end()
    await this.#completion
    await writeChunk(this.#sink, 'IEND', new Uint8Array())
  }

  async abort(reason: unknown): Promise<void> {
    this.#finished = true
    if (!this.#deflater.destroyed) {
      this.#deflater.destroy(reason instanceof Error ? reason : new Error('PNG encoding aborted'))
    }
    try {
      await this.#completion
    } catch {
      // The pipeline rethrows the original failure after releasing encoder resources.
    }
  }
}

const createPngEncoder = async (sink: ImageSink, request: EncodeRequest): Promise<ImageEncoder> => {
  if (
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width < 1 ||
    request.height < 1 ||
    request.width > 0xffffffff ||
    request.height > 0xffffffff
  ) {
    throw invalidInput(`Invalid PNG output dimensions: ${request.width}x${request.height}`)
  }
  const channels = bytesPerPixel(request.pixelFormat)
  const level = compressionLevel(request.options)
  await sink.write(signature)
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, request.width)
  view.setUint32(4, request.height)
  header[8] = 8
  header[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6
  await writeChunk(sink, 'IHDR', header)

  const { createDeflate } = await import('node:zlib')
  return new PngEncoder(
    sink,
    createDeflate({ level }),
    request.width,
    request.height,
    request.pixelFormat,
  )
}

export const pngCodec: ImageCodec = {
  format: 'png',
  mimeTypes: ['image/png'],
  minimumBytes: signature.length,
  detect: isPng,
  async metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> {
    const description = await parsePng(source, limits, false)
    return {
      width: description.width,
      height: description.height,
      format: 'png',
      mimeType: 'image/png',
      hasAlpha: description.hasAlpha,
      colorSpace: colorSpace(description.colorType),
      bitDepth: description.bitDepth,
      frames: description.frames,
    }
  },
  async createDecoder(source: ImageSource, limits: ImageLimits): Promise<ImageDecoder> {
    return new PngDecoder(source, await parsePng(source, limits, true), limits)
  },
  createEncoder: createPngEncoder,
}
