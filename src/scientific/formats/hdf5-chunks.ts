import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { ImageSourceReadOptions } from '../../source.ts'
import type { Hdf5DatasetMetadata, Hdf5SimpleDataspace } from './hdf5-dataset.ts'
import type {
  Hdf5BtreeV2ChunkIndex,
  Hdf5ChunkedLayout,
  Hdf5ExtensibleArrayChunkIndex,
  Hdf5FixedArrayChunkIndex,
} from './hdf5-layout.ts'
import { hdf5MetadataChecksum, type Hdf5FileLayer } from './hdf5.ts'

export interface Hdf5HyperslabSelection {
  readonly start: readonly number[]
  readonly shape: readonly number[]
}

export interface Hdf5ChunkReadLimits {
  readonly maxSelectedChunks?: number
  readonly maxIndexMetadataBytes?: number
  readonly maxIndexNodes?: number
  readonly maxIndexDepth?: number
  readonly maxIndexNodeBytes?: number
  readonly maxLiveEncodedBytes?: number
  readonly maxDecodedChunkBytes?: number
  readonly maxFilterScratchBytes?: number
  readonly maxOutputBlockBytes?: number
}

export interface Hdf5ChunkReadOptions extends AbortOptions, Hdf5ChunkReadLimits {
  readonly objectPath?: string
}

export interface Hdf5PlannedChunk {
  readonly scaledCoordinates: readonly number[]
  readonly chunkStart: readonly number[]
  readonly chunkShape: readonly number[]
  readonly selectionStart: readonly number[]
  readonly selectionShape: readonly number[]
  readonly outputStart: readonly number[]
  readonly outputBytes: number
}

export interface Hdf5LocatedChunk {
  readonly address: bigint | undefined
  readonly encodedBytes: number
  readonly filterMask: number
  readonly indexMetadataBytes: number
  readonly indexNodes: number
}

export interface Hdf5EncodedChunkBlock extends Hdf5PlannedChunk, Hdf5LocatedChunk {
  readonly encoded: Uint8Array<ArrayBuffer> | undefined
}

interface ResolvedLimits {
  readonly maxSelectedChunks: number
  readonly maxIndexMetadataBytes: number
  readonly maxIndexNodes: number
  readonly maxIndexDepth: number
  readonly maxIndexNodeBytes: number
  readonly maxLiveEncodedBytes: number
  readonly maxDecodedChunkBytes: number
  readonly maxFilterScratchBytes: number
  readonly maxOutputBlockBytes: number
}

interface IndexState {
  readonly file: Hdf5FileLayer
  readonly layout: Hdf5ChunkedLayout
  readonly dataspace: Hdf5SimpleDataspace
  readonly limits: ResolvedLimits
  readonly label: string
  readonly readOptions: Readonly<ImageSourceReadOptions>
  readonly visited: Set<bigint>
  metadataBytes: number
  nodes: number
}

interface BtreeLevel {
  readonly maximumRecords: number
  readonly cumulativeMaximumRecords: bigint
  readonly cumulativeRecordBytes: number
}

const defaults: ResolvedLimits = Object.freeze({
  maxSelectedChunks: 65_536,
  maxIndexMetadataBytes: 8_388_608,
  maxIndexNodes: 4_096,
  maxIndexDepth: 32,
  maxIndexNodeBytes: 1_048_576,
  maxLiveEncodedBytes: 268_435_456,
  maxDecodedChunkBytes: 268_435_456,
  maxFilterScratchBytes: 268_435_456,
  maxOutputBlockBytes: 268_435_456,
})

const positiveSafeInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const resolveLimits = (value: Readonly<Hdf5ChunkReadLimits>): ResolvedLimits =>
  Object.freeze({
    maxSelectedChunks: positiveSafeInteger(
      'HDF5 maximum selected chunks',
      value.maxSelectedChunks ?? defaults.maxSelectedChunks,
    ),
    maxIndexMetadataBytes: positiveSafeInteger(
      'HDF5 maximum chunk-index metadata bytes',
      value.maxIndexMetadataBytes ?? defaults.maxIndexMetadataBytes,
    ),
    maxIndexNodes: positiveSafeInteger(
      'HDF5 maximum chunk-index nodes',
      value.maxIndexNodes ?? defaults.maxIndexNodes,
    ),
    maxIndexDepth: positiveSafeInteger(
      'HDF5 maximum chunk-index depth',
      value.maxIndexDepth ?? defaults.maxIndexDepth,
    ),
    maxIndexNodeBytes: positiveSafeInteger(
      'HDF5 maximum chunk-index node bytes',
      value.maxIndexNodeBytes ?? defaults.maxIndexNodeBytes,
    ),
    maxLiveEncodedBytes: positiveSafeInteger(
      'HDF5 maximum live encoded bytes',
      value.maxLiveEncodedBytes ?? defaults.maxLiveEncodedBytes,
    ),
    maxDecodedChunkBytes: positiveSafeInteger(
      'HDF5 maximum decoded chunk bytes',
      value.maxDecodedChunkBytes ?? defaults.maxDecodedChunkBytes,
    ),
    maxFilterScratchBytes: positiveSafeInteger(
      'HDF5 maximum filter scratch bytes',
      value.maxFilterScratchBytes ?? defaults.maxFilterScratchBytes,
    ),
    maxOutputBlockBytes: positiveSafeInteger(
      'HDF5 maximum output block bytes',
      value.maxOutputBlockBytes ?? defaults.maxOutputBlockBytes,
    ),
  })

const littleEndianUnsigned = (bytes: Uint8Array, offset: number, width: number): bigint => {
  if (offset < 0 || width < 1 || offset + width > bytes.byteLength) {
    throw invalidInput('HDF5 chunk-index integer is truncated')
  }
  let value = 0n
  for (let index = width - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  }
  return value
}

const littleEndianUint16 = (bytes: Uint8Array, offset: number): number =>
  Number(littleEndianUnsigned(bytes, offset, 2))

const littleEndianUint32 = (bytes: Uint8Array, offset: number): number =>
  Number(littleEndianUnsigned(bytes, offset, 4))

const boundedNumber = (value: bigint, maximum: number, label: string): number => {
  if (value > BigInt(maximum)) throw limitExceeded(`${label} exceeds ${maximum}`)
  return Number(value)
}

const optionalAddress = (bytes: Uint8Array, offset: number, width: number): bigint | undefined => {
  const value = littleEndianUnsigned(bytes, offset, width)
  return value === (1n << BigInt(width * 8)) - 1n ? undefined : value
}

