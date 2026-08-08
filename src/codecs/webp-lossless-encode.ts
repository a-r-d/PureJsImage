import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'

class BitWriter {
  readonly #sink: ImageSink
  #bytes = new Uint8Array(4096)
  #length = 0
  #current = 0
  #bitCount = 0

  constructor(sink: ImageSink) {
    this.#sink = sink
  }

  writeBits(value: number, length: number): void {
    let remaining = length
    let bits = value
    while (remaining > 0) {
      const count = Math.min(8 - this.#bitCount, remaining)
      this.#current |= (bits & ((1 << count) - 1)) << this.#bitCount
      this.#bitCount += count
      remaining -= count
      bits >>>= count
      if (this.#bitCount === 8) {
        this.#append(this.#current)
        this.#current = 0
        this.#bitCount = 0
      }
    }
  }

  async flushComplete(): Promise<void> {
    if (this.#length === 0) return
    await this.#sink.write(this.#bytes.slice(0, this.#length))
    this.#length = 0
  }

  async finish(): Promise<void> {
    if (this.#bitCount > 0) this.#append(this.#current)
    this.#current = 0
    this.#bitCount = 0
    await this.flushComplete()
  }

  #append(value: number): void {
    if (this.#length === this.#bytes.length) {
      const grown = new Uint8Array(this.#bytes.length * 2)
      grown.set(this.#bytes)
      this.#bytes = grown
    }
    this.#bytes[this.#length] = value
    this.#length += 1
  }
}

const reversedBytes = Uint8Array.from({ length: 256 }, (_, value) => {
  let reversed = 0
  for (let bit = 0; bit < 8; bit += 1) reversed |= ((value >>> bit) & 1) << (7 - bit)
  return reversed
})

const fixedLiteralCodeLengths = Uint8Array.of(0, 2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 1, 0, 0)

const writeCodeLengthSymbol = (writer: BitWriter, symbol: 8 | 16 | 18): void => {
  if (symbol === 8) writer.writeBits(0, 1)
  else if (symbol === 16) writer.writeBits(1, 2)
  else writer.writeBits(3, 2)
}

const writeFixedLiteralTree = (writer: BitWriter, alphabetSize: 256 | 280): void => {
  writer.writeBits(0, 1)
  writer.writeBits(10, 4)
  for (const length of fixedLiteralCodeLengths) {
    writer.writeBits(length, 3)
  }
  writer.writeBits(0, 1)
  writeCodeLengthSymbol(writer, 8)
  let remaining = 255
  while (remaining > 0) {
    const repeat = Math.min(6, remaining)
    writeCodeLengthSymbol(writer, 16)
    writer.writeBits(repeat - 3, 2)
    remaining -= repeat
  }
  if (alphabetSize === 280) {
    writeCodeLengthSymbol(writer, 18)
    writer.writeBits(13, 7)
  }
}

const writeSingleZeroTree = (writer: BitWriter): void => {
  writer.writeBits(1, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
}

const uint32 = (data: Uint8Array, offset: number, value: number): void => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  view.setUint32(offset, value, true)
}

const uint24 = (data: Uint8Array, offset: number, value: number): void => {
  data[offset] = value & 255
  data[offset + 1] = (value >>> 8) & 255
  data[offset + 2] = (value >>> 16) & 255
}

const channels = (format: PixelFormat): number => {
  if (format === 'gray8') return 1
  if (format === 'rgb8') return 3
  if (format === 'rgba8') return 4
  throw invalidInput(`WebP encoder does not support ${format} pixels`)
}

class LosslessWebpEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #writer: BitWriter
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #channels: number
  readonly #exif: Uint8Array | undefined
  #expectedY = 0
  #finished = false

  constructor(
    sink: ImageSink,
    writer: BitWriter,
    width: number,
    height: number,
    format: PixelFormat,
    exif: Uint8Array | undefined,
  ) {
    this.#sink = sink
    this.#writer = writer
    this.#width = width
    this.#height = height
    this.#format = format
    this.#channels = channels(format)
    this.#exif = exif
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished WebP encoder')
    const rowBytes = this.#width * this.#channels
    if (
      block.x !== 0 ||
      block.y !== this.#expectedY ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.y + block.height > this.#height ||
      block.format !== this.#format ||
      block.stride < rowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + rowBytes
    ) {
      throw invalidInput('WebP encoder requires ordered, full-width pixel blocks')
    }

    for (let row = 0; row < block.height; row += 1) {
      for (let x = 0; x < this.#width; x += 1) {
        const offset = row * block.stride + x * this.#channels
        const red = block.data[offset] ?? 0
        const green = this.#channels === 1 ? red : (block.data[offset + 1] ?? 0)
        const blue = this.#channels === 1 ? red : (block.data[offset + 2] ?? 0)
        const alpha = this.#channels === 4 ? (block.data[offset + 3] ?? 0) : 255
        this.#writer.writeBits(reversedBytes[green] ?? 0, 8)
        this.#writer.writeBits(reversedBytes[red] ?? 0, 8)
        this.#writer.writeBits(reversedBytes[blue] ?? 0, 8)
        this.#writer.writeBits(reversedBytes[alpha] ?? 0, 8)
      }
    }
    this.#expectedY += block.height
    await this.#writer.flushComplete()
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('WebP encoder is already finished')
    this.#finished = true
    if (this.#expectedY !== this.#height) {
      throw invalidInput(`WebP encoder received ${this.#expectedY} of ${this.#height} rows`)
    }
    await this.#writer.finish()
    if (this.#exif) await writeChunk(this.#sink, Uint8Array.of(69, 88, 73, 70), this.#exif)
  }

  async abort(): Promise<void> {
    this.#finished = true
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const writeChunk = async (sink: ImageSink, type: Uint8Array, data: Uint8Array): Promise<void> => {
  const output = new Uint8Array(8 + data.byteLength + (data.byteLength & 1))
  output.set(type)
  uint32(output, 4, data.byteLength)
  output.set(data, 8)
  await sink.write(output)
}

export const createLosslessWebpEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
): Promise<ImageEncoder> => {
  if (
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.width < 1 ||
    request.height < 1 ||
    request.width > 16_384 ||
    request.height > 16_384
  ) {
    throw invalidInput(
      `Invalid lossless WebP output dimensions: ${request.width}x${request.height}`,
    )
  }
  if (!isRecord(request.options) || request.options.lossless !== true) {
    throw invalidInput('Lossless WebP encoding requires lossless: true')
  }
  channels(request.pixelFormat)
  const icc = request.metadata?.icc
  const exif = request.metadata?.exif
  if (icc && iccColorSpace(icc) !== 'rgb')
    throw invalidInput('Preserved ICC profile does not match WebP RGB output pixels')

  const pixels = request.width * request.height
  const prefixBits = 900
  const payloadLength = 5 + Math.ceil((prefixBits + pixels * 32) / 8)
  const iccBytes = icc ? 8 + icc.byteLength + (icc.byteLength & 1) : 0
  const exifBytes = exif ? 8 + exif.byteLength + (exif.byteLength & 1) : 0
  const extended = icc !== undefined || exif !== undefined
  const bodyLength = 4 + (extended ? 18 + iccBytes : 0) + 8 + payloadLength + exifBytes
  const header = new Uint8Array(12 + (extended ? 18 + iccBytes : 0) + 13)
  header.set([0x52, 0x49, 0x46, 0x46], 0)
  uint32(header, 4, bodyLength)
  header.set([0x57, 0x45, 0x42, 0x50], 8)
  let offset = 12
  if (extended) {
    header.set([0x56, 0x50, 0x38, 0x58], offset)
    uint32(header, offset + 4, 10)
    header[offset + 8] =
      (icc ? 0x20 : 0) | (request.pixelFormat === 'rgba8' ? 0x10 : 0) | (exif ? 0x08 : 0)
    uint24(header, offset + 12, request.width - 1)
    uint24(header, offset + 15, request.height - 1)
    offset += 18
    if (icc) {
      header.set([0x49, 0x43, 0x43, 0x50], offset)
      uint32(header, offset + 4, icc.byteLength)
      header.set(icc, offset + 8)
      offset += iccBytes
    }
  }
  header.set([0x56, 0x50, 0x38, 0x4c], offset)
  uint32(header, offset + 4, payloadLength)
  header[offset + 8] = 0x2f
  uint32(
    header,
    offset + 9,
    (request.width - 1) |
      ((request.height - 1) << 14) |
      (request.pixelFormat === 'rgba8' ? 1 << 28 : 0),
  )
  await sink.write(header)

  const writer = new BitWriter(sink)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writeFixedLiteralTree(writer, 280)
  writeFixedLiteralTree(writer, 256)
  writeFixedLiteralTree(writer, 256)
  writeFixedLiteralTree(writer, 256)
  writeSingleZeroTree(writer)
  return new LosslessWebpEncoder(
    sink,
    writer,
    request.width,
    request.height,
    request.pixelFormat,
    exif,
  )
}
