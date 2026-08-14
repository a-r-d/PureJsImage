import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { ImageSourceReadOptions } from '../../source.ts'
import { hdf5MetadataChecksum, type Hdf5FileLayer } from './hdf5.ts'

export interface Hdf5ObjectHeaderLimits {
  readonly maxHeaderBytes?: number
  readonly maxMessages?: number
  readonly maxContinuationBlocks?: number
  readonly maxLinkNameBytes?: number
  readonly maxSoftLinkBytes?: number
}

export interface Hdf5ObjectHeaderOptions extends AbortOptions, Hdf5ObjectHeaderLimits {
  readonly objectPath?: string
}

export interface Hdf5ObjectHeaderMessage {
  readonly type: number
  readonly flags: number
  readonly creationOrder: number | undefined
  readonly dataAddress: bigint
  readonly dataBytes: number
  readonly chunkIndex: number
}

interface Hdf5LinkBase {
  readonly name: string
  readonly characterSet: 'ascii' | 'utf-8'
  readonly creationOrder: bigint | undefined
}

export interface Hdf5HardLink extends Hdf5LinkBase {
  readonly kind: 'hard'
  readonly objectAddress: bigint
}

export interface Hdf5SoftLink extends Hdf5LinkBase {
  readonly kind: 'soft'
  readonly target: string
}

export type Hdf5Link = Hdf5HardLink | Hdf5SoftLink

export interface Hdf5DenseLinkStorage {
  readonly kind: 'dense'
  readonly maximumCreationIndex: bigint | undefined
  readonly fractalHeapAddress: bigint
  readonly nameIndexAddress: bigint
  readonly creationOrderIndexAddress: bigint | undefined
}

export interface Hdf5CompactLinkStorage {
  readonly kind: 'compact'
  readonly maximumCreationIndex: bigint | undefined
}

export interface Hdf5LegacyLinkStorage {
  readonly kind: 'legacy'
  readonly btreeAddress: bigint
  readonly localHeapAddress: bigint
}

export type Hdf5LinkStorage = Hdf5DenseLinkStorage | Hdf5CompactLinkStorage | Hdf5LegacyLinkStorage

export interface Hdf5ObjectHeader {
  readonly address: bigint
  readonly version: 1 | 2
  readonly flags: number
  readonly referenceCount: number
  readonly messages: readonly Hdf5ObjectHeaderMessage[]
  readonly links: readonly Hdf5Link[]
  readonly linkStorage: Hdf5LinkStorage | undefined
  readonly continuationBlocks: number
  readonly metadataBytes: number
}

interface ResolvedLimits {
  readonly maxHeaderBytes: number
  readonly maxMessages: number
  readonly maxContinuationBlocks: number
  readonly maxLinkNameBytes: number
  readonly maxSoftLinkBytes: number
}

export interface Hdf5LinkMessageOptions {
  readonly objectLabel: string
  readonly maxLinkNameBytes: number
  readonly maxSoftLinkBytes: number
  readonly messageFlags?: number
}

interface Continuation {
  readonly address: bigint
  readonly bytes: number
}

interface ParseState {
  readonly file: Hdf5FileLayer
  readonly limits: ResolvedLimits
  readonly objectAddress: bigint
  readonly objectLabel: string
  readonly options: Readonly<ImageSourceReadOptions>
  readonly messages: Hdf5ObjectHeaderMessage[]
  readonly links: Hdf5Link[]
  readonly linkNames: Set<string>
  readonly continuations: Continuation[]
  readonly visitedContinuations: Set<bigint>
  linkStorage: Hdf5LinkStorage | undefined
  metadataBytes: number
}

const defaultLimits: ResolvedLimits = Object.freeze({
  maxHeaderBytes: 1_048_576,
  maxMessages: 4_096,
  maxContinuationBlocks: 64,
  maxLinkNameBytes: 65_536,
  maxSoftLinkBytes: 65_536,
})

const knownMessageTypes: ReadonlySet<number> = new Set([
  0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, 0x0008, 0x0009, 0x000a, 0x000b,
  0x000c, 0x000d, 0x000e, 0x000f, 0x0010, 0x0011, 0x0012, 0x0013, 0x0014, 0x0015, 0x0016, 0x0017,
  0x0018,
])

const positiveSafeInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const resolveLimits = (options: Readonly<Hdf5ObjectHeaderLimits>): ResolvedLimits =>
  Object.freeze({
    maxHeaderBytes: positiveSafeInteger(
      'HDF5 object maxHeaderBytes',
      options.maxHeaderBytes ?? defaultLimits.maxHeaderBytes,
    ),
    maxMessages: positiveSafeInteger(
      'HDF5 object maxMessages',
      options.maxMessages ?? defaultLimits.maxMessages,
    ),
    maxContinuationBlocks: positiveSafeInteger(
      'HDF5 object maxContinuationBlocks',
      options.maxContinuationBlocks ?? defaultLimits.maxContinuationBlocks,
    ),
    maxLinkNameBytes: positiveSafeInteger(
      'HDF5 object maxLinkNameBytes',
      options.maxLinkNameBytes ?? defaultLimits.maxLinkNameBytes,
    ),
    maxSoftLinkBytes: positiveSafeInteger(
      'HDF5 object maxSoftLinkBytes',
      options.maxSoftLinkBytes ?? defaultLimits.maxSoftLinkBytes,
    ),
  })

const littleEndianUnsigned = (bytes: Uint8Array, offset: number, width: number): bigint => {
  let value = 0n
  for (let index = width - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  }
  return value
}

const littleEndianUint16 = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8)

const littleEndianUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0

const optionalAddress = (bytes: Uint8Array, offset: number, width: number): bigint | undefined => {
  const value = littleEndianUnsigned(bytes, offset, width)
  return value === (1n << BigInt(width * 8)) - 1n ? undefined : value
}

const boundedNumber = (value: bigint, maximum: number, label: string): number => {
  if (value > BigInt(maximum)) throw limitExceeded(`${label} ${value} exceeds limit ${maximum}`)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidInput(`${label} ${value} exceeds the safe integer range`)
  }
  return Number(value)
}

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

const decodeString = (
  bytes: Uint8Array,
  characterSet: 'ascii' | 'utf-8',
  label: string,
): string => {
  if (bytes.includes(0)) throw invalidInput(`${label} contains a NUL byte`)
  if (characterSet === 'ascii') {
    let value = ''
    for (const byte of bytes) {
      if (byte > 0x7f) throw invalidInput(`${label} is not valid ASCII`)
      value += String.fromCharCode(byte)
    }
    return value
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput(`${label} is not valid UTF-8`)
  }
}

const accountMetadata = (state: ParseState, bytes: number): void => {
  if (state.metadataBytes + bytes > state.limits.maxHeaderBytes) {
    throw limitExceeded(
      `${state.objectLabel} object-header metadata exceeds ${state.limits.maxHeaderBytes} bytes`,
    )
  }
  state.metadataBytes += bytes
}

const addMessage = (
  state: ParseState,
  message: Hdf5ObjectHeaderMessage,
  data: Uint8Array,
): void => {
  if (state.messages.length >= state.limits.maxMessages) {
    throw limitExceeded(`${state.objectLabel} exceeds ${state.limits.maxMessages} header messages`)
  }
  if (!knownMessageTypes.has(message.type) && (message.flags & 0x80) !== 0) {
    throw unsupportedOperation(
      `${state.objectLabel} has mandatory unknown HDF5 object-header message 0x${message.type.toString(16).padStart(4, '0')}`,
    )
  }
  state.messages.push(Object.freeze(message))
  if (
    (message.flags & 0x02) !== 0 &&
    (message.type === 0x0002 || message.type === 0x0010 || message.type === 0x0011)
  ) {
    throw unsupportedOperation(
      `${state.objectLabel} has shared object-header message 0x${message.type.toString(16).padStart(4, '0')}`,
    )
  }
  if (message.type === 0x0010) parseContinuation(state, data)
  if (message.type === 0x0006) parseLink(state, message.flags, data)
  if (message.type === 0x0002) parseLinkInfo(state, data)
  if (message.type === 0x0011) parseSymbolTable(state, data)
}

