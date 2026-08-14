import type { Hdf5IntegerWidth } from '../../src/scientific/formats/hdf5.ts'

export interface GeneratedDataspaceOptions {
  readonly version: 1 | 2
  readonly lengthSize: Hdf5IntegerWidth
  readonly dimensions?: readonly bigint[]
  readonly maximumDimensions?: readonly (bigint | 'unlimited')[]
  readonly type?: 'scalar' | 'simple' | 'null'
}

export interface GeneratedIntegerDatatypeOptions {
  readonly version?: 1 | 2 | 3
  readonly byteLength: number
  readonly signed?: boolean
  readonly byteOrder?: 'little-endian' | 'big-endian'
  readonly bitOffset?: number
  readonly bitPrecision?: number
  readonly lowPadding?: 0 | 1
  readonly highPadding?: 0 | 1
}

export interface GeneratedFloatDatatypeOptions {
  readonly version?: 1 | 2 | 3
  readonly format: 'binary16' | 'binary32' | 'binary64'
  readonly byteOrder?: 'little-endian' | 'big-endian'
}

export interface GeneratedStringDatatypeOptions {
  readonly version?: 1 | 2 | 3
  readonly byteLength: number
  readonly padding?: 'null-terminated' | 'null-padded' | 'space-padded'
  readonly characterSet?: 'ascii' | 'utf-8'
}

export interface GeneratedCompactLayoutOptions {
  readonly version: 1 | 2 | 3 | 4
  readonly dimensions: readonly number[]
  readonly data: Uint8Array
}

export interface GeneratedContiguousLayoutOptions {
  readonly version: 1 | 2 | 3 | 4
  readonly offsetSize: Hdf5IntegerWidth
  readonly lengthSize: Hdf5IntegerWidth
  readonly dimensions: readonly number[]
  readonly address?: bigint
  readonly storageBytes: bigint
}

export type GeneratedChunkIndex =
  | { readonly kind: 'single'; readonly filteredBytes?: bigint; readonly filterMask?: number }
  | { readonly kind: 'implicit' }
  | { readonly kind: 'fixed-array'; readonly pageBits: number }
  | {
      readonly kind: 'extensible-array'
      readonly maxBits: number
      readonly indexElements: number
      readonly minPointers: number
      readonly minElements: number
      readonly pageBits: number
    }
  | {
      readonly kind: 'btree-v2'
      readonly nodeBytes: number
      readonly splitPercent: number
      readonly mergePercent: number
    }

export interface GeneratedChunkedLayoutOptions {
  readonly version: 1 | 2 | 3 | 4
  readonly offsetSize: Hdf5IntegerWidth
  readonly lengthSize: Hdf5IntegerWidth
  readonly chunkDimensions: readonly number[]
  readonly elementBytes: number
  readonly address?: bigint
  readonly partialEdgeChunksFiltered?: boolean
  readonly index?: GeneratedChunkIndex
}

export interface GeneratedFillValueOptions {
  readonly version: 1 | 2 | 3
  readonly allocation?: 'unused' | 'early' | 'late' | 'incremental'
  readonly writeTime?: 'on-allocation' | 'never' | 'if-set'
  readonly status: 'default-zero' | 'undefined' | 'defined'
  readonly value?: Uint8Array
}

const writeLittleEndian = (
  bytes: Uint8Array,
  offset: number,
  width: number,
  value: bigint,
): void => {
  let remaining = value
  for (let index = 0; index < width; index += 1) {
    bytes[offset + index] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  if (remaining !== 0n) throw new Error(`Generated HDF5 value ${value} does not fit ${width} bytes`)
}

const writeUint16 = (bytes: Uint8Array, offset: number, value: number): void => {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(offset, value, true)
}

const writeUint32 = (bytes: Uint8Array, offset: number, value: number): void => {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value, true)
}

