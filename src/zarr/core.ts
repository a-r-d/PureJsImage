import { throwIfAborted } from '../abort.ts'
import { decodeZstd } from '../compression/zstd/index.ts'
import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { RasterSampleType } from '../raster.ts'
import { rasterSampleBytes } from '../raster.ts'
import {
  type ImageSource,
  type ImageSourceReadOptions,
  MemorySource,
  readExactly,
} from '../source.ts'
import { decodeBlosc } from './blosc.ts'
import { crc32c } from './crc32c.ts'

export type ZarrEndian = 'little' | 'big'
export type ZarrDimensionName = string | null

export interface ZarrCodec {
  readonly name: string
  readonly configuration: Readonly<Record<string, unknown>>
}

export type ZarrFill =
  | {
      readonly kind: 'defined'
      readonly bytes: Uint8Array
      readonly numeric?: number
    }
  | { readonly kind: 'undefined' }

export interface ZarrArrayMetadata {
  readonly path: string
  readonly shape: readonly number[]
  readonly chunkShape: readonly number[]
  readonly dataType: RasterSampleType
  readonly endian: ZarrEndian
  readonly fill: ZarrFill
  readonly chunkKeyEncoding: 'default' | 'v2'
  readonly separator: string
  readonly codecs: readonly ZarrCodec[]
  readonly dimensionNames?: readonly ZarrDimensionName[]
  readonly attributes: Readonly<Record<string, unknown>>
}

export interface ZarrGroupMetadata {
  readonly path: string
  readonly attributes: Readonly<Record<string, unknown>>
}

/** One object resolved from a Zarr store. */
export interface ZarrObject {
  readonly id: string
  readonly source: ImageSource
}

/** Runtime-neutral object-store adapter used by the generic Zarr engine. */
export interface ZarrObjectStore {
  resolve(relative: string, signal?: AbortSignal): Promise<ZarrObject | undefined>
  close?(): void | Promise<void>
}

export interface ZarrStoreLimits {
  readonly maxMetadataBytes: number
  readonly maxDimensions: number
  readonly maxChunkBytes: number
  readonly maxDecodedChunkBytes: number
  readonly maxOpenSources: number
  readonly maxCachedChunkBytes: number
  readonly maxStoreResolutions: number
}

export interface ZarrStoreDiagnostics {
  readonly prefix: string
  readonly format: 2 | 3
  readonly identityKind: 'session' | 'archive'
  readonly metadataResolutions: number
  readonly metadataCacheHits: number
  readonly metadataCacheEntries: number
  readonly chunkCacheHits: number
  readonly chunkCacheEntries: number
  readonly chunkCacheBytes: number
  readonly metadataReadRequests: number
  readonly metadataReadBytes: number
  readonly chunkReadRequests: number
  readonly chunkReadBytes: number
  readonly logicalChunkReads: number
  readonly outerShardAccesses: number
  readonly uniqueShardObjects: number
  readonly shardIndexReads: number
  readonly shardPayloadRanges: number
  readonly cancelledReads: number
  readonly closed: boolean
}

export interface ZarrStore {
  readonly prefix: string
  readonly format: 2 | 3
  readonly identityKind: 'session' | 'archive'
  resolve(relative: string, signal?: AbortSignal): Promise<ZarrObject | undefined>
  readJson(relative: string, signal?: AbortSignal): Promise<unknown>
  readJsonOptional(relative: string, signal?: AbortSignal): Promise<unknown>
  openArray(relative: string, signal?: AbortSignal): Promise<ZarrArrayMetadata>
  openGroup(relative: string, signal?: AbortSignal): Promise<ZarrGroupMetadata>
  identityResources(paths: readonly string[], signal?: AbortSignal): Promise<readonly ZarrObject[]>
  readRegion(
    array: Readonly<ZarrArrayMetadata>,
    start: readonly number[],
    shape: readonly number[],
    signal?: AbortSignal,
    session?: ZarrReadSession,
  ): Promise<Uint8Array>
  createReadSession(): ZarrReadSession
  diagnostics(): ZarrStoreDiagnostics
  close(): void | Promise<void>
}

export interface ZarrRoot {
  readonly metadataObject: string
  readonly format: 2 | 3
  readonly nodeType: 'array' | 'group'
  readonly store: ZarrStore
  readonly metadata: ZarrArrayMetadata | ZarrGroupMetadata
}

/** Opaque plane-scoped cache. Created by the store; not a public application API. */
export interface ZarrReadSession {
  release(): void
}

export interface ZarrReadSessionStats {
  readonly chunkEntries: number
  readonly chunkBytes: number
  readonly chunkEntryHighWater: number
  readonly chunkByteHighWater: number
  readonly indexEntries: number
  readonly indexBytes: number
  readonly indexEntryHighWater: number
  readonly indexByteHighWater: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidInput(`${label} must be a non-empty string`)
  }
  return value
}

/** Reject absolute, empty, backslash, URL-like, and traversal object keys. */
export const normalizeZarrObjectPath = (value: unknown): string => {
  const name = requiredString(value, 'Zarr object path').normalize('NFC')
  if (
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    /^[a-z][a-z0-9+.-]*:/iu.test(name)
  ) {
    throw invalidInput('Zarr object path must be a normalized relative path')
  }
  const segments = name.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw invalidInput('Zarr object path must not contain empty or traversal segments')
  }
  return name
}

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined) return undefined
  return requiredString(value, label)
}

const positiveInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const nonNegativeInteger = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`${label} must be a non-negative safe integer`)
  }
  return value
}

const integerArray = (value: unknown, label: string, allowZero: boolean): readonly number[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidInput(`${label} must be a non-empty array`)
  }
  return Object.freeze(
    value.map((entry, index) =>
      allowZero
        ? nonNegativeInteger(entry, `${label}[${index}]`)
        : positiveInteger(entry, `${label}[${index}]`),
    ),
  )
}

const checkedProduct = (values: readonly number[], label: string): number => {
  let result = 1
  for (const value of values) {
    result *= value
    if (!Number.isSafeInteger(result) || result < 0) {
      throw limitExceeded(`${label} exceeds the safe integer range`)
    }
  }
  return result
}

const joinPath = (prefix: string, relative: string): string => {
  const child = normalizeZarrObjectPath(relative)
  return prefix.length === 0 ? child : normalizeZarrObjectPath(`${prefix}/${child}`)
}

export const zarrStorePrefix = (primaryName: string | undefined): string => {
  if (primaryName === undefined || primaryName.length === 0) return ''
  const name = normalizeZarrObjectPath(primaryName)
  const slash = name.lastIndexOf('/')
  return slash < 0 ? '' : name.slice(0, slash)
}

const codecName = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (!isRecord(value)) throw invalidInput('Zarr codec entry is invalid')
  return requiredString(value.name, 'Zarr codec name')
}

const normalizeCodecName = (name: string): string =>
  name.startsWith('numcodecs.') ? name.slice('numcodecs.'.length) : name

const parseCodec = (value: unknown): ZarrCodec => {
  if (typeof value === 'string') {
    return Object.freeze({
      name: normalizeCodecName(value),
      configuration: Object.freeze({}),
    })
  }
  if (!isRecord(value)) throw invalidInput('Zarr codec entry is invalid')
  const configuration = value.configuration
  if (configuration !== undefined && !isRecord(configuration)) {
    throw invalidInput(`Zarr codec ${codecName(value)} configuration is invalid`)
  }
  return Object.freeze({
    name: normalizeCodecName(requiredString(value.name, 'Zarr codec name')),
    configuration: Object.freeze(configuration === undefined ? {} : { ...configuration }),
  })
}

const parseCodecs = (value: unknown, label: string): readonly ZarrCodec[] => {
  if (!Array.isArray(value)) throw invalidInput(`${label} must be an array`)
  return Object.freeze(value.map(parseCodec))
}

const supportedArrayCodecs = new Set([
  'bytes',
  'gzip',
  'zlib',
  'zstd',
  'blosc',
  'crc32c',
  'transpose',
  'shuffle',
  'sharding_indexed',
])

const variableIndexCodecs = new Set(['gzip', 'zlib', 'zstd', 'blosc', 'transpose', 'shuffle'])

const validateInnerCodecs = (codecs: readonly ZarrCodec[], label: string, rank: number): void => {
  if (codecs.some((codec) => codec.name === 'sharding_indexed')) {
    throw unsupportedOperation(`${label} cannot nest sharding_indexed`)
  }
  for (const codec of codecs) {
    if (!supportedArrayCodecs.has(codec.name)) {
      throw unsupportedOperation(`Zarr codec ${codec.name} is unsupported`)
    }
  }
  const bytesIndexes = codecs.flatMap((codec, index) => (codec.name === 'bytes' ? [index] : []))
  if (bytesIndexes.length === 0) throw invalidInput(`${label} is missing a bytes codec`)
  if (bytesIndexes.length > 1) throw invalidInput(`${label} has repeated bytes codecs`)
  const bytesIndex = bytesIndexes[0] ?? 0
  for (let index = 0; index < bytesIndex; index += 1) {
    if (codecs[index]?.name !== 'transpose') {
      throw invalidInput(`${label} codec order is invalid`)
    }
  }
  for (let index = bytesIndex + 1; index < codecs.length; index += 1) {
    const name = codecs[index]?.name ?? ''
    if (name === 'bytes' || name === 'transpose' || name === 'sharding_indexed') {
      throw invalidInput(`${label} codec order is invalid`)
    }
  }
  const transposes = codecs.filter((codec) => codec.name === 'transpose')
  if (transposes.length > 1) {
    throw unsupportedOperation('Zarr repeated transpose codecs are unsupported')
  }
  const transpose = transposes[0]
  if (transpose !== undefined) {
    transposeShape(
      Array.from({ length: rank }, () => 1),
      integerTuple(transpose.configuration.order, 'Zarr transpose order', rank, true),
    )
  }
}

