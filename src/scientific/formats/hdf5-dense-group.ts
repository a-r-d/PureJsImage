import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { ImageSourceReadOptions } from '../../source.ts'
import { hdf5MetadataChecksum, type Hdf5FileLayer } from './hdf5.ts'
import { parseHdf5LinkMessage, type Hdf5DenseLinkStorage, type Hdf5Link } from './hdf5-object.ts'

export interface Hdf5DenseGroupLimits {
  readonly maxMetadataBytes?: number
  readonly maxHeapHeaderBytes?: number
  readonly maxHeapObjectBytes?: number
  readonly maxDirectBlockBytes?: number
  readonly maxDirectBlocks?: number
  readonly maxIndirectBlocks?: number
  readonly maxBtreeNodeBytes?: number
  readonly maxBtreeNodes?: number
  readonly maxBtreeDepth?: number
  readonly maxLinks?: number
  readonly maxNameBytes?: number
  readonly maxSoftLinkBytes?: number
  readonly maxTableWidth?: number
  readonly maxHeapSizeBits?: number
}

export interface Hdf5DenseGroupOptions extends AbortOptions, Hdf5DenseGroupLimits {
  readonly objectPath?: string
}

export interface Hdf5DenseGroup {
  readonly links: readonly Hdf5Link[]
  readonly heapHeaderBytes: number
  readonly btreeNodes: number
  readonly directBlocks: number
  readonly indirectBlocks: number
  readonly metadataBytes: number
}

interface ResolvedLimits {
  readonly maxMetadataBytes: number
  readonly maxHeapHeaderBytes: number
  readonly maxHeapObjectBytes: number
  readonly maxDirectBlockBytes: number
  readonly maxDirectBlocks: number
  readonly maxIndirectBlocks: number
  readonly maxBtreeNodeBytes: number
  readonly maxBtreeNodes: number
  readonly maxBtreeDepth: number
  readonly maxLinks: number
  readonly maxNameBytes: number
  readonly maxSoftLinkBytes: number
  readonly maxTableWidth: number
  readonly maxHeapSizeBits: number
}

interface FractalHeapHeader {
  readonly address: bigint
  readonly headerBytes: number
  readonly heapIdBytes: number
  readonly checksumDirectBlocks: boolean
  readonly maximumManagedObjectBytes: number
  readonly managedSpaceBytes: bigint
  readonly allocatedManagedSpaceBytes: bigint
  readonly managedObjectCount: bigint
  readonly hugeObjectCount: bigint
  readonly tinyObjectCount: bigint
  readonly tableWidth: number
  readonly startingBlockBytes: bigint
  readonly maximumDirectBlockBytes: bigint
  readonly maximumHeapSizeBits: number
  readonly heapOffsetBytes: number
  readonly heapLengthBytes: number
  readonly maximumDirectRows: number
  readonly rootBlockAddress: bigint | undefined
  readonly rootRows: number
}

interface BtreeLevelInfo {
  readonly maximumRecords: number
  readonly cumulativeMaximumRecords: bigint
  readonly cumulativeRecordBytes: number
}

interface BtreeHeader {
  readonly nodeBytes: number
  readonly recordBytes: number
  readonly depth: number
  readonly rootAddress: bigint | undefined
  readonly rootRecords: number
  readonly totalRecords: number
  readonly recordCountBytes: number
  readonly levels: readonly BtreeLevelInfo[]
}

interface DenseRecord {
  readonly hash: number
  readonly heapId: Uint8Array<ArrayBuffer>
}

interface ChildPointer {
  readonly address: bigint
  readonly records: number
  readonly totalRecords: bigint
}

interface IndirectBlock {
  readonly blockOffset: bigint
  readonly rows: number
  readonly directAddresses: readonly (bigint | undefined)[]
  readonly indirectAddresses: readonly (bigint | undefined)[]
}

interface DirectBlock {
  readonly blockOffset: bigint
  readonly blockBytes: bigint
  readonly bytes: Uint8Array<ArrayBuffer>
}

interface DenseState {
  readonly file: Hdf5FileLayer
  readonly limits: ResolvedLimits
  readonly label: string
  readonly options: Readonly<ImageSourceReadOptions>
  readonly heap: FractalHeapHeader
  readonly btree: BtreeHeader
  readonly links: Hdf5Link[]
  readonly linkNames: Set<string>
  readonly visitedBtreeNodes: Set<bigint>
  readonly directBlockCache: Map<bigint, DirectBlock>
  readonly indirectBlockCache: Map<bigint, IndirectBlock>
  readonly activeIndirectBlocks: Set<bigint>
  previousRecordHash: number | undefined
  metadataBytes: number
}

const defaultLimits: ResolvedLimits = Object.freeze({
  maxMetadataBytes: 8_388_608,
  maxHeapHeaderBytes: 65_536,
  maxHeapObjectBytes: 131_072,
  maxDirectBlockBytes: 1_048_576,
  maxDirectBlocks: 4_096,
  maxIndirectBlocks: 4_096,
  maxBtreeNodeBytes: 1_048_576,
  maxBtreeNodes: 4_096,
  maxBtreeDepth: 32,
  maxLinks: 65_536,
  maxNameBytes: 65_536,
  maxSoftLinkBytes: 65_536,
  maxTableWidth: 1_024,
  maxHeapSizeBits: 128,
})

