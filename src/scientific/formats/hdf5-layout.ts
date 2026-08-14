import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { Hdf5Dataspace, Hdf5Datatype } from './hdf5-dataset.ts'
import type { Hdf5IntegerWidth } from './hdf5.ts'

export interface Hdf5DatasetStorageLimits {
  readonly maxStorageBytes?: number
  readonly maxChunkBytes?: number
  readonly maxCompactBytes?: number
  readonly maxFillValueBytes?: number
}

export interface Hdf5CompactLayout {
  readonly kind: 'compact'
  readonly version: 1 | 2 | 3 | 4
  readonly storageBytes: number
  readonly data: Uint8Array<ArrayBuffer>
}

export interface Hdf5ContiguousLayout {
  readonly kind: 'contiguous'
  readonly version: 1 | 2 | 3 | 4
  readonly address: bigint | undefined
  readonly storageBytes: number
}

interface Hdf5ChunkIndexBase {
  readonly address: bigint | undefined
}

export interface Hdf5ChunkBtreeV1Index extends Hdf5ChunkIndexBase {
  readonly kind: 'btree-v1'
}

export interface Hdf5SingleChunkIndex extends Hdf5ChunkIndexBase {
  readonly kind: 'single'
  readonly filteredChunkBytes: number | undefined
  readonly filterMask: number | undefined
}

export interface Hdf5ImplicitChunkIndex extends Hdf5ChunkIndexBase {
  readonly kind: 'implicit'
}

export interface Hdf5FixedArrayChunkIndex extends Hdf5ChunkIndexBase {
  readonly kind: 'fixed-array'
  readonly pageBits: number
}

export interface Hdf5ExtensibleArrayChunkIndex extends Hdf5ChunkIndexBase {
  readonly kind: 'extensible-array'
  readonly maxBits: number
  readonly indexElements: number
  readonly minPointers: number
  readonly minElements: number
  readonly pageBits: number
}

export interface Hdf5BtreeV2ChunkIndex extends Hdf5ChunkIndexBase {
  readonly kind: 'btree-v2'
  readonly nodeBytes: number
  readonly splitPercent: number
  readonly mergePercent: number
}

export type Hdf5ChunkIndex =
  | Hdf5ChunkBtreeV1Index
  | Hdf5SingleChunkIndex
  | Hdf5ImplicitChunkIndex
  | Hdf5FixedArrayChunkIndex
  | Hdf5ExtensibleArrayChunkIndex
  | Hdf5BtreeV2ChunkIndex

export interface Hdf5ChunkedLayout {
  readonly kind: 'chunked'
  readonly version: 1 | 2 | 3 | 4
  readonly chunkDimensions: readonly number[]
  readonly elementBytes: number
  readonly chunkBytes: number
  readonly partialEdgeChunksFiltered: boolean
  readonly index: Hdf5ChunkIndex
}

export type Hdf5DatasetLayout = Hdf5CompactLayout | Hdf5ContiguousLayout | Hdf5ChunkedLayout

export type Hdf5FillAllocation = 'unused' | 'early' | 'late' | 'incremental'
export type Hdf5FillWriteTime = 'on-allocation' | 'never' | 'if-set'

export interface Hdf5FillValue {
  readonly version: 'absent' | 'old' | 1 | 2 | 3
  readonly status: 'default-zero' | 'undefined' | 'defined'
  readonly allocation: Hdf5FillAllocation | undefined
  readonly writeTime: Hdf5FillWriteTime | undefined
  readonly value: Uint8Array<ArrayBuffer> | undefined
}

interface ResolvedStorageLimits {
  readonly maxStorageBytes: number
  readonly maxChunkBytes: number
  readonly maxCompactBytes: number
  readonly maxFillValueBytes: number
}

const defaultLimits: ResolvedStorageLimits = Object.freeze({
  maxStorageBytes: Number.MAX_SAFE_INTEGER,
  maxChunkBytes: 268_435_456,
  maxCompactBytes: 65_536,
  maxFillValueBytes: 16_777_216,
})

const positiveSafeInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const resolveLimits = (options: Readonly<Hdf5DatasetStorageLimits>): ResolvedStorageLimits =>
  Object.freeze({
    maxStorageBytes: positiveSafeInteger(
      'HDF5 dataset maxStorageBytes',
      options.maxStorageBytes ?? defaultLimits.maxStorageBytes,
    ),
    maxChunkBytes: positiveSafeInteger(
      'HDF5 dataset maxChunkBytes',
      options.maxChunkBytes ?? defaultLimits.maxChunkBytes,
    ),
    maxCompactBytes: positiveSafeInteger(
      'HDF5 dataset maxCompactBytes',
      options.maxCompactBytes ?? defaultLimits.maxCompactBytes,
    ),
    maxFillValueBytes: positiveSafeInteger(
      'HDF5 dataset maxFillValueBytes',
      options.maxFillValueBytes ?? defaultLimits.maxFillValueBytes,
    ),
  })

const requireBytes = (bytes: Uint8Array, offset: number, length: number, label: string): void => {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw invalidInput(`${label} is truncated`)
  }
}

const allZero = (bytes: Uint8Array, offset: number): boolean => {
  for (let index = offset; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 0) return false
  }
  return true
}

const littleEndianUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)

const littleEndianUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0

const littleEndianUnsigned = (bytes: Uint8Array, offset: number, width: number): bigint => {
  let value = 0n
  for (let index = width - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  }
  return value
}

const undefinedAddress = (width: number): bigint => (1n << BigInt(width * 8)) - 1n

const optionalAddress = (bytes: Uint8Array, offset: number, width: number): bigint | undefined => {
  const value = littleEndianUnsigned(bytes, offset, width)
  return value === undefinedAddress(width) ? undefined : value
}

const boundedNumber = (value: bigint, maximum: number, label: string): number => {
  if (value > BigInt(maximum)) {
    throw limitExceeded(`${label} ${value} exceeds limit ${maximum}`)
  }
  return Number(value)
}

const datasetStorageBytes = (
  dataspace: Hdf5Dataspace,
  datatype: Hdf5Datatype,
  maximum: number,
): number => {
  const value = BigInt(dataspace.elementCount) * BigInt(datatype.byteLength)
  return boundedNumber(value, maximum, 'HDF5 dataset storage bytes')
}

const requireDimensions = (
  actual: readonly number[],
  expected: readonly number[],
  label: string,
): void => {
  if (
    actual.length !== expected.length ||
    actual.some((dimension, index) => dimension !== expected[index])
  ) {
    throw invalidInput(`${label} dimensions do not match the dataset dataspace`)
  }
}

const readUint32Dimensions = (
  bytes: Uint8Array,
  offset: number,
  count: number,
  label: string,
): readonly number[] => {
  requireBytes(bytes, offset, count * 4, label)
  const dimensions: number[] = []
  for (let index = 0; index < count; index += 1) {
    dimensions.push(littleEndianUint32(bytes, offset + index * 4))
  }
  return Object.freeze(dimensions)
}

const chunkGeometry = (
  dimensions: readonly number[],
  datatype: Hdf5Datatype,
  limits: ResolvedStorageLimits,
): {
  readonly dimensions: readonly number[]
  readonly elementBytes: number
  readonly chunkBytes: number
} => {
  if (dimensions.length < 2) {
    throw invalidInput('HDF5 chunked layout must contain a dimension and element size')
  }
  const elementBytes = dimensions[dimensions.length - 1] ?? 0
  if (elementBytes !== datatype.byteLength) {
    throw invalidInput('HDF5 chunked layout element size does not match the datatype')
  }
  const chunkDimensions = dimensions.slice(0, -1)
  let chunkBytes = BigInt(elementBytes)
  for (let index = 0; index < chunkDimensions.length; index += 1) {
    const dimension = chunkDimensions[index] ?? 0
    if (dimension < 1) throw invalidInput(`HDF5 chunk dimension ${index} must be positive`)
    chunkBytes *= BigInt(dimension)
    if (chunkBytes > BigInt(limits.maxChunkBytes)) {
      throw limitExceeded(
        `HDF5 decoded chunk bytes ${chunkBytes} exceed limit ${limits.maxChunkBytes}`,
      )
    }
  }
  return Object.freeze({
    dimensions: Object.freeze(chunkDimensions),
    elementBytes,
    chunkBytes: Number(chunkBytes),
  })
}