const validateIndexCodecs = (codecs: readonly ZarrCodec[], label: string): void => {
  const bytesIndexes = codecs.flatMap((codec, index) => (codec.name === 'bytes' ? [index] : []))
  if (bytesIndexes.length !== 1) {
    throw invalidInput(`${label} must contain exactly one bytes codec`)
  }
  const bytesIndex = bytesIndexes[0] ?? 0
  if (bytesIndex !== 0) throw invalidInput(`${label} must start with a bytes codec`)
  for (let index = 1; index < codecs.length; index += 1) {
    const name = codecs[index]?.name ?? ''
    if (variableIndexCodecs.has(name)) {
      throw unsupportedOperation(`${label} codec ${name} is not a fixed-size index codec`)
    }
    if (name !== 'crc32c') {
      throw unsupportedOperation(`${label} codec ${name} is unsupported`)
    }
  }
}

const validateShardingCodec = (
  codec: Readonly<ZarrCodec>,
  shardShape: readonly number[],
  sampleType: RasterSampleType,
): void => {
  const innerShape = integerTuple(
    codec.configuration.chunk_shape,
    'Zarr sharding chunk_shape',
    shardShape.length,
  )
  for (const [axis, outer] of shardShape.entries()) {
    const inner = innerShape[axis] ?? 0
    if (inner < 1 || outer % inner !== 0) {
      throw invalidInput('Zarr shard shape is not divisible by the inner chunk shape')
    }
  }
  const innerCodecs = parseCodecs(codec.configuration.codecs, 'Zarr sharding codecs')
  validateInnerCodecs(innerCodecs, 'Zarr sharding codecs', innerShape.length)
  parseEndian(innerCodecs, sampleType)
  const indexCodecs = parseCodecs(codec.configuration.index_codecs, 'Zarr sharding index_codecs')
  validateIndexCodecs(indexCodecs, 'Zarr sharding index_codecs')
  parseEndian(indexCodecs, 'uint64')
  const location = codec.configuration.index_location ?? 'end'
  if (location !== 'end' && location !== 'start') {
    throw unsupportedOperation(`Zarr sharding index_location ${String(location)} is unsupported`)
  }
}

const validateArrayCodecs = (
  codecs: readonly ZarrCodec[],
  chunkShape: readonly number[],
  sampleType: RasterSampleType,
): void => {
  const sharding = codecs.find((codec) => codec.name === 'sharding_indexed')
  if (sharding !== undefined) {
    if (codecs.length !== 1) {
      throw unsupportedOperation(
        `Zarr codecs surrounding sharding_indexed (${codecs.map((codec) => codec.name).join(', ')}) are unsupported`,
      )
    }
    validateShardingCodec(sharding, chunkShape, sampleType)
    return
  }
  validateInnerCodecs(codecs, 'Zarr codecs', chunkShape.length)
  parseEndian(codecs, sampleType)
}

const parseDimensionNames = (
  value: unknown,
  rank: number,
  allowUnnamed: boolean,
): readonly ZarrDimensionName[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length !== rank) {
    throw invalidInput('Zarr dimension_names rank does not match the array shape')
  }
  const names = value.map((entry, index) => {
    if (entry === null && allowUnnamed) return null
    if (typeof entry !== 'string' || entry.length === 0) {
      throw invalidInput(`Zarr dimension_names[${index}] must be a non-empty string`)
    }
    return entry
  })
  const seen = new Set<string>()
  for (const name of names) {
    if (name === null) continue
    if (seen.has(name)) throw invalidInput(`Zarr dimension_names repeats ${name}`)
    seen.add(name)
  }
  return Object.freeze(names)
}

const dataTypes: Readonly<Record<string, RasterSampleType>> = Object.freeze({
  int8: 'int8',
  uint8: 'uint8',
  int16: 'int16',
  uint16: 'uint16',
  int32: 'int32',
  int64: 'int64',
  uint32: 'uint32',
  uint64: 'uint64',
  float16: 'float16',
  float32: 'float32',
  float64: 'float64',
})

const parseDataType = (value: unknown): RasterSampleType => {
  const name = requiredString(value, 'Zarr data_type')
  const type = dataTypes[name]
  if (type === undefined) {
    throw unsupportedOperation(`Zarr data type ${name} is unsupported`)
  }
  return type
}

const isFloatSampleType = (sampleType: RasterSampleType): boolean =>
  sampleType === 'float16' || sampleType === 'float32' || sampleType === 'float64'

const integerBitWidth = (sampleType: RasterSampleType): number => rasterSampleBytes(sampleType) * 8

const integerFillRange = (
  sampleType: RasterSampleType,
): { readonly min: bigint; readonly max: bigint } => {
  const width = BigInt(integerBitWidth(sampleType))
  if (sampleType.startsWith('u')) return { min: 0n, max: (1n << width) - 1n }
  const half = 1n << (width - 1n)
  return { min: -half, max: half - 1n }
}

const writeExactIntegerBits = (
  bits: bigint,
  sampleType: RasterSampleType,
  littleEndian: boolean,
): Uint8Array => {
  const bytes = new Uint8Array(rasterSampleBytes(sampleType))
  const width = BigInt(bytes.byteLength * 8)
  if (bits < 0n || bits >= 1n << width) {
    throw invalidInput(`Zarr fill_value bit pattern exceeds ${sampleType}`)
  }
  const view = new DataView(bytes.buffer)
  if (bytes.byteLength === 1) view.setUint8(0, Number(bits))
  else if (bytes.byteLength === 2) view.setUint16(0, Number(bits), littleEndian)
  else if (bytes.byteLength === 4) view.setUint32(0, Number(bits), littleEndian)
  else view.setBigUint64(0, bits, littleEndian)
  return bytes
}

const signedIntegerFromBits = (bits: bigint, sampleType: RasterSampleType): bigint => {
  const width = BigInt(integerBitWidth(sampleType))
  const sign = 1n << (width - 1n)
  return (bits & sign) === 0n ? bits : bits - (1n << width)
}

const representableNumber = (value: bigint): number | undefined => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    return undefined
  }
  return Number(value)
}

const writeExactIntegerValue = (
  value: bigint,
  sampleType: RasterSampleType,
  littleEndian: boolean,
): { readonly bytes: Uint8Array; readonly numeric?: number } => {
  const range = integerFillRange(sampleType)
  if (value < range.min || value > range.max) {
    throw invalidInput(`Zarr fill_value ${value.toString()} is outside ${sampleType}`)
  }
  const width = BigInt(integerBitWidth(sampleType))
  const bits = value < 0n ? (1n << width) + value : value
  const bytes = writeExactIntegerBits(bits, sampleType, littleEndian)
  const numeric = representableNumber(value)
  return numeric === undefined ? { bytes } : { bytes, numeric }
}

const writeNumericSample = (
  sampleType: RasterSampleType,
  value: number,
  littleEndian: boolean,
): { readonly bytes: Uint8Array; readonly numeric: number } => {
  const bytes = new Uint8Array(rasterSampleBytes(sampleType))
  const view = new DataView(bytes.buffer)
  if (sampleType === 'float16') {
    if (value !== 0) {
      throw unsupportedOperation('Zarr float16 fill values other than 0 are unsupported')
    }
    view.setUint16(0, 0, littleEndian)
    return { bytes, numeric: 0 }
  }
  if (sampleType === 'float32') {
    view.setFloat32(0, value, littleEndian)
    return { bytes, numeric: view.getFloat32(0, littleEndian) }
  }
  view.setFloat64(0, value, littleEndian)
  return { bytes, numeric: view.getFloat64(0, littleEndian) }
}

const parseIntegerCandidate = (value: unknown, label: string): bigint => {
  if (typeof value === 'bigint') return value
  if (typeof value === 'boolean') return value ? 1n : 0n
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw invalidInput(`${label} is not an exact integer`)
    }
    return BigInt(value)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length === 0) throw invalidInput(`${label} is not an exact integer`)
    if (!/^[+-]?\d+$/u.test(trimmed)) throw invalidInput(`${label} is not an exact integer`)
    return BigInt(trimmed)
  }
  throw invalidInput(`${label} is unsupported`)
}

const parseFloatHexFill = (
  value: string,
  sampleType: RasterSampleType,
  littleEndian: boolean,
): ZarrFill | undefined => {
  const hex = /^0x([0-9a-fA-F]+)$/u.exec(value.trim())
  if (hex === null) return undefined
  const bits = BigInt(`0x${hex[1]}`)
  const width = BigInt(integerBitWidth(sampleType))
  if (bits >= 1n << width) {
    throw invalidInput(`Zarr fill_value ${value} exceeds ${sampleType}`)
  }
  const integerType: RasterSampleType =
    sampleType === 'float16' ? 'uint16' : sampleType === 'float32' ? 'uint32' : 'uint64'
  const bytes = writeExactIntegerBits(bits, integerType, littleEndian)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const numeric =
    sampleType === 'float16'
      ? view.getUint16(0, littleEndian) === 0
        ? 0
        : Number.NaN
      : sampleType === 'float32'
        ? view.getFloat32(0, littleEndian)
        : view.getFloat64(0, littleEndian)
  if (sampleType === 'float16' && view.getUint16(0, littleEndian) !== 0) {
    throw unsupportedOperation('Zarr float16 fill values other than 0 are unsupported')
  }
  return { kind: 'defined', bytes, numeric }
}

