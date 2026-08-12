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
import { SourceCursor } from './source-cursor.ts'

const maximumHeaderBytes = 65_536
const maximumRleLength = 0x7fff
const minimumRleLength = 8
const textEncoder = new TextEncoder()

type Axis = 'X' | 'Y'
type Direction = '+' | '-'

interface HdrDescription {
  readonly width: number
  readonly height: number
  readonly dataOffset: number
  readonly majorAxis: Axis
  readonly xDirection: Direction
  readonly yDirection: Direction
  readonly exposure: number | undefined
  readonly gamma: number | undefined
  readonly orientation: string
}

interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const isHdr = (header: Uint8Array): boolean => {
  if (header.byteLength < 6 || header[0] !== 0x23 || header[1] !== 0x3f) return false
  const signature = String.fromCharCode(...header.subarray(2, Math.min(header.byteLength, 10)))
  return signature.startsWith('RADIANCE') || signature.startsWith('RGBE')
}

const headerEnd = (data: Uint8Array): number => {
  for (let offset = 0; offset + 1 < data.byteLength; offset += 1) {
    if (data[offset] === 0x0a && data[offset + 1] === 0x0a) return offset + 2
    if (
      offset + 3 < data.byteLength &&
      data[offset] === 0x0d &&
      data[offset + 1] === 0x0a &&
      data[offset + 2] === 0x0d &&
      data[offset + 3] === 0x0a
    ) {
      return offset + 4
    }
  }
  return -1
}

const lineEnd = (data: Uint8Array, offset: number): number => {
  for (let index = offset; index < data.byteLength; index += 1) {
    if (data[index] === 0x0a) return index
  }
  return -1
}

const ascii = (data: Uint8Array, start: number, end: number): string => {
  let value = ''
  for (let offset = start; offset < end; offset += 1) {
    const byte = data[offset]
    if (byte === undefined) throw truncatedInput('Radiance HDR text is truncated')
    if (byte !== 0x0d) value += String.fromCharCode(byte)
  }
  return value
}

const finitePositiveMetadata = (label: string, value: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw invalidInput(`Radiance HDR ${label} must be finite and greater than zero`)
  }
  return parsed
}

const describeHdr = async (source: ImageSource, limits: ImageLimits): Promise<HdrDescription> => {
  const prefix = await source.read(0, Math.min(source.size, maximumHeaderBytes))
  if (!isHdr(prefix)) throw invalidInput('Radiance HDR signature is invalid')
  const emptyLineEnd = headerEnd(prefix)
  if (emptyLineEnd < 0) {
    if (source.size > maximumHeaderBytes) {
      throw invalidInput(`Radiance HDR header exceeds ${maximumHeaderBytes} bytes`)
    }
    throw truncatedInput('Radiance HDR header terminator is missing')
  }
  const resolutionEnd = lineEnd(prefix, emptyLineEnd)
  if (resolutionEnd < 0) throw truncatedInput('Radiance HDR resolution line is truncated')
  const header = ascii(prefix, 0, emptyLineEnd)
  const lines = header.split(/\r?\n/)
  const signature = lines[0]
  if (signature !== '#?RADIANCE' && signature !== '#?RGBE') {
    throw invalidInput('Radiance HDR signature line is invalid')
  }
  let formatSeen = false
  let exposure: number | undefined
  let gamma: number | undefined
  for (const line of lines.slice(1)) {
    if (line.length === 0) continue
    if (line.startsWith('FORMAT=')) {
      if (formatSeen) throw invalidInput('Radiance HDR contains multiple FORMAT fields')
      if (line !== 'FORMAT=32-bit_rle_rgbe') {
        throw unsupportedOperation(`Radiance HDR format ${line.slice(7)} is unsupported`)
      }
      formatSeen = true
    } else if (line.startsWith('EXPOSURE=')) {
      const value = finitePositiveMetadata('EXPOSURE', line.slice(9))
      exposure = (exposure ?? 1) * value
    } else if (line.startsWith('GAMMA=')) {
      gamma = finitePositiveMetadata('GAMMA', line.slice(6))
    }
  }
  if (!formatSeen) throw invalidInput('Radiance HDR FORMAT field is missing')

  const orientation = ascii(prefix, emptyLineEnd, resolutionEnd).trim()
  const match = /^([+-])([XY])\s+([1-9]\d*)\s+([+-])([XY])\s+([1-9]\d*)$/.exec(orientation)
  if (!match || match[2] === match[5]) {
    throw invalidInput('Radiance HDR resolution or orientation line is invalid')
  }
  const firstSize = Number(match[3])
  const secondSize = Number(match[6])
  if (!Number.isSafeInteger(firstSize) || !Number.isSafeInteger(secondSize)) {
    throw invalidInput('Radiance HDR dimensions exceed safe integer range')
  }
  const firstAxis = match[2] as Axis
  const width = firstAxis === 'X' ? firstSize : secondSize
  const height = firstAxis === 'Y' ? firstSize : secondSize
  validateImageDimensions(width, height, 1, limits, 12)
  return {
    width,
    height,
    dataOffset: resolutionEnd + 1,
    majorAxis: firstAxis,
    xDirection: (firstAxis === 'X' ? match[1] : match[4]) as Direction,
    yDirection: (firstAxis === 'Y' ? match[1] : match[4]) as Direction,
    exposure,
    gamma,
    orientation,
  }
}

