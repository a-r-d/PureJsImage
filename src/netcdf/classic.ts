import { throwIfAborted } from '../abort.ts'
import {
  invalidInput,
  limitExceeded,
  truncatedInput,
  unsupportedFormat,
  unsupportedOperation,
} from '../errors.ts'
import type { RasterSampleType } from '../raster.ts'
import { type ImageSource, type ImageSourceReadOptions, readExactly } from '../source.ts'

const ncDimension = 10
const ncVariable = 11
const ncAttribute = 12

export type NetCdfClassicVersion = 1 | 2
export type NetCdfPrimitiveType = 'byte' | 'char' | 'short' | 'int' | 'float' | 'double'

export interface NetCdfClassicLimits {
  readonly maxHeaderBytes?: number
  readonly headerReadChunkBytes?: number
  readonly maxDimensions?: number
  readonly maxVariables?: number
  readonly maxAttributes?: number
  readonly maxNameBytes?: number
  readonly maxAttributeValues?: number
  readonly maxAttributeBytes?: number
  readonly maxRecordCount?: number
  readonly maxVariableElements?: number
}

export interface ResolvedNetCdfClassicLimits {
  readonly maxHeaderBytes: number
  readonly headerReadChunkBytes: number
  readonly maxDimensions: number
  readonly maxVariables: number
  readonly maxAttributes: number
  readonly maxNameBytes: number
  readonly maxAttributeValues: number
  readonly maxAttributeBytes: number
  readonly maxRecordCount: number
  readonly maxVariableElements: number
}

export interface NetCdfAttribute {
  readonly name: string
  readonly type: NetCdfPrimitiveType
  readonly values: string | readonly number[]
}

export interface NetCdfDimension {
  readonly id: number
  readonly name: string
  readonly length: number
  readonly unlimited: boolean
}

export interface NetCdfVariable {
  readonly id: number
  readonly name: string
  readonly dimensionIds: readonly number[]
  readonly dimensions: readonly NetCdfDimension[]
  readonly attributes: readonly NetCdfAttribute[]
  readonly type: Exclude<NetCdfPrimitiveType, 'char'> | 'char'
  readonly sampleType?: RasterSampleType
  readonly elementBytes: number
  readonly elementCount: number
  readonly record: boolean
  readonly recordElementCount?: number
  readonly declaredSize: number
  readonly dataOffset: number
}

export interface NetCdfClassicFile {
  readonly format: 'netcdf-classic'
  readonly version: NetCdfClassicVersion
  readonly numRecords: number
  readonly dimensions: readonly NetCdfDimension[]
  readonly variables: readonly NetCdfVariable[]
  readonly globalAttributes: readonly NetCdfAttribute[]
  readonly recordStride: number
  readonly headerByteLength: number
  readonly metadataBytesRead: number
  readonly source: ImageSource
  readonly limits: ResolvedNetCdfClassicLimits
}

export interface NetCdfVariableReadLimits {
  readonly maxBytes: number
  readonly maxValues: number
  readonly maxReadOperations: number
}

export interface NetCdfVariableSectionRequest {
  readonly xDimensionId: number
  readonly yDimensionId: number
  readonly fixedIndices: ReadonlyMap<number, number>
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly limits: Readonly<NetCdfVariableReadLimits>
  readonly signal?: AbortSignal
}

const defaults: ResolvedNetCdfClassicLimits = Object.freeze({
  maxHeaderBytes: 16 * 1024 * 1024,
  headerReadChunkBytes: 4,
  maxDimensions: 1_024,
  maxVariables: 16_384,
  maxAttributes: 65_536,
  maxNameBytes: 4_096,
  maxAttributeValues: 1_048_576,
  maxAttributeBytes: 16 * 1024 * 1024,
  maxRecordCount: 100_000_000,
  maxVariableElements: 1_000_000_000_000,
})

const positive = (value: number | undefined, fallback: number, label: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return resolved
}

