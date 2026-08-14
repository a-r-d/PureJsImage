import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { invalidInput, limitExceeded } from '../../errors.ts'
import type { ImageSource } from '../../source.ts'
import {
  materializeHdf5FillBytes,
  readHdf5DatasetElementRange,
  readHdf5DatasetMetadata,
  type Hdf5DatasetMetadata,
  type Hdf5DatasetMetadataLimits,
} from './hdf5-dataset.ts'
import type { Hdf5ChunkReadLimits, Hdf5HyperslabSelection } from './hdf5-chunks.ts'
import { readHdf5DecodedChunkBlocks } from './hdf5-filters.ts'
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
}

export interface Hdf5OpenOptions extends AbortOptions {
  readonly metadataCache?: Readonly<Hdf5MetadataPageCacheOptions>
  readonly graph?: Readonly<Hdf5ObjectGraphLimits>
  readonly dataset?: Readonly<Hdf5DatasetMetadataLimits>
  readonly reads?: Readonly<Hdf5DatasetReadLimits>
}

export interface Hdf5File {
  get(path: string, options?: Readonly<AbortOptions>): Promise<Hdf5Object | undefined>
  list(path: string, options?: Readonly<AbortOptions>): Promise<readonly Hdf5Link[]>
  readDataset(
    path: string,
    selection: Readonly<Hdf5Selection>,
    options?: Readonly<AbortOptions>,
  ): AsyncIterable<Hdf5Block>
  close(): void
}

interface ResolvedReadLimits extends Hdf5ChunkReadLimits {
  readonly maxReadOperations: number
  readonly maxOutputBlockBytes: number
}

const defaultReadOperations = 65_536
const defaultOutputBlockBytes = 268_435_456

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
    maxOutputBlockBytes: positiveSafeInteger(
      'HDF5 dataset maxOutputBlockBytes',
      options.maxOutputBlockBytes ?? defaultOutputBlockBytes,
    ),
  })

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
  readonly #readLimits: ResolvedReadLimits
  readonly #datasets = new Map<bigint, Promise<Hdf5DatasetMetadata>>()
  #closed = false

  constructor(
    layer: Hdf5FileLayer,
    graph: Hdf5ObjectGraph,
    datasetLimits: Readonly<Hdf5DatasetMetadataLimits>,
    readLimits: ResolvedReadLimits,
  ) {
    this.#layer = layer
    this.#graph = graph
    this.#datasetLimits = datasetLimits
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

  #dataset(object: Hdf5GraphObject, signal: AbortSignal | undefined): Promise<Hdf5DatasetMetadata> {
    const cached = this.#datasets.get(object.address)
    if (cached !== undefined) return cached
    const pending = readHdf5DatasetMetadata(this.#layer, object.header, {
      ...this.#datasetLimits,
      objectPath: object.path,
      ...(signal === undefined ? {} : { signal }),
    })
    this.#datasets.set(object.address, pending)
    pending.catch(() => this.#datasets.delete(object.address))
    return pending
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
      resolveReadLimits(options.reads ?? {}),
    )
  } catch (error) {
    layer.close()
    throw error
  }
}