const parseLegacyLayout = (
  bytes: Uint8Array,
  version: 1 | 2,
  offsetSize: Hdf5IntegerWidth,
  dataspace: Hdf5Dataspace,
  datatype: Hdf5Datatype,
  limits: ResolvedStorageLimits,
): Hdf5DatasetLayout => {
  requireBytes(bytes, 0, 8, `HDF5 layout version ${version}`)
  if (!allZero(bytes.subarray(3, 8), 0)) {
    throw invalidInput(`HDF5 layout version ${version} reserved bytes are non-zero`)
  }
  const dimensionality = bytes[1] ?? 0
  const layoutClass = bytes[2] ?? 0
  if (layoutClass > 2) throw invalidInput(`HDF5 layout class ${layoutClass} is invalid`)
  let position = 8
  if (layoutClass === 0) {
    if (dimensionality !== dataspace.rank) {
      throw invalidInput('HDF5 compact layout dimensionality does not match its dataspace')
    }
    const dimensions = readUint32Dimensions(
      bytes,
      position,
      dimensionality,
      'HDF5 compact layout dimensions',
    )
    position += dimensionality * 4
    requireDimensions(dimensions, dataspace.dimensions, 'HDF5 compact layout')
    requireBytes(bytes, position, 4, 'HDF5 compact layout data size')
    const storageBytes = littleEndianUint32(bytes, position)
    position += 4
    if (storageBytes > limits.maxCompactBytes) {
      throw limitExceeded(
        `HDF5 compact data bytes ${storageBytes} exceed limit ${limits.maxCompactBytes}`,
      )
    }
    if (storageBytes !== datasetStorageBytes(dataspace, datatype, limits.maxStorageBytes)) {
      throw invalidInput('HDF5 compact layout byte size does not match its dataspace and datatype')
    }
    requireBytes(bytes, position, storageBytes, 'HDF5 compact layout data')
    const data = Uint8Array.from(bytes.subarray(position, position + storageBytes))
    position += storageBytes
    if (!allZero(bytes, position)) throw invalidInput('HDF5 compact layout has trailing bytes')
    return Object.freeze({ kind: 'compact', version, storageBytes, data })
  }

  requireBytes(bytes, position, offsetSize, 'HDF5 layout data address')
  const address = optionalAddress(bytes, position, offsetSize)
  position += offsetSize
  if (version === 1 && address === undefined) {
    throw invalidInput('HDF5 layout version 1 cannot have unallocated storage')
  }
  const dimensions = readUint32Dimensions(bytes, position, dimensionality, 'HDF5 layout dimensions')
  position += dimensionality * 4
  if (!allZero(bytes, position)) throw invalidInput('HDF5 layout has trailing bytes')
  if (layoutClass === 1) {
    if (dimensionality !== dataspace.rank) {
      throw invalidInput('HDF5 contiguous layout dimensionality does not match its dataspace')
    }
    requireDimensions(dimensions, dataspace.dimensions, 'HDF5 contiguous layout')
    return Object.freeze({
      kind: 'contiguous',
      version,
      address,
      storageBytes: datasetStorageBytes(dataspace, datatype, limits.maxStorageBytes),
    })
  }
  if (dataspace.kind !== 'simple' || dimensionality !== dataspace.rank + 1) {
    throw invalidInput('HDF5 chunked layout dimensionality does not match its simple dataspace')
  }
  const geometry = chunkGeometry(dimensions, datatype, limits)
  return Object.freeze({
    kind: 'chunked',
    version,
    chunkDimensions: geometry.dimensions,
    elementBytes: geometry.elementBytes,
    chunkBytes: geometry.chunkBytes,
    partialEdgeChunksFiltered: true,
    index: Object.freeze({ kind: 'btree-v1', address }),
  })
}