const hasSignature = (bytes: Uint8Array, signature: string): boolean => {
  if (bytes.byteLength < signature.length) return false
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature.charCodeAt(index)) return false
  }
  return true
}

const allZero = (bytes: Uint8Array, start: number): boolean => {
  for (let index = start; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 0) return false
  }
  return true
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

const verifyChecksum = (bytes: Uint8Array, checksumOffset: number, label: string): void => {
  if (checksumOffset < 0 || checksumOffset + 4 > bytes.byteLength) {
    throw invalidInput(`${label} checksum is truncated`)
  }
  const stored = littleEndianUint32(bytes, checksumOffset)
  const computed = hdf5MetadataChecksum(bytes.subarray(0, checksumOffset))
  if (stored !== computed) throw invalidInput(`${label} checksum mismatch`)
}

const accountMetadata = (state: IndexState, bytes: number, node = false): void => {
  if (bytes > state.limits.maxIndexMetadataBytes - state.metadataBytes) {
    throw limitExceeded(
      `${state.label} chunk-index metadata exceeds ${state.limits.maxIndexMetadataBytes} bytes`,
    )
  }
  if (node && state.nodes >= state.limits.maxIndexNodes) {
    throw limitExceeded(`${state.label} chunk index exceeds ${state.limits.maxIndexNodes} nodes`)
  }
  state.metadataBytes += bytes
  if (node) state.nodes += 1
}

const readMetadata = async (
  state: IndexState,
  address: bigint,
  bytes: number,
  node = false,
): Promise<Uint8Array<ArrayBuffer>> => {
  throwIfAborted(state.readOptions.signal)
  if (bytes > state.limits.maxIndexNodeBytes) {
    throw limitExceeded(
      `${state.label} chunk-index read exceeds ${state.limits.maxIndexNodeBytes} bytes`,
    )
  }
  accountMetadata(state, bytes, node)
  return state.file.readMetadata(address, bytes, state.readOptions)
}

const safeProduct = (values: readonly number[], maximum: number, label: string): number => {
  let value = 1n
  for (const item of values) value *= BigInt(item)
  return boundedNumber(value, maximum, label)
}

const rowMajorIndex = (
  coordinates: readonly number[],
  dimensions: readonly number[],
  label: string,
): number => {
  let value = 0n
  for (let index = 0; index < dimensions.length; index += 1) {
    const coordinate = coordinates[index]
    const dimension = dimensions[index]
    if (
      coordinate === undefined ||
      dimension === undefined ||
      !Number.isSafeInteger(coordinate) ||
      coordinate < 0 ||
      coordinate >= dimension
    ) {
      throw invalidInput(`${label} coordinate ${index} is outside the chunk grid`)
    }
    value = value * BigInt(dimension) + BigInt(coordinate)
  }
  return boundedNumber(value, Number.MAX_SAFE_INTEGER, `${label} linear index`)
}

const chunkGrid = (
  dataspace: Hdf5SimpleDataspace,
  layout: Hdf5ChunkedLayout,
  maximum: boolean,
): readonly number[] =>
  Object.freeze(
    layout.chunkDimensions.map((chunk, index) => {
      const extent = maximum ? dataspace.maximumDimensions[index] : dataspace.dimensions[index]
      if (extent === undefined || extent === 'unlimited') {
        throw unsupportedOperation('HDF5 chunk index requires a finite maximum dimension')
      }
      return Math.ceil(extent / chunk)
    }),
  )

const validateChunkWorkingSet = (
  layout: Hdf5ChunkedLayout,
  outputBytes: number,
  limits: ResolvedLimits,
  label: string,
): void => {
  if (layout.chunkBytes > limits.maxDecodedChunkBytes) {
    throw limitExceeded(`${label} decoded chunk exceeds ${limits.maxDecodedChunkBytes} bytes`)
  }
  if (layout.chunkBytes > limits.maxFilterScratchBytes) {
    throw limitExceeded(`${label} filter scratch exceeds ${limits.maxFilterScratchBytes} bytes`)
  }
  if (outputBytes > limits.maxOutputBlockBytes) {
    throw limitExceeded(`${label} output block exceeds ${limits.maxOutputBlockBytes} bytes`)
  }
}

export const planHdf5ChunkHyperslab = (
  metadata: Hdf5DatasetMetadata,
  selection: Readonly<Hdf5HyperslabSelection>,
  options: Readonly<Hdf5ChunkReadLimits> = {},
): readonly Hdf5PlannedChunk[] => {
  if (metadata.layout.kind !== 'chunked' || metadata.dataspace.kind !== 'simple') {
    throw invalidInput('HDF5 chunk hyperslabs require a chunked simple dataspace')
  }
  const layout = metadata.layout
  const dataspace = metadata.dataspace
  const limits = resolveLimits(options)
  if (selection.start.length !== dataspace.rank || selection.shape.length !== dataspace.rank) {
    throw invalidInput('HDF5 hyperslab rank does not match the dataset rank')
  }
  const first: number[] = []
  const last: number[] = []
  for (let index = 0; index < dataspace.rank; index += 1) {
    const start = selection.start[index]
    const shape = selection.shape[index]
    const extent = dataspace.dimensions[index]
    const chunk = layout.chunkDimensions[index]
    if (
      start === undefined ||
      shape === undefined ||
      extent === undefined ||
      chunk === undefined ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(shape) ||
      start < 0 ||
      shape < 0 ||
      start > extent ||
      shape > extent - start
    ) {
      throw invalidInput(`HDF5 hyperslab dimension ${index} is invalid`)
    }
    if (shape === 0) return Object.freeze([])
    first.push(Math.floor(start / chunk))
    last.push(Math.floor((start + shape - 1) / chunk))
  }
  const counts = first.map((value, index) => (last[index] ?? value) - value + 1)
  const selectedChunks = safeProduct(counts, limits.maxSelectedChunks, 'HDF5 selected chunk count')
  const output: Hdf5PlannedChunk[] = []
  const coordinates = [...first]
  for (let selected = 0; selected < selectedChunks; selected += 1) {
    const chunkStart = coordinates.map(
      (coordinate, index) => coordinate * (layout.chunkDimensions[index] ?? 0),
    )
    const chunkShape = chunkStart.map((start, index) =>
      Math.min(layout.chunkDimensions[index] ?? 0, (dataspace.dimensions[index] ?? 0) - start),
    )
    const intersectionStart = chunkStart.map((start, index) =>
      Math.max(start, selection.start[index] ?? 0),
    )
    const intersectionEnd = chunkStart.map((start, index) =>
      Math.min(
        start + (chunkShape[index] ?? 0),
        (selection.start[index] ?? 0) + (selection.shape[index] ?? 0),
      ),
    )
    const selectionStart = intersectionStart.map((start, index) => start - (chunkStart[index] ?? 0))
    const selectionShape = intersectionEnd.map(
      (end, index) => end - (intersectionStart[index] ?? 0),
    )
    const outputStart = intersectionStart.map(
      (start, index) => start - (selection.start[index] ?? 0),
    )
    const outputBytes = safeProduct(
      [...selectionShape, layout.elementBytes],
      limits.maxOutputBlockBytes,
      'HDF5 selected chunk output bytes',
    )
    validateChunkWorkingSet(layout, outputBytes, limits, 'HDF5 selected chunk')
    output.push(
      Object.freeze({
        scaledCoordinates: Object.freeze([...coordinates]),
        chunkStart: Object.freeze(chunkStart),
        chunkShape: Object.freeze(chunkShape),
        selectionStart: Object.freeze(selectionStart),
        selectionShape: Object.freeze(selectionShape),
        outputStart: Object.freeze(outputStart),
        outputBytes,
      }),
    )
    for (let index = coordinates.length - 1; index >= 0; index -= 1) {
      if ((coordinates[index] ?? 0) < (last[index] ?? 0)) {
        coordinates[index] = (coordinates[index] ?? 0) + 1
        break
      }
      coordinates[index] = first[index] ?? 0
    }
  }
  return Object.freeze(output)
}

