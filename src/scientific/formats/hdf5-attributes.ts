import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { ImageSourceReadOptions } from '../../source.ts'
import {
  parseHdf5DataspaceMessage,
  parseHdf5DatatypeMessage,
  type Hdf5DatasetMetadataLimits,
  type Hdf5Dataspace,
  type Hdf5Datatype,
  type Hdf5IntegerDatatype,
} from './hdf5-dataset.ts'
import {
  readHdf5GlobalHeapCollection,
  type Hdf5GlobalHeapCollection,
  type Hdf5GlobalHeapLimits,
} from './hdf5-global-heap.ts'
import type { Hdf5ObjectHeader } from './hdf5-object.ts'
import type { Hdf5FileLayer } from './hdf5.ts'

export interface Hdf5AttributeLimits extends Hdf5DatasetMetadataLimits, Hdf5GlobalHeapLimits {
  readonly maxAttributes?: number
  readonly maxAttributeNameBytes?: number
  readonly maxAttributeValueBytes?: number
  readonly maxAttributeMetadataBytes?: number
  readonly maxAttributeReadOperations?: number
}

export interface Hdf5AttributeReadOptions extends AbortOptions, Hdf5AttributeLimits {
  readonly names?: readonly string[]
  readonly objectPath?: string
}

export interface Hdf5Attribute {
  readonly name: string
  readonly characterSet: 'ascii' | 'utf-8'
  readonly datatype: Hdf5Datatype
  readonly dataspace: Hdf5Dataspace
  readonly data: Uint8Array<ArrayBuffer>
  /** Resolved bytes for an indirect variable-length value; `data` retains its descriptor. */
  readonly variableData?: Uint8Array<ArrayBuffer>
  readonly metadataBytes: number
}

interface ResolvedAttributeLimits {
  readonly maxMessageBytes: number
  readonly maxAttributes: number
  readonly maxAttributeNameBytes: number
  readonly maxAttributeValueBytes: number
  readonly maxAttributeMetadataBytes: number
  readonly maxAttributeReadOperations: number
  readonly maxGlobalHeapCollectionBytes: number
  readonly maxGlobalHeapObjects: number
  readonly maxGlobalHeapObjectBytes: number
}

interface AttributePrefix {
  readonly version: 1 | 2 | 3
  readonly flags: number
  readonly characterSet: 'ascii' | 'utf-8'
  readonly name: string
  readonly datatypeOffset: number
  readonly datatypeBytes: number
  readonly dataspaceOffset: number
  readonly dataspaceBytes: number
  readonly valueOffset: number
}

const defaults: ResolvedAttributeLimits = Object.freeze({
  maxMessageBytes: 65_536,
  maxAttributes: 1_024,
  maxAttributeNameBytes: 65_536,
  maxAttributeValueBytes: 1_048_576,
  maxAttributeMetadataBytes: 4_194_304,
  maxAttributeReadOperations: 2_049,
  maxGlobalHeapCollectionBytes: 1_048_576,
  maxGlobalHeapObjects: 4_096,
  maxGlobalHeapObjectBytes: 1_048_576,
})

const positiveSafeInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const resolveLimits = (options: Readonly<Hdf5AttributeLimits>): ResolvedAttributeLimits =>
  Object.freeze({
    maxMessageBytes: positiveSafeInteger(
      'HDF5 attribute maxMessageBytes',
      options.maxMessageBytes ?? defaults.maxMessageBytes,
    ),
    maxAttributes: positiveSafeInteger(
      'HDF5 attribute maxAttributes',
      options.maxAttributes ?? defaults.maxAttributes,
    ),
    maxAttributeNameBytes: positiveSafeInteger(
      'HDF5 attribute maxAttributeNameBytes',
      options.maxAttributeNameBytes ?? defaults.maxAttributeNameBytes,
    ),
    maxAttributeValueBytes: positiveSafeInteger(
      'HDF5 attribute maxAttributeValueBytes',
      options.maxAttributeValueBytes ?? defaults.maxAttributeValueBytes,
    ),
    maxAttributeMetadataBytes: positiveSafeInteger(
      'HDF5 attribute maxAttributeMetadataBytes',
      options.maxAttributeMetadataBytes ?? defaults.maxAttributeMetadataBytes,
    ),
    maxAttributeReadOperations: positiveSafeInteger(
      'HDF5 attribute maxAttributeReadOperations',
      options.maxAttributeReadOperations ?? defaults.maxAttributeReadOperations,
    ),
    maxGlobalHeapCollectionBytes: positiveSafeInteger(
      'HDF5 attribute maxGlobalHeapCollectionBytes',
      options.maxGlobalHeapCollectionBytes ?? defaults.maxGlobalHeapCollectionBytes,
    ),
    maxGlobalHeapObjects: positiveSafeInteger(
      'HDF5 attribute maxGlobalHeapObjects',
      options.maxGlobalHeapObjects ?? defaults.maxGlobalHeapObjects,
    ),
    maxGlobalHeapObjectBytes: positiveSafeInteger(
      'HDF5 attribute maxGlobalHeapObjectBytes',
      options.maxGlobalHeapObjectBytes ?? defaults.maxGlobalHeapObjectBytes,
    ),
  })

const requireBytes = (bytes: Uint8Array, offset: number, length: number, label: string): void => {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw invalidInput(`${label} is truncated`)
  }
}