export const createGeneratedDataspaceMessage = (
  options: Readonly<GeneratedDataspaceOptions>,
): Uint8Array<ArrayBuffer> => {
  const dimensions = options.dimensions ?? []
  const type = options.type ?? (dimensions.length === 0 ? 'scalar' : 'simple')
  const maximumDimensions = options.maximumDimensions
  if (dimensions.length > 255) throw new Error('Generated HDF5 dataspace rank is too large')
  if (maximumDimensions !== undefined && maximumDimensions.length !== dimensions.length) {
    throw new Error('Generated HDF5 maximum dimension count does not match rank')
  }
  const headerBytes = options.version === 1 ? 8 : 4
  const dimensionBytes = dimensions.length * options.lengthSize
  const bytes = new Uint8Array(
    headerBytes + dimensionBytes + (maximumDimensions === undefined ? 0 : dimensionBytes),
  )
  bytes[0] = options.version
  bytes[1] = dimensions.length
  bytes[2] = maximumDimensions === undefined ? 0 : 1
  if (options.version === 2) bytes[3] = type === 'scalar' ? 0 : type === 'simple' ? 1 : 2
  for (let index = 0; index < dimensions.length; index += 1) {
    writeLittleEndian(
      bytes,
      headerBytes + index * options.lengthSize,
      options.lengthSize,
      dimensions[index] ?? 0n,
    )
  }
  if (maximumDimensions !== undefined) {
    const unlimited = (1n << BigInt(options.lengthSize * 8)) - 1n
    for (let index = 0; index < maximumDimensions.length; index += 1) {
      const maximum = maximumDimensions[index]
      writeLittleEndian(
        bytes,
        headerBytes + dimensionBytes + index * options.lengthSize,
        options.lengthSize,
        maximum === 'unlimited' ? unlimited : (maximum ?? 0n),
      )
    }
  }
  return bytes
}

const createDatatypeHeader = (
  version: 1 | 2 | 3,
  datatypeClass: number,
  classBits: number,
  byteLength: number,
  totalBytes: number,
): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(totalBytes)
  bytes[0] = (version << 4) | datatypeClass
  bytes[1] = classBits & 0xff
  bytes[2] = (classBits >>> 8) & 0xff
  bytes[3] = (classBits >>> 16) & 0xff
  writeUint32(bytes, 4, byteLength)
  return bytes
}

export const createGeneratedIntegerDatatypeMessage = (
  options: Readonly<GeneratedIntegerDatatypeOptions>,
): Uint8Array<ArrayBuffer> => {
  let classBits = options.byteOrder === 'big-endian' ? 1 : 0
  classBits |= (options.lowPadding ?? 0) << 1
  classBits |= (options.highPadding ?? 0) << 2
  if (options.signed === true) classBits |= 8
  const bytes = createDatatypeHeader(options.version ?? 1, 0, classBits, options.byteLength, 12)
  writeUint16(bytes, 8, options.bitOffset ?? 0)
  writeUint16(bytes, 10, options.bitPrecision ?? options.byteLength * 8)
  return bytes
}

const floatFields = {
  binary16: {
    byteLength: 2,
    signLocation: 15,
    exponentLocation: 10,
    exponentSize: 5,
    mantissaLocation: 0,
    mantissaSize: 10,
    exponentBias: 15,
  },
  binary32: {
    byteLength: 4,
    signLocation: 31,
    exponentLocation: 23,
    exponentSize: 8,
    mantissaLocation: 0,
    mantissaSize: 23,
    exponentBias: 127,
  },
  binary64: {
    byteLength: 8,
    signLocation: 63,
    exponentLocation: 52,
    exponentSize: 11,
    mantissaLocation: 0,
    mantissaSize: 52,
    exponentBias: 1_023,
  },
} as const

export const createGeneratedFloatDatatypeMessage = (
  options: Readonly<GeneratedFloatDatatypeOptions>,
): Uint8Array<ArrayBuffer> => {
  const fields = floatFields[options.format]
  const byteOrder = options.byteOrder === 'big-endian' ? 1 : 0
  const classBits = byteOrder | (2 << 4) | (fields.signLocation << 8)
  const bytes = createDatatypeHeader(options.version ?? 1, 1, classBits, fields.byteLength, 20)
  writeUint16(bytes, 8, 0)
  writeUint16(bytes, 10, fields.byteLength * 8)
  bytes[12] = fields.exponentLocation
  bytes[13] = fields.exponentSize
  bytes[14] = fields.mantissaLocation
  bytes[15] = fields.mantissaSize
  writeUint32(bytes, 16, fields.exponentBias)
  return bytes
}