const validateLocated = (state: IndexState, value: Hdf5LocatedChunk): Hdf5LocatedChunk => {
  if (
    value.encodedBytes < 1 ||
    (value.address !== undefined && value.encodedBytes > state.limits.maxLiveEncodedBytes)
  ) {
    throw limitExceeded(
      `${state.label} encoded chunk exceeds ${state.limits.maxLiveEncodedBytes} bytes`,
    )
  }
  if (value.address !== undefined) {
    state.file.resolveAddress(
      value.address,
      BigInt(value.encodedBytes),
      `${state.label} encoded chunk`,
    )
  }
  return Object.freeze(value)
}

const located = (
  state: IndexState,
  address: bigint | undefined,
  encodedBytes = state.layout.chunkBytes,
  filterMask = 0,
): Hdf5LocatedChunk =>
  validateLocated(state, {
    address,
    encodedBytes,
    filterMask,
    indexMetadataBytes: state.metadataBytes,
    indexNodes: state.nodes,
  })

const entrySize = (state: IndexState, client: number): number => {
  if (client === 0) return state.file.superblock.offsetSize
  if (client !== 1)
    throw unsupportedOperation(`${state.label} chunk index client ${client} is unsupported`)
  const chunkSizeBytes = Math.min(8, encodedWidthForMaximum(BigInt(state.layout.chunkBytes)) + 1)
  return state.file.superblock.offsetSize + chunkSizeBytes + 4
}

const parseIndexEntry = (
  state: IndexState,
  bytes: Uint8Array,
  offset: number,
  client: number,
): Hdf5LocatedChunk => {
  const address = optionalAddress(bytes, offset, state.file.superblock.offsetSize)
  if (client === 0) return located(state, address)
  const sizeBytes = entrySize(state, client) - state.file.superblock.offsetSize - 4
  const encodedBytes = boundedNumber(
    littleEndianUnsigned(bytes, offset + state.file.superblock.offsetSize, sizeBytes),
    state.limits.maxLiveEncodedBytes,
    `${state.label} encoded chunk bytes`,
  )
  const mask = littleEndianUint32(bytes, offset + state.file.superblock.offsetSize + sizeBytes)
  if (address === undefined && (encodedBytes !== 0 || mask !== 0)) {
    throw invalidInput(`${state.label} unallocated chunk entry has payload metadata`)
  }
  return located(
    state,
    address,
    address === undefined ? state.layout.chunkBytes : encodedBytes,
    mask,
  )
}

const locateFixedArray = async (
  state: IndexState,
  coordinates: readonly number[],
  index: Hdf5FixedArrayChunkIndex,
): Promise<Hdf5LocatedChunk> => {
  const headerAddress = index.address
  if (headerAddress === undefined) return located(state, undefined)
  const headerBytes = 8 + state.file.superblock.lengthSize + state.file.superblock.offsetSize + 4
  const header = await readMetadata(state, headerAddress, headerBytes, true)
  if (!hasSignature(header, 'FAHD') || header[4] !== 0) {
    throw invalidInput(`${state.label} fixed-array header is invalid`)
  }
  verifyChecksum(header, headerBytes - 4, `${state.label} fixed-array header`)
  const client = header[5] ?? 255
  const encodedEntryBytes = header[6] ?? 0
  const pageBits = header[7] ?? 0
  if (pageBits !== index.pageBits || encodedEntryBytes !== entrySize(state, client)) {
    throw invalidInput(`${state.label} fixed-array geometry contradicts the layout message`)
  }
  const maximumGrid = chunkGrid(state.dataspace, state.layout, true)
  const maximumEntries = safeProduct(
    maximumGrid,
    Number.MAX_SAFE_INTEGER,
    `${state.label} fixed-array entries`,
  )
  const storedEntries = boundedNumber(
    littleEndianUnsigned(header, 8, state.file.superblock.lengthSize),
    Number.MAX_SAFE_INTEGER,
    `${state.label} fixed-array entries`,
  )
  if (storedEntries !== maximumEntries) {
    throw invalidInput(`${state.label} fixed-array entry count contradicts the maximum extent`)
  }
  const dataAddress = optionalAddress(
    header,
    8 + state.file.superblock.lengthSize,
    state.file.superblock.offsetSize,
  )
  if (dataAddress === undefined) return located(state, undefined)
  const linear = rowMajorIndex(coordinates, maximumGrid, state.label)
  const pageEntries = 2 ** pageBits
  if (!Number.isSafeInteger(pageEntries) || pageEntries < 1) {
    throw limitExceeded(`${state.label} fixed-array page geometry is too large`)
  }
  const pages = Math.ceil(maximumEntries / pageEntries)
  const bitmapBytes = pages > 1 ? Math.ceil(pages / 8) : 0
  const prefixBytes = 6 + state.file.superblock.offsetSize + bitmapBytes
  const blockBytes = prefixBytes + (pages === 1 ? maximumEntries * encodedEntryBytes : 0) + 4
  const block = await readMetadata(state, dataAddress, blockBytes, true)
  if (!hasSignature(block, 'FADB') || block[4] !== 0 || block[5] !== client) {
    throw invalidInput(`${state.label} fixed-array data block is invalid`)
  }
  const owningHeader = optionalAddress(block, 6, state.file.superblock.offsetSize)
  if (owningHeader !== headerAddress)
    throw invalidInput(`${state.label} fixed-array owner is invalid`)
  verifyChecksum(block, blockBytes - 4, `${state.label} fixed-array data block`)
  if (pages === 1)
    return parseIndexEntry(state, block, prefixBytes + linear * encodedEntryBytes, client)
  const page = Math.floor(linear / pageEntries)
  const bit = block[6 + state.file.superblock.offsetSize + Math.floor(page / 8)] ?? 0
  if ((bit & (1 << (page % 8))) === 0) return located(state, undefined)
  let pageAddress = dataAddress + BigInt(blockBytes)
  for (let index = 0; index < page; index += 1) {
    const entries = Math.min(pageEntries, maximumEntries - index * pageEntries)
    pageAddress += BigInt(entries * encodedEntryBytes + 4)
  }
  const entries = Math.min(pageEntries, maximumEntries - page * pageEntries)
  const pageBytes = entries * encodedEntryBytes + 4
  const pageData = await readMetadata(state, pageAddress, pageBytes, true)
  verifyChecksum(pageData, pageBytes - 4, `${state.label} fixed-array page`)
  return parseIndexEntry(state, pageData, (linear % pageEntries) * encodedEntryBytes, client)
}