const parseVersion3Or4Compact = (
  bytes: Uint8Array,
  version: 3 | 4,
  dataspace: Hdf5Dataspace,
  datatype: Hdf5Datatype,
  limits: ResolvedStorageLimits,
): Hdf5CompactLayout => {
  requireBytes(bytes, 2, 2, 'HDF5 compact layout size')
  const storageBytes = littleEndianUint16(bytes, 2)
  if (storageBytes > limits.maxCompactBytes) {
    throw limitExceeded(
      `HDF5 compact data bytes ${storageBytes} exceed limit ${limits.maxCompactBytes}`,
    )
  }
  if (storageBytes !== datasetStorageBytes(dataspace, datatype, limits.maxStorageBytes)) {
    throw invalidInput('HDF5 compact layout byte size does not match its dataspace and datatype')
  }
  requireBytes(bytes, 4, storageBytes, 'HDF5 compact layout data')
  if (!allZero(bytes, 4 + storageBytes)) {
    throw invalidInput('HDF5 compact layout has trailing bytes')
  }
  return Object.freeze({
    kind: 'compact',
    version,
    storageBytes,
    data: Uint8Array.from(bytes.subarray(4, 4 + storageBytes)),
  })
}

const parseVersion3Or4Contiguous = (
  bytes: Uint8Array,
  version: 3 | 4,
  offsetSize: Hdf5IntegerWidth,
  lengthSize: Hdf5IntegerWidth,
  dataspace: Hdf5Dataspace,
  datatype: Hdf5Datatype,
  limits: ResolvedStorageLimits,
): Hdf5ContiguousLayout => {
  const required = 2 + offsetSize + lengthSize
  requireBytes(bytes, 0, required, 'HDF5 contiguous layout')
  if (!allZero(bytes, required)) throw invalidInput('HDF5 contiguous layout has trailing bytes')
  const storageBytes = boundedNumber(
    littleEndianUnsigned(bytes, 2 + offsetSize, lengthSize),
    limits.maxStorageBytes,
    'HDF5 contiguous storage bytes',
  )
  if (storageBytes !== datasetStorageBytes(dataspace, datatype, limits.maxStorageBytes)) {
    throw invalidInput('HDF5 contiguous layout byte size does not match its dataspace and datatype')
  }
  return Object.freeze({
    kind: 'contiguous',
    version,
    address: optionalAddress(bytes, 2, offsetSize),
    storageBytes,
  })
}

const parseVersion3Chunked = (
  bytes: Uint8Array,
  offsetSize: Hdf5IntegerWidth,
  dataspace: Hdf5Dataspace,
  datatype: Hdf5Datatype,
  limits: ResolvedStorageLimits,
): Hdf5ChunkedLayout => {
  requireBytes(bytes, 2, 1 + offsetSize, 'HDF5 version 3 chunked layout')
  const dimensionality = bytes[2] ?? 0
  if (dataspace.kind !== 'simple' || dimensionality !== dataspace.rank + 1) {
    throw invalidInput('HDF5 chunked layout dimensionality does not match its simple dataspace')
  }
  const position = 3 + offsetSize
  const dimensions = readUint32Dimensions(
    bytes,
    position,
    dimensionality,
    'HDF5 chunked layout dimensions',
  )
  const end = position + dimensionality * 4
  if (!allZero(bytes, end)) throw invalidInput('HDF5 chunked layout has trailing bytes')
  const geometry = chunkGeometry(dimensions, datatype, limits)
  return Object.freeze({
    kind: 'chunked',
    version: 3,
    chunkDimensions: geometry.dimensions,
    elementBytes: geometry.elementBytes,
    chunkBytes: geometry.chunkBytes,
    partialEdgeChunksFiltered: true,
    index: Object.freeze({ kind: 'btree-v1', address: optionalAddress(bytes, 3, offsetSize) }),
  })
}

