import { throwIfAborted } from '../../abort.ts'
import { decodeZstd } from '../../compression/zstd/index.ts'
import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { RasterSampleType } from '../../raster.ts'
import { rasterSampleBytes } from '../../raster.ts'
import { type ImageSource, readExactly } from '../../source.ts'
import type { ScientificCompanionResolver, ScientificResource } from '../reader.ts'
import { normalizeScientificRelativeName } from '../reader.ts'
import { decodeBlosc } from './blosc.ts'
import { crc32c } from './crc32c.ts'

export type ZarrEndian = 'little' | 'big'

export interface ZarrCodec {
  readonly name: string
  readonly configuration: Readonly<Record<string, unknown>>
}

export interface ZarrArrayMetadata {
  readonly path: string
  readonly shape: readonly number[]
  readonly chunkShape: readonly number[]
  readonly dataType: RasterSampleType
  readonly endian: ZarrEndian
  readonly fillValue: number
  readonly fillBytes: Uint8Array
  readonly chunkKeyEncoding: 'default' | 'v2'
  readonly separator: string
  readonly codecs: readonly ZarrCodec[]
  readonly attributes: Readonly<Record<string, unknown>>
}

export interface ZarrGroupMetadata {
  readonly path: string
  readonly attributes: Readonly<Record<string, unknown>>
}

export interface ZarrStoreLimits {
  readonly maxMetadataBytes: number
  readonly maxDimensions: number
  readonly maxChunkBytes: number
  readonly maxDecodedChunkBytes: number
  readonly maxOpenSources: number
  readonly maxStoreResolutions: number
}

export interface ZarrStore {
  readonly prefix: string
  readonly format: 2 | 3
  resolve(relative: string, signal?: AbortSignal): Promise<ScientificResource | undefined>
  readJson(relative: string, signal?: AbortSignal): Promise<unknown>
  readJsonOptional(relative: string, signal?: AbortSignal): Promise<unknown>
  openArray(relative: string, signal?: AbortSignal): Promise<ZarrArrayMetadata>
  openGroup(relative: string, signal?: AbortSignal): Promise<ZarrGroupMetadata>
  readRegion(
    array: Readonly<ZarrArrayMetadata>,
    start: readonly number[],
    shape: readonly number[],
    signal?: AbortSignal,
  ): Promise<Uint8Array>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidInput(`${label} must be a non-empty string`)
  }
  return value
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
  const child = normalizeScientificRelativeName(relative)
  return prefix.length === 0 ? child : normalizeScientificRelativeName(`${prefix}/${child}`)
}