const locateExtensibleArray = async (
  state: IndexState,
  coordinates: readonly number[],
  index: Hdf5ExtensibleArrayChunkIndex,
): Promise<Hdf5LocatedChunk> => {
  const headerAddress = index.address
  if (headerAddress === undefined) return located(state, undefined)
  const headerBytes =
    44 + state.file.superblock.offsetSize + state.file.superblock.lengthSize * 2 + 4
  const header = await readMetadata(state, headerAddress, headerBytes, true)
  if (!hasSignature(header, 'EAHD') || header[4] !== 0) {
    throw invalidInput(`${state.label} extensible-array header is invalid`)
  }
  verifyChecksum(header, headerBytes - 4, `${state.label} extensible-array header`)
  const client = header[5] ?? 255
  if (
    (header[6] ?? 0) !== entrySize(state, client) ||
    header[7] !== index.maxBits ||
    header[8] !== index.indexElements ||
    header[9] !== index.minElements ||
    header[10] !== index.minPointers ||
    header[11] !== index.pageBits
  ) {
    throw invalidInput(`${state.label} extensible-array geometry contradicts the layout message`)
  }
  const indexBlockAddress = optionalAddress(
    header,
    headerBytes - 4 - state.file.superblock.offsetSize,
    state.file.superblock.offsetSize,
  )
  if (indexBlockAddress === undefined) return located(state, undefined)
  const maximumGrid = chunkGrid(state.dataspace, state.layout, false)
  const linear = rowMajorIndex(coordinates, maximumGrid, state.label)
  const firstSuperblock = 2 * Math.log2(index.minPointers)
  if (!Number.isInteger(firstSuperblock) || index.minPointers < 2) {
    throw invalidInput(`${state.label} extensible-array minimum pointer count is invalid`)
  }
  const directPointers = 2 * (index.minPointers - 1)
  const minimumElementLog2 = Math.log2(index.minElements)
  if (!Number.isInteger(minimumElementLog2) || index.minElements < 1) {
    throw invalidInput(`${state.label} extensible-array minimum element count is invalid`)
  }
  const superblocks = index.maxBits - minimumElementLog2 + 1
  if (superblocks < firstSuperblock) {
    throw invalidInput(`${state.label} extensible-array maximum geometry is invalid`)
  }
  const superblockPointers = Math.max(0, superblocks - firstSuperblock)
  const blockBytes =
    6 +
    state.file.superblock.offsetSize +
    index.indexElements * entrySize(state, client) +
    (directPointers + superblockPointers) * state.file.superblock.offsetSize +
    4
  const block = await readMetadata(state, indexBlockAddress, blockBytes, true)
  if (!hasSignature(block, 'EAIB') || block[4] !== 0 || block[5] !== client) {
    throw invalidInput(`${state.label} extensible-array index block is invalid`)
  }
  const owner = optionalAddress(block, 6, state.file.superblock.offsetSize)
  if (owner !== headerAddress)
    throw invalidInput(`${state.label} extensible-array owner is invalid`)
  verifyChecksum(block, blockBytes - 4, `${state.label} extensible-array index block`)
  const indexPrefixBytes = 6 + state.file.superblock.offsetSize
  const encodedEntryBytes = entrySize(state, client)
  if (linear < index.indexElements) {
    return parseIndexEntry(state, block, indexPrefixBytes + linear * encodedEntryBytes, client)
  }

  const adjusted = linear - index.indexElements
  const superblockIndex = Math.floor(Math.log2(Math.floor(adjusted / index.minElements) + 1))
  if (superblockIndex < 0 || superblockIndex >= superblocks) {
    throw invalidInput(`${state.label} extensible-array element is outside its maximum geometry`)
  }
  let superblockStart = 0
  let dataBlockStart = 0
  for (let current = 0; current < superblockIndex; current += 1) {
    const dataBlocks = 2 ** Math.floor(current / 2)
    const elements = index.minElements * 2 ** Math.floor((current + 1) / 2)
    superblockStart += dataBlocks * elements
    dataBlockStart += dataBlocks
  }
  const dataBlocks = 2 ** Math.floor(superblockIndex / 2)
  const dataBlockElements = index.minElements * 2 ** Math.floor((superblockIndex + 1) / 2)
  const elementInSuperblock = adjusted - superblockStart
  const localDataBlock = Math.floor(elementInSuperblock / dataBlockElements)
  if (localDataBlock < 0 || localDataBlock >= dataBlocks) {
    throw invalidInput(`${state.label} extensible-array data-block index is invalid`)
  }
  let dataBlockAddress: bigint | undefined
  let expectedDataBlockOffset = 0
  let pageInitialized = true
  const pageElements = 2 ** index.pageBits
  if (!Number.isSafeInteger(pageElements) || pageElements < 1) {
    throw limitExceeded(`${state.label} extensible-array page geometry is too large`)
  }
  const pagesPerDataBlock = dataBlockElements > pageElements ? dataBlockElements / pageElements : 0
  if (!Number.isInteger(pagesPerDataBlock)) {
    throw invalidInput(`${state.label} extensible-array data-block pages are misaligned`)
  }
  const pageIndex =
    pagesPerDataBlock === 0
      ? 0
      : Math.floor((elementInSuperblock % dataBlockElements) / pageElements)
  if (superblockIndex < firstSuperblock) {
    const globalDataBlock = dataBlockStart + localDataBlock
    expectedDataBlockOffset = superblockStart + globalDataBlock * dataBlockElements
    const addressOffset =
      indexPrefixBytes +
      index.indexElements * encodedEntryBytes +
      globalDataBlock * state.file.superblock.offsetSize
    dataBlockAddress = optionalAddress(block, addressOffset, state.file.superblock.offsetSize)
  } else {
    expectedDataBlockOffset = superblockStart + localDataBlock * dataBlockElements
    const superblockAddressOffset =
      indexPrefixBytes +
      index.indexElements * encodedEntryBytes +
      directPointers * state.file.superblock.offsetSize +
      (superblockIndex - firstSuperblock) * state.file.superblock.offsetSize
    const superblockAddress = optionalAddress(
      block,
      superblockAddressOffset,
      state.file.superblock.offsetSize,
    )
    if (superblockAddress === undefined) return located(state, undefined)
    const arrayOffsetBytes = Math.ceil(index.maxBits / 8)
    const bitmapBytes = pagesPerDataBlock === 0 ? 0 : Math.ceil(pagesPerDataBlock / 8)
    const superblockBytes =
      6 +
      state.file.superblock.offsetSize +
      arrayOffsetBytes +
      dataBlocks * bitmapBytes +
      dataBlocks * state.file.superblock.offsetSize +
      4
    const superblock = await readMetadata(state, superblockAddress, superblockBytes, true)
    if (!hasSignature(superblock, 'EASB') || superblock[4] !== 0 || superblock[5] !== client) {
      throw invalidInput(`${state.label} extensible-array super block is invalid`)
    }
    const superblockOwner = optionalAddress(superblock, 6, state.file.superblock.offsetSize)
    if (superblockOwner !== headerAddress) {
      throw invalidInput(`${state.label} extensible-array super-block owner is invalid`)
    }
    const storedStart = boundedNumber(
      littleEndianUnsigned(superblock, 6 + state.file.superblock.offsetSize, arrayOffsetBytes),
      Number.MAX_SAFE_INTEGER,
      `${state.label} extensible-array super-block start`,
    )
    if (storedStart !== superblockStart) {
      throw invalidInput(`${state.label} extensible-array super-block start is invalid`)
    }
    verifyChecksum(superblock, superblockBytes - 4, `${state.label} extensible-array super block`)
    const bitmapStart = 6 + state.file.superblock.offsetSize + arrayOffsetBytes
    if (pagesPerDataBlock > 0) {
      const bitIndex = localDataBlock * pagesPerDataBlock + pageIndex
      const byte = superblock[bitmapStart + Math.floor(bitIndex / 8)] ?? 0
      pageInitialized = (byte & (1 << (bitIndex % 8))) !== 0
    }
    const addressesStart = bitmapStart + dataBlocks * bitmapBytes
    dataBlockAddress = optionalAddress(
      superblock,
      addressesStart + localDataBlock * state.file.superblock.offsetSize,
      state.file.superblock.offsetSize,
    )
  }
  if (dataBlockAddress === undefined || !pageInitialized) return located(state, undefined)
  const arrayOffsetBytes = Math.ceil(index.maxBits / 8)
  const dataBlockPrefixBytes = 6 + state.file.superblock.offsetSize + arrayOffsetBytes
  const elementInDataBlock = elementInSuperblock % dataBlockElements
  if (pagesPerDataBlock === 0) {
    const dataBlockBytes = dataBlockPrefixBytes + dataBlockElements * encodedEntryBytes + 4
    const dataBlock = await readMetadata(state, dataBlockAddress, dataBlockBytes, true)
    if (!hasSignature(dataBlock, 'EADB') || dataBlock[4] !== 0 || dataBlock[5] !== client) {
      throw invalidInput(`${state.label} extensible-array data block is invalid`)
    }
    const dataBlockOwner = optionalAddress(dataBlock, 6, state.file.superblock.offsetSize)
    if (dataBlockOwner !== headerAddress) {
      throw invalidInput(`${state.label} extensible-array data-block owner is invalid`)
    }
    const storedDataBlockOffset = boundedNumber(
      littleEndianUnsigned(dataBlock, 6 + state.file.superblock.offsetSize, arrayOffsetBytes),
      Number.MAX_SAFE_INTEGER,
      `${state.label} extensible-array data-block start`,
    )
    if (storedDataBlockOffset !== expectedDataBlockOffset) {
      throw invalidInput(`${state.label} extensible-array data-block start is invalid`)
    }
    verifyChecksum(dataBlock, dataBlockBytes - 4, `${state.label} extensible-array data block`)
    return parseIndexEntry(
      state,
      dataBlock,
      dataBlockPrefixBytes + elementInDataBlock * encodedEntryBytes,
      client,
    )
  }
  const prefix = await readMetadata(state, dataBlockAddress, dataBlockPrefixBytes)
  if (!hasSignature(prefix, 'EADB') || prefix[4] !== 0 || prefix[5] !== client) {
    throw invalidInput(`${state.label} extensible-array paged data block is invalid`)
  }
  const pagedOwner = optionalAddress(prefix, 6, state.file.superblock.offsetSize)
  const pagedOffset = boundedNumber(
    littleEndianUnsigned(prefix, 6 + state.file.superblock.offsetSize, arrayOffsetBytes),
    Number.MAX_SAFE_INTEGER,
    `${state.label} extensible-array paged data-block start`,
  )
  if (pagedOwner !== headerAddress || pagedOffset !== expectedDataBlockOffset) {
    throw invalidInput(`${state.label} extensible-array paged data-block owner or start is invalid`)
  }
  const pageBytes = pageElements * encodedEntryBytes + 4
  const pageAddress = dataBlockAddress + BigInt(dataBlockPrefixBytes + pageIndex * pageBytes)
  const page = await readMetadata(state, pageAddress, pageBytes, true)
  verifyChecksum(page, pageBytes - 4, `${state.label} extensible-array data-block page`)
  return parseIndexEntry(
    state,
    page,
    (elementInDataBlock % pageElements) * encodedEntryBytes,
    client,
  )
}

