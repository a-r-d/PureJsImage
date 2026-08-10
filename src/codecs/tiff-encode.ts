import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import { iccColorSpace } from '../metadata.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { TiffEncodeOptions } from '../pipeline.ts'
import type { ImageRuntime } from '../runtime.ts'
import type { ImageSink } from '../sink.ts'

const classicTiffMaximum = 0xffff_ffff
const compressionDeflate = 8
const photometricRgb = 2
const predictorHorizontal = 2
const targetSegmentBytes = 128 * 1024

export type { TiffEncodeOptions } from '../pipeline.ts'

export interface TiffPageEncodeRequest {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'rgb8' | 'rgba8'
  readonly blocks: AsyncIterable<PixelBlock>
  readonly icc?: Uint8Array
  readonly reducedImages?: readonly TiffPageEncodeRequest[]
}

export interface TiffDocumentEncodeRequest {
  readonly pages: readonly TiffPageEncodeRequest[]
  readonly runtime: ImageRuntime
  readonly options?: Readonly<TiffEncodeOptions>
}

interface ResolvedTiffEncodeOptions {
  readonly compression: 'deflate'
  readonly predictor: 'horizontal'
  readonly layout: 'strips' | 'tiles'
  readonly compressionLevel: number
  readonly rowsPerStrip?: number
  readonly tileWidth: number
  readonly tileHeight: number
  readonly format: 'classic' | 'bigtiff' | 'auto'
}

interface TiffSegmentPlan {
  readonly layout: 'strips' | 'tiles'
  readonly inputRowBytes: number
  readonly segmentWidth: number
  readonly segmentHeight: number
  readonly segmentsAcross: number
  readonly segmentsDown: number
  readonly segmentCount: number
  readonly maximumSegmentBytes: number
}

interface TiffCompressionEncoder {
  readonly tag: number
  encode(data: Uint8Array): Promise<Uint8Array>
}

interface EncodedTiffImage {
  readonly width: number
  readonly height: number
  readonly samples: 3 | 4
  readonly plan: TiffSegmentPlan
  readonly compressionTag: number
  readonly segments: readonly Uint8Array[]
  readonly icc?: Uint8Array
  readonly reduced: boolean
  readonly children: readonly EncodedTiffImage[]
}

type TiffContainer = 'classic' | 'bigtiff'

type FieldValue = readonly number[] | Uint8Array

interface TiffField {
  readonly tag: number
  readonly type: 1 | 3 | 4 | 7 | 16 | 18
  readonly count: number
  readonly value: FieldValue
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const positiveIntegerOption = (value: unknown, label: string): number | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`TIFF ${label} must be a positive safe integer`)
  }
  return value
}