const parseSymbolTable = (state: ParseState, data: Uint8Array): void => {
  if (state.linkStorage !== undefined) {
    throw invalidInput(`${state.objectLabel} repeats or mixes group link-storage messages`)
  }
  const offsetSize = state.file.superblock.offsetSize
  requireBytes(data, 0, offsetSize * 2, `${state.objectLabel} symbol-table message`)
  if (!allZero(data, offsetSize * 2)) {
    throw invalidInput(`${state.objectLabel} symbol-table message has non-zero trailing bytes`)
  }
  const btreeAddress = optionalAddress(data, 0, offsetSize)
  const localHeapAddress = optionalAddress(data, offsetSize, offsetSize)
  if (btreeAddress === undefined || localHeapAddress === undefined) {
    throw invalidInput(`${state.objectLabel} symbol-table message has an undefined address`)
  }
  state.file.resolveAddress(btreeAddress, 1n, `${state.objectLabel} group B-tree`)
  state.file.resolveAddress(localHeapAddress, 1n, `${state.objectLabel} local heap`)
  state.linkStorage = Object.freeze({ kind: 'legacy', btreeAddress, localHeapAddress })
}

const parseContinuation = (state: ParseState, data: Uint8Array): void => {
  const offsetSize = state.file.superblock.offsetSize
  const lengthSize = state.file.superblock.lengthSize
  const required = offsetSize + lengthSize
  requireBytes(data, 0, required, `${state.objectLabel} continuation message`)
  if (!allZero(data, required)) {
    throw invalidInput(`${state.objectLabel} continuation message has non-zero trailing bytes`)
  }
  const address = optionalAddress(data, 0, offsetSize)
  if (address === undefined) {
    throw invalidInput(`${state.objectLabel} continuation address is undefined`)
  }
  const length = littleEndianUnsigned(data, offsetSize, lengthSize)
  const bytes = boundedNumber(
    length,
    state.limits.maxHeaderBytes,
    `${state.objectLabel} continuation`,
  )
  if (bytes < 1) throw invalidInput(`${state.objectLabel} continuation length must be positive`)
  state.file.resolveAddress(address, length, `${state.objectLabel} continuation`)
  if (address === state.objectAddress || state.visitedContinuations.has(address)) {
    throw invalidInput(`${state.objectLabel} has a repeated or cyclic continuation at ${address}`)
  }
  if (state.visitedContinuations.size >= state.limits.maxContinuationBlocks) {
    throw limitExceeded(
      `${state.objectLabel} exceeds ${state.limits.maxContinuationBlocks} continuation blocks`,
    )
  }
  state.visitedContinuations.add(address)
  state.continuations.push(Object.freeze({ address, bytes }))
}