export const resolveNetCdfClassicLimits = (
  value: Readonly<NetCdfClassicLimits> = {},
): ResolvedNetCdfClassicLimits =>
  Object.freeze({
    maxHeaderBytes: positive(value.maxHeaderBytes, defaults.maxHeaderBytes, 'maxHeaderBytes'),
    headerReadChunkBytes: positive(
      value.headerReadChunkBytes,
      defaults.headerReadChunkBytes,
      'headerReadChunkBytes',
    ),
    maxDimensions: positive(value.maxDimensions, defaults.maxDimensions, 'maxDimensions'),
    maxVariables: positive(value.maxVariables, defaults.maxVariables, 'maxVariables'),
    maxAttributes: positive(value.maxAttributes, defaults.maxAttributes, 'maxAttributes'),
    maxNameBytes: positive(value.maxNameBytes, defaults.maxNameBytes, 'maxNameBytes'),
    maxAttributeValues: positive(
      value.maxAttributeValues,
      defaults.maxAttributeValues,
      'maxAttributeValues',
    ),
    maxAttributeBytes: positive(
      value.maxAttributeBytes,
      defaults.maxAttributeBytes,
      'maxAttributeBytes',
    ),
    maxRecordCount: positive(value.maxRecordCount, defaults.maxRecordCount, 'maxRecordCount'),
    maxVariableElements: positive(
      value.maxVariableElements,
      defaults.maxVariableElements,
      'maxVariableElements',
    ),
  })

const checkedProduct = (values: readonly number[], limit: number, label: string): number => {
  let result = 1
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) throw invalidInput(`${label} is invalid`)
    result *= value
    if (!Number.isSafeInteger(result) || result > limit)
      throw limitExceeded(`${label} is too large`)
  }
  return result
}

const checkedAdd = (left: number, right: number, label: string): number => {
  const result = left + right
  if (!Number.isSafeInteger(result) || result < 0) throw limitExceeded(`${label} overflowed`)
  return result
}

const align4 = (value: number): number =>
  checkedAdd(value, (4 - (value & 3)) & 3, 'NetCDF alignment')

class CountingSource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  bytesRead = 0

  constructor(source: ImageSource) {
    this.#source = source
    this.size = source.size
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    const bytes = await this.#source.read(offset, length, options)
    this.bytesRead += bytes.byteLength
    return bytes
  }
}

class HeaderCursor {
  readonly #source: CountingSource
  readonly #limits: ResolvedNetCdfClassicLimits
  readonly #signal: AbortSignal | undefined
  #buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()
  #bufferOffset = 0
  #offset = 0

  constructor(
    source: CountingSource,
    limits: ResolvedNetCdfClassicLimits,
    signal: AbortSignal | undefined,
  ) {
    this.#source = source
    this.#limits = limits
    this.#signal = signal
  }

  get offset(): number {
    return this.#offset
  }