const modernIndexInformationBytes = (indexType: number, filteredSingle: boolean): number => {
  if (indexType === 1) return filteredSingle ? -1 : 0
  if (indexType === 2) return 0
  if (indexType === 3) return 1
  if (indexType === 4) return 5
  if (indexType === 5) return 6
  throw invalidInput(`HDF5 chunk index type ${indexType} is invalid`)
}

const parseModernChunkIndex = (
  bytes: Uint8Array,
  position: number,
  indexType: number,
  flags: number,
  offsetSize: Hdf5IntegerWidth,
  lengthSize: Hdf5IntegerWidth,
  limits: ResolvedStorageLimits,
): { readonly index: Hdf5ChunkIndex; readonly end: number } => {
  const filteredSingle = (flags & 2) !== 0
  if (filteredSingle && indexType !== 1) {
    throw invalidInput('HDF5 filtered-single-chunk flag requires the single chunk index')
  }
  let cursor = position
  let filteredChunkBytes: number | undefined
  let filterMask: number | undefined
  const fixedInformationBytes = modernIndexInformationBytes(indexType, filteredSingle)
  if (indexType === 1 && filteredSingle) {
    requireBytes(bytes, cursor, lengthSize + 4, 'HDF5 single chunk index information')
    filteredChunkBytes = boundedNumber(
      littleEndianUnsigned(bytes, cursor, lengthSize),
      limits.maxChunkBytes,
      'HDF5 filtered chunk bytes',
    )
    filterMask = littleEndianUint32(bytes, cursor + lengthSize)
    cursor += lengthSize + 4
  } else {
    requireBytes(bytes, cursor, fixedInformationBytes, 'HDF5 chunk index information')
  }
  const informationStart = cursor
  cursor += Math.max(0, fixedInformationBytes)
  requireBytes(bytes, cursor, offsetSize, 'HDF5 chunk index address')
  const address = optionalAddress(bytes, cursor, offsetSize)
  cursor += offsetSize

  if (indexType === 1) {
    return {
      index: Object.freeze({ kind: 'single', address, filteredChunkBytes, filterMask }),
      end: cursor,
    }
  }
  if (indexType === 2) {
    return { index: Object.freeze({ kind: 'implicit', address }), end: cursor }
  }
  if (indexType === 3) {
    return {
      index: Object.freeze({
        kind: 'fixed-array',
        address,
        pageBits: bytes[informationStart] ?? 0,
      }),
      end: cursor,
    }
  }
  if (indexType === 4) {
    return {
      index: Object.freeze({
        kind: 'extensible-array',
        address,
        maxBits: bytes[informationStart] ?? 0,
        indexElements: bytes[informationStart + 1] ?? 0,
        minPointers: bytes[informationStart + 2] ?? 0,
        minElements: bytes[informationStart + 3] ?? 0,
        pageBits: bytes[informationStart + 4] ?? 0,
      }),
      end: cursor,
    }
  }
  const nodeBytes = littleEndianUint32(bytes, informationStart)
  const splitPercent = bytes[informationStart + 4] ?? 0
  const mergePercent = bytes[informationStart + 5] ?? 0
  if (nodeBytes < 1 || splitPercent > 100 || mergePercent > 100) {
    throw invalidInput('HDF5 chunk B-tree v2 parameters are invalid')
  }
  return {
    index: Object.freeze({ kind: 'btree-v2', address, nodeBytes, splitPercent, mergePercent }),
    end: cursor,
  }
}

