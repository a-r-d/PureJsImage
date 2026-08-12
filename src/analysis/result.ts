import { invalidInput } from '../errors.ts'
import type { OperationJsonObject, OperationJsonValue } from '../operations/descriptor.ts'
import { normalizeOperationJsonObject } from '../operations/descriptor.ts'
import type { ValueTypeDefinition } from '../operations/registry.ts'
import {
  createValueTypeDefinition,
  createValueTypeRegistry,
  type ValueTypeRegistry,
} from '../operations/registry.ts'

export const scalarResultValueTypeId = 'purejsimage.result.scalar'
export const histogramResultValueTypeId = 'purejsimage.result.histogram'
export const profileResultValueTypeId = 'purejsimage.result.profile'
export const tableResultValueTypeId = 'purejsimage.result.table'
export const resultCollectionValueTypeId = 'purejsimage.result.collection'

export type ResultNaNPolicy = 'forbid' | 'allow'

export type ResultNumericArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array

export type HistogramCountArray = Uint32Array | Float64Array | BigUint64Array
export type ResultCategoryCodes = Uint8Array | Uint16Array | Uint32Array

export interface ResultProvenanceReference {
  readonly id: string
  readonly version?: number
}

interface AnalysisResultBase {
  readonly kind: 'scalar' | 'histogram' | 'profile' | 'table' | 'collection'
  readonly valueType: string
  readonly metadata?: OperationJsonObject
  readonly provenance?: ResultProvenanceReference
}

export interface ScalarResult extends AnalysisResultBase {
  readonly kind: 'scalar'
  readonly valueType: typeof scalarResultValueTypeId
  readonly value: number
  readonly uncertainty?: number
  readonly unit?: string
  readonly nanPolicy: ResultNaNPolicy
}

export interface HistogramResult extends AnalysisResultBase {
  readonly kind: 'histogram'
  readonly valueType: typeof histogramResultValueTypeId
  readonly binEdges: Float64Array
  readonly counts: HistogramCountArray
  readonly underflow: number | bigint
  readonly overflow: number | bigint
  readonly unit?: string
}

export interface ResultValidityBitmap {
  /** Least-significant bit first; one means valid. */
  readonly bits: Uint8Array
}

export interface ProfileAxis {
  readonly name: string
  readonly values: ResultNumericArray
  readonly unit?: string
  readonly nanPolicy: ResultNaNPolicy
}

export interface ProfileSeries {
  readonly name: string
  readonly values: ResultNumericArray
  readonly unit?: string
  readonly nanPolicy: ResultNaNPolicy
  readonly validity?: ResultValidityBitmap
}

export interface ProfileResult extends AnalysisResultBase {
  readonly kind: 'profile'
  readonly valueType: typeof profileResultValueTypeId
  readonly axis: ProfileAxis
  readonly series: readonly ProfileSeries[]
}

interface TableColumnBase {
  readonly name: string
  readonly validity?: ResultValidityBitmap
}

export interface NumericTableColumn extends TableColumnBase {
  readonly kind: 'numeric'
  readonly values: ResultNumericArray
  readonly unit?: string
  readonly nanPolicy: ResultNaNPolicy
}

export interface BooleanTableColumn extends TableColumnBase {
  readonly kind: 'boolean'
  /** Least-significant bit first. */
  readonly values: Uint8Array
}

export interface Utf8TableColumn extends TableColumnBase {
  readonly kind: 'string'
  /** Row `i` occupies `data[offsets[i]..offsets[i + 1])`. */
  readonly offsets: Uint32Array
  readonly data: Uint8Array
}

export interface CategoryTableColumn extends TableColumnBase {
  readonly kind: 'category'
  readonly codes: ResultCategoryCodes
  readonly categories: readonly string[]
}

export type TableColumn =
  | NumericTableColumn
  | BooleanTableColumn
  | Utf8TableColumn
  | CategoryTableColumn

export interface TableResult extends AnalysisResultBase {
  readonly kind: 'table'
  readonly valueType: typeof tableResultValueTypeId
  readonly rowCount: number
  readonly columns: readonly TableColumn[]
}

export interface ResultCollectionEntry {
  readonly name: string
  readonly result: AnalysisResult
}

export interface ResultCollection extends AnalysisResultBase {
  readonly kind: 'collection'
  readonly valueType: typeof resultCollectionValueTypeId
  readonly results: readonly ResultCollectionEntry[]
}

export type AnalysisResult =
  | ScalarResult
  | HistogramResult
  | ProfileResult
  | TableResult
  | ResultCollection

export interface AnalysisResultLimits {
  readonly maxRows?: number
  readonly maxColumns?: number
  readonly maxProfilePoints?: number
  readonly maxProfileSeries?: number
  readonly maxHistogramBins?: number
  readonly maxCollectionEntries?: number
  readonly maxCollectionDepth?: number
  readonly maxTotalResults?: number
  readonly maxCategories?: number
  readonly maxStringBytes?: number
  readonly maxStringBytesPerValue?: number
  readonly maxMetadataBytes?: number
  readonly maxMetadataValues?: number
  readonly maxRetainedBytes?: number
}

export interface ResolvedAnalysisResultLimits {
  readonly maxRows: number
  readonly maxColumns: number
  readonly maxProfilePoints: number
  readonly maxProfileSeries: number
  readonly maxHistogramBins: number
  readonly maxCollectionEntries: number
  readonly maxCollectionDepth: number
  readonly maxTotalResults: number
  readonly maxCategories: number
  readonly maxStringBytes: number
  readonly maxStringBytesPerValue: number
  readonly maxMetadataBytes: number
  readonly maxMetadataValues: number
  readonly maxRetainedBytes: number
}

export const defaultAnalysisResultLimits: ResolvedAnalysisResultLimits = Object.freeze({
  maxRows: 10_000_000,
  maxColumns: 256,
  maxProfilePoints: 10_000_000,
  maxProfileSeries: 64,
  maxHistogramBins: 65_536,
  maxCollectionEntries: 64,
  maxCollectionDepth: 8,
  maxTotalResults: 4_096,
  maxCategories: 65_536,
  maxStringBytes: 64 * 1_024 * 1_024,
  maxStringBytesPerValue: 64 * 1_024,
  maxMetadataBytes: 64 * 1_024,
  maxMetadataValues: 4_096,
  maxRetainedBytes: 256 * 1_024 * 1_024,
})