  async bytes(length: number, label: string): Promise<Uint8Array> {
    throwIfAborted(this.#signal)
    if (!Number.isSafeInteger(length) || length < 0)
      throw invalidInput(`${label} length is invalid`)
    const end = checkedAdd(this.#offset, length, `${label} range`)
    if (end > this.#limits.maxHeaderBytes)
      throw limitExceeded('NetCDF header exceeds maxHeaderBytes')
    if (end > this.#source.size) throw truncatedInput(`${label} is truncated`)
    if (length === 0) return new Uint8Array()
    if (this.#offset < this.#bufferOffset || end > this.#bufferOffset + this.#buffer.byteLength) {
      this.#bufferOffset = this.#offset
      const available = this.#source.size - this.#offset
      const readLength = Math.min(
        available,
        Math.max(length, this.#limits.headerReadChunkBytes),
        this.#limits.maxHeaderBytes - this.#offset,
      )
      this.#buffer = await readExactly(this.#source, this.#offset, readLength, {
        ...(this.#signal === undefined ? {} : { signal: this.#signal }),
      })
    }
    const start = this.#offset - this.#bufferOffset
    const output = this.#buffer.subarray(start, start + length)
    if (output.byteLength !== length) throw truncatedInput(`${label} is truncated`)
    this.#offset = end
    return output
  }

  async u32(label: string): Promise<number> {
    const bytes = await this.bytes(4, label)
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false)
  }

  async u64(label: string): Promise<number> {
    const bytes = await this.bytes(8, label)
    const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, false)
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw limitExceeded(`${label} exceeds safe offsets`)
    return Number(value)
  }

  async padding(length: number, label: string): Promise<void> {
    const aligned = align4(length)
    if (aligned !== length) await this.bytes(aligned - length, `${label} padding`)
  }
}

const primitive = (
  code: number,
): {
  readonly type: NetCdfPrimitiveType
  readonly bytes: number
  readonly sampleType?: RasterSampleType
} => {
  if (code === 1) return { type: 'byte', bytes: 1, sampleType: 'int8' }
  if (code === 2) return { type: 'char', bytes: 1 }
  if (code === 3) return { type: 'short', bytes: 2, sampleType: 'int16' }
  if (code === 4) return { type: 'int', bytes: 4, sampleType: 'int32' }
  if (code === 5) return { type: 'float', bytes: 4, sampleType: 'float32' }
  if (code === 6) return { type: 'double', bytes: 8, sampleType: 'float64' }
  throw unsupportedOperation(`NetCDF primitive type ${code} is unsupported`)
}

const decodeName = (bytes: Uint8Array, label: string): string => {
  if (bytes.includes(0)) throw invalidInput(`${label} contains a NUL byte`)
  let value: string
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput(`${label} is not valid UTF-8`)
  }
  if (value.length === 0) throw invalidInput(`${label} is empty`)
  return value
}

const readName = async (
  cursor: HeaderCursor,
  limits: ResolvedNetCdfClassicLimits,
  label: string,
): Promise<string> => {
  const length = await cursor.u32(`${label} length`)
  if (length < 1 || length > limits.maxNameBytes) throw limitExceeded(`${label} is too long`)
  const bytes = await cursor.bytes(length, label)
  await cursor.padding(length, label)
  return decodeName(bytes, label)
}

const numericAttributeValues = (
  type: NetCdfPrimitiveType,
  bytes: Uint8Array,
  count: number,
): readonly number[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Object.freeze(
    Array.from({ length: count }, (_, index) => {
      if (type === 'byte') return view.getInt8(index)
      if (type === 'short') return view.getInt16(index * 2, false)
      if (type === 'int') return view.getInt32(index * 4, false)
      if (type === 'float') return view.getFloat32(index * 4, false)
      if (type === 'double') return view.getFloat64(index * 8, false)
      throw invalidInput('NetCDF numeric attribute has a character type')
    }),
  )
}

const decodeCharacterAttribute = (bytes: Uint8Array, label: string): string => {
  let end = bytes.byteLength
  while (end > 0 && bytes[end - 1] === 0) end -= 1
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end))
  } catch {
    throw invalidInput(`${label} is not valid UTF-8`)
  }
}