const resolveOptions = (options: unknown): ResolvedTiffEncodeOptions => {
  if (!isRecord(options)) throw invalidInput('TIFF encoder options must be an object')
  if (options.compression !== undefined && options.compression !== 'deflate') {
    throw unsupportedOperation('TIFF encoding supports only compression: deflate')
  }
  if (options.predictor !== undefined && options.predictor !== 'horizontal') {
    throw unsupportedOperation('TIFF encoding supports only predictor: horizontal')
  }
  if (options.layout !== undefined && options.layout !== 'strips' && options.layout !== 'tiles') {
    throw unsupportedOperation('TIFF layout must be strips or tiles')
  }
  if (
    options.format !== undefined &&
    options.format !== 'classic' &&
    options.format !== 'bigtiff' &&
    options.format !== 'auto'
  ) {
    throw unsupportedOperation('TIFF format must be classic, bigtiff, or auto')
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
  const layout = options.layout ?? 'strips'
  const rowsPerStrip = positiveIntegerOption(options.rowsPerStrip, 'rowsPerStrip')
  const tileWidth = positiveIntegerOption(options.tileWidth, 'tileWidth') ?? 256
  const tileHeight = positiveIntegerOption(options.tileHeight, 'tileHeight') ?? 256
  if (
    layout === 'strips' &&
    (options.tileWidth !== undefined || options.tileHeight !== undefined)
  ) {
    throw invalidInput('TIFF tile dimensions require layout: tiles')
  }
  if (layout === 'tiles' && options.rowsPerStrip !== undefined) {
    throw invalidInput('TIFF rowsPerStrip requires layout: strips')
  }
  if (layout === 'tiles' && (tileWidth % 16 !== 0 || tileHeight % 16 !== 0)) {
    throw invalidInput('TIFF tile dimensions must be multiples of 16')
  }
  return {
    compression: 'deflate',
    predictor: 'horizontal',
    layout,
    compressionLevel,
    ...(rowsPerStrip === undefined ? {} : { rowsPerStrip }),
    tileWidth,
    tileHeight,
    format: options.format ?? 'classic',
  }
}

const checkedProduct = (left: number, right: number, label: string): number => {
  const value = left * right
  if (!Number.isSafeInteger(value) || value < 1) throw limitExceeded(`${label} is too large`)
  return value
}

const checkedSum = (left: number, right: number, label: string): number => {
  const value = left + right
  if (!Number.isSafeInteger(value) || value < 0) throw limitExceeded(`${label} is too large`)
  return value
}

const planSegments = (
  width: number,
  height: number,
  samples: 3 | 4,
  options: ResolvedTiffEncodeOptions,
): TiffSegmentPlan => {
  const inputRowBytes = checkedProduct(width, samples, 'TIFF row size')
  if (options.layout === 'strips') {
    const rowsPerStrip =
      options.rowsPerStrip ??
      Math.max(1, Math.min(height, Math.floor(targetSegmentBytes / inputRowBytes) || 1))
    const segmentsDown = Math.ceil(height / rowsPerStrip)
    return {
      layout: 'strips',
      inputRowBytes,
      segmentWidth: width,
      segmentHeight: rowsPerStrip,
      segmentsAcross: 1,
      segmentsDown,
      segmentCount: segmentsDown,
      maximumSegmentBytes: checkedProduct(inputRowBytes, rowsPerStrip, 'TIFF strip size'),
    }
  }
  const tileRowBytes = checkedProduct(options.tileWidth, samples, 'TIFF tile row size')
  const segmentsAcross = Math.ceil(width / options.tileWidth)
  const segmentsDown = Math.ceil(height / options.tileHeight)
  return {
    layout: 'tiles',
    inputRowBytes,
    segmentWidth: options.tileWidth,
    segmentHeight: options.tileHeight,
    segmentsAcross,
    segmentsDown,
    segmentCount: checkedProduct(segmentsAcross, segmentsDown, 'TIFF tile count'),
    maximumSegmentBytes: checkedProduct(tileRowBytes, options.tileHeight, 'TIFF tile size'),
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

const deflateCompressionEncoder = (
  runtime: ImageRuntime,
  compressionLevel: number,
): TiffCompressionEncoder => ({
  tag: compressionDeflate,
  encode: async (data) => runtime.deflate(data, { level: compressionLevel, strategy: 'default' }),
})

const validateImage = (
  width: number,
  height: number,
  format: PixelFormat,
  icc: Uint8Array | undefined,
): 3 | 4 => {
  if (format !== 'rgb8' && format !== 'rgba8') {
    throw unsupportedOperation(
      `TIFF encoding supports only 8-bit RGB or RGBA pixels, not ${format}`,
    )
  }
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > classicTiffMaximum ||
    height > classicTiffMaximum
  ) {
    throw invalidInput(`Invalid TIFF output dimensions: ${width}x${height}`)
  }
  if (icc && iccColorSpace(icc) !== 'rgb') {
    throw invalidInput('Preserved ICC profile does not match TIFF RGB output pixels')
  }
  return format === 'rgb8' ? 3 : 4
}

class TiffImageCollector {
  readonly #width: number
  readonly #height: number
  readonly #format: 'rgb8' | 'rgba8'
  readonly #samples: 3 | 4
  readonly #plan: TiffSegmentPlan
  readonly #compression: TiffCompressionEncoder
  readonly #icc: Uint8Array | undefined
  readonly #segmentBuffers: Uint8Array[]
  readonly #compressedSegments: Uint8Array[] = []
  #rowsInBand = 0
  #y = 0
  #finished = false

  constructor(
    width: number,
    height: number,
    format: 'rgb8' | 'rgba8',
    runtime: ImageRuntime,
    options: ResolvedTiffEncodeOptions,
    icc: Uint8Array | undefined,
  ) {
    this.#width = width
    this.#height = height
    this.#format = format
    this.#samples = validateImage(width, height, format, icc)
    this.#plan = planSegments(width, height, this.#samples, options)
    this.#compression = deflateCompressionEncoder(runtime, options.compressionLevel)
    this.#icc = icc
    this.#segmentBuffers = Array.from(
      { length: this.#plan.segmentsAcross },
      () => new Uint8Array(this.#plan.maximumSegmentBytes),
    )
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw invalidInput('Cannot write to a finished TIFF image collector')
    if (
      block.x !== 0 ||
      block.y !== this.#y ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.format !== this.#format ||
      block.stride < this.#plan.inputRowBytes ||
      block.data.byteLength < block.stride * (block.height - 1) + this.#plan.inputRowBytes ||
      this.#y + block.height > this.#height
    ) {
      throw invalidInput('TIFF encoder received a non-sequential or malformed pixel block')
    }
    for (let row = 0; row < block.height; row += 1) {
      this.#copyRow(block.data, row * block.stride)
      this.#rowsInBand += 1
      this.#y += 1
      if (this.#rowsInBand === this.#plan.segmentHeight || this.#y === this.#height) {
        await this.#finishBand()
      }
    }
  }

  async finish(reduced: boolean, children: readonly EncodedTiffImage[]): Promise<EncodedTiffImage> {
    if (this.#finished) throw invalidInput('TIFF image collector is already finished')
    this.#finished = true
    if (this.#y !== this.#height) {
      throw truncatedInput(`TIFF encoder received ${this.#y} of ${this.#height} rows`)
    }
    if (this.#compressedSegments.length !== this.#plan.segmentCount) {
      throw invalidInput('TIFF encoder produced an invalid segment count')
    }
    return Object.freeze({
      width: this.#width,
      height: this.#height,
      samples: this.#samples,
      plan: this.#plan,
      compressionTag: this.#compression.tag,
      segments: Object.freeze(this.#compressedSegments.splice(0)),
      ...(this.#icc === undefined ? {} : { icc: this.#icc }),
      reduced,
      children: Object.freeze([...children]),
    })
  }

  abort(): void {
    this.#finished = true
    this.#compressedSegments.length = 0
    for (const buffer of this.#segmentBuffers) buffer.fill(0)
  }

  #copyRow(source: Uint8Array, sourceOffset: number): void {
    if (this.#plan.layout === 'strips') {
      const target = this.#segmentBuffers[0]
      if (!target) throw invalidInput('TIFF strip buffer is missing')
      const targetOffset = this.#rowsInBand * this.#plan.inputRowBytes
      target.set(
        source.subarray(sourceOffset, sourceOffset + this.#plan.inputRowBytes),
        targetOffset,
      )
      applyHorizontalPredictor(
        target.subarray(targetOffset, targetOffset + this.#plan.inputRowBytes),
        this.#width,
        this.#samples,
      )
      return
    }
    const tileRowBytes = this.#plan.segmentWidth * this.#samples
    for (let tileX = 0; tileX < this.#plan.segmentsAcross; tileX += 1) {
      const target = this.#segmentBuffers[tileX]
      if (!target) throw invalidInput('TIFF tile buffer is missing')
      const firstPixel = tileX * this.#plan.segmentWidth
      const pixels = Math.min(this.#plan.segmentWidth, this.#width - firstPixel)
      const sourceStart = sourceOffset + firstPixel * this.#samples
      const targetStart = this.#rowsInBand * tileRowBytes
      target.set(source.subarray(sourceStart, sourceStart + pixels * this.#samples), targetStart)
    }
  }

  async #finishBand(): Promise<void> {
    if (this.#plan.layout === 'strips') {
      const buffer = this.#segmentBuffers[0]
      if (!buffer) throw invalidInput('TIFF strip buffer is missing')
      const bytes = this.#rowsInBand * this.#plan.inputRowBytes
      this.#compressedSegments.push(await this.#compression.encode(buffer.subarray(0, bytes)))
      buffer.fill(0, 0, bytes)
    } else {
      const tileRowBytes = this.#plan.segmentWidth * this.#samples
      for (const buffer of this.#segmentBuffers) {
        for (let row = 0; row < this.#plan.segmentHeight; row += 1) {
          const offset = row * tileRowBytes
          applyHorizontalPredictor(
            buffer.subarray(offset, offset + tileRowBytes),
            this.#plan.segmentWidth,
            this.#samples,
          )
        }
        this.#compressedSegments.push(await this.#compression.encode(buffer))
        buffer.fill(0)
      }
    }
    this.#rowsInBand = 0
  }
}

const align = (value: number, boundary: number): number => Math.ceil(value / boundary) * boundary

const fieldTypeBytes = (type: TiffField['type']): number => {
  if (type === 3) return 2
  if (type === 4) return 4
  if (type === 16 || type === 18) return 8
  return 1
}

const flattenImages = (pages: readonly EncodedTiffImage[]): readonly EncodedTiffImage[] => {
  const flattened: EncodedTiffImage[] = []
  const visit = (image: EncodedTiffImage): void => {
    flattened.push(image)
    for (const child of image.children) visit(child)
  }
  for (const page of pages) visit(page)
  return flattened
}

const fieldCount = (image: EncodedTiffImage): number =>
  (image.plan.layout === 'tiles' ? 13 : 12) +
  (image.samples === 4 ? 1 : 0) +
  (image.icc ? 1 : 0) +
  (image.children.length > 0 ? 1 : 0) +
  (image.reduced ? 1 : 0)

const encodeFieldValue = (field: TiffField, littleEndian = true): Uint8Array => {
  if (field.value instanceof Uint8Array) return field.value
  const bytes = new Uint8Array(field.count * fieldTypeBytes(field.type))
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < field.value.length; index += 1) {
    const value = field.value[index]
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
      throw limitExceeded(`TIFF tag ${field.tag} contains an invalid integer`)
    }
    const offset = index * fieldTypeBytes(field.type)
    if (field.type === 1 || field.type === 7) view.setUint8(offset, value)
    else if (field.type === 3) view.setUint16(offset, value, littleEndian)
    else if (field.type === 4) view.setUint32(offset, value, littleEndian)
    else view.setBigUint64(offset, BigInt(value), littleEndian)
  }
  return bytes
}

const imageFields = (
  image: EncodedTiffImage,
  container: TiffContainer,
  segmentOffsets: readonly number[],
  childOffsets: readonly number[],
): readonly TiffField[] => {
  const offsetType: 4 | 16 = container === 'classic' ? 4 : 16
  const subIfdType: 4 | 18 = container === 'classic' ? 4 : 18
  const fields: TiffField[] = [
    { tag: 256, type: 4, count: 1, value: [image.width] },
    { tag: 257, type: 4, count: 1, value: [image.height] },
    {
      tag: 258,
      type: 3,
      count: image.samples,
      value: Array.from({ length: image.samples }, () => 8),
    },
    { tag: 259, type: 3, count: 1, value: [image.compressionTag] },
    { tag: 262, type: 3, count: 1, value: [photometricRgb] },
    { tag: 274, type: 3, count: 1, value: [1] },
    { tag: 277, type: 3, count: 1, value: [image.samples] },
    { tag: 284, type: 3, count: 1, value: [1] },
    { tag: 317, type: 3, count: 1, value: [predictorHorizontal] },
  ]
  if (image.plan.layout === 'strips') {
    fields.push(
      { tag: 273, type: offsetType, count: image.segments.length, value: segmentOffsets },
      { tag: 278, type: 4, count: 1, value: [image.plan.segmentHeight] },
      {
        tag: 279,
        type: offsetType,
        count: image.segments.length,
        value: image.segments.map((segment) => segment.byteLength),
      },
    )
  } else {
    fields.push(
      { tag: 322, type: 4, count: 1, value: [image.plan.segmentWidth] },
      { tag: 323, type: 4, count: 1, value: [image.plan.segmentHeight] },
      { tag: 324, type: offsetType, count: image.segments.length, value: segmentOffsets },
      {
        tag: 325,
        type: offsetType,
        count: image.segments.length,
        value: image.segments.map((segment) => segment.byteLength),
      },
    )
  }
  if (image.samples === 4) fields.push({ tag: 338, type: 3, count: 1, value: [2] })
  if (image.icc)
    fields.push({ tag: 34_675, type: 7, count: image.icc.byteLength, value: image.icc })
  if (image.children.length > 0)
    fields.push({ tag: 330, type: subIfdType, count: childOffsets.length, value: childOffsets })
  if (image.reduced) fields.push({ tag: 254, type: 4, count: 1, value: [1] })
  return fields.sort((left, right) => left.tag - right.tag)
}

interface SerializedTiff {
  readonly prefix: Uint8Array
  readonly images: readonly EncodedTiffImage[]
}

const serializeTiff = (
  pages: readonly EncodedTiffImage[],
  requestedContainer: ResolvedTiffEncodeOptions['format'],
): SerializedTiff => {
  if (pages.length < 1) throw invalidInput('TIFF document must contain at least one page')
  const images = flattenImages(pages)
  const attempt = (container: TiffContainer): SerializedTiff => {
    const big = container === 'bigtiff'
    const headerBytes = big ? 16 : 8
    const countBytes = big ? 8 : 2
    const entryBytes = big ? 20 : 12
    const nextBytes = big ? 8 : 4
    const valueBytes = big ? 8 : 4
    const boundary = big ? 8 : 4
    const ifdOffsets: number[] = []
    let cursor = headerBytes
    for (const image of images) {
      ifdOffsets.push(cursor)
      cursor = checkedSum(
        cursor,
        countBytes + fieldCount(image) * entryBytes + nextBytes,
        'TIFF directory area',
      )
    }
    cursor = align(cursor, boundary)

    const indexByImage = new Map<EncodedTiffImage, number>()
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index]
      if (image) indexByImage.set(image, index)
    }
    const placeholderOffsets = images.map((image) => image.segments.map(() => 0))
    const fieldsByImage = images.map((image) =>
      imageFields(
        image,
        container,
        placeholderOffsets[indexByImage.get(image) ?? 0] ?? [],
        image.children.map((child) => ifdOffsets[indexByImage.get(child) ?? -1] ?? 0),
      ),
    )
    const externalOffsets = new Map<string, number>()
    for (let imageIndex = 0; imageIndex < fieldsByImage.length; imageIndex += 1) {
      for (const field of fieldsByImage[imageIndex] ?? []) {
        const bytes = field.count * fieldTypeBytes(field.type)
        if (bytes > valueBytes) {
          externalOffsets.set(`${imageIndex}:${field.tag}`, cursor)
          cursor = align(checkedSum(cursor, bytes, 'TIFF metadata area'), boundary)
        }
      }
    }
    const pixelStart = cursor
    const segmentOffsets = images.map((image) => {
      const offsets: number[] = []
      for (const segment of image.segments) {
        offsets.push(cursor)
        cursor = checkedSum(cursor, segment.byteLength, 'TIFF output')
      }
      return offsets
    })
    if (!big && cursor > classicTiffMaximum) {
      throw limitExceeded('TIFF output exceeds Classic TIFF 32-bit offsets')
    }
    if (pixelStart > 0xffff_ffff)
      throw limitExceeded('TIFF metadata prefix exceeds JavaScript buffer limits')

    const prefix = new Uint8Array(pixelStart)
    const view = new DataView(prefix.buffer)
    prefix.set([0x49, 0x49])
    if (big) {
      view.setUint16(2, 43, true)
      view.setUint16(4, 8, true)
      view.setUint16(6, 0, true)
      view.setBigUint64(8, BigInt(ifdOffsets[0] ?? 0), true)
    } else {
      view.setUint16(2, 42, true)
      view.setUint32(4, ifdOffsets[0] ?? 0, true)
    }

    const topIndex = new Map<EncodedTiffImage, number>()
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index]
      if (page) topIndex.set(page, index)
    }
    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const image = images[imageIndex]
      if (!image) throw invalidInput('TIFF image directory is missing')
      const childOffsets = image.children.map(
        (child) => ifdOffsets[indexByImage.get(child) ?? -1] ?? 0,
      )
      const fields = imageFields(image, container, segmentOffsets[imageIndex] ?? [], childOffsets)
      let entryOffset = ifdOffsets[imageIndex] ?? 0
      if (big) view.setBigUint64(entryOffset, BigInt(fields.length), true)
      else view.setUint16(entryOffset, fields.length, true)
      entryOffset += countBytes
      for (const field of fields) {
        view.setUint16(entryOffset, field.tag, true)
        view.setUint16(entryOffset + 2, field.type, true)
        if (big) view.setBigUint64(entryOffset + 4, BigInt(field.count), true)
        else view.setUint32(entryOffset + 4, field.count, true)
        const valueOffset = entryOffset + (big ? 12 : 8)
        const payload = encodeFieldValue(field)
        if (payload.byteLength <= valueBytes) {
          prefix.set(payload, valueOffset)
        } else {
          const externalOffset = externalOffsets.get(`${imageIndex}:${field.tag}`)
          if (externalOffset === undefined)
            throw invalidInput(`TIFF tag ${field.tag} external offset is missing`)
          if (big) view.setBigUint64(valueOffset, BigInt(externalOffset), true)
          else view.setUint32(valueOffset, externalOffset, true)
          prefix.set(payload, externalOffset)
        }
        entryOffset += entryBytes
      }
      const pageIndex = topIndex.get(image)
      const nextPage = pageIndex === undefined ? undefined : pages[pageIndex + 1]
      const nextOffset =
        nextPage === undefined ? 0 : (ifdOffsets[indexByImage.get(nextPage) ?? -1] ?? 0)
      if (big) view.setBigUint64(entryOffset, BigInt(nextOffset), true)
      else view.setUint32(entryOffset, nextOffset, true)
    }
    return Object.freeze({ prefix, images })
  }

  if (requestedContainer === 'bigtiff') return attempt('bigtiff')
  if (requestedContainer === 'classic') return attempt('classic')
  try {
    return attempt('classic')
  } catch (error: unknown) {
    if (!(error instanceof Error) || !error.message.includes('Classic TIFF')) throw error
    return attempt('bigtiff')
  }
}

const writeSerialized = async (sink: ImageSink, serialized: SerializedTiff): Promise<void> => {
  await sink.write(serialized.prefix)
  for (const image of serialized.images) {
    for (const segment of image.segments) await sink.write(segment)
  }
}

const collectPage = async (
  request: TiffPageEncodeRequest,
  runtime: ImageRuntime,
  options: ResolvedTiffEncodeOptions,
  reduced: boolean,
): Promise<EncodedTiffImage> => {
  const collector = new TiffImageCollector(
    request.width,
    request.height,
    request.pixelFormat,
    runtime,
    options,
    request.icc,
  )
  try {
    for await (const block of request.blocks) await collector.write(block)
    const children: EncodedTiffImage[] = []
    for (const child of request.reducedImages ?? []) {
      children.push(await collectPage(child, runtime, options, true))
    }
    return await collector.finish(reduced, children)
  } catch (error: unknown) {
    collector.abort()
    throw error
  }
}

export const encodeTiffDocument = async (
  sink: ImageSink,
  request: Readonly<TiffDocumentEncodeRequest>,
): Promise<void> => {
  const options = resolveOptions(request.options ?? {})
  if (request.pages.length < 1) throw invalidInput('TIFF document must contain at least one page')
  const pages: EncodedTiffImage[] = []
  try {
    for (const page of request.pages)
      pages.push(await collectPage(page, request.runtime, options, false))
    await writeSerialized(sink, serializeTiff(pages, options.format))
  } catch (error: unknown) {
    await sink.abort(error)
    throw error
  }
}

export class TiffEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #collector: TiffImageCollector
  readonly #options: ResolvedTiffEncodeOptions
  #finished = false

  private constructor(
    sink: ImageSink,
    collector: TiffImageCollector,
    options: ResolvedTiffEncodeOptions,
  ) {
    this.#sink = sink
    this.#collector = collector
    this.#options = options
  }

  static async create(sink: ImageSink, request: EncodeRequest): Promise<TiffEncoder> {
    const options = resolveOptions(request.options)
    const format = request.pixelFormat
    if (format !== 'rgb8' && format !== 'rgba8') {
      throw unsupportedOperation(
        `TIFF encoding supports only 8-bit RGB or RGBA pixels, not ${format}`,
      )
    }
    const runtime = request.runtime
    if (!runtime) throw unsupportedOperation('TIFF encoding requires a runtime Deflate provider')
    if (request.metadata?.exif) {
      throw unsupportedOperation('Preserving EXIF into TIFF output is not implemented')
    }
    const collector = new TiffImageCollector(
      request.width,
      request.height,
      format,
      runtime,
      options,
      request.metadata?.icc,
    )
    return new TiffEncoder(sink, collector, options)
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#finished) throw invalidInput('Cannot write to a finished TIFF encoder')
    await this.#collector.write(block)
  }

  async finish(): Promise<void> {
    if (this.#finished) throw invalidInput('TIFF encoder is already finished')
    this.#finished = true
    const image = await this.#collector.finish(false, [])
    await writeSerialized(this.#sink, serializeTiff([image], this.#options.format))
  }

  async abort(_reason: unknown): Promise<void> {
    this.#finished = true
    this.#collector.abort()
  }
}