export const zarrStorePrefix = (primaryName: string | undefined): string => {
  if (primaryName === undefined || primaryName.length === 0) return ''
  const name = normalizeScientificRelativeName(primaryName)
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

const dataTypes: Readonly<Record<string, RasterSampleType>> = Object.freeze({
  int8: 'int8',
  uint8: 'uint8',
  int16: 'int16',
  uint16: 'uint16',
  int32: 'int32',
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

const writeNumericSample = (
  view: DataView,
  sampleType: RasterSampleType,
  value: number,
  littleEndian: boolean,
): void => {
  if (sampleType === 'uint8') view.setUint8(0, value)
  else if (sampleType === 'int8') view.setInt8(0, value)
  else if (sampleType === 'uint16') view.setUint16(0, value, littleEndian)
  else if (sampleType === 'int16') view.setInt16(0, value, littleEndian)
  else if (sampleType === 'uint32') view.setUint32(0, value, littleEndian)
  else if (sampleType === 'int32') view.setInt32(0, value, littleEndian)
  else if (sampleType === 'uint64') view.setBigUint64(0, BigInt(value), littleEndian)
  else if (sampleType === 'float16') {
    if (value !== 0) {
      throw unsupportedOperation('Zarr float16 fill values other than 0 are unsupported')
    }
    view.setUint16(0, 0, littleEndian)
  } else if (sampleType === 'float32') view.setFloat32(0, value, littleEndian)
  else view.setFloat64(0, value, littleEndian)
}

const writeIntegerBits = (
  bits: bigint,
  sampleType: RasterSampleType,
  littleEndian: boolean,
): Uint8Array => {
  const bytes = new Uint8Array(rasterSampleBytes(sampleType))
  const view = new DataView(bytes.buffer)
  const masked = bits & ((1n << BigInt(bytes.byteLength * 8)) - 1n)
  if (bytes.byteLength === 1) view.setUint8(0, Number(masked))
  else if (bytes.byteLength === 2) view.setUint16(0, Number(masked), littleEndian)
  else if (bytes.byteLength === 4) view.setUint32(0, Number(masked), littleEndian)
  else view.setBigUint64(0, masked, littleEndian)
  return bytes
}

const parseFillValue = (
  value: unknown,
  sampleType: RasterSampleType,
  littleEndian: boolean,
): { readonly numeric: number; readonly bytes: Uint8Array } => {
  const floating = isFloatSampleType(sampleType)
  let numeric: number
  let bytes: Uint8Array | undefined
  if (value === undefined || value === null) {
    numeric = floating && value === null ? Number.NaN : 0
  } else if (typeof value === 'number' && Number.isFinite(value)) numeric = value
  else if (typeof value === 'boolean') numeric = value ? 1 : 0
  else if (typeof value === 'string') {
    const trimmed = value.trim()
    const special = trimmed.toLowerCase()
    if (special === 'nan') {
      if (!floating) throw invalidInput(`Zarr fill_value ${value} is invalid for ${sampleType}`)
      numeric = Number.NaN
    } else if (
      special === 'infinity' ||
      special === '+infinity' ||
      special === 'inf' ||
      special === '+inf'
    ) {
      if (!floating) throw invalidInput(`Zarr fill_value ${value} is invalid for ${sampleType}`)
      numeric = Number.POSITIVE_INFINITY
    } else if (special === '-infinity' || special === '-inf') {
      if (!floating) throw invalidInput(`Zarr fill_value ${value} is invalid for ${sampleType}`)
      numeric = Number.NEGATIVE_INFINITY
    } else {
      const hex = /^0x([0-9a-fA-F]+)$/u.exec(trimmed)
      if (hex !== null) {
        if (floating) throw invalidInput(`Zarr fill_value ${value} is invalid for ${sampleType}`)
        const bits = BigInt(`0x${hex[1]}`)
        bytes = writeIntegerBits(bits, sampleType, littleEndian)
        numeric = Number(bits)
      } else {
        const parsed = Number(trimmed)
        if (trimmed.length === 0 || !Number.isFinite(parsed)) {
          throw invalidInput('Zarr fill_value is unsupported')
        }
        numeric = parsed
      }
    }
  } else throw invalidInput('Zarr fill_value is unsupported')
  if (bytes === undefined) {
    if (!floating && !Number.isInteger(numeric)) {
      throw invalidInput(`Zarr fill_value ${String(value)} is invalid for ${sampleType}`)
    }
    bytes = new Uint8Array(rasterSampleBytes(sampleType))
    writeNumericSample(new DataView(bytes.buffer), sampleType, numeric, littleEndian)
  }
  return { numeric, bytes }
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
  if (
    format === undefined &&
    (Array.isArray(value.multiscales) ||
      Array.isArray(value.labels) ||
      isRecord(value.plate) ||
      isRecord(value.well) ||
      isRecord(value['image-label']) ||
      ((typeof value['bioformats2raw.layout'] === 'number' ||
        typeof value['bioformats2raw.layout'] === 'string') &&
        Number.isSafeInteger(Number(value['bioformats2raw.layout'])) &&
        Number(value['bioformats2raw.layout']) > 0))
  ) {
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
  const fill = parseFillValue(value.fill_value, dtype.sampleType, dtype.littleEndian)
  return Object.freeze({
    path,
    shape,
    chunkShape,
    dataType: dtype.sampleType,
    endian: dtype.littleEndian ? 'little' : 'big',
    fillValue: fill.numeric,
    fillBytes: fill.bytes,
    chunkKeyEncoding: 'v2',
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
  const endian = parseEndian(codecs, dataType)
  const fill = parseFillValue(value.fill_value, dataType, endian === 'little')
  const attributes = isRecord(value.attributes) ? Object.freeze({ ...value.attributes }) : {}
  return Object.freeze({
    path,
    shape,
    chunkShape,
    dataType,
    endian,
    fillValue: fill.numeric,
    fillBytes: fill.bytes,
    chunkKeyEncoding: keyEncoding.name,
    separator: keyEncoding.separator,
    codecs,
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

const decodeShard = async (
  source: ImageSource,
  codec: Readonly<ZarrCodec>,
  shardShape: readonly number[],
  sampleType: RasterSampleType,
  innerStart: readonly number[],
  decodedInnerShape: readonly number[],
  limits: Readonly<ZarrStoreLimits>,
  signal?: AbortSignal,
): Promise<{ readonly data: Uint8Array; readonly shape: readonly number[] }> => {
  const innerShape = integerTuple(
    codec.configuration.chunk_shape,
    'Zarr sharding chunk_shape',
    shardShape.length,
  )
  const counts = innerCounts(shardShape, innerShape)
  const innerCodecs = parseCodecs(codec.configuration.codecs, 'Zarr sharding codecs')
  const indexCodecs = parseCodecs(codec.configuration.index_codecs, 'Zarr sharding index_codecs')
  const location = codec.configuration.index_location ?? 'end'
  if (location !== 'end' && location !== 'start') {
    throw unsupportedOperation(`Zarr sharding index_location ${String(location)} is unsupported`)
  }
  if (indexCodecs.some((entry) => entry.name !== 'bytes' && entry.name !== 'crc32c')) {
    throw unsupportedOperation(
      `Zarr sharding index codecs ${indexCodecs.map((entry) => entry.name).join(', ')} are unsupported`,
    )
  }
  const innerCount = checkedProduct(counts, 'Zarr shard inner chunk count')
  const rawIndexBytes = checkedProduct([innerCount, 16], 'Zarr shard index bytes')
  const crcCount = indexCodecs.filter((entry) => entry.name === 'crc32c').length
  const encodedIndexBytes = rawIndexBytes + crcCount * 4
  if (encodedIndexBytes > source.size) throw invalidInput('Zarr shard is smaller than its index')
  const indexOffset = location === 'end' ? source.size - encodedIndexBytes : 0
  const encodedIndex = await readExactly(source, indexOffset, encodedIndexBytes, {
    ...(signal === undefined ? {} : { signal }),
  })
  const index = await decodeBytesCodecs(
    encodedIndex,
    indexCodecs,
    [[innerCount, 2]],
    'uint64',
    limits,
    signal,
  )
  const indexEndian = indexCodecs.find((entry) => entry.name === 'bytes')?.configuration.endian
  const indexBytes = indexEndian === 'big' ? swapEndian(index.data, 8) : index.data
  const view = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength)
  for (let axis = 0; axis < counts.length; axis += 1) {
    const coord = innerStart[axis] ?? 0
    const limit = counts[axis] ?? 0
    if (!Number.isSafeInteger(coord) || coord < 0 || coord >= limit) {
      throw invalidInput('Zarr shard inner chunk index is outside the shard')
    }
  }
  let linear = 0
  let stride = 1
  for (let axis = counts.length - 1; axis >= 0; axis -= 1) {
    linear += (innerStart[axis] ?? 0) * stride
    stride *= counts[axis] ?? 1
  }
  const entry = linear * 16
  const payloadOffset = readUint64(view, entry, 'Zarr shard chunk offset')
  const payloadBytes = readUint64(view, entry + 8, 'Zarr shard chunk size')
  if (payloadOffset === undefined || payloadBytes === undefined || payloadBytes === 0) {
    return { data: new Uint8Array(0), shape: decodedInnerShape }
  }
  if (payloadBytes > limits.maxChunkBytes) {
    throw limitExceeded(`Zarr shard inner chunk exceeds ${limits.maxChunkBytes} bytes`)
  }
  if (payloadBytes > source.size || payloadOffset > source.size - payloadBytes) {
    throw invalidInput('Zarr shard inner chunk extends outside the shard')
  }
  const payloadEnd = payloadOffset + payloadBytes
  const indexEnd = indexOffset + encodedIndexBytes
  if (payloadOffset < indexEnd && payloadEnd > indexOffset) {
    throw invalidInput('Zarr shard inner chunk overlaps the shard index')
  }
  const encoded = await readExactly(source, payloadOffset, payloadBytes, {
    ...(signal === undefined ? {} : { signal }),
  })
  return decodeBytesCodecs(
    encoded,
    innerCodecs,
    [decodedInnerShape, innerShape],
    sampleType,
    limits,
    signal,
  )
}

const decodeChunkObject = async (
  source: ImageSource,
  array: Readonly<ZarrArrayMetadata>,
  innerStart: readonly number[],
  innerOrigin: readonly number[],
  limits: Readonly<ZarrStoreLimits>,
  signal?: AbortSignal,
): Promise<{ readonly data: Uint8Array; readonly shape: readonly number[] }> => {
  const last = array.codecs[array.codecs.length - 1]
  if (last?.name === 'sharding_indexed') {
    if (array.codecs.length !== 1) {
      throw unsupportedOperation(
        `Zarr codecs surrounding sharding_indexed (${array.codecs.map((codec) => codec.name).join(', ')}) are unsupported`,
      )
    }
    const nominal = logicalChunkShape(array)
    return decodeShard(
      source,
      last,
      array.chunkShape,
      array.dataType,
      innerStart,
      clippedChunkShape(array.shape, innerOrigin, nominal),
      limits,
      signal,
    )
  }
  if (array.codecs.some((codec) => codec.name === 'sharding_indexed')) {
    throw unsupportedOperation(
      `Zarr codec pipeline ${array.codecs.map((codec) => codec.name).join(', ')} is unsupported`,
    )
  }
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

const prefill = (output: Uint8Array, fillBytes: Uint8Array, littleEndian: boolean): void => {
  const canonical =
    littleEndian && fillBytes.byteLength > 1
      ? swapEndian(fillBytes, fillBytes.byteLength)
      : fillBytes
  for (let offset = 0; offset < output.byteLength; offset += canonical.byteLength) {
    output.set(canonical, offset)
  }
}

class CompanionZarrStore implements ZarrStore {
  readonly prefix: string
  readonly format: 2 | 3
  readonly #resolver: ScientificCompanionResolver
  readonly #limits: Readonly<ZarrStoreLimits>
  readonly #resources = new Map<string, ScientificResource | undefined>()
  #resolutions = 0

  constructor(
    resolver: ScientificCompanionResolver,
    prefix: string,
    limits: Readonly<ZarrStoreLimits>,
    format: 2 | 3,
  ) {
    this.#resolver = resolver
    this.prefix = prefix
    this.format = format
    this.#limits = limits
  }

  async resolve(relative: string, signal?: AbortSignal): Promise<ScientificResource | undefined> {
    const name = joinPath(this.prefix, relative)
    const cached = this.#resources.get(name)
    if (cached !== undefined || this.#resources.has(name)) return cached
    this.#resolutions += 1
    if (this.#resolutions > this.#limits.maxStoreResolutions) {
      throw limitExceeded(
        `Zarr store exceeded ${this.#limits.maxStoreResolutions} companion resolutions`,
      )
    }
    if (this.#resources.size >= this.#limits.maxOpenSources) {
      throw limitExceeded(`Zarr store exceeded ${this.#limits.maxOpenSources} open sources`)
    }
    const resource = await this.#resolver.resolve(
      { kind: 'relative-name', name },
      signal === undefined ? {} : { signal },
    )
    this.#resources.set(name, resource)
    return resource
  }

  async readJson(relative: string, signal?: AbortSignal): Promise<unknown> {
    const resource = await this.resolve(relative, signal)
    if (resource === undefined) throw invalidInput(`Zarr metadata ${relative} is missing`)
    if (resource.source.size > this.#limits.maxMetadataBytes) {
      throw limitExceeded(
        `Zarr metadata ${relative} exceeds ${this.#limits.maxMetadataBytes} bytes`,
      )
    }
    const bytes = await readExactly(resource.source, 0, resource.source.size, {
      ...(signal === undefined ? {} : { signal }),
    })
    const text = decodeZarrJsonText(bytes)
    if (text === undefined) throw invalidInput(`Zarr metadata ${relative} is not valid UTF-8`)
    try {
      return JSON.parse(text) as unknown
    } catch {
      throw invalidInput(`Zarr metadata ${relative} is not valid JSON`)
    }
  }

  async readJsonOptional(relative: string, signal?: AbortSignal): Promise<unknown> {
    const resource = await this.resolve(relative, signal)
    if (resource === undefined || resource.source.size === 0) return undefined
    const bytes = await readExactly(resource.source, 0, resource.source.size, {
      ...(signal === undefined ? {} : { signal }),
    })
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
    const parsed = parseArrayMetadata(
      await this.readJson(metadataKey(relative, this.format, 'array'), signal),
      relative,
    )
    if (this.format === 2) {
      const attributes = await this.readJsonOptional(attributesKey(relative), signal)
      if (isRecord(attributes)) {
        return Object.freeze({ ...parsed, attributes: Object.freeze({ ...attributes }) })
      }
    }
    return parsed
  }

  async openGroup(relative: string, signal?: AbortSignal): Promise<ZarrGroupMetadata> {
    const parsed = parseGroupMetadata(
      await this.readJson(metadataKey(relative, this.format, 'group'), signal),
      relative,
    )
    if (this.format === 2) {
      const attributes = await this.readJsonOptional(attributesKey(relative), signal)
      if (isRecord(attributes)) {
        return Object.freeze({ ...parsed, attributes: Object.freeze({ ...attributes }) })
      }
    }
    return parsed
  }

  async readRegion(
    array: Readonly<ZarrArrayMetadata>,
    start: readonly number[],
    shape: readonly number[],
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
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
    prefill(output, array.fillBytes, array.endian === 'little')
    const innerShape = logicalChunkShape(array)
    const shardShape = array.chunkShape
    const first = start.map((value, axis) => Math.floor(value / (innerShape[axis] ?? 1)))
    const last = start.map((value, axis) =>
      Math.floor((value + (shape[axis] ?? 1) - 1) / (innerShape[axis] ?? 1)),
    )
    const innerCoords = first.slice()
    while (true) {
      throwIfAborted(signal)
      const innerOrigin = innerCoords.map((index, axis) => index * (innerShape[axis] ?? 1))
      const shardCoords = innerOrigin.map((origin, axis) =>
        Math.floor(origin / (shardShape[axis] ?? 1)),
      )
      const innerStart = innerCoords.map((index, axis) => {
        const perShard = (shardShape[axis] ?? 1) / (innerShape[axis] ?? 1)
        return index - Math.floor(index / perShard) * perShard
      })
      const resource = await this.resolve(chunkKey(array, shardCoords), signal)
      const copyStart = start.map((value, axis) => Math.max(value, innerOrigin[axis] ?? 0))
      if (resource !== undefined && resource.source.size > 0) {
        const decoded = await decodeChunkObject(
          resource.source,
          array,
          innerStart,
          innerOrigin,
          this.#limits,
          signal,
        )
        if (decoded.data.byteLength > 0) {
          const copyEnd = start.map((value, axis) =>
            Math.min(
              value + (shape[axis] ?? 0),
              (innerOrigin[axis] ?? 0) + (decoded.shape[axis] ?? 0),
            ),
          )
          const adjustedCopy = copyStart.map((value, axis) => (copyEnd[axis] ?? 0) - value)
          copyFromChunk(
            output,
            start,
            shape,
            decoded.data,
            innerOrigin,
            decoded.shape,
            copyStart,
            adjustedCopy,
            sampleBytes,
            array.endian === 'little',
          )
        }
      }
      let axis = innerCoords.length - 1
      while (axis >= 0) {
        const next = (innerCoords[axis] ?? 0) + 1
        if (next <= (last[axis] ?? 0)) {
          innerCoords[axis] = next
          break
        }
        innerCoords[axis] = first[axis] ?? 0
        axis -= 1
      }
      if (axis < 0) break
    }
    return output
  }
}

export const createZarrStore = (
  resolver: ScientificCompanionResolver,
  primaryName: string | undefined,
  limits: Readonly<ZarrStoreLimits>,
  format: 2 | 3 = 3,
): ZarrStore => new CompanionZarrStore(resolver, zarrStorePrefix(primaryName), limits, format)

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