const readAttributes = async (
  cursor: HeaderCursor,
  limits: ResolvedNetCdfClassicLimits,
  total: { count: number },
  label: string,
): Promise<readonly NetCdfAttribute[]> => {
  const tag = await cursor.u32(`${label} tag`)
  const count = await cursor.u32(`${label} count`)
  if (tag === 0 && count === 0) return Object.freeze([])
  if (tag !== ncAttribute) throw invalidInput(`${label} tag is invalid`)
  total.count = checkedAdd(total.count, count, 'NetCDF attribute count')
  if (total.count > limits.maxAttributes) throw limitExceeded('NetCDF has too many attributes')
  const output: NetCdfAttribute[] = []
  const names = new Set<string>()
  for (let index = 0; index < count; index += 1) {
    const name = await readName(cursor, limits, `${label} attribute name`)
    if (names.has(name)) throw invalidInput(`${label} has duplicate attribute ${name}`)
    names.add(name)
    const definition = primitive(await cursor.u32(`${label} attribute type`))
    const valueCount = await cursor.u32(`${label} attribute value count`)
    if (valueCount > limits.maxAttributeValues) {
      throw limitExceeded(`NetCDF attribute ${name} has too many values`)
    }
    const valueBytes = checkedProduct(
      [valueCount, definition.bytes],
      limits.maxAttributeBytes,
      `NetCDF attribute ${name} bytes`,
    )
    const bytes = await cursor.bytes(valueBytes, `NetCDF attribute ${name}`)
    await cursor.padding(valueBytes, `NetCDF attribute ${name}`)
    output.push(
      Object.freeze({
        name,
        type: definition.type,
        values:
          definition.type === 'char'
            ? decodeCharacterAttribute(bytes, `NetCDF attribute ${name}`)
            : numericAttributeValues(definition.type, bytes, valueCount),
      }),
    )
  }
  return Object.freeze(output)
}

const readDimensions = async (
  cursor: HeaderCursor,
  limits: ResolvedNetCdfClassicLimits,
  numRecords: number,
): Promise<readonly NetCdfDimension[]> => {
  const tag = await cursor.u32('NetCDF dimension-list tag')
  const count = await cursor.u32('NetCDF dimension count')
  if (tag === 0 && count === 0) return Object.freeze([])
  if (tag !== ncDimension) throw invalidInput('NetCDF dimension-list tag is invalid')
  if (count > limits.maxDimensions) throw limitExceeded('NetCDF has too many dimensions')
  let unlimitedSeen = false
  const output: NetCdfDimension[] = []
  const names = new Set<string>()
  for (let id = 0; id < count; id += 1) {
    const name = await readName(cursor, limits, 'NetCDF dimension name')
    if (names.has(name)) throw invalidInput(`NetCDF has duplicate dimension ${name}`)
    names.add(name)
    const declared = await cursor.u32(`NetCDF dimension ${name} length`)
    const unlimited = declared === 0
    if (unlimited && unlimitedSeen)
      throw invalidInput('NetCDF has more than one unlimited dimension')
    unlimitedSeen ||= unlimited
    output.push(Object.freeze({ id, name, length: unlimited ? numRecords : declared, unlimited }))
  }
  return Object.freeze(output)
}