const positiveSafeInteger = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const resolveLimits = (options: Readonly<Hdf5DenseGroupLimits>): ResolvedLimits => {
  const resolved: ResolvedLimits = {
    maxMetadataBytes: positiveSafeInteger(
      'HDF5 dense group maxMetadataBytes',
      options.maxMetadataBytes ?? defaultLimits.maxMetadataBytes,
    ),
    maxHeapHeaderBytes: positiveSafeInteger(
      'HDF5 dense group maxHeapHeaderBytes',
      options.maxHeapHeaderBytes ?? defaultLimits.maxHeapHeaderBytes,
    ),
    maxHeapObjectBytes: positiveSafeInteger(
      'HDF5 dense group maxHeapObjectBytes',
      options.maxHeapObjectBytes ?? defaultLimits.maxHeapObjectBytes,
    ),
    maxDirectBlockBytes: positiveSafeInteger(
      'HDF5 dense group maxDirectBlockBytes',
      options.maxDirectBlockBytes ?? defaultLimits.maxDirectBlockBytes,
    ),
    maxDirectBlocks: positiveSafeInteger(
      'HDF5 dense group maxDirectBlocks',
      options.maxDirectBlocks ?? defaultLimits.maxDirectBlocks,
    ),
    maxIndirectBlocks: positiveSafeInteger(
      'HDF5 dense group maxIndirectBlocks',
      options.maxIndirectBlocks ?? defaultLimits.maxIndirectBlocks,
    ),
    maxBtreeNodeBytes: positiveSafeInteger(
      'HDF5 dense group maxBtreeNodeBytes',
      options.maxBtreeNodeBytes ?? defaultLimits.maxBtreeNodeBytes,
    ),
    maxBtreeNodes: positiveSafeInteger(
      'HDF5 dense group maxBtreeNodes',
      options.maxBtreeNodes ?? defaultLimits.maxBtreeNodes,
    ),
    maxBtreeDepth: positiveSafeInteger(
      'HDF5 dense group maxBtreeDepth',
      options.maxBtreeDepth ?? defaultLimits.maxBtreeDepth,
    ),
    maxLinks: positiveSafeInteger(
      'HDF5 dense group maxLinks',
      options.maxLinks ?? defaultLimits.maxLinks,
    ),
    maxNameBytes: positiveSafeInteger(
      'HDF5 dense group maxNameBytes',
      options.maxNameBytes ?? defaultLimits.maxNameBytes,
    ),
    maxSoftLinkBytes: positiveSafeInteger(
      'HDF5 dense group maxSoftLinkBytes',
      options.maxSoftLinkBytes ?? defaultLimits.maxSoftLinkBytes,
    ),
    maxTableWidth: positiveSafeInteger(
      'HDF5 dense group maxTableWidth',
      options.maxTableWidth ?? defaultLimits.maxTableWidth,
    ),
    maxHeapSizeBits: positiveSafeInteger(
      'HDF5 dense group maxHeapSizeBits',
      options.maxHeapSizeBits ?? defaultLimits.maxHeapSizeBits,
    ),
  }
  return Object.freeze(resolved)
}

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

const isPowerOfTwo = (value: bigint): boolean => value > 0n && (value & (value - 1n)) === 0n

const integerLog2 = (value: bigint, label: string): number => {
  if (!isPowerOfTwo(value)) throw invalidInput(`${label} must be a power of two`)
  let remaining = value
  let result = 0
  while (remaining > 1n) {
    remaining >>= 1n
    result += 1
  }
  return result
}

const encodedWidthForMaximum = (value: bigint): number => {
  let width = 1
  let maximum = 0xffn
  while (value > maximum) {
    width += 1
    maximum = (maximum << 8n) | 0xffn
  }
  return width
}

const verifyTrailingChecksum = (bytes: Uint8Array, label: string): void => {
  if (bytes.byteLength < 4) throw invalidInput(`${label} is too short for its checksum`)
  const checksumOffset = bytes.byteLength - 4
  const stored = littleEndianUint32(bytes, checksumOffset)
  const computed = hdf5MetadataChecksum(bytes.subarray(0, checksumOffset))
  if (stored !== computed) {
    throw invalidInput(`${label} checksum mismatch`)
  }
}

const verifyEmbeddedChecksum = (bytes: Uint8Array, checksumOffset: number, label: string): void => {
  if (checksumOffset < 0 || checksumOffset + 4 > bytes.byteLength) {
    throw invalidInput(`${label} checksum is truncated`)
  }
  const stored = littleEndianUint32(bytes, checksumOffset)
  const computed = hdf5MetadataChecksum(bytes.subarray(0, checksumOffset))
  if (stored !== computed) throw invalidInput(`${label} checksum mismatch`)
}

const accountMetadata = (
  state: Pick<DenseState, 'label' | 'limits' | 'metadataBytes'>,
  bytes: number,
): void => {
  if (bytes > state.limits.maxMetadataBytes - state.metadataBytes) {
    throw limitExceeded(
      `${state.label} dense-group metadata exceeds ${state.limits.maxMetadataBytes} bytes`,
    )
  }
  state.metadataBytes += bytes
}