const parseFillValue = (
  value: unknown,
  sampleType: RasterSampleType,
  littleEndian: boolean,
  format: 2 | 3,
): ZarrFill => {
  const floating = isFloatSampleType(sampleType)
  if (value === undefined) {
    if (format === 3) throw invalidInput('Zarr fill_value is missing')
    return { kind: 'undefined' }
  }
  if (value === null) {
    if (format === 3) throw invalidInput('Zarr v3 fill_value null is invalid')
    return { kind: 'undefined' }
  }
  if (floating) {
    if (typeof value === 'number') {
      if (
        !Number.isFinite(value) &&
        !Number.isNaN(value) &&
        value !== Number.POSITIVE_INFINITY &&
        value !== Number.NEGATIVE_INFINITY
      ) {
        throw invalidInput(`Zarr fill_value ${String(value)} is invalid for ${sampleType}`)
      }
      return { kind: 'defined', ...writeNumericSample(sampleType, value, littleEndian) }
    }
    if (typeof value !== 'string') throw invalidInput('Zarr fill_value is unsupported')
    const special = value.trim().toLowerCase()
    if (special === 'nan') {
      return { kind: 'defined', ...writeNumericSample(sampleType, Number.NaN, littleEndian) }
    }
    if (
      special === 'infinity' ||
      special === '+infinity' ||
      special === 'inf' ||
      special === '+inf'
    ) {
      return {
        kind: 'defined',
        ...writeNumericSample(sampleType, Number.POSITIVE_INFINITY, littleEndian),
      }
    }
    if (special === '-infinity' || special === '-inf') {
      return {
        kind: 'defined',
        ...writeNumericSample(sampleType, Number.NEGATIVE_INFINITY, littleEndian),
      }
    }
    const hex = parseFloatHexFill(value, sampleType, littleEndian)
    if (hex !== undefined) return hex
    const parsed = Number(value.trim())
    if (value.trim().length === 0 || !Number.isFinite(parsed)) {
      throw invalidInput('Zarr fill_value is unsupported')
    }
    return { kind: 'defined', ...writeNumericSample(sampleType, parsed, littleEndian) }
  }
  if (format === 3) {
    if (typeof value !== 'number') {
      throw invalidInput('Zarr v3 integer fill_value must be a number')
    }
    if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
      throw invalidInput('Zarr v3 integer fill_value must be an exact integer')
    }
    const written = writeExactIntegerValue(BigInt(value), sampleType, littleEndian)
    return written.numeric === undefined
      ? { kind: 'defined', bytes: written.bytes }
      : { kind: 'defined', bytes: written.bytes, numeric: written.numeric }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const hex = /^0x([0-9a-fA-F]+)$/u.exec(trimmed)
    if (hex !== null) {
      const bits = BigInt(`0x${hex[1]}`)
      const width = BigInt(integerBitWidth(sampleType))
      if (bits >= 1n << width) {
        throw invalidInput(`Zarr fill_value ${value} exceeds ${sampleType}`)
      }
      const bytes = writeExactIntegerBits(bits, sampleType, littleEndian)
      const signed = sampleType.startsWith('i') ? signedIntegerFromBits(bits, sampleType) : bits
      const numeric = representableNumber(signed)
      return numeric === undefined
        ? { kind: 'defined', bytes }
        : { kind: 'defined', bytes, numeric }
    }
  }
  const integer = parseIntegerCandidate(value, `Zarr fill_value ${String(value)}`)
  const written = writeExactIntegerValue(integer, sampleType, littleEndian)
  return written.numeric === undefined
    ? { kind: 'defined', bytes: written.bytes }
    : { kind: 'defined', bytes: written.bytes, numeric: written.numeric }
}

const codecsForEndian = (codecs: readonly ZarrCodec[]): readonly ZarrCodec[] => {
  const sharding = codecs.find((codec) => codec.name === 'sharding_indexed')
  if (sharding === undefined) return codecs
  return parseCodecs(sharding.configuration.codecs, 'Zarr sharding codecs')
}

const parseEndian = (codecs: readonly ZarrCodec[], sampleType: RasterSampleType): ZarrEndian => {
  const bytesCodec = codecsForEndian(codecs).find((codec) => codec.name === 'bytes')
  const configured = bytesCodec?.configuration.endian
  if (configured === undefined) {
    if (rasterSampleBytes(sampleType) > 1) {
      throw invalidInput('Zarr bytes codec is missing endian for a multi-byte data type')
    }
    return 'little'
  }
  if (configured !== 'little' && configured !== 'big') {
    throw invalidInput(`Zarr bytes endian ${String(configured)} is invalid`)
  }
  return configured
}

const parseChunkKeyEncoding = (
  value: unknown,
): { readonly name: 'default' | 'v2'; readonly separator: string } => {
  if (value === undefined || value === null) {
    return { name: 'default', separator: '/' }
  }
  if (!isRecord(value)) throw invalidInput('Zarr chunk_key_encoding is invalid')
  const name = requiredString(value.name, 'Zarr chunk_key_encoding.name')
  if (name !== 'default' && name !== 'v2') {
    throw unsupportedOperation(`Zarr chunk key encoding ${name} is unsupported`)
  }
  const configuration = value.configuration
  const configured =
    configuration === undefined
      ? undefined
      : isRecord(configuration)
        ? optionalString(configuration.separator, 'Zarr chunk_key_encoding.separator')
        : (() => {
            throw invalidInput('Zarr chunk_key_encoding.configuration is invalid')
          })()
  const separator = configured ?? (name === 'v2' ? '.' : '/')
  if (separator !== '/' && separator !== '.') {
    throw unsupportedOperation(`Zarr chunk key separator ${separator} is unsupported`)
  }
  return { name, separator }
}

const parseRegularChunkShape = (value: unknown, rank: number): readonly number[] => {
  if (!isRecord(value)) throw invalidInput('Zarr chunk_grid is invalid')
  const name = requiredString(value.name, 'Zarr chunk_grid.name')
  if (name !== 'regular') {
    throw unsupportedOperation(`Zarr chunk grid ${name} is unsupported`)
  }
  if (!isRecord(value.configuration)) {
    throw invalidInput('Zarr chunk_grid.configuration is invalid')
  }
  const chunkShape = integerArray(value.configuration.chunk_shape, 'Zarr chunk_shape', false)
  if (chunkShape.length !== rank) {
    throw invalidInput('Zarr chunk_shape rank does not match the array shape')
  }
  return chunkShape
}

export const parseZarrNodeJson = (
  value: unknown,
): { readonly format: 2 | 3; readonly nodeType: 'array' | 'group' } | undefined => {
  if (!isRecord(value)) return undefined
  const format = value.zarr_format
  if (format === 2) {
    if (value.dtype !== undefined || value.chunks !== undefined) {
      return { format: 2, nodeType: 'array' }
    }
    return { format: 2, nodeType: 'group' }
  }
  if (format !== 3) return undefined
  const nodeType = value.node_type
  if (nodeType !== 'array' && nodeType !== 'group') return undefined
  return { format: 3, nodeType }
}

const parseNumpyDtype = (
  value: unknown,
): { readonly sampleType: RasterSampleType; readonly littleEndian: boolean } => {
  const descriptor = requiredString(value, 'Zarr v2 dtype')
  const match = descriptor.match(/^([<>|=])?([?uif])(1|2|4|8)$/u)
  if (match === null) throw unsupportedOperation(`Zarr v2 dtype ${descriptor} is unsupported`)
  const order = match[1] ?? '|'
  const kind = match[2]
  const bytes = Number(match[3])
  if (kind === '?') throw unsupportedOperation('Zarr boolean dtypes are unsupported')
  const key = `${kind}${bytes}`
  const sampleType: RasterSampleType | undefined =
    key === 'u1'
      ? 'uint8'
      : key === 'u2'
        ? 'uint16'
        : key === 'u4'
          ? 'uint32'
          : key === 'u8'
            ? 'uint64'
            : key === 'i1'
              ? 'int8'
              : key === 'i2'
                ? 'int16'
                : key === 'i4'
                  ? 'int32'
                  : key === 'i8'
                    ? 'int64'
                    : key === 'f2'
                      ? 'float16'
                      : key === 'f4'
                        ? 'float32'
                        : key === 'f8'
                          ? 'float64'
                          : undefined
  if (sampleType === undefined) {
    throw unsupportedOperation(`Zarr v2 dtype ${descriptor} is unsupported`)
  }
  if (rasterSampleBytes(sampleType) > 1 && (order === '|' || order === '=')) {
    throw unsupportedOperation(`Zarr v2 dtype ${descriptor} has no portable endian`)
  }
  return { sampleType, littleEndian: order !== '>' }
}

const parseV2Compressor = (value: unknown): ZarrCodec | undefined => {
  if (value === null || value === undefined) return undefined
  if (!isRecord(value)) throw invalidInput('Zarr v2 compressor is invalid')
  const id = normalizeCodecName(requiredString(value.id, 'Zarr v2 compressor id'))
  if (id !== 'gzip' && id !== 'zlib' && id !== 'zstd' && id !== 'blosc') {
    throw unsupportedOperation(`Zarr v2 compressor ${id} is unsupported`)
  }
  return Object.freeze({ name: id, configuration: Object.freeze({ ...value }) })
}

const parseV2Filters = (value: unknown): readonly ZarrCodec[] => {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw invalidInput('Zarr v2 filters are invalid')
  return Object.freeze(
    value.map((filter, index) => {
      if (!isRecord(filter)) throw invalidInput(`Zarr v2 filter[${index}] is invalid`)
      const id = normalizeCodecName(requiredString(filter.id, `Zarr v2 filter[${index}].id`))
      if (id !== 'shuffle') {
        throw unsupportedOperation(`Zarr v2 filter ${id} is unsupported`)
      }
      return Object.freeze({ name: 'shuffle', configuration: Object.freeze({ ...filter }) })
    }),
  )
}

const fortranOrder = (rank: number): readonly number[] =>
  Object.freeze(Array.from({ length: rank }, (_, index) => rank - 1 - index))

