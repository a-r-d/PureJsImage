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

const headerBytes = 14
const blockRows = 32
const endMarker = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1])
const qoiOpRgb = 0xfe
const qoiOpRgba = 0xff
const qoiMask2 = 0xc0
const qoiOpIndex = 0x00
const qoiOpDiff = 0x40
const qoiOpLuma = 0x80
const qoiOpRun = 0xc0

interface QoiDescription {
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
  readonly colorspace: 0 | 1
}

const isQoi = (header: Uint8Array): boolean =>
  header[0] === 0x71 && header[1] === 0x6f && header[2] === 0x69 && header[3] === 0x66

const uint32 = (data: Uint8Array, offset: number): number =>
  ((data[offset] ?? 0) * 16_777_216 +
    (data[offset + 1] ?? 0) * 65_536 +
    (data[offset + 2] ?? 0) * 256 +
    (data[offset + 3] ?? 0)) >>>
  0

const describeQoi = async (source: ImageSource, limits: ImageLimits): Promise<QoiDescription> => {
  if (source.size < headerBytes + endMarker.byteLength)
    throw truncatedInput('QOI header is truncated')
  const header = await readExactly(source, 0, headerBytes)
  if (!isQoi(header)) throw invalidInput('QOI signature is invalid')
  const width = uint32(header, 4)
  const height = uint32(header, 8)
  const channels = header[12]
  const colorspace = header[13]
  if (channels !== 3 && channels !== 4) throw invalidInput('QOI channels field must be 3 or 4')
  if (colorspace !== 0 && colorspace !== 1)
    throw invalidInput('QOI colorspace field must be 0 or 1')
  validateImageDimensions(width, height, 1, limits, channels)
  return { width, height, channels, colorspace }
}

const hash = (red: number, green: number, blue: number, alpha: number): number =>
  (red * 3 + green * 5 + blue * 7 + alpha * 11) & 63

class QoiDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'rgb8' | 'rgba8'
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: false,
    scaledDecode: false,
    progressive: false,
  })
  readonly #source: ImageSource
  readonly #description: QoiDescription

  constructor(source: ImageSource, description: QoiDescription) {
    this.#source = source
    this.#description = description
    this.width = description.width
    this.height = description.height
    this.pixelFormat = description.channels === 4 ? 'rgba8' : 'rgb8'
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    if (
      (request.x !== undefined && request.x !== 0) ||
      (request.y !== undefined && request.y !== 0) ||
      (request.width !== undefined && request.width !== this.width) ||
      (request.height !== undefined && request.height !== this.height) ||
      request.scaleDenominator !== undefined
    ) {
      throw unsupportedOperation('QOI region and scaled decode are unsupported')
    }
    const cursor = new SourceCursor(
      this.#source,
      headerBytes,
      request.signal === undefined ? {} : { signal: request.signal },
    )
    const index = new Uint32Array(64)
    let red = 0
    let green = 0
    let blue = 0
    let alpha = 255
    let run = 0
    const channels = this.#description.channels
    const pixels = this.width * this.height
    let decoded = 0
    while (decoded < pixels) {
      const firstRow = Math.floor(decoded / this.width)
      const rows = Math.min(blockRows, this.height - firstRow)
      const output = new Uint8Array(this.width * rows * channels)
      const blockPixels = Math.min(output.byteLength / channels, pixels - decoded)
      for (let localPixel = 0; localPixel < blockPixels; localPixel += 1) {
        if (run > 0) {
          run -= 1
        } else {
          const tag = await cursor.byte('QOI chunk stream is truncated')
          if (tag === qoiOpRgb) {
            red = await cursor.byte('QOI RGB chunk is truncated')
            green = await cursor.byte('QOI RGB chunk is truncated')
            blue = await cursor.byte('QOI RGB chunk is truncated')
          } else if (tag === qoiOpRgba) {
            red = await cursor.byte('QOI RGBA chunk is truncated')
            green = await cursor.byte('QOI RGBA chunk is truncated')
            blue = await cursor.byte('QOI RGBA chunk is truncated')
            alpha = await cursor.byte('QOI RGBA chunk is truncated')
          } else {
            const operation = tag & qoiMask2
            if (operation === qoiOpIndex) {
              const packed = index[tag & 63] ?? 0
              red = packed >>> 24
              green = (packed >>> 16) & 0xff
              blue = (packed >>> 8) & 0xff
              alpha = packed & 0xff
            } else if (operation === qoiOpDiff) {
              red = (red + ((tag >>> 4) & 3) - 2) & 0xff
              green = (green + ((tag >>> 2) & 3) - 2) & 0xff
              blue = (blue + (tag & 3) - 2) & 0xff
            } else if (operation === qoiOpLuma) {
              const second = await cursor.byte('QOI LUMA chunk is truncated')
              const differenceGreen = (tag & 63) - 32
              red = (red + differenceGreen + (second >>> 4) - 8) & 0xff
              green = (green + differenceGreen) & 0xff
              blue = (blue + differenceGreen + (second & 15) - 8) & 0xff
            } else {
              run = tag & 63
              if (run > 61) throw invalidInput('QOI run length 63 or 64 is illegal')
              if (decoded + localPixel + run >= pixels) {
                throw invalidInput('QOI run exceeds the declared pixel count')
              }
            }
          }
        }
        index[hash(red, green, blue, alpha)] =
          ((red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0
        const target = localPixel * channels
        output[target] = red
        output[target + 1] = green
        output[target + 2] = blue
        if (channels === 4) output[target + 3] = alpha
      }
      decoded += blockPixels
      yield {
        x: 0,
        y: firstRow,
        width: this.width,
        height: rows,
        stride: this.width * channels,
        format: this.pixelFormat,
        data: output,
      }
    }
    if (run !== 0) throw invalidInput('QOI decoded pixel count ends inside a run')
    for (const expected of endMarker) {
      if ((await cursor.byte('QOI end marker is truncated')) !== expected) {
        throw invalidInput('QOI end marker is invalid')
      }
    }
    if (cursor.remaining !== 0) throw invalidInput('QOI contains data after the end marker')
  }
}

interface QoiEncoderOptions {
  readonly channels: 3 | 4
  readonly colorspace: 0 | 1
}

const encoderOptions = (options: unknown, pixelFormat: PixelFormat): QoiEncoderOptions => {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw invalidInput('QOI encoder options must be an object')
  }
  const record = options as Readonly<Record<string, unknown>>
  const channelOption = record.channels
  if (channelOption !== undefined && channelOption !== 3 && channelOption !== 4) {
    throw invalidInput('QOI channels must be 3 or 4')
  }
  const colorspaceOption = record.colorspace
  if (
    colorspaceOption !== undefined &&
    colorspaceOption !== 'srgb' &&
    colorspaceOption !== 'linear'
  ) {
    throw invalidInput('QOI colorspace must be srgb or linear')
  }
  return {
    channels: channelOption ?? (pixelFormat === 'rgba8' ? 4 : 3),
    colorspace: colorspaceOption === 'linear' ? 1 : 0,
  }
}

class QoiEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #channels: 3 | 4
  readonly #index = new Uint32Array(64)
  #red = 0
  #green = 0
  #blue = 0
  #alpha = 255
  #run = 0
  #y = 0

  private constructor(sink: ImageSink, request: EncodeRequest, options: QoiEncoderOptions) {
    this.#sink = sink
    this.#width = request.width
    this.#height = request.height
    this.#format = request.pixelFormat
    this.#channels = options.channels
  }

  static async create(sink: ImageSink, request: EncodeRequest): Promise<QoiEncoder> {
    if (request.metadata?.exif || request.metadata?.icc) {
      throw unsupportedOperation('QOI output cannot preserve EXIF or ICC metadata')
    }
    if (
      request.pixelFormat !== 'gray8' &&
      request.pixelFormat !== 'rgb8' &&
      request.pixelFormat !== 'rgba8'
    ) {
      throw unsupportedOperation(`QOI encoding does not support ${request.pixelFormat} pixels`)
    }
    const options = encoderOptions(request.options, request.pixelFormat)
    const header = new Uint8Array(headerBytes)
    const view = new DataView(header.buffer)
    header.set([0x71, 0x6f, 0x69, 0x66])
    view.setUint32(4, request.width, false)
    view.setUint32(8, request.height, false)
    header[12] = options.channels
    header[13] = options.colorspace
    await sink.write(header)
    return new QoiEncoder(sink, request, options)
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
      throw invalidInput('QOI encoder received a non-sequential or malformed pixel block')
    }

    for (let localY = 0; localY < block.height; localY += 1) {
      const output = new Uint8Array(this.#width * 5 + 2)
      let outputOffset = 0
      const sourceRow = localY * block.stride
      for (let x = 0; x < this.#width; x += 1) {
        const source = sourceRow + x * sourceChannels
        const red = block.data[source] ?? 0
        const green = sourceChannels === 1 ? red : (block.data[source + 1] ?? 0)
        const blue = sourceChannels === 1 ? red : (block.data[source + 2] ?? 0)
        const alpha =
          this.#channels === 3 ? 255 : sourceChannels === 4 ? (block.data[source + 3] ?? 0) : 255
        const lastPixel = this.#y + localY === this.#height - 1 && x === this.#width - 1
        if (
          red === this.#red &&
          green === this.#green &&
          blue === this.#blue &&
          alpha === this.#alpha
        ) {
          this.#run += 1
          if (this.#run === 62 || lastPixel) {
            output[outputOffset++] = qoiOpRun | (this.#run - 1)
            this.#run = 0
          }
          continue
        }
        if (this.#run > 0) {
          output[outputOffset++] = qoiOpRun | (this.#run - 1)
          this.#run = 0
        }
        const packed = ((red << 24) | (green << 16) | (blue << 8) | alpha) >>> 0
        const indexPosition = hash(red, green, blue, alpha)
        if (this.#index[indexPosition] === packed) {
          output[outputOffset++] = qoiOpIndex | indexPosition
        } else {
          this.#index[indexPosition] = packed
          if (alpha !== this.#alpha) {
            output[outputOffset++] = qoiOpRgba
            output[outputOffset++] = red
            output[outputOffset++] = green
            output[outputOffset++] = blue
            output[outputOffset++] = alpha
          } else {
            const differenceRed = ((red - this.#red + 128) & 0xff) - 128
            const differenceGreen = ((green - this.#green + 128) & 0xff) - 128
            const differenceBlue = ((blue - this.#blue + 128) & 0xff) - 128
            if (
              differenceRed >= -2 &&
              differenceRed <= 1 &&
              differenceGreen >= -2 &&
              differenceGreen <= 1 &&
              differenceBlue >= -2 &&
              differenceBlue <= 1
            ) {
              output[outputOffset++] =
                qoiOpDiff |
                ((differenceRed + 2) << 4) |
                ((differenceGreen + 2) << 2) |
                (differenceBlue + 2)
            } else {
              const redGreen = differenceRed - differenceGreen
              const blueGreen = differenceBlue - differenceGreen
              if (
                differenceGreen >= -32 &&
                differenceGreen <= 31 &&
                redGreen >= -8 &&
                redGreen <= 7 &&
                blueGreen >= -8 &&
                blueGreen <= 7
              ) {
                output[outputOffset++] = qoiOpLuma | (differenceGreen + 32)
                output[outputOffset++] = ((redGreen + 8) << 4) | (blueGreen + 8)
              } else {
                output[outputOffset++] = qoiOpRgb
                output[outputOffset++] = red
                output[outputOffset++] = green
                output[outputOffset++] = blue
              }
            }
          }
        }
        this.#red = red
        this.#green = green
        this.#blue = blue
        this.#alpha = alpha
      }
      if (outputOffset > 0) await this.#sink.write(output.subarray(0, outputOffset))
    }
    this.#y += block.height
  }

  async finish(): Promise<void> {
    if (this.#y !== this.#height) {
      throw truncatedInput(`QOI encoder received ${this.#y} of ${this.#height} rows`)
    }
    if (this.#run !== 0) throw invalidInput('QOI encoder ended with an unflushed run')
    await this.#sink.write(endMarker)
  }
}

const metadata = (description: QoiDescription): ImageMetadata => ({
  width: description.width,
  height: description.height,
  format: 'qoi',
  mimeType: 'image/qoi',
  hasAlpha: description.channels === 4,
  bitDepth: 8,
  components: description.channels,
  channels: description.channels,
  frames: 1,
  colorSpace: description.colorspace === 0 ? 'srgb-linear-alpha' : 'linear',
  codecProfile: description.colorspace,
  lossless: true,
})

export const qoiCodec: ImageCodec = {
  format: 'qoi',
  mimeTypes: ['image/qoi'],
  minimumBytes: 4,
  encoderPixelFormats: ['gray8', 'rgb8', 'rgba8'],
  detect: isQoi,
  metadata: async (source, limits) => metadata(await describeQoi(source, limits)),
  createDecoder: async (source, limits) =>
    new QoiDecoder(source, await describeQoi(source, limits)),
  createEncoder: async (sink, request) => QoiEncoder.create(sink, request),
}
