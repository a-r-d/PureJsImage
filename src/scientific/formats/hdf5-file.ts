import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted, waitForPromise } from '../../abort.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { ImageSource } from '../../source.ts'
import {
  readHdf5Attributes,
  type Hdf5Attribute,
  type Hdf5AttributeLimits,
} from './hdf5-attributes.ts'
import {
  materializeHdf5FillBytes,
  readHdf5DatasetElementRange,
  readHdf5DatasetMetadata,
  type Hdf5DatasetMetadata,
  type Hdf5DatasetMetadataLimits,
} from './hdf5-dataset.ts'
import type { Hdf5ChunkReadLimits, Hdf5HyperslabSelection } from './hdf5-chunks.ts'
import { readHdf5DecodedChunkBlocks } from './hdf5-filters.ts'
import { readHdf5GlobalHeapCollection, type Hdf5GlobalHeapLimits } from './hdf5-global-heap.ts'
import {
  openHdf5ObjectGraph,
  type Hdf5GraphObject,
  type Hdf5ObjectGraph,
  type Hdf5ObjectGraphLimits,
} from './hdf5-graph.ts'
import type { Hdf5Link, Hdf5ObjectHeader } from './hdf5-object.ts'
import { openHdf5FileLayer, type Hdf5FileLayer, type Hdf5MetadataPageCacheOptions } from './hdf5.ts'

export interface Hdf5Selection extends Hdf5HyperslabSelection {}

export interface Hdf5Block {
  /** Dataset-relative coordinates of the first element in this block. */
  readonly start: readonly number[]
  readonly shape: readonly number[]
  /** Exact row-major storage bytes for this block. */
  readonly data: Uint8Array<ArrayBuffer>
}

interface Hdf5ObjectBase {
  readonly path: string
  readonly address: bigint
  readonly header: Hdf5ObjectHeader
}

export interface Hdf5GroupObject extends Hdf5ObjectBase {
  readonly kind: 'group'
}

export interface Hdf5DatasetObject extends Hdf5ObjectBase {
  readonly kind: 'dataset'
  readonly metadata: Hdf5DatasetMetadata
}

export interface Hdf5OtherObject extends Hdf5ObjectBase {
  readonly kind: 'other'
}

export type Hdf5Object = Hdf5GroupObject | Hdf5DatasetObject | Hdf5OtherObject

export interface Hdf5DatasetReadLimits extends Hdf5ChunkReadLimits {
  readonly maxReadOperations?: number
  /** Maximum contiguous source span used to batch a strided linear selection. */
  readonly maxInputBlockBytes?: number
}

export interface Hdf5ScalarStringReadOptions extends AbortOptions, Hdf5GlobalHeapLimits {
  readonly maxStringBytes?: number
}

export interface Hdf5OpenOptions extends AbortOptions {
  readonly metadataCache?: Readonly<Hdf5MetadataPageCacheOptions>
  readonly graph?: Readonly<Hdf5ObjectGraphLimits>
  readonly dataset?: Readonly<Hdf5DatasetMetadataLimits>
  readonly attributes?: Readonly<Hdf5AttributeLimits>
  readonly reads?: Readonly<Hdf5DatasetReadLimits>
}

export interface Hdf5File {
  get(path: string, options?: Readonly<AbortOptions>): Promise<Hdf5Object | undefined>
  list(path: string, options?: Readonly<AbortOptions>): Promise<readonly Hdf5Link[]>
  attributes(
    path: string,
    names?: readonly string[],
    options?: Readonly<AbortOptions>,
  ): Promise<readonly Hdf5Attribute[] | undefined>
  readScalarString(
    path: string,
    options?: Readonly<Hdf5ScalarStringReadOptions>,
  ): Promise<string | undefined>
  readDataset(
    path: string,
    selection: Readonly<Hdf5Selection>,
    options?: Readonly<AbortOptions>,
  ): AsyncIterable<Hdf5Block>
  close(): void
}

interface ResolvedReadLimits extends Hdf5ChunkReadLimits {
  readonly maxReadOperations: number
  readonly maxInputBlockBytes: number
  readonly maxOutputBlockBytes: number
}

const defaultReadOperations = 65_536
const defaultInputBlockBytes = 16_777_216
const defaultOutputBlockBytes = 268_435_456
const defaultStringBytes = 1_048_576

const positiveSafeInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const resolveReadLimits = (options: Readonly<Hdf5DatasetReadLimits>): ResolvedReadLimits =>
  Object.freeze({
    ...options,
    maxReadOperations: positiveSafeInteger(
      'HDF5 dataset maxReadOperations',
      options.maxReadOperations ?? defaultReadOperations,
    ),
    maxInputBlockBytes: positiveSafeInteger(
      'HDF5 dataset maxInputBlockBytes',
      options.maxInputBlockBytes ?? defaultInputBlockBytes,
    ),
    maxOutputBlockBytes: positiveSafeInteger(
      'HDF5 dataset maxOutputBlockBytes',
      options.maxOutputBlockBytes ?? defaultOutputBlockBytes,
    ),
  })

const littleEndianUnsigned = (bytes: Uint8Array, offset: number, width: number): bigint => {
  let value = 0n
  for (let index = width - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  }
  return value
}

const littleEndianUint32 = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)) >>>
  0

const decodeStringBytes = (
  bytes: Uint8Array,
  characterSet: 'ascii' | 'utf-8',
  padding: 'null-terminated' | 'null-padded' | 'space-padded',
  label: string,
): string => {
  let end = bytes.byteLength
  if (padding === 'space-padded') {
    while (end > 0 && bytes[end - 1] === 0x20) end -= 1
  } else {
    const terminator = bytes.indexOf(0)
    if (terminator >= 0) {
      end = terminator
      for (let index = terminator; index < bytes.byteLength; index += 1) {
        if (bytes[index] !== 0) throw invalidInput(`${label} has invalid NUL padding`)
      }
    }
  }
  const content = bytes.subarray(0, end)
  if (content.includes(0)) throw invalidInput(`${label} contains an embedded NUL`)
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

const safeProduct = (values: readonly number[], maximum: number, label: string): number => {
  let product = 1n
  for (const value of values) {
    product *= BigInt(value)
    if (product > BigInt(maximum)) throw limitExceeded(`${label} exceeds ${maximum}`)
  }
  return Number(product)
}

const isDatasetHeader = (header: Hdf5ObjectHeader): boolean =>
  header.messages.some((message) => message.type === 0x0001) ||
  header.messages.some((message) => message.type === 0x0003) ||
  header.messages.some((message) => message.type === 0x0008)

const isGroupHeader = (header: Hdf5ObjectHeader): boolean =>
  header.linkStorage !== undefined ||
  header.links.length !== 0 ||
  header.messages.some(
    (message) =>
      message.type === 0x0002 ||
      message.type === 0x0006 ||
      message.type === 0x000a ||
      message.type === 0x0011,
  )

const normalizeSelection = (
  metadata: Hdf5DatasetMetadata,
  selection: Readonly<Hdf5Selection>,
): Hdf5Selection => {
  const rank = metadata.dataspace.rank
  if (selection.start.length !== rank || selection.shape.length !== rank) {
    throw invalidInput('HDF5 selection rank does not match the dataset rank')
  }
  const start: number[] = []
  const shape: number[] = []
  for (let axis = 0; axis < rank; axis += 1) {
    const axisStart = selection.start[axis]
    const axisShape = selection.shape[axis]
    const extent = metadata.dataspace.dimensions[axis]
    if (
      axisStart === undefined ||
      axisShape === undefined ||
      extent === undefined ||
      !Number.isSafeInteger(axisStart) ||
      !Number.isSafeInteger(axisShape) ||
      axisStart < 0 ||
      axisShape < 0 ||
      axisStart > extent ||
      axisShape > extent - axisStart
    ) {
      throw invalidInput(`HDF5 selection dimension ${axis} is invalid`)
    }
    start.push(axisStart)
    shape.push(axisShape)
  }
  return Object.freeze({ start: Object.freeze(start), shape: Object.freeze(shape) })
}

const incrementCoordinates = (coordinates: number[], dimensions: readonly number[]): void => {
  for (let axis = coordinates.length - 1; axis >= 0; axis -= 1) {
    const next = (coordinates[axis] ?? 0) + 1
    if (next < (dimensions[axis] ?? 0)) {
      coordinates[axis] = next
      return
    }
    coordinates[axis] = 0
  }
}

const rowMajorOffset = (coordinates: readonly number[], dimensions: readonly number[]): number => {
  let offset = 0n
  for (let axis = 0; axis < dimensions.length; axis += 1) {
    offset = offset * BigInt(dimensions[axis] ?? 0) + BigInt(coordinates[axis] ?? 0)
  }
  if (offset > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw limitExceeded('HDF5 selection element offset exceeds the safe integer range')
  }
  return Number(offset)
}

const selectedChunkBytes = (
  decoded: Uint8Array<ArrayBuffer>,
  chunkDimensions: readonly number[],
  selectionStart: readonly number[],
  selectionShape: readonly number[],
  elementBytes: number,
  outputBytes: number,
): Uint8Array<ArrayBuffer> => {
  const output = new Uint8Array(outputBytes)
  const rank = chunkDimensions.length
  const rowElements = selectionShape[rank - 1] ?? 0
  const rowBytes = rowElements * elementBytes
  const outerShape = selectionShape.slice(0, -1)
  const rows = safeProduct(outerShape, Number.MAX_SAFE_INTEGER, 'HDF5 selected chunk rows')
  const rowCoordinates = new Array<number>(outerShape.length).fill(0)
  for (let row = 0; row < rows; row += 1) {
    const sourceCoordinates = selectionStart.map(
      (start, axis) => start + (rowCoordinates[axis] ?? 0),
    )
    const sourceElement = rowMajorOffset(sourceCoordinates, chunkDimensions)
    const sourceByte = sourceElement * elementBytes
    output.set(decoded.subarray(sourceByte, sourceByte + rowBytes), row * rowBytes)
    incrementCoordinates(rowCoordinates, outerShape)
  }
  return output
}

class Hdf5FileImplementation implements Hdf5File {
  readonly #layer: Hdf5FileLayer
  readonly #graph: Hdf5ObjectGraph
  readonly #datasetLimits: Readonly<Hdf5DatasetMetadataLimits>
  readonly #attributeLimits: Readonly<Hdf5AttributeLimits>
  readonly #readLimits: ResolvedReadLimits
  readonly #datasets = new Map<bigint, Promise<Hdf5DatasetMetadata>>()
  #closed = false

  constructor(
    layer: Hdf5FileLayer,
    graph: Hdf5ObjectGraph,
    datasetLimits: Readonly<Hdf5DatasetMetadataLimits>,
    attributeLimits: Readonly<Hdf5AttributeLimits>,
    readLimits: ResolvedReadLimits,
  ) {
    this.#layer = layer
    this.#graph = graph
    this.#datasetLimits = datasetLimits
    this.#attributeLimits = attributeLimits
    this.#readLimits = readLimits
  }

  async get(path: string, options: Readonly<AbortOptions> = {}): Promise<Hdf5Object | undefined> {
    this.#assertOpen()
    throwIfAborted(options.signal)
    const object = await this.#graph.get(path, options)
    if (object === undefined) return undefined
    return this.#describeObject(object, options.signal)
  }

  async list(path: string, options: Readonly<AbortOptions> = {}): Promise<readonly Hdf5Link[]> {
    this.#assertOpen()
    throwIfAborted(options.signal)
    return (await this.#graph.list(path, options)) ?? Object.freeze([])
  }

  async attributes(
    path: string,
    names?: readonly string[],
    options: Readonly<AbortOptions> = {},
  ): Promise<readonly Hdf5Attribute[] | undefined> {
    this.#assertOpen()
    throwIfAborted(options.signal)
    const object = await this.#graph.get(path, options)
    if (object === undefined) return undefined
    return readHdf5Attributes(this.#layer, object.header, {
      ...this.#attributeLimits,
      ...(names === undefined ? {} : { names }),
      objectPath: object.path,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  }

  async readScalarString(
    path: string,
    options: Readonly<Hdf5ScalarStringReadOptions> = {},
  ): Promise<string | undefined> {
    this.#assertOpen()
    throwIfAborted(options.signal)
    const object = await this.get(path, options)
    if (object === undefined) return undefined
    if (object.kind !== 'dataset') {
      throw invalidInput(`HDF5 object ${JSON.stringify(path)} is not a scalar string dataset`)
    }
    const { dataspace, datatype } = object.metadata
    if (dataspace.elementCount !== 1) {
      throw unsupportedOperation(
        `HDF5 string dataset ${JSON.stringify(path)} contains ${dataspace.elementCount} elements`,
      )
    }
    if (datatype.kind !== 'fixed-string' && datatype.kind !== 'variable-string') {
      throw invalidInput(`HDF5 dataset ${JSON.stringify(path)} is not a string`)
    }
    const maxStringBytes = positiveSafeInteger(
      'HDF5 scalar string maxStringBytes',
      options.maxStringBytes ?? defaultStringBytes,
    )
    if (datatype.kind === 'fixed-string' && datatype.byteLength > maxStringBytes) {
      throw limitExceeded(
        `HDF5 string dataset ${JSON.stringify(path)} exceeds ${maxStringBytes} bytes`,
      )
    }
    let stored: Uint8Array<ArrayBuffer> | undefined
    const selection = Object.freeze({
      start: Object.freeze(new Array<number>(dataspace.rank).fill(0)),
      shape: dataspace.dimensions,
    })
    for await (const block of this.readDataset(path, selection, options)) {
      if (stored !== undefined) {
        throw invalidInput(`HDF5 scalar string dataset ${JSON.stringify(path)} is fragmented`)
      }
      stored = block.data
    }
    if (stored === undefined || stored.byteLength !== datatype.byteLength) {
      throw invalidInput(`HDF5 scalar string dataset ${JSON.stringify(path)} is incomplete`)
    }
    const label = `HDF5 string dataset ${JSON.stringify(path)}`
    if (datatype.kind === 'fixed-string') {
      return decodeStringBytes(stored, datatype.characterSet, datatype.padding, label)
    }
    const descriptorBytes = 8 + this.#layer.superblock.offsetSize
    if (datatype.byteLength !== descriptorBytes) {
      throw invalidInput(`${label} has an invalid variable-length descriptor size`)
    }
    const declaredBytes = littleEndianUint32(stored, 0)
    if (declaredBytes > maxStringBytes) {
      throw limitExceeded(`${label} exceeds ${maxStringBytes} bytes`)
    }
    if (declaredBytes === 0) return ''
    const heapAddress = littleEndianUnsigned(stored, 4, this.#layer.superblock.offsetSize)
    const heapIndex = littleEndianUint32(stored, 4 + this.#layer.superblock.offsetSize)
    const undefinedAddress =
      heapAddress === (1n << BigInt(this.#layer.superblock.offsetSize * 8)) - 1n
    if (undefinedAddress || heapIndex === 0) {
      throw invalidInput(`${label} references an undefined global heap object`)
    }
    const heap = await readHdf5GlobalHeapCollection(this.#layer, heapAddress, {
      ...(options.maxGlobalHeapCollectionBytes === undefined
        ? {}
        : { maxGlobalHeapCollectionBytes: options.maxGlobalHeapCollectionBytes }),
      ...(options.maxGlobalHeapObjects === undefined
        ? {}
        : { maxGlobalHeapObjects: options.maxGlobalHeapObjects }),
      maxGlobalHeapObjectBytes: Math.min(
        options.maxGlobalHeapObjectBytes ?? maxStringBytes,
        maxStringBytes,
      ),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    const value = heap.objects.get(heapIndex)
    if (value === undefined)
      throw invalidInput(`${label} references missing heap object ${heapIndex}`)
    if (value.byteLength !== declaredBytes) {
      throw invalidInput(`${label} heap length does not match its descriptor`)
    }
    return decodeStringBytes(value, datatype.characterSet, datatype.padding, label)
  }

  async *readDataset(
    path: string,
    requestedSelection: Readonly<Hdf5Selection>,
    options: Readonly<AbortOptions> = {},
  ): AsyncIterable<Hdf5Block> {
    this.#assertOpen()
    throwIfAborted(options.signal)
    const object = await this.get(path, options)
    if (object === undefined)
      throw invalidInput(`HDF5 dataset ${JSON.stringify(path)} was not found`)
    if (object.kind !== 'dataset') {
      throw invalidInput(`HDF5 object ${JSON.stringify(path)} is not a dataset`)
    }
    const metadata = object.metadata
    const selection = normalizeSelection(metadata, requestedSelection)
    if (selection.shape.some((value) => value === 0)) return
    if (metadata.layout.kind === 'chunked') {
      yield* this.#readChunked(object, selection, options.signal)
      return
    }
    yield* this.#readLinear(object, selection, options.signal)
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#datasets.clear()
    this.#layer.close()
  }

  #assertOpen(): void {
    if (this.#closed) throw invalidInput('HDF5 file is closed')
  }

  async #describeObject(
    object: Hdf5GraphObject,
    signal: AbortSignal | undefined,
  ): Promise<Hdf5Object> {
    if (isDatasetHeader(object.header)) {
      const metadata = await this.#dataset(object, signal)
      return Object.freeze({ ...object, kind: 'dataset', metadata })
    }
    if (isGroupHeader(object.header)) return Object.freeze({ ...object, kind: 'group' })
    return Object.freeze({ ...object, kind: 'other' })
  }

  async #dataset(
    object: Hdf5GraphObject,
    signal: AbortSignal | undefined,
  ): Promise<Hdf5DatasetMetadata> {
    const cached = this.#datasets.get(object.address)
    if (cached !== undefined) {
      const metadata = await waitForPromise(cached, signal)
      this.#assertOpen()
      return metadata
    }
    const pending = readHdf5DatasetMetadata(this.#layer, object.header, {
      ...this.#datasetLimits,
      objectPath: object.path,
    })
    this.#datasets.set(object.address, pending)
    pending.catch(() => {
      if (this.#datasets.get(object.address) === pending) this.#datasets.delete(object.address)
    })
    const metadata = await waitForPromise(pending, signal)
    this.#assertOpen()
    return metadata
  }

  async *#readLinear(
    object: Hdf5DatasetObject,
    selection: Hdf5Selection,
    signal: AbortSignal | undefined,
  ): AsyncIterable<Hdf5Block> {
    const { metadata } = object
    const rank = metadata.dataspace.rank
    if (rank === 0) {
      const data = await readHdf5DatasetElementRange(
        this.#layer,
        metadata,
        { offset: 0, count: 1 },
        {
          maxReadBytes: this.#readLimits.maxOutputBlockBytes,
          objectPath: object.path,
          ...(signal === undefined ? {} : { signal }),
        },
      )
      yield Object.freeze({ start: Object.freeze([]), shape: Object.freeze([]), data })
      return
    }
    const dimensions = metadata.dataspace.dimensions
    if (rank === 2) {
      yield* this.#readRankTwoLinear(object, selection, signal)
      return
    }
    let contiguousAxis = rank - 1
    while (
      contiguousAxis > 0 &&
      selection.start[contiguousAxis] === 0 &&
      selection.shape[contiguousAxis] === dimensions[contiguousAxis]
    ) {
      contiguousAxis -= 1
    }
    const prefixShape = selection.shape.slice(0, contiguousAxis)
    const operations = safeProduct(
      prefixShape,
      this.#readLimits.maxReadOperations,
      'HDF5 dataset read operations',
    )
    const blockShape = selection.shape.map((value, axis) => (axis < contiguousAxis ? 1 : value))
    const blockElements = safeProduct(
      blockShape,
      Math.floor(this.#readLimits.maxOutputBlockBytes / metadata.datatype.byteLength),
      'HDF5 dataset output block elements',
    )
    const prefixCoordinates = new Array<number>(prefixShape.length).fill(0)
    for (let operation = 0; operation < operations; operation += 1) {
      throwIfAborted(signal)
      const start = selection.start.map((value, axis) => value + (prefixCoordinates[axis] ?? 0))
      const elementOffset = rowMajorOffset(start, dimensions)
      const data = await readHdf5DatasetElementRange(
        this.#layer,
        metadata,
        { offset: elementOffset, count: blockElements },
        {
          maxReadBytes: this.#readLimits.maxOutputBlockBytes,
          objectPath: object.path,
          ...(signal === undefined ? {} : { signal }),
        },
      )
      yield Object.freeze({ start: Object.freeze(start), shape: Object.freeze(blockShape), data })
      incrementCoordinates(prefixCoordinates, prefixShape)
    }
  }

  async *#readRankTwoLinear(
    object: Hdf5DatasetObject,
    selection: Hdf5Selection,
    signal: AbortSignal | undefined,
  ): AsyncIterable<Hdf5Block> {
    const { metadata } = object
    const columns = metadata.dataspace.dimensions[1]
    const selectedRows = selection.shape[0]
    const selectedColumns = selection.shape[1]
    const startRow = selection.start[0]
    const startColumn = selection.start[1]
    if (
      columns === undefined ||
      selectedRows === undefined ||
      selectedColumns === undefined ||
      startRow === undefined ||
      startColumn === undefined
    ) {
      throw invalidInput('HDF5 rank-2 selection is incomplete')
    }
    const elementBytes = metadata.datatype.byteLength
    const maximumInputElements = Math.floor(this.#readLimits.maxInputBlockBytes / elementBytes)
    const maximumOutputRows = Math.floor(
      this.#readLimits.maxOutputBlockBytes / (selectedColumns * elementBytes),
    )
    const maximumInputRows = Math.floor((maximumInputElements - selectedColumns) / columns) + 1
    const rowsPerRead = Math.min(selectedRows, maximumInputRows, maximumOutputRows)
    if (rowsPerRead < 1) {
      throw limitExceeded(
        'HDF5 strided selection cannot fit one row within the input and output block limits',
      )
    }
    const operations = Math.ceil(selectedRows / rowsPerRead)
    if (operations > this.#readLimits.maxReadOperations) {
      throw limitExceeded(
        `HDF5 dataset read operations require ${operations}; limit is ${this.#readLimits.maxReadOperations}`,
      )
    }
    for (let rowOffset = 0; rowOffset < selectedRows; rowOffset += rowsPerRead) {
      throwIfAborted(signal)
      const rows = Math.min(rowsPerRead, selectedRows - rowOffset)
      const elementOffset = rowMajorOffset(
        [startRow + rowOffset, startColumn],
        [selectedRows + startRow, columns],
      )
      const inputElements = (rows - 1) * columns + selectedColumns
      const stored = await readHdf5DatasetElementRange(
        this.#layer,
        metadata,
        { offset: elementOffset, count: inputElements },
        {
          maxReadBytes: this.#readLimits.maxInputBlockBytes,
          objectPath: object.path,
          ...(signal === undefined ? {} : { signal }),
        },
      )
      const rowBytes = selectedColumns * elementBytes
      const sourceRowBytes = columns * elementBytes
      const data =
        selectedColumns === columns ? stored : new Uint8Array(rows * selectedColumns * elementBytes)
      if (data !== stored) {
        for (let row = 0; row < rows; row += 1) {
          const sourceOffset = row * sourceRowBytes
          data.set(stored.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes)
        }
      }
      yield Object.freeze({
        start: Object.freeze([startRow + rowOffset, startColumn]),
        shape: Object.freeze([rows, selectedColumns]),
        data,
      })
    }
  }

  async *#readChunked(
    object: Hdf5DatasetObject,
    selection: Hdf5Selection,
    signal: AbortSignal | undefined,
  ): AsyncIterable<Hdf5Block> {
    if (object.metadata.layout.kind !== 'chunked') {
      throw invalidInput('HDF5 chunked reader received a non-chunked dataset')
    }
    const selectedChunkLimit = Math.min(
      this.#readLimits.maxSelectedChunks ?? defaultReadOperations,
      this.#readLimits.maxReadOperations,
    )
    let operations = 0
    for await (const chunk of readHdf5DecodedChunkBlocks(this.#layer, object.metadata, selection, {
      ...this.#readLimits,
      maxSelectedChunks: selectedChunkLimit,
      objectPath: object.path,
      ...(signal === undefined ? {} : { signal }),
    })) {
      throwIfAborted(signal)
      operations += 1
      if (operations > this.#readLimits.maxReadOperations) {
        throw limitExceeded(
          `HDF5 dataset read operations exceed ${this.#readLimits.maxReadOperations}`,
        )
      }
      const start = selection.start.map((value, axis) => value + (chunk.outputStart[axis] ?? 0))
      const data =
        chunk.decoded === undefined
          ? materializeHdf5FillBytes(
              object.metadata,
              chunk.outputBytes,
              `HDF5 dataset ${JSON.stringify(object.path)}`,
            )
          : selectedChunkBytes(
              chunk.decoded,
              object.metadata.layout.chunkDimensions,
              chunk.selectionStart,
              chunk.selectionShape,
              object.metadata.datatype.byteLength,
              chunk.outputBytes,
            )
      yield Object.freeze({
        start: Object.freeze(start),
        shape: chunk.selectionShape,
        data,
      })
    }
  }
}

export const openHdf5File = async (
  source: ImageSource,
  options: Readonly<Hdf5OpenOptions> = {},
): Promise<Hdf5File> => {
  throwIfAborted(options.signal)
  const layer = await openHdf5FileLayer(source, {
    ...(options.metadataCache ?? {}),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  try {
    const graph = await openHdf5ObjectGraph(layer, {
      ...(options.graph ?? {}),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    return new Hdf5FileImplementation(
      layer,
      graph,
      Object.freeze({ ...(options.dataset ?? {}) }),
      Object.freeze({ ...(options.attributes ?? {}) }),
      resolveReadLimits(options.reads ?? {}),
    )
  } catch (error) {
    layer.close()
    throw error
  }
}