const parseV2ArrayMetadata = (value: unknown, path: string): ZarrArrayMetadata => {
  if (!isRecord(value)) throw invalidInput(`Zarr v2 array metadata at ${path} is not an object`)
  if (value.zarr_format !== 2) throw invalidInput(`Zarr array at ${path} is not Zarr v2`)
  const shape = integerArray(value.shape, `Zarr ${path} shape`, true)
  if (shape.length > 16) throw limitExceeded(`Zarr ${path} rank exceeds 16`)
  const chunkShape = integerArray(value.chunks, `Zarr ${path} chunks`, false)
  if (chunkShape.length !== shape.length) {
    throw invalidInput(`Zarr ${path} chunks rank does not match the array shape`)
  }
  const dtype = parseNumpyDtype(value.dtype)
  const order = value.order === undefined ? 'C' : requiredString(value.order, `Zarr ${path} order`)
  if (order !== 'C' && order !== 'F') {
    throw unsupportedOperation(`Zarr v2 order ${order} is unsupported`)
  }
  const separator =
    value.dimension_separator === undefined
      ? '.'
      : requiredString(value.dimension_separator, `Zarr ${path} dimension_separator`)
  if (separator !== '/' && separator !== '.') {
    throw unsupportedOperation(`Zarr v2 dimension_separator ${separator} is unsupported`)
  }
  const codecs: ZarrCodec[] = []
  if (order === 'F') {
    codecs.push(
      Object.freeze({
        name: 'transpose',
        configuration: Object.freeze({ order: fortranOrder(shape.length) }),
      }),
    )
  }
  codecs.push(
    Object.freeze({
      name: 'bytes',
      configuration: Object.freeze({ endian: dtype.littleEndian ? 'little' : 'big' }),
    }),
  )
  codecs.push(...parseV2Filters(value.filters))
  const compressor = parseV2Compressor(value.compressor)
  if (compressor !== undefined) codecs.push(compressor)
  validateArrayCodecs(codecs, chunkShape, dtype.sampleType)
  const fill = parseFillValue(value.fill_value, dtype.sampleType, dtype.littleEndian, 2)
  return Object.freeze({
    path,
    shape,
    chunkShape,
    dataType: dtype.sampleType,
    endian: dtype.littleEndian ? 'little' : 'big',
    fill,
    chunkKeyEncoding: 'v2' as const,
    separator,
    codecs: Object.freeze(codecs),
    attributes: isRecord(value.attributes) ? Object.freeze({ ...value.attributes }) : {},
  })
}

const parseArrayMetadata = (value: unknown, path: string): ZarrArrayMetadata => {
  if (!isRecord(value)) throw invalidInput(`Zarr array metadata at ${path} is not an object`)
  if (value.zarr_format === 2) return parseV2ArrayMetadata(value, path)
  if (value.zarr_format !== 3) {
    throw unsupportedOperation(`Zarr array at ${path} is not Zarr v3`)
  }
  if (value.node_type !== 'array') {
    throw invalidInput(`Zarr node at ${path} is not an array`)
  }
  const shape = integerArray(value.shape, `Zarr ${path} shape`, true)
  if (shape.length > 16) throw limitExceeded(`Zarr ${path} rank exceeds 16`)
  const dataType = parseDataType(value.data_type)
  const chunkShape = parseRegularChunkShape(value.chunk_grid, shape.length)
  const keyEncoding = parseChunkKeyEncoding(value.chunk_key_encoding)
  const codecs = parseCodecs(value.codecs, `Zarr ${path} codecs`)
  validateArrayCodecs(codecs, chunkShape, dataType)
  const endian = parseEndian(codecs, dataType)
  const fill = parseFillValue(value.fill_value, dataType, endian === 'little', 3)
  if (value.storage_transformers !== undefined) {
    if (!Array.isArray(value.storage_transformers)) {
      throw invalidInput(`Zarr ${path} storage_transformers must be an array`)
    }
    if (value.storage_transformers.length > 0) {
      const first = value.storage_transformers[0]
      const name =
        typeof first === 'string'
          ? first
          : isRecord(first) && typeof first.name === 'string'
            ? first.name
            : 'unknown'
      throw unsupportedOperation(`Zarr storage transformer ${name} is unsupported`)
    }
  }
  const dimensionNames = parseDimensionNames(value.dimension_names, shape.length, true)
  const attributes = isRecord(value.attributes) ? Object.freeze({ ...value.attributes }) : {}
  return Object.freeze({
    path,
    shape,
    chunkShape,
    dataType,
    endian,
    fill,
    chunkKeyEncoding: keyEncoding.name,
    separator: keyEncoding.separator,
    codecs,
    ...(dimensionNames === undefined ? {} : { dimensionNames }),
    attributes,
  })
}

const parseGroupMetadata = (value: unknown, path: string): ZarrGroupMetadata => {
  if (!isRecord(value)) throw invalidInput(`Zarr group metadata at ${path} is not an object`)
  if (value.zarr_format === 2) {
    const attributes = isRecord(value.attributes) ? Object.freeze({ ...value.attributes }) : {}
    return Object.freeze({ path, attributes })
  }
  if (value.zarr_format !== 3) {
    throw unsupportedOperation(`Zarr group at ${path} is not Zarr v3`)
  }
  if (value.node_type !== 'group') {
    throw invalidInput(`Zarr node at ${path} is not a group`)
  }
  const attributes = isRecord(value.attributes) ? Object.freeze({ ...value.attributes }) : {}
  return Object.freeze({ path, attributes })
}

const chunkKey = (array: Readonly<ZarrArrayMetadata>, chunk: readonly number[]): string => {
  const joined = chunk.join(array.separator)
  const key = array.chunkKeyEncoding === 'default' ? `c${array.separator}${joined}` : joined
  return array.path.length === 0 ? key : `${array.path}/${key}`
}

const metadataKey = (path: string, format: 2 | 3, kind: 'array' | 'group'): string => {
  if (format === 3) return path.length === 0 ? 'zarr.json' : `${path}/zarr.json`
  const name = kind === 'array' ? '.zarray' : '.zgroup'
  return path.length === 0 ? name : `${path}/${name}`
}

const attributesKey = (path: string): string => (path.length === 0 ? '.zattrs' : `${path}/.zattrs`)

const swapEndian = (input: Uint8Array, sampleBytes: number): Uint8Array => {
  if (sampleBytes === 1) return input
  const output = new Uint8Array(input.byteLength)
  for (let offset = 0; offset < input.byteLength; offset += sampleBytes) {
    for (let byte = 0; byte < sampleBytes; byte += 1) {
      output[offset + byte] = input[offset + sampleBytes - byte - 1] ?? 0
    }
  }
  return output
}

const concatBytes = (chunks: readonly Uint8Array[], total: number): Uint8Array => {
  const only = chunks.length === 1 ? chunks[0] : undefined
  if (only !== undefined) return only
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

const decodeStreamCompression = async (
  encoded: Uint8Array,
  maximumBytes: number,
  format: 'gzip' | 'deflate',
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  if (typeof DecompressionStream !== 'function') {
    throw unsupportedOperation(
      `Zarr ${format} requires the ${format} DecompressionStream primitive`,
    )
  }
  const chunks: Uint8Array[] = []
  let outputBytes = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const stream = new Blob([encoded.slice()]).stream().pipeThrough(new DecompressionStream(format))
    reader = stream.getReader()
    while (true) {
      throwIfAborted(signal)
      const result = await reader.read()
      if (result.done) break
      if (result.value.byteLength > maximumBytes - outputBytes) {
        await reader.cancel()
        throw limitExceeded(`Zarr gzip output exceeds ${maximumBytes} bytes`)
      }
      chunks.push(result.value)
      outputBytes += result.value.byteLength
    }
  } catch (error) {
    if (error instanceof ImageError) throw error
    throw invalidInput(`Zarr ${format} stream is invalid`)
  } finally {
    reader?.releaseLock()
  }
  return concatBytes(chunks, outputBytes)
}

const unshuffle = (encoded: Uint8Array, elementBytes: number): Uint8Array => {
  if (elementBytes <= 1) return encoded
  if (encoded.byteLength % elementBytes !== 0) {
    throw invalidInput('Zarr shuffle payload is not aligned to the element size')
  }
  const elements = encoded.byteLength / elementBytes
  const output = new Uint8Array(encoded.byteLength)
  for (let byte = 0; byte < elementBytes; byte += 1) {
    const sourceOffset = byte * elements
    for (let element = 0; element < elements; element += 1) {
      output[element * elementBytes + byte] = encoded[sourceOffset + element] ?? 0
    }
  }
  return output
}

const decodeCrc32c = (encoded: Uint8Array): Uint8Array => {
  if (encoded.byteLength < 4) throw invalidInput('Zarr crc32c payload is truncated')
  const payload = encoded.subarray(0, encoded.byteLength - 4)
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength)
  const expected = view.getUint32(encoded.byteLength - 4, true)
  if (crc32c(payload) !== expected) throw invalidInput('Zarr crc32c checksum does not match')
  return payload
}

const transposeShape = (shape: readonly number[], order: readonly number[]): readonly number[] => {
  if (order.length !== shape.length) {
    throw invalidInput('Zarr transpose order rank does not match the array')
  }
  const seen = new Set<number>()
  const output: number[] = []
  for (const axis of order) {
    if (!Number.isSafeInteger(axis) || axis < 0 || axis >= shape.length || seen.has(axis)) {
      throw invalidInput('Zarr transpose order is invalid')
    }
    seen.add(axis)
    const length = shape[axis]
    if (length === undefined) throw invalidInput('Zarr transpose order is invalid')
    output.push(length)
  }
  return output
}

const decodeTranspose = (
  encoded: Uint8Array,
  logicalShape: readonly number[],
  order: readonly number[],
  sampleBytes: number,
): Uint8Array => {
  const encodedShape = transposeShape(logicalShape, order)
  const count = checkedProduct(logicalShape, 'Zarr transpose element count')
  if (encoded.byteLength !== count * sampleBytes) {
    throw invalidInput('Zarr transpose payload does not match the chunk shape')
  }
  const encodedStrides: number[] = new Array(encodedShape.length)
  let stride = 1
  for (let axis = encodedShape.length - 1; axis >= 0; axis -= 1) {
    encodedStrides[axis] = stride
    stride *= encodedShape[axis] ?? 1
  }
  const output = new Uint8Array(encoded.byteLength)
  const coords = logicalShape.map(() => 0)
  for (let logical = 0; logical < count; logical += 1) {
    let encodedIndex = 0
    for (let axis = 0; axis < order.length; axis += 1) {
      const source = order[axis] ?? 0
      encodedIndex += (coords[source] ?? 0) * (encodedStrides[axis] ?? 0)
    }
    const sourceOffset = encodedIndex * sampleBytes
    const destOffset = logical * sampleBytes
    output.set(encoded.subarray(sourceOffset, sourceOffset + sampleBytes), destOffset)
    for (let axis = logicalShape.length - 1; axis >= 0; axis -= 1) {
      const next = (coords[axis] ?? 0) + 1
      if (next < (logicalShape[axis] ?? 0)) {
        coords[axis] = next
        break
      }
      coords[axis] = 0
    }
  }
  return output
}

