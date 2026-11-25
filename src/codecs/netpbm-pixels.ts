import type { DecodeRequest, EncodeRequest, ImageDecoder, ImageEncoder } from '../codec.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { type ImageSource, readExactly } from '../source.ts'
import {
  type NetpbmKind,
  type NetpbmDescription,
  NetpbmTokenReader,
  describeNetpbm,
  bytesPerSample,
} from './netpbm.ts'

const textEncoder = new TextEncoder()

interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const regionFor = (description: NetpbmDescription, request: DecodeRequest): Region => {
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
    throw invalidInput('Netpbm decode region is invalid')
  }
  return { x, y, width, height }
}

const scaledSample = (sample: number, maximum: number, high: boolean): number => {
  if (sample < 0 || sample > maximum)
    throw invalidInput(`Netpbm sample ${sample} exceeds MAXVAL ${maximum}`)
  return Math.round((sample * (high ? 65_535 : 255)) / maximum)
}

const writeSample = (output: Uint8Array, offset: number, sample: number, high: boolean): void => {
  if (high) {
    output[offset] = sample >>> 8
    output[offset + 1] = sample & 0xff
  } else {
    output[offset] = sample
  }
}

const convertIntegerRow = (
  samples: Uint16Array,
  description: NetpbmDescription,
  region: Region,
): Uint8Array => {
  const maximum = description.maxValue ?? 1
  const high = maximum > 255
  const bytes = high ? 2 : 1
  const output = new Uint8Array(region.width * description.outputChannels * bytes)
  for (let x = 0; x < region.width; x += 1) {
    const source = (region.x + x) * description.sourceChannels
    const target = x * description.outputChannels * bytes
    if (
      description.tupleType === 'GRAYSCALE_ALPHA' ||
      description.tupleType === 'BLACKANDWHITE_ALPHA'
    ) {
      const gray = scaledSample(samples[source] ?? 0, maximum, high)
      const alpha = scaledSample(samples[source + 1] ?? 0, maximum, high)
      writeSample(output, target, gray, high)
      writeSample(output, target + bytes, gray, high)
      writeSample(output, target + bytes * 2, gray, high)
      writeSample(output, target + bytes * 3, alpha, high)
      continue
    }
    for (let channel = 0; channel < description.outputChannels; channel += 1) {
      let sample = samples[source + channel] ?? 0
      if (description.kind === 'pbm') sample = sample === 0 ? 1 : 0
      writeSample(output, target + channel * bytes, scaledSample(sample, maximum, high), high)
    }
  }
  return output
}

class NetpbmDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly capabilities
  readonly #source: ImageSource
  readonly #description: NetpbmDescription

  constructor(source: ImageSource, description: NetpbmDescription) {
    this.#source = source
    this.#description = description
    this.width = description.width
    this.height = description.height
    this.pixelFormat = description.pixelFormat
    this.capabilities = Object.freeze({
      sequential: true,
      regionDecode: !description.ascii,
      scaledDecode: false,
      progressive: false,
    })
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = regionFor(this.#description, request)
    if (this.#description.kind === 'pfm') {
      const channels = this.#description.sourceChannels
      const rowBytes = this.width * channels * 4
      for (let y = region.y; y < region.y + region.height; y += 1) {
        const storedY = this.height - 1 - y
        const row = await readExactly(
          this.#source,
          this.#description.dataOffset + storedY * rowBytes,
          rowBytes,
          request.signal === undefined ? {} : { signal: request.signal },
        )
        const sourceView = new DataView(row.buffer, row.byteOffset, row.byteLength)
        const output = new Uint8Array(region.width * channels * 4)
        const outputView = new DataView(output.buffer)
        for (let x = 0; x < region.width; x += 1) {
          for (let channel = 0; channel < channels; channel += 1) {
            const source = ((region.x + x) * channels + channel) * 4
            const target = (x * channels + channel) * 4
            outputView.setFloat32(
              target,
              sourceView.getFloat32(source, this.#description.littleEndian) *
                (this.#description.scale ?? 1),
              false,
            )
          }
        }
        yield {
          x: 0,
          y: y - region.y,
          width: region.width,
          height: 1,
          stride: region.width * channels * 4,
          format: this.pixelFormat,
          data: output,
        }
      }
      return
    }

    const high = (this.#description.maxValue ?? 1) > 255
    const sampleBytes = high ? 2 : 1
    const samples = new Uint16Array(this.width * this.#description.sourceChannels)
    const tokenReader = this.#description.ascii
      ? new NetpbmTokenReader(this.#source, this.#description.dataOffset, request.signal)
      : undefined
    const pbmBinary = this.#description.magic === 'P4'
    const binaryRowBytes = pbmBinary
      ? Math.ceil(this.width / 8)
      : this.width * this.#description.sourceChannels * sampleBytes
    for (let y = 0; y < this.height; y += 1) {
      if (tokenReader) {
        for (let sample = 0; sample < samples.length; sample += 1) {
          const value = await tokenReader.token('Netpbm ASCII sample')
          if (!/^\d+$/.test(value))
            throw invalidInput('Netpbm ASCII sample is not an unsigned integer')
          const parsed = Number(value)
          if (!Number.isSafeInteger(parsed))
            throw invalidInput('Netpbm ASCII sample exceeds safe integer range')
          samples[sample] = parsed
        }
      } else {
        const row = await readExactly(
          this.#source,
          this.#description.dataOffset + y * binaryRowBytes,
          binaryRowBytes,
          request.signal === undefined ? {} : { signal: request.signal },
        )
        if (pbmBinary) {
          for (let x = 0; x < this.width; x += 1)
            samples[x] = ((row[x >>> 3] ?? 0) >>> (7 - (x & 7))) & 1
        } else {
          for (let sample = 0; sample < samples.length; sample += 1) {
            samples[sample] =
              sampleBytes === 1
                ? (row[sample] ?? 0)
                : ((row[sample * 2] ?? 0) << 8) | (row[sample * 2 + 1] ?? 0)
          }
        }
      }
      if (y < region.y || y >= region.y + region.height) continue
      const output = convertIntegerRow(samples, this.#description, region)
      yield {
        x: 0,
        y: y - region.y,
        width: region.width,
        height: 1,
        stride: output.byteLength,
        format: this.pixelFormat,
        data: output,
      }
    }
  }
}

interface NetpbmEncoderOptions {
  readonly format: NetpbmKind
  readonly ascii: boolean
  readonly bitDepth: 8 | 16
  readonly littleEndian: boolean
  readonly scale: number
}

const netpbmEncoderOptions = (options: unknown, pixelFormat: PixelFormat): NetpbmEncoderOptions => {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw invalidInput('Netpbm encoder options must be an object')
  }
  const record = options as Readonly<Record<string, unknown>>
  const defaultFormat: NetpbmKind = pixelFormat.endsWith('f32')
    ? 'pfm'
    : pixelFormat.startsWith('gray')
      ? 'pgm'
      : pixelFormat.startsWith('rgba')
        ? 'pam'
        : 'ppm'
  const format = record.format ?? defaultFormat
  if (
    format !== 'pbm' &&
    format !== 'pgm' &&
    format !== 'ppm' &&
    format !== 'pam' &&
    format !== 'pfm'
  ) {
    throw invalidInput('Netpbm format must be pbm, pgm, ppm, pam, or pfm')
  }
  if (record.ascii !== undefined && typeof record.ascii !== 'boolean') {
    throw invalidInput('Netpbm ascii must be a boolean')
  }
  if (record.bitDepth !== undefined && record.bitDepth !== 8 && record.bitDepth !== 16) {
    throw invalidInput('Netpbm bitDepth must be 8 or 16')
  }
  if (record.endian !== undefined && record.endian !== 'little' && record.endian !== 'big') {
    throw invalidInput('PFM endian must be little or big')
  }
  if (
    record.scale !== undefined &&
    (typeof record.scale !== 'number' || !Number.isFinite(record.scale) || record.scale <= 0)
  ) {
    throw invalidInput('PFM scale must be finite and greater than zero')
  }
  if (format === 'pam' && record.ascii === true)
    throw invalidInput('PAM does not have an ASCII encoding')
  if (format === 'pfm' && (record.ascii !== undefined || record.bitDepth !== undefined)) {
    throw invalidInput('PFM does not use ascii or bitDepth options')
  }
  return {
    format,
    ascii: record.ascii ?? false,
    bitDepth: (record.bitDepth ?? (pixelFormat.includes('16') ? 16 : 8)) as 8 | 16,
    littleEndian: record.endian !== 'big',
    scale: typeof record.scale === 'number' ? record.scale : 1,
  }
}

const pixelChannels = (format: PixelFormat): 1 | 3 | 4 =>
  format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3

const readNumericSample = (
  data: Uint8Array,
  view: DataView,
  offset: number,
  bytes: 1 | 2 | 4,
): number => {
  if (bytes === 1) return (data[offset] ?? 0) / 255
  if (bytes === 2) return view.getUint16(offset, false) / 65_535
  return view.getFloat32(offset, false)
}

const readGraySample = (
  data: Uint8Array,
  view: DataView,
  offset: number,
  bytes: 1 | 2 | 4,
  channels: 1 | 3 | 4,
): number => {
  const red = readNumericSample(data, view, offset, bytes)
  if (channels === 1) return red
  const green = readNumericSample(data, view, offset + bytes, bytes)
  const blue = readNumericSample(data, view, offset + bytes * 2, bytes)
  return 0.299 * red + 0.587 * green + 0.114 * blue
}

class NetpbmEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #pixelFormat: PixelFormat
  readonly #options: NetpbmEncoderOptions
  readonly #outputChannels: 1 | 3 | 4
  readonly #floatFrame: Uint8Array | undefined
  #y = 0

  private constructor(
    sink: ImageSink,
    request: EncodeRequest,
    options: NetpbmEncoderOptions,
    outputChannels: 1 | 3 | 4,
    floatFrame: Uint8Array | undefined,
  ) {
    this.#sink = sink
    this.#width = request.width
    this.#height = request.height
    this.#pixelFormat = request.pixelFormat
    this.#options = options
    this.#outputChannels = outputChannels
    this.#floatFrame = floatFrame
  }

  static async create(sink: ImageSink, request: EncodeRequest): Promise<NetpbmEncoder> {
    if (request.metadata?.exif || request.metadata?.icc) {
      throw unsupportedOperation('Netpbm output cannot preserve EXIF or ICC metadata')
    }
    if (
      !['gray8', 'gray16', 'grayf32', 'rgb8', 'rgb16', 'rgbf32', 'rgba8', 'rgba16'].includes(
        request.pixelFormat,
      )
    ) {
      throw unsupportedOperation(`Netpbm encoding does not support ${request.pixelFormat} pixels`)
    }
    const options = netpbmEncoderOptions(request.options, request.pixelFormat)
    const inputChannels = pixelChannels(request.pixelFormat)
    const outputChannels: 1 | 3 | 4 =
      options.format === 'pbm' || options.format === 'pgm'
        ? 1
        : options.format === 'pam'
          ? inputChannels
          : options.format === 'pfm'
            ? inputChannels === 1
              ? 1
              : 3
            : 3
    let header: string
    if (options.format === 'pbm') {
      header = `${options.ascii ? 'P1' : 'P4'}\n${request.width} ${request.height}\n`
    } else if (options.format === 'pgm' || options.format === 'ppm') {
      const magic =
        options.format === 'pgm' ? (options.ascii ? 'P2' : 'P5') : options.ascii ? 'P3' : 'P6'
      header = `${magic}\n${request.width} ${request.height}\n${options.bitDepth === 16 ? 65_535 : 255}\n`
    } else if (options.format === 'pam') {
      const tuple = outputChannels === 1 ? 'GRAYSCALE' : outputChannels === 3 ? 'RGB' : 'RGB_ALPHA'
      header = `P7\nWIDTH ${request.width}\nHEIGHT ${request.height}\nDEPTH ${outputChannels}\nMAXVAL ${options.bitDepth === 16 ? 65_535 : 255}\nTUPLTYPE ${tuple}\nENDHDR\n`
    } else {
      header = `${outputChannels === 1 ? 'Pf' : 'PF'}\n${request.width} ${request.height}\n${options.littleEndian ? '-' : ''}${options.scale}\n`
    }
    await sink.write(textEncoder.encode(header))
    const floatFrame =
      options.format === 'pfm'
        ? new Uint8Array(request.width * request.height * outputChannels * 4)
        : undefined
    return new NetpbmEncoder(sink, request, options, outputChannels, floatFrame)
  }

  async write(block: PixelBlock): Promise<void> {
    const inputChannels = pixelChannels(this.#pixelFormat)
    const inputBytes = bytesPerSample(this.#pixelFormat)
    if (
      block.x !== 0 ||
      block.y !== this.#y ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.format !== this.#pixelFormat ||
      block.stride < this.#width * inputChannels * inputBytes ||
      block.data.byteLength < block.stride * block.height ||
      this.#y + block.height > this.#height
    ) {
      throw invalidInput('Netpbm encoder received a non-sequential or malformed pixel block')
    }
    const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
    for (let localY = 0; localY < block.height; localY += 1) {
      const sourceRow = localY * block.stride
      if (this.#options.format === 'pfm') {
        const frame = this.#floatFrame
        if (!frame) throw invalidInput('PFM encoder float frame is unavailable')
        const frameView = new DataView(frame.buffer)
        for (let x = 0; x < this.#width; x += 1) {
          const source = sourceRow + x * inputChannels * inputBytes
          const red = readNumericSample(block.data, view, source, inputBytes)
          const target = ((this.#y + localY) * this.#width + x) * this.#outputChannels * 4
          if (this.#outputChannels === 1) {
            const gray =
              inputChannels === 1
                ? red
                : readGraySample(block.data, view, source, inputBytes, inputChannels)
            frameView.setFloat32(target, gray / this.#options.scale, this.#options.littleEndian)
          } else {
            const green =
              inputChannels === 1
                ? red
                : readNumericSample(block.data, view, source + inputBytes, inputBytes)
            const blue =
              inputChannels === 1
                ? red
                : readNumericSample(block.data, view, source + inputBytes * 2, inputBytes)
            frameView.setFloat32(target, red / this.#options.scale, this.#options.littleEndian)
            frameView.setFloat32(
              target + 4,
              green / this.#options.scale,
              this.#options.littleEndian,
            )
            frameView.setFloat32(target + 8, blue / this.#options.scale, this.#options.littleEndian)
          }
        }
        continue
      }
      if (this.#options.format === 'pbm') {
        if (this.#options.ascii) {
          let line = ''
          for (let x = 0; x < this.#width; x += 1) {
            const source = sourceRow + x * inputChannels * inputBytes
            const gray = readGraySample(block.data, view, source, inputBytes, inputChannels)
            const token = gray < 0.5 ? '1' : '0'
            if (line.length > 0 && line.length + 2 > 70) {
              await this.#sink.write(textEncoder.encode(`${line}\n`))
              line = token
            } else {
              line = line.length === 0 ? token : `${line} ${token}`
            }
          }
          await this.#sink.write(textEncoder.encode(`${line}\n`))
        } else {
          const row = new Uint8Array(Math.ceil(this.#width / 8))
          for (let x = 0; x < this.#width; x += 1) {
            const source = sourceRow + x * inputChannels * inputBytes
            const gray = readGraySample(block.data, view, source, inputBytes, inputChannels)
            if (gray < 0.5) {
              const byte = x >>> 3
              row[byte] = (row[byte] ?? 0) | (1 << (7 - (x & 7)))
            }
          }
          await this.#sink.write(row)
        }
        continue
      }
      const high = this.#options.bitDepth === 16
      const sampleBytes = high ? 2 : 1
      const maximum = high ? 65_535 : 255
      const row = this.#options.ascii
        ? undefined
        : new Uint8Array(this.#width * this.#outputChannels * sampleBytes)
      let asciiLine = ''
      for (let x = 0; x < this.#width; x += 1) {
        const source = sourceRow + x * inputChannels * inputBytes
        for (let channel = 0; channel < this.#outputChannels; channel += 1) {
          let value: number
          if (this.#outputChannels === 1) {
            value = readGraySample(block.data, view, source, inputBytes, inputChannels)
          } else if (channel === 3) {
            value =
              inputChannels === 4
                ? readNumericSample(block.data, view, source + inputBytes * 3, inputBytes)
                : 1
          } else {
            value =
              inputChannels === 1
                ? readNumericSample(block.data, view, source, inputBytes)
                : readNumericSample(block.data, view, source + channel * inputBytes, inputBytes)
          }
          const sample = Number.isNaN(value)
            ? 0
            : Math.round(Math.max(0, Math.min(1, value)) * maximum)
          if (this.#options.ascii) {
            const token = String(sample)
            if (asciiLine.length > 0 && asciiLine.length + token.length + 1 > 70) {
              await this.#sink.write(textEncoder.encode(`${asciiLine}\n`))
              asciiLine = token
            } else {
              asciiLine = asciiLine.length === 0 ? token : `${asciiLine} ${token}`
            }
          } else {
            if (!row) throw new Error('Netpbm binary row is unavailable')
            writeSample(row, (x * this.#outputChannels + channel) * sampleBytes, sample, high)
          }
        }
      }
      if (this.#options.ascii) {
        await this.#sink.write(textEncoder.encode(`${asciiLine}\n`))
      } else {
        if (!row) throw new Error('Netpbm binary row is unavailable')
        await this.#sink.write(row)
      }
    }
    this.#y += block.height
  }

  async finish(): Promise<void> {
    if (this.#y !== this.#height) {
      throw truncatedInput(`Netpbm encoder received ${this.#y} of ${this.#height} rows`)
    }
    if (this.#options.format !== 'pfm') return
    const frame = this.#floatFrame
    if (!frame) throw invalidInput('PFM encoder float frame is unavailable')
    const rowBytes = this.#width * this.#outputChannels * 4
    for (let y = this.#height - 1; y >= 0; y -= 1) {
      await this.#sink.write(frame.subarray(y * rowBytes, (y + 1) * rowBytes))
    }
  }
}

export const createNetpbmDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<ImageDecoder> => new NetpbmDecoder(source, await describeNetpbm(source, limits))

export const createNetpbmEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
): Promise<ImageEncoder> => NetpbmEncoder.create(sink, request)