export const parseHdf5LinkMessage = (
  file: Hdf5FileLayer,
  data: Uint8Array,
  options: Readonly<Hdf5LinkMessageOptions>,
): Hdf5Link => {
  const objectLabel = options.objectLabel
  if (((options.messageFlags ?? 0) & 0x02) !== 0) {
    throw unsupportedOperation(`${objectLabel} has a shared compact link message`)
  }
  requireBytes(data, 0, 2, `${objectLabel} compact link`)
  if (data[0] !== 1) {
    throw unsupportedOperation(`${objectLabel} has compact link version ${data[0]}`)
  }
  const flags = data[1] ?? 0
  if ((flags & 0xe0) !== 0) {
    throw invalidInput(`${objectLabel} compact link has reserved flags set`)
  }
  const nameWidth = 1 << (flags & 0x03)
  let position = 2
  let linkType = 0
  if ((flags & 0x08) !== 0) {
    requireBytes(data, position, 1, `${objectLabel} compact link type`)
    linkType = data[position] ?? 0
    position += 1
  }
  let creationOrder: bigint | undefined
  if ((flags & 0x04) !== 0) {
    requireBytes(data, position, 8, `${objectLabel} compact link creation order`)
    creationOrder = littleEndianUnsigned(data, position, 8)
    position += 8
  }
  let characterSet: 'ascii' | 'utf-8' = 'ascii'
  if ((flags & 0x10) !== 0) {
    requireBytes(data, position, 1, `${objectLabel} compact link character set`)
    const encodedCharacterSet = data[position] ?? 0
    position += 1
    if (encodedCharacterSet !== 0 && encodedCharacterSet !== 1) {
      throw invalidInput(
        `${objectLabel} compact link character set ${encodedCharacterSet} is invalid`,
      )
    }
    characterSet = encodedCharacterSet === 0 ? 'ascii' : 'utf-8'
  }
  requireBytes(data, position, nameWidth, `${objectLabel} compact link name length`)
  const nameBytes = boundedNumber(
    littleEndianUnsigned(data, position, nameWidth),
    options.maxLinkNameBytes,
    `${objectLabel} link name`,
  )
  position += nameWidth
  if (nameBytes < 1) throw invalidInput(`${objectLabel} compact link name is empty`)
  requireBytes(data, position, nameBytes, `${objectLabel} compact link name`)
  const name = decodeString(
    data.subarray(position, position + nameBytes),
    characterSet,
    `${objectLabel} compact link name`,
  )
  position += nameBytes
  if (name.includes('/')) throw invalidInput(`${objectLabel} compact link name contains '/'`)

  let link: Hdf5Link
  if (linkType === 0) {
    const offsetSize = file.superblock.offsetSize
    requireBytes(data, position, offsetSize, `${objectLabel} hard-link target`)
    const objectAddress = optionalAddress(data, position, offsetSize)
    if (objectAddress === undefined) {
      throw invalidInput(`${objectLabel} hard-link target is undefined`)
    }
    file.resolveAddress(objectAddress, 1n, `${objectLabel} hard-link target`)
    position += offsetSize
    link = Object.freeze({ kind: 'hard', name, characterSet, creationOrder, objectAddress })
  } else if (linkType === 1) {
    requireBytes(data, position, 2, `${objectLabel} soft-link length`)
    const targetBytes = littleEndianUint16(data, position)
    position += 2
    if (targetBytes > options.maxSoftLinkBytes) {
      throw limitExceeded(
        `${objectLabel} soft-link target ${targetBytes} exceeds limit ${options.maxSoftLinkBytes}`,
      )
    }
    requireBytes(data, position, targetBytes, `${objectLabel} soft-link target`)
    const target = decodeString(
      data.subarray(position, position + targetBytes),
      'utf-8',
      `${objectLabel} soft-link target`,
    )
    position += targetBytes
    link = Object.freeze({ kind: 'soft', name, characterSet, creationOrder, target })
  } else if (linkType === 64) {
    throw unsupportedOperation(
      `${objectLabel} external link ${JSON.stringify(name)} is unsupported`,
    )
  } else if (linkType >= 65) {
    throw unsupportedOperation(
      `${objectLabel} user-defined link type ${linkType} for ${JSON.stringify(name)} is unsupported`,
    )
  } else {
    throw unsupportedOperation(
      `${objectLabel} reserved link type ${linkType} for ${JSON.stringify(name)} is unsupported`,
    )
  }
  if (!allZero(data, position)) {
    throw invalidInput(`${objectLabel} compact link has non-zero trailing bytes`)
  }
  return link
}

const parseLink = (state: ParseState, messageFlags: number, data: Uint8Array): void => {
  const link = parseHdf5LinkMessage(state.file, data, {
    objectLabel: state.objectLabel,
    maxLinkNameBytes: state.limits.maxLinkNameBytes,
    maxSoftLinkBytes: state.limits.maxSoftLinkBytes,
    messageFlags,
  })
  if (state.linkNames.has(link.name)) {
    throw invalidInput(`${state.objectLabel} repeats compact link ${JSON.stringify(link.name)}`)
  }
  state.linkNames.add(link.name)
  state.links.push(link)
}