const readFractalHeapHeader = async (
  file: Hdf5FileLayer,
  address: bigint,
  limits: ResolvedLimits,
  label: string,
  options: Readonly<ImageSourceReadOptions>,
): Promise<FractalHeapHeader> => {
  const prefix = await file.readMetadata(address, 10, options)
  if (!hasSignature(prefix, 'FRHP')) {
    throw invalidInput(`${label} fractal heap has no FRHP signature`)
  }
  if (prefix[4] !== 0) {
    throw unsupportedOperation(`${label} fractal heap version ${prefix[4]} is unsupported`)
  }
  const heapIdBytes = littleEndianUint16(prefix, 5)
  if (heapIdBytes !== 7) {
    throw unsupportedOperation(
      `${label} dense-link fractal heap uses ${heapIdBytes}-byte IDs instead of 7-byte group-link IDs`,
    )
  }
  const filterBytes = littleEndianUint16(prefix, 7)
  const offsetSize = file.superblock.offsetSize
  const lengthSize = file.superblock.lengthSize
  const headerBytes =
    26 + lengthSize * 12 + offsetSize * 3 + (filterBytes === 0 ? 0 : lengthSize + 4 + filterBytes)
  if (headerBytes > limits.maxHeapHeaderBytes) {
    throw limitExceeded(`${label} fractal heap header exceeds ${limits.maxHeapHeaderBytes} bytes`)
  }
  const bytes = await file.readMetadata(address, headerBytes, options)
  verifyTrailingChecksum(bytes, `${label} fractal heap header`)
  const flags = bytes[9] ?? 0
  if ((flags & 0xfc) !== 0) throw invalidInput(`${label} fractal heap flags are invalid`)

  let position = 10
  const maximumManagedObjectBytes = littleEndianUint32(bytes, position)
  position += 4
  if (maximumManagedObjectBytes < 1) {
    throw invalidInput(`${label} fractal heap maximum managed-object size is zero`)
  }
  position += lengthSize
  const hugeObjectBtreeAddress = optionalUnsigned(bytes, position, offsetSize)
  position += offsetSize
  position += lengthSize
  const freeSpaceManagerAddress = optionalUnsigned(bytes, position, offsetSize)
  position += offsetSize
  const managedSpaceBytes = littleEndianUnsigned(bytes, position, lengthSize)
  position += lengthSize
  const allocatedManagedSpaceBytes = littleEndianUnsigned(bytes, position, lengthSize)
  position += lengthSize
  const allocationIterator = littleEndianUnsigned(bytes, position, lengthSize)
  position += lengthSize
  const managedObjectCount = littleEndianUnsigned(bytes, position, lengthSize)
  position += lengthSize
  position += lengthSize
  const hugeObjectCount = littleEndianUnsigned(bytes, position, lengthSize)
  position += lengthSize
  position += lengthSize
  const tinyObjectCount = littleEndianUnsigned(bytes, position, lengthSize)
  position += lengthSize
  const tableWidth = littleEndianUint16(bytes, position)
  position += 2
  const startingBlockBytes = littleEndianUnsigned(bytes, position, lengthSize)
  position += lengthSize
  const maximumDirectBlockBytes = littleEndianUnsigned(bytes, position, lengthSize)
  position += lengthSize
  const maximumHeapSizeBits = littleEndianUint16(bytes, position)
  position += 2
  const startingRootRows = littleEndianUint16(bytes, position)
  position += 2
  const rootBlockAddress = optionalUnsigned(bytes, position, offsetSize)
  position += offsetSize
  const rootRows = littleEndianUint16(bytes, position)
  position += 2

  if (filterBytes !== 0) {
    position += lengthSize + 4 + filterBytes
  }
  if (position !== bytes.byteLength - 4) {
    throw invalidInput(`${label} fractal heap header has an invalid encoded length`)
  }
  if (filterBytes !== 0) {
    throw unsupportedOperation(
      `${label} fractal heap has a ${filterBytes}-byte direct-block filter pipeline`,
    )
  }
  if (!Number.isSafeInteger(tableWidth) || tableWidth < 1 || tableWidth > limits.maxTableWidth) {
    throw limitExceeded(
      `${label} fractal heap table width ${tableWidth} is unsupported or too large`,
    )
  }
  if (!isPowerOfTwo(BigInt(tableWidth))) {
    throw invalidInput(`${label} fractal heap table width is not a power of two`)
  }
  const startingLog2 = integerLog2(startingBlockBytes, `${label} starting direct-block size`)
  const maximumDirectLog2 = integerLog2(
    maximumDirectBlockBytes,
    `${label} maximum direct-block size`,
  )
  if (startingBlockBytes > maximumDirectBlockBytes) {
    throw invalidInput(`${label} fractal heap starting block exceeds its maximum direct block`)
  }
  if (maximumDirectBlockBytes > BigInt(limits.maxDirectBlockBytes)) {
    throw limitExceeded(
      `${label} fractal heap maximum direct block exceeds ${limits.maxDirectBlockBytes} bytes`,
    )
  }
  if (maximumHeapSizeBits < 1 || maximumHeapSizeBits > limits.maxHeapSizeBits) {
    throw limitExceeded(`${label} fractal heap address space uses ${maximumHeapSizeBits} bits`)
  }
  const maximumHeapBytes = 1n << BigInt(maximumHeapSizeBits)
  if (managedSpaceBytes > maximumHeapBytes || allocatedManagedSpaceBytes > managedSpaceBytes) {
    throw invalidInput(`${label} fractal heap managed-space accounting is invalid`)
  }
  if (allocationIterator > managedSpaceBytes) {
    throw invalidInput(`${label} fractal heap allocation iterator exceeds managed space`)
  }
  const maximumRootRows =
    maximumHeapSizeBits -
    (startingLog2 + integerLog2(BigInt(tableWidth), `${label} table width`)) +
    1
  if (maximumRootRows < 1 || rootRows > maximumRootRows || startingRootRows > maximumRootRows) {
    throw invalidInput(`${label} fractal heap root-row declaration is invalid`)
  }
  if (managedObjectCount > 0n && rootBlockAddress === undefined) {
    throw invalidInput(`${label} fractal heap has managed objects but no root block`)
  }
  if (hugeObjectCount > 0n && hugeObjectBtreeAddress === undefined) {
    throw invalidInput(`${label} fractal heap has huge objects but no huge-object B-tree`)
  }
  if (hugeObjectBtreeAddress !== undefined) {
    file.resolveAddress(hugeObjectBtreeAddress, 1n, `${label} huge-object B-tree`)
  }
  if (freeSpaceManagerAddress !== undefined) {
    file.resolveAddress(freeSpaceManagerAddress, 1n, `${label} free-space manager`)
  }
  if (rootBlockAddress !== undefined) {
    file.resolveAddress(rootBlockAddress, 1n, `${label} fractal-heap root block`)
  }

  const heapOffsetBytes = Math.ceil(maximumHeapSizeBits / 8)
  const heapLengthBytes = encodedWidthForMaximum(
    BigInt(maximumManagedObjectBytes) < maximumDirectBlockBytes
      ? BigInt(maximumManagedObjectBytes)
      : maximumDirectBlockBytes,
  )
  if (1 + heapOffsetBytes + heapLengthBytes !== heapIdBytes) {
    throw invalidInput(`${label} fractal heap ID width does not match its managed-object fields`)
  }
  return Object.freeze({
    address,
    headerBytes,
    heapIdBytes,
    checksumDirectBlocks: (flags & 0x02) !== 0,
    maximumManagedObjectBytes,
    managedSpaceBytes,
    allocatedManagedSpaceBytes,
    managedObjectCount,
    hugeObjectCount,
    tinyObjectCount,
    tableWidth,
    startingBlockBytes,
    maximumDirectBlockBytes,
    maximumHeapSizeBits,
    heapOffsetBytes,
    heapLengthBytes,
    maximumDirectRows: maximumDirectLog2 - startingLog2 + 2,
    rootBlockAddress,
    rootRows,
  })
}

