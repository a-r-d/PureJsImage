import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'

export interface BrotliDecodeLimits {
  readonly maxOutputBytes: number
  readonly maxMetadataBytes?: number
}

class BrotliBitReader {
  readonly #data: Uint8Array
  #position = 0

  constructor(data: Uint8Array) {
    this.#data = data
  }

  get bitPosition(): number {
    return this.#position
  }

  readBits(count: number): number {
    if (!Number.isSafeInteger(count) || count < 0 || count > 24) {
      throw invalidInput('Brotli bit width is invalid')
    }
    if (this.#position + count > this.#data.byteLength * 8) {
      throw truncatedInput('Brotli stream is truncated')
    }
    let value = 0
    for (let index = 0; index < count; index += 1) {
      const byte = this.#data[this.#position >>> 3]
      if (byte === undefined) throw truncatedInput('Brotli stream is truncated')
      value += ((byte >>> (this.#position & 7)) & 1) * 2 ** index
      this.#position += 1
    }
    return value
  }

  alignWithZeroPadding(): void {
    const padding = (8 - (this.#position & 7)) & 7
    if (padding !== 0 && this.readBits(padding) !== 0) {
      throw invalidInput('Brotli byte-alignment padding is nonzero')
    }
  }

  readAlignedBytes(count: number): Uint8Array {
    if ((this.#position & 7) !== 0) throw invalidInput('Brotli byte read is not aligned')
    if (!Number.isSafeInteger(count) || count < 0) {
      throw invalidInput('Brotli byte count is invalid')
    }
    const offset = this.#position >>> 3
    if (offset + count > this.#data.byteLength) throw truncatedInput('Brotli stream is truncated')
    this.#position += count * 8
    return this.#data.subarray(offset, offset + count)
  }

  requireZeroTail(): void {
    while (this.#position < this.#data.byteLength * 8) {
      if (this.readBits(1) !== 0) throw invalidInput('Brotli stream has nonzero trailing bits')
    }
  }
}

const validateLimit = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalidInput(`${name} must be a non-negative safe integer`)
  }
  return value
}

const readWindowBits = (reader: BrotliBitReader): number => {
  if (reader.readBits(1) === 0) return 16
  const first = reader.readBits(3)
  if (first !== 0) return 17 + first
  const second = reader.readBits(3)
  if (second === 1) throw unsupportedOperation('Large-window Brotli streams are not supported')
  return second === 0 ? 17 : 8 + second
}

const readMetaBlockLength = (reader: BrotliBitReader, nibbles: number): number => {
  const value = reader.readBits(nibbles * 4)
  if (nibbles > 4 && value < 2 ** ((nibbles - 1) * 4)) {
    throw invalidInput('Brotli meta-block length has a leading zero nibble')
  }
  return value + 1
}

const readMetadataLength = (reader: BrotliBitReader): number => {
  if (reader.readBits(1) !== 0) throw invalidInput('Brotli metadata reserved bit is set')
  const bytes = reader.readBits(2)
  if (bytes === 0) return 0
  const encoded = reader.readBits(bytes * 8)
  if (bytes > 1 && encoded < 2 ** ((bytes - 1) * 8)) {
    throw invalidInput('Brotli metadata length has a leading zero byte')
  }
  return encoded + 1
}

/**
 * Decode the bounded uncompressed meta-block subset of RFC 7932.
 *
 * Compressed meta-blocks are rejected explicitly. This first-party subset is
 * sufficient for deterministic JPEG reconstruction data emitted by
 * `encodeUncompressedBrotli`; broader Brotli syntax must not be accepted as if
 * it had been validated.
 */
export const decodeUncompressedBrotli = (
  input: Uint8Array,
  limits: Readonly<BrotliDecodeLimits>,
): Uint8Array => {
  const maxOutputBytes = validateLimit('maxOutputBytes', limits.maxOutputBytes)
  const maxMetadataBytes = validateLimit(
    'maxMetadataBytes',
    limits.maxMetadataBytes ?? maxOutputBytes,
  )
  const reader = new BrotliBitReader(input)
  readWindowBits(reader)
  const chunks: Uint8Array[] = []
  let outputBytes = 0
  let metadataBytes = 0

  while (true) {
    const isLast = reader.readBits(1) !== 0
    if (isLast && reader.readBits(1) !== 0) {
      reader.requireZeroTail()
      const output = new Uint8Array(outputBytes)
      let offset = 0
      for (const chunk of chunks) {
        output.set(chunk, offset)
        offset += chunk.byteLength
      }
      return output
    }

    const nibbleSelector = reader.readBits(2)
    if (nibbleSelector === 3) {
      const byteLength = readMetadataLength(reader)
      metadataBytes += byteLength
      if (metadataBytes > maxMetadataBytes) {
        throw limitExceeded(
          `Brotli metadata requires ${metadataBytes} bytes; maxMetadataBytes is ${maxMetadataBytes}`,
        )
      }
      reader.alignWithZeroPadding()
      reader.readAlignedBytes(byteLength)
      continue
    }

    const nibbles = 4 + nibbleSelector
    const byteLength = readMetaBlockLength(reader, nibbles)
    if (isLast) {
      throw unsupportedOperation('Compressed Brotli meta-blocks are not supported')
    }
    const isUncompressed = reader.readBits(1) !== 0
    if (!isUncompressed) {
      throw unsupportedOperation('Compressed Brotli meta-blocks are not supported')
    }
    if (outputBytes + byteLength > maxOutputBytes) {
      throw limitExceeded(
        `Brotli output requires ${outputBytes + byteLength} bytes; maxOutputBytes is ${maxOutputBytes}`,
      )
    }
    reader.alignWithZeroPadding()
    chunks.push(reader.readAlignedBytes(byteLength))
    outputBytes += byteLength
  }
}

/** Encode bytes as RFC 7932 uncompressed meta-blocks with a 16-bit window. */
export const encodeUncompressedBrotli = (input: Uint8Array): Uint8Array => {
  if (input.byteLength === 0) return Uint8Array.of(6)
  const fullChunks = Math.floor(input.byteLength / 65_536)
  const remainder = input.byteLength % 65_536
  const chunkCount = fullChunks + (remainder === 0 ? 0 : 1)
  const output = new Uint8Array(1 + chunkCount * 3 + input.byteLength + 1)
  output[0] = 12
  let sourceOffset = 0
  let outputOffset = 1
  while (sourceOffset < input.byteLength) {
    const byteLength = Math.min(65_536, input.byteLength - sourceOffset)
    const encodedLength = byteLength - 1
    output[outputOffset] = (encodedLength & 31) << 3
    output[outputOffset + 1] = encodedLength >>> 5
    output[outputOffset + 2] = 8 + (encodedLength >>> 13)
    outputOffset += 3
    output.set(input.subarray(sourceOffset, sourceOffset + byteLength), outputOffset)
    outputOffset += byteLength
    sourceOffset += byteLength
  }
  output[outputOffset] = 3
  return output
}
