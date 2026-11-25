import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import type { PixelColorSemantics } from '../color.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { DeflateEncoder, DeflateOptions } from '../runtime.ts'
import type { ImageSink } from '../sink.ts'
import { crc32 } from './crc32.ts'
import { signature, scanlineBlockRows, bytesPerPixel } from './png-common.ts'
import type { PngAcceleration, PngRowFilter } from './png.ts'

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

interface PngColorSignal {
  readonly type: 'gAMA' | 'sRGB' | 'cICP'
  readonly data: Uint8Array
}

const pngRenderingIntentCode = (intent: PixelColorSemantics['renderingIntent']): number => {
  if (intent === undefined || intent === 'perceptual') return 0
  if (intent === 'relative') return 1
  if (intent === 'saturation') return 2
  return 3
}

const nativePngColorSignal = (
  semantics: PixelColorSemantics | undefined,
): PngColorSignal | undefined => {
  if (semantics === undefined) return undefined
  if (semantics.primaries === 'srgb' && semantics.transfer.kind === 'srgb') {
    return {
      type: 'sRGB',
      data: Uint8Array.of(pngRenderingIntentCode(semantics.renderingIntent)),
    }
  }
  if (
    (semantics.family === 'rgb' || semantics.family === 'gray') &&
    semantics.primaries === 'srgb' &&
    semantics.transfer.kind === 'linear' &&
    semantics.matrix === 'identity' &&
    semantics.range === 'full' &&
    semantics.renderingIntent === undefined
  ) {
    return { type: 'cICP', data: Uint8Array.of(1, 8, 0, 1) }
  }
  if (
    semantics.family === 'rgb' &&
    semantics.primaries === 'display-p3' &&
    semantics.transfer.kind === 'srgb' &&
    semantics.renderingIntent === undefined
  ) {
    return { type: 'cICP', data: Uint8Array.of(12, 13, 0, 1) }
  }
  if (
    semantics.primaries === 'unspecified' &&
    semantics.transfer.kind === 'gamma' &&
    semantics.renderingIntent === undefined
  ) {
    const encoded = Math.round(100_000 / semantics.transfer.exponent)
    if (
      encoded < 1 ||
      encoded > 0xffffffff ||
      !Number.isSafeInteger(encoded) ||
      100_000 / encoded !== semantics.transfer.exponent
    ) {
      throw unsupportedOperation('PNG cannot represent the exact pixel gamma exponent')
    }
    const data = new Uint8Array(4)
    new DataView(data.buffer).setUint32(0, encoded)
    return { type: 'gAMA', data }
  }
  if (
    semantics.primaries === 'unspecified' &&
    semantics.transfer.kind === 'unspecified' &&
    semantics.renderingIntent === undefined
  ) {
    return undefined
  }
  throw unsupportedOperation('PNG cannot represent the native pixel color semantics exactly')
}

const filteredMagnitudeTable = Uint8Array.from({ length: 256 }, (_entry, value) =>
  Math.min(value, 256 - value),
)

const filteredMagnitude = (value: number): number => filteredMagnitudeTable[value] ?? 0

const chooseAdaptiveFilter = (
  none: number,
  sub: number,
  up: number,
  average: number,
  paethScore: number,
): 0 | 1 | 2 | 3 | 4 => {
  let filter: 0 | 1 | 2 | 3 = 0
  let score = none
  if (sub < score) {
    filter = 1
    score = sub
  }
  if (up < score) {
    filter = 2
    score = up
  }
  if (average < score) {
    filter = 3
    score = average
  }
  if (paethScore < score) return 4
  return filter
}