const integerTuple = (
  value: unknown,
  label: string,
  rank: number,
  allowZero = false,
): readonly number[] => {
  const values = integerArray(value, label, allowZero)
  if (values.length !== rank) throw invalidInput(`${label} rank is invalid`)
  return values
}

const decodeBytesCodecs = async (
  encoded: Uint8Array,
  codecs: readonly ZarrCodec[],
  logicalShapes: readonly (readonly number[])[],
  sampleType: RasterSampleType,
  limits: Readonly<ZarrStoreLimits>,
  signal?: AbortSignal,
): Promise<{ readonly data: Uint8Array; readonly shape: readonly number[] }> => {
  const primary = logicalShapes[0]
  if (primary === undefined) throw invalidInput('Zarr decoded chunk shape is missing')
  let current = encoded
  const sampleBytes = rasterSampleBytes(sampleType)
  for (let index = codecs.length - 1; index >= 0; index -= 1) {
    throwIfAborted(signal)
    const codec = codecs[index]
    if (codec === undefined) continue
    if (codec.name === 'gzip') {
      current = await decodeStreamCompression(current, limits.maxDecodedChunkBytes, 'gzip', signal)
      continue
    }
    if (codec.name === 'zlib') {
      current = await decodeStreamCompression(
        current,
        limits.maxDecodedChunkBytes,
        'deflate',
        signal,
      )
      continue
    }
    if (codec.name === 'zstd') {
      current = decodeZstd(current, { maxOutputBytes: limits.maxDecodedChunkBytes })
      continue
    }
    if (codec.name === 'blosc') {
      current = await decodeBlosc(current, {
        maxOutputBytes: limits.maxDecodedChunkBytes,
        ...(signal === undefined ? {} : { signal }),
      })
      continue
    }
    if (codec.name === 'shuffle') {
      const elementBytes =
        typeof codec.configuration.elementsize === 'number'
          ? codec.configuration.elementsize
          : sampleBytes
      if (!Number.isSafeInteger(elementBytes) || elementBytes < 1) {
        throw invalidInput('Zarr shuffle elementsize is invalid')
      }
      current = unshuffle(current, elementBytes)
      continue
    }
    if (codec.name === 'crc32c') {
      current = decodeCrc32c(current)
      continue
    }
    if (codec.name === 'bytes') continue
    if (codec.name === 'transpose') {
      const order = integerTuple(
        codec.configuration.order,
        'Zarr transpose order',
        primary.length,
        true,
      )
      const matched = logicalShapes.find(
        (shape) =>
          checkedProduct([...shape, sampleBytes], 'Zarr transpose bytes') === current.byteLength,
      )
      if (matched === undefined) {
        throw invalidInput('Zarr transpose payload does not match the chunk shape')
      }
      current = decodeTranspose(current, matched, order, sampleBytes)
      continue
    }
    throw unsupportedOperation(`Zarr codec ${codec.name} is unsupported`)
  }
  if (current.byteLength > limits.maxDecodedChunkBytes) {
    throw limitExceeded(`Zarr decoded chunk exceeds ${limits.maxDecodedChunkBytes} bytes`)
  }
  const expected = logicalShapes.map((shape) => ({
    shape,
    bytes: checkedProduct([...shape, sampleBytes], 'Zarr decoded chunk bytes'),
  }))
  const matched = expected.find((candidate) => candidate.bytes === current.byteLength)
  if (matched === undefined) {
    throw invalidInput(
      `Zarr decoded chunk is ${current.byteLength} bytes; expected ${expected
        .map((candidate) => `${candidate.bytes} for ${candidate.shape.join('x')}`)
        .join(' or ')}`,
    )
  }
  return { data: current, shape: matched.shape }
}

const readUint64 = (view: DataView, offset: number, label: string): number | undefined => {
  const low = view.getUint32(offset, true)
  const high = view.getUint32(offset + 4, true)
  if (low === 0xffff_ffff && high === 0xffff_ffff) return undefined
  const value = high * 0x1_0000_0000 + low
  if (!Number.isSafeInteger(value)) throw limitExceeded(`${label} exceeds the safe integer range`)
  return value
}

const innerCounts = (
  shardShape: readonly number[],
  innerShape: readonly number[],
): readonly number[] => {
  if (shardShape.length !== innerShape.length) {
    throw invalidInput('Zarr shard chunk_shape rank does not match the array chunk grid')
  }
  return shardShape.map((outer, index) => {
    const inner = innerShape[index] ?? 0
    if (outer % inner !== 0) {
      throw invalidInput('Zarr shard shape is not divisible by the inner chunk shape')
    }
    return outer / inner
  })
}

const clippedChunkShape = (
  arrayShape: readonly number[],
  origin: readonly number[],
  chunkShape: readonly number[],
): readonly number[] =>
  chunkShape.map((size, axis) => {
    const available = (arrayShape[axis] ?? 0) - (origin[axis] ?? 0)
    if (available < 1) throw invalidInput('Zarr chunk origin is outside the array')
    return Math.min(size, available)
  })

interface DecodedShardIndex {
  readonly view: DataView
  readonly indexOffset: number
  readonly encodedIndexBytes: number
  readonly counts: readonly number[]
  readonly innerShape: readonly number[]
  readonly innerCodecs: readonly ZarrCodec[]
  readonly endian: ZarrEndian
}

let lastReadSessionStats: ZarrReadSessionStats | undefined

/** Package-private test instrumentation for plane-session high-water marks. */
export const lastZarrReadSessionStats = (): ZarrReadSessionStats | undefined => lastReadSessionStats

const loadShardIndex = async (
  source: ImageSource,
  codec: Readonly<ZarrCodec>,
  shardShape: readonly number[],
  limits: Readonly<ZarrStoreLimits>,
  signal?: AbortSignal,
  onRead?: () => void,
): Promise<DecodedShardIndex> => {
  const innerShape = integerTuple(
    codec.configuration.chunk_shape,
    'Zarr sharding chunk_shape',
    shardShape.length,
  )
  const counts = innerCounts(shardShape, innerShape)
  const innerCodecs = parseCodecs(codec.configuration.codecs, 'Zarr sharding codecs')
  const indexCodecs = parseCodecs(codec.configuration.index_codecs, 'Zarr sharding index_codecs')
  const location = codec.configuration.index_location ?? 'end'
  const innerCount = checkedProduct(counts, 'Zarr shard inner chunk count')
  const rawIndexBytes = checkedProduct([innerCount, 16], 'Zarr shard index bytes')
  const crcCount = indexCodecs.filter((entry) => entry.name === 'crc32c').length
  const encodedIndexBytes = rawIndexBytes + crcCount * 4
  if (
    rawIndexBytes > limits.maxDecodedChunkBytes ||
    encodedIndexBytes > limits.maxDecodedChunkBytes
  ) {
    throw limitExceeded(`Zarr shard index exceeds ${limits.maxDecodedChunkBytes} bytes`)
  }
  if (encodedIndexBytes > source.size) throw invalidInput('Zarr shard is smaller than its index')
  const indexOffset = location === 'end' ? source.size - encodedIndexBytes : 0
  const encodedIndex = await readExactly(source, indexOffset, encodedIndexBytes, {
    ...(signal === undefined ? {} : { signal }),
  })
  onRead?.()
  const index = await decodeBytesCodecs(
    encodedIndex,
    indexCodecs,
    [[innerCount, 2]],
    'uint64',
    limits,
    signal,
  )
  const indexEndian = parseEndian(indexCodecs, 'uint64')
  const indexBytes = indexEndian === 'big' ? swapEndian(index.data, 8) : index.data
  return {
    view: new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength),
    indexOffset,
    encodedIndexBytes,
    counts,
    innerShape,
    innerCodecs,
    endian: indexEndian,
  }
}

const lookupShardInner = (
  index: Readonly<DecodedShardIndex>,
  innerStart: readonly number[],
  sourceSize: number,
): { readonly offset: number; readonly bytes: number } | 'fill' => {
  for (let axis = 0; axis < index.counts.length; axis += 1) {
    const coord = innerStart[axis] ?? 0
    const limit = index.counts[axis] ?? 0
    if (!Number.isSafeInteger(coord) || coord < 0 || coord >= limit) {
      throw invalidInput('Zarr shard inner chunk index is outside the shard')
    }
  }
  let linear = 0
  let stride = 1
  for (let axis = index.counts.length - 1; axis >= 0; axis -= 1) {
    linear += (innerStart[axis] ?? 0) * stride
    stride *= index.counts[axis] ?? 1
  }
  const entry = linear * 16
  const payloadOffset = readUint64(index.view, entry, 'Zarr shard chunk offset')
  const payloadBytes = readUint64(index.view, entry + 8, 'Zarr shard chunk size')
  const offsetMissing = payloadOffset === undefined
  const lengthMissing = payloadBytes === undefined
  if (offsetMissing && lengthMissing) return 'fill'
  if (offsetMissing || lengthMissing) {
    throw invalidInput('Zarr shard index mixes a missing-chunk sentinel with a defined field')
  }
  if (payloadBytes === 0) {
    throw invalidInput('Zarr shard inner chunk has a zero-length payload')
  }
  if (payloadBytes > sourceSize || payloadOffset > sourceSize - payloadBytes) {
    throw invalidInput('Zarr shard inner chunk extends outside the shard')
  }
  const payloadEnd = payloadOffset + payloadBytes
  const indexEnd = index.indexOffset + index.encodedIndexBytes
  if (payloadOffset < indexEnd && payloadEnd > index.indexOffset) {
    throw invalidInput('Zarr shard inner chunk overlaps the shard index')
  }
  return { offset: payloadOffset, bytes: payloadBytes }
}

const decodeShardInner = async (
  source: ImageSource,
  index: Readonly<DecodedShardIndex>,
  innerStart: readonly number[],
  decodedInnerShape: readonly number[],
  sampleType: RasterSampleType,
  limits: Readonly<ZarrStoreLimits>,
  signal?: AbortSignal,
  onPayloadRead?: () => void,
): Promise<{ readonly data: Uint8Array; readonly shape: readonly number[] } | 'fill'> => {
  const lookup = lookupShardInner(index, innerStart, source.size)
  if (lookup === 'fill') return 'fill'
  if (lookup.bytes > limits.maxChunkBytes) {
    throw limitExceeded(`Zarr shard inner chunk exceeds ${limits.maxChunkBytes} bytes`)
  }
  const encoded = await readExactly(source, lookup.offset, lookup.bytes, {
    ...(signal === undefined ? {} : { signal }),
  })
  onPayloadRead?.()
  return decodeBytesCodecs(
    encoded,
    index.innerCodecs,
    [decodedInnerShape, index.innerShape],
    sampleType,
    limits,
    signal,
  )
}

