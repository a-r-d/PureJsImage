import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import { rasterSampleBytes } from '../../raster.ts'
import type { RasterSampleType } from '../../raster.ts'
import type { ImageSource } from '../../source.ts'
import { readExactly } from '../../source.ts'

export type TiaSerVersion = 528 | 544
export type TiaSerDataKind = 'spectrum' | 'image'
export type TiaSerTagKind = 'time' | 'position'

export interface TiaSerCalibration {
  readonly offset: number
  readonly delta: number
  readonly element: number
}

export interface TiaSerDimension extends TiaSerCalibration {
  readonly size: number
  readonly description?: string
  readonly unit?: string
}

export interface TiaSerElementTag {
  readonly time: number
  readonly positionX?: number
  readonly positionY?: number
}

export interface TiaSerElement {
  readonly index: number
  readonly dataOffset: number
  readonly tagOffset: number
  readonly sampleType: RasterSampleType
  readonly dataTypeCode: number
  readonly shape: readonly [length: number] | readonly [width: number, height: number]
  readonly calibrations: readonly TiaSerCalibration[]
  readonly payloadOffset: number
  readonly payloadBytes: number
  readonly tag?: TiaSerElementTag
  readonly tagIssue?: string
}

export interface TiaSerInvalidElement {
  readonly index: number
  readonly reason: string
}

export interface TiaSerIndex {
  readonly version: TiaSerVersion
  readonly dataKind: TiaSerDataKind
  readonly tagKind: TiaSerTagKind
  readonly totalElements: number
  readonly declaredValidElements: number
  readonly offsetArrayOffset: number
  readonly dimensions: readonly TiaSerDimension[]
  readonly elements: readonly TiaSerElement[]
  readonly invalidElements: readonly TiaSerInvalidElement[]
  readonly metadataBytesRead: number
}

export interface TiaSerIndexLimits {
  readonly maxDimensions: number
  readonly maxDimensionLength: number
  readonly maxElements: number
  readonly maxStringBytes: number
  readonly maxOffsetArrayBytes: number
  readonly maxElementBytes: number
  readonly maxMetadataBytes: number
}

const byteOrder = 0x4949
const seriesId = 0x0197
const oldVersion = 0x0210
const newVersion = 0x0220
const spectrumDataType = 0x4120
const imageDataType = 0x4122
const positionTagType = 0x4142
const timeTagType = 0x4152

const checkedProduct = (values: readonly number[], label: string): number => {
  let result = 1
  for (const value of values) {
    result *= value
    if (!Number.isSafeInteger(result)) throw limitExceeded(`TIA SER ${label} exceeds safe integers`)
  }
  return result
}

const checkedExtent = (offset: number, length: number, size: number): boolean =>
  Number.isSafeInteger(offset) &&
  offset >= 0 &&
  Number.isSafeInteger(length) &&
  length >= 0 &&
  offset <= size &&
  length <= size - offset

const safeOffset = (value: bigint, label: string): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw limitExceeded(`TIA SER ${label} exceeds the safe source address range`)
  }
  return Number(value)
}

const sampleTypeForCode = (code: number): RasterSampleType | undefined => {
  if (code === 1) return 'uint8'
  if (code === 2) return 'uint16'
  if (code === 3) return 'uint32'
  if (code === 4) return 'int8'
  if (code === 5) return 'int16'
  if (code === 6) return 'int32'
  if (code === 7) return 'float32'
  if (code === 8) return 'float64'
  return undefined
}

class TiaSerIndexer {
  readonly #source: ImageSource
  readonly #limits: TiaSerIndexLimits
  readonly #signal: AbortSignal | undefined
  metadataBytesRead = 0