// The residual is reduced modulo 256, so one byte holds any Paeth offset.
// Index by the two neighbor differences, each in [-255, 255].
const paethOffsets = new Uint8Array(512 * 511)
const aboveOffsets = Uint8Array.from({ length: 511 }, (_, index) => index - 255)
for (let left = -255; left <= 255; left += 1) {
  const origin = (left + 255) * 512 + 255
  paethOffsets.set(aboveOffsets, origin - 255)
  // Relative to a zero corner, Paeth compares |above|, |left| and |left + above|.
  // Corner wins strictly between -2*left and -left/2. Left wins from -left/2
  // through left, including ties. Elsewhere the predictor is above.
  const middle = Math.trunc(-left / 2)
  const other = -2 * left
  const cornerStart = Math.max(-255, Math.min(other, middle) + 1)
  const cornerEnd = Math.min(256, Math.max(other, middle))
  paethOffsets.fill(0, origin + cornerStart, origin + cornerEnd)
  paethOffsets.fill(left, origin + Math.min(middle, left), origin + Math.max(middle, left) + 1)
}

const encodePaeth = (left: number, above: number, corner: number): number =>
  corner + (paethOffsets[(left - corner + 255) * 512 + above - corner + 255] ?? 0)

const applyFilterScanline = (
  source: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
  output: Uint8Array,
  filter: 0 | 1 | 2 | 3,
): void => {
  output[0] = filter
  if (filter === 0) {
    output.set(source, 1)
    return
  }
  if (filter === 1) {
    output.set(source.subarray(0, bytesPerPixel), 1)
    for (let index = bytesPerPixel; index < source.byteLength; index += 1) {
      output[index + 1] = ((source[index] ?? 0) - (source[index - bytesPerPixel] ?? 0)) & 0xff
    }
    return
  }
  if (filter === 2) {
    for (let index = 0; index < source.byteLength; index += 1) {
      output[index + 1] = ((source[index] ?? 0) - (previous[index] ?? 0)) & 0xff
    }
    return
  }
  for (let index = 0; index < bytesPerPixel; index += 1) {
    const above = previous[index] ?? 0
    output[index + 1] = ((source[index] ?? 0) - (above >>> 1)) & 0xff
  }
  for (let index = bytesPerPixel; index < source.byteLength; index += 1) {
    const left = source[index - bytesPerPixel] ?? 0
    const above = previous[index] ?? 0
    output[index + 1] = ((source[index] ?? 0) - ((left + above) >>> 1)) & 0xff
  }
}

// A nonzero word may include up to three zero bytes. Scoring those bytes is exact.
const zeroPrefix = (row: DataView, limit: number): number => {
  let index = 0
  for (; index + 4 <= limit; index += 4) {
    if (row.getUint32(index) !== 0) return index
  }
  while (index < limit && row.getUint8(index) === 0) index += 1
  return index
}

const filterScanline = (
  source: Uint8Array,
  previous: Uint8Array,
  bytesPerPixel: number,
  output: Uint8Array,
  adaptive: boolean,
): void => {
  let filter: 0 | 1 | 2 | 3 | 4 = 0
  // An all-zero row gives None the lowest possible score and it wins all ties.
  if (adaptive) {
    const sourceView = new DataView(source.buffer, source.byteOffset, source.byteLength)
    const prefix = zeroPrefix(sourceView, source.byteLength)
    if (prefix === source.byteLength) {
      output.fill(0)
      return
    }
    const previousView = new DataView(previous.buffer, previous.byteOffset, previous.byteLength)
    let none = 0
    let sub = 0
    let up = 0
    let average = 0
    let paethScore = 0
    const length = source.byteLength
    for (let index = 0; index < bytesPerPixel && index < length; index += 1) {
      const value = source[index] ?? 0
      const above = previous[index] ?? 0
      const residual = (value - above) & 0xff
      none += filteredMagnitude(value)
      sub += filteredMagnitude(value)
      up += filteredMagnitude(residual)
      average += filteredMagnitude((value - Math.floor(above / 2)) & 0xff)
      output[index + 1] = residual
      paethScore += filteredMagnitude(residual)
    }
    // Beyond the last nonzero byte, Left and the Paeth corner can still
    // contribute for one more pixel.
    const start = Math.max(bytesPerPixel, zeroPrefix(previousView, prefix))
    let end = length
    while (
      end - 4 >= start &&
      (sourceView.getUint32(end - 4) | previousView.getUint32(end - 4)) === 0
    ) {
      end -= 4
    }
    end = Math.min(length, end + bytesPerPixel)
    output.fill(0, bytesPerPixel + 1, start + 1)
    output.fill(0, end + 1)
    for (let index = start; index < end; index += 1) {
      const value = sourceView.getUint8(index)
      const left = sourceView.getUint8(index - bytesPerPixel)
      const above = previousView.getUint8(index)
      const upperLeft = previousView.getUint8(index - bytesPerPixel)
      none += filteredMagnitude(value)
      sub += filteredMagnitude((value - left) & 0xff)
      up += filteredMagnitude((value - above) & 0xff)
      average += filteredMagnitude((value - Math.floor((left + above) / 2)) & 0xff)
      const residual = (value - encodePaeth(left, above, upperLeft)) & 0xff
      output[index + 1] = residual
      paethScore += filteredMagnitude(residual)
    }
    filter = chooseAdaptiveFilter(none, sub, up, average, paethScore)
    // The Paeth residuals are already in the output row from scoring.
    if (filter === 4) {
      output[0] = filter
      return
    }
  }
  applyFilterScanline(source, previous, bytesPerPixel, output, filter)
}

class PngEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #deflater: DeflateEncoder
  readonly #width: number
  readonly #height: number
  readonly #format: PixelFormat
  readonly #channels: number
  readonly #adaptiveFiltering: boolean
  readonly #previousRow: Uint8Array
  #acceleratedFilter: PngRowFilter | undefined
  #expectedY = 0
  #finished = false

  constructor(
    sink: ImageSink,
    deflater: DeflateEncoder,
    width: number,
    height: number,
    format: PixelFormat,
    adaptiveFiltering: boolean,
    acceleratedFilter: PngRowFilter | undefined,
  ) {
    this.#sink = sink
    this.#deflater = deflater
    this.#width = width
    this.#height = height
    this.#format = format
    this.#channels = bytesPerPixel(format)
    this.#adaptiveFiltering = adaptiveFiltering
    this.#previousRow = new Uint8Array(width * this.#channels)
    this.#acceleratedFilter = acceleratedFilter
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished PNG encoder')
    try {
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

      for (let firstRow = 0; firstRow < block.height; firstRow += scanlineBlockRows) {
        const rows = Math.min(scanlineBlockRows, block.height - firstRow)
        let scanlines: Uint8Array
        if (this.#acceleratedFilter) {
          scanlines = this.#acceleratedFilter.filter(
            block.data.subarray(firstRow * block.stride),
            block.stride,
            rows,
          )
        } else {
          const length = (rowBytes + 1) * rows
          scanlines = this.#deflater.inputBuffer?.(length) ?? new Uint8Array(length)
          for (let row = 0; row < rows; row += 1) {
            const sourceOffset = (firstRow + row) * block.stride
            const source = block.data.subarray(sourceOffset, sourceOffset + rowBytes)
            filterScanline(
              source,
              this.#previousRow,
              this.#channels,
              scanlines.subarray(row * (rowBytes + 1), (row + 1) * (rowBytes + 1)),
              this.#adaptiveFiltering,
            )
            this.#previousRow.set(source)
          }
        }
        await this.#deflater.write(scanlines)
      }
      this.#expectedY += block.height
    } catch (error) {
      if (this.#acceleratedFilter) {
        this.#finished = true
        this.#releaseFilter()
      }
      throw error
    }
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('PNG encoder is already finished')
    this.#finished = true
    try {
      if (this.#expectedY !== this.#height) {
        throw invalidInput(`PNG encoder received ${this.#expectedY} of ${this.#height} rows`)
      }
      await this.#deflater.finish()
      await writeChunk(this.#sink, 'IEND', new Uint8Array())
    } finally {
      this.#releaseFilter()
    }
  }

  async abort(reason: unknown): Promise<void> {
    this.#finished = true
    try {
      await this.#deflater.abort(reason)
    } finally {
      this.#releaseFilter()
    }
  }

  #releaseFilter(): void {
    this.#acceleratedFilter?.release()
    this.#acceleratedFilter = undefined
  }
}