const regionFor = (description: HdrDescription, request: DecodeRequest): Region => {
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
    throw invalidInput('Radiance HDR decode region is invalid')
  }
  return { x, y, width, height }
}

const readLegacyScanline = async (
  cursor: SourceCursor,
  length: number,
  first: readonly [number, number, number, number],
  output: Uint8Array | undefined,
): Promise<void> => {
  let written = 0
  let shift = 0
  let previousRed = 0
  let previousGreen = 0
  let previousBlue = 0
  let previousExponent = 0
  let current: readonly [number, number, number, number] = first
  while (written < length) {
    const [red, green, blue, exponent] = current
    if (red === 1 && green === 1 && blue === 1) {
      if (written === 0) throw invalidInput('Radiance HDR legacy scanline starts with a repeat')
      const count = exponent * 2 ** shift
      if (!Number.isSafeInteger(count) || count < 1 || written + count > length) {
        throw invalidInput('Radiance HDR legacy repeat exceeds its scanline')
      }
      if (output) {
        for (let index = 0; index < count; index += 1) {
          const target = (written + index) * 4
          output[target] = previousRed
          output[target + 1] = previousGreen
          output[target + 2] = previousBlue
          output[target + 3] = previousExponent
        }
      }
      written += count
      shift += 8
    } else {
      if (output) output.set(current, written * 4)
      previousRed = red
      previousGreen = green
      previousBlue = blue
      previousExponent = exponent
      written += 1
      shift = 0
    }
    if (written < length) {
      current = [
        await cursor.byte('Radiance HDR legacy red sample is truncated'),
        await cursor.byte('Radiance HDR legacy green sample is truncated'),
        await cursor.byte('Radiance HDR legacy blue sample is truncated'),
        await cursor.byte('Radiance HDR legacy exponent is truncated'),
      ]
    }
  }
}

const readScanline = async (
  cursor: SourceCursor,
  length: number,
  output: Uint8Array | undefined,
): Promise<void> => {
  const first = await cursor.byte('Radiance HDR scanline is truncated')
  const second = await cursor.byte('Radiance HDR scanline is truncated')
  const third = await cursor.byte('Radiance HDR scanline is truncated')
  const fourth = await cursor.byte('Radiance HDR scanline is truncated')
  if (
    length < minimumRleLength ||
    length > maximumRleLength ||
    first !== 2 ||
    second !== 2 ||
    (third & 0x80) !== 0
  ) {
    await readLegacyScanline(cursor, length, [first, second, third, fourth], output)
    return
  }
  if ((third << 8) + fourth !== length) {
    throw invalidInput('Radiance HDR scanline length does not match the resolution')
  }
  for (let component = 0; component < 4; component += 1) {
    let written = 0
    while (written < length) {
      const code = await cursor.byte('Radiance HDR RLE packet is truncated')
      if (code === 0) throw invalidInput('Radiance HDR RLE packet is empty')
      const count = code > 128 ? code - 128 : code
      if (written + count > length) throw invalidInput('Radiance HDR RLE packet exceeds scanline')
      if (code > 128) {
        const value = await cursor.byte('Radiance HDR RLE run value is truncated')
        if (output) {
          for (let index = 0; index < count; index += 1) {
            output[(written + index) * 4 + component] = value
          }
        }
      } else if (output) {
        for (let index = 0; index < count; index += 1) {
          output[(written + index) * 4 + component] = await cursor.byte(
            'Radiance HDR RLE literal is truncated',
          )
        }
      } else {
        await cursor.skip(count, 'Radiance HDR RLE literal is truncated')
      }
      written += count
    }
  }
}