const readVariables = async (
  cursor: HeaderCursor,
  version: NetCdfClassicVersion,
  dimensions: readonly NetCdfDimension[],
  limits: ResolvedNetCdfClassicLimits,
  attributes: { count: number },
): Promise<readonly NetCdfVariable[]> => {
  const tag = await cursor.u32('NetCDF variable-list tag')
  const count = await cursor.u32('NetCDF variable count')
  if (tag === 0 && count === 0) return Object.freeze([])
  if (tag !== ncVariable) throw invalidInput('NetCDF variable-list tag is invalid')
  if (count > limits.maxVariables) throw limitExceeded('NetCDF has too many variables')
  const output: NetCdfVariable[] = []
  const names = new Set<string>()
  for (let id = 0; id < count; id += 1) {
    const name = await readName(cursor, limits, 'NetCDF variable name')
    if (names.has(name)) throw invalidInput(`NetCDF has duplicate variable ${name}`)
    names.add(name)
    const dimensionCount = await cursor.u32(`NetCDF variable ${name} dimension count`)
    if (dimensionCount > limits.maxDimensions) {
      throw limitExceeded(`NetCDF variable ${name} has too many dimensions`)
    }
    const dimensionIds: number[] = []
    const variableDimensions: NetCdfDimension[] = []
    for (let index = 0; index < dimensionCount; index += 1) {
      const dimensionId = await cursor.u32(`NetCDF variable ${name} dimension ID`)
      const dimension = dimensions[dimensionId]
      if (dimension === undefined)
        throw invalidInput(`NetCDF variable ${name} has an invalid dimension`)
      dimensionIds.push(dimensionId)
      variableDimensions.push(dimension)
    }
    const variableAttributes = await readAttributes(
      cursor,
      limits,
      attributes,
      `NetCDF variable ${name}`,
    )
    const definition = primitive(await cursor.u32(`NetCDF variable ${name} type`))
    const declaredSize = await cursor.u32(`NetCDF variable ${name} size`)
    const dataOffset =
      version === 1
        ? await cursor.u32(`NetCDF variable ${name} offset`)
        : await cursor.u64(`NetCDF variable ${name} offset`)
    const record = variableDimensions[0]?.unlimited === true
    if (variableDimensions.some((dimension, index) => dimension.unlimited && index !== 0)) {
      throw invalidInput(`NetCDF variable ${name} has an unlimited dimension outside index zero`)
    }
    const elementCount = checkedProduct(
      variableDimensions.map((dimension) => dimension.length),
      limits.maxVariableElements,
      `NetCDF variable ${name} element count`,
    )
    const recordElementCount = record
      ? checkedProduct(
          variableDimensions.slice(1).map((dimension) => dimension.length),
          limits.maxVariableElements,
          `NetCDF variable ${name} record element count`,
        )
      : undefined
    const logicalBytes = checkedProduct(
      [record ? (recordElementCount ?? 0) : elementCount, definition.bytes],
      Number.MAX_SAFE_INTEGER,
      `NetCDF variable ${name} byte length`,
    )
    if (declaredSize < logicalBytes || declaredSize !== align4(logicalBytes)) {
      throw invalidInput(`NetCDF variable ${name} size and aligned shape disagree`)
    }
    output.push(
      Object.freeze({
        id,
        name,
        dimensionIds: Object.freeze(dimensionIds),
        dimensions: Object.freeze(variableDimensions),
        attributes: variableAttributes,
        type: definition.type,
        ...(definition.sampleType === undefined ? {} : { sampleType: definition.sampleType }),
        elementBytes: definition.bytes,
        elementCount,
        record,
        ...(recordElementCount === undefined ? {} : { recordElementCount }),
        declaredSize,
        dataOffset,
      }),
    )
  }
  return Object.freeze(output)
}

const validateDataRanges = (
  source: ImageSource,
  variables: readonly NetCdfVariable[],
  numRecords: number,
  recordStride: number,
  headerByteLength: number,
): void => {
  for (const variable of variables) {
    if ((variable.dataOffset & 3) !== 0) {
      throw invalidInput(`NetCDF variable ${variable.name} offset is not four-byte aligned`)
    }
    if (variable.dataOffset < headerByteLength) {
      throw invalidInput(`NetCDF variable ${variable.name} starts inside the header`)
    }
    const byteLength = variable.record
      ? numRecords === 0
        ? 0
        : checkedAdd(
            (numRecords - 1) * recordStride,
            (variable.recordElementCount ?? 0) * variable.elementBytes,
            `NetCDF variable ${variable.name} record range`,
          )
      : variable.elementCount * variable.elementBytes
    const end = checkedAdd(
      variable.dataOffset,
      byteLength,
      `NetCDF variable ${variable.name} range`,
    )
    if (end > source.size)
      throw truncatedInput(`NetCDF variable ${variable.name} data is truncated`)
  }
}