export const createPngEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
  accelerations: readonly PngAcceleration[] = [],
): Promise<ImageEncoder> => {
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
  bytesPerPixel(request.pixelFormat)
  const level = compressionLevel(request.options)
  const runtime = request.runtime
  if (!runtime) throw unsupportedOperation('PNG encoding requires a runtime compression provider')
  const semantics = request.colorSemantics
  const sourceProfilePixels =
    semantics?.primaries === 'source-profile' || semantics?.transfer.kind === 'source-profile'
  if (sourceProfilePixels && (semantics.provenance !== 'icc' || !request.metadata?.icc)) {
    throw unsupportedOperation(
      'PNG source-profile pixels require an explicitly preserved ICC profile',
    )
  }
  if (semantics?.provenance === 'icc' && !request.metadata?.icc) {
    throw unsupportedOperation(
      'PNG ICC pixel semantics require an explicitly preserved ICC profile',
    )
  }
  const nativeColorSignal =
    request.metadata?.icc === undefined ? nativePngColorSignal(semantics) : undefined

  let acceleratedFilter: PngRowFilter | undefined
  for (const acceleration of accelerations) {
    if (!acceleration.encode) continue
    acceleratedFilter = await acceleration.encode({
      width: request.width,
      height: request.height,
      pixelFormat: request.pixelFormat,
      adaptiveFiltering: level !== 0,
    })
    if (acceleratedFilter) break
  }

  try {
    await sink.write(signature)
    const header = new Uint8Array(13)
    const view = new DataView(header.buffer)
    view.setUint32(0, request.width)
    view.setUint32(4, request.height)
    const bitDepth = request.pixelFormat.endsWith('16') ? 16 : 8
    const storageChannels =
      request.pixelFormat === 'gray8' || request.pixelFormat === 'gray16'
        ? 1
        : request.pixelFormat === 'rgb8' || request.pixelFormat === 'rgb16'
          ? 3
          : 4
    header[8] = bitDepth
    header[9] = storageChannels === 1 ? 0 : storageChannels === 3 ? 2 : 6
    await writeChunk(sink, 'IHDR', header)

    const icc = request.metadata?.icc
    if (icc) {
      const colorSpace = iccColorSpace(icc)
      if (
        colorSpace === 'other' ||
        ((request.pixelFormat === 'gray8' || request.pixelFormat === 'gray16') &&
          colorSpace !== 'gray') ||
        (request.pixelFormat !== 'gray8' &&
          request.pixelFormat !== 'gray16' &&
          colorSpace !== 'rgb')
      ) {
        throw invalidInput('Preserved ICC profile does not match PNG output pixels')
      }
      const name = Uint8Array.of(
        0x50,
        0x75,
        0x72,
        0x65,
        0x4a,
        0x73,
        0x49,
        0x6d,
        0x61,
        0x67,
        0x65,
        0,
        0,
      )
      const compressed = await runtime.deflate(icc, { level: 6, strategy: 'default' })
      const payload = new Uint8Array(name.byteLength + compressed.byteLength)
      payload.set(name)
      payload.set(compressed, name.byteLength)
      await writeChunk(sink, 'iCCP', payload)
    } else if (nativeColorSignal !== undefined) {
      await writeChunk(sink, nativeColorSignal.type, nativeColorSignal.data)
    }
    if (request.metadata?.exif) await writeChunk(sink, 'eXIf', request.metadata.exif)
    const options: DeflateOptions = {
      level,
      strategy: request.pixelFormat === 'rgb8' ? 'rle' : 'default',
    }
    const onData = (chunk: Uint8Array): Promise<void> => writeChunk(sink, 'IDAT', chunk)
    const parallel =
      request.threads === undefined
        ? undefined
        : await runtime.createParallelDeflateEncoder?.(
            options,
            onData,
            request.threads,
            (1 + request.width * bytesPerPixel(request.pixelFormat)) * request.height,
          )
    return new PngEncoder(
      sink,
      parallel ?? runtime.createDeflateEncoder(options, onData),
      request.width,
      request.height,
      request.pixelFormat,
      level !== 0,
      acceleratedFilter,
    )
  } catch (error) {
    acceleratedFilter?.release()
    throw error
  }
}