const buildBtreeLevels = (
  nodeBytes: number,
  recordBytes: number,
  depth: number,
  offsetSize: number,
  label: string,
): { readonly levels: readonly BtreeLevelInfo[]; readonly recordCountBytes: number } => {
  const leafMaximum = Math.floor((nodeBytes - 10) / recordBytes)
  if (leafMaximum < 1) throw invalidInput(`${label} B-tree leaf cannot hold a record`)
  const recordCountBytes = encodedWidthForMaximum(BigInt(leafMaximum))
  const levels: BtreeLevelInfo[] = [
    Object.freeze({
      maximumRecords: leafMaximum,
      cumulativeMaximumRecords: BigInt(leafMaximum),
      cumulativeRecordBytes: 0,
    }),
  ]
  for (let level = 1; level <= depth; level += 1) {
    const child = levels[level - 1]
    if (child === undefined) throw invalidInput(`${label} B-tree level metadata is incomplete`)
    const pointerBytes =
      offsetSize + recordCountBytes + (level > 1 ? child.cumulativeRecordBytes : 0)
    const maximumRecords = Math.floor(
      (nodeBytes - (10 + pointerBytes)) / (recordBytes + pointerBytes),
    )
    if (maximumRecords < 1) {
      throw invalidInput(`${label} B-tree internal level ${level} cannot hold a record`)
    }
    const cumulativeMaximumRecords =
      BigInt(maximumRecords + 1) * child.cumulativeMaximumRecords + BigInt(maximumRecords)
    levels.push(
      Object.freeze({
        maximumRecords,
        cumulativeMaximumRecords,
        cumulativeRecordBytes: encodedWidthForMaximum(cumulativeMaximumRecords),
      }),
    )
  }
  return { levels: Object.freeze(levels), recordCountBytes }
}

const readBtreeHeader = async (
  file: Hdf5FileLayer,
  address: bigint,
  limits: ResolvedLimits,
  label: string,
  options: Readonly<ImageSourceReadOptions>,
): Promise<{ readonly header: BtreeHeader; readonly headerBytes: number }> => {
  const offsetSize = file.superblock.offsetSize
  const lengthSize = file.superblock.lengthSize
  const headerBytes = 22 + offsetSize + lengthSize
  const bytes = await file.readMetadata(address, headerBytes, options)
  if (!hasSignature(bytes, 'BTHD')) throw invalidInput(`${label} name index has no BTHD signature`)
  if (bytes[4] !== 0) throw unsupportedOperation(`${label} name-index B-tree version ${bytes[4]}`)
  if (bytes[5] !== 5) {
    throw unsupportedOperation(`${label} name-index B-tree has type ${bytes[5]} instead of type 5`)
  }
  verifyTrailingChecksum(bytes, `${label} name-index B-tree header`)
  const nodeBytes = littleEndianUint32(bytes, 6)
  if (nodeBytes < 21 || nodeBytes > limits.maxBtreeNodeBytes) {
    throw limitExceeded(`${label} B-tree node size ${nodeBytes} is unsupported or too large`)
  }
  const recordBytes = littleEndianUint16(bytes, 10)
  if (recordBytes !== 11) {
    throw unsupportedOperation(
      `${label} group name-index record size ${recordBytes} is unsupported`,
    )
  }
  const depth = littleEndianUint16(bytes, 12)
  if (depth + 1 > limits.maxBtreeDepth) {
    throw limitExceeded(`${label} B-tree depth ${depth + 1} exceeds ${limits.maxBtreeDepth}`)
  }
  const splitPercent = bytes[14] ?? 0
  const mergePercent = bytes[15] ?? 0
  if (
    splitPercent < 1 ||
    splitPercent > 100 ||
    mergePercent < 1 ||
    mergePercent >= splitPercent / 2
  ) {
    throw invalidInput(`${label} B-tree split/merge percentages are invalid`)
  }
  const rootAddress = optionalUnsigned(bytes, 16, offsetSize)
  const rootRecords = littleEndianUint16(bytes, 16 + offsetSize)
  const totalRecordsValue = littleEndianUnsigned(bytes, 18 + offsetSize, lengthSize)
  const totalRecords = boundedNumber(
    totalRecordsValue,
    limits.maxLinks,
    `${label} dense-link count`,
  )
  const levelInfo = buildBtreeLevels(nodeBytes, recordBytes, depth, offsetSize, label)
  const rootLevel = levelInfo.levels[depth]
  if (rootLevel === undefined) throw invalidInput(`${label} B-tree root level is unavailable`)
  if (
    rootRecords > rootLevel.maximumRecords ||
    totalRecordsValue > rootLevel.cumulativeMaximumRecords
  ) {
    throw invalidInput(`${label} B-tree root record counts exceed the node geometry`)
  }
  if (totalRecords === 0) {
    if (rootAddress !== undefined || rootRecords !== 0) {
      throw invalidInput(`${label} empty B-tree has a root node`)
    }
  } else {
    if (rootAddress === undefined || rootRecords < 1) {
      throw invalidInput(`${label} non-empty B-tree has no root records`)
    }
    file.resolveAddress(rootAddress, BigInt(nodeBytes), `${label} B-tree root node`)
  }
  return {
    header: Object.freeze({
      nodeBytes,
      recordBytes,
      depth,
      rootAddress,
      rootRecords,
      totalRecords,
      recordCountBytes: levelInfo.recordCountBytes,
      levels: levelInfo.levels,
    }),
    headerBytes,
  }
}