const parseLinkInfo = (state: ParseState, data: Uint8Array): void => {
  if (state.linkStorage !== undefined) {
    throw invalidInput(`${state.objectLabel} repeats or mixes group link-storage messages`)
  }
  requireBytes(data, 0, 2, `${state.objectLabel} link-info message`)
  if (data[0] !== 0)
    throw unsupportedOperation(`${state.objectLabel} has link-info version ${data[0]}`)
  const flags = data[1] ?? 0
  if ((flags & 0xfc) !== 0 || ((flags & 0x02) !== 0 && (flags & 0x01) === 0)) {
    throw invalidInput(`${state.objectLabel} link-info flags are invalid`)
  }
  let position = 2
  let maximumCreationIndex: bigint | undefined
  if ((flags & 0x01) !== 0) {
    requireBytes(data, position, 8, `${state.objectLabel} maximum link creation index`)
    maximumCreationIndex = littleEndianUnsigned(data, position, 8)
    position += 8
  }
  const offsetSize = state.file.superblock.offsetSize
  requireBytes(
    data,
    position,
    offsetSize * (2 + ((flags & 0x02) === 0 ? 0 : 1)),
    `${state.objectLabel} link indexes`,
  )
  const fractalHeapAddress = optionalAddress(data, position, offsetSize)
  position += offsetSize
  const nameIndexAddress = optionalAddress(data, position, offsetSize)
  position += offsetSize
  let creationOrderIndexAddress: bigint | undefined
  if ((flags & 0x02) !== 0) {
    creationOrderIndexAddress = optionalAddress(data, position, offsetSize)
    position += offsetSize
  }
  if (!allZero(data, position)) {
    throw invalidInput(`${state.objectLabel} link-info message has non-zero trailing bytes`)
  }
  if (fractalHeapAddress === undefined) {
    if (nameIndexAddress !== undefined || creationOrderIndexAddress !== undefined) {
      throw invalidInput(`${state.objectLabel} compact link storage has defined index addresses`)
    }
    state.linkStorage = Object.freeze({ kind: 'compact', maximumCreationIndex })
    return
  }
  if (nameIndexAddress === undefined) {
    throw invalidInput(`${state.objectLabel} dense link storage has no name index`)
  }
  state.file.resolveAddress(fractalHeapAddress, 1n, `${state.objectLabel} fractal heap`)
  state.file.resolveAddress(nameIndexAddress, 1n, `${state.objectLabel} link name index`)
  if ((flags & 0x02) !== 0 && creationOrderIndexAddress === undefined) {
    throw invalidInput(`${state.objectLabel} indexed creation order has no index address`)
  }
  if (creationOrderIndexAddress !== undefined) {
    state.file.resolveAddress(
      creationOrderIndexAddress,
      1n,
      `${state.objectLabel} link creation-order index`,
    )
  }
  state.linkStorage = Object.freeze({
    kind: 'dense',
    maximumCreationIndex,
    fractalHeapAddress,
    nameIndexAddress,
    creationOrderIndexAddress,
  })
}

const parseVersion1Chunk = (
  state: ParseState,
  bytes: Uint8Array,
  chunkAddress: bigint,
  chunkIndex: number,
  remainingMessages: number,
): number => {
  let position = 0
  let parsed = 0
  while (position < bytes.byteLength && parsed < remainingMessages) {
    requireBytes(bytes, position, 8, `${state.objectLabel} version 1 message prefix`)
    const type = littleEndianUint16(bytes, position)
    const dataBytes = littleEndianUint16(bytes, position + 2)
    const flags = bytes[position + 4] ?? 0
    if (bytes[position + 5] !== 0 || bytes[position + 6] !== 0 || bytes[position + 7] !== 0) {
      throw invalidInput(`${state.objectLabel} version 1 message reserved bytes are non-zero`)
    }
    if ((dataBytes & 7) !== 0) {
      throw invalidInput(`${state.objectLabel} version 1 message data is not 8-byte aligned`)
    }
    requireBytes(bytes, position + 8, dataBytes, `${state.objectLabel} version 1 message data`)
    const dataStart = position + 8
    addMessage(
      state,
      {
        type,
        flags,
        creationOrder: undefined,
        dataAddress: chunkAddress + BigInt(dataStart),
        dataBytes,
        chunkIndex,
      },
      bytes.subarray(dataStart, dataStart + dataBytes),
    )
    position = dataStart + dataBytes
    parsed += 1
  }
  if (!allZero(bytes, position)) {
    throw invalidInput(`${state.objectLabel} version 1 object-header chunk has trailing data`)
  }
  return parsed
}

const parseVersion2Chunk = (
  state: ParseState,
  bytes: Uint8Array,
  chunkAddress: bigint,
  chunkIndex: number,
  creationOrderTracked: boolean,
): void => {
  const prefixBytes = creationOrderTracked ? 6 : 4
  let position = 0
  while (bytes.byteLength - position >= prefixBytes) {
    const type = bytes[position] ?? 0
    const dataBytes = littleEndianUint16(bytes, position + 1)
    const flags = bytes[position + 3] ?? 0
    const creationOrder = creationOrderTracked ? littleEndianUint16(bytes, position + 4) : undefined
    const dataStart = position + prefixBytes
    if (dataStart + dataBytes > bytes.byteLength) {
      throw invalidInput(`${state.objectLabel} version 2 message data is truncated`)
    }
    addMessage(
      state,
      {
        type,
        flags,
        creationOrder,
        dataAddress: chunkAddress + BigInt(dataStart),
        dataBytes,
        chunkIndex,
      },
      bytes.subarray(dataStart, dataStart + dataBytes),
    )
    position = dataStart + dataBytes
  }
}

