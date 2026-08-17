import { throwIfAborted } from '../../abort.ts'
import { decodeLz4Block } from '../../compression/lz4/block.ts'
import { decodeZstd } from '../../compression/zstd/index.ts'
import { ImageError, invalidInput, limitExceeded, unsupportedOperation } from '../../errors.ts'

const headerBytes = 16
const memcpyed = 0x02
const byteShuffle = 0x01
const bitShuffle = 0x04
const compressorShift = 5

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
  if (compressor === 1 || compressor === 2) {
    return decodeLz4Block(encoded, { maxOutputBytes: maximumBytes })
  }
  if (compressor === 4) return decodeZlib(encoded, maximumBytes, signal)
  if (compressor === 5) return decodeZstd(encoded, { maxOutputBytes: maximumBytes })
  const names = ['blosclz', 'lz4', 'lz4hc', 'snappy', 'zlib', 'zstd']
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
  const blockCount = Math.ceil(nbytes / blocksize)
  const tableBytes = blockCount * 4
  if (encoded.byteLength < headerBytes + tableBytes) {
    throw invalidInput('Blosc block table is truncated')
  }
  const output = new Uint8Array(nbytes)
  let source = headerBytes + tableBytes
  let dest = 0
  for (let block = 0; block < blockCount; block += 1) {
    throwIfAborted(options.signal)
    const remaining = nbytes - dest
    const expected = Math.min(blocksize, remaining)
    const compressedSize = view.getInt32(headerBytes + block * 4, true)
    if (compressedSize < 0 || source + compressedSize > encoded.byteLength) {
      throw invalidInput('Blosc compressed block extends outside the buffer')
    }
    const payload = encoded.subarray(source, source + compressedSize)
    source += compressedSize
    const decoded =
      compressedSize === expected
        ? payload
        : await decodeInner(payload, compressor, expected, options.signal)
    if (decoded.byteLength !== expected) {
      throw invalidInput(`Blosc block decoded ${decoded.byteLength} bytes; expected ${expected}`)
    }
    output.set(decoded, dest)
    dest += expected
  }
  if (dest !== nbytes) throw invalidInput('Blosc decoded size does not match the header')
  return (flags & byteShuffle) === 0 ? output : unshuffle(output, typesize)
}