const readIndirectBlock = async (
  state: DenseState,
  address: bigint,
  expectedBlockOffset: bigint,
  rows: number,
): Promise<IndirectBlock> => {
  const cached = state.indirectBlockCache.get(address)
  if (cached !== undefined) {
    if (cached.blockOffset !== expectedBlockOffset || cached.rows !== rows) {
      throw invalidInput(`${state.label} reuses an indirect block with inconsistent geometry`)
    }
    return cached
  }
  if (state.indirectBlockCache.size >= state.limits.maxIndirectBlocks) {
    throw limitExceeded(`${state.label} exceeds ${state.limits.maxIndirectBlocks} indirect blocks`)
  }
  if (rows < 1 || rows > state.heap.maximumHeapSizeBits) {
    throw invalidInput(`${state.label} fractal-heap indirect block row count is invalid`)
  }
  const directEntries = Math.min(rows, state.heap.maximumDirectRows) * state.heap.tableWidth
  const indirectEntries = Math.max(0, rows - state.heap.maximumDirectRows) * state.heap.tableWidth
  const prefixBytes = 5 + state.file.superblock.offsetSize + state.heap.heapOffsetBytes
  const blockBytes =
    prefixBytes + (directEntries + indirectEntries) * state.file.superblock.offsetSize + 4
  if (blockBytes > state.limits.maxMetadataBytes) {
    throw limitExceeded(`${state.label} fractal-heap indirect block is too large`)
  }
  accountMetadata(state, blockBytes)
  const bytes = await state.file.readMetadata(address, blockBytes, state.options)
  if (!hasSignature(bytes, 'FHIB')) {
    throw invalidInput(
      `${state.label} fractal-heap indirect block ${address} has no FHIB signature`,
    )
  }
  if (bytes[4] !== 0) {
    throw unsupportedOperation(`${state.label} fractal-heap indirect block version ${bytes[4]}`)
  }
  verifyTrailingChecksum(bytes, `${state.label} fractal-heap indirect block ${address}`)
  let position = 5
  const heapAddress = optionalUnsigned(bytes, position, state.file.superblock.offsetSize)
  position += state.file.superblock.offsetSize
  if (heapAddress !== state.heap.address) {
    throw invalidInput(`${state.label} fractal-heap indirect block references another heap`)
  }
  const blockOffset = littleEndianUnsigned(bytes, position, state.heap.heapOffsetBytes)
  position += state.heap.heapOffsetBytes
  if (blockOffset !== expectedBlockOffset) {
    throw invalidInput(`${state.label} fractal-heap indirect block offset is inconsistent`)
  }
  const directAddresses: Array<bigint | undefined> = []
  for (let index = 0; index < directEntries; index += 1) {
    directAddresses.push(optionalUnsigned(bytes, position, state.file.superblock.offsetSize))
    position += state.file.superblock.offsetSize
  }
  const indirectAddresses: Array<bigint | undefined> = []
  for (let index = 0; index < indirectEntries; index += 1) {
    indirectAddresses.push(optionalUnsigned(bytes, position, state.file.superblock.offsetSize))
    position += state.file.superblock.offsetSize
  }
  if (!allZero(bytes, position, bytes.byteLength - 4)) {
    throw invalidInput(`${state.label} fractal-heap indirect block has non-zero trailing bytes`)
  }
  const block = Object.freeze({
    blockOffset,
    rows,
    directAddresses: Object.freeze(directAddresses),
    indirectAddresses: Object.freeze(indirectAddresses),
  })
  state.indirectBlockCache.set(address, block)
  return block
}

const verifyDirectBlockChecksum = (
  bytes: Uint8Array<ArrayBuffer>,
  checksumOffset: number,
  label: string,
): void => {
  const stored = littleEndianUint32(bytes, checksumOffset)
  bytes.fill(0, checksumOffset, checksumOffset + 4)
  const computed = hdf5MetadataChecksum(bytes)
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
    checksumOffset,
    stored,
    true,
  )
  if (stored !== computed) throw invalidInput(`${label} checksum mismatch`)
}

