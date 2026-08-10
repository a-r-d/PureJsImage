import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageRuntime } from '../runtime.ts'
import type { ImageSink } from '../sink.ts'

const classicTiffMaximum = 0xffff_ffff
const compressionDeflate = 8
const photometricRgb = 2
const predictorHorizontal = 2
const targetStripBytes = 128 * 1024

interface ResolvedTiffEncodeOptions {
  readonly compression: 'deflate'
  readonly predictor: 'horizontal'
  readonly layout: 'strips'
  readonly compressionLevel: number
}

interface TiffStripPlan {
  readonly rowBytes: number
  readonly rowsPerStrip: number
  readonly stripCount: number
  readonly maximumStripBytes: number
}

interface TiffCompressionEncoder {
  readonly tag: number
  encode(data: Uint8Array): Promise<Uint8Array>
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const resolveOptions = (options: unknown): ResolvedTiffEncodeOptions => {
  if (!isRecord(options)) throw invalidInput('TIFF encoder options must be an object')
  if (options.compression !== undefined && options.compression !== 'deflate') {
    throw unsupportedOperation('TIFF encoding supports only compression: deflate')
  }
  if (options.predictor !== undefined && options.predictor !== 'horizontal') {
    throw unsupportedOperation('TIFF encoding supports only predictor: horizontal')
  }
  if (options.layout !== undefined && options.layout !== 'strips') {
    throw unsupportedOperation('TIFF encoding supports only layout: strips')
  }
  const compressionLevel = options.compressionLevel ?? 6
  if (
    typeof compressionLevel !== 'number' ||
    !Number.isInteger(compressionLevel) ||
    compressionLevel < 0 ||
    compressionLevel > 9
  ) {
    throw invalidInput('TIFF compressionLevel must be an integer from 0 to 9')
  }
  return {
    compression: 'deflate',
    predictor: 'horizontal',
    layout: 'strips',
    compressionLevel,
  }
}

const checkedProduct = (left: number, right: number, label: string): number => {
  const value = left * right
  if (!Number.isSafeInteger(value) || value < 1) throw limitExceeded(`${label} is too large`)
  return value
}

const planStrips = (width: number, height: number, samples: 3 | 4): TiffStripPlan => {
  const rowBytes = checkedProduct(width, samples, 'TIFF row size')
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(targetStripBytes / rowBytes) || 1))
  const stripCount = Math.ceil(height / rowsPerStrip)
  return {
    rowBytes,
    rowsPerStrip,
    stripCount,
    maximumStripBytes: checkedProduct(rowBytes, rowsPerStrip, 'TIFF strip size'),
  }
}

const applyHorizontalPredictor = (row: Uint8Array, width: number, samples: 3 | 4): void => {
  for (let pixel = width - 1; pixel > 0; pixel -= 1) {
    const offset = pixel * samples
    const previous = offset - samples
    for (let sample = 0; sample < samples; sample += 1) {
      row[offset + sample] = ((row[offset + sample] ?? 0) - (row[previous + sample] ?? 0)) & 0xff
    }
  }
}

const packPixelRow = (
  source: Uint8Array,
  sourceOffset: number,
  target: Uint8Array,
  targetOffset: number,
  rowBytes: number,
): void => {
  target.set(source.subarray(sourceOffset, sourceOffset + rowBytes), targetOffset)
}

const deflateCompressionEncoder = (
  runtime: ImageRuntime,
  compressionLevel: number,
): TiffCompressionEncoder => ({
  tag: compressionDeflate,
  encode: async (data) =>
    runtime.deflate(data, {
      level: compressionLevel,
      strategy: 'default',
    }),
})

const align4 = (value: number): number => Math.ceil(value / 4) * 4

const writeIfdEntry = (
  view: DataView,
  offset: number,
  tag: number,
  fieldType: number,
  count: number,
  value: number,
): void => {
  view.setUint16(offset, tag, true)
  view.setUint16(offset + 2, fieldType, true)
  view.setUint32(offset + 4, count, true)
  if (fieldType === 3 && count === 1) view.setUint16(offset + 8, value, true)
  else view.setUint32(offset + 8, value, true)
}

