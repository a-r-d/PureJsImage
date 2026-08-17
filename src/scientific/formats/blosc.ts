import { throwIfAborted } from '../../abort.ts'
import { decodeLz4Block } from '../../compression/lz4/block.ts'
import { decodeZstd } from '../../compression/zstd/index.ts'
import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'

const headerBytes = 16
const memcpyed = 0x02
const byteShuffle = 0x01
const bitShuffle = 0x04
const dontSplit = 0x10
const compressorShift = 5
const maxSplits = 16
const minSplitBuffer = 128

export interface BloscDecodeOptions {
  readonly maxOutputBytes: number
  readonly signal?: AbortSignal
}

const unshuffle = (encoded: Uint8Array, elementBytes: number): Uint8Array => {
  if (elementBytes <= 1) return encoded
  if (encoded.byteLength % elementBytes !== 0) {
    throw invalidInput('Blosc shuffled payload is not aligned to the element size')
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

const decodeZlib = async (
  encoded: Uint8Array,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  if (typeof DecompressionStream !== 'function') {
    throw unsupportedOperation('Blosc zlib requires the deflate DecompressionStream primitive')
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
        throw limitExceeded(`Blosc zlib output exceeds ${maximumBytes} bytes`)
      }
      chunks.push(result.value)
      outputBytes += result.value.byteLength
    }
  } catch (error) {
    if (error instanceof ImageError) throw error
    throw invalidInput('Blosc zlib stream is invalid')
  } finally {
    reader?.releaseLock()
  }
  if (chunks.length === 1) {
    const only = chunks[0]
    if (only !== undefined) return only
  }
  const output = new Uint8Array(outputBytes)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

const decodeInner = async (
  encoded: Uint8Array,
  compressor: number,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  if (compressor === 1) {
    return decodeLz4Block(encoded, {
      maxOutputBytes: maximumBytes,
      expectedOutputBytes: maximumBytes,
    })
  }
  if (compressor === 3) return decodeZlib(encoded, maximumBytes, signal)
  if (compressor === 4) return decodeZstd(encoded, { maxOutputBytes: maximumBytes })
  const names = ['blosclz', 'lz4', 'snappy', 'zlib', 'zstd']
  throw unsupportedOperation(
    `Blosc compressor ${names[compressor] ?? String(compressor)} is unsupported`,
  )
}

/** Decode a Blosc 1 buffer. Bitshuffle and BloscLZ/Snappy remain unsupported. */
export const decodeBlosc = async (
  encoded: Uint8Array,
  options: Readonly<BloscDecodeOptions>,
): Promise<Uint8Array> => {
  if (encoded.byteLength < headerBytes) throw invalidInput('Blosc header is truncated')
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength)
  const flags = encoded[2] ?? 0
  const typesize = encoded[3] ?? 0
  const nbytes = view.getInt32(4, true)
  const blocksize = view.getInt32(8, true)
  const cbytes = view.getInt32(12, true)
  if (nbytes < 0 || blocksize < 1 || cbytes !== encoded.byteLength) {
    throw invalidInput('Blosc header sizes are invalid')
  }
  if (nbytes > options.maxOutputBytes) {
    throw limitExceeded(`Blosc output exceeds ${options.maxOutputBytes} bytes`)
  }
  if (typesize < 1) throw invalidInput('Blosc typesize is invalid')
  if ((flags & bitShuffle) !== 0) {
    throw unsupportedOperation('Blosc bitshuffle is unsupported')
  }
  if ((flags & memcpyed) !== 0) {
    if (encoded.byteLength !== headerBytes + nbytes) {
      throw invalidInput('Blosc memcpy payload size is invalid')
    }
    return encoded.slice(headerBytes, headerBytes + nbytes)
  }
  const compressor = flags >>> compressorShift
  const leftover = nbytes % blocksize
  const blockCount = Math.ceil(nbytes / blocksize)
  const tableBytes = blockCount * 4
  if (encoded.byteLength < headerBytes + tableBytes) {
    throw invalidInput('Blosc block table is truncated')
  }
  const output = new Uint8Array(nbytes)
  let dest = 0
  for (let block = 0; block < blockCount; block += 1) {
    throwIfAborted(options.signal)
    const remaining = nbytes - dest
    const expected = Math.min(blocksize, remaining)
    const leftoverBlock = leftover > 0 && block === blockCount - 1
    const split =
      (flags & dontSplit) === 0 &&
      typesize <= maxSplits &&
      Math.floor(blocksize / typesize) >= minSplitBuffer &&
      !leftoverBlock
        ? typesize
        : 1
    if (expected % split !== 0) throw invalidInput('Blosc block is not divisible into splits')
    const splitBytes = expected / split
    const start = view.getInt32(headerBytes + block * 4, true)
    if (start < headerBytes + tableBytes || start > encoded.byteLength - 4) {
      throw invalidInput('Blosc compressed block extends outside the buffer')
    }
    let cursor = start
    for (let part = 0; part < split; part += 1) {
      if (cursor + 4 > encoded.byteLength) throw invalidInput('Blosc split size is truncated')
      const compressedSize = view.getInt32(cursor, true)
      cursor += 4
      if (compressedSize < 0 || cursor + compressedSize > encoded.byteLength) {
        throw invalidInput('Blosc compressed split extends outside the buffer')
      }
      const payload = encoded.subarray(cursor, cursor + compressedSize)
      cursor += compressedSize
      const decoded =
        compressedSize === splitBytes
          ? payload
          : await decodeInner(payload, compressor, splitBytes, options.signal)
      if (decoded.byteLength !== splitBytes) {
        throw invalidInput(
          `Blosc split decoded ${decoded.byteLength} bytes; expected ${splitBytes}`,
        )
      }
      output.set(decoded, dest)
      dest += splitBytes
    }
  }
  if (dest !== nbytes) throw invalidInput('Blosc decoded size does not match the header')
  return (flags & byteShuffle) === 0 ? output : unshuffle(output, typesize)
}