const verifyChecksum = (bytes: Uint8Array, label: string): void => {
  if (bytes.byteLength < 4) throw invalidInput(`${label} is too short for its checksum`)
  const checksumOffset = bytes.byteLength - 4
  const stored = littleEndianUint32(bytes, checksumOffset)
  const computed = hdf5MetadataChecksum(bytes.subarray(0, checksumOffset))
  if (stored !== computed) {
    throw invalidInput(
      `${label} checksum mismatch: stored 0x${stored.toString(16).padStart(8, '0')}, computed 0x${computed.toString(16).padStart(8, '0')}`,
    )
  }
}

const readVersion1 = async (
  state: ParseState,
  prefix: Uint8Array,
): Promise<{ readonly flags: number; readonly referenceCount: number }> => {
  if (prefix[0] !== 1 || prefix[1] !== 0) {
    throw invalidInput(`${state.objectLabel} is not a valid version 1 object header`)
  }
  const totalMessages = littleEndianUint16(prefix, 2)
  if (totalMessages > state.limits.maxMessages) {
    throw limitExceeded(`${state.objectLabel} declares ${totalMessages} header messages`)
  }
  const referenceCount = littleEndianUint32(prefix, 4)
  const chunkBytes = littleEndianUint32(prefix, 8)
  if (prefix[12] !== 0 || prefix[13] !== 0 || prefix[14] !== 0 || prefix[15] !== 0) {
    throw invalidInput(`${state.objectLabel} version 1 prefix reserved bytes are non-zero`)
  }
  if ((chunkBytes & 7) !== 0) {
    throw invalidInput(`${state.objectLabel} version 1 chunk is not 8-byte aligned`)
  }
  if (chunkBytes > state.limits.maxHeaderBytes) {
    throw limitExceeded(
      `${state.objectLabel} initial chunk exceeds ${state.limits.maxHeaderBytes} bytes`,
    )
  }
  accountMetadata(state, 16 + chunkBytes)
  const chunkAddress = state.objectAddress + 16n
  const chunk = await state.file.readMetadata(chunkAddress, chunkBytes, state.options)
  let parsedMessages = parseVersion1Chunk(state, chunk, chunkAddress, 0, totalMessages)
  let chunkIndex = 1
  while (state.continuations.length > 0) {
    const continuation = state.continuations.shift()
    if (continuation === undefined) break
    accountMetadata(state, continuation.bytes)
    const bytes = await state.file.readMetadata(
      continuation.address,
      continuation.bytes,
      state.options,
    )
    parsedMessages += parseVersion1Chunk(
      state,
      bytes,
      continuation.address,
      chunkIndex,
      totalMessages - parsedMessages,
    )
    chunkIndex += 1
  }
  if (parsedMessages !== totalMessages) {
    throw invalidInput(
      `${state.objectLabel} declares ${totalMessages} messages but contains ${parsedMessages}`,
    )
  }
  return { flags: 0, referenceCount }
}