export const openNetCdfClassic = async (
  source: ImageSource,
  options: Readonly<NetCdfClassicLimits & { readonly signal?: AbortSignal }> = {},
): Promise<NetCdfClassicFile> => {
  throwIfAborted(options.signal)
  const limits = resolveNetCdfClassicLimits(options)
  const counting = new CountingSource(source)
  const cursor = new HeaderCursor(counting, limits, options.signal)
  const magic = await cursor.bytes(4, 'NetCDF magic')
  if (magic[0] !== 0x43 || magic[1] !== 0x44 || magic[2] !== 0x46) {
    throw unsupportedFormat('NetCDF CDF magic is absent')
  }
  const rawVersion = magic[3]
  if (rawVersion === 5) throw unsupportedFormat('NetCDF CDF-5 is not supported')
  if (rawVersion !== 1 && rawVersion !== 2) {
    throw unsupportedFormat(`NetCDF classic version ${rawVersion ?? -1} is not supported`)
  }
  const version: NetCdfClassicVersion = rawVersion
  const numRecords = await cursor.u32('NetCDF record count')
  if (numRecords === 0xffff_ffff) {
    throw unsupportedOperation('Streaming NetCDF record counts are not supported')
  }
  if (numRecords > limits.maxRecordCount)
    throw limitExceeded('NetCDF record count exceeds its limit')
  const dimensions = await readDimensions(cursor, limits, numRecords)
  const attributeCount = { count: 0 }
  const globalAttributes = await readAttributes(cursor, limits, attributeCount, 'NetCDF global')
  const variables = await readVariables(cursor, version, dimensions, limits, attributeCount)
  const recordVariables = variables.filter((variable) => variable.record)
  const recordStride =
    recordVariables.length === 1
      ? checkedProduct(
          [recordVariables[0]?.recordElementCount ?? 0, recordVariables[0]?.elementBytes ?? 0],
          Number.MAX_SAFE_INTEGER,
          'NetCDF record stride',
        )
      : recordVariables.reduce(
          (sum, variable) => checkedAdd(sum, variable.declaredSize, 'NetCDF record stride'),
          0,
        )
  validateDataRanges(source, variables, numRecords, recordStride, cursor.offset)
  return Object.freeze({
    format: 'netcdf-classic',
    version,
    numRecords,
    dimensions,
    variables,
    globalAttributes,
    recordStride,
    headerByteLength: cursor.offset,
    metadataBytesRead: counting.bytesRead,
    source,
    limits,
  })
}

const dimensionStrides = (variable: NetCdfVariable): readonly number[] => {
  const strides = new Array<number>(variable.dimensions.length).fill(1)
  let stride = 1
  for (let index = variable.dimensions.length - 1; index >= 0; index -= 1) {
    strides[index] = stride
    stride = checkedProduct(
      [stride, variable.dimensions[index]?.length ?? 0],
      Number.MAX_SAFE_INTEGER,
      `NetCDF variable ${variable.name} stride`,
    )
  }
  return Object.freeze(strides)
}

const elementOffset = (
  file: NetCdfClassicFile,
  variable: NetCdfVariable,
  indices: readonly number[],
  strides: readonly number[],
): number => {
  if (indices.length !== variable.dimensions.length) {
    throw invalidInput(`NetCDF variable ${variable.name} index rank is invalid`)
  }
  let linear = 0
  for (let index = variable.record ? 1 : 0; index < indices.length; index += 1) {
    const selected = indices[index]
    const dimension = variable.dimensions[index]
    if (
      selected === undefined ||
      dimension === undefined ||
      !Number.isSafeInteger(selected) ||
      selected < 0 ||
      selected >= dimension.length
    ) {
      throw invalidInput(`NetCDF variable ${variable.name} index is outside dimension ${index}`)
    }
    linear = checkedAdd(
      linear,
      selected * (strides[index] ?? 0),
      `NetCDF variable ${variable.name} element offset`,
    )
  }
  const within = linear * variable.elementBytes
  if (!variable.record) return checkedAdd(variable.dataOffset, within, 'NetCDF data offset')
  const record = indices[0]
  const recordDimension = variable.dimensions[0]
  if (
    record === undefined ||
    recordDimension === undefined ||
    !Number.isSafeInteger(record) ||
    record < 0 ||
    record >= recordDimension.length
  ) {
    throw invalidInput(`NetCDF variable ${variable.name} record index is invalid`)
  }
  return checkedAdd(
    checkedAdd(variable.dataOffset, record * file.recordStride, 'NetCDF record offset'),
    within,
    'NetCDF record element offset',
  )
}