const parseVersion4Chunked = (
  bytes: Uint8Array,
  offsetSize: Hdf5IntegerWidth,
  lengthSize: Hdf5IntegerWidth,
  dataspace: Hdf5Dataspace,
  datatype: Hdf5Datatype,
  limits: ResolvedStorageLimits,
): Hdf5ChunkedLayout => {
  requireBytes(bytes, 2, 3, 'HDF5 version 4 chunked layout')
  const flags = bytes[2] ?? 0
  if ((flags & 0xfc) !== 0) throw invalidInput('HDF5 version 4 chunked layout flags are invalid')
  const dimensionality = bytes[3] ?? 0
  if (dataspace.kind !== 'simple' || dimensionality !== dataspace.rank + 1) {
    throw invalidInput('HDF5 chunked layout dimensionality does not match its simple dataspace')
  }
  const dimensionWidth = bytes[4] ?? 0
  if (dimensionWidth < 1 || dimensionWidth > 8) {
    throw invalidInput('HDF5 chunk dimension encoded length must be between 1 and 8 bytes')
  }
  let position = 5
  requireBytes(bytes, position, dimensionality * dimensionWidth, 'HDF5 chunk dimensions')
  const dimensions: number[] = []
  for (let index = 0; index < dimensionality; index += 1) {
    dimensions.push(
      boundedNumber(
        littleEndianUnsigned(bytes, position + index * dimensionWidth, dimensionWidth),
        Number.MAX_SAFE_INTEGER,
        `HDF5 chunk dimension ${index}`,
      ),
    )
  }
  position += dimensionality * dimensionWidth
  requireBytes(bytes, position, 1, 'HDF5 chunk index type')
  const indexType = bytes[position] ?? 0
  position += 1
  const parsedIndex = parseModernChunkIndex(
    bytes,
    position,
    indexType,
    flags,
    offsetSize,
    lengthSize,
    limits,
  )
  if (!allZero(bytes, parsedIndex.end)) {
    throw invalidInput('HDF5 version 4 chunked layout has trailing bytes')
  }
  const geometry = chunkGeometry(Object.freeze(dimensions), datatype, limits)
  return Object.freeze({
    kind: 'chunked',
    version: 4,
    chunkDimensions: geometry.dimensions,
    elementBytes: geometry.elementBytes,
    chunkBytes: geometry.chunkBytes,
    partialEdgeChunksFiltered: (flags & 1) === 0,
    index: parsedIndex.index,
  })
}

export const parseHdf5LayoutMessage = (
  bytes: Uint8Array,
  offsetSize: Hdf5IntegerWidth,
  lengthSize: Hdf5IntegerWidth,
  dataspace: Hdf5Dataspace,
  datatype: Hdf5Datatype,
  options: Readonly<Hdf5DatasetStorageLimits> = {},
): Hdf5DatasetLayout => {
  const limits = resolveLimits(options)
  requireBytes(bytes, 0, 2, 'HDF5 layout message')
  const version = bytes[0]
  if (version === 1 || version === 2) {
    return parseLegacyLayout(bytes, version, offsetSize, dataspace, datatype, limits)
  }
  if (version !== 3 && version !== 4) {
    throw unsupportedOperation(`HDF5 layout message version ${version} is not supported`)
  }
  const layoutClass = bytes[1] ?? 0
  if (layoutClass === 3) throw unsupportedOperation('HDF5 virtual datasets are not supported')
  if (layoutClass > 3) throw invalidInput(`HDF5 layout class ${layoutClass} is invalid`)
  if (layoutClass === 0) {
    return parseVersion3Or4Compact(bytes, version, dataspace, datatype, limits)
  }
  if (layoutClass === 1) {
    return parseVersion3Or4Contiguous(
      bytes,
      version,
      offsetSize,
      lengthSize,
      dataspace,
      datatype,
      limits,
    )
  }
  return version === 3
    ? parseVersion3Chunked(bytes, offsetSize, dataspace, datatype, limits)
    : parseVersion4Chunked(bytes, offsetSize, lengthSize, dataspace, datatype, limits)
}

const allocationTime = (value: number): Hdf5FillAllocation => {
  if (value === 0) return 'unused'
  if (value === 1) return 'early'
  if (value === 2) return 'late'
  if (value === 3) return 'incremental'
  throw invalidInput(`HDF5 fill allocation time ${value} is invalid`)
}

const fillWriteTime = (value: number): Hdf5FillWriteTime => {
  if (value === 0) return 'on-allocation'
  if (value === 1) return 'never'
  if (value === 2) return 'if-set'
  throw invalidInput(`HDF5 fill write time ${value} is invalid`)
}

