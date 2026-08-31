import { throwIfAborted } from '../abort.ts'
import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import { validateImageDimensions } from '../limits.ts'
import type { JpegXlEncodeOptions } from '../pipeline.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'

class JpegXlBitWriter {
  #bytes = new Uint8Array(256)
  #bitPosition = 0

  writeBits(value: number, count: number): void {
    if (
      !Number.isSafeInteger(value) ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 32 ||
      value < 0 ||
      value >= 2 ** count
    ) {
      throw invalidInput('JPEG XL output bit field is invalid')
    }
    this.#ensure(this.#bitPosition + count)
    for (let index = 0; index < count; index += 1) {
      const position = this.#bitPosition + index
      if ((Math.floor(value / 2 ** index) & 1) !== 0) {
        this.#bytes[position >>> 3] = (this.#bytes[position >>> 3] ?? 0) | (1 << (position & 7))
      }
    }
    this.#bitPosition += count
  }

  alignToByte(): void {
    const padding = (8 - (this.#bitPosition & 7)) & 7
    if (padding !== 0) this.writeBits(0, padding)
  }

  finish(): Uint8Array {
    this.alignToByte()
    return this.#bytes.slice(0, this.#bitPosition >>> 3)
  }

  #ensure(bits: number): void {
    const bytes = Math.ceil(bits / 8)
    if (bytes <= this.#bytes.byteLength) return
    let length = this.#bytes.byteLength
    while (length < bytes) length *= 2
    const grown = new Uint8Array(length)
    grown.set(this.#bytes)
    this.#bytes = grown
  }
}

const writeU32 = (
  writer: JpegXlBitWriter,
  value: number,
  distributions: readonly (
    | { readonly value: number }
    | { readonly bits: number; readonly offset: number }
  )[],
): void => {
  for (let selector = 0; selector < distributions.length; selector += 1) {
    const distribution = distributions[selector]
    if (!distribution) continue
    if ('value' in distribution) {
      if (distribution.value !== value) continue
      writer.writeBits(selector, 2)
      return
    }
    const encoded = value - distribution.offset
    if (encoded < 0 || encoded >= 2 ** distribution.bits) continue
    writer.writeBits(selector, 2)
    writer.writeBits(encoded, distribution.bits)
    return
  }
  throw invalidInput('JPEG XL output integer is outside its distribution')
}

const writeZeroU64 = (writer: JpegXlBitWriter): void => writer.writeBits(0, 2)

const writeDimension = (writer: JpegXlBitWriter, dimension: number): void =>
  writeU32(writer, dimension, [
    { bits: 9, offset: 1 },
    { bits: 13, offset: 1 },
    { bits: 18, offset: 1 },
    { bits: 30, offset: 1 },
  ])

const writeBitDepth = (writer: JpegXlBitWriter, bitDepth: 8 | 16): void => {
  writer.writeBits(0, 1)
  writeU32(writer, bitDepth, [{ value: 8 }, { value: 10 }, { value: 12 }, { bits: 6, offset: 1 }])
}

const writeName = (writer: JpegXlBitWriter): void =>
  writeU32(writer, 0, [
    { value: 0 },
    { bits: 4, offset: 0 },
    { bits: 5, offset: 16 },
    { bits: 10, offset: 48 },
  ])

const reverseBits = (value: number, count: number): number => {
  let reversed = 0
  for (let index = 0; index < count; index += 1) {
    reversed = reversed * 2 + ((value >>> index) & 1)
  }
  return reversed
}

const writeVarUint16 = (writer: JpegXlBitWriter, value: number): void => {
  if (value === 0) {
    writer.writeBits(0, 1)
    return
  }
  writer.writeBits(1, 1)
  if (value === 1) {
    writer.writeBits(0, 4)
    return
  }
  const bits = Math.floor(Math.log2(value))
  if (bits > 15) throw invalidInput('JPEG XL prefix alphabet is too large')
  writer.writeBits(bits, 4)
  writer.writeBits(value - 2 ** bits, bits)
}

const codeLengthStatic = new Map<number, Readonly<{ key: number; bits: number }>>([
  [0, Object.freeze({ key: 0, bits: 2 })],
  [1, Object.freeze({ key: 7, bits: 4 })],
])

const writeCodeLengthStaticSymbol = (writer: JpegXlBitWriter, symbol: 0 | 1): void => {
  const code = codeLengthStatic.get(symbol)
  if (!code) throw invalidInput('JPEG XL code-length symbol is unavailable')
  writer.writeBits(code.key, code.bits)
}

const writeFixedPrefixCode = (writer: JpegXlBitWriter, contexts: number): void => {
  writer.writeBits(0, 1)
  if (contexts > 1) {
    writer.writeBits(1, 1)
    writer.writeBits(0, 2)
  }
  writer.writeBits(1, 1)
  writer.writeBits(8, 4)
  writer.writeBits(0, 4)
  writer.writeBits(0, 4)
  writeVarUint16(writer, 511)
  writer.writeBits(0, 2)

  for (let index = 0; index < 8; index += 1) writeCodeLengthStaticSymbol(writer, 0)
  writeCodeLengthStaticSymbol(writer, 1)
  for (let index = 0; index < 2; index += 1) writeCodeLengthStaticSymbol(writer, 0)
  writeCodeLengthStaticSymbol(writer, 1)
  for (let symbol = 0; symbol < 512; symbol += 1) writer.writeBits(0, 1)
}

const writeHybridUint = (writer: JpegXlBitWriter, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 131_071) {
    throw invalidInput('JPEG XL Modular residual is outside the supported encoder range')
  }
  if (value < 256) {
    writer.writeBits(reverseBits(value, 9), 9)
    return
  }
  const extraBits = Math.floor(Math.log2(value))
  const token = 256 + extraBits - 8
  writer.writeBits(reverseBits(token, 9), 9)
  writer.writeBits(value - 2 ** extraBits, extraBits)
}

const packSigned = (value: number): number => (value < 0 ? -2 * value - 1 : 2 * value)

const encodeModularSection = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
): Uint8Array => {
  const writer = new JpegXlBitWriter()
  const highDepth = format.endsWith('16')
  const channels = format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3
  const bytesPerSample = highDepth ? 2 : 1
  const bytesPerPixel = channels * bytesPerSample

  writer.writeBits(1, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(1, 1)
  writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { bits: 4, offset: 2 }, { bits: 8, offset: 18 }])