  constructor(source: ImageSource, limits: TiaSerIndexLimits, options: Readonly<AbortOptions>) {
    this.#source = source
    this.#limits = limits
    this.#signal = options.signal
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    throwIfAborted(this.#signal)
    if (!checkedExtent(offset, length, this.#source.size)) {
      throw invalidInput(`TIA SER metadata span ${offset}+${length} is outside the source`)
    }
    if (length > this.#limits.maxMetadataBytes - this.metadataBytesRead) {
      throw limitExceeded(
        `TIA SER metadata reads exceed maxMetadataBytes ${this.#limits.maxMetadataBytes}`,
      )
    }
    const bytes = await readExactly(this.#source, offset, length, {
      ...(this.#signal === undefined ? {} : { signal: this.#signal }),
    })
    this.metadataBytesRead += length
    return bytes
  }
}

const readText = (bytes: Uint8Array, label: string): string | undefined => {
  if (bytes.byteLength === 0) return undefined
  let value: string
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput(`TIA SER ${label} is not valid UTF-8`)
  }
  const normalized = value.replaceAll('\0', '').trim()
  return normalized.length === 0 ? undefined : normalized
}

const parseCalibration = (view: DataView, offset: number): TiaSerCalibration =>
  Object.freeze({
    offset: view.getFloat64(offset, true),
    delta: view.getFloat64(offset + 8, true),
    element: view.getUint32(offset + 16, true),
  })

const parseTag = async (
  indexer: TiaSerIndexer,
  offset: number,
  tagKind: TiaSerTagKind,
): Promise<{ readonly tag?: TiaSerElementTag; readonly issue?: string }> => {
  const length = tagKind === 'position' ? 24 : 8
  const bytes = await indexer.read(offset, length)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const expected = tagKind === 'position' ? positionTagType : timeTagType
  if (view.getUint16(0, true) !== expected) {
    return Object.freeze({ issue: `tag at ${offset} does not match header type ${expected}` })
  }
  const time = view.getUint32(4, true)
  if (tagKind === 'time') return Object.freeze({ tag: Object.freeze({ time }) })
  const positionX = view.getFloat64(8, true)
  const positionY = view.getFloat64(16, true)
  if (!Number.isFinite(positionX) || !Number.isFinite(positionY)) {
    return Object.freeze({ issue: `position tag at ${offset} contains non-finite coordinates` })
  }
  return Object.freeze({ tag: Object.freeze({ time, positionX, positionY }) })
}

const inspectElement = async (
  indexer: TiaSerIndexer,
  sourceSize: number,
  index: number,
  dataOffset: number,
  tagOffset: number,
  dataKind: TiaSerDataKind,
  tagKind: TiaSerTagKind,
  limits: TiaSerIndexLimits,
): Promise<TiaSerElement | TiaSerInvalidElement> => {
  const prefixBytes = dataKind === 'spectrum' ? 26 : 50
  if (!checkedExtent(dataOffset, prefixBytes, sourceSize)) {
    return Object.freeze({ index, reason: `data header at ${dataOffset} is truncated` })
  }
  const bytes = await indexer.read(dataOffset, prefixBytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const calibrations = Object.freeze(
    dataKind === 'spectrum'
      ? [parseCalibration(view, 0)]
      : [parseCalibration(view, 0), parseCalibration(view, 20)],
  )
  const typeOffset = dataKind === 'spectrum' ? 20 : 40
  const dataTypeCode = view.getUint16(typeOffset, true)
  const sampleType = sampleTypeForCode(dataTypeCode)
  if (sampleType === undefined) {
    const reason =
      dataTypeCode === 9 || dataTypeCode === 10
        ? `uses unsupported complex element type ${dataTypeCode}`
        : `uses unknown element type ${dataTypeCode}`
    return Object.freeze({ index, reason })
  }
  const shape: readonly [number] | readonly [number, number] =
    dataKind === 'spectrum'
      ? Object.freeze([view.getUint32(22, true)])
      : Object.freeze([view.getUint32(42, true), view.getUint32(46, true)])
  for (const length of shape) {
    if (length < 1) {
      return Object.freeze({ index, reason: `declares invalid element dimension ${length}` })
    }
    if (length > limits.maxDimensionLength) {
      throw limitExceeded(
        `TIA SER element ${index} dimension ${length} exceeds maxDimensionLength ${limits.maxDimensionLength}`,
      )
    }
  }
  const sampleCount = checkedProduct(shape, 'element sample count')
  const payloadBytes = checkedProduct(
    [sampleCount, rasterSampleBytes(sampleType)],
    'element payload size',
  )
  if (payloadBytes > limits.maxElementBytes) {
    throw limitExceeded(
      `TIA SER element ${index} payload requires ${payloadBytes} bytes; maxElementBytes is ${limits.maxElementBytes}`,
    )
  }
  const payloadOffset = dataOffset + prefixBytes
  if (!checkedExtent(payloadOffset, payloadBytes, sourceSize)) {
    return Object.freeze({ index, reason: `payload at ${payloadOffset} is truncated` })
  }
  const tagResult: { readonly tag?: TiaSerElementTag; readonly issue?: string } = checkedExtent(
    tagOffset,
    tagKind === 'position' ? 24 : 8,
    sourceSize,
  )
    ? await parseTag(indexer, tagOffset, tagKind)
    : Object.freeze({ issue: `tag at ${tagOffset} is truncated` })
  return Object.freeze({
    index,
    dataOffset,
    tagOffset,
    sampleType,
    dataTypeCode,
    shape,
    calibrations,
    payloadOffset,
    payloadBytes,
    ...(tagResult.tag === undefined ? {} : { tag: tagResult.tag }),
    ...(tagResult.issue === undefined ? {} : { tagIssue: tagResult.issue }),
  })
}

export const indexTiaSer = async (
  source: ImageSource,
  limits: Readonly<TiaSerIndexLimits>,
  options: Readonly<AbortOptions> = {},
): Promise<TiaSerIndex> => {
  const indexer = new TiaSerIndexer(source, limits, options)
  const base = await indexer.read(0, Math.min(34, source.size))
  if (base.byteLength < 30) throw invalidInput('TIA SER header is truncated')
  const view = new DataView(base.buffer, base.byteOffset, base.byteLength)
  if (view.getUint16(0, true) !== byteOrder || view.getUint16(2, true) !== seriesId) {
    throw invalidInput('TIA SER signature is absent')
  }
  const rawVersion = view.getUint16(4, true)
  if (rawVersion !== oldVersion && rawVersion !== newVersion) {
    throw unsupportedOperation(`TIA SER series version ${rawVersion} is unsupported`)
  }
  const version: TiaSerVersion = rawVersion
  const dataType = view.getUint32(6, true)
  const dataKind: TiaSerDataKind =
    dataType === spectrumDataType
      ? 'spectrum'
      : dataType === imageDataType
        ? 'image'
        : (() => {
            throw unsupportedOperation(`TIA SER data type ${dataType} is unsupported`)
          })()
  const tagType = view.getUint32(10, true)
  const tagKind: TiaSerTagKind =
    tagType === positionTagType
      ? 'position'
      : tagType === timeTagType
        ? 'time'
        : (() => {
            throw unsupportedOperation(`TIA SER tag type ${tagType} is unsupported`)
          })()
  const totalElements = view.getUint32(14, true)
  const declaredValidElements = view.getUint32(18, true)
  if (declaredValidElements > totalElements) {
    throw invalidInput('TIA SER valid element count exceeds total element count')
  }
  if (totalElements > limits.maxElements) {
    throw limitExceeded(
      `TIA SER declares ${totalElements} elements; maxElements is ${limits.maxElements}`,
    )
  }
  const wideOffsets = version === newVersion
  if (wideOffsets && base.byteLength < 34) throw invalidInput('TIA SER 64-bit header is truncated')
  const offsetArrayOffset = wideOffsets
    ? safeOffset(view.getBigUint64(22, true), 'offset array address')
    : view.getUint32(22, true)
  const numberDimensions = view.getUint32(wideOffsets ? 30 : 26, true)
  if (numberDimensions > limits.maxDimensions) {
    throw limitExceeded(
      `TIA SER declares ${numberDimensions} dimensions; maxDimensions is ${limits.maxDimensions}`,
    )
  }

  let position = wideOffsets ? 34 : 30
  const dimensions: TiaSerDimension[] = []
  for (let dimension = 0; dimension < numberDimensions; dimension += 1) {
    const fixed = await indexer.read(position, 28)
    const fixedView = new DataView(fixed.buffer, fixed.byteOffset, fixed.byteLength)
    const size = fixedView.getUint32(0, true)
    if (size < 1 || size > limits.maxDimensionLength) {
      throw limitExceeded(`TIA SER dimension ${dimension} has unsupported length ${size}`)
    }
    const descriptionLength = fixedView.getUint32(24, true)
    const calibrationOffset = fixedView.getFloat64(4, true)
    const calibrationDelta = fixedView.getFloat64(12, true)
    const calibrationElement = fixedView.getUint32(20, true)
    if (descriptionLength > limits.maxStringBytes) {
      throw limitExceeded(`TIA SER dimension ${dimension} description is too large`)
    }
    position += 28
    const description = readText(
      await indexer.read(position, descriptionLength),
      `dimension ${dimension} description`,
    )
    position += descriptionLength
    const unitLengthBytes = await indexer.read(position, 4)
    const unitLength = new DataView(
      unitLengthBytes.buffer,
      unitLengthBytes.byteOffset,
      unitLengthBytes.byteLength,
    ).getUint32(0, true)
    position += 4
    if (unitLength > limits.maxStringBytes) {
      throw limitExceeded(`TIA SER dimension ${dimension} unit is too large`)
    }
    const unit = readText(await indexer.read(position, unitLength), `dimension ${dimension} unit`)
    position += unitLength
    dimensions.push(
      Object.freeze({
        size,
        offset: calibrationOffset,
        delta: calibrationDelta,
        element: calibrationElement,
        ...(description === undefined ? {} : { description }),
        ...(unit === undefined ? {} : { unit }),
      }),
    )
  }
  if (offsetArrayOffset < position) {
    throw invalidInput('TIA SER offset array overlaps the dimension header')
  }
  const offsetWidth = wideOffsets ? 8 : 4
  const offsetArrayBytes = checkedProduct(
    [declaredValidElements, offsetWidth, 2],
    'offset array size',
  )
  if (offsetArrayBytes > limits.maxOffsetArrayBytes) {
    throw limitExceeded(
      `TIA SER offset arrays require ${offsetArrayBytes} bytes; maxOffsetArrayBytes is ${limits.maxOffsetArrayBytes}`,
    )
  }
  const offsets = await indexer.read(offsetArrayOffset, offsetArrayBytes)
  const offsetsView = new DataView(offsets.buffer, offsets.byteOffset, offsets.byteLength)
  const readOffset = (offset: number): number =>
    wideOffsets
      ? safeOffset(offsetsView.getBigUint64(offset, true), 'element address')
      : offsetsView.getUint32(offset, true)
  const dataOffsets = Array.from({ length: declaredValidElements }, (_, elementIndex) =>
    readOffset(elementIndex * offsetWidth),
  )
  const tagOffsets = Array.from({ length: declaredValidElements }, (_, elementIndex) =>
    readOffset((declaredValidElements + elementIndex) * offsetWidth),
  )

  const elements: TiaSerElement[] = []
  const invalidElements: TiaSerInvalidElement[] = []
  for (let elementIndex = 0; elementIndex < declaredValidElements; elementIndex += 1) {
    throwIfAborted(options.signal)
    const dataOffset = dataOffsets[elementIndex]
    const tagOffset = tagOffsets[elementIndex]
    if (dataOffset === undefined || tagOffset === undefined) {
      throw invalidInput(`TIA SER offset arrays omit element ${elementIndex}`)
    }
    const element = await inspectElement(
      indexer,
      source.size,
      elementIndex,
      dataOffset,
      tagOffset,
      dataKind,
      tagKind,
      limits,
    )
    if ('reason' in element) invalidElements.push(element)
    else elements.push(element)
  }

  return Object.freeze({
    version,
    dataKind,
    tagKind,
    totalElements,
    declaredValidElements,
    offsetArrayOffset,
    dimensions: Object.freeze(dimensions),
    elements: Object.freeze(elements),
    invalidElements: Object.freeze(invalidElements),
    metadataBytesRead: indexer.metadataBytesRead,
  })
}