const readFillBytes = (
  bytes: Uint8Array,
  sizeOffset: number,
  limits: ResolvedStorageLimits,
): Uint8Array<ArrayBuffer> => {
  requireBytes(bytes, sizeOffset, 4, 'HDF5 fill value size')
  const size = littleEndianUint32(bytes, sizeOffset)
  if (size > limits.maxFillValueBytes) {
    throw limitExceeded(`HDF5 fill value bytes ${size} exceed limit ${limits.maxFillValueBytes}`)
  }
  requireBytes(bytes, sizeOffset + 4, size, 'HDF5 fill value')
  if (!allZero(bytes, sizeOffset + 4 + size)) {
    throw invalidInput('HDF5 fill value message has trailing bytes')
  }
  return Uint8Array.from(bytes.subarray(sizeOffset + 4, sizeOffset + 4 + size))
}

export const defaultHdf5FillValue = (): Hdf5FillValue =>
  Object.freeze({
    version: 'absent',
    status: 'default-zero',
    allocation: undefined,
    writeTime: undefined,
    value: undefined,
  })

export const parseHdf5OldFillValueMessage = (
  bytes: Uint8Array,
  options: Readonly<Hdf5DatasetStorageLimits> = {},
): Hdf5FillValue => {
  const value = readFillBytes(bytes, 0, resolveLimits(options))
  return Object.freeze({
    version: 'old',
    status: 'defined',
    allocation: undefined,
    writeTime: undefined,
    value,
  })
}

export const parseHdf5FillValueMessage = (
  bytes: Uint8Array,
  options: Readonly<Hdf5DatasetStorageLimits> = {},
): Hdf5FillValue => {
  const limits = resolveLimits(options)
  requireBytes(bytes, 0, 2, 'HDF5 fill value message')
  const version = bytes[0]
  if (version !== 1 && version !== 2 && version !== 3) {
    throw unsupportedOperation(`HDF5 fill value message version ${version} is not supported`)
  }
  if (version === 3) {
    const flags = bytes[1] ?? 0
    if ((flags & 0xc0) !== 0 || (flags & 0x30) === 0x30) {
      throw invalidInput('HDF5 fill value version 3 flags are invalid')
    }
    const allocation = allocationTime(flags & 3)
    const writeTime = fillWriteTime((flags >>> 2) & 3)
    if ((flags & 0x20) !== 0) {
      const value = readFillBytes(bytes, 2, limits)
      return Object.freeze({
        version,
        status: value.byteLength === 0 ? 'default-zero' : 'defined',
        allocation,
        writeTime,
        value: value.byteLength === 0 ? undefined : value,
      })
    }
    if (!allZero(bytes, 2)) throw invalidInput('HDF5 fill value message has trailing bytes')
    return Object.freeze({
      version,
      status: (flags & 0x10) !== 0 ? 'undefined' : 'default-zero',
      allocation,
      writeTime,
      value: undefined,
    })
  }

  requireBytes(bytes, 0, 4, `HDF5 fill value version ${version}`)
  const allocation = allocationTime(bytes[1] ?? 0)
  const writeTime = fillWriteTime(bytes[2] ?? 0)
  const defined = bytes[3]
  if (defined !== 0 && defined !== 1) {
    throw invalidInput(`HDF5 fill value version ${version} defined flag is invalid`)
  }
  if (version === 2 && defined === 0) {
    if (!allZero(bytes, 4)) throw invalidInput('HDF5 fill value message has trailing bytes')
    return Object.freeze({
      version,
      status: 'undefined',
      allocation,
      writeTime,
      value: undefined,
    })
  }
  const value = readFillBytes(bytes, 4, limits)
  if (defined === 0 && value.byteLength !== 0) {
    throw invalidInput('HDF5 undefined fill value cannot contain value bytes')
  }
  return Object.freeze({
    version,
    status: defined === 1 ? (value.byteLength === 0 ? 'default-zero' : 'defined') : 'undefined',
    allocation,
    writeTime,
    value: defined === 1 && value.byteLength > 0 ? value : undefined,
  })
}