  writeFixedPrefixCode(writer, 6)
  for (const symbol of [0, 1, 0, 0, 0]) writeHybridUint(writer, symbol)
  writeFixedPrefixCode(writer, 1)

  for (let channel = 0; channel < channels; channel += 1) {
    for (let y = 0; y < height; y += 1) {
      let left = 0
      for (let x = 0; x < width; x += 1) {
        const position = (y * width + x) * bytesPerPixel + channel * bytesPerSample
        const sample = highDepth
          ? (pixels[position] ?? 0) * 256 + (pixels[position + 1] ?? 0)
          : (pixels[position] ?? 0)
        if (x === 0 && y > 0) {
          const top = ((y - 1) * width + x) * bytesPerPixel + channel * bytesPerSample
          left = highDepth ? (pixels[top] ?? 0) * 256 + (pixels[top + 1] ?? 0) : (pixels[top] ?? 0)
        }
        writeHybridUint(writer, packSigned(sample - left))
        left = sample
      }
    }
  }
  return writer.finish()
}

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const ascii = (value: string): Uint8Array =>
  Uint8Array.from(value, (character) => character.charCodeAt(0))

const uint32 = (value: number): Uint8Array =>
  Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255)

const box = (type: string, payload: Uint8Array): Uint8Array => {
  const size = payload.byteLength + 8
  if (size > 0xffff_ffff) throw limitExceeded(`JPEG XL ${type} box exceeds 32-bit size`)
  return concatenate([uint32(size), ascii(type), payload])
}

const wrapContainer = (codestream: Uint8Array): Uint8Array =>
  concatenate([
    Uint8Array.of(0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a),
    box('ftyp', concatenate([ascii('jxl '), uint32(0), ascii('jxl ')])),
    box('jxlc', codestream),
  ])