const compareCoordinates = (left: readonly bigint[], right: readonly number[]): number => {
  for (let index = 0; index < right.length; index += 1) {
    const leftValue = left[index] ?? 0n
    const rightValue = BigInt(right[index] ?? 0)
    if (leftValue < rightValue) return -1
    if (leftValue > rightValue) return 1
  }
  return 0
}

interface V2Record {
  readonly address: bigint | undefined
  readonly encodedBytes: number
  readonly filterMask: number
  readonly coordinates: readonly bigint[]
}

const buildBtreeLevels = (
  nodeBytes: number,
  recordBytes: number,
  depth: number,
  offsetSize: number,
  label: string,
): { readonly levels: readonly BtreeLevel[]; readonly recordCountBytes: number } => {
  const leafMaximum = Math.floor((nodeBytes - 10) / recordBytes)
  if (leafMaximum < 1) throw invalidInput(`${label} B-tree leaf cannot hold a record`)
  const recordCountBytes = encodedWidthForMaximum(BigInt(leafMaximum))
  const levels: BtreeLevel[] = [
    Object.freeze({
      maximumRecords: leafMaximum,
      cumulativeMaximumRecords: BigInt(leafMaximum),
      cumulativeRecordBytes: 0,
    }),
  ]
  for (let index = 1; index <= depth; index += 1) {
    const child = levels[index - 1]
    if (child === undefined) throw invalidInput(`${label} B-tree level geometry is incomplete`)
    const pointerBytes =
      offsetSize + recordCountBytes + (index > 1 ? child.cumulativeRecordBytes : 0)
    const maximumRecords = Math.floor(
      (nodeBytes - 10 - pointerBytes) / (recordBytes + pointerBytes),
    )
    if (maximumRecords < 1) throw invalidInput(`${label} B-tree internal node cannot hold a record`)
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

const parseV2Records = (
  state: IndexState,
  bytes: Uint8Array,
  count: number,
  type: number,
  recordBytes: number,
): readonly V2Record[] => {
  const output: V2Record[] = []
  const grid = chunkGrid(state.dataspace, state.layout, false)
  let previous: readonly bigint[] | undefined
  let position = 6
  const sizeBytes =
    type === 11 ? recordBytes - state.file.superblock.offsetSize - 4 - state.dataspace.rank * 8 : 0
  for (let index = 0; index < count; index += 1) {
    const start = position
    const address = optionalAddress(bytes, position, state.file.superblock.offsetSize)
    position += state.file.superblock.offsetSize
    const encodedBytes =
      type === 11
        ? boundedNumber(
            littleEndianUnsigned(bytes, position, sizeBytes),
            state.limits.maxLiveEncodedBytes,
            `${state.label} encoded chunk bytes`,
          )
        : state.layout.chunkBytes
    position += sizeBytes
    const filterMask = type === 11 ? littleEndianUint32(bytes, position) : 0
    position += type === 11 ? 4 : 0
    const coordinates: bigint[] = []
    for (let dimension = 0; dimension < state.dataspace.rank; dimension += 1) {
      const coordinate = littleEndianUnsigned(bytes, position, 8)
      if (coordinate >= BigInt(grid[dimension] ?? 0)) {
        throw invalidInput(`${state.label} B-tree record coordinate exceeds the chunk grid`)
      }
      coordinates.push(coordinate)
      position += 8
    }
    if (position - start !== recordBytes)
      throw invalidInput(`${state.label} B-tree record size is invalid`)
    if (previous !== undefined && compareCoordinates(previous, coordinates.map(Number)) >= 0) {
      throw invalidInput(`${state.label} B-tree records are not strictly ordered`)
    }
    previous = coordinates
    if (address === undefined && type === 11 && (encodedBytes !== 0 || filterMask !== 0)) {
      throw invalidInput(`${state.label} unallocated B-tree record has payload metadata`)
    }
    output.push(
      Object.freeze({ address, encodedBytes, filterMask, coordinates: Object.freeze(coordinates) }),
    )
  }
  return Object.freeze(output)
}

const locateBtreeV2 = async (
  state: IndexState,
  target: readonly number[],
  index: Hdf5BtreeV2ChunkIndex,
): Promise<Hdf5LocatedChunk> => {
  const headerAddress = index.address
  if (headerAddress === undefined) return located(state, undefined)
  const headerBytes = 22 + state.file.superblock.offsetSize + state.file.superblock.lengthSize
  const header = await readMetadata(state, headerAddress, headerBytes, true)
  if (!hasSignature(header, 'BTHD') || header[4] !== 0) {
    throw invalidInput(`${state.label} chunk B-tree v2 header is invalid`)
  }
  verifyChecksum(header, headerBytes - 4, `${state.label} chunk B-tree v2 header`)
  const type = header[5] ?? 255
  if (type !== 10 && type !== 11) {
    throw unsupportedOperation(`${state.label} chunk B-tree v2 type ${type} is unsupported`)
  }
  const nodeBytes = littleEndianUint32(header, 6)
  const recordBytes = littleEndianUint16(header, 10)
  const depth = littleEndianUint16(header, 12)
  if (nodeBytes !== index.nodeBytes || depth + 1 > state.limits.maxIndexDepth) {
    throw invalidInput(`${state.label} chunk B-tree v2 geometry is invalid`)
  }
  const expectedRecordBytes =
    state.file.superblock.offsetSize +
    state.dataspace.rank * 8 +
    (type === 11 ? Math.min(8, encodedWidthForMaximum(BigInt(state.layout.chunkBytes)) + 1) + 4 : 0)
  if (recordBytes !== expectedRecordBytes) {
    throw unsupportedOperation(
      `${state.label} chunk B-tree v2 record size ${recordBytes} is unsupported`,
    )
  }
  const rootAddress = optionalAddress(header, 16, state.file.superblock.offsetSize)
  const rootRecords = littleEndianUint16(header, 16 + state.file.superblock.offsetSize)
  const total = littleEndianUnsigned(
    header,
    18 + state.file.superblock.offsetSize,
    state.file.superblock.lengthSize,
  )
  if (total === 0n) return located(state, undefined)
  if (rootAddress === undefined || rootRecords < 1)
    throw invalidInput(`${state.label} chunk B-tree v2 root is missing`)
  const geometry = buildBtreeLevels(
    nodeBytes,
    recordBytes,
    depth,
    state.file.superblock.offsetSize,
    state.label,
  )
  const rootLevel = geometry.levels[depth]
  const maximumRecords = safeProduct(
    chunkGrid(state.dataspace, state.layout, false),
    Number.MAX_SAFE_INTEGER,
    `${state.label} chunk count`,
  )
  if (
    rootLevel === undefined ||
    rootRecords > rootLevel.maximumRecords ||
    total > rootLevel.cumulativeMaximumRecords ||
    total > BigInt(maximumRecords)
  ) {
    throw invalidInput(`${state.label} chunk B-tree v2 root counts exceed its geometry`)
  }
  const visit = async (
    address: bigint,
    level: number,
    records: number,
  ): Promise<Hdf5LocatedChunk> => {
    throwIfAborted(state.readOptions.signal)
    if (state.visited.has(address)) throw invalidInput(`${state.label} chunk B-tree v2 is cyclic`)
    state.visited.add(address)
    const levelInfo = geometry.levels[level]
    if (levelInfo === undefined || records < 1 || records > levelInfo.maximumRecords) {
      throw invalidInput(`${state.label} chunk B-tree v2 record count is invalid`)
    }
    const bytes = await readMetadata(state, address, nodeBytes, true)
    const signature = level === 0 ? 'BTLF' : 'BTIN'
    if (!hasSignature(bytes, signature) || bytes[4] !== 0 || bytes[5] !== type) {
      throw invalidInput(`${state.label} chunk B-tree v2 node is invalid`)
    }
    const parsed = parseV2Records(state, bytes, records, type, recordBytes)
    let position = 6 + records * recordBytes
    let childIndex = records
    let matched: V2Record | undefined
    for (let index = 0; index < parsed.length; index += 1) {
      const record = parsed[index]
      if (record === undefined) continue
      const comparison = compareCoordinates(record.coordinates, target)
      if (comparison === 0) {
        matched = record
        break
      }
      if (comparison > 0) {
        childIndex = index
        break
      }
    }
    if (level === 0) {
      verifyChecksum(bytes, position, `${state.label} chunk B-tree v2 leaf`)
      if (!allZero(bytes, position + 4))
        throw invalidInput(`${state.label} chunk B-tree v2 leaf has trailing data`)
      if (matched !== undefined) {
        return located(state, matched.address, matched.encodedBytes, matched.filterMask)
      }
      return located(state, undefined)
    }
    const childLevel = geometry.levels[level - 1]
    if (childLevel === undefined)
      throw invalidInput(`${state.label} chunk B-tree v2 child geometry is missing`)
    let selectedAddress: bigint | undefined
    let selectedRecords = 0
    for (let index = 0; index <= records; index += 1) {
      const childAddress = optionalAddress(bytes, position, state.file.superblock.offsetSize)
      position += state.file.superblock.offsetSize
      const childRecords = boundedNumber(
        littleEndianUnsigned(bytes, position, geometry.recordCountBytes),
        childLevel.maximumRecords,
        `${state.label} chunk B-tree v2 child records`,
      )
      position += geometry.recordCountBytes
      if (childRecords < 1) {
        throw invalidInput(`${state.label} chunk B-tree v2 child has no records`)
      }
      if (level > 1) {
        const childTotal = littleEndianUnsigned(bytes, position, childLevel.cumulativeRecordBytes)
        position += childLevel.cumulativeRecordBytes
        if (childTotal < BigInt(childRecords) || childTotal > childLevel.cumulativeMaximumRecords) {
          throw invalidInput(`${state.label} chunk B-tree v2 child total is invalid`)
        }
      }
      if (index === childIndex) {
        selectedAddress = childAddress
        selectedRecords = childRecords
      }
    }
    verifyChecksum(bytes, position, `${state.label} chunk B-tree v2 internal node`)
    if (!allZero(bytes, position + 4))
      throw invalidInput(`${state.label} chunk B-tree v2 internal node has trailing data`)
    if (matched !== undefined) {
      return located(state, matched.address, matched.encodedBytes, matched.filterMask)
    }
    if (selectedAddress === undefined || selectedRecords < 1) return located(state, undefined)
    return visit(selectedAddress, level - 1, selectedRecords)
  }
  return visit(rootAddress, depth, rootRecords)
}

interface V1Key {
  readonly encodedBytes: number
  readonly filterMask: number
  readonly offsets: readonly bigint[]
}

const parseV1Key = (state: IndexState, bytes: Uint8Array, offset: number): V1Key => {
  const encodedBytes = littleEndianUint32(bytes, offset)
  const filterMask = littleEndianUint32(bytes, offset + 4)
  const offsets: bigint[] = []
  let position = offset + 8
  for (let index = 0; index <= state.dataspace.rank; index += 1) {
    offsets.push(littleEndianUnsigned(bytes, position, 8))
    position += 8
  }
  return Object.freeze({ encodedBytes, filterMask, offsets: Object.freeze(offsets) })
}

const compareV1Key = (key: V1Key, target: readonly number[], layout: Hdf5ChunkedLayout): number => {
  const scaled = target.map(
    (value, index) => BigInt(value) * BigInt(layout.chunkDimensions[index] ?? 0),
  )
  scaled.push(0n)
  for (let index = 0; index < scaled.length; index += 1) {
    const left = key.offsets[index] ?? 0n
    const right = scaled[index] ?? 0n
    if (left < right) return -1
    if (left > right) return 1
  }
  return 0
}

const compareV1Keys = (left: V1Key, right: V1Key): number => {
  for (let index = 0; index < left.offsets.length; index += 1) {
    const leftValue = left.offsets[index] ?? 0n
    const rightValue = right.offsets[index] ?? 0n
    if (leftValue < rightValue) return -1
    if (leftValue > rightValue) return 1
  }
  return 0
}

const locateBtreeV1 = async (
  state: IndexState,
  target: readonly number[],
): Promise<Hdf5LocatedChunk> => {
  const rootAddress = state.layout.index.address
  if (rootAddress === undefined) return located(state, undefined)
  const k = state.file.superblock.indexedStorageInternalNodeK
  const keyBytes = 8 + (state.dataspace.rank + 1) * 8
  const nodeBytes =
    8 +
    state.file.superblock.offsetSize * 2 +
    2 * k * (keyBytes + state.file.superblock.offsetSize) +
    keyBytes
  const visit = async (address: bigint, depth: number): Promise<Hdf5LocatedChunk> => {
    throwIfAborted(state.readOptions.signal)
    if (depth >= state.limits.maxIndexDepth)
      throw limitExceeded(`${state.label} classic chunk B-tree is too deep`)
    if (state.visited.has(address))
      throw invalidInput(`${state.label} classic chunk B-tree is cyclic`)
    state.visited.add(address)
    const bytes = await readMetadata(state, address, nodeBytes, true)
    if (!hasSignature(bytes, 'TREE') || bytes[4] !== 1) {
      throw invalidInput(`${state.label} classic chunk B-tree node is invalid`)
    }
    const level = bytes[5] ?? 0
    const entries = littleEndianUint16(bytes, 6)
    if (entries < 1 || entries > 2 * k)
      throw invalidInput(`${state.label} classic chunk B-tree entry count is invalid`)
    let position = 8 + state.file.superblock.offsetSize * 2
    const keys: V1Key[] = []
    const pointers: (bigint | undefined)[] = []
    for (let index = 0; index < entries; index += 1) {
      keys.push(parseV1Key(state, bytes, position))
      position += keyBytes
      pointers.push(optionalAddress(bytes, position, state.file.superblock.offsetSize))
      position += state.file.superblock.offsetSize
    }
    keys.push(parseV1Key(state, bytes, position))
    const grid = chunkGrid(state.dataspace, state.layout, false)
    for (let index = 0; index < entries; index += 1) {
      const key = keys[index]
      const next = keys[index + 1]
      if (key === undefined || next === undefined || compareV1Keys(key, next) >= 0) {
        throw invalidInput(`${state.label} classic chunk B-tree keys are not strictly ordered`)
      }
      if ((key.offsets[state.dataspace.rank] ?? 1n) !== 0n) {
        throw invalidInput(`${state.label} classic chunk B-tree key has an invalid placeholder`)
      }
      for (let dimension = 0; dimension < state.dataspace.rank; dimension += 1) {
        const chunk = BigInt(state.layout.chunkDimensions[dimension] ?? 0)
        const offset = key.offsets[dimension] ?? -1n
        if (
          chunk < 1n ||
          offset < 0n ||
          offset % chunk !== 0n ||
          offset / chunk >= BigInt(grid[dimension] ?? 0)
        ) {
          throw invalidInput(`${state.label} classic chunk B-tree key is outside the chunk grid`)
        }
      }
    }
    let selected = -1
    for (let index = 0; index < entries; index += 1) {
      const low = keys[index]
      const high = keys[index + 1]
      if (low === undefined || high === undefined) continue
      if (
        compareV1Key(low, target, state.layout) <= 0 &&
        compareV1Key(high, target, state.layout) > 0
      ) {
        selected = index
        break
      }
    }
    if (selected < 0) return located(state, undefined)
    const pointer = pointers[selected]
    if (pointer === undefined) return located(state, undefined)
    const key = keys[selected]
    if (key === undefined) throw invalidInput(`${state.label} classic chunk B-tree key is missing`)
    if ((key.offsets[state.dataspace.rank] ?? 1n) !== 0n) {
      throw invalidInput(
        `${state.label} classic chunk B-tree chunk key has a non-zero placeholder offset`,
      )
    }
    if (level === 0) {
      for (let index = 0; index < target.length; index += 1) {
        const expected =
          BigInt(target[index] ?? 0) * BigInt(state.layout.chunkDimensions[index] ?? 0)
        if (key.offsets[index] !== expected) {
          return located(state, undefined)
        }
      }
      return located(state, pointer, key.encodedBytes, key.filterMask)
    }
    return visit(pointer, depth + 1)
  }
  return visit(rootAddress, 0)
}

export const locateHdf5Chunk = async (
  file: Hdf5FileLayer,
  metadata: Hdf5DatasetMetadata,
  scaledCoordinates: readonly number[],
  options: Readonly<Hdf5ChunkReadOptions> = {},
): Promise<Hdf5LocatedChunk> => {
  throwIfAborted(options.signal)
  if (metadata.layout.kind !== 'chunked' || metadata.dataspace.kind !== 'simple') {
    throw invalidInput('HDF5 chunk lookup requires a chunked simple dataspace')
  }
  const limits = resolveLimits(options)
  const grid = chunkGrid(metadata.dataspace, metadata.layout, false)
  rowMajorIndex(scaledCoordinates, grid, 'HDF5 chunk')
  validateChunkWorkingSet(metadata.layout, 0, limits, 'HDF5 chunk')
  const readOptions: Readonly<ImageSourceReadOptions> =
    options.signal === undefined ? {} : { signal: options.signal }
  const state: IndexState = {
    file,
    layout: metadata.layout,
    dataspace: metadata.dataspace,
    limits,
    label: `HDF5 dataset ${JSON.stringify(options.objectPath ?? '/')}`,
    readOptions,
    visited: new Set(),
    metadataBytes: 0,
    nodes: 0,
  }
  const index = metadata.layout.index
  if (index.kind === 'single') {
    if (grid.some((count) => count !== 1) || scaledCoordinates.some((value) => value !== 0)) {
      throw invalidInput(`${state.label} single-chunk index has non-single geometry`)
    }
    return located(
      state,
      index.address,
      index.filteredChunkBytes ?? metadata.layout.chunkBytes,
      index.filterMask ?? 0,
    )
  }
  if (index.kind === 'implicit') {
    const linear = rowMajorIndex(scaledCoordinates, grid, state.label)
    const address =
      index.address === undefined
        ? undefined
        : index.address + BigInt(linear) * BigInt(metadata.layout.chunkBytes)
    return located(state, address)
  }
  if (index.kind === 'fixed-array') return locateFixedArray(state, scaledCoordinates, index)
  if (index.kind === 'extensible-array')
    return locateExtensibleArray(state, scaledCoordinates, index)
  if (index.kind === 'btree-v2') return locateBtreeV2(state, scaledCoordinates, index)
  return locateBtreeV1(state, scaledCoordinates)
}

export const readHdf5EncodedChunkBlocks = async function* (
  file: Hdf5FileLayer,
  metadata: Hdf5DatasetMetadata,
  selection: Readonly<Hdf5HyperslabSelection>,
  options: Readonly<Hdf5ChunkReadOptions> = {},
): AsyncIterable<Hdf5EncodedChunkBlock> {
  const plans = planHdf5ChunkHyperslab(metadata, selection, options)
  for (const plan of plans) {
    throwIfAborted(options.signal)
    const chunk = await locateHdf5Chunk(file, metadata, plan.scaledCoordinates, options)
    throwIfAborted(options.signal)
    const encoded =
      chunk.address === undefined
        ? undefined
        : await file.readRaw(
            chunk.address,
            chunk.encodedBytes,
            options.signal === undefined ? {} : { signal: options.signal },
          )
    throwIfAborted(options.signal)
    yield Object.freeze({ ...plan, ...chunk, encoded })
  }
}