const allZero = (bytes: Uint8Array, start: number): boolean => {
  for (let index = start; index < bytes.byteLength; index += 1) {
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

const paddedToEight = (value: number): number => (value + 7) & ~7

const decodeName = (bytes: Uint8Array, characterSet: 'ascii' | 'utf-8', label: string): string => {
  if (bytes.byteLength < 1 || bytes[bytes.byteLength - 1] !== 0) {
    throw invalidInput(`${label} is not NUL-terminated`)
  }
  const content = bytes.subarray(0, bytes.byteLength - 1)
  if (content.includes(0)) throw invalidInput(`${label} contains an embedded NUL byte`)
  if (characterSet === 'ascii' && content.some((value) => value > 0x7f)) {
    throw invalidInput(`${label} is not ASCII`)
  }
  try {
    return new TextDecoder(characterSet === 'ascii' ? 'ascii' : 'utf-8', { fatal: true }).decode(
      content,
    )
  } catch {
    throw invalidInput(`${label} is not valid ${characterSet.toUpperCase()}`)
  }
}

const parsePrefix = (
  bytes: Uint8Array,
  label: string,
  limits: ResolvedAttributeLimits,
): AttributePrefix => {
  requireBytes(bytes, 0, 8, `${label} header`)
  const version = bytes[0]
  if (version !== 1 && version !== 2 && version !== 3) {
    throw unsupportedOperation(`${label} version ${version} is not supported`)
  }
  const flags = bytes[1] ?? 0
  if (version === 1) {
    if (flags !== 0) throw invalidInput(`${label} version 1 reserved byte is non-zero`)
  } else if ((flags & ~3) !== 0) {
    throw invalidInput(`${label} has reserved flags set`)
  }
  const headerBytes = version === 3 ? 9 : 8
  requireBytes(bytes, 0, headerBytes, `${label} header`)
  const characterSetValue = version === 3 ? (bytes[8] ?? 0) : 0
  if (characterSetValue !== 0 && characterSetValue !== 1) {
    throw invalidInput(`${label} character set ${characterSetValue} is invalid`)
  }
  const characterSet = characterSetValue === 0 ? 'ascii' : 'utf-8'
  const nameBytes = littleEndianUint16(bytes, 2)
  const datatypeBytes = littleEndianUint16(bytes, 4)
  const dataspaceBytes = littleEndianUint16(bytes, 6)
  if (nameBytes < 1) throw invalidInput(`${label} has an empty name field`)
  if (nameBytes > limits.maxAttributeNameBytes) {
    throw limitExceeded(`${label} name exceeds ${limits.maxAttributeNameBytes} bytes`)
  }
  if (datatypeBytes < 1 || dataspaceBytes < 1) {
    throw invalidInput(`${label} has an empty datatype or dataspace field`)
  }
  const nameOffset = headerBytes
  const datatypeOffset = nameOffset + (version === 1 ? paddedToEight(nameBytes) : nameBytes)
  const dataspaceOffset =
    datatypeOffset + (version === 1 ? paddedToEight(datatypeBytes) : datatypeBytes)
  const valueOffset =
    dataspaceOffset + (version === 1 ? paddedToEight(dataspaceBytes) : dataspaceBytes)
  requireBytes(bytes, nameOffset, nameBytes, `${label} name`)
  requireBytes(bytes, datatypeOffset, datatypeBytes, `${label} datatype`)
  requireBytes(bytes, dataspaceOffset, dataspaceBytes, `${label} dataspace`)
  return Object.freeze({
    version,
    flags,
    characterSet,
    name: decodeName(
      bytes.subarray(nameOffset, nameOffset + nameBytes),
      characterSet,
      `${label} name`,
    ),
    datatypeOffset,
    datatypeBytes,
    dataspaceOffset,
    dataspaceBytes,
    valueOffset,
  })
}

const requestedNames = (
  names: readonly string[] | undefined,
  maximumNameBytes: number,
): ReadonlySet<string> | undefined => {
  if (names === undefined) return undefined
  const output = new Set<string>()
  for (const name of names) {
    if (name.length === 0 || name.includes('\0')) {
      throw invalidInput('HDF5 requested attribute name is invalid')
    }
    const bytes = new TextEncoder().encode(name).byteLength
    if (bytes > maximumNameBytes) {
      throw limitExceeded(`HDF5 requested attribute name exceeds ${maximumNameBytes} bytes`)
    }
    if (output.has(name))
      throw invalidInput(`HDF5 requested attribute ${JSON.stringify(name)} repeats`)
    output.add(name)
  }
  return output
}

const addressIsUndefined = (bytes: Uint8Array, offset: number, width: number): boolean => {
  for (let index = 0; index < width; index += 1) {
    if (bytes[offset + index] !== 0xff) return false
  }
  return true
}

const assertCompactAttributeInfo = (bytes: Uint8Array, offsetSize: number, label: string): void => {
  requireBytes(bytes, 0, 2, `${label} header`)
  if (bytes[0] !== 0) {
    throw unsupportedOperation(`${label} version ${bytes[0]} is not supported`)
  }
  const flags = bytes[1] ?? 0
  if ((flags & ~3) !== 0 || ((flags & 2) !== 0 && (flags & 1) === 0)) {
    throw invalidInput(`${label} flags are invalid`)
  }
  let position = 2
  if ((flags & 1) !== 0) {
    requireBytes(bytes, position, 2, `${label} maximum creation index`)
    position += 2
  }
  requireBytes(bytes, position, offsetSize * 2, `${label} dense-storage addresses`)
  const heapDefined = !addressIsUndefined(bytes, position, offsetSize)
  position += offsetSize
  const nameIndexDefined = !addressIsUndefined(bytes, position, offsetSize)
  position += offsetSize
  let creationIndexDefined = false
  if ((flags & 2) !== 0) {
    requireBytes(bytes, position, offsetSize, `${label} creation-order index address`)
    creationIndexDefined = !addressIsUndefined(bytes, position, offsetSize)
    position += offsetSize
  }
  if (!allZero(bytes, position)) throw invalidInput(`${label} has non-zero trailing bytes`)
  if (heapDefined !== nameIndexDefined || (creationIndexDefined && !heapDefined)) {
    throw invalidInput(`${label} has inconsistent dense-storage addresses`)
  }
  if (heapDefined) throw unsupportedOperation(`${label} uses dense attribute storage`)
}

export const readHdf5Attributes = async (
  file: Hdf5FileLayer,
  object: Hdf5ObjectHeader,
  options: Readonly<Hdf5AttributeReadOptions> = {},
): Promise<readonly Hdf5Attribute[]> => {
  throwIfAborted(options.signal)
  const limits = resolveLimits(options)
  const selected = requestedNames(options.names, limits.maxAttributeNameBytes)
  const label = `HDF5 object ${JSON.stringify(options.objectPath ?? '/')}`
  const infoMessages = object.messages.filter((message) => message.type === 0x0015)
  if (infoMessages.length > 1) throw invalidInput(`${label} repeats its attribute-info message`)
  const messages = object.messages.filter((message) => message.type === 0x000c)
  if (messages.length > limits.maxAttributes) {
    throw limitExceeded(`${label} exceeds ${limits.maxAttributes} compact attributes`)
  }
  let readOperations = messages.length + infoMessages.length
  if (readOperations > limits.maxAttributeReadOperations) {
    throw limitExceeded(
      `${label} exceeds ${limits.maxAttributeReadOperations} attribute read operations`,
    )
  }
  let metadataBytes = [...infoMessages, ...messages].reduce(
    (sum, message) => sum + BigInt(message.dataBytes),
    0n,
  )
  if (metadataBytes > BigInt(limits.maxAttributeMetadataBytes)) {
    throw limitExceeded(
      `${label} attribute metadata exceeds ${limits.maxAttributeMetadataBytes} bytes`,
    )
  }
  for (const message of [...infoMessages, ...messages]) {
    if (message.dataBytes > limits.maxMessageBytes) {
      throw limitExceeded(
        `${label} attribute metadata message exceeds ${limits.maxMessageBytes} bytes`,
      )
    }
  }
  const seen = new Set<string>()
  const output: Hdf5Attribute[] = []
  const globalHeaps = new Map<bigint, Hdf5GlobalHeapCollection>()
  const readOptions: Readonly<ImageSourceReadOptions> =
    options.signal === undefined ? {} : { signal: options.signal }
  const infoMessage = infoMessages[0]
  if (infoMessage !== undefined) {
    if ((infoMessage.flags & 2) !== 0) {
      throw unsupportedOperation(`${label} attribute-info message is shared`)
    }
    const bytes = await file.readMetadata(
      infoMessage.dataAddress,
      infoMessage.dataBytes,
      readOptions,
    )
    throwIfAborted(options.signal)
    assertCompactAttributeInfo(bytes, file.superblock.offsetSize, `${label} attribute-info message`)
  }
  for (let index = 0; index < messages.length; index += 1) {
    throwIfAborted(options.signal)
    const message = messages[index]
    if (message === undefined) continue
    if ((message.flags & 2) !== 0) {
      throw unsupportedOperation(`${label} attribute ${index} is a shared object-header message`)
    }
    const bytes = await file.readMetadata(message.dataAddress, message.dataBytes, readOptions)
    throwIfAborted(options.signal)
    const prefix = parsePrefix(bytes, `${label} attribute ${index}`, limits)
    if (seen.has(prefix.name)) {
      throw invalidInput(`${label} repeats attribute ${JSON.stringify(prefix.name)}`)
    }
    seen.add(prefix.name)
    if (selected !== undefined && !selected.has(prefix.name)) continue
    if ((prefix.flags & 1) !== 0) {
      throw unsupportedOperation(
        `${label} attribute ${JSON.stringify(prefix.name)} uses a shared datatype`,
      )
    }
    if ((prefix.flags & 2) !== 0) {
      throw unsupportedOperation(
        `${label} attribute ${JSON.stringify(prefix.name)} uses a shared dataspace`,
      )
    }
    const datatype = parseHdf5DatatypeMessage(
      bytes.subarray(prefix.datatypeOffset, prefix.datatypeOffset + prefix.datatypeBytes),
      options,
    )
    const dataspace = parseHdf5DataspaceMessage(
      bytes.subarray(prefix.dataspaceOffset, prefix.dataspaceOffset + prefix.dataspaceBytes),
      file.superblock.lengthSize,
      options,
    )
    const valueBytes = BigInt(datatype.byteLength) * BigInt(dataspace.elementCount)
    if (valueBytes > BigInt(limits.maxAttributeValueBytes)) {
      throw limitExceeded(
        `${label} attribute ${JSON.stringify(prefix.name)} value exceeds ${limits.maxAttributeValueBytes} bytes`,
      )
    }
    const valueLength = Number(valueBytes)
    requireBytes(
      bytes,
      prefix.valueOffset,
      valueLength,
      `${label} attribute ${JSON.stringify(prefix.name)} value`,
    )
    if (!allZero(bytes, prefix.valueOffset + valueLength)) {
      throw invalidInput(
        `${label} attribute ${JSON.stringify(prefix.name)} has non-zero trailing bytes`,
      )
    }
    const data = bytes.slice(prefix.valueOffset, prefix.valueOffset + valueLength)
    let variableData: Uint8Array<ArrayBuffer> | undefined
    if (datatype.kind === 'variable-string') {
      if (dataspace.elementCount !== 1) {
        throw unsupportedOperation(
          `${label} attribute ${JSON.stringify(prefix.name)} is a variable-length string array`,
        )
      }
      const descriptorBytes = 8 + file.superblock.offsetSize
      if (datatype.byteLength !== descriptorBytes || data.byteLength !== descriptorBytes) {
        throw invalidInput(
          `${label} attribute ${JSON.stringify(prefix.name)} has an invalid variable-length descriptor size`,
        )
      }
      const declaredBytes = littleEndianUint32(data, 0)
      if (declaredBytes > limits.maxAttributeValueBytes) {
        throw limitExceeded(
          `${label} attribute ${JSON.stringify(prefix.name)} value exceeds ${limits.maxAttributeValueBytes} bytes`,
        )
      }
      const heapAddress = littleEndianUnsigned(data, 4, file.superblock.offsetSize)
      const heapIndex = littleEndianUint32(data, 4 + file.superblock.offsetSize)
      if (declaredBytes === 0) {
        variableData = new Uint8Array()
      } else {
        const undefinedAddress = heapAddress === (1n << BigInt(file.superblock.offsetSize * 8)) - 1n
        if (undefinedAddress || heapIndex === 0) {
          throw invalidInput(
            `${label} attribute ${JSON.stringify(prefix.name)} has an undefined global heap object`,
          )
        }
        let heap = globalHeaps.get(heapAddress)
        if (heap === undefined) {
          readOperations += 1
          if (readOperations > limits.maxAttributeReadOperations) {
            throw limitExceeded(
              `${label} exceeds ${limits.maxAttributeReadOperations} attribute read operations`,
            )
          }
          heap = await readHdf5GlobalHeapCollection(file, heapAddress, {
            maxGlobalHeapCollectionBytes: limits.maxGlobalHeapCollectionBytes,
            maxGlobalHeapObjects: limits.maxGlobalHeapObjects,
            maxGlobalHeapObjectBytes: Math.min(
              limits.maxGlobalHeapObjectBytes,
              limits.maxAttributeValueBytes,
            ),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          })
          globalHeaps.set(heapAddress, heap)
          metadataBytes += BigInt(heap.byteLength)
          if (metadataBytes > BigInt(limits.maxAttributeMetadataBytes)) {
            throw limitExceeded(
              `${label} attribute metadata exceeds ${limits.maxAttributeMetadataBytes} bytes`,
            )
          }
        }
        const object = heap.objects.get(heapIndex)
        if (object === undefined) {
          throw invalidInput(
            `${label} attribute ${JSON.stringify(prefix.name)} references missing global heap object ${heapIndex}`,
          )
        }
        if (object.byteLength !== declaredBytes) {
          throw invalidInput(
            `${label} attribute ${JSON.stringify(prefix.name)} global heap length does not match its descriptor`,
          )
        }
        variableData = object
      }
    }
    output.push(
      Object.freeze({
        name: prefix.name,
        characterSet: prefix.characterSet,
        datatype,
        dataspace,
        data,
        ...(variableData === undefined ? {} : { variableData }),
        metadataBytes: message.dataBytes,
      }),
    )
  }
  return Object.freeze(output)
}

const unsignedInteger = (bytes: Uint8Array, datatype: Hdf5IntegerDatatype): bigint => {
  let value = 0n
  if (datatype.byteOrder === 'little-endian') {
    for (let index = bytes.byteLength - 1; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(bytes[index] ?? 0)
    }
    return value
  }
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

export const hdf5IntegerAttributeValue = (attribute: Readonly<Hdf5Attribute>): bigint => {
  if (attribute.dataspace.kind !== 'scalar' || attribute.datatype.kind !== 'integer') {
    throw invalidInput(`HDF5 attribute ${JSON.stringify(attribute.name)} is not a scalar integer`)
  }
  const datatype = attribute.datatype
  if (
    datatype.bitOffset !== 0 ||
    datatype.bitPrecision !== datatype.byteLength * 8 ||
    datatype.lowPadding !== 0 ||
    datatype.highPadding !== 0
  ) {
    throw unsupportedOperation(
      `HDF5 attribute ${JSON.stringify(attribute.name)} uses a packed integer representation`,
    )
  }
  const unsigned = unsignedInteger(attribute.data, datatype)
  if (!datatype.signed) return unsigned
  const signBit = 1n << BigInt(datatype.bitPrecision - 1)
  return (unsigned & signBit) === 0n ? unsigned : unsigned - (1n << BigInt(datatype.bitPrecision))
}

const halfFloat = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

export const hdf5FloatAttributeValue = (attribute: Readonly<Hdf5Attribute>): number => {
  if (attribute.dataspace.kind !== 'scalar' || attribute.datatype.kind !== 'float') {
    throw invalidInput(`HDF5 attribute ${JSON.stringify(attribute.name)} is not a scalar float`)
  }
  const datatype = attribute.datatype
  const view = new DataView(
    attribute.data.buffer,
    attribute.data.byteOffset,
    attribute.data.byteLength,
  )
  const littleEndian = datatype.byteOrder === 'little-endian'
  if (datatype.format === 'binary16') return halfFloat(view.getUint16(0, littleEndian))
  if (datatype.format === 'binary32') return view.getFloat32(0, littleEndian)
  return view.getFloat64(0, littleEndian)
}

export const hdf5StringAttributeValue = (attribute: Readonly<Hdf5Attribute>): string => {
  if (
    attribute.dataspace.elementCount !== 1 ||
    (attribute.datatype.kind !== 'fixed-string' && attribute.datatype.kind !== 'variable-string')
  ) {
    throw invalidInput(`HDF5 attribute ${JSON.stringify(attribute.name)} is not one string`)
  }
  const datatype = attribute.datatype
  const data = datatype.kind === 'variable-string' ? attribute.variableData : attribute.data
  if (data === undefined) {
    throw invalidInput(
      `HDF5 attribute ${JSON.stringify(attribute.name)} has no resolved variable-length value`,
    )
  }
  let end = data.byteLength
  if (datatype.kind === 'fixed-string' && datatype.padding === 'space-padded') {
    while (end > 0 && data[end - 1] === 0x20) end -= 1
    if (data.subarray(0, end).includes(0)) {
      throw invalidInput(
        `HDF5 attribute ${JSON.stringify(attribute.name)} has invalid space padding`,
      )
    }
  } else if (datatype.kind === 'fixed-string') {
    const terminator = data.indexOf(0)
    if (terminator >= 0) {
      end = terminator
      if (!allZero(data, terminator)) {
        throw invalidInput(
          `HDF5 attribute ${JSON.stringify(attribute.name)} has invalid NUL padding`,
        )
      }
    }
  }
  const content = data.subarray(0, end)
  if (content.includes(0)) {
    throw invalidInput(`HDF5 attribute ${JSON.stringify(attribute.name)} contains an embedded NUL`)
  }
  if (datatype.characterSet === 'ascii' && content.some((value) => value > 0x7f)) {
    throw invalidInput(`HDF5 attribute ${JSON.stringify(attribute.name)} is not ASCII`)
  }
  try {
    return new TextDecoder(datatype.characterSet === 'ascii' ? 'ascii' : 'utf-8', {
      fatal: true,
    }).decode(content)
  } catch {
    throw invalidInput(
      `HDF5 attribute ${JSON.stringify(attribute.name)} is not valid ${datatype.characterSet.toUpperCase()}`,
    )
  }
}