const readVersion2 = async (
  state: ParseState,
  prefix: Uint8Array,
): Promise<{ readonly flags: number; readonly referenceCount: number }> => {
  const flags = prefix[5] ?? 0
  if ((flags & 0xc0) !== 0) throw invalidInput(`${state.objectLabel} version 2 flags are invalid`)
  if ((flags & 0x08) !== 0 && (flags & 0x04) === 0) {
    throw invalidInput(`${state.objectLabel} indexes attribute creation order without tracking it`)
  }
  const sizeWidth = 1 << (flags & 0x03)
  const prefixBytes =
    6 + ((flags & 0x20) === 0 ? 0 : 16) + ((flags & 0x10) === 0 ? 0 : 4) + sizeWidth
  const fullPrefix = await state.file.readMetadata(state.objectAddress, prefixBytes, state.options)
  const chunkBytes = boundedNumber(
    littleEndianUnsigned(fullPrefix, prefixBytes - sizeWidth, sizeWidth),
    state.limits.maxHeaderBytes,
    `${state.objectLabel} initial chunk`,
  )
  const totalBytes = prefixBytes + chunkBytes + 4
  accountMetadata(state, totalBytes)
  const bytes = await state.file.readMetadata(state.objectAddress, totalBytes, state.options)
  verifyChecksum(bytes, `${state.objectLabel} object-header chunk 0`)
  const chunkAddress = state.objectAddress + BigInt(prefixBytes)
  parseVersion2Chunk(
    state,
    bytes.subarray(prefixBytes, prefixBytes + chunkBytes),
    chunkAddress,
    0,
    (flags & 0x04) !== 0,
  )
  let chunkIndex = 1
  while (state.continuations.length > 0) {
    const continuation = state.continuations.shift()
    if (continuation === undefined) break
    if (continuation.bytes < 8) {
      throw invalidInput(`${state.objectLabel} version 2 continuation is too short`)
    }
    accountMetadata(state, continuation.bytes)
    const continuationBytes = await state.file.readMetadata(
      continuation.address,
      continuation.bytes,
      state.options,
    )
    if (
      continuationBytes[0] !== 0x4f ||
      continuationBytes[1] !== 0x43 ||
      continuationBytes[2] !== 0x48 ||
      continuationBytes[3] !== 0x4b
    ) {
      throw invalidInput(`${state.objectLabel} version 2 continuation has no OCHK signature`)
    }
    verifyChecksum(
      continuationBytes,
      `${state.objectLabel} object-header continuation ${chunkIndex}`,
    )
    parseVersion2Chunk(
      state,
      continuationBytes.subarray(4, continuationBytes.byteLength - 4),
      continuation.address + 4n,
      chunkIndex,
      (flags & 0x04) !== 0,
    )
    chunkIndex += 1
  }
  let referenceCount = 1
  const referenceMessages = state.messages.filter((message) => message.type === 0x0016)
  if (referenceMessages.length > 1) {
    throw invalidInput(`${state.objectLabel} repeats the object-reference-count message`)
  }
  if (referenceMessages[0] !== undefined) {
    const message = referenceMessages[0]
    if (message.dataBytes !== 5) {
      throw invalidInput(`${state.objectLabel} object-reference-count message has invalid size`)
    }
    const data = await state.file.readMetadata(
      message.dataAddress,
      message.dataBytes,
      state.options,
    )
    if (data[0] !== 0) {
      throw unsupportedOperation(
        `${state.objectLabel} has object-reference-count version ${data[0]}`,
      )
    }
    referenceCount = littleEndianUint32(data, 1)
  }
  return { flags, referenceCount }
}

export const readHdf5ObjectHeader = async (
  file: Hdf5FileLayer,
  address: bigint,
  options: Readonly<Hdf5ObjectHeaderOptions> = {},
): Promise<Hdf5ObjectHeader> => {
  throwIfAborted(options.signal)
  const objectPath = options.objectPath ?? '/'
  const objectLabel = `HDF5 object ${JSON.stringify(objectPath)} at address ${address}`
  file.resolveAddress(address, 4n, objectLabel)
  const readOptions: Readonly<ImageSourceReadOptions> =
    options.signal === undefined ? {} : { signal: options.signal }
  const state: ParseState = {
    file,
    limits: resolveLimits(options),
    objectAddress: address,
    objectLabel,
    options: readOptions,
    messages: [],
    links: [],
    linkNames: new Set(),
    continuations: [],
    visitedContinuations: new Set(),
    linkStorage: undefined,
    metadataBytes: 0,
  }
  const prefix = await file.readMetadata(address, 6, readOptions)
  let version: 1 | 2
  let result: { readonly flags: number; readonly referenceCount: number }
  if (prefix[0] === 1) {
    version = 1
    const version1Prefix = await file.readMetadata(address, 16, readOptions)
    result = await readVersion1(state, version1Prefix)
  } else if (prefix[0] === 0x4f && prefix[1] === 0x48 && prefix[2] === 0x44 && prefix[3] === 0x52) {
    if (prefix[4] !== 2) {
      throw unsupportedOperation(`${objectLabel} has object-header version ${prefix[4]}`)
    }
    version = 2
    result = await readVersion2(state, prefix)
  } else {
    throw unsupportedOperation(`${objectLabel} has an unsupported object-header signature`)
  }
  throwIfAborted(options.signal)
  return Object.freeze({
    address,
    version,
    flags: result.flags,
    referenceCount: result.referenceCount,
    messages: Object.freeze(state.messages.slice()),
    links: Object.freeze(state.links.slice()),
    linkStorage: state.linkStorage,
    continuationBlocks: state.visitedContinuations.size,
    metadataBytes: state.metadataBytes,
  })
}