const encodeCodestream = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
): Uint8Array => {
  const section = encodeModularSection(pixels, width, height, format)
  const writer = new JpegXlBitWriter()
  const highDepth = format.endsWith('16')
  const hasAlpha = format.startsWith('rgba')
  const grayscale = format.startsWith('gray')

  writer.writeBits(0xff, 8)
  writer.writeBits(0x0a, 8)
  writer.writeBits(0, 1)
  writeDimension(writer, height)
  writer.writeBits(0, 3)
  writeDimension(writer, width)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writeBitDepth(writer, highDepth ? 16 : 8)
  writer.writeBits(1, 1)
  writeU32(writer, hasAlpha ? 1 : 0, [
    { value: 0 },
    { value: 1 },
    { bits: 4, offset: 2 },
    { bits: 12, offset: 1 },
  ])
  if (hasAlpha) {
    if (highDepth) {
      writer.writeBits(0, 1)
      writeU32(writer, 0, [
        { value: 0 },
        { value: 1 },
        { bits: 4, offset: 2 },
        { bits: 6, offset: 18 },
      ])
      writeBitDepth(writer, 16)
      writeU32(writer, 0, [{ value: 0 }, { value: 3 }, { value: 4 }, { bits: 3, offset: 1 }])
      writeName(writer)
      writer.writeBits(0, 1)
    } else {
      writer.writeBits(1, 1)
    }
  }
  writer.writeBits(0, 1)
  if (grayscale) {
    writer.writeBits(0, 1)
    writer.writeBits(0, 1)
    writeU32(writer, 1, [
      { value: 0 },
      { value: 1 },
      { bits: 4, offset: 2 },
      { bits: 6, offset: 18 },
    ])
    writeU32(writer, 1, [
      { value: 0 },
      { value: 1 },
      { bits: 4, offset: 2 },
      { bits: 6, offset: 18 },
    ])
    writer.writeBits(0, 1)
    writeU32(writer, 13, [
      { value: 0 },
      { value: 1 },
      { bits: 4, offset: 2 },
      { bits: 6, offset: 18 },
    ])
    writeU32(writer, 1, [
      { value: 0 },
      { value: 1 },
      { bits: 4, offset: 2 },
      { bits: 6, offset: 18 },
    ])
  } else {
    writer.writeBits(1, 1)
  }
  writeZeroU64(writer)
  writer.writeBits(1, 1)
  writer.alignToByte()

  writer.writeBits(0, 1)
  writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }])
  writer.writeBits(1, 1)
  writeZeroU64(writer)
  writer.writeBits(0, 1)
  writeU32(writer, 1, [{ value: 1 }, { value: 2 }, { value: 4 }, { value: 8 }])
  if (hasAlpha) {
    writeU32(writer, 1, [{ value: 1 }, { value: 2 }, { value: 4 }, { value: 8 }])
  }
  writer.writeBits(3, 2)
  writeU32(writer, 1, [{ value: 1 }, { value: 2 }, { value: 3 }, { bits: 3, offset: 4 }])
  writer.writeBits(0, 1)
  writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { bits: 2, offset: 3 }])
  if (hasAlpha) {
    writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { bits: 2, offset: 3 }])
  }
  writer.writeBits(1, 1)
  writeName(writer)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 2)
  writeZeroU64(writer)
  writeZeroU64(writer)
  writer.writeBits(0, 1)
  writer.alignToByte()
  writeU32(writer, section.byteLength, [
    { bits: 10, offset: 0 },
    { bits: 14, offset: 1_024 },
    { bits: 22, offset: 17_408 },
    { bits: 30, offset: 4_211_712 },
  ])
  writer.alignToByte()
  return concatenate([writer.finish(), section])
}

const supportedFormat = (
  format: PixelFormat,
): format is 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16' =>
  format === 'gray8' ||
  format === 'gray16' ||
  format === 'rgb8' ||
  format === 'rgb16' ||
  format === 'rgba8' ||
  format === 'rgba16'

const readOptions = (value: unknown): Readonly<Required<JpegXlEncodeOptions>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidInput('JPEG XL encoder options must be an object')
  }
  const options = value as Readonly<Record<string, unknown>>
  for (const key of Object.keys(options)) {
    if (key !== 'mode' && key !== 'effort' && key !== 'container') {
      throw invalidInput(`Unknown JPEG XL encoder option: ${key}`)
    }
  }
  if (options.mode !== undefined && options.mode !== 'lossless') {
    throw invalidInput('JPEG XL encoder mode must be lossless')
  }
  if (options.effort !== undefined && options.effort !== 1) {
    throw invalidInput('JPEG XL encoder effort must be 1')
  }
  if (options.container !== undefined && typeof options.container !== 'boolean') {
    throw invalidInput('JPEG XL encoder container must be a boolean')
  }
  return Object.freeze({ mode: 'lossless', effort: 1, container: options.container ?? true })
}

class JpegXlModularEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #request: EncodeRequest
  readonly #options: Readonly<Required<JpegXlEncodeOptions>>
  readonly #pixels: Uint8Array
  readonly #rowBytes: number
  #nextY = 0
  #finished = false

  constructor(
    sink: ImageSink,
    request: EncodeRequest,
    options: Readonly<Required<JpegXlEncodeOptions>>,
  ) {
    this.#sink = sink
    this.#request = request
    this.#options = options
    const channels = request.pixelFormat.startsWith('gray')
      ? 1
      : request.pixelFormat.startsWith('rgba')
        ? 4
        : 3
    const bytesPerSample = request.pixelFormat.endsWith('16') ? 2 : 1
    this.#rowBytes = request.width * channels * bytesPerSample
    this.#pixels = new Uint8Array(this.#rowBytes * request.height)
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw invalidInput('Cannot write to a finished JPEG XL encoder')
    throwIfAborted(this.#request.signal)
    if (
      block.x !== 0 ||
      block.y !== this.#nextY ||
      block.width !== this.#request.width ||
      block.height < 1 ||
      block.y + block.height > this.#request.height ||
      block.format !== this.#request.pixelFormat ||
      block.stride < this.#rowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + this.#rowBytes
    ) {
      throw invalidInput('JPEG XL encoder requires ordered, full-width pixel blocks')
    }
    for (let row = 0; row < block.height; row += 1) {
      const source = row * block.stride
      this.#pixels.set(
        block.data.subarray(source, source + this.#rowBytes),
        (this.#nextY + row) * this.#rowBytes,
      )
    }
    this.#nextY += block.height
  }

  async finish(): Promise<void> {
    if (this.#finished) throw invalidInput('JPEG XL encoder is already finished')
    this.#finished = true
    if (this.#nextY !== this.#request.height) {
      throw truncatedInput(
        `JPEG XL encoder received ${this.#nextY} of ${this.#request.height} rows`,
      )
    }
    throwIfAborted(this.#request.signal)
    if (!supportedFormat(this.#request.pixelFormat)) {
      throw unsupportedOperation(
        `JPEG XL encoding does not support ${this.#request.pixelFormat} pixels`,
      )
    }
    const codestream = encodeCodestream(
      this.#pixels,
      this.#request.width,
      this.#request.height,
      this.#request.pixelFormat,
    )
    const output = this.#options.container ? wrapContainer(codestream) : codestream
    const jpegXlLimits = resolveJpegXlLimits()
    if (output.byteLength > jpegXlLimits.maxCodestreamBytes) {
      throw limitExceeded(
        `JPEG XL output requires ${output.byteLength} bytes; maxCodestreamBytes is ${jpegXlLimits.maxCodestreamBytes}`,
      )
    }
    await this.#sink.write(output)
  }
}

export const createJpegXlModularEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
): Promise<ImageEncoder> => {
  if (!supportedFormat(request.pixelFormat)) {
    throw unsupportedOperation(`JPEG XL encoding does not support ${request.pixelFormat} pixels`)
  }
  if (request.metadata?.exif || request.metadata?.icc || request.metadata?.xmp) {
    throw unsupportedOperation('JPEG XL metadata preservation is not supported by this encoder yet')
  }
  const limits = request.limits
  if (limits) validateImageDimensions(request.width, request.height, 1, limits)
  if (request.width > 1_024 || request.height > 1_024) {
    throw unsupportedOperation(
      'JPEG XL initial lossless encoder is limited to one 1024-pixel group',
    )
  }
  const channels = request.pixelFormat.startsWith('gray')
    ? 1
    : request.pixelFormat.startsWith('rgba')
      ? 4
      : 3
  const bytesPerSample = request.pixelFormat.endsWith('16') ? 2 : 1
  const workingBytes =
    BigInt(request.width) * BigInt(request.height) * BigInt(channels * bytesPerSample)
  if (limits && workingBytes > BigInt(limits.maxDecodedBytes)) {
    throw limitExceeded(
      `JPEG XL encoder pixels require ${workingBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
    )
  }
  return new JpegXlModularEncoder(sink, request, readOptions(request.options))
}