const positiveLimit = (value: number | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

export const resolveAnalysisResultLimits = (
  limits: Readonly<AnalysisResultLimits> = {},
): ResolvedAnalysisResultLimits =>
  Object.freeze({
    maxRows: positiveLimit(limits.maxRows, defaultAnalysisResultLimits.maxRows, 'maxRows'),
    maxColumns: positiveLimit(
      limits.maxColumns,
      defaultAnalysisResultLimits.maxColumns,
      'maxColumns',
    ),
    maxProfilePoints: positiveLimit(
      limits.maxProfilePoints,
      defaultAnalysisResultLimits.maxProfilePoints,
      'maxProfilePoints',
    ),
    maxProfileSeries: positiveLimit(
      limits.maxProfileSeries,
      defaultAnalysisResultLimits.maxProfileSeries,
      'maxProfileSeries',
    ),
    maxHistogramBins: positiveLimit(
      limits.maxHistogramBins,
      defaultAnalysisResultLimits.maxHistogramBins,
      'maxHistogramBins',
    ),
    maxCollectionEntries: positiveLimit(
      limits.maxCollectionEntries,
      defaultAnalysisResultLimits.maxCollectionEntries,
      'maxCollectionEntries',
    ),
    maxCollectionDepth: positiveLimit(
      limits.maxCollectionDepth,
      defaultAnalysisResultLimits.maxCollectionDepth,
      'maxCollectionDepth',
    ),
    maxTotalResults: positiveLimit(
      limits.maxTotalResults,
      defaultAnalysisResultLimits.maxTotalResults,
      'maxTotalResults',
    ),
    maxCategories: positiveLimit(
      limits.maxCategories,
      defaultAnalysisResultLimits.maxCategories,
      'maxCategories',
    ),
    maxStringBytes: positiveLimit(
      limits.maxStringBytes,
      defaultAnalysisResultLimits.maxStringBytes,
      'maxStringBytes',
    ),
    maxStringBytesPerValue: positiveLimit(
      limits.maxStringBytesPerValue,
      defaultAnalysisResultLimits.maxStringBytesPerValue,
      'maxStringBytesPerValue',
    ),
    maxMetadataBytes: positiveLimit(
      limits.maxMetadataBytes,
      defaultAnalysisResultLimits.maxMetadataBytes,
      'maxMetadataBytes',
    ),
    maxMetadataValues: positiveLimit(
      limits.maxMetadataValues,
      defaultAnalysisResultLimits.maxMetadataValues,
      'maxMetadataValues',
    ),
    maxRetainedBytes: positiveLimit(
      limits.maxRetainedBytes,
      defaultAnalysisResultLimits.maxRetainedBytes,
      'maxRetainedBytes',
    ),
  })

type UnknownRecord = Readonly<Record<string, unknown>>

const isUnknownRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const record = (value: unknown, label: string): UnknownRecord => {
  if (!isUnknownRecord(value)) {
    throw invalidInput(`${label} must be an object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidInput(`${label} must be a plain object`)
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw invalidInput(`${label} must not contain symbol keys`)
  }
  for (const key of Object.keys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (property === undefined || !('value' in property)) {
      throw invalidInput(`${label}.${key} must be a data property`)
    }
  }
  return value
}

const exactFields = (value: UnknownRecord, allowed: readonly string[], label: string): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw invalidInput(`${label} contains unknown property ${key}`)
  }
}

const nonEmptyString = (value: unknown, label: string, maximum = 256): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum) {
    throw invalidInput(`${label} must be a non-empty string of at most ${maximum} characters`)
  }
  return value
}

const unitValue = (value: unknown, label: string): string | undefined =>
  value === undefined ? undefined : nonEmptyString(value, label, 256)

const safeCount = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`${label} must be a non-negative safe integer`)
  }
  return value
}

const nanPolicyValue = (value: unknown, label: string): ResultNaNPolicy => {
  if (value === undefined || value === 'forbid') return 'forbid'
  if (value === 'allow') return 'allow'
  throw invalidInput(`${label} must be forbid or allow`)
}

const numericArray = (value: unknown, label: string): ResultNumericArray => {
  if (
    value instanceof Int8Array ||
    value instanceof Uint8Array ||
    value instanceof Uint8ClampedArray ||
    value instanceof Int16Array ||
    value instanceof Uint16Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof BigInt64Array ||
    value instanceof BigUint64Array
  ) {
    return value
  }
  throw invalidInput(`${label} must be a supported numeric TypedArray`)
}

const histogramCounts = (value: unknown, label: string): HistogramCountArray => {
  if (
    value instanceof Uint32Array ||
    value instanceof Float64Array ||
    value instanceof BigUint64Array
  ) {
    return value
  }
  throw invalidInput(`${label} must be Uint32Array, Float64Array, or BigUint64Array`)
}

const categoryCodes = (value: unknown, label: string): ResultCategoryCodes => {
  if (value instanceof Uint8Array || value instanceof Uint16Array || value instanceof Uint32Array) {
    return value
  }
  throw invalidInput(`${label} must be Uint8Array, Uint16Array, or Uint32Array`)
}

const validateNumericValues = (
  values: ResultNumericArray,
  policy: ResultNaNPolicy,
  validity: ResultValidityBitmap | undefined,
  label: string,
): void => {
  if (values instanceof BigInt64Array || values instanceof BigUint64Array) return
  for (let index = 0; index < values.length; index += 1) {
    if (validity !== undefined && !bitmapValue(validity.bits, index)) continue
    const value = values[index]
    if (value === undefined || !Number.isFinite(value)) {
      if (Number.isNaN(value) && policy === 'allow') continue
      throw invalidInput(`${label}[${index}] violates its finite/NaN policy`)
    }
  }
}

const normalizeMetadata = (
  value: unknown,
  limits: ResolvedAnalysisResultLimits,
): OperationJsonObject | undefined => {
  if (value === undefined) return undefined
  const metadata = normalizeOperationJsonObject(value, {
    maxDepth: 32,
    maxObjectKeys: limits.maxMetadataValues,
    maxArrayLength: limits.maxMetadataValues,
    maxInspectedValues: limits.maxMetadataValues,
  })
  if (new TextEncoder().encode(JSON.stringify(metadata)).byteLength > limits.maxMetadataBytes) {
    throw invalidInput('Result metadata exceeds maxMetadataBytes')
  }
  return metadata
}

const normalizeProvenance = (value: unknown): ResultProvenanceReference | undefined => {
  if (value === undefined) return undefined
  const input = record(value, 'Result provenance')
  exactFields(input, ['id', 'version'], 'Result provenance')
  const id = nonEmptyString(input.id, 'Result provenance id', 512)
  const version =
    input.version === undefined ? undefined : safeCount(input.version, 'Result provenance version')
  if (version === 0) throw invalidInput('Result provenance version must be positive')
  return Object.freeze({ id, ...(version === undefined ? {} : { version }) })
}

const commonResult = (
  input: UnknownRecord,
  expectedKind: AnalysisResult['kind'],
  expectedValueType: AnalysisResult['valueType'],
  limits: ResolvedAnalysisResultLimits,
): {
  readonly metadata?: OperationJsonObject
  readonly provenance?: ResultProvenanceReference
} => {
  if (input.kind !== expectedKind) throw invalidInput(`Result kind must be ${expectedKind}`)
  if (input.valueType !== expectedValueType) {
    throw invalidInput(`Result valueType must be ${expectedValueType}`)
  }
  const metadata = normalizeMetadata(input.metadata, limits)
  const provenance = normalizeProvenance(input.provenance)
  return Object.freeze({
    ...(metadata === undefined ? {} : { metadata }),
    ...(provenance === undefined ? {} : { provenance }),
  })
}

const normalizeValidity = (
  value: unknown,
  length: number,
  label: string,
): ResultValidityBitmap | undefined => {
  if (value === undefined) return undefined
  const input = record(value, label)
  exactFields(input, ['bits'], label)
  if (!(input.bits instanceof Uint8Array)) throw invalidInput(`${label}.bits must be Uint8Array`)
  const expectedBytes = Math.ceil(length / 8)
  if (input.bits.byteLength !== expectedBytes) {
    throw invalidInput(`${label}.bits must contain exactly ${expectedBytes} bytes`)
  }
  const remainder = length % 8
  const last = input.bits[input.bits.length - 1]
  if (remainder !== 0 && last !== undefined && last >> remainder !== 0) {
    throw invalidInput(`${label}.bits has non-zero padding bits`)
  }
  return Object.freeze({ bits: input.bits })
}

const bitmapValue = (bits: Uint8Array, index: number): boolean =>
  ((bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0

const validateUtf8Range = (data: Uint8Array, start: number, end: number, label: string): void => {
  let index = start
  while (index < end) {
    const first = data[index]
    if (first === undefined) throw invalidInput(`${label} is truncated`)
    if (first <= 0x7f) {
      index += 1
      continue
    }
    let continuationBytes: number
    let minimumSecond = 0x80
    let maximumSecond = 0xbf
    if (first >= 0xc2 && first <= 0xdf) continuationBytes = 1
    else if (first >= 0xe0 && first <= 0xef) {
      continuationBytes = 2
      if (first === 0xe0) minimumSecond = 0xa0
      if (first === 0xed) maximumSecond = 0x9f
    } else if (first >= 0xf0 && first <= 0xf4) {
      continuationBytes = 3
      if (first === 0xf0) minimumSecond = 0x90
      if (first === 0xf4) maximumSecond = 0x8f
    } else throw invalidInput(`${label} contains invalid UTF-8`)
    if (index + continuationBytes >= end) throw invalidInput(`${label} contains truncated UTF-8`)
    const second = data[index + 1]
    if (second === undefined || second < minimumSecond || second > maximumSecond) {
      throw invalidInput(`${label} contains invalid UTF-8`)
    }
    for (let offset = 2; offset <= continuationBytes; offset += 1) {
      const byte = data[index + offset]
      if (byte === undefined || byte < 0x80 || byte > 0xbf) {
        throw invalidInput(`${label} contains invalid UTF-8`)
      }
    }
    index += continuationBytes + 1
  }
}

const normalizeScalar = (
  input: UnknownRecord,
  limits: ResolvedAnalysisResultLimits,
): ScalarResult => {
  exactFields(
    input,
    ['kind', 'valueType', 'value', 'uncertainty', 'unit', 'nanPolicy', 'metadata', 'provenance'],
    'Scalar result',
  )
  const common = commonResult(input, 'scalar', scalarResultValueTypeId, limits)
  const nanPolicy = nanPolicyValue(input.nanPolicy, 'Scalar nanPolicy')
  if (typeof input.value !== 'number' || !Number.isFinite(input.value)) {
    if (!(typeof input.value === 'number' && Number.isNaN(input.value) && nanPolicy === 'allow')) {
      throw invalidInput('Scalar value violates its finite/NaN policy')
    }
  }
  if (
    input.uncertainty !== undefined &&
    (typeof input.uncertainty !== 'number' ||
      !Number.isFinite(input.uncertainty) ||
      input.uncertainty < 0)
  ) {
    throw invalidInput('Scalar uncertainty must be finite and non-negative')
  }
  const unit = unitValue(input.unit, 'Scalar unit')
  return Object.freeze({
    kind: 'scalar',
    valueType: scalarResultValueTypeId,
    value: input.value,
    nanPolicy,
    ...(input.uncertainty === undefined ? {} : { uncertainty: input.uncertainty }),
    ...(unit === undefined ? {} : { unit }),
    ...common,
  })
}

const nonNegativeCount = (value: unknown, label: string): number | bigint => {
  if (typeof value === 'bigint') {
    if (value < 0n) throw invalidInput(`${label} must be non-negative`)
    return value
  }
  return safeCount(value, label)
}

const normalizeHistogram = (
  input: UnknownRecord,
  limits: ResolvedAnalysisResultLimits,
): HistogramResult => {
  exactFields(
    input,
    [
      'kind',
      'valueType',
      'binEdges',
      'counts',
      'underflow',
      'overflow',
      'unit',
      'metadata',
      'provenance',
    ],
    'Histogram result',
  )
  const common = commonResult(input, 'histogram', histogramResultValueTypeId, limits)
  if (!(input.binEdges instanceof Float64Array)) {
    throw invalidInput('Histogram binEdges must be Float64Array')
  }
  const counts = histogramCounts(input.counts, 'Histogram counts')
  if (counts.length < 1 || counts.length > limits.maxHistogramBins) {
    throw invalidInput('Histogram counts length is outside configured limits')
  }
  if (input.binEdges.length !== counts.length + 1) {
    throw invalidInput('Histogram binEdges length must equal counts length plus one')
  }
  for (let index = 0; index < input.binEdges.length; index += 1) {
    const edge = input.binEdges[index]
    if (edge === undefined || !Number.isFinite(edge)) {
      throw invalidInput(`Histogram binEdges[${index}] must be finite`)
    }
    if (index > 0 && edge <= (input.binEdges[index - 1] ?? edge)) {
      throw invalidInput('Histogram binEdges must be strictly increasing')
    }
  }
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index]
    if (typeof count === 'bigint') continue
    if (count === undefined || !Number.isSafeInteger(count) || count < 0) {
      throw invalidInput(`Histogram counts[${index}] must be a non-negative safe integer`)
    }
  }
  const underflow = nonNegativeCount(input.underflow, 'Histogram underflow')
  const overflow = nonNegativeCount(input.overflow, 'Histogram overflow')
  const unit = unitValue(input.unit, 'Histogram unit')
  return Object.freeze({
    kind: 'histogram',
    valueType: histogramResultValueTypeId,
    binEdges: input.binEdges,
    counts,
    underflow,
    overflow,
    ...(unit === undefined ? {} : { unit }),
    ...common,
  })
}

const normalizeProfile = (
  input: UnknownRecord,
  limits: ResolvedAnalysisResultLimits,
): ProfileResult => {
  exactFields(
    input,
    ['kind', 'valueType', 'axis', 'series', 'metadata', 'provenance'],
    'Profile result',
  )
  const common = commonResult(input, 'profile', profileResultValueTypeId, limits)
  const axisInput = record(input.axis, 'Profile axis')
  exactFields(axisInput, ['name', 'values', 'unit', 'nanPolicy'], 'Profile axis')
  const axisValues = numericArray(axisInput.values, 'Profile axis values')
  if (axisValues.length > limits.maxProfilePoints) {
    throw invalidInput('Profile axis exceeds maxProfilePoints')
  }
  const axisPolicy = nanPolicyValue(axisInput.nanPolicy, 'Profile axis nanPolicy')
  validateNumericValues(axisValues, axisPolicy, undefined, 'Profile axis values')
  const axisUnit = unitValue(axisInput.unit, 'Profile axis unit')
  const axis: ProfileAxis = Object.freeze({
    name: nonEmptyString(axisInput.name, 'Profile axis name'),
    values: axisValues,
    nanPolicy: axisPolicy,
    ...(axisUnit === undefined ? {} : { unit: axisUnit }),
  })
  if (
    !Array.isArray(input.series) ||
    input.series.length < 1 ||
    input.series.length > limits.maxProfileSeries
  ) {
    throw invalidInput('Profile series must be a non-empty bounded array')
  }
  const names = new Set<string>()
  const series: ProfileSeries[] = []
  for (let index = 0; index < input.series.length; index += 1) {
    const seriesInput = record(input.series[index], `Profile series[${index}]`)
    exactFields(
      seriesInput,
      ['name', 'values', 'unit', 'nanPolicy', 'validity'],
      `Profile series[${index}]`,
    )
    const name = nonEmptyString(seriesInput.name, `Profile series[${index}].name`)
    if (names.has(name)) throw invalidInput(`Profile series name is duplicated: ${name}`)
    names.add(name)
    const values = numericArray(seriesInput.values, `Profile series[${index}].values`)
    if (values.length !== axisValues.length)
      throw invalidInput(`Profile series ${name} length does not match its axis`)
    const validity = normalizeValidity(
      seriesInput.validity,
      values.length,
      `Profile series ${name} validity`,
    )
    const nanPolicy = nanPolicyValue(seriesInput.nanPolicy, `Profile series ${name} nanPolicy`)
    validateNumericValues(values, nanPolicy, validity, `Profile series ${name}`)
    const unit = unitValue(seriesInput.unit, `Profile series ${name} unit`)
    series.push(
      Object.freeze({
        name,
        values,
        nanPolicy,
        ...(unit === undefined ? {} : { unit }),
        ...(validity === undefined ? {} : { validity }),
      }),
    )
  }
  return Object.freeze({
    kind: 'profile',
    valueType: profileResultValueTypeId,
    axis,
    series: Object.freeze(series),
    ...common,
  })
}

const normalizeTableColumn = (
  value: unknown,
  rowCount: number,
  index: number,
  limits: ResolvedAnalysisResultLimits,
): TableColumn => {
  const input = record(value, `Table column[${index}]`)
  const name = nonEmptyString(input.name, `Table column[${index}].name`)
  const kind = input.kind
  if (kind === 'numeric') {
    exactFields(
      input,
      ['kind', 'name', 'values', 'unit', 'nanPolicy', 'validity'],
      `Table column ${name}`,
    )
    const values = numericArray(input.values, `Table column ${name}.values`)
    if (values.length !== rowCount)
      throw invalidInput(`Table column ${name} length does not match rowCount`)
    const validity = normalizeValidity(input.validity, rowCount, `Table column ${name} validity`)
    const nanPolicy = nanPolicyValue(input.nanPolicy, `Table column ${name} nanPolicy`)
    validateNumericValues(values, nanPolicy, validity, `Table column ${name}`)
    const unit = unitValue(input.unit, `Table column ${name} unit`)
    return Object.freeze({
      kind,
      name,
      values,
      nanPolicy,
      ...(unit === undefined ? {} : { unit }),
      ...(validity === undefined ? {} : { validity }),
    })
  }
  if (kind === 'boolean') {
    exactFields(input, ['kind', 'name', 'values', 'validity'], `Table column ${name}`)
    if (!(input.values instanceof Uint8Array))
      throw invalidInput(`Table column ${name}.values must be Uint8Array`)
    const values = normalizeValidity(
      { bits: input.values },
      rowCount,
      `Table column ${name} values`,
    )
    const validity = normalizeValidity(input.validity, rowCount, `Table column ${name} validity`)
    return Object.freeze({
      kind,
      name,
      values: values?.bits ?? input.values,
      ...(validity === undefined ? {} : { validity }),
    })
  }
  if (kind === 'string') {
    exactFields(input, ['kind', 'name', 'offsets', 'data', 'validity'], `Table column ${name}`)
    if (!(input.offsets instanceof Uint32Array) || !(input.data instanceof Uint8Array)) {
      throw invalidInput(`Table column ${name} requires Uint32Array offsets and Uint8Array data`)
    }
    if (input.offsets.length !== rowCount + 1 || (input.offsets[0] ?? 1) !== 0) {
      throw invalidInput(
        `Table column ${name} offsets must contain rowCount + 1 entries starting at zero`,
      )
    }
    if (input.data.byteLength > limits.maxStringBytes)
      throw invalidInput(`Table column ${name} exceeds maxStringBytes`)
    for (let row = 0; row < rowCount; row += 1) {
      const start = input.offsets[row]
      const end = input.offsets[row + 1]
      if (start === undefined || end === undefined || end < start || end > input.data.byteLength) {
        throw invalidInput(`Table column ${name} has invalid offset at row ${row}`)
      }
      if (end - start > limits.maxStringBytesPerValue)
        throw invalidInput(`Table column ${name} row ${row} exceeds maxStringBytesPerValue`)
      validateUtf8Range(input.data, start, end, `Table column ${name} row ${row}`)
    }
    if ((input.offsets[rowCount] ?? 0) !== input.data.byteLength) {
      throw invalidInput(`Table column ${name} final offset must equal its UTF-8 data length`)
    }
    const validity = normalizeValidity(input.validity, rowCount, `Table column ${name} validity`)
    return Object.freeze({
      kind,
      name,
      offsets: input.offsets,
      data: input.data,
      ...(validity === undefined ? {} : { validity }),
    })
  }
  if (kind === 'category') {
    exactFields(input, ['kind', 'name', 'codes', 'categories', 'validity'], `Table column ${name}`)
    const codes = categoryCodes(input.codes, `Table column ${name}.codes`)
    if (codes.length !== rowCount)
      throw invalidInput(`Table column ${name} codes length does not match rowCount`)
    if (
      !Array.isArray(input.categories) ||
      input.categories.length < 1 ||
      input.categories.length > limits.maxCategories
    ) {
      throw invalidInput(`Table column ${name} categories must be a non-empty bounded array`)
    }
    const categories: string[] = []
    const categorySet = new Set<string>()
    let categoryBytes = 0
    const encoder = new TextEncoder()
    for (let category = 0; category < input.categories.length; category += 1) {
      const label = nonEmptyString(
        input.categories[category],
        `Table column ${name} category[${category}]`,
        limits.maxStringBytesPerValue,
      )
      if (categorySet.has(label))
        throw invalidInput(`Table column ${name} category ${label} is duplicated`)
      categorySet.add(label)
      const labelBytes = encoder.encode(label).byteLength
      if (labelBytes > limits.maxStringBytesPerValue) {
        throw invalidInput(
          `Table column ${name} category[${category}] exceeds maxStringBytesPerValue`,
        )
      }
      categoryBytes += labelBytes
      if (categoryBytes > limits.maxStringBytes)
        throw invalidInput(`Table column ${name} categories exceed maxStringBytes`)
      categories.push(label)
    }
    const validity = normalizeValidity(input.validity, rowCount, `Table column ${name} validity`)
    for (let row = 0; row < codes.length; row += 1) {
      if (validity !== undefined && !bitmapValue(validity.bits, row)) continue
      if ((codes[row] ?? categories.length) >= categories.length)
        throw invalidInput(`Table column ${name} code at row ${row} is outside its dictionary`)
    }
    return Object.freeze({
      kind,
      name,
      codes,
      categories: Object.freeze(categories),
      ...(validity === undefined ? {} : { validity }),
    })
  }
  throw invalidInput(`Table column ${name} has an unknown kind`)
}

const normalizeTable = (
  input: UnknownRecord,
  limits: ResolvedAnalysisResultLimits,
): TableResult => {
  exactFields(
    input,
    ['kind', 'valueType', 'rowCount', 'columns', 'metadata', 'provenance'],
    'Table result',
  )
  const common = commonResult(input, 'table', tableResultValueTypeId, limits)
  const rowCount = safeCount(input.rowCount, 'Table rowCount')
  if (rowCount > limits.maxRows) throw invalidInput('Table rowCount exceeds maxRows')
  if (!Array.isArray(input.columns) || input.columns.length > limits.maxColumns) {
    throw invalidInput('Table columns must be a bounded array')
  }
  const names = new Set<string>()
  const columns = input.columns.map((column, index) => {
    const normalized = normalizeTableColumn(column, rowCount, index, limits)
    if (names.has(normalized.name))
      throw invalidInput(`Table column name is duplicated: ${normalized.name}`)
    names.add(normalized.name)
    return normalized
  })
  return Object.freeze({
    kind: 'table',
    valueType: tableResultValueTypeId,
    rowCount,
    columns: Object.freeze(columns),
    ...common,
  })
}

const normalizeCollection = (
  input: UnknownRecord,
  limits: ResolvedAnalysisResultLimits,
  state: NormalizationState,
  depth: number,
): ResultCollection => {
  exactFields(
    input,
    ['kind', 'valueType', 'results', 'metadata', 'provenance'],
    'Result collection',
  )
  const common = commonResult(input, 'collection', resultCollectionValueTypeId, limits)
  if (!Array.isArray(input.results) || input.results.length > limits.maxCollectionEntries) {
    throw invalidInput('Result collection entries must be a bounded array')
  }
  const names = new Set<string>()
  const results: ResultCollectionEntry[] = []
  for (let index = 0; index < input.results.length; index += 1) {
    const entry = record(input.results[index], `Result collection entry[${index}]`)
    exactFields(entry, ['name', 'result'], `Result collection entry[${index}]`)
    const name = nonEmptyString(entry.name, `Result collection entry[${index}].name`)
    if (names.has(name)) throw invalidInput(`Result collection name is duplicated: ${name}`)
    names.add(name)
    results.push(
      Object.freeze({
        name,
        result: normalizeInternal(entry.result, limits, state, depth + 1),
      }),
    )
  }
  return Object.freeze({
    kind: 'collection',
    valueType: resultCollectionValueTypeId,
    results: Object.freeze(results),
    ...common,
  })
}

interface NormalizationState {
  readonly ancestors: Set<object>
  results: number
}

const normalizeInternal = (
  value: unknown,
  limits: ResolvedAnalysisResultLimits,
  state: NormalizationState,
  depth: number,
): AnalysisResult => {
  if (depth > limits.maxCollectionDepth)
    throw invalidInput('Result collection exceeds maxCollectionDepth')
  const input = record(value, 'Analysis result')
  state.results += 1
  if (state.results > limits.maxTotalResults) {
    throw invalidInput('Analysis result exceeds maxTotalResults')
  }
  if (state.ancestors.has(input)) throw invalidInput('Analysis result contains a cycle')
  state.ancestors.add(input)
  try {
    if (input.kind === 'scalar') return normalizeScalar(input, limits)
    if (input.kind === 'histogram') return normalizeHistogram(input, limits)
    if (input.kind === 'profile') return normalizeProfile(input, limits)
    if (input.kind === 'table') return normalizeTable(input, limits)
    if (input.kind === 'collection') return normalizeCollection(input, limits, state, depth)
    throw invalidInput('Analysis result kind is invalid')
  } finally {
    state.ancestors.delete(input)
  }
}

export interface ResultMemoryAccounting extends OperationJsonObject {
  readonly payloadBytes: number
  readonly structuralBytes: number
  readonly retainedBytes: number
}

interface MemoryState {
  readonly buffers: Set<ArrayBufferLike>
  payloadBytes: number
  structuralBytes: number
}

const addBuffer = (
  state: MemoryState,
  array: ResultNumericArray | Uint8Array | Uint32Array,
): void => {
  if (state.buffers.has(array.buffer)) return
  state.buffers.add(array.buffer)
  state.payloadBytes += array.buffer.byteLength
}

const addString = (state: MemoryState, value: string | undefined): void => {
  if (value !== undefined) state.structuralBytes += new TextEncoder().encode(value).byteLength
}

const accountResult = (result: AnalysisResult, state: MemoryState): void => {
  state.structuralBytes += new TextEncoder().encode(
    JSON.stringify(result.metadata ?? {}),
  ).byteLength
  addString(state, result.provenance?.id)
  if (result.kind === 'scalar') {
    addString(state, result.unit)
    return
  }
  if (result.kind === 'histogram') {
    addBuffer(state, result.binEdges)
    addBuffer(state, result.counts)
    addString(state, result.unit)
    return
  }
  if (result.kind === 'profile') {
    addString(state, result.axis.name)
    addString(state, result.axis.unit)
    addBuffer(state, result.axis.values)
    for (const series of result.series) {
      addString(state, series.name)
      addString(state, series.unit)
      addBuffer(state, series.values)
      if (series.validity !== undefined) addBuffer(state, series.validity.bits)
    }
    return
  }
  if (result.kind === 'table') {
    for (const column of result.columns) {
      addString(state, column.name)
      if (column.validity !== undefined) addBuffer(state, column.validity.bits)
      if (column.kind === 'numeric') {
        addString(state, column.unit)
        addBuffer(state, column.values)
      } else if (column.kind === 'boolean') addBuffer(state, column.values)
      else if (column.kind === 'string') {
        addBuffer(state, column.offsets)
        addBuffer(state, column.data)
      } else {
        addBuffer(state, column.codes)
        for (const category of column.categories) addString(state, category)
      }
    }
    return
  }
  for (const entry of result.results) {
    addString(state, entry.name)
    accountResult(entry.result, state)
  }
}

export const accountAnalysisResultMemory = (result: AnalysisResult): ResultMemoryAccounting => {
  const state: MemoryState = {
    buffers: new Set<ArrayBufferLike>(),
    payloadBytes: 0,
    structuralBytes: 0,
  }
  accountResult(result, state)
  return Object.freeze({
    payloadBytes: state.payloadBytes,
    structuralBytes: state.structuralBytes,
    retainedBytes: state.payloadBytes + state.structuralBytes,
  })
}

export const validateAnalysisResult = (
  input: unknown,
  limits: Readonly<AnalysisResultLimits> = {},
): AnalysisResult => {
  const resolved = resolveAnalysisResultLimits(limits)
  const result = normalizeInternal(input, resolved, { ancestors: new Set<object>(), results: 0 }, 0)
  const memory = accountAnalysisResultMemory(result)
  if (memory.retainedBytes > resolved.maxRetainedBytes) {
    throw invalidInput('Analysis result exceeds maxRetainedBytes')
  }
  return result
}

export const validateScalarResult = (
  input: unknown,
  limits: Readonly<AnalysisResultLimits> = {},
): ScalarResult => {
  const result = validateAnalysisResult(input, limits)
  if (result.kind !== 'scalar') throw invalidInput('Expected a scalar result')
  return result
}

export const validateHistogramResult = (
  input: unknown,
  limits: Readonly<AnalysisResultLimits> = {},
): HistogramResult => {
  const result = validateAnalysisResult(input, limits)
  if (result.kind !== 'histogram') throw invalidInput('Expected a histogram result')
  return result
}

export const validateProfileResult = (
  input: unknown,
  limits: Readonly<AnalysisResultLimits> = {},
): ProfileResult => {
  const result = validateAnalysisResult(input, limits)
  if (result.kind !== 'profile') throw invalidInput('Expected a profile result')
  return result
}

export const validateTableResult = (
  input: unknown,
  limits: Readonly<AnalysisResultLimits> = {},
): TableResult => {
  const result = validateAnalysisResult(input, limits)
  if (result.kind !== 'table') throw invalidInput('Expected a table result')
  return result
}

export const validateResultCollection = (
  input: unknown,
  limits: Readonly<AnalysisResultLimits> = {},
): ResultCollection => {
  const result = validateAnalysisResult(input, limits)
  if (result.kind !== 'collection') throw invalidInput('Expected a result collection')
  return result
}

export interface ResultSummaryOptions {
  readonly maxPreviewValues?: number
}

export interface AnalysisResultSummary extends OperationJsonObject {
  readonly kind: AnalysisResult['kind']
  readonly valueType: AnalysisResult['valueType']
  readonly schema: OperationJsonObject
  readonly units: readonly string[]
  readonly dimensions: OperationJsonObject
  readonly finiteRanges: OperationJsonObject
  readonly preview: OperationJsonValue
  readonly memory: ResultMemoryAccounting
  readonly metadata: OperationJsonObject | null
  readonly provenance: OperationJsonObject | null
}

interface RangeScanSummary extends OperationJsonObject {
  readonly minimum?: number | string
  readonly maximum?: number | string
  readonly finiteValues: number
  readonly nanValues: number
  readonly invalidValues: number
}

const arrayType = (values: ResultNumericArray): string => values.constructor.name

const previewValue = (value: number | bigint | undefined): OperationJsonValue =>
  typeof value === 'bigint'
    ? value.toString()
    : value === undefined
      ? null
      : Number.isFinite(value)
        ? value
        : 'NaN'

const summarizeNumeric = (
  values: ResultNumericArray,
  validity?: ResultValidityBitmap,
): RangeScanSummary => {
  let numberMinimum = Number.POSITIVE_INFINITY
  let numberMaximum = Number.NEGATIVE_INFINITY
  let bigintMinimum: bigint | undefined
  let bigintMaximum: bigint | undefined
  let finiteValues = 0
  let nanValues = 0
  let invalidValues = 0
  for (let index = 0; index < values.length; index += 1) {
    if (validity !== undefined && !bitmapValue(validity.bits, index)) {
      invalidValues += 1
      continue
    }
    const value = values[index]
    if (typeof value === 'bigint') {
      bigintMinimum = bigintMinimum === undefined || value < bigintMinimum ? value : bigintMinimum
      bigintMaximum = bigintMaximum === undefined || value > bigintMaximum ? value : bigintMaximum
      finiteValues += 1
    } else if (value !== undefined && Number.isFinite(value)) {
      numberMinimum = Math.min(numberMinimum, value)
      numberMaximum = Math.max(numberMaximum, value)
      finiteValues += 1
    } else nanValues += 1
  }
  return Object.freeze({
    ...(bigintMinimum === undefined && numberMinimum === Number.POSITIVE_INFINITY
      ? {}
      : { minimum: bigintMinimum?.toString() ?? numberMinimum }),
    ...(bigintMaximum === undefined && numberMaximum === Number.NEGATIVE_INFINITY
      ? {}
      : { maximum: bigintMaximum?.toString() ?? numberMaximum }),
    finiteValues,
    nanValues,
    invalidValues,
  })
}

const previewNumeric = (
  values: ResultNumericArray,
  maximum: number,
  validity?: ResultValidityBitmap,
): readonly OperationJsonValue[] => {
  const output: OperationJsonValue[] = []
  const length = Math.min(values.length, maximum)
  for (let index = 0; index < length; index += 1) {
    output.push(
      validity !== undefined && !bitmapValue(validity.bits, index)
        ? null
        : previewValue(values[index]),
    )
  }
  return Object.freeze(output)
}

const unitList = (units: readonly (string | undefined)[]): readonly string[] =>
  Object.freeze([...new Set(units.filter((unit): unit is string => unit !== undefined))])

const summarizeValidated = (result: AnalysisResult, maximum: number): AnalysisResultSummary => {
  const common = {
    kind: result.kind,
    valueType: result.valueType,
    memory: accountAnalysisResultMemory(result),
    metadata: result.metadata ?? null,
    provenance: result.provenance === undefined ? null : Object.freeze({ ...result.provenance }),
  }
  if (result.kind === 'scalar') {
    return Object.freeze({
      ...common,
      schema: Object.freeze({ value: 'number', nanPolicy: result.nanPolicy }),
      units: unitList([result.unit]),
      dimensions: Object.freeze({ values: 1 }),
      finiteRanges: Object.freeze({
        value: Object.freeze({
          ...(Number.isFinite(result.value)
            ? { minimum: result.value, maximum: result.value, finiteValues: 1, nanValues: 0 }
            : { finiteValues: 0, nanValues: 1 }),
          invalidValues: 0,
        }),
      }),
      preview: previewValue(result.value),
    })
  }
  if (result.kind === 'histogram') {
    return Object.freeze({
      ...common,
      schema: Object.freeze({ binEdges: 'Float64Array', counts: arrayType(result.counts) }),
      units: unitList([result.unit]),
      dimensions: Object.freeze({ bins: result.counts.length }),
      finiteRanges: Object.freeze({
        binEdges: summarizeNumeric(result.binEdges),
        counts: summarizeNumeric(result.counts),
      }),
      preview: Object.freeze({
        binEdges: previewNumeric(result.binEdges, maximum + 1),
        counts: previewNumeric(result.counts, maximum),
        underflow: previewValue(result.underflow),
        overflow: previewValue(result.overflow),
      }),
    })
  }
  if (result.kind === 'profile') {
    const schema: Record<string, OperationJsonValue> = {
      axis: Object.freeze({
        name: result.axis.name,
        dataType: arrayType(result.axis.values),
        nanPolicy: result.axis.nanPolicy,
      }),
      series: Object.freeze(
        result.series.map((series) =>
          Object.freeze({
            name: series.name,
            dataType: arrayType(series.values),
            nanPolicy: series.nanPolicy,
            validity: series.validity !== undefined,
          }),
        ),
      ),
    }
    const ranges: Record<string, OperationJsonValue> = {
      [result.axis.name]: summarizeNumeric(result.axis.values),
    }
    const preview: Record<string, OperationJsonValue> = {
      [result.axis.name]: previewNumeric(result.axis.values, maximum),
    }
    for (const series of result.series) {
      ranges[series.name] = summarizeNumeric(series.values, series.validity)
      preview[series.name] = previewNumeric(series.values, maximum, series.validity)
    }
    return Object.freeze({
      ...common,
      schema: Object.freeze(schema),
      units: unitList([result.axis.unit, ...result.series.map((series) => series.unit)]),
      dimensions: Object.freeze({
        points: result.axis.values.length,
        series: result.series.length,
      }),
      finiteRanges: Object.freeze(ranges),
      preview: Object.freeze(preview),
    })
  }
  if (result.kind === 'table') {
    const schemas: OperationJsonValue[] = []
    const ranges: Record<string, OperationJsonValue> = {}
    const previews: Record<string, OperationJsonValue> = {}
    const decoder = new TextDecoder()
    for (const column of result.columns) {
      if (column.kind === 'numeric') {
        schemas.push(
          Object.freeze({
            name: column.name,
            kind: column.kind,
            dataType: arrayType(column.values),
            nanPolicy: column.nanPolicy,
            validity: column.validity !== undefined,
          }),
        )
        ranges[column.name] = summarizeNumeric(column.values, column.validity)
        previews[column.name] = previewNumeric(column.values, maximum, column.validity)
      } else if (column.kind === 'boolean') {
        schemas.push(
          Object.freeze({
            name: column.name,
            kind: column.kind,
            encoding: 'bitset',
            validity: column.validity !== undefined,
          }),
        )
        const values: OperationJsonValue[] = []
        for (let row = 0; row < Math.min(result.rowCount, maximum); row += 1)
          values.push(
            column.validity !== undefined && !bitmapValue(column.validity.bits, row)
              ? null
              : bitmapValue(column.values, row),
          )
        previews[column.name] = Object.freeze(values)
      } else if (column.kind === 'string') {
        schemas.push(
          Object.freeze({
            name: column.name,
            kind: column.kind,
            encoding: 'utf8-offsets',
            validity: column.validity !== undefined,
          }),
        )
        const values: OperationJsonValue[] = []
        for (let row = 0; row < Math.min(result.rowCount, maximum); row += 1) {
          if (column.validity !== undefined && !bitmapValue(column.validity.bits, row))
            values.push(null)
          else
            values.push(
              decoder.decode(
                column.data.subarray(column.offsets[row] ?? 0, column.offsets[row + 1] ?? 0),
              ),
            )
        }
        previews[column.name] = Object.freeze(values)
      } else {
        schemas.push(
          Object.freeze({
            name: column.name,
            kind: column.kind,
            codeType: arrayType(column.codes),
            categories: column.categories,
            validity: column.validity !== undefined,
          }),
        )
        const values: OperationJsonValue[] = []
        for (let row = 0; row < Math.min(result.rowCount, maximum); row += 1)
          values.push(
            column.validity !== undefined && !bitmapValue(column.validity.bits, row)
              ? null
              : (column.categories[column.codes[row] ?? column.categories.length] ?? null),
          )
        previews[column.name] = Object.freeze(values)
      }
    }
    return Object.freeze({
      ...common,
      schema: Object.freeze({ columns: Object.freeze(schemas) }),
      units: unitList(
        result.columns.map((column) => (column.kind === 'numeric' ? column.unit : undefined)),
      ),
      dimensions: Object.freeze({ rows: result.rowCount, columns: result.columns.length }),
      finiteRanges: Object.freeze(ranges),
      preview: Object.freeze(previews),
    })
  }
  const summaries: Record<string, OperationJsonValue> = {}
  const units: string[] = []
  for (const entry of result.results) {
    const summary = summarizeValidated(entry.result, maximum)
    summaries[entry.name] = summary
    units.push(...summary.units)
  }
  return Object.freeze({
    ...common,
    schema: Object.freeze({
      entries: Object.freeze(
        result.results.map((entry) =>
          Object.freeze({ name: entry.name, valueType: entry.result.valueType }),
        ),
      ),
    }),
    units: unitList(units),
    dimensions: Object.freeze({ results: result.results.length }),
    finiteRanges: Object.freeze({}),
    preview: Object.freeze(summaries),
  })
}

export const summarizeResult = (
  input: unknown,
  options: Readonly<ResultSummaryOptions> = {},
  limits: Readonly<AnalysisResultLimits> = {},
): AnalysisResultSummary => {
  const maximum = options.maxPreviewValues ?? 8
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 256) {
    throw invalidInput('maxPreviewValues must be a safe integer from 0 through 256')
  }
  return summarizeValidated(validateAnalysisResult(input, limits), maximum)
}

export const analysisResultSchemas: Readonly<Record<AnalysisResult['kind'], OperationJsonObject>> =
  Object.freeze({
    scalar: Object.freeze({
      value: 'number',
      uncertainty: 'optional-number',
      unit: 'optional-string',
    }),
    histogram: Object.freeze({
      binEdges: 'Float64Array',
      counts: 'count-typed-array',
      unit: 'optional-string',
    }),
    profile: Object.freeze({
      axis: 'numeric-typed-array',
      series: 'named-numeric-typed-arrays',
      validity: 'optional-bitset',
    }),
    table: Object.freeze({
      rows: 'columnar',
      numeric: 'typed-array',
      boolean: 'bitset',
      string: 'utf8-offsets',
      category: 'dictionary-codes',
      validity: 'optional-bitset',
    }),
    collection: Object.freeze({ entries: 'bounded-named-results' }),
  })

const resultCapabilities = (kind: AnalysisResult['kind'], storage: string): OperationJsonObject =>
  Object.freeze({
    kind,
    schemaVersion: 1,
    schema: analysisResultSchemas[kind],
    storage,
    payloadJsonSafe: false,
    summaryJsonSafe: true,
  })

export const analysisResultValueTypeDefinitions: readonly ValueTypeDefinition[] = Object.freeze([
  createValueTypeDefinition({
    descriptor: {
      id: scalarResultValueTypeId,
      version: 1,
      title: 'Scalar result',
      capabilities: resultCapabilities('scalar', 'number'),
      builtIn: true,
    },
  }),
  createValueTypeDefinition({
    descriptor: {
      id: histogramResultValueTypeId,
      version: 1,
      title: 'Histogram result',
      capabilities: resultCapabilities('histogram', 'typed-arrays'),
      builtIn: true,
    },
  }),
  createValueTypeDefinition({
    descriptor: {
      id: profileResultValueTypeId,
      version: 1,
      title: 'Profile result',
      capabilities: resultCapabilities('profile', 'columnar-typed-arrays'),
      builtIn: true,
    },
  }),
  createValueTypeDefinition({
    descriptor: {
      id: tableResultValueTypeId,
      version: 1,
      title: 'Table result',
      capabilities: resultCapabilities('table', 'columnar'),
      builtIn: true,
    },
  }),
  createValueTypeDefinition({
    descriptor: {
      id: resultCollectionValueTypeId,
      version: 1,
      title: 'Result collection',
      capabilities: resultCapabilities('collection', 'named-results'),
      builtIn: true,
    },
  }),
])

export const analysisResultValueTypeDescriptors = Object.freeze(
  analysisResultValueTypeDefinitions.map((definition) => definition.descriptor),
)

export const createAnalysisResultValueTypeRegistry = (): ValueTypeRegistry =>
  createValueTypeRegistry(analysisResultValueTypeDefinitions)