export const createGeneratedStringDatatypeMessage = (
  options: Readonly<GeneratedStringDatatypeOptions>,
): Uint8Array<ArrayBuffer> => {
  const padding = options.padding === 'null-padded' ? 1 : options.padding === 'space-padded' ? 2 : 0
  const characterSet = options.characterSet === 'utf-8' ? 1 : 0
  return createDatatypeHeader(
    options.version ?? 1,
    3,
    padding | (characterSet << 4),
    options.byteLength,
    8,
  )
}

const writeDimensions = (
  bytes: Uint8Array,
  offset: number,
  dimensions: readonly number[],
): void => {
  for (let index = 0; index < dimensions.length; index += 1) {
    writeUint32(bytes, offset + index * 4, dimensions[index] ?? 0)
  }
}

const encodedAddress = (address: bigint | undefined, width: Hdf5IntegerWidth): bigint =>
  address ?? (1n << BigInt(width * 8)) - 1n

export const createGeneratedCompactLayoutMessage = (
  options: Readonly<GeneratedCompactLayoutOptions>,
): Uint8Array<ArrayBuffer> => {
  if (options.version <= 2) {
    const bytes = new Uint8Array(8 + options.dimensions.length * 4 + 4 + options.data.byteLength)
    bytes[0] = options.version
    bytes[1] = options.dimensions.length
    bytes[2] = 0
    writeDimensions(bytes, 8, options.dimensions)
    const dataSizeOffset = 8 + options.dimensions.length * 4
    writeUint32(bytes, dataSizeOffset, options.data.byteLength)
    bytes.set(options.data, dataSizeOffset + 4)
    return bytes
  }
  if (options.data.byteLength > 0xffff) throw new Error('Generated compact data is too large')
  const bytes = new Uint8Array(4 + options.data.byteLength)
  bytes[0] = options.version
  bytes[1] = 0
  writeUint16(bytes, 2, options.data.byteLength)
  bytes.set(options.data, 4)
  return bytes
}

export const createGeneratedContiguousLayoutMessage = (
  options: Readonly<GeneratedContiguousLayoutOptions>,
): Uint8Array<ArrayBuffer> => {
  if (options.version <= 2) {
    const bytes = new Uint8Array(8 + options.offsetSize + options.dimensions.length * 4)
    bytes[0] = options.version
    bytes[1] = options.dimensions.length
    bytes[2] = 1
    writeLittleEndian(
      bytes,
      8,
      options.offsetSize,
      encodedAddress(options.address, options.offsetSize),
    )
    writeDimensions(bytes, 8 + options.offsetSize, options.dimensions)
    return bytes
  }
  const bytes = new Uint8Array(2 + options.offsetSize + options.lengthSize)
  bytes[0] = options.version
  bytes[1] = 1
  writeLittleEndian(
    bytes,
    2,
    options.offsetSize,
    encodedAddress(options.address, options.offsetSize),
  )
  writeLittleEndian(bytes, 2 + options.offsetSize, options.lengthSize, options.storageBytes)
  return bytes
}

const chunkIndexType = (index: GeneratedChunkIndex): number => {
  if (index.kind === 'single') return 1
  if (index.kind === 'implicit') return 2
  if (index.kind === 'fixed-array') return 3
  if (index.kind === 'extensible-array') return 4
  return 5
}

const chunkIndexInformationBytes = (
  index: GeneratedChunkIndex,
  lengthSize: Hdf5IntegerWidth,
): number => {
  if (index.kind === 'single') return index.filteredBytes === undefined ? 0 : lengthSize + 4
  if (index.kind === 'implicit') return 0
  if (index.kind === 'fixed-array') return 1
  if (index.kind === 'extensible-array') return 5
  return 6
}

const writeChunkIndexInformation = (
  bytes: Uint8Array,
  offset: number,
  index: GeneratedChunkIndex,
  lengthSize: Hdf5IntegerWidth,
): void => {
  if (index.kind === 'single') {
    if (index.filteredBytes !== undefined) {
      writeLittleEndian(bytes, offset, lengthSize, index.filteredBytes)
      writeUint32(bytes, offset + lengthSize, index.filterMask ?? 0)
    }
    return
  }
  if (index.kind === 'fixed-array') {
    bytes[offset] = index.pageBits
    return
  }
  if (index.kind === 'extensible-array') {
    bytes[offset] = index.maxBits
    bytes[offset + 1] = index.indexElements
    bytes[offset + 2] = index.minPointers
    bytes[offset + 3] = index.minElements
    bytes[offset + 4] = index.pageBits
    return
  }
  if (index.kind === 'btree-v2') {
    writeUint32(bytes, offset, index.nodeBytes)
    bytes[offset + 4] = index.splitPercent
    bytes[offset + 5] = index.mergePercent
  }
}