const classicTiffPrefix = (
  width: number,
  height: number,
  samples: 3 | 4,
  plan: TiffStripPlan,
  compressionTag: number,
  strips: readonly Uint8Array[],
  icc: Uint8Array | undefined,
): Uint8Array => {
  const entryCount = (samples === 4 ? 13 : 12) + (icc ? 1 : 0)
  const ifdOffset = 8
  const ifdBytes = 2 + entryCount * 12 + 4
  let cursor = align4(ifdOffset + ifdBytes)
  const bitsOffset = cursor
  cursor = align4(cursor + samples * 2)
  const stripOffsetsTable = strips.length > 1 ? cursor : undefined
  if (stripOffsetsTable !== undefined) cursor = align4(cursor + strips.length * 4)
  const stripByteCountsTable = strips.length > 1 ? cursor : undefined
  if (stripByteCountsTable !== undefined) cursor = align4(cursor + strips.length * 4)
  const iccOffset = icc ? cursor : undefined
  if (icc) cursor = align4(cursor + icc.byteLength)
  const pixelOffset = cursor

  const stripOffsets = new Uint32Array(strips.length)
  let nextStripOffset = pixelOffset
  for (let index = 0; index < strips.length; index += 1) {
    const strip = strips[index]
    if (!strip) throw invalidInput('TIFF compressed strip is missing')
    if (strip.byteLength > classicTiffMaximum || nextStripOffset > classicTiffMaximum) {
      throw limitExceeded('TIFF output exceeds Classic TIFF 32-bit offsets')
    }
    stripOffsets[index] = nextStripOffset
    nextStripOffset += strip.byteLength
    if (!Number.isSafeInteger(nextStripOffset) || nextStripOffset > classicTiffMaximum) {
      throw limitExceeded('TIFF output exceeds Classic TIFF 32-bit offsets')
    }
  }

  const output = new Uint8Array(pixelOffset)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, entryCount, true)
  let entryOffset = ifdOffset + 2
  const entry = (tag: number, fieldType: number, count: number, value: number): void => {
    writeIfdEntry(view, entryOffset, tag, fieldType, count, value)
    entryOffset += 12
  }
  entry(256, 4, 1, width)
  entry(257, 4, 1, height)
  entry(258, 3, samples, bitsOffset)
  entry(259, 3, 1, compressionTag)
  entry(262, 3, 1, photometricRgb)
  entry(273, 4, strips.length, stripOffsetsTable ?? stripOffsets[0] ?? 0)
  entry(274, 3, 1, 1)
  entry(277, 3, 1, samples)
  entry(278, 4, 1, plan.rowsPerStrip)
  entry(279, 4, strips.length, stripByteCountsTable ?? strips[0]?.byteLength ?? 0)
  entry(284, 3, 1, 1)
  entry(317, 3, 1, predictorHorizontal)
  if (samples === 4) entry(338, 3, 1, 2)
  if (icc && iccOffset !== undefined) entry(34675, 7, icc.byteLength, iccOffset)
  view.setUint32(entryOffset, 0, true)

  for (let sample = 0; sample < samples; sample += 1) {
    view.setUint16(bitsOffset + sample * 2, 8, true)
  }
  if (stripOffsetsTable !== undefined && stripByteCountsTable !== undefined) {
    for (let index = 0; index < strips.length; index += 1) {
      view.setUint32(stripOffsetsTable + index * 4, stripOffsets[index] ?? 0, true)
      view.setUint32(stripByteCountsTable + index * 4, strips[index]?.byteLength ?? 0, true)
    }
  }
  if (icc && iccOffset !== undefined) output.set(icc, iccOffset)
  return output
}