const resolvedReadLimits = (value: Readonly<NetCdfVariableReadLimits>): NetCdfVariableReadLimits =>
  Object.freeze({
    maxBytes: positive(value.maxBytes, 0, 'NetCDF maxBytes'),
    maxValues: positive(value.maxValues, 0, 'NetCDF maxValues'),
    maxReadOperations: positive(value.maxReadOperations, 0, 'NetCDF maxReadOperations'),
  })

export const readNetCdfVariableValues = async (
  file: NetCdfClassicFile,
  variable: NetCdfVariable,
  limitsInput: Readonly<NetCdfVariableReadLimits>,
  signal?: AbortSignal,
): Promise<readonly number[]> => {
  throwIfAborted(signal)
  if (variable.sampleType === undefined) {
    throw unsupportedOperation(`NetCDF variable ${variable.name} is not numeric`)
  }
  const limits = resolvedReadLimits(limitsInput)
  if (variable.elementCount > limits.maxValues) {
    throw limitExceeded(`NetCDF variable ${variable.name} exceeds maxValues`)
  }
  const byteLength = variable.elementCount * variable.elementBytes
  if (!Number.isSafeInteger(byteLength) || byteLength > limits.maxBytes) {
    throw limitExceeded(`NetCDF variable ${variable.name} exceeds maxBytes`)
  }
  const strides = dimensionStrides(variable)
  const values: number[] = []
  const viewValue = (bytes: Uint8Array): number => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (variable.type === 'byte') return view.getInt8(0)
    if (variable.type === 'short') return view.getInt16(0, false)
    if (variable.type === 'int') return view.getInt32(0, false)
    if (variable.type === 'float') return view.getFloat32(0, false)
    if (variable.type === 'double') return view.getFloat64(0, false)
    throw unsupportedOperation(`NetCDF variable ${variable.name} is not numeric`)
  }
  if (!variable.record) {
    const bytes = await readExactly(file.source, variable.dataOffset, byteLength, {
      ...(signal === undefined ? {} : { signal }),
    })
    for (let offset = 0; offset < bytes.byteLength; offset += variable.elementBytes) {
      values.push(viewValue(bytes.subarray(offset, offset + variable.elementBytes)))
    }
    return Object.freeze(values)
  }
  if (file.numRecords > limits.maxReadOperations) {
    throw limitExceeded(`NetCDF variable ${variable.name} exceeds maxReadOperations`)
  }
  const innerCount = variable.recordElementCount ?? 0
  const indices = new Array<number>(variable.dimensions.length).fill(0)
  for (let record = 0; record < file.numRecords; record += 1) {
    throwIfAborted(signal)
    indices[0] = record
    const offset = elementOffset(file, variable, indices, strides)
    const bytes = await readExactly(file.source, offset, innerCount * variable.elementBytes, {
      ...(signal === undefined ? {} : { signal }),
    })
    for (let byte = 0; byte < bytes.byteLength; byte += variable.elementBytes) {
      values.push(viewValue(bytes.subarray(byte, byte + variable.elementBytes)))
    }
  }
  return Object.freeze(values)
}