export const createGeneratedChunkedLayoutMessage = (
  options: Readonly<GeneratedChunkedLayoutOptions>,
): Uint8Array<ArrayBuffer> => {
  const dimensions = [...options.chunkDimensions, options.elementBytes]
  if (options.version <= 2) {
    const bytes = new Uint8Array(8 + options.offsetSize + dimensions.length * 4)
    bytes[0] = options.version
    bytes[1] = dimensions.length
    bytes[2] = 2
    writeLittleEndian(
      bytes,
      8,
      options.offsetSize,
      encodedAddress(options.address, options.offsetSize),
    )
    writeDimensions(bytes, 8 + options.offsetSize, dimensions)
    return bytes
  }
  if (options.version === 3) {
    const bytes = new Uint8Array(3 + options.offsetSize + dimensions.length * 4)
    bytes[0] = 3
    bytes[1] = 2
    bytes[2] = dimensions.length
    writeLittleEndian(
      bytes,
      3,
      options.offsetSize,
      encodedAddress(options.address, options.offsetSize),
    )
    writeDimensions(bytes, 3 + options.offsetSize, dimensions)
    return bytes
  }
  const index = options.index ?? { kind: 'implicit' }
  const informationBytes = chunkIndexInformationBytes(index, options.lengthSize)
  const dimensionWidth = 4
  const indexOffset = 5 + dimensions.length * dimensionWidth
  const addressOffset = indexOffset + 1 + informationBytes
  const bytes = new Uint8Array(addressOffset + options.offsetSize)
  bytes[0] = 4
  bytes[1] = 2
  bytes[2] =
    (options.partialEdgeChunksFiltered === false ? 1 : 0) |
    (index.kind === 'single' && index.filteredBytes !== undefined ? 2 : 0)
  bytes[3] = dimensions.length
  bytes[4] = dimensionWidth
  writeDimensions(bytes, 5, dimensions)
  bytes[indexOffset] = chunkIndexType(index)
  writeChunkIndexInformation(bytes, indexOffset + 1, index, options.lengthSize)
  writeLittleEndian(
    bytes,
    addressOffset,
    options.offsetSize,
    encodedAddress(options.address, options.offsetSize),
  )
  return bytes
}

export const createGeneratedOldFillValueMessage = (value: Uint8Array): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(4 + value.byteLength)
  writeUint32(bytes, 0, value.byteLength)
  bytes.set(value, 4)
  return bytes
}

const allocationValue = (value: GeneratedFillValueOptions['allocation']): number =>
  value === 'early' ? 1 : value === 'late' ? 2 : value === 'incremental' ? 3 : 0

const writeTimeValue = (value: GeneratedFillValueOptions['writeTime']): number =>
  value === 'never' ? 1 : value === 'if-set' ? 2 : 0

export const createGeneratedFillValueMessage = (
  options: Readonly<GeneratedFillValueOptions>,
): Uint8Array<ArrayBuffer> => {
  const value = options.value ?? new Uint8Array()
  const defined = options.status === 'defined'
  if (options.version === 3) {
    const hasValue = defined
    const bytes = new Uint8Array(2 + (hasValue ? 4 + value.byteLength : 0))
    bytes[0] = 3
    bytes[1] =
      allocationValue(options.allocation) |
      (writeTimeValue(options.writeTime) << 2) |
      (options.status === 'undefined' ? 0x10 : defined ? 0x20 : 0)
    if (hasValue) {
      writeUint32(bytes, 2, value.byteLength)
      bytes.set(value, 6)
    }
    return bytes
  }
  const hasValueField = options.version === 1 || defined
  const bytes = new Uint8Array(4 + (hasValueField ? 4 + value.byteLength : 0))
  bytes[0] = options.version
  bytes[1] = allocationValue(options.allocation)
  bytes[2] = writeTimeValue(options.writeTime)
  bytes[3] = defined ? 1 : 0
  if (hasValueField) {
    writeUint32(bytes, 4, value.byteLength)
    bytes.set(value, 8)
  }
  return bytes
}