export class TiffEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: 'rgb8' | 'rgba8'
  readonly #samples: 3 | 4
  readonly #plan: TiffStripPlan
  readonly #compression: TiffCompressionEncoder
  readonly #icc: Uint8Array | undefined
  readonly #stripBuffer: Uint8Array
  readonly #compressedStrips: Uint8Array[] = []
  #rowsInStrip = 0
  #y = 0
  #finished = false

  private constructor(
    sink: ImageSink,
    width: number,
    height: number,
    format: 'rgb8' | 'rgba8',
    runtime: ImageRuntime,
    options: ResolvedTiffEncodeOptions,
    icc: Uint8Array | undefined,
  ) {
    this.#sink = sink
    this.#width = width
    this.#height = height
    this.#format = format
    this.#samples = format === 'rgb8' ? 3 : 4
    this.#plan = planStrips(width, height, this.#samples)
    this.#compression = deflateCompressionEncoder(runtime, options.compressionLevel)
    this.#icc = icc
    this.#stripBuffer = new Uint8Array(this.#plan.maximumStripBytes)
  }

  static async create(sink: ImageSink, request: EncodeRequest): Promise<TiffEncoder> {
    const options = resolveOptions(request.options)
    const format = request.pixelFormat
    if (format !== 'rgb8' && format !== 'rgba8') {
      throw unsupportedOperation(
        `TIFF encoding supports only 8-bit RGB or RGBA pixels, not ${format}`,
      )
    }
    if (
      !Number.isSafeInteger(request.width) ||
      !Number.isSafeInteger(request.height) ||
      request.width < 1 ||
      request.height < 1 ||
      request.width > classicTiffMaximum ||
      request.height > classicTiffMaximum
    ) {
      throw invalidInput(`Invalid TIFF output dimensions: ${request.width}x${request.height}`)
    }
    const runtime = request.runtime
    if (!runtime) throw unsupportedOperation('TIFF encoding requires a runtime Deflate provider')
    if (request.metadata?.exif) {
      throw unsupportedOperation('Preserving EXIF into TIFF output is not implemented')
    }
    const icc = request.metadata?.icc
    if (icc) {
      const colorSpace = iccColorSpace(icc)
      if (colorSpace !== 'rgb') {
        throw invalidInput('Preserved ICC profile does not match TIFF RGB output pixels')
      }
    }
    return new TiffEncoder(sink, request.width, request.height, format, runtime, options, icc)
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw new Error('Cannot write to a finished TIFF encoder')
    if (
      block.x !== 0 ||
      block.y !== this.#y ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.format !== this.#format ||
      block.stride < this.#plan.rowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + this.#plan.rowBytes ||
      this.#y + block.height > this.#height
    ) {
      throw invalidInput('TIFF encoder received a non-sequential or malformed pixel block')
    }
    for (let row = 0; row < block.height; row += 1) {
      const targetOffset = this.#rowsInStrip * this.#plan.rowBytes
      packPixelRow(
        block.data,
        row * block.stride,
        this.#stripBuffer,
        targetOffset,
        this.#plan.rowBytes,
      )
      applyHorizontalPredictor(
        this.#stripBuffer.subarray(targetOffset, targetOffset + this.#plan.rowBytes),
        this.#width,
        this.#samples,
      )
      this.#rowsInStrip += 1
      this.#y += 1
      if (this.#rowsInStrip === this.#plan.rowsPerStrip || this.#y === this.#height) {
        await this.#finishStrip()
      }
    }
  }

  async finish(): Promise<void> {
    if (this.#finished) throw new Error('TIFF encoder is already finished')
    this.#finished = true
    if (this.#y !== this.#height) {
      throw truncatedInput(`TIFF encoder received ${this.#y} of ${this.#height} rows`)
    }
    if (this.#compressedStrips.length !== this.#plan.stripCount) {
      throw invalidInput('TIFF encoder produced an invalid strip count')
    }
    const prefix = classicTiffPrefix(
      this.#width,
      this.#height,
      this.#samples,
      this.#plan,
      this.#compression.tag,
      this.#compressedStrips,
      this.#icc,
    )
    await this.#sink.write(prefix)
    for (let index = 0; index < this.#compressedStrips.length; index += 1) {
      const strip = this.#compressedStrips[index]
      if (!strip) throw invalidInput('TIFF compressed strip is missing')
      await this.#sink.write(strip)
      this.#compressedStrips[index] = new Uint8Array()
    }
    this.#compressedStrips.length = 0
  }

  async abort(_reason: unknown): Promise<void> {
    this.#finished = true
    this.#compressedStrips.length = 0
  }

  async #finishStrip(): Promise<void> {
    const bytes = this.#rowsInStrip * this.#plan.rowBytes
    const compressed = await this.#compression.encode(this.#stripBuffer.subarray(0, bytes))
    if (compressed.byteLength > classicTiffMaximum) {
      throw limitExceeded('TIFF compressed strip exceeds Classic TIFF limits')
    }
    this.#compressedStrips.push(compressed)
    this.#rowsInStrip = 0
  }
}