const readDirectBlock = async (
  state: DenseState,
  address: bigint,
  blockOffset: bigint,
  blockBytesValue: bigint,
): Promise<Uint8Array<ArrayBuffer>> => {
  const cached = state.directBlockCache.get(address)
  if (cached !== undefined) {
    if (cached.blockOffset !== blockOffset || cached.blockBytes !== blockBytesValue) {
      throw invalidInput(`${state.label} reuses a direct block with inconsistent geometry`)
    }
    return cached.bytes
  }
  if (state.directBlockCache.size >= state.limits.maxDirectBlocks) {
    throw limitExceeded(`${state.label} exceeds ${state.limits.maxDirectBlocks} direct blocks`)
  }
  const blockBytes = boundedNumber(
    blockBytesValue,
    state.limits.maxDirectBlockBytes,
    `${state.label} fractal-heap direct block`,
  )
  const headerBytes =
    5 +
    state.file.superblock.offsetSize +
    state.heap.heapOffsetBytes +
    (state.heap.checksumDirectBlocks ? 4 : 0)
  if (blockBytes < headerBytes)
    throw invalidInput(`${state.label} fractal-heap direct block is too short`)
  accountMetadata(state, blockBytes)
  const bytes = await state.file.readMetadata(address, blockBytes, state.options)
  if (!hasSignature(bytes, 'FHDB')) {
    throw invalidInput(`${state.label} fractal-heap direct block ${address} has no FHDB signature`)
  }
  if (bytes[4] !== 0) {
    throw unsupportedOperation(`${state.label} fractal-heap direct block version ${bytes[4]}`)
  }
  let position = 5
  const heapAddress = optionalUnsigned(bytes, position, state.file.superblock.offsetSize)
  position += state.file.superblock.offsetSize
  if (heapAddress !== state.heap.address) {
    throw invalidInput(`${state.label} fractal-heap direct block references another heap`)
  }
  const encodedBlockOffset = littleEndianUnsigned(bytes, position, state.heap.heapOffsetBytes)
  position += state.heap.heapOffsetBytes
  if (encodedBlockOffset !== blockOffset) {
    throw invalidInput(`${state.label} fractal-heap direct block offset is inconsistent`)
  }
  if (state.heap.checksumDirectBlocks) {
    verifyDirectBlockChecksum(
      bytes,
      position,
      `${state.label} fractal-heap direct block ${address}`,
    )
  }
  state.directBlockCache.set(
    address,
    Object.freeze({ blockOffset, blockBytes: blockBytesValue, bytes }),
  )
  return bytes
}

const rowGeometry = (
  heap: FractalHeapHeader,
  row: number,
): { readonly start: bigint; readonly blockBytes: bigint } => {
  if (row === 0) return { start: 0n, blockBytes: heap.startingBlockBytes }
  if (row === 1) {
    return {
      start: BigInt(heap.tableWidth) * heap.startingBlockBytes,
      blockBytes: heap.startingBlockBytes,
    }
  }
  const multiplier = 1n << BigInt(row - 1)
  return {
    start: BigInt(heap.tableWidth) * heap.startingBlockBytes * multiplier,
    blockBytes: heap.startingBlockBytes * multiplier,
  }
}

const childIndirectRows = (state: DenseState, blockBytes: bigint): number => {
  const denominator = state.heap.startingBlockBytes * BigInt(state.heap.tableWidth)
  if (blockBytes < denominator || blockBytes % denominator !== 0n) {
    throw invalidInput(`${state.label} fractal-heap indirect child size is invalid`)
  }
  return integerLog2(blockBytes / denominator, `${state.label} indirect child ratio`) + 1
}

const locateManagedObject = async (
  state: DenseState,
  address: bigint,
  blockOffset: bigint,
  rows: number,
  objectOffset: bigint,
  objectBytes: number,
): Promise<Uint8Array<ArrayBuffer>> => {
  if (state.activeIndirectBlocks.has(address)) {
    throw invalidInput(`${state.label} fractal-heap indirect blocks are cyclic at ${address}`)
  }
  state.activeIndirectBlocks.add(address)
  try {
    const block = await readIndirectBlock(state, address, blockOffset, rows)
    const relative = objectOffset - blockOffset
    if (relative < 0n) throw invalidInput(`${state.label} heap object precedes its indirect block`)
    for (let row = 0; row < rows; row += 1) {
      const geometry = rowGeometry(state.heap, row)
      const rowBytes = geometry.blockBytes * BigInt(state.heap.tableWidth)
      if (relative < geometry.start || relative >= geometry.start + rowBytes) continue
      const column = Number((relative - geometry.start) / geometry.blockBytes)
      const childOffset = blockOffset + geometry.start + BigInt(column) * geometry.blockBytes
      if (row < state.heap.maximumDirectRows) {
        const entry = row * state.heap.tableWidth + column
        const childAddress = block.directAddresses[entry]
        if (childAddress === undefined) {
          throw invalidInput(`${state.label} heap object points into an unallocated direct block`)
        }
        const direct = await readDirectBlock(state, childAddress, childOffset, geometry.blockBytes)
        const localOffset = boundedNumber(
          objectOffset - childOffset,
          direct.byteLength,
          `${state.label} heap object offset`,
        )
        const directHeaderBytes =
          5 +
          state.file.superblock.offsetSize +
          state.heap.heapOffsetBytes +
          (state.heap.checksumDirectBlocks ? 4 : 0)
        if (localOffset < directHeaderBytes || objectBytes > direct.byteLength - localOffset) {
          throw invalidInput(`${state.label} heap object has an invalid direct-block extent`)
        }
        return direct.slice(localOffset, localOffset + objectBytes)
      }
      const entry = (row - state.heap.maximumDirectRows) * state.heap.tableWidth + column
      const childAddress = block.indirectAddresses[entry]
      if (childAddress === undefined) {
        throw invalidInput(`${state.label} heap object points into an unallocated indirect block`)
      }
      return locateManagedObject(
        state,
        childAddress,
        childOffset,
        childIndirectRows(state, geometry.blockBytes),
        objectOffset,
        objectBytes,
      )
    }
    throw invalidInput(`${state.label} heap object is outside its indirect-block rows`)
  } finally {
    state.activeIndirectBlocks.delete(address)
  }
}

