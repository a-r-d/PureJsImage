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
import { SourceCursor } from './source-cursor.ts'

const headerBytes = 18
const footer = Uint8Array.from([
  0, 0, 0, 0, 0, 0, 0, 0, 0x54, 0x52, 0x55, 0x45, 0x56, 0x49, 0x53, 0x49, 0x4f, 0x4e, 0x2d, 0x58,
  0x46, 0x49, 0x4c, 0x45, 0x2e, 0,
])
const uncompressedColorMapped = 1
const uncompressedTruecolor = 2
const uncompressedGrayscale = 3
const rleColorMapped = 9
const rleTruecolor = 10
const rleGrayscale = 11
const supportedTypes = new Set([
  uncompressedColorMapped,
  uncompressedTruecolor,
  uncompressedGrayscale,
  rleColorMapped,
  rleTruecolor,
  rleGrayscale,
])

interface TgaDescription {
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

interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const uint16 = (data: Uint8Array, offset: number): number =>
  (data[offset] ?? 0) + (data[offset + 1] ?? 0) * 256

const uint32 = (data: Uint8Array, offset: number): number =>
  ((data[offset] ?? 0) |
    ((data[offset + 1] ?? 0) << 8) |
    ((data[offset + 2] ?? 0) << 16) |
    ((data[offset + 3] ?? 0) << 24)) >>>
  0

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

const fiveBit = (value: number): number => Math.round((value * 255) / 31)

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

const describeTga = async (source: ImageSource, limits: ImageLimits): Promise<TgaDescription> => {
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

const regionFor = (description: TgaDescription, request: DecodeRequest): Region => {
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
    y + height > description.height ||
    request.scaleDenominator !== undefined
  ) {
    throw invalidInput('TGA decode region is invalid')
  }
  return { x, y, width, height }
}

interface TgaRleRows {
  readonly offsets: Float64Array
  readonly remaining: Uint8Array
  readonly runs: Uint8Array
  readonly runPixels: Uint8Array
  readonly dataEnd: number
}

const rleRowStates = async (
  source: ImageSource,
  description: TgaDescription,
  signal: AbortSignal | undefined,
): Promise<TgaRleRows> => {
  const offsets = new Float64Array(description.height)
  const remaining = new Uint8Array(description.height)
  const runs = new Uint8Array(description.height)
  const runPixels = new Uint8Array(description.height * description.bytesPerPixel)
  const cursor = new SourceCursor(
    source,
    description.pixelOffset,
    signal === undefined ? {} : { signal },
  )
  const runPixel = new Uint8Array(description.bytesPerPixel)
  let packetRemaining = 0
  let packetIsRun = false

  for (let row = 0; row < description.height; row += 1) {
    offsets[row] = cursor.offset
    remaining[row] = packetRemaining
    runs[row] = packetIsRun ? 1 : 0
    if (packetIsRun) runPixels.set(runPixel, row * description.bytesPerPixel)

    for (let x = 0; x < description.width; x += 1) {
      if (packetRemaining === 0) {
        const packet = await cursor.byte('TGA RLE packet header is truncated')
        packetRemaining = (packet & 0x7f) + 1
        packetIsRun = (packet & 0x80) !== 0
        if (packetIsRun) {
          for (let byte = 0; byte < runPixel.byteLength; byte += 1) {
            runPixel[byte] = await cursor.byte('TGA RLE run pixel is truncated')
          }
        }
      }
      if (!packetIsRun) {
        await cursor.skip(description.bytesPerPixel, 'TGA RLE raw packet is truncated')
      }
      packetRemaining -= 1
    }
  }
  if (packetRemaining !== 0) throw invalidInput('TGA RLE packet exceeds the image raster')
  return { offsets, remaining, runs, runPixels, dataEnd: cursor.offset }
}

const decodeRleRow = async (
  source: ImageSource,
  states: TgaRleRows,
  row: number,
  description: TgaDescription,
  signal: AbortSignal | undefined,
): Promise<Uint8Array> => {
  const output = new Uint8Array(description.width * description.bytesPerPixel)
  const cursor = new SourceCursor(
    source,
    states.offsets[row] ?? description.pixelOffset,
    signal === undefined ? {} : { signal },
  )
  const pixel = new Uint8Array(description.bytesPerPixel)
  let packetRemaining = states.remaining[row] ?? 0
  let packetIsRun = states.runs[row] === 1
  if (packetIsRun) {
    pixel.set(
      states.runPixels.subarray(
        row * description.bytesPerPixel,
        (row + 1) * description.bytesPerPixel,
      ),
    )
  }

  for (let written = 0; written < description.width; written += 1) {
    if (packetRemaining === 0) {
      const packet = await cursor.byte('TGA RLE packet header is truncated')
      packetRemaining = (packet & 0x7f) + 1
      packetIsRun = (packet & 0x80) !== 0
      if (packetIsRun) {
        for (let byte = 0; byte < pixel.byteLength; byte += 1) {
          pixel[byte] = await cursor.byte('TGA RLE run pixel is truncated')
        }
      }
    }
    const target = written * description.bytesPerPixel
    if (packetIsRun) {
      output.set(pixel, target)
    } else {
      for (let byte = 0; byte < description.bytesPerPixel; byte += 1) {
        output[target + byte] = await cursor.byte('TGA RLE raw packet is truncated')
      }
    }
    packetRemaining -= 1
  }
  return output
}

const validateTrailingData = async (
  source: ImageSource,
  dataEnd: number,
  signal: AbortSignal | undefined,
): Promise<void> => {
  if (dataEnd === source.size) return
  const trailingBytes = source.size - dataEnd
  if (trailingBytes < footer.byteLength) throw truncatedInput('TGA 2.0 footer is truncated')
  const footerOffset = source.size - footer.byteLength
  const encoded = await readExactly(
    source,
    footerOffset,
    footer.byteLength,
    signal === undefined ? {} : { signal },
  )
  for (let index = 8; index < footer.byteLength; index += 1) {
    if (encoded[index] !== footer[index]) {
      throw invalidInput('TGA trailing data does not end with a valid TGA 2.0 footer')
    }
  }
  for (const offset of [uint32(encoded, 0), uint32(encoded, 4)]) {
    if (offset !== 0 && (offset < dataEnd || offset >= footerOffset)) {
      throw invalidInput('TGA 2.0 extension or developer-area offset is out of range')
    }
  }
}

const convertTgaPixel = (
  row: Uint8Array,
  sourcePixel: number,
  description: TgaDescription,
  output: Uint8Array,
  target: number,
): void => {
  const source = sourcePixel * description.bytesPerPixel
  const colorMapped =
    description.imageType === uncompressedColorMapped || description.imageType === rleColorMapped
  const grayscale =
    description.imageType === uncompressedGrayscale || description.imageType === rleGrayscale
  if (grayscale) {
    output[target] = row[source] ?? 0
    return
  }
  if (colorMapped) {
    const index = description.bytesPerPixel === 1 ? (row[source] ?? 0) : uint16(row, source)
    const paletteIndex = index - description.paletteOrigin
    if (paletteIndex < 0 || paletteIndex * 4 + 3 >= (description.palette?.byteLength ?? 0)) {
      throw invalidInput(`TGA color-map index ${index} is out of range`)
    }
    const paletteOffset = paletteIndex * 4
    output[target] = description.palette?.[paletteOffset] ?? 0
    output[target + 1] = description.palette?.[paletteOffset + 1] ?? 0
    output[target + 2] = description.palette?.[paletteOffset + 2] ?? 0
    if (description.pixelFormat === 'rgba8') {
      output[target + 3] = description.palette?.[paletteOffset + 3] ?? 255
    }
    return
  }
  if (description.pixelDepth === 15 || description.pixelDepth === 16) {
    const value = uint16(row, source)
    output[target] = fiveBit((value >>> 10) & 31)
    output[target + 1] = fiveBit((value >>> 5) & 31)
    output[target + 2] = fiveBit(value & 31)
    if (description.pixelFormat === 'rgba8') output[target + 3] = (value & 0x8000) === 0 ? 0 : 255
    return
  }
  output[target] = row[source + 2] ?? 0
  output[target + 1] = row[source + 1] ?? 0
  output[target + 2] = row[source] ?? 0
  if (description.pixelFormat === 'rgba8') output[target + 3] = row[source + 3] ?? 0
}

class TgaDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'gray8' | 'rgb8' | 'rgba8'
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #source: ImageSource
  readonly #description: TgaDescription

