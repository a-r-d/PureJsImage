import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { ImageSourceReadOptions } from '../../source.ts'
import {
  defaultHdf5FillValue,
  type Hdf5DatasetLayout,
  type Hdf5DatasetStorageLimits,
  type Hdf5FillValue,
  parseHdf5FillValueMessage,
  parseHdf5LayoutMessage,
  parseHdf5OldFillValueMessage,
} from './hdf5-layout.ts'
import type { Hdf5FileLayer, Hdf5IntegerWidth } from './hdf5.ts'
import type { Hdf5ObjectHeader, Hdf5ObjectHeaderMessage } from './hdf5-object.ts'

export type Hdf5ByteOrder = 'little-endian' | 'big-endian'
export type Hdf5BitPadding = 0 | 1

export interface Hdf5ScalarDataspace {
  readonly kind: 'scalar'
  readonly version: 1 | 2
  readonly rank: 0
  readonly dimensions: readonly []
  readonly maximumDimensions: readonly []
  readonly elementCount: 1
}

export interface Hdf5SimpleDataspace {
  readonly kind: 'simple'
  readonly version: 1 | 2
  readonly rank: number
  readonly dimensions: readonly number[]
  readonly maximumDimensions: readonly (number | 'unlimited')[]
  readonly elementCount: number
}

export type Hdf5Dataspace = Hdf5ScalarDataspace | Hdf5SimpleDataspace

interface Hdf5DatatypeBase {
  readonly version: 1 | 2 | 3
  readonly byteLength: number
}

export interface Hdf5IntegerDatatype extends Hdf5DatatypeBase {
  readonly kind: 'integer'
  readonly signed: boolean
  readonly byteOrder: Hdf5ByteOrder
  readonly bitOffset: number
  readonly bitPrecision: number
  readonly lowPadding: Hdf5BitPadding
  readonly highPadding: Hdf5BitPadding
}

export type Hdf5IeeeFloatFormat = 'binary16' | 'binary32' | 'binary64'

export interface Hdf5FloatDatatype extends Hdf5DatatypeBase {
  readonly kind: 'float'
  readonly byteOrder: Hdf5ByteOrder
  readonly format: Hdf5IeeeFloatFormat
  readonly bitOffset: number
  readonly bitPrecision: number
  readonly signLocation: number
  readonly exponentLocation: number
  readonly exponentSize: number
  readonly mantissaLocation: number
  readonly mantissaSize: number
  readonly exponentBias: number
}

export interface Hdf5FixedStringDatatype extends Hdf5DatatypeBase {
  readonly kind: 'fixed-string'
  readonly padding: 'null-terminated' | 'null-padded' | 'space-padded'
  readonly characterSet: 'ascii' | 'utf-8'
}

export type Hdf5Datatype = Hdf5IntegerDatatype | Hdf5FloatDatatype | Hdf5FixedStringDatatype

export interface Hdf5DatasetMetadataLimits {
  readonly maxRank?: number
  readonly maxDimension?: number
  readonly maxElements?: number
  readonly maxElementBytes?: number
  readonly maxMessageBytes?: number
}

export interface Hdf5DatasetMetadataOptions
  extends AbortOptions,
    Hdf5DatasetMetadataLimits,
    Hdf5DatasetStorageLimits {
  readonly objectPath?: string
}

export interface Hdf5DatasetTypeAndSpace {
  readonly dataspace: Hdf5Dataspace
  readonly datatype: Hdf5Datatype
  readonly metadataBytes: number
}

export interface Hdf5DatasetMetadata extends Hdf5DatasetTypeAndSpace {
  readonly layout: Hdf5DatasetLayout
  readonly fillValue: Hdf5FillValue
}

interface ResolvedLimits {
  readonly maxRank: number
  readonly maxDimension: number
  readonly maxElements: number
  readonly maxElementBytes: number
  readonly maxMessageBytes: number
}

const defaultLimits: ResolvedLimits = Object.freeze({
  maxRank: 32,
  maxDimension: Number.MAX_SAFE_INTEGER,
  maxElements: Number.MAX_SAFE_INTEGER,
  maxElementBytes: 16_777_216,
  maxMessageBytes: 65_536,
})

const positiveSafeInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const resolveLimits = (options: Readonly<Hdf5DatasetMetadataLimits>): ResolvedLimits =>
  Object.freeze({
    maxRank: positiveSafeInteger('HDF5 dataset maxRank', options.maxRank ?? defaultLimits.maxRank),
    maxDimension: positiveSafeInteger(
      'HDF5 dataset maxDimension',
      options.maxDimension ?? defaultLimits.maxDimension,
    ),
    maxElements: positiveSafeInteger(
      'HDF5 dataset maxElements',
      options.maxElements ?? defaultLimits.maxElements,
    ),
    maxElementBytes: positiveSafeInteger(
      'HDF5 dataset maxElementBytes',
      options.maxElementBytes ?? defaultLimits.maxElementBytes,
    ),
    maxMessageBytes: positiveSafeInteger(
      'HDF5 dataset maxMessageBytes',
      options.maxMessageBytes ?? defaultLimits.maxMessageBytes,
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

const littleEndianUint24 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16)

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

const boundedNumber = (value: bigint, maximum: number, label: string): number => {
  if (value > BigInt(maximum)) {
    throw limitExceeded(`${label} ${value} exceeds limit ${maximum}`)
  }
  return Number(value)
}

const validateMessageBytes = (bytes: Uint8Array, limits: ResolvedLimits, label: string): void => {
  if (bytes.byteLength > limits.maxMessageBytes) {
    throw limitExceeded(
      `${label} has ${bytes.byteLength} bytes, exceeding limit ${limits.maxMessageBytes}`,
    )
  }
}

export const parseHdf5DataspaceMessage = (
  bytes: Uint8Array,
  lengthSize: Hdf5IntegerWidth,
  options: Readonly<Hdf5DatasetMetadataLimits> = {},
): Hdf5Dataspace => {
  const limits = resolveLimits(options)
  validateMessageBytes(bytes, limits, 'HDF5 dataspace message')
  requireBytes(bytes, 0, 4, 'HDF5 dataspace message')
  const version = bytes[0]
  if (version !== 1 && version !== 2) {
    throw unsupportedOperation(`HDF5 dataspace message version ${version} is not supported`)
  }
  const rank = bytes[1] ?? 0
  if (rank > limits.maxRank) {
    throw limitExceeded(`HDF5 dataspace rank ${rank} exceeds limit ${limits.maxRank}`)
  }
  const flags = bytes[2] ?? 0
  const headerBytes = version === 1 ? 8 : 4
  if (version === 1) {
    requireBytes(bytes, 0, headerBytes, 'HDF5 version 1 dataspace message')
    if (flags > 3) throw invalidInput('HDF5 version 1 dataspace flags are invalid')
    if (!allZero(bytes.subarray(3, 8), 0)) {
      throw invalidInput('HDF5 version 1 dataspace reserved bytes are non-zero')
    }
  } else if (flags > 1) {
    throw invalidInput('HDF5 version 2 dataspace flags are invalid')
  }

  const dimensionBytes = rank * lengthSize
  const hasMaximum = (flags & 1) !== 0
  const hasPermutation = version === 1 && (flags & 2) !== 0
  const requiredBytes =
    headerBytes +
    dimensionBytes +
    (hasMaximum ? dimensionBytes : 0) +
    (hasPermutation ? dimensionBytes : 0)
  requireBytes(bytes, 0, requiredBytes, 'HDF5 dataspace dimensions')
  if (!allZero(bytes, requiredBytes)) {
    throw invalidInput('HDF5 dataspace message has non-zero trailing bytes')
  }
  if (hasPermutation) {
    throw unsupportedOperation('HDF5 version 1 dataspace permutation indexes are not supported')
  }

  const type = version === 1 ? (rank === 0 ? 0 : 1) : (bytes[3] ?? 0)
  if (type === 2) throw unsupportedOperation('HDF5 null dataspaces are not supported')
  if (type !== 0 && type !== 1) throw invalidInput(`HDF5 dataspace type ${type} is invalid`)
  if (type === 0 && rank !== 0) {
    throw invalidInput('HDF5 scalar dataspace must have rank zero')
  }
  if (type === 1 && rank === 0) {
    throw invalidInput('HDF5 simple dataspace must have positive rank')
  }
  if (type === 0) {
    if (hasMaximum) throw invalidInput('HDF5 scalar dataspace cannot declare maximum dimensions')
    const dimensions: readonly [] = Object.freeze([])
    const maximumDimensions: readonly [] = Object.freeze([])
    return Object.freeze({
      kind: 'scalar',
      version,
      rank: 0,
      dimensions,
      maximumDimensions,
      elementCount: 1,
    })
  }

  const dimensions: number[] = []
  const maximumDimensions: (number | 'unlimited')[] = []
  const unlimited = (1n << BigInt(lengthSize * 8)) - 1n
  let elementCount = 1n
  for (let index = 0; index < rank; index += 1) {
    const value = littleEndianUnsigned(bytes, headerBytes + index * lengthSize, lengthSize)
    const dimension = boundedNumber(value, limits.maxDimension, `HDF5 dataspace dimension ${index}`)
    dimensions.push(dimension)
    elementCount *= value
    if (elementCount > BigInt(limits.maxElements)) {
      throw limitExceeded(
        `HDF5 dataspace element count ${elementCount} exceeds limit ${limits.maxElements}`,
      )
    }
  }
  for (let index = 0; index < rank; index += 1) {
    if (!hasMaximum) {
      maximumDimensions.push(dimensions[index] ?? 0)
      continue
    }
    const offset = headerBytes + dimensionBytes + index * lengthSize
    const value = littleEndianUnsigned(bytes, offset, lengthSize)
    if (value === unlimited) {
      maximumDimensions.push('unlimited')
      continue
    }
    const maximum = boundedNumber(
      value,
      limits.maxDimension,
      `HDF5 dataspace maximum dimension ${index}`,
    )
    if (maximum < (dimensions[index] ?? 0)) {
      throw invalidInput(`HDF5 dataspace maximum dimension ${index} is smaller than its extent`)
    }
    maximumDimensions.push(maximum)
  }
  return Object.freeze({
    kind: 'simple',
    version,
    rank,
    dimensions: Object.freeze(dimensions),
    maximumDimensions: Object.freeze(maximumDimensions),
    elementCount: Number(elementCount),
  })
}

const datatypeHeader = (
  bytes: Uint8Array,
  limits: ResolvedLimits,
): {
  readonly version: 1 | 2 | 3
  readonly datatypeClass: number
  readonly classBits: number
  readonly byteLength: number
} => {
  validateMessageBytes(bytes, limits, 'HDF5 datatype message')
  requireBytes(bytes, 0, 8, 'HDF5 datatype message')
  const version = (bytes[0] ?? 0) >>> 4
  if (version !== 1 && version !== 2 && version !== 3) {
    throw unsupportedOperation(`HDF5 datatype message version ${version} is not supported`)
  }
  const byteLength = littleEndianUint32(bytes, 4)
  if (byteLength < 1) throw invalidInput('HDF5 datatype byte length must be positive')
  if (byteLength > limits.maxElementBytes) {
    throw limitExceeded(
      `HDF5 datatype byte length ${byteLength} exceeds limit ${limits.maxElementBytes}`,
    )
  }
  return {
    version,
    datatypeClass: (bytes[0] ?? 0) & 0x0f,
    classBits: littleEndianUint24(bytes, 1),
    byteLength,
  }
}

const parseIntegerDatatype = (
  bytes: Uint8Array,
  header: ReturnType<typeof datatypeHeader>,
): Hdf5IntegerDatatype => {
  if ((header.classBits & ~0x0f) !== 0) {
    throw invalidInput('HDF5 integer datatype has reserved class bits set')
  }
  requireBytes(bytes, 0, 12, 'HDF5 integer datatype')
  if (!allZero(bytes, 12)) throw invalidInput('HDF5 integer datatype has trailing bytes')
  const bitOffset = littleEndianUint16(bytes, 8)
  const bitPrecision = littleEndianUint16(bytes, 10)
  if (bitPrecision < 1 || bitOffset + bitPrecision > header.byteLength * 8) {
    throw invalidInput('HDF5 integer datatype precision and offset exceed its storage')
  }
  return Object.freeze({
    kind: 'integer',
    version: header.version,
    byteLength: header.byteLength,
    signed: (header.classBits & 8) !== 0,
    byteOrder: (header.classBits & 1) === 0 ? 'little-endian' : 'big-endian',
    lowPadding: ((header.classBits >>> 1) & 1) as Hdf5BitPadding,
    highPadding: ((header.classBits >>> 2) & 1) as Hdf5BitPadding,
    bitOffset,
    bitPrecision,
  })
}

const rangesOverlap = (
  leftStart: number,
  leftSize: number,
  rightStart: number,
  rightSize: number,
) => leftStart < rightStart + rightSize && rightStart < leftStart + leftSize

const parseFloatDatatype = (
  bytes: Uint8Array,
  header: ReturnType<typeof datatypeHeader>,
): Hdf5FloatDatatype => {
  if ((header.classBits & 0xff0080) !== 0) {
    throw invalidInput('HDF5 floating-point datatype has reserved class bits set')
  }
  requireBytes(bytes, 0, 20, 'HDF5 floating-point datatype')
  if (!allZero(bytes, 20)) throw invalidInput('HDF5 floating-point datatype has trailing bytes')
  const byteOrderBits = (header.classBits & 1) | ((header.classBits >>> 5) & 2)
  if (byteOrderBits === 2) throw invalidInput('HDF5 floating-point byte order is reserved')
  if (byteOrderBits === 3) {
    throw unsupportedOperation('HDF5 VAX floating-point datatypes are not supported')
  }
  const normalization = (header.classBits >>> 4) & 3
  if (normalization === 3) {
    throw invalidInput('HDF5 floating-point mantissa normalization is reserved')
  }
  const bitOffset = littleEndianUint16(bytes, 8)
  const bitPrecision = littleEndianUint16(bytes, 10)
  const exponentLocation = bytes[12] ?? 0
  const exponentSize = bytes[13] ?? 0
  const mantissaLocation = bytes[14] ?? 0
  const mantissaSize = bytes[15] ?? 0
  const exponentBias = littleEndianUint32(bytes, 16)
  const signLocation = (header.classBits >>> 8) & 0xff
  const significantEnd = bitOffset + bitPrecision
  if (
    bitPrecision < 1 ||
    significantEnd > header.byteLength * 8 ||
    exponentSize < 1 ||
    mantissaSize < 1 ||
    signLocation < bitOffset ||
    signLocation >= significantEnd ||
    exponentLocation < bitOffset ||
    exponentLocation + exponentSize > significantEnd ||
    mantissaLocation < bitOffset ||
    mantissaLocation + mantissaSize > significantEnd ||
    rangesOverlap(signLocation, 1, exponentLocation, exponentSize) ||
    rangesOverlap(signLocation, 1, mantissaLocation, mantissaSize) ||
    rangesOverlap(exponentLocation, exponentSize, mantissaLocation, mantissaSize)
  ) {
    throw invalidInput('HDF5 floating-point fields exceed or overlap their significant bits')
  }

  let format: Hdf5IeeeFloatFormat | undefined
  if (
    normalization === 2 &&
    (header.classBits & 0x0e) === 0 &&
    bitOffset === 0 &&
    bitPrecision === header.byteLength * 8
  ) {
    if (
      header.byteLength === 2 &&
      signLocation === 15 &&
      exponentLocation === 10 &&
      exponentSize === 5 &&
      mantissaLocation === 0 &&
      mantissaSize === 10 &&
      exponentBias === 15
    ) {
      format = 'binary16'
    } else if (
      header.byteLength === 4 &&
      signLocation === 31 &&
      exponentLocation === 23 &&
      exponentSize === 8 &&
      mantissaLocation === 0 &&
      mantissaSize === 23 &&
      exponentBias === 127
    ) {
      format = 'binary32'
    } else if (
      header.byteLength === 8 &&
      signLocation === 63 &&
      exponentLocation === 52 &&
      exponentSize === 11 &&
      mantissaLocation === 0 &&
      mantissaSize === 52 &&
      exponentBias === 1_023
    ) {
      format = 'binary64'
    }
  }
  if (format === undefined) {
    throw unsupportedOperation('HDF5 floating-point datatype is not an IEEE binary16/32/64 layout')
  }
  return Object.freeze({
    kind: 'float',
    version: header.version,
    byteLength: header.byteLength,
    byteOrder: byteOrderBits === 0 ? 'little-endian' : 'big-endian',
    format,
    bitOffset,
    bitPrecision,
    signLocation,
    exponentLocation,
    exponentSize,
    mantissaLocation,
    mantissaSize,
    exponentBias,
  })
}

const parseStringDatatype = (
  bytes: Uint8Array,
  header: ReturnType<typeof datatypeHeader>,
): Hdf5FixedStringDatatype => {
  if ((header.classBits & 0xffff00) !== 0) {
    throw invalidInput('HDF5 string datatype has reserved class bits set')
  }
  if (!allZero(bytes, 8)) throw invalidInput('HDF5 string datatype has trailing bytes')
  const paddingValue = header.classBits & 0x0f
  const characterSetValue = (header.classBits >>> 4) & 0x0f
  const padding =
    paddingValue === 0
      ? 'null-terminated'
      : paddingValue === 1
        ? 'null-padded'
        : paddingValue === 2
          ? 'space-padded'
          : undefined
  if (padding === undefined) throw invalidInput(`HDF5 string padding ${paddingValue} is invalid`)
  if (characterSetValue > 1) {
    throw invalidInput(`HDF5 string character set ${characterSetValue} is invalid`)
  }
  return Object.freeze({
    kind: 'fixed-string',
    version: header.version,
    byteLength: header.byteLength,
    padding,
    characterSet: characterSetValue === 0 ? 'ascii' : 'utf-8',
  })
}

export const parseHdf5DatatypeMessage = (
  bytes: Uint8Array,
  options: Readonly<Hdf5DatasetMetadataLimits> = {},
): Hdf5Datatype => {
  const limits = resolveLimits(options)
  const header = datatypeHeader(bytes, limits)
  if (header.datatypeClass === 0) return parseIntegerDatatype(bytes, header)
  if (header.datatypeClass === 1) return parseFloatDatatype(bytes, header)
  if (header.datatypeClass === 3) return parseStringDatatype(bytes, header)
  throw unsupportedOperation(`HDF5 datatype class ${header.datatypeClass} is not supported by D3`)
}

const requiredMessage = (
  object: Hdf5ObjectHeader,
  type: number,
  name: string,
  label: string,
): Hdf5ObjectHeaderMessage => {
  const messages = object.messages.filter((message) => message.type === type)
  if (messages.length !== 1) {
    throw invalidInput(`${label} must contain exactly one ${name} message`)
  }
  const message = messages[0]
  if (message === undefined) throw invalidInput(`${label} is missing its ${name} message`)
  if ((message.flags & 2) !== 0) {
    throw unsupportedOperation(`${label} has a shared ${name} message`)
  }
  return message
}

const optionalMessage = (
  object: Hdf5ObjectHeader,
  type: number,
  name: string,
  label: string,
): Hdf5ObjectHeaderMessage | undefined => {
  const messages = object.messages.filter((message) => message.type === type)
  if (messages.length > 1) throw invalidInput(`${label} repeats its ${name} message`)
  const message = messages[0]
  if (message !== undefined && (message.flags & 2) !== 0) {
    throw unsupportedOperation(`${label} has a shared ${name} message`)
  }
  return message
}

const bytesEqual = (left: Uint8Array | undefined, right: Uint8Array | undefined): boolean => {
  if (left === undefined || right === undefined) return left === right
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

const validateFillValue = (fillValue: Hdf5FillValue, datatype: Hdf5Datatype): void => {
  if (fillValue.status === 'defined' && fillValue.value?.byteLength !== datatype.byteLength) {
    throw invalidInput('HDF5 fill value byte length does not match the dataset datatype')
  }
}

const validateLayoutAddress = (
  file: Hdf5FileLayer,
  layout: Hdf5DatasetLayout,
  label: string,
): void => {
  if (layout.kind === 'compact') return
  if (layout.kind === 'contiguous') {
    if (layout.address !== undefined) {
      file.resolveAddress(layout.address, BigInt(layout.storageBytes), `${label} contiguous data`)
    }
    return
  }
  if (layout.index.address === undefined) return
  const bytes =
    layout.index.kind === 'single' ? (layout.index.filteredChunkBytes ?? layout.chunkBytes) : 1
  file.resolveAddress(layout.index.address, BigInt(bytes), `${label} chunk storage`)
}

export const readHdf5DatasetTypeAndSpace = async (
  file: Hdf5FileLayer,
  object: Hdf5ObjectHeader,
  options: Readonly<Hdf5DatasetMetadataOptions> = {},
): Promise<Hdf5DatasetTypeAndSpace> => {
  throwIfAborted(options.signal)
  const limits = resolveLimits(options)
  const label = `HDF5 dataset ${JSON.stringify(options.objectPath ?? '/')}`
  const dataspaceMessage = requiredMessage(object, 0x0001, 'dataspace', label)
  const datatypeMessage = requiredMessage(object, 0x0003, 'datatype', label)
  if (
    dataspaceMessage.dataBytes > limits.maxMessageBytes ||
    datatypeMessage.dataBytes > limits.maxMessageBytes
  ) {
    throw limitExceeded(`${label} dataset metadata message exceeds ${limits.maxMessageBytes} bytes`)
  }
  const readOptions: Readonly<ImageSourceReadOptions> =
    options.signal === undefined ? {} : { signal: options.signal }
  const dataspaceBytes = await file.readMetadata(
    dataspaceMessage.dataAddress,
    dataspaceMessage.dataBytes,
    readOptions,
  )
  throwIfAborted(options.signal)
  const datatypeBytes = await file.readMetadata(
    datatypeMessage.dataAddress,
    datatypeMessage.dataBytes,
    readOptions,
  )
  throwIfAborted(options.signal)
  return Object.freeze({
    dataspace: parseHdf5DataspaceMessage(dataspaceBytes, file.superblock.lengthSize, limits),
    datatype: parseHdf5DatatypeMessage(datatypeBytes, limits),
    metadataBytes: dataspaceBytes.byteLength + datatypeBytes.byteLength,
  })
}

export const readHdf5DatasetMetadata = async (
  file: Hdf5FileLayer,
  object: Hdf5ObjectHeader,
  options: Readonly<Hdf5DatasetMetadataOptions> = {},
): Promise<Hdf5DatasetMetadata> => {
  throwIfAborted(options.signal)
  const limits = resolveLimits(options)
  const label = `HDF5 dataset ${JSON.stringify(options.objectPath ?? '/')}`
  if (object.messages.some((message) => message.type === 0x0007)) {
    throw unsupportedOperation(`${label} uses external raw data storage`)
  }
  const typeAndSpace = await readHdf5DatasetTypeAndSpace(file, object, options)
  const layoutMessage = requiredMessage(object, 0x0008, 'layout', label)
  const oldFillMessage = optionalMessage(object, 0x0004, 'old fill value', label)
  const fillMessage = optionalMessage(object, 0x0005, 'fill value', label)
  const messages = [layoutMessage, oldFillMessage, fillMessage].filter(
    (message): message is Hdf5ObjectHeaderMessage => message !== undefined,
  )
  for (const message of messages) {
    if (message.dataBytes > limits.maxMessageBytes) {
      throw limitExceeded(
        `${label} dataset metadata message exceeds ${limits.maxMessageBytes} bytes`,
      )
    }
  }
  const readOptions: Readonly<ImageSourceReadOptions> =
    options.signal === undefined ? {} : { signal: options.signal }
  const payloads: Uint8Array<ArrayBuffer>[] = []
  for (const message of messages) {
    throwIfAborted(options.signal)
    payloads.push(await file.readMetadata(message.dataAddress, message.dataBytes, readOptions))
  }
  throwIfAborted(options.signal)
  const layoutBytes = payloads[0]
  if (layoutBytes === undefined) throw invalidInput(`${label} is missing its layout message`)
  const layout = parseHdf5LayoutMessage(
    layoutBytes,
    file.superblock.offsetSize,
    file.superblock.lengthSize,
    typeAndSpace.dataspace,
    typeAndSpace.datatype,
    options,
  )
  validateLayoutAddress(file, layout, label)

  let payloadIndex = 1
  const oldFillValue =
    oldFillMessage === undefined
      ? undefined
      : parseHdf5OldFillValueMessage(payloads[payloadIndex++] ?? new Uint8Array(), options)
  const newFillValue =
    fillMessage === undefined
      ? undefined
      : parseHdf5FillValueMessage(payloads[payloadIndex] ?? new Uint8Array(), options)
  if (
    oldFillValue !== undefined &&
    newFillValue !== undefined &&
    (oldFillValue.status !== newFillValue.status ||
      !bytesEqual(oldFillValue.value, newFillValue.value))
  ) {
    throw invalidInput(`${label} has contradictory old and new fill value messages`)
  }
  const fillValue = newFillValue ?? oldFillValue ?? defaultHdf5FillValue()
  validateFillValue(fillValue, typeAndSpace.datatype)
  return Object.freeze({
    ...typeAndSpace,
    layout,
    fillValue,
    metadataBytes:
      typeAndSpace.metadataBytes +
      payloads.reduce((total, payload) => total + payload.byteLength, 0),
  })
}