const readHeapObject = async (
  state: DenseState,
  heapId: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> => {
  if (heapId.byteLength !== state.heap.heapIdBytes) {
    throw invalidInput(`${state.label} has an invalid dense-link heap ID length`)
  }
  const flags = heapId[0] ?? 0
  if ((flags & 0xc0) !== 0) {
    throw unsupportedOperation(`${state.label} has fractal-heap ID version ${flags >>> 6}`)
  }
  const type = (flags >>> 4) & 0x03
  if ((flags & 0x0f) !== 0 || type === 3) {
    throw invalidInput(`${state.label} has an invalid fractal-heap ID type byte`)
  }
  if (type === 1) throw unsupportedOperation(`${state.label} has a huge dense-link heap object`)
  if (type === 2) throw unsupportedOperation(`${state.label} has a tiny dense-link heap object`)
  const objectOffset = littleEndianUnsigned(heapId, 1, state.heap.heapOffsetBytes)
  const objectBytes = boundedNumber(
    littleEndianUnsigned(heapId, 1 + state.heap.heapOffsetBytes, state.heap.heapLengthBytes),
    state.limits.maxHeapObjectBytes,
    `${state.label} dense-link heap object`,
  )
  if (objectBytes < 1 || objectBytes > state.heap.maximumManagedObjectBytes) {
    throw invalidInput(`${state.label} dense-link heap object has an invalid length`)
  }
  if (objectOffset + BigInt(objectBytes) > state.heap.managedSpaceBytes) {
    throw invalidInput(`${state.label} dense-link heap object exceeds managed space`)
  }
  const rootAddress = state.heap.rootBlockAddress
  if (rootAddress === undefined) throw invalidInput(`${state.label} fractal heap has no root block`)
  if (state.heap.rootRows === 0) {
    const rootBytes = state.heap.allocatedManagedSpaceBytes
    if (
      !isPowerOfTwo(rootBytes) ||
      rootBytes < state.heap.startingBlockBytes ||
      rootBytes > state.heap.maximumDirectBlockBytes
    ) {
      throw invalidInput(`${state.label} fractal-heap root direct-block size is invalid`)
    }
    const direct = await readDirectBlock(state, rootAddress, 0n, rootBytes)
    const localOffset = boundedNumber(
      objectOffset,
      direct.byteLength,
      `${state.label} heap object offset`,
    )
    const directHeaderBytes =
      5 +
      state.file.superblock.offsetSize +
      state.heap.heapOffsetBytes +
      (state.heap.checksumDirectBlocks ? 4 : 0)
    if (localOffset < directHeaderBytes || objectBytes > direct.byteLength - localOffset) {
      throw invalidInput(`${state.label} heap object has an invalid root-block extent`)
    }
    return direct.slice(localOffset, localOffset + objectBytes)
  }
  return locateManagedObject(state, rootAddress, 0n, state.heap.rootRows, objectOffset, objectBytes)
}

const addDenseRecord = async (state: DenseState, record: DenseRecord): Promise<void> => {
  throwIfAborted(state.options.signal)
  if (state.links.length >= state.limits.maxLinks) {
    throw limitExceeded(`${state.label} exceeds ${state.limits.maxLinks} links`)
  }
  if (state.previousRecordHash !== undefined && record.hash < state.previousRecordHash) {
    throw invalidInput(`${state.label} name-index B-tree records are out of order`)
  }
  state.previousRecordHash = record.hash
  const data = await readHeapObject(state, record.heapId)
  const link = parseHdf5LinkMessage(state.file, data, {
    objectLabel: `${state.label} dense link`,
    maxLinkNameBytes: state.limits.maxNameBytes,
    maxSoftLinkBytes: state.limits.maxSoftLinkBytes,
  })
  const computedHash = hdf5MetadataChecksum(new TextEncoder().encode(link.name))
  if (record.hash !== computedHash) {
    throw invalidInput(
      `${state.label} dense link ${JSON.stringify(link.name)} has an invalid name hash`,
    )
  }
  if (state.linkNames.has(link.name)) {
    throw invalidInput(`${state.label} repeats dense link ${JSON.stringify(link.name)}`)
  }
  state.linkNames.add(link.name)
  state.links.push(link)
}

const parseRecords = (
  state: DenseState,
  bytes: Uint8Array<ArrayBuffer>,
  records: number,
): readonly DenseRecord[] => {
  const output: DenseRecord[] = []
  let position = 6
  for (let index = 0; index < records; index += 1) {
    const hash = littleEndianUint32(bytes, position)
    const heapId = bytes.slice(position + 4, position + state.btree.recordBytes)
    output.push(Object.freeze({ hash, heapId }))
    position += state.btree.recordBytes
  }
  return Object.freeze(output)
}

const readBtreeNode = async (
  state: DenseState,
  address: bigint,
  depth: number,
  records: number,
): Promise<number> => {
  throwIfAborted(state.options.signal)
  if (state.visitedBtreeNodes.has(address)) {
    throw invalidInput(`${state.label} name-index B-tree is cyclic at ${address}`)
  }
  if (state.visitedBtreeNodes.size >= state.limits.maxBtreeNodes) {
    throw limitExceeded(`${state.label} exceeds ${state.limits.maxBtreeNodes} B-tree nodes`)
  }
  const level = state.btree.levels[depth]
  if (level === undefined || records < 1 || records > level.maximumRecords) {
    throw invalidInput(`${state.label} B-tree node has an invalid record count`)
  }
  state.visitedBtreeNodes.add(address)
  accountMetadata(state, state.btree.nodeBytes)
  const bytes = await state.file.readMetadata(address, state.btree.nodeBytes, state.options)
  const signature = depth === 0 ? 'BTLF' : 'BTIN'
  if (!hasSignature(bytes, signature)) {
    throw invalidInput(`${state.label} B-tree node ${address} has no ${signature} signature`)
  }
  if (bytes[4] !== 0 || bytes[5] !== 5) {
    throw invalidInput(`${state.label} B-tree node ${address} has an invalid version or type`)
  }
  const denseRecords = parseRecords(state, bytes, records)
  let position = 6 + records * state.btree.recordBytes
  if (depth === 0) {
    verifyEmbeddedChecksum(bytes, position, `${state.label} B-tree node ${address}`)
    position += 4
    if (!allZero(bytes, position)) {
      throw invalidInput(`${state.label} B-tree leaf has non-zero trailing bytes`)
    }
    for (const record of denseRecords) await addDenseRecord(state, record)
    return records
  }

  const childLevel = state.btree.levels[depth - 1]
  if (childLevel === undefined)
    throw invalidInput(`${state.label} B-tree child level is unavailable`)
  const children: ChildPointer[] = []
  for (let index = 0; index <= records; index += 1) {
    const childAddress = optionalUnsigned(bytes, position, state.file.superblock.offsetSize)
    position += state.file.superblock.offsetSize
    if (childAddress === undefined) throw invalidInput(`${state.label} B-tree child is undefined`)
    const childRecords = boundedNumber(
      littleEndianUnsigned(bytes, position, state.btree.recordCountBytes),
      childLevel.maximumRecords,
      `${state.label} B-tree child records`,
    )
    position += state.btree.recordCountBytes
    if (childRecords < 1) throw invalidInput(`${state.label} B-tree child has no records`)
    let totalRecords = BigInt(childRecords)
    if (depth > 1) {
      totalRecords = littleEndianUnsigned(bytes, position, childLevel.cumulativeRecordBytes)
      position += childLevel.cumulativeRecordBytes
      if (
        totalRecords < BigInt(childRecords) ||
        totalRecords > childLevel.cumulativeMaximumRecords
      ) {
        throw invalidInput(`${state.label} B-tree child total-record count is invalid`)
      }
    }
    state.file.resolveAddress(
      childAddress,
      BigInt(state.btree.nodeBytes),
      `${state.label} B-tree child`,
    )
    children.push(Object.freeze({ address: childAddress, records: childRecords, totalRecords }))
  }
  verifyEmbeddedChecksum(bytes, position, `${state.label} B-tree node ${address}`)
  position += 4
  if (!allZero(bytes, position)) {
    throw invalidInput(`${state.label} B-tree internal node has non-zero trailing bytes`)
  }
  let subtreeRecords = records
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (child === undefined) continue
    const observed = await readBtreeNode(state, child.address, depth - 1, child.records)
    if (BigInt(observed) !== child.totalRecords) {
      throw invalidInput(
        `${state.label} B-tree child total-record count does not match its subtree`,
      )
    }
    subtreeRecords += observed
    const record = denseRecords[index]
    if (record !== undefined) await addDenseRecord(state, record)
  }
  return subtreeRecords
}