const scanlineOffsets = async (
  source: ImageSource,
  description: HdrDescription,
  signal: AbortSignal | undefined,
): Promise<Float64Array> => {
  const length = description.majorAxis === 'Y' ? description.width : description.height
  const count = description.majorAxis === 'Y' ? description.height : description.width
  const offsets = new Float64Array(count)
  const cursor = new SourceCursor(
    source,
    description.dataOffset,
    signal === undefined ? {} : { signal },
  )
  for (let index = 0; index < count; index += 1) {
    offsets[index] = cursor.offset
    await readScanline(cursor, length, undefined)
  }
  return offsets
}

const rgbeRowToFloat = (
  rgbe: Uint8Array,
  sourceStart: number,
  reverse: boolean,
  width: number,
): Uint8Array => {
  const output = new Uint8Array(width * 12)
  const view = new DataView(output.buffer)
  for (let x = 0; x < width; x += 1) {
    const source = (reverse ? sourceStart - x : sourceStart + x) * 4
    const exponent = rgbe[source + 3] ?? 0
    const scale = exponent === 0 ? 0 : 2 ** (exponent - 136)
    const target = x * 12
    view.setFloat32(target, exponent === 0 ? 0 : ((rgbe[source] ?? 0) + 0.5) * scale, false)
    view.setFloat32(target + 4, exponent === 0 ? 0 : ((rgbe[source + 1] ?? 0) + 0.5) * scale, false)
    view.setFloat32(target + 8, exponent === 0 ? 0 : ((rgbe[source + 2] ?? 0) + 0.5) * scale, false)
  }
  return output
}

class HdrDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgbf32' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #source: ImageSource
  readonly #description: HdrDescription

  constructor(source: ImageSource, description: HdrDescription) {
    this.#source = source
    this.#description = description
    this.width = description.width
    this.height = description.height
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = regionFor(this.#description, request)
    const signal = request.signal
    const scanLength = this.#description.majorAxis === 'Y' ? this.width : this.height
    const offsets = await scanlineOffsets(this.#source, this.#description, signal)

    if (this.#description.majorAxis === 'Y') {
      for (let outputY = region.y; outputY < region.y + region.height; outputY += 1) {
        const trueY = this.height - 1 - outputY
        const storedRow = this.#description.yDirection === '+' ? trueY : this.height - 1 - trueY
        const row = new Uint8Array(scanLength * 4)
        const cursor = new SourceCursor(
          this.#source,
          offsets[storedRow] ?? this.#description.dataOffset,
          signal === undefined ? {} : { signal },
        )
        await readScanline(cursor, scanLength, row)
        const reverse = this.#description.xDirection === '-'
        const data = rgbeRowToFloat(
          row,
          reverse ? this.width - 1 - region.x : region.x,
          reverse,
          region.width,
        )
        yield {
          x: 0,
          y: outputY - region.y,
          width: region.width,
          height: 1,
          stride: region.width * 12,
          format: 'rgbf32',
          data,
        }
      }
      return
    }

    const compact = new Uint8Array(this.width * this.height * 4)
    for (let storedColumn = 0; storedColumn < this.width; storedColumn += 1) {
      const column = new Uint8Array(scanLength * 4)
      const cursor = new SourceCursor(
        this.#source,
        offsets[storedColumn] ?? this.#description.dataOffset,
        signal === undefined ? {} : { signal },
      )
      await readScanline(cursor, scanLength, column)
      const x = this.#description.xDirection === '+' ? storedColumn : this.width - 1 - storedColumn
      for (let storedY = 0; storedY < this.height; storedY += 1) {
        const trueY = this.#description.yDirection === '+' ? storedY : this.height - 1 - storedY
        const outputY = this.height - 1 - trueY
        compact.set(column.subarray(storedY * 4, storedY * 4 + 4), (outputY * this.width + x) * 4)
      }
    }
    for (let y = region.y; y < region.y + region.height; y += 1) {
      const row = compact.subarray(y * this.width * 4, (y + 1) * this.width * 4)
      const data = rgbeRowToFloat(row, region.x, false, region.width)
      yield {
        x: 0,
        y: y - region.y,
        width: region.width,
        height: 1,
        stride: region.width * 12,
        format: 'rgbf32',
        data,
      }
    }
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const hdrOptions = (options: unknown): { readonly exposure?: number; readonly gamma?: number } => {
  if (!isRecord(options)) throw invalidInput('Radiance HDR encoder options must be an object')
  const result: { exposure?: number; gamma?: number } = {}
  for (const key of ['exposure', 'gamma'] as const) {
    const value = options[key]
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    ) {
      throw invalidInput(`Radiance HDR ${key} must be finite and greater than zero`)
    }
    if (typeof value === 'number') result[key] = value
  }
  return result
}

const floatToRgbe = (
  red: number,
  green: number,
  blue: number,
  target: Uint8Array,
  offset: number,
): void => {
  if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) {
    throw unsupportedOperation('Radiance HDR encoding does not support non-finite samples')
  }
  if (red < 0 || green < 0 || blue < 0) {
    throw unsupportedOperation('Radiance HDR encoding does not support negative samples')
  }
  const maximum = Math.max(red, green, blue)
  if (maximum <= 1e-32) {
    target.fill(0, offset, offset + 4)
    return
  }
  const exponent = Math.floor(Math.log2(maximum)) + 1
  const storedExponent = exponent + 128
  if (storedExponent < 1 || storedExponent > 255) {
    throw unsupportedOperation('Radiance HDR sample exponent is outside RGBE range')
  }
  const scale = 256 / 2 ** exponent
  target[offset] = Math.min(255, Math.floor(red * scale))
  target[offset + 1] = Math.min(255, Math.floor(green * scale))
  target[offset + 2] = Math.min(255, Math.floor(blue * scale))
  target[offset + 3] = storedExponent
}

const encodeRleRow = (row: Uint8Array, width: number): Uint8Array => {
  if (width < minimumRleLength || width > maximumRleLength) return row.slice()
  const maximumBytes = 4 + 4 * (width + Math.ceil(width / 128))
  const output = new Uint8Array(maximumBytes)
  let offset = 0
  output[offset++] = 2
  output[offset++] = 2
  output[offset++] = width >>> 8
  output[offset++] = width & 0xff
  for (let component = 0; component < 4; component += 1) {
    let x = 0
    while (x < width) {
      let run = 1
      while (
        run < 127 &&
        x + run < width &&
        row[(x + run) * 4 + component] === row[x * 4 + component]
      ) {
        run += 1
      }
      if (run >= 4) {
        output[offset++] = 128 + run
        output[offset++] = row[x * 4 + component] ?? 0
        x += run
        continue
      }
      const literalStart = x
      x += run
      while (x < width && x - literalStart < 128) {
        run = 1
        while (
          run < 4 &&
          x + run < width &&
          row[(x + run) * 4 + component] === row[x * 4 + component]
        ) {
          run += 1
        }
        if (run >= 4) break
        x += run
      }
      const literalLength = x - literalStart
      output[offset++] = literalLength
      for (let index = literalStart; index < x; index += 1) {
        output[offset++] = row[index * 4 + component] ?? 0
      }
    }
  }
  return output.subarray(0, offset)
}

class HdrEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #row: Uint8Array
  #y = 0

  private constructor(sink: ImageSink, request: EncodeRequest) {
    this.#sink = sink
    this.#width = request.width
    this.#height = request.height
    this.#format = request.pixelFormat
    this.#row = new Uint8Array(request.width * 4)
  }

  static async create(sink: ImageSink, request: EncodeRequest): Promise<HdrEncoder> {
    if (request.metadata?.exif || request.metadata?.icc) {
      throw unsupportedOperation('Radiance HDR output cannot preserve EXIF or ICC metadata')
    }
    if (!['rgb8', 'rgba8', 'rgbf32'].includes(request.pixelFormat)) {
      throw unsupportedOperation(
        `Radiance HDR encoding does not support ${request.pixelFormat} pixels`,
      )
    }
    const options = hdrOptions(request.options)
    const lines = [
      '#?RADIANCE',
      'FORMAT=32-bit_rle_rgbe',
      ...(options.exposure === undefined ? [] : [`EXPOSURE=${options.exposure}`]),
      ...(options.gamma === undefined ? [] : [`GAMMA=${options.gamma}`]),
      '',
      `-Y ${request.height} +X ${request.width}`,
      '',
    ]
    await sink.write(textEncoder.encode(lines.join('\n')))
    return new HdrEncoder(sink, request)
  }

  async write(block: PixelBlock): Promise<void> {
    const sourceChannels = this.#format === 'rgba8' ? 4 : 3
    const sourceBytes = this.#format === 'rgbf32' ? 12 : sourceChannels
    if (
      block.x !== 0 ||
      block.y !== this.#y ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.format !== this.#format ||
      block.stride < this.#width * sourceBytes ||
      block.data.byteLength < block.stride * block.height ||
      this.#y + block.height > this.#height
    ) {
      throw invalidInput('Radiance HDR encoder received a non-sequential or malformed pixel block')
    }
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let localY = 0; localY < block.height; localY += 1) {
      const sourceRow = localY * block.stride
      for (let x = 0; x < this.#width; x += 1) {
        const source = sourceRow + x * sourceBytes
        const red =
          this.#format === 'rgbf32'
            ? view.getFloat32(source, false)
            : (block.data[source] ?? 0) / 255
        const green =
          this.#format === 'rgbf32'
            ? view.getFloat32(source + 4, false)
            : (block.data[source + 1] ?? 0) / 255
        const blue =
          this.#format === 'rgbf32'
            ? view.getFloat32(source + 8, false)
            : (block.data[source + 2] ?? 0) / 255
        floatToRgbe(red, green, blue, this.#row, x * 4)
      }
      await this.#sink.write(encodeRleRow(this.#row, this.#width))
      this.#y += 1
    }
  }

  async finish(): Promise<void> {
    if (this.#y !== this.#height) {
      throw truncatedInput(`Radiance HDR encoder received ${this.#y} of ${this.#height} rows`)
    }
  }
}

const metadata = (description: HdrDescription): ImageMetadata => ({
  width: description.width,
  height: description.height,
  format: 'hdr',
  mimeType: 'image/vnd.radiance',
  hasAlpha: false,
  bitDepth: 32,
  sampleFormat: 'floating-point',
  components: 3,
  channels: 3,
  frames: 1,
  colorSpace: 'linear-rgb',
  lossless: false,
  ...(description.exposure === undefined ? {} : { exposure: description.exposure }),
  ...(description.gamma === undefined ? {} : { gamma: description.gamma }),
  storageOrientation: description.orientation,
})

export const hdrCodec: ImageCodec = {
  format: 'hdr',
  mimeTypes: ['image/vnd.radiance', 'image/x-hdr'],
  minimumBytes: 6,
  encoderPixelFormats: ['rgb8', 'rgba8', 'rgbf32'],
  detect: isHdr,
  metadata: async (source, limits) => metadata(await describeHdr(source, limits)),
  createDecoder: async (source, limits) =>
    new HdrDecoder(source, await describeHdr(source, limits)),
  createEncoder: async (sink, request) => HdrEncoder.create(sink, request),
}
