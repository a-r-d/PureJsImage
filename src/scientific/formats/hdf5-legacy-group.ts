import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { ImageSourceReadOptions } from '../../source.ts'
import type { Hdf5FileLayer } from './hdf5.ts'
import type { Hdf5LegacyLinkStorage, Hdf5Link } from './hdf5-object.ts'

export interface Hdf5LegacyGroupLimits {
  readonly maxHeapBytes?: number
  readonly maxMetadataBytes?: number
  readonly maxBtreeNodes?: number
  readonly maxBtreeDepth?: number
  readonly maxSymbolTableNodes?: number
  readonly maxLinks?: number
  readonly maxNameBytes?: number
  readonly maxSoftLinkBytes?: number
}

export interface Hdf5LegacyGroupOptions extends AbortOptions, Hdf5LegacyGroupLimits {
  readonly objectPath?: string
}

export interface Hdf5LegacyGroup {
  readonly links: readonly Hdf5Link[]
  readonly heapBytes: number
  readonly btreeNodes: number
  readonly symbolTableNodes: number
  readonly metadataBytes: number
}

interface ResolvedLimits {
  readonly maxHeapBytes: number
  readonly maxMetadataBytes: number
  readonly maxBtreeNodes: number
  readonly maxBtreeDepth: number
  readonly maxSymbolTableNodes: number
  readonly maxLinks: number
  readonly maxNameBytes: number
  readonly maxSoftLinkBytes: number
}

interface HeapRange {
  readonly start: number
  readonly end: number
}

interface LocalHeap {
  readonly data: Uint8Array<ArrayBuffer>
  readonly freeRanges: readonly HeapRange[]
}

interface PendingBtreeNode {
  readonly address: bigint
  readonly expectedLevel: number | undefined
}

interface GroupState {
  readonly file: Hdf5FileLayer
  readonly limits: ResolvedLimits
  readonly label: string
  readonly options: Readonly<ImageSourceReadOptions>
  readonly heap: LocalHeap
  readonly links: Hdf5Link[]
  readonly linkNames: Set<string>
  readonly pendingBtreeNodes: PendingBtreeNode[]
  readonly visitedBtreeNodes: Set<bigint>
  readonly visitedSymbolTableNodes: Set<bigint>
  metadataBytes: number
}

const defaultLimits: ResolvedLimits = Object.freeze({
  maxHeapBytes: 1_048_576,
  maxMetadataBytes: 4_194_304,
  maxBtreeNodes: 4_096,
  maxBtreeDepth: 32,
  maxSymbolTableNodes: 4_096,
  maxLinks: 65_536,
  maxNameBytes: 65_536,
  maxSoftLinkBytes: 65_536,
})

const positiveSafeInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const resolveLimits = (options: Readonly<Hdf5LegacyGroupLimits>): ResolvedLimits =>
  Object.freeze({
    maxHeapBytes: positiveSafeInteger(
      'HDF5 legacy group maxHeapBytes',
      options.maxHeapBytes ?? defaultLimits.maxHeapBytes,
    ),
    maxMetadataBytes: positiveSafeInteger(
      'HDF5 legacy group maxMetadataBytes',
      options.maxMetadataBytes ?? defaultLimits.maxMetadataBytes,
    ),
    maxBtreeNodes: positiveSafeInteger(
      'HDF5 legacy group maxBtreeNodes',
      options.maxBtreeNodes ?? defaultLimits.maxBtreeNodes,
    ),
    maxBtreeDepth: positiveSafeInteger(
      'HDF5 legacy group maxBtreeDepth',
      options.maxBtreeDepth ?? defaultLimits.maxBtreeDepth,
    ),
    maxSymbolTableNodes: positiveSafeInteger(
      'HDF5 legacy group maxSymbolTableNodes',
      options.maxSymbolTableNodes ?? defaultLimits.maxSymbolTableNodes,
    ),
    maxLinks: positiveSafeInteger(
      'HDF5 legacy group maxLinks',
      options.maxLinks ?? defaultLimits.maxLinks,
    ),
    maxNameBytes: positiveSafeInteger(
      'HDF5 legacy group maxNameBytes',
      options.maxNameBytes ?? defaultLimits.maxNameBytes,
    ),
    maxSoftLinkBytes: positiveSafeInteger(
      'HDF5 legacy group maxSoftLinkBytes',
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

const optionalUnsigned = (bytes: Uint8Array, offset: number, width: number): bigint | undefined => {
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

const hasSignature = (bytes: Uint8Array, signature: string): boolean => {
  if (bytes.byteLength < signature.length) return false
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature.charCodeAt(index)) return false
  }
  return true
}

const allZero = (bytes: Uint8Array, start: number, end = bytes.byteLength): boolean => {
  for (let index = start; index < end; index += 1) {
    if (bytes[index] !== 0) return false
  }
  return true
}

const accountMetadata = (
  state: Pick<GroupState, 'label' | 'limits' | 'metadataBytes'>,
  bytes: number,
): void => {
  if (state.metadataBytes + bytes > state.limits.maxMetadataBytes) {
    throw limitExceeded(
      `${state.label} legacy-group metadata exceeds ${state.limits.maxMetadataBytes} bytes`,
    )
  }
  state.metadataBytes += bytes
}

const readLocalHeap = async (
  file: Hdf5FileLayer,
  address: bigint,
  limits: ResolvedLimits,
  label: string,
  options: Readonly<ImageSourceReadOptions>,
): Promise<{ readonly heap: LocalHeap; readonly metadataBytes: number }> => {
  const offsetSize = file.superblock.offsetSize
  const lengthSize = file.superblock.lengthSize
  const headerBytes = 8 + lengthSize * 2 + offsetSize
  const header = await file.readMetadata(address, headerBytes, options)
  if (!hasSignature(header, 'HEAP')) throw invalidInput(`${label} local heap has no HEAP signature`)
  if (header[4] !== 0) {
    throw unsupportedOperation(`${label} local heap version ${header[4]} is unsupported`)
  }
  if (!allZero(header, 5, 8)) throw invalidInput(`${label} local heap reserved bytes are non-zero`)
  const dataBytes = boundedNumber(
    littleEndianUnsigned(header, 8, lengthSize),
    limits.maxHeapBytes,
    `${label} local heap`,
  )
  const freeListOffset = optionalUnsigned(header, 8 + lengthSize, lengthSize)
  const dataAddress = optionalUnsigned(header, 8 + lengthSize * 2, offsetSize)
  if (dataAddress === undefined) throw invalidInput(`${label} local heap data address is undefined`)
  file.resolveAddress(dataAddress, BigInt(dataBytes), `${label} local heap data`)
  if (headerBytes + dataBytes > limits.maxMetadataBytes) {
    throw limitExceeded(`${label} local heap exceeds the legacy-group metadata limit`)
  }
  const data = await file.readMetadata(dataAddress, dataBytes, options)
  const freeRanges: HeapRange[] = []
  const visited = new Set<number>()
  let current =
    freeListOffset === undefined
      ? undefined
      : boundedNumber(freeListOffset, dataBytes, `${label} local heap free-list offset`)
  while (current !== undefined) {
    if (current === 1) break
    if (visited.has(current)) throw invalidInput(`${label} local heap free list is cyclic`)
    if (current + lengthSize * 2 > data.byteLength) {
      throw invalidInput(`${label} local heap free block header is truncated`)
    }
    visited.add(current)
    const next = littleEndianUnsigned(data, current, lengthSize)
    const blockBytes = boundedNumber(
      littleEndianUnsigned(data, current + lengthSize, lengthSize),
      dataBytes,
      `${label} local heap free block`,
    )
    if (blockBytes < lengthSize * 2 || current + blockBytes > data.byteLength) {
      throw invalidInput(`${label} local heap free block has invalid extent`)
    }
    const range = Object.freeze({ start: current, end: current + blockBytes })
    if (freeRanges.some((other) => range.start < other.end && other.start < range.end)) {
      throw invalidInput(`${label} local heap free blocks overlap`)
    }
    freeRanges.push(range)
    if (next === 1n) break
    current = boundedNumber(next, dataBytes, `${label} local heap next free block`)
  }
  return {
    heap: Object.freeze({ data, freeRanges: Object.freeze(freeRanges) }),
    metadataBytes: headerBytes + dataBytes,
  }
}

const readHeapString = (
  state: GroupState,
  encodedOffset: bigint,
  maximumBytes: number,
  field: string,
  allowEmpty: boolean,
): string => {
  const offset = boundedNumber(encodedOffset, state.heap.data.byteLength, `${state.label} ${field}`)
  if (offset >= state.heap.data.byteLength) {
    throw invalidInput(`${state.label} ${field} starts beyond the local heap`)
  }
  const searchEnd = Math.min(state.heap.data.byteLength, offset + maximumBytes + 1)
  let end = offset
  while (end < searchEnd && state.heap.data[end] !== 0) end += 1
  if (end === searchEnd) {
    if (searchEnd < state.heap.data.byteLength) {
      throw limitExceeded(`${state.label} ${field} exceeds ${maximumBytes} bytes`)
    }
    throw invalidInput(`${state.label} ${field} is not NUL terminated`)
  }
  if (!allowEmpty && end === offset) throw invalidInput(`${state.label} ${field} is empty`)
  if (state.heap.freeRanges.some((range) => offset < range.end && range.start < end + 1)) {
    throw invalidInput(`${state.label} ${field} overlaps local-heap free space`)
  }
  let value = ''
  for (let index = offset; index < end; index += 1) {
    const byte = state.heap.data[index] ?? 0
    if (byte > 0x7f) throw unsupportedOperation(`${state.label} ${field} is not ASCII`)
    value += String.fromCharCode(byte)
  }
  return value
}

const validateCachedGroup = (state: GroupState, scratch: Uint8Array): void => {
  const offsetSize = state.file.superblock.offsetSize
  if (offsetSize * 2 > scratch.byteLength) {
    throw unsupportedOperation(
      `${state.label} cached legacy-group metadata cannot use ${offsetSize}-byte addresses`,
    )
  }
  const btreeAddress = optionalUnsigned(scratch, 0, offsetSize)
  const heapAddress = optionalUnsigned(scratch, offsetSize, offsetSize)
  if (btreeAddress === undefined || heapAddress === undefined) {
    throw invalidInput(`${state.label} cached group metadata has an undefined address`)
  }
  state.file.resolveAddress(btreeAddress, 1n, `${state.label} cached group B-tree`)
  state.file.resolveAddress(heapAddress, 1n, `${state.label} cached group heap`)
  if (!allZero(scratch, offsetSize * 2)) {
    throw invalidInput(`${state.label} cached group metadata has non-zero trailing bytes`)
  }
}

const addSymbol = (state: GroupState, entry: Uint8Array): void => {
  if (state.links.length >= state.limits.maxLinks) {
    throw limitExceeded(`${state.label} exceeds ${state.limits.maxLinks} links`)
  }
  const offsetSize = state.file.superblock.offsetSize
  const lengthSize = state.file.superblock.lengthSize
  const nameOffset = littleEndianUnsigned(entry, 0, lengthSize)
  const name = readHeapString(state, nameOffset, state.limits.maxNameBytes, 'link name', false)
  if (name.includes('/')) throw invalidInput(`${state.label} link name contains '/'`)
  if (state.linkNames.has(name)) {
    throw invalidInput(`${state.label} repeats link ${JSON.stringify(name)}`)
  }
  const objectAddress = optionalUnsigned(entry, lengthSize, offsetSize)
  const cacheTypeOffset = lengthSize + offsetSize
  const cacheType = littleEndianUint32(entry, cacheTypeOffset)
  if (!allZero(entry, cacheTypeOffset + 4, cacheTypeOffset + 8)) {
    throw invalidInput(`${state.label} symbol-table entry reserved bytes are non-zero`)
  }
  const scratch = entry.subarray(cacheTypeOffset + 8, cacheTypeOffset + 24)
  let link: Hdf5Link
  if (cacheType === 0 || cacheType === 1) {
    if (objectAddress === undefined) {
      throw invalidInput(`${state.label} hard link ${JSON.stringify(name)} has no object address`)
    }
    state.file.resolveAddress(objectAddress, 1n, `${state.label} hard-link target`)
    if (cacheType === 0 && !allZero(scratch, 0)) {
      throw invalidInput(`${state.label} uncached symbol-table entry has scratch data`)
    }
    if (cacheType === 1) validateCachedGroup(state, scratch)
    link = Object.freeze({
      kind: 'hard',
      name,
      characterSet: 'ascii',
      creationOrder: undefined,
      objectAddress,
    })
  } else if (cacheType === 2) {
    if (objectAddress !== undefined) {
      throw invalidInput(`${state.label} soft link ${JSON.stringify(name)} has an object address`)
    }
    if (!allZero(scratch, 4)) {
      throw invalidInput(`${state.label} soft-link scratch data has non-zero trailing bytes`)
    }
    const target = readHeapString(
      state,
      BigInt(littleEndianUint32(scratch, 0)),
      state.limits.maxSoftLinkBytes,
      `soft-link target for ${JSON.stringify(name)}`,
      false,
    )
    link = Object.freeze({
      kind: 'soft',
      name,
      characterSet: 'ascii',
      creationOrder: undefined,
      target,
    })
  } else {
    throw unsupportedOperation(
      `${state.label} symbol-table cache type ${cacheType} for ${JSON.stringify(name)} is unsupported`,
    )
  }
  state.linkNames.add(name)
  state.links.push(link)
}

const readSymbolTableNode = async (state: GroupState, address: bigint): Promise<void> => {
  if (state.visitedSymbolTableNodes.has(address)) {
    throw invalidInput(`${state.label} repeats symbol-table node ${address}`)
  }
  if (state.visitedSymbolTableNodes.size >= state.limits.maxSymbolTableNodes) {
    throw limitExceeded(
      `${state.label} exceeds ${state.limits.maxSymbolTableNodes} symbol-table nodes`,
    )
  }
  state.visitedSymbolTableNodes.add(address)
  const offsetSize = state.file.superblock.offsetSize
  const lengthSize = state.file.superblock.lengthSize
  const entryBytes = lengthSize + offsetSize + 24
  const nodeBytes = 8 + 2 * state.file.superblock.groupLeafNodeK * entryBytes
  accountMetadata(state, nodeBytes)
  const bytes = await state.file.readMetadata(address, nodeBytes, state.options)
  if (!hasSignature(bytes, 'SNOD')) {
    throw invalidInput(`${state.label} symbol-table node ${address} has no SNOD signature`)
  }
  if (bytes[4] !== 1) {
    throw unsupportedOperation(
      `${state.label} symbol-table node version ${bytes[4]} is unsupported`,
    )
  }
  if (bytes[5] !== 0)
    throw invalidInput(`${state.label} symbol-table node reserved byte is non-zero`)
  const symbols = littleEndianUint16(bytes, 6)
  if (symbols > 2 * state.file.superblock.groupLeafNodeK) {
    throw invalidInput(`${state.label} symbol-table node declares too many symbols`)
  }
  for (let index = 0; index < symbols; index += 1) {
    throwIfAborted(state.options.signal)
    const start = 8 + index * entryBytes
    addSymbol(state, bytes.subarray(start, start + entryBytes))
  }
}

const validateBtreeKey = (state: GroupState, bytes: Uint8Array, offset: number): void => {
  const value = littleEndianUnsigned(bytes, offset, state.file.superblock.lengthSize)
  readHeapString(state, value, state.limits.maxNameBytes, 'B-tree key', true)
}

const readBtreeNode = async (state: GroupState, pending: PendingBtreeNode): Promise<void> => {
  const { address, expectedLevel } = pending
  if (state.visitedBtreeNodes.has(address)) {
    throw invalidInput(`${state.label} group B-tree is cyclic at ${address}`)
  }
  if (state.visitedBtreeNodes.size >= state.limits.maxBtreeNodes) {
    throw limitExceeded(`${state.label} exceeds ${state.limits.maxBtreeNodes} B-tree nodes`)
  }
  state.visitedBtreeNodes.add(address)
  const offsetSize = state.file.superblock.offsetSize
  const lengthSize = state.file.superblock.lengthSize
  const k = state.file.superblock.groupInternalNodeK
  const nodeBytes = 8 + offsetSize * 2 + 2 * k * (lengthSize + offsetSize) + lengthSize
  accountMetadata(state, nodeBytes)
  const bytes = await state.file.readMetadata(address, nodeBytes, state.options)
  if (!hasSignature(bytes, 'TREE')) {
    throw invalidInput(`${state.label} B-tree node ${address} has no TREE signature`)
  }
  if (bytes[4] !== 0) {
    throw unsupportedOperation(`${state.label} B-tree node type ${bytes[4]} is not a group index`)
  }
  const level = bytes[5] ?? 0
  if (level + 1 > state.limits.maxBtreeDepth) {
    throw limitExceeded(`${state.label} B-tree depth ${level + 1} exceeds the configured limit`)
  }
  if (expectedLevel !== undefined && level !== expectedLevel) {
    throw invalidInput(
      `${state.label} B-tree child level ${level} does not match expected ${expectedLevel}`,
    )
  }
  const entries = littleEndianUint16(bytes, 6)
  if (entries > 2 * k) throw invalidInput(`${state.label} B-tree node declares too many entries`)
  const leftSibling = optionalUnsigned(bytes, 8, offsetSize)
  const rightSibling = optionalUnsigned(bytes, 8 + offsetSize, offsetSize)
  for (const [side, sibling] of [
    ['left', leftSibling],
    ['right', rightSibling],
  ] as const) {
    if (sibling === undefined) continue
    if (sibling === address) throw invalidInput(`${state.label} B-tree ${side} sibling is self`)
    state.file.resolveAddress(sibling, 1n, `${state.label} B-tree ${side} sibling`)
  }
  let position = 8 + offsetSize * 2
  for (let index = 0; index < entries; index += 1) {
    throwIfAborted(state.options.signal)
    validateBtreeKey(state, bytes, position)
    position += lengthSize
    const child = optionalUnsigned(bytes, position, offsetSize)
    if (child === undefined) throw invalidInput(`${state.label} B-tree child is undefined`)
    state.file.resolveAddress(child, 1n, `${state.label} B-tree child`)
    position += offsetSize
    if (level === 0) {
      await readSymbolTableNode(state, child)
    } else {
      state.pendingBtreeNodes.push(Object.freeze({ address: child, expectedLevel: level - 1 }))
    }
  }
  validateBtreeKey(state, bytes, position)
}

export const readHdf5LegacyGroup = async (
  file: Hdf5FileLayer,
  storage: Hdf5LegacyLinkStorage,
  options: Readonly<Hdf5LegacyGroupOptions> = {},
): Promise<Hdf5LegacyGroup> => {
  throwIfAborted(options.signal)
  const limits = resolveLimits(options)
  const label = `HDF5 legacy group ${JSON.stringify(options.objectPath ?? '/')}`
  const readOptions: Readonly<ImageSourceReadOptions> =
    options.signal === undefined ? {} : { signal: options.signal }
  file.resolveAddress(storage.btreeAddress, 1n, `${label} B-tree`)
  file.resolveAddress(storage.localHeapAddress, 1n, `${label} local heap`)
  const localHeap = await readLocalHeap(file, storage.localHeapAddress, limits, label, readOptions)
  const state: GroupState = {
    file,
    limits,
    label,
    options: readOptions,
    heap: localHeap.heap,
    links: [],
    linkNames: new Set(),
    pendingBtreeNodes: [Object.freeze({ address: storage.btreeAddress, expectedLevel: undefined })],
    visitedBtreeNodes: new Set(),
    visitedSymbolTableNodes: new Set(),
    metadataBytes: localHeap.metadataBytes,
  }
  while (state.pendingBtreeNodes.length > 0) {
    throwIfAborted(options.signal)
    const pending = state.pendingBtreeNodes.shift()
    if (pending !== undefined) await readBtreeNode(state, pending)
  }
  throwIfAborted(options.signal)
  return Object.freeze({
    links: Object.freeze(state.links.slice()),
    heapBytes: state.heap.data.byteLength,
    btreeNodes: state.visitedBtreeNodes.size,
    symbolTableNodes: state.visitedSymbolTableNodes.size,
    metadataBytes: state.metadataBytes,
  })
}