  constructor(source: ImageSource, description: TgaDescription) {
    this.#source = source
    this.#description = description
    this.width = description.width
    this.height = description.height
    this.pixelFormat = description.pixelFormat
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = regionFor(this.#description, request)
    const channels = this.pixelFormat === 'gray8' ? 1 : this.pixelFormat === 'rgb8' ? 3 : 4
    const rle = this.#description.imageType >= 9
    const rowStates = rle
      ? await rleRowStates(this.#source, this.#description, request.signal)
      : undefined
    const dataEnd =
      rowStates?.dataEnd ??
      this.#description.pixelOffset + this.width * this.height * this.#description.bytesPerPixel
    await validateTrailingData(this.#source, dataEnd, request.signal)
    for (let outputY = region.y; outputY < region.y + region.height; outputY += 1) {
      const storedRow = this.#description.topOrigin ? outputY : this.height - 1 - outputY
      let row: Uint8Array
      if (rle) {
        if (rowStates === undefined) throw new Error('TGA RLE row state is unavailable')
        row = await decodeRleRow(
          this.#source,
          rowStates,
          storedRow,
          this.#description,
          request.signal,
        )
      } else {
        row = await readExactly(
          this.#source,
          this.#description.pixelOffset + storedRow * this.width * this.#description.bytesPerPixel,
          this.width * this.#description.bytesPerPixel,
          request.signal === undefined ? {} : { signal: request.signal },
        )
      }
      const output = new Uint8Array(region.width * channels)
      for (let x = 0; x < region.width; x += 1) {
        const imageX = region.x + x
        const storedX = this.#description.rightOrigin ? this.width - 1 - imageX : imageX
        convertTgaPixel(row, storedX, this.#description, output, x * channels)
      }
      yield {
        x: 0,
        y: outputY - region.y,
        width: region.width,
        height: 1,
        stride: region.width * channels,
        format: this.pixelFormat,
        data: output,
      }
    }
  }
}

interface TgaEncoderOptions {
  readonly alpha: boolean
  readonly rle: boolean
}

const tgaEncoderOptions = (options: unknown, pixelFormat: PixelFormat): TgaEncoderOptions => {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw invalidInput('TGA encoder options must be an object')
  }
  const record = options as Readonly<Record<string, unknown>>
  if (record.alpha !== undefined && typeof record.alpha !== 'boolean') {
    throw invalidInput('TGA alpha must be a boolean')
  }
  if (record.rle !== undefined && typeof record.rle !== 'boolean') {
    throw invalidInput('TGA rle must be a boolean')
  }
  return {
    alpha: record.alpha ?? pixelFormat === 'rgba8',
    rle: record.rle ?? false,
  }
}

const equalPixel = (
  data: Uint8Array,
  left: number,
  right: number,
  bytesPerPixel: number,
): boolean => {
  for (let byte = 0; byte < bytesPerPixel; byte += 1) {
    if (data[left * bytesPerPixel + byte] !== data[right * bytesPerPixel + byte]) return false
  }
  return true
}

const encodeTgaRleRow = (row: Uint8Array, width: number, bytesPerPixel: number): Uint8Array => {
  const output = new Uint8Array(row.byteLength + Math.ceil(width / 128) + 1)
  let offset = 0
  let x = 0
  while (x < width) {
    let run = 1
    while (run < 128 && x + run < width && equalPixel(row, x, x + run, bytesPerPixel)) run += 1
    if (run >= 2) {
      output[offset++] = 0x80 | (run - 1)
      output.set(row.subarray(x * bytesPerPixel, (x + 1) * bytesPerPixel), offset)
      offset += bytesPerPixel
      x += run
      continue
    }
    const start = x
    x += 1
    while (x < width && x - start < 128) {
      run = 1
      while (run < 2 && x + run < width && equalPixel(row, x, x + run, bytesPerPixel)) run += 1
      if (run >= 2) break
      x += 1
    }
    output[offset++] = x - start - 1
    const bytes = row.subarray(start * bytesPerPixel, x * bytesPerPixel)
    output.set(bytes, offset)
    offset += bytes.byteLength
  }
  return output.subarray(0, offset)
}

class TgaEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #alpha: boolean
  readonly #rle: boolean
  readonly #row: Uint8Array
  #y = 0

  private constructor(sink: ImageSink, request: EncodeRequest, options: TgaEncoderOptions) {
    this.#sink = sink
    this.#width = request.width
    this.#height = request.height
    this.#format = request.pixelFormat
    this.#alpha = options.alpha
    this.#rle = options.rle
    this.#row = new Uint8Array(request.width * (options.alpha ? 4 : 3))
  }

  static async create(sink: ImageSink, request: EncodeRequest): Promise<TgaEncoder> {
    if (request.metadata?.exif || request.metadata?.icc) {
      throw unsupportedOperation('TGA output cannot preserve EXIF or ICC metadata')
    }
    if (request.width > 65_535 || request.height > 65_535) {
      throw unsupportedOperation('TGA encoding dimensions must fit unsigned 16-bit fields')
    }
    if (
      request.pixelFormat !== 'gray8' &&
      request.pixelFormat !== 'rgb8' &&
      request.pixelFormat !== 'rgba8'
    ) {
      throw unsupportedOperation(`TGA encoding does not support ${request.pixelFormat} pixels`)
    }
    const options = tgaEncoderOptions(request.options, request.pixelFormat)
    const header = new Uint8Array(headerBytes)
    const view = new DataView(header.buffer)
    header[2] = options.rle ? rleTruecolor : uncompressedTruecolor
    view.setUint16(12, request.width, true)
    view.setUint16(14, request.height, true)
    header[16] = options.alpha ? 32 : 24
    header[17] = 0x20 | (options.alpha ? 8 : 0)
    await sink.write(header)
    return new TgaEncoder(sink, request, options)
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
      throw invalidInput('TGA encoder received a non-sequential or malformed pixel block')
    }
    const targetChannels = this.#alpha ? 4 : 3
    for (let localY = 0; localY < block.height; localY += 1) {
      const sourceRow = localY * block.stride
      for (let x = 0; x < this.#width; x += 1) {
        const source = sourceRow + x * sourceChannels
        const target = x * targetChannels
        const red = block.data[source] ?? 0
        const green = sourceChannels === 1 ? red : (block.data[source + 1] ?? 0)
        const blue = sourceChannels === 1 ? red : (block.data[source + 2] ?? 0)
        this.#row[target] = blue
        this.#row[target + 1] = green
        this.#row[target + 2] = red
        if (this.#alpha) {
          this.#row[target + 3] = sourceChannels === 4 ? (block.data[source + 3] ?? 0) : 255
        }
      }
      await this.#sink.write(
        this.#rle ? encodeTgaRleRow(this.#row, this.#width, targetChannels) : this.#row,
      )
      this.#y += 1
    }
  }

  async finish(): Promise<void> {
    if (this.#y !== this.#height) {
      throw truncatedInput(`TGA encoder received ${this.#y} of ${this.#height} rows`)
    }
    await this.#sink.write(footer)
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
  createDecoder: async (source, limits) =>
    new TgaDecoder(source, await describeTga(source, limits)),
  createEncoder: async (sink, request) => TgaEncoder.create(sink, request),
}
