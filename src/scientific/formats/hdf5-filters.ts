import type { AbortOptions } from '../../abort.ts'
import { throwIfAborted } from '../../abort.ts'
import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'
import type { Hdf5DatasetMetadata } from './hdf5-dataset.ts'
import type { Hdf5Filter, Hdf5FilterPipeline } from './hdf5-filter-message.ts'
import type { Hdf5FileLayer } from './hdf5.ts'
import {
  readHdf5EncodedChunkBlocks,
  type Hdf5ChunkReadOptions,
  type Hdf5HyperslabSelection,
  type Hdf5LocatedChunk,
  type Hdf5PlannedChunk,
} from './hdf5-chunks.ts'

export interface Hdf5FilterDecodeLimits {
  readonly maxDecodedChunkBytes?: number
  readonly maxFilterScratchBytes?: number
}

export interface Hdf5FilterDecodeOptions extends AbortOptions, Hdf5FilterDecodeLimits {
  readonly objectPath?: string
}

export interface Hdf5DecodedChunkBlock extends Hdf5PlannedChunk, Hdf5LocatedChunk {
  readonly decoded: Uint8Array<ArrayBuffer> | undefined
}

const defaultMaximumBytes = 268_435_456

const positiveSafeInteger = (label: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${label} must be a positive safe integer`)
  }
  return value
}

const filterName = (filter: Hdf5Filter): string => {
  if (filter.id === 1) return 'Deflate'
  if (filter.id === 2) return 'Shuffle'
  if (filter.id === 3) return 'Fletcher32'
  if (filter.id === 4) return 'SZIP'
  if (filter.id === 5) return 'N-bit'
  if (filter.id === 6) return 'Scale-Offset'
  return filter.name === undefined
    ? `unknown filter ${filter.id}`
    : `unknown filter ${filter.id} (${JSON.stringify(filter.name)})`
}

const isExactArrayBufferView = (bytes: Uint8Array): bytes is Uint8Array<ArrayBuffer> =>
  bytes.buffer instanceof ArrayBuffer &&
  bytes.byteOffset === 0 &&
  bytes.byteLength === bytes.buffer.byteLength

const decodeDeflateBounded = async (
  encoded: Uint8Array,
  maximumBytes: number,
  label: string,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> => {
  if (typeof DecompressionStream !== 'function') {
    throw unsupportedOperation(`${label} requires the Deflate DecompressionStream primitive`)
  }
  const chunks: Uint8Array[] = []
  let outputBytes = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const stream = new Blob([encoded.slice()])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
    reader = stream.getReader()
    while (true) {
      throwIfAborted(signal)
      const result = await reader.read()
      if (result.done) break
      if (result.value.byteLength > maximumBytes - outputBytes) {
        await reader.cancel()
        throw limitExceeded(`${label} output exceeds ${maximumBytes} bytes`)
      }
      chunks.push(result.value)
      outputBytes += result.value.byteLength
    }
  } catch (error) {
    if (error instanceof ImageError) throw error
    throw invalidInput(`${label} stream is invalid`)
  } finally {
    reader?.releaseLock()
  }
  throwIfAborted(signal)
  const onlyChunk = chunks.length === 1 ? chunks[0] : undefined
  if (onlyChunk !== undefined && isExactArrayBufferView(onlyChunk)) return onlyChunk
  const output = new Uint8Array(outputBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

const unshuffle = (
  encoded: Uint8Array,
  elementBytes: number,
  maximumBytes: number,
  label: string,
): Uint8Array<ArrayBuffer> => {
  if (elementBytes < 1 || !Number.isSafeInteger(elementBytes)) {
    throw invalidInput(`${label} element byte length is invalid`)
  }
  if (encoded.byteLength > maximumBytes) {
    throw limitExceeded(`${label} output exceeds ${maximumBytes} bytes`)
  }
  if (encoded.byteLength % elementBytes !== 0) {
    throw invalidInput(`${label} input is not aligned to ${elementBytes}-byte elements`)
  }
  const elements = encoded.byteLength / elementBytes
  const output = new Uint8Array(encoded.byteLength)
  for (let byte = 0; byte < elementBytes; byte += 1) {
    const sourceOffset = byte * elements
    for (let element = 0; element < elements; element += 1) {
      output[element * elementBytes + byte] = encoded[sourceOffset + element] ?? 0
    }
  }
  return output
}

export const hdf5Fletcher32 = (bytes: Uint8Array): number => {
  let sum1 = 0
  let sum2 = 0
  let position = 0
  let words = Math.floor(bytes.byteLength / 2)
  while (words > 0) {
    const batch = Math.min(words, 360)
    words -= batch
    for (let index = 0; index < batch; index += 1) {
      sum1 += ((bytes[position] ?? 0) << 8) | (bytes[position + 1] ?? 0)
      position += 2
      sum2 += sum1
    }
    sum1 = (sum1 & 0xffff) + (sum1 >>> 16)
    sum2 = (sum2 & 0xffff) + (sum2 >>> 16)
  }
  if ((bytes.byteLength & 1) !== 0) {
    sum1 += (bytes[position] ?? 0) << 8
    sum2 += sum1
    sum1 = (sum1 & 0xffff) + (sum1 >>> 16)
    sum2 = (sum2 & 0xffff) + (sum2 >>> 16)
  }
  sum1 = (sum1 & 0xffff) + (sum1 >>> 16)
  sum2 = (sum2 & 0xffff) + (sum2 >>> 16)
  return ((sum2 << 16) | sum1) >>> 0
}

const verifyFletcher32 = (encoded: Uint8Array, label: string): Uint8Array<ArrayBuffer> => {
  if (encoded.byteLength < 5) throw invalidInput(`${label} input is too short`)
  const dataBytes = encoded.byteLength - 4
  const view = new DataView(encoded.buffer, encoded.byteOffset + dataBytes, 4)
  const stored = view.getUint32(0, true)
  const computed = hdf5Fletcher32(encoded.subarray(0, dataBytes))
  const legacy = (((computed & 0x00ff_00ff) << 8) | ((computed & 0xff00_ff00) >>> 8)) >>> 0
  if (stored !== computed && stored !== legacy) {
    throw invalidInput(`${label} checksum mismatch`)
  }
  return encoded.slice(0, dataBytes)
}

const requireClientData = (filter: Hdf5Filter, count: number, label: string): readonly number[] => {
  if (filter.clientData.length !== count) {
    throw invalidInput(
      `${label} declares ${filter.clientData.length} client values; expected ${count}`,
    )
  }
  return filter.clientData
}

export const decodeHdf5ChunkFilters = async (
  encoded: Uint8Array,
  expectedBytes: number,
  elementBytes: number,
  pipeline: Hdf5FilterPipeline | undefined,
  filterMask: number,
  options: Readonly<Hdf5FilterDecodeOptions> = {},
): Promise<Uint8Array<ArrayBuffer>> => {
  throwIfAborted(options.signal)
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1) {
    throw invalidInput('HDF5 decoded chunk byte length must be a positive safe integer')
  }
  if (!Number.isSafeInteger(filterMask) || filterMask < 0 || filterMask > 0xffff_ffff) {
    throw invalidInput('HDF5 chunk filter mask must be an unsigned 32-bit integer')
  }
  const maxDecodedChunkBytes = positiveSafeInteger(
    'HDF5 maximum decoded chunk bytes',
    options.maxDecodedChunkBytes ?? defaultMaximumBytes,
  )
  const maxFilterScratchBytes = positiveSafeInteger(
    'HDF5 maximum filter scratch bytes',
    options.maxFilterScratchBytes ?? defaultMaximumBytes,
  )
  if (expectedBytes > maxDecodedChunkBytes) {
    throw limitExceeded(`HDF5 decoded chunk exceeds ${maxDecodedChunkBytes} bytes`)
  }
  const filters = pipeline?.filters ?? []
  if (filters.length < 32 && filterMask >= 2 ** filters.length) {
    throw invalidInput('HDF5 chunk filter mask references a filter outside the pipeline')
  }
  const hasActiveFilter = filters.some((_, index) => ((filterMask >>> index) & 1) === 0)
  if (hasActiveFilter && expectedBytes > maxFilterScratchBytes) {
    throw limitExceeded(`HDF5 filter output exceeds ${maxFilterScratchBytes} scratch bytes`)
  }
  let current: Uint8Array = encoded
  const datasetLabel = `HDF5 dataset ${JSON.stringify(options.objectPath ?? '/')}`
  for (let index = filters.length - 1; index >= 0; index -= 1) {
    throwIfAborted(options.signal)
    if (((filterMask >>> index) & 1) !== 0) continue
    const filter = filters[index]
    if (filter === undefined) throw invalidInput('HDF5 filter pipeline is incomplete')
    const label = `${datasetLabel} ${filterName(filter)} filter`
    if (filter.id === 1) {
      const values = requireClientData(filter, 1, label)
      const level = values[0] ?? 0
      if (level > 9) throw invalidInput(`${label} level ${level} is invalid`)
      current = await decodeDeflateBounded(current, maxFilterScratchBytes, label, options.signal)
    } else if (filter.id === 2) {
      const values = requireClientData(filter, 1, label)
      const declaredElementBytes = values[0] ?? 0
      if (declaredElementBytes !== elementBytes) {
        throw invalidInput(
          `${label} element size ${declaredElementBytes} does not match datatype size ${elementBytes}`,
        )
      }
      current = unshuffle(current, declaredElementBytes, maxFilterScratchBytes, label)
    } else if (filter.id === 3) {
      requireClientData(filter, 0, label)
      current = verifyFletcher32(current, label)
    } else {
      throw unsupportedOperation(`${label} is unsupported`)
    }
    if (current.byteLength > maxFilterScratchBytes) {
      throw limitExceeded(`${label} output exceeds ${maxFilterScratchBytes} bytes`)
    }
  }
  throwIfAborted(options.signal)
  if (current.byteLength !== expectedBytes) {
    throw invalidInput(
      `HDF5 filter pipeline produced ${current.byteLength} bytes; expected ${expectedBytes}`,
    )
  }
  return isExactArrayBufferView(current) ? current : current.slice()
}

export const readHdf5DecodedChunkBlocks = async function* (
  file: Hdf5FileLayer,
  metadata: Hdf5DatasetMetadata,
  selection: Readonly<Hdf5HyperslabSelection>,
  options: Readonly<Hdf5ChunkReadOptions> = {},
): AsyncIterable<Hdf5DecodedChunkBlock> {
  if (metadata.layout.kind !== 'chunked') {
    throw unsupportedOperation('HDF5 decoded chunk streaming requires chunked storage')
  }
  for await (const block of readHdf5EncodedChunkBlocks(file, metadata, selection, options)) {
    throwIfAborted(options.signal)
    const { encoded, ...description } = block
    const decoded =
      encoded === undefined
        ? undefined
        : await decodeHdf5ChunkFilters(
            encoded,
            metadata.layout.chunkBytes,
            metadata.datatype.byteLength,
            metadata.filterPipeline,
            block.filterMask,
            options,
          )
    throwIfAborted(options.signal)
    yield Object.freeze({ ...description, decoded })
  }
}