const decodeRegularChunk = async (
  source: ImageSource,
  array: Readonly<ZarrArrayMetadata>,
  innerOrigin: readonly number[],
  limits: Readonly<ZarrStoreLimits>,
  signal?: AbortSignal,
): Promise<{ readonly data: Uint8Array; readonly shape: readonly number[] }> => {
  if (source.size > limits.maxChunkBytes) {
    throw limitExceeded(`Zarr chunk exceeds ${limits.maxChunkBytes} bytes`)
  }
  const encoded = await readExactly(source, 0, source.size, {
    ...(signal === undefined ? {} : { signal }),
  })
  return decodeBytesCodecs(
    encoded,
    array.codecs,
    [clippedChunkShape(array.shape, innerOrigin, array.chunkShape), array.chunkShape],
    array.dataType,
    limits,
    signal,
  )
}

const logicalChunkShape = (array: Readonly<ZarrArrayMetadata>): readonly number[] => {
  const sharding = array.codecs.find((codec) => codec.name === 'sharding_indexed')
  if (sharding === undefined) return array.chunkShape
  return integerTuple(
    sharding.configuration.chunk_shape,
    'Zarr sharding chunk_shape',
    array.chunkShape.length,
  )
}

const stepCoords = (
  coords: number[],
  first: readonly number[],
  last: readonly number[],
): boolean => {
  let axis = coords.length - 1
  while (axis >= 0) {
    const next = (coords[axis] ?? 0) + 1
    if (next <= (last[axis] ?? 0)) {
      coords[axis] = next
      return true
    }
    coords[axis] = first[axis] ?? 0
    axis -= 1
  }
  return false
}

const copyFromChunk = (
  output: Uint8Array,
  outputStart: readonly number[],
  outputShape: readonly number[],
  decoded: Uint8Array,
  chunkOrigin: readonly number[],
  chunkShape: readonly number[],
  copyStart: readonly number[],
  copyShape: readonly number[],
  sampleBytes: number,
  littleEndian: boolean,
): void => {
  if (copyShape.some((length) => length < 1)) return
  const outputCount = checkedProduct(outputShape, 'Zarr output element count')
  const coords = copyStart.slice()
  const end = copyStart.map((value, index) => value + (copyShape[index] ?? 0))
  const swap = littleEndian && sampleBytes > 1
  while (true) {
    let outputIndex = 0
    let chunkIndex = 0
    for (let axis = 0; axis < outputShape.length; axis += 1) {
      outputIndex =
        outputIndex * (outputShape[axis] ?? 1) + ((coords[axis] ?? 0) - (outputStart[axis] ?? 0))
      chunkIndex =
        chunkIndex * (chunkShape[axis] ?? 1) + ((coords[axis] ?? 0) - (chunkOrigin[axis] ?? 0))
    }
    if (outputIndex < 0 || outputIndex >= outputCount) {
      throw invalidInput('Zarr region copy left the output buffer')
    }
    const sourceOffset = chunkIndex * sampleBytes
    const destOffset = outputIndex * sampleBytes
    if (swap) {
      for (let byte = 0; byte < sampleBytes; byte += 1) {
        output[destOffset + byte] = decoded[sourceOffset + sampleBytes - byte - 1] ?? 0
      }
    } else {
      output.set(decoded.subarray(sourceOffset, sourceOffset + sampleBytes), destOffset)
    }
    let axis = coords.length - 1
    while (axis >= 0) {
      const next = (coords[axis] ?? 0) + 1
      if (next < (end[axis] ?? 0)) {
        coords[axis] = next
        break
      }
      coords[axis] = copyStart[axis] ?? 0
      axis -= 1
    }
    if (axis < 0) break
  }
}

const prefill = (output: Uint8Array, fill: ZarrFill, littleEndian: boolean): void => {
  if (fill.kind !== 'defined') return
  const canonical =
    littleEndian && fill.bytes.byteLength > 1
      ? swapEndian(fill.bytes, fill.bytes.byteLength)
      : fill.bytes
  for (let offset = 0; offset < output.byteLength; offset += canonical.byteLength) {
    output.set(canonical, offset)
  }
}

interface CacheEntry<T> {
  readonly value: T
  readonly bytes: number
}

class BoundedLru<T> {
  readonly #maxEntries: number
  readonly #maxBytes: number
  readonly #entries = new Map<string, CacheEntry<T>>()
  #bytes = 0
  #entryHighWater = 0
  #byteHighWater = 0

  constructor(maxEntries: number, maxBytes = Number.MAX_SAFE_INTEGER) {
    this.#maxEntries = Math.max(1, maxEntries)
    this.#maxBytes = Math.max(0, maxBytes)
  }

  get size(): number {
    return this.#entries.size
  }

  get bytes(): number {
    return this.#bytes
  }

  get maxBytes(): number {
    return this.#maxBytes
  }

  get entryHighWater(): number {
    return this.#entryHighWater
  }

  get byteHighWater(): number {
    return this.#byteHighWater
  }

  has(key: string): boolean {
    return this.#entries.has(key)
  }

  get(key: string): CacheEntry<T> | undefined {
    const entry = this.#entries.get(key)
    if (entry === undefined) return undefined
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry
  }