export const readNetCdfVariableSection = async (
  file: NetCdfClassicFile,
  variable: NetCdfVariable,
  request: Readonly<NetCdfVariableSectionRequest>,
): Promise<Uint8Array> => {
  throwIfAborted(request.signal)
  if (variable.sampleType === undefined) {
    throw unsupportedOperation(`NetCDF variable ${variable.name} is not numeric`)
  }
  const limits = resolvedReadLimits(request.limits)
  const xIndex = variable.dimensionIds.indexOf(request.xDimensionId)
  const yIndex = variable.dimensionIds.indexOf(request.yDimensionId)
  if (xIndex < 0 || yIndex < 0 || xIndex === yIndex) {
    throw invalidInput(
      `NetCDF variable ${variable.name} lacks distinct selected X and Y dimensions`,
    )
  }
  const xDimension = variable.dimensions[xIndex]
  const yDimension = variable.dimensions[yIndex]
  if (
    xDimension === undefined ||
    yDimension === undefined ||
    !Number.isSafeInteger(request.x) ||
    !Number.isSafeInteger(request.y) ||
    !Number.isSafeInteger(request.width) ||
    !Number.isSafeInteger(request.height) ||
    request.x < 0 ||
    request.y < 0 ||
    request.width < 1 ||
    request.height < 1 ||
    request.x + request.width > xDimension.length ||
    request.y + request.height > yDimension.length
  ) {
    throw invalidInput(`NetCDF variable ${variable.name} section is outside its dimensions`)
  }
  const valueCount = request.width * request.height
  const outputBytes = valueCount * variable.elementBytes
  if (!Number.isSafeInteger(valueCount) || valueCount > limits.maxValues) {
    throw limitExceeded('NetCDF section exceeds maxValues')
  }
  if (!Number.isSafeInteger(outputBytes) || outputBytes > limits.maxBytes) {
    throw limitExceeded('NetCDF section exceeds maxBytes')
  }
  const indices = variable.dimensions.map((dimension) => {
    const fixed = request.fixedIndices.get(dimension.id)
    if (dimension.id === request.xDimensionId || dimension.id === request.yDimensionId) return 0
    if (
      fixed === undefined ||
      !Number.isSafeInteger(fixed) ||
      fixed < 0 ||
      fixed >= dimension.length
    ) {
      throw invalidInput(`NetCDF variable ${variable.name} requires an index for ${dimension.name}`)
    }
    return fixed
  })
  const strides = dimensionStrides(variable)
  const xStride = strides[xIndex] ?? 0
  const output = new Uint8Array(outputBytes)
  let reads = 0
  for (let row = 0; row < request.height; row += 1) {
    throwIfAborted(request.signal)
    indices[yIndex] = request.y + row
    indices[xIndex] = request.x
    if (xStride === 1) {
      reads += 1
      if (reads > limits.maxReadOperations)
        throw limitExceeded('NetCDF section exceeds maxReadOperations')
      const offset = elementOffset(file, variable, indices, strides)
      const bytes = await readExactly(file.source, offset, request.width * variable.elementBytes, {
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      output.set(bytes, row * request.width * variable.elementBytes)
      continue
    }
    for (let column = 0; column < request.width; column += 1) {
      indices[xIndex] = request.x + column
      reads += 1
      if (reads > limits.maxReadOperations)
        throw limitExceeded('NetCDF section exceeds maxReadOperations')
      const offset = elementOffset(file, variable, indices, strides)
      const bytes = await readExactly(file.source, offset, variable.elementBytes, {
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      })
      output.set(bytes, (row * request.width + column) * variable.elementBytes)
    }
  }
  return output
}

export const netCdfAttribute = (
  attributes: readonly NetCdfAttribute[],
  name: string,
): NetCdfAttribute | undefined => attributes.find((attribute) => attribute.name === name)

export const netCdfAttributeString = (
  attributes: readonly NetCdfAttribute[],
  name: string,
): string | undefined => {
  const values = netCdfAttribute(attributes, name)?.values
  return typeof values === 'string' ? values : undefined
}

export const netCdfAttributeNumbers = (
  attributes: readonly NetCdfAttribute[],
  name: string,
): readonly number[] | undefined => {
  const values = netCdfAttribute(attributes, name)?.values
  return typeof values === 'string' ? undefined : values
}