export const readHdf5DenseGroup = async (
  file: Hdf5FileLayer,
  storage: Hdf5DenseLinkStorage,
  options: Readonly<Hdf5DenseGroupOptions> = {},
): Promise<Hdf5DenseGroup> => {
  throwIfAborted(options.signal)
  const limits = resolveLimits(options)
  const label = `HDF5 dense group ${JSON.stringify(options.objectPath ?? '/')}`
  const readOptions: Readonly<ImageSourceReadOptions> =
    options.signal === undefined ? {} : { signal: options.signal }
  file.resolveAddress(storage.fractalHeapAddress, 1n, `${label} fractal heap`)
  file.resolveAddress(storage.nameIndexAddress, 1n, `${label} name index`)
  const heap = await readFractalHeapHeader(
    file,
    storage.fractalHeapAddress,
    limits,
    label,
    readOptions,
  )
  const btreeResult = await readBtreeHeader(
    file,
    storage.nameIndexAddress,
    limits,
    label,
    readOptions,
  )
  const heapObjectCount = heap.managedObjectCount + heap.hugeObjectCount + heap.tinyObjectCount
  if (heapObjectCount !== BigInt(btreeResult.header.totalRecords)) {
    throw invalidInput(`${label} heap and name-index object counts do not match`)
  }
  const state: DenseState = {
    file,
    limits,
    label,
    options: readOptions,
    heap,
    btree: btreeResult.header,
    links: [],
    linkNames: new Set(),
    visitedBtreeNodes: new Set(),
    directBlockCache: new Map(),
    indirectBlockCache: new Map(),
    activeIndirectBlocks: new Set(),
    previousRecordHash: undefined,
    metadataBytes: heap.headerBytes + btreeResult.headerBytes,
  }
  if (state.metadataBytes > limits.maxMetadataBytes) {
    throw limitExceeded(`${label} headers exceed ${limits.maxMetadataBytes} metadata bytes`)
  }
  if (state.btree.rootAddress !== undefined) {
    const observed = await readBtreeNode(
      state,
      state.btree.rootAddress,
      state.btree.depth,
      state.btree.rootRecords,
    )
    if (observed !== state.btree.totalRecords || state.links.length !== state.btree.totalRecords) {
      throw invalidInput(`${label} B-tree total-record count does not match its nodes`)
    }
  }
  throwIfAborted(options.signal)
  return Object.freeze({
    links: Object.freeze(state.links.slice()),
    heapHeaderBytes: heap.headerBytes,
    btreeNodes: state.visitedBtreeNodes.size,
    directBlocks: state.directBlockCache.size,
    indirectBlocks: state.indirectBlockCache.size,
    metadataBytes: state.metadataBytes,
  })
}