  #recordWater(): void {
    if (this.#entries.size > this.#entryHighWater) this.#entryHighWater = this.#entries.size
    if (this.#bytes > this.#byteHighWater) this.#byteHighWater = this.#bytes
  }

  #evictOldest(): boolean {
    const oldest = this.#entries.keys().next().value
    if (oldest === undefined) return false
    const entry = this.#entries.get(oldest)
    this.#entries.delete(oldest)
    this.#bytes -= entry?.bytes ?? 0
    if (this.#bytes < 0) this.#bytes = 0
    return true
  }

  set(key: string, value: T, bytes = 0): void {
    const existing = this.#entries.get(key)
    if (existing !== undefined) {
      this.#entries.delete(key)
      this.#bytes -= existing.bytes
      if (this.#bytes < 0) this.#bytes = 0
    }
    const weight = Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0
    if (weight > this.#maxBytes) return
    while (this.#entries.size >= this.#maxEntries || this.#bytes + weight > this.#maxBytes) {
      if (!this.#evictOldest()) break
    }
    if (this.#entries.size >= this.#maxEntries || this.#bytes + weight > this.#maxBytes) return
    this.#entries.set(key, { value, bytes: weight })
    this.#bytes += weight
    this.#recordWater()
  }

  clear(): void {
    this.#entries.clear()
    this.#bytes = 0
  }
}

interface SessionChunkHit {
  readonly hit: true
  readonly value: ZarrObject | undefined
}

interface SessionChunkMiss {
  readonly hit: false
}

class ZarrPlaneSession implements ZarrReadSession {
  readonly #chunks: BoundedLru<ZarrObject | undefined>
  readonly #indexes: BoundedLru<DecodedShardIndex>
  #transient:
    | {
        readonly key: string
        readonly resource: ZarrObject
        readonly bytes: number
        index?: DecodedShardIndex
        indexBytes: number
      }
    | undefined
  #chunkEntryHighWater = 0
  #chunkByteHighWater = 0
  #indexEntryHighWater = 0
  #indexByteHighWater = 0

  constructor(limits: Readonly<ZarrStoreLimits>) {
    this.#chunks = new BoundedLru(limits.maxOpenSources, limits.maxCachedChunkBytes)
    this.#indexes = new BoundedLru(limits.maxOpenSources, limits.maxCachedChunkBytes)
    this.#publishStats()
  }

  getChunk(key: string): SessionChunkHit | SessionChunkMiss {
    const cached = this.#chunks.get(key)
    if (cached !== undefined) return { hit: true, value: cached.value }
    if (this.#transient?.key === key) return { hit: true, value: this.#transient.resource }
    return { hit: false }
  }

  setChunk(key: string, resource: ZarrObject | undefined): void {
    const bytes = resource?.source.size ?? 0
    if (resource !== undefined && bytes > this.#chunks.maxBytes) {
      this.#transient = { key, resource, bytes, indexBytes: 0 }
      this.#publishStats()
      return
    }
    if (this.#transient?.key === key) this.#transient = undefined
    this.#chunks.set(key, resource, bytes)
    this.#publishStats()
  }

  getIndex(key: string): DecodedShardIndex | undefined {
    const cached = this.#indexes.get(key)
    if (cached !== undefined) return cached.value
    if (this.#transient?.key === key) return this.#transient.index
    return undefined
  }

  setIndex(key: string, index: DecodedShardIndex): void {
    const bytes = index.encodedIndexBytes
    if (this.#transient?.key === key) {
      this.#transient.index = index
      this.#transient.indexBytes = bytes
      this.#publishStats()
      return
    }
    this.#indexes.set(key, index, bytes)
    this.#publishStats()
  }

  release(): void {
    this.#chunks.clear()
    this.#indexes.clear()
    this.#transient = undefined
    this.#publishStats()
  }

  #retainedChunks(): { readonly entries: number; readonly bytes: number } {
    const extra = this.#transient === undefined ? 0 : 1
    const extraBytes = this.#transient?.bytes ?? 0
    return { entries: this.#chunks.size + extra, bytes: this.#chunks.bytes + extraBytes }
  }

  #retainedIndexes(): { readonly entries: number; readonly bytes: number } {
    const extra = this.#transient?.index === undefined ? 0 : 1
    const extraBytes = this.#transient?.indexBytes ?? 0
    return { entries: this.#indexes.size + extra, bytes: this.#indexes.bytes + extraBytes }
  }

  #publishStats(): void {
    const chunks = this.#retainedChunks()
    const indexes = this.#retainedIndexes()
    if (chunks.entries > this.#chunkEntryHighWater) this.#chunkEntryHighWater = chunks.entries
    if (chunks.bytes > this.#chunkByteHighWater) this.#chunkByteHighWater = chunks.bytes
    if (indexes.entries > this.#indexEntryHighWater) this.#indexEntryHighWater = indexes.entries
    if (indexes.bytes > this.#indexByteHighWater) this.#indexByteHighWater = indexes.bytes
    lastReadSessionStats = Object.freeze({
      chunkEntries: chunks.entries,
      chunkBytes: chunks.bytes,
      chunkEntryHighWater: this.#chunkEntryHighWater,
      chunkByteHighWater: this.#chunkByteHighWater,
      indexEntries: indexes.entries,
      indexBytes: indexes.bytes,
      indexEntryHighWater: this.#indexEntryHighWater,
      indexByteHighWater: this.#indexByteHighWater,
    })
  }
}

class ObservedZarrChunkSource implements ImageSource {
  readonly #source: ImageSource
  readonly #read: (bytes: number) => void
  readonly #cancel: () => void

  constructor(source: ImageSource, read: (bytes: number) => void, cancel: () => void) {
    this.#source = source
    this.#read = read
    this.#cancel = cancel
  }

  get size(): number {
    return this.#source.size
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    try {
      const bytes = await this.#source.read(offset, length, options)
      this.#read(bytes.byteLength)
      return bytes
    } catch (error) {
      if (options.signal?.aborted) this.#cancel()
      throw error
    }
  }
}

class ObjectZarrStore implements ZarrStore {
  readonly prefix: string
  readonly format: 2 | 3
  readonly identityKind: 'session' | 'archive'
  readonly #resolver: ZarrObjectStore
  readonly #limits: Readonly<ZarrStoreLimits>
  readonly #sessionResource: ZarrObject
  readonly #archiveResource: ZarrObject | undefined
  readonly #metadata = new BoundedLru<ZarrObject | undefined>(64)
  readonly #chunks: BoundedLru<ZarrObject | undefined>
  #metadataResolutions = 0
  #metadataCacheHits = 0
  #chunkCacheHits = 0
  #metadataReadRequests = 0
  #metadataReadBytes = 0
  #chunkReadRequests = 0
  #chunkReadBytes = 0
  #logicalChunkReads = 0
  #outerShardAccesses = 0
  readonly #uniqueShardObjects = new Set<string>()
  #shardIndexReads = 0
  #shardPayloadRanges = 0
  #cancelledReads = 0
  #closed = false

  constructor(
    resolver: ZarrObjectStore,
    prefix: string,
    limits: Readonly<ZarrStoreLimits>,
    format: 2 | 3,
    identityKind: 'session' | 'archive',
    archiveResource: ZarrObject | undefined,
  ) {
    this.#resolver = resolver
    this.prefix = prefix
    this.format = format
    this.identityKind = identityKind
    this.#limits = limits
    this.#chunks = new BoundedLru(limits.maxOpenSources, limits.maxCachedChunkBytes)
    this.#sessionResource = Object.freeze({
      id: `zarr-session:${prefix}:${format}:${Math.random().toString(36).slice(2)}`,
      name: 'zarr-session',
      source: new MemorySource(Uint8Array.of(1)),
    })
    this.#archiveResource = archiveResource
  }

  async resolve(relative: string, signal?: AbortSignal): Promise<ZarrObject | undefined> {
    this.#assertOpen()
    return this.#resolve(relative, 'metadata', signal)
  }

  createReadSession(): ZarrReadSession {
    this.#assertOpen()
    return new ZarrPlaneSession(this.#limits)
  }

  async #resolve(
    relative: string,
    kind: 'metadata' | 'chunk',
    signal?: AbortSignal,
    session?: ZarrReadSession,
  ): Promise<ZarrObject | undefined> {
    this.#assertOpen()
    const name = joinPath(this.prefix, relative)
    const plane = session instanceof ZarrPlaneSession ? session : undefined
    if (kind === 'chunk' && plane !== undefined) {
      const sessionHit = plane.getChunk(name)
      if (sessionHit.hit) {
        this.#chunkCacheHits += 1
        return sessionHit.value
      }
    }
    const cache = kind === 'metadata' ? this.#metadata : this.#chunks
    const cached = cache.get(name)
    if (cached !== undefined) {
      if (kind === 'metadata') this.#metadataCacheHits += 1
      else this.#chunkCacheHits += 1
      if (kind === 'chunk' && plane !== undefined) plane.setChunk(name, cached.value)
      return cached.value
    }
    if (kind === 'metadata') {
      this.#metadataResolutions += 1
      if (this.#metadataResolutions > this.#limits.maxStoreResolutions) {
        throw limitExceeded(
          `Zarr store exceeded ${this.#limits.maxStoreResolutions} companion resolutions`,
        )
      }
    }
    const resolved = await this.#resolver.resolve(name, signal)
    const resource =
      kind === 'chunk' && resolved !== undefined
        ? Object.freeze({
            ...resolved,
            source: new ObservedZarrChunkSource(
              resolved.source,
              (bytes) => {
                this.#chunkReadRequests += 1
                this.#chunkReadBytes += bytes
              },
              () => {
                this.#cancelledReads += 1
              },
            ),
          })
        : resolved
    cache.set(name, resource, resource?.source.size ?? 0)
    if (kind === 'chunk' && plane !== undefined) plane.setChunk(name, resource)
    return resource
  }

  async #readJsonBytes(
    relative: string,
    optional: boolean,
    signal?: AbortSignal,
  ): Promise<Uint8Array | undefined> {
    const resource = await this.#resolve(relative, 'metadata', signal)
    if (resource === undefined) {
      if (optional) return undefined
      throw invalidInput(`Zarr metadata ${relative} is missing`)
    }
    if (resource.source.size > this.#limits.maxMetadataBytes) {
      throw limitExceeded(
        `Zarr metadata ${relative} exceeds ${this.#limits.maxMetadataBytes} bytes`,
      )
    }
    if (optional && resource.source.size === 0) return undefined
    throwIfAborted(signal)
    try {
      const bytes = await readExactly(resource.source, 0, resource.source.size, {
        ...(signal === undefined ? {} : { signal }),
      })
      this.#metadataReadRequests += 1
      this.#metadataReadBytes += bytes.byteLength
      return bytes
    } catch (error) {
      if (signal?.aborted) this.#cancelledReads += 1
      throw error
    }
  }

  async readJson(relative: string, signal?: AbortSignal): Promise<unknown> {
    const bytes = await this.#readJsonBytes(relative, false, signal)
    if (bytes === undefined) throw invalidInput(`Zarr metadata ${relative} is missing`)
    const text = decodeZarrJsonText(bytes)
    if (text === undefined) throw invalidInput(`Zarr metadata ${relative} is not valid UTF-8`)
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw invalidInput(`Zarr metadata ${relative} is not valid JSON`)
    }
  }

  async readJsonOptional(relative: string, signal?: AbortSignal): Promise<unknown> {
    const bytes = await this.#readJsonBytes(relative, true, signal)
    if (bytes === undefined) return undefined
    const text = decodeZarrJsonText(bytes)
    if (text === undefined) throw invalidInput(`Zarr metadata ${relative} is not valid UTF-8`)
    if (text.trim().length === 0) return undefined
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw invalidInput(`Zarr metadata ${relative} is not valid JSON`)
    }
  }

  async openArray(relative: string, signal?: AbortSignal): Promise<ZarrArrayMetadata> {
    const json = await this.readJson(metadataKey(relative, this.format, 'array'), signal)
    const node = parseZarrNodeJson(json)
    if (node !== undefined && node.format !== this.format) {
      throw invalidInput(`Zarr array ${relative} format does not match the store`)
    }
    const parsed = parseArrayMetadata(json, relative)
    if (parsed.shape.length > this.#limits.maxDimensions) {
      throw limitExceeded(
        `Zarr array ${relative} rank exceeds ${this.#limits.maxDimensions} dimensions`,
      )
    }
    if (this.format === 2) {
      const attributes = await this.readJsonOptional(attributesKey(relative), signal)
      if (isRecord(attributes)) {
        const dimensionNames = parseDimensionNames(
          attributes._ARRAY_DIMENSIONS,
          parsed.shape.length,
          false,
        )
        return Object.freeze({
          ...parsed,
          ...(dimensionNames === undefined ? {} : { dimensionNames }),
          attributes: Object.freeze({ ...attributes }),
        })
      }
    }
    return parsed
  }

  async openGroup(relative: string, signal?: AbortSignal): Promise<ZarrGroupMetadata> {
    const json = await this.readJson(metadataKey(relative, this.format, 'group'), signal)
    const node = parseZarrNodeJson(json)
    if (node !== undefined && node.format !== this.format) {
      throw invalidInput(`Zarr group ${relative} format does not match the store`)
    }
    const parsed = parseGroupMetadata(json, relative)
    if (this.format === 2) {
      const attributes = await this.readJsonOptional(attributesKey(relative), signal)
      if (isRecord(attributes)) {
        return Object.freeze({ ...parsed, attributes: Object.freeze({ ...attributes }) })
      }
    }
    return parsed
  }

  async identityResources(
    paths: readonly string[],
    signal?: AbortSignal,
  ): Promise<readonly ZarrObject[]> {
    if (this.identityKind === 'archive' && this.#archiveResource !== undefined) {
      return Object.freeze([this.#archiveResource])
    }
    const resources: ZarrObject[] = [this.#sessionResource]
    const seen = new Set<string>([this.#sessionResource.id])
    for (const path of paths) {
      const resource = await this.#resolve(path, 'metadata', signal)
      if (resource === undefined || seen.has(resource.id)) continue
      seen.add(resource.id)
      resources.push(resource)
    }
    return Object.freeze(resources)
  }

  async readRegion(
    array: Readonly<ZarrArrayMetadata>,
    start: readonly number[],
    shape: readonly number[],
    signal?: AbortSignal,
    session?: ZarrReadSession,
  ): Promise<Uint8Array> {
    this.#assertOpen()
    if (signal?.aborted) this.#cancelledReads += 1
    if (start.length !== array.shape.length || shape.length !== array.shape.length) {
      throw invalidInput('Zarr region rank does not match the array')
    }
    for (let axis = 0; axis < array.shape.length; axis += 1) {
      const origin = start[axis] ?? 0
      const length = shape[axis] ?? 0
      const available = array.shape[axis] ?? 0
      if (origin < 0 || length < 1 || origin + length > available) {
        throw invalidInput('Zarr region is outside the array')
      }
    }
    const sampleBytes = rasterSampleBytes(array.dataType)
    const outputBytes = checkedProduct([...shape, sampleBytes], 'Zarr region bytes')
    if (outputBytes > this.#limits.maxDecodedChunkBytes) {
      throw limitExceeded(`Zarr region exceeds ${this.#limits.maxDecodedChunkBytes} bytes`)
    }
    const output = new Uint8Array(outputBytes)
    prefill(output, array.fill, array.endian === 'little')
    const innerShape = logicalChunkShape(array)
    const shardShape = array.chunkShape
    const sharding = array.codecs.find((codec) => codec.name === 'sharding_indexed')
    const plane = session instanceof ZarrPlaneSession ? session : undefined
    const firstShard = start.map((value, axis) => Math.floor(value / (shardShape[axis] ?? 1)))
    const lastShard = start.map((value, axis) =>
      Math.floor((value + (shape[axis] ?? 1) - 1) / (shardShape[axis] ?? 1)),
    )
    const innersPerShard = shardShape.map((outer, axis) => outer / (innerShape[axis] ?? 1))
    const regionFirstInner = start.map((value, axis) => Math.floor(value / (innerShape[axis] ?? 1)))
    const regionLastInner = start.map((value, axis) =>
      Math.floor((value + (shape[axis] ?? 1) - 1) / (innerShape[axis] ?? 1)),
    )
    const shardCoords = firstShard.slice()
    do {
      throwIfAborted(signal)
      const key = chunkKey(array, shardCoords)
      const resource = await this.#resolve(key, 'chunk', signal, session)
      if (resource === undefined) {
        if (array.fill.kind === 'undefined') {
          throw invalidInput(`Zarr chunk ${key} is missing and fill_value is undefined`)
        }
        continue
      }
      if (resource.source.size === 0) {
        throw invalidInput(`Zarr chunk ${key} is an empty object`)
      }
      let shardIndex: DecodedShardIndex | undefined
      if (sharding !== undefined) {
        this.#outerShardAccesses += 1
        this.#uniqueShardObjects.add(key)
        shardIndex = plane?.getIndex(key)
        if (shardIndex === undefined) {
          shardIndex = await loadShardIndex(
            resource.source,
            sharding,
            array.chunkShape,
            this.#limits,
            signal,
            () => {
              this.#shardIndexReads += 1
            },
          )
          plane?.setIndex(key, shardIndex)
        }
      }
      const globalInnerOrigin = shardCoords.map(
        (coord, axis) => coord * (innersPerShard[axis] ?? 1),
      )
      const firstLocal = globalInnerOrigin.map(
        (origin, axis) => Math.max(regionFirstInner[axis] ?? 0, origin) - origin,
      )
      const lastLocal = globalInnerOrigin.map(
        (origin, axis) =>
          Math.min(regionLastInner[axis] ?? 0, origin + (innersPerShard[axis] ?? 1) - 1) - origin,
      )
      if (firstLocal.some((value, axis) => value > (lastLocal[axis] ?? 0))) continue
      const local = firstLocal.slice()
      do {
        throwIfAborted(signal)
        this.#logicalChunkReads += 1
        const innerStart = local
        const innerOrigin = local.map(
          (inner, axis) => ((globalInnerOrigin[axis] ?? 0) + inner) * (innerShape[axis] ?? 1),
        )
        const decodedInnerShape = clippedChunkShape(array.shape, innerOrigin, innerShape)
        const decoded =
          sharding === undefined || shardIndex === undefined
            ? await decodeRegularChunk(resource.source, array, innerOrigin, this.#limits, signal)
            : await decodeShardInner(
                resource.source,
                shardIndex,
                innerStart,
                decodedInnerShape,
                array.dataType,
                this.#limits,
                signal,
                () => {
                  this.#shardPayloadRanges += 1
                },
              )
        if (decoded === 'fill') {
          if (array.fill.kind === 'undefined') {
            throw invalidInput(`Zarr shard inner chunk is missing and fill_value is undefined`)
          }
          continue
        }
        const copyStart = start.map((value, axis) => Math.max(value, innerOrigin[axis] ?? 0))
        const copyEnd = start.map((value, axis) =>
          Math.min(
            value + (shape[axis] ?? 0),
            (innerOrigin[axis] ?? 0) + (decoded.shape[axis] ?? 0),
          ),
        )
        copyFromChunk(
          output,
          start,
          shape,
          decoded.data,
          innerOrigin,
          decoded.shape,
          copyStart,
          copyStart.map((value, axis) => (copyEnd[axis] ?? 0) - value),
          sampleBytes,
          array.endian === 'little',
        )
      } while (stepCoords(local, firstLocal, lastLocal))
    } while (stepCoords(shardCoords, firstShard, lastShard))
    return output
  }

  diagnostics(): ZarrStoreDiagnostics {
    return Object.freeze({
      prefix: this.prefix,
      format: this.format,
      identityKind: this.identityKind,
      metadataResolutions: this.#metadataResolutions,
      metadataCacheHits: this.#metadataCacheHits,
      metadataCacheEntries: this.#metadata.size,
      chunkCacheHits: this.#chunkCacheHits,
      chunkCacheEntries: this.#chunks.size,
      chunkCacheBytes: this.#chunks.bytes,
      metadataReadRequests: this.#metadataReadRequests,
      metadataReadBytes: this.#metadataReadBytes,
      chunkReadRequests: this.#chunkReadRequests,
      chunkReadBytes: this.#chunkReadBytes,
      logicalChunkReads: this.#logicalChunkReads,
      outerShardAccesses: this.#outerShardAccesses,
      uniqueShardObjects: this.#uniqueShardObjects.size,
      shardIndexReads: this.#shardIndexReads,
      shardPayloadRanges: this.#shardPayloadRanges,
      cancelledReads: this.#cancelledReads,
      closed: this.#closed,
    })
  }

  close(): void | Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#metadata.clear()
    this.#chunks.clear()
    return this.#resolver.close?.()
  }

  #assertOpen(): void {
    if (this.#closed) throw invalidInput('Zarr store is closed')
  }
}

export interface ZarrStoreOptions {
  readonly identityKind?: 'session' | 'archive'
  readonly archiveResource?: ZarrObject
}

export const createZarrStore = (
  resolver: ZarrObjectStore,
  primaryName: string | undefined,
  limits: Readonly<ZarrStoreLimits>,
  format: 2 | 3 = 3,
  options: Readonly<ZarrStoreOptions> = {},
): ZarrStore =>
  new ObjectZarrStore(
    resolver,
    zarrStorePrefix(primaryName),
    limits,
    format,
    options.identityKind ?? 'session',
    options.archiveResource,
  )

const siblingMetadataObject = (name: string, sibling: string): string => {
  const slash = name.lastIndexOf('/')
  return slash < 0 ? sibling : `${name.slice(0, slash + 1)}${sibling}`
}

const rootMetadataCandidates = (primaryName: string | undefined): readonly string[] => {
  if (primaryName === undefined || primaryName.length === 0) {
    return Object.freeze(['zarr.json', '.zgroup', '.zarray'])
  }
  const name = normalizeZarrObjectPath(primaryName)
  const leaf = name.slice(name.lastIndexOf('/') + 1)
  if (leaf === '.zattrs') {
    return Object.freeze([
      siblingMetadataObject(name, '.zgroup'),
      siblingMetadataObject(name, '.zarray'),
    ])
  }
  if (leaf === 'zarr.json' || leaf === '.zgroup' || leaf === '.zarray') {
    return Object.freeze([name])
  }
  return Object.freeze([`${name}/zarr.json`, `${name}/.zgroup`, `${name}/.zarray`])
}

const readRootObject = async (
  objectStore: ZarrObjectStore,
  name: string,
  limits: Readonly<ZarrStoreLimits>,
  signal?: AbortSignal,
): Promise<unknown> => {
  const object = await objectStore.resolve(name, signal)
  if (object === undefined) return undefined
  if (object.source.size > limits.maxMetadataBytes) {
    throw limitExceeded(`Zarr root metadata ${name} exceeds ${limits.maxMetadataBytes} bytes`)
  }
  const bytes = await readExactly(object.source, 0, object.source.size, {
    ...(signal === undefined ? {} : { signal }),
  })
  const text = decodeZarrJsonText(bytes)
  if (text === undefined) throw invalidInput(`Zarr root metadata ${name} is not valid UTF-8`)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw invalidInput(`Zarr root metadata ${name} is not valid JSON`)
  }
}

/** Discover and open a v2 or v3 root without applying OME-NGFF or GeoZarr semantics. */
export const discoverZarrRoot = async (
  objectStore: ZarrObjectStore,
  primaryName: string | undefined,
  limits: Readonly<ZarrStoreLimits>,
  signal?: AbortSignal,
): Promise<ZarrRoot> => {
  for (const metadataObject of rootMetadataCandidates(primaryName)) {
    throwIfAborted(signal)
    const json = await readRootObject(objectStore, metadataObject, limits, signal)
    if (json === undefined) continue
    const node = parseZarrNodeJson(json)
    if (node === undefined) {
      throw invalidInput(`Zarr root metadata ${metadataObject} does not describe a v2 or v3 node`)
    }
    const store = createZarrStore(objectStore, metadataObject, limits, node.format)
    const metadata =
      node.nodeType === 'array'
        ? await store.openArray('', signal)
        : await store.openGroup('', signal)
    return Object.freeze({ metadataObject, ...node, store, metadata })
  }
  throw invalidInput('Zarr store has no v2 or v3 root metadata object')
}

const decodeZarrJsonText = (bytes: Uint8Array): string | undefined => {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  } catch {
    return undefined
  }
}

export const readZarrJsonBytes = (bytes: Uint8Array): unknown => {
  const text = decodeZarrJsonText(bytes)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}
