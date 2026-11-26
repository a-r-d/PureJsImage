import { invalidInput, truncatedInput } from '../errors.ts'

const maximumCodes = 4096

/** Growable byte output that packs bytes into GIF data sub-blocks of at most 255 bytes. */
export class GifByteWriter {
  #data: Uint8Array
  #length = 0

  constructor(initialBytes = 4096) {
    this.#data = new Uint8Array(Math.max(16, initialBytes))
  }

  get length(): number {
    return this.#length
  }

  reserve(bytes: number): void {
    const needed = this.#length + bytes
    if (needed <= this.#data.byteLength) return
    let capacity = this.#data.byteLength * 2
    while (capacity < needed) capacity *= 2
    const next = new Uint8Array(capacity)
    next.set(this.#data.subarray(0, this.#length))
    this.#data = next
  }

  byte(value: number): void {
    this.reserve(1)
    this.#data[this.#length] = value
    this.#length += 1
  }

  uint16(value: number): void {
    this.reserve(2)
    this.#data[this.#length] = value & 0xff
    this.#data[this.#length + 1] = value >>> 8
    this.#length += 2
  }

  bytes(values: Uint8Array): void {
    this.reserve(values.byteLength)
    this.#data.set(values, this.#length)
    this.#length += values.byteLength
  }

  /** The written bytes. The view stays valid until the next write. */
  view(): Uint8Array {
    return this.#data.subarray(0, this.#length)
  }

  reset(): void {
    this.#length = 0
  }

  // LZW output writes straight into the buffer; these give it direct access.
  get buffer(): Uint8Array {
    return this.#data
  }

  set end(value: number) {
    this.#length = value
  }
}

/**
 * GIF LZW compressor. The child table maps a prefix code and the next index straight to a code, so
 * each pixel costs one table read. Only entries added since the last clear are reset.
 */
export class GifLzwEncoder {
  // Code for (prefix << 8 | index); zero means absent because added codes start above 5.
  readonly #children = new Uint16Array(maximumCodes << 8)
  readonly #added = new Int32Array(maximumCodes)

  /** Appends the minimum code size byte, the data sub-blocks and the block terminator. */
  encode(
    indices: Uint8Array,
    start: number,
    end: number,
    minimumCodeSize: number,
    writer: GifByteWriter,
  ): void {
    if (minimumCodeSize < 2 || minimumCodeSize > 8 || end <= start) {
      throw invalidInput('GIF LZW input is invalid')
    }
    const children = this.#children
    const added = this.#added
    const clearCode = 1 << minimumCodeSize
    const endCode = clearCode + 1
    let next = clearCode + 2
    let codeSize = minimumCodeSize + 1
    let addedCount = 0
    let accumulator = 0
    let bitCount = 0

    // Worst case is one 12-bit code per pixel plus clears, packed into 255-byte sub-blocks.
    const maximumDataBytes = Math.ceil(((end - start) * 12 + 64) / 8) + 16
    writer.reserve(1 + maximumDataBytes + Math.ceil(maximumDataBytes / 255) + 1)
    writer.byte(minimumCodeSize)
    const output = writer.buffer
    let position = writer.length
    let blockStart = position
    position += 1

    // Codes are packed inline at each emit site; a closure would move the bit state off the stack.
    accumulator = clearCode
    bitCount = codeSize
    let prefix = indices[start] ?? 0
    for (let index = start + 1; index < end; index += 1) {
      const value = indices[index] ?? 0
      const key = (prefix << 8) | value
      const code = children[key] ?? 0
      if (code !== 0) {
        prefix = code
        continue
      }
      accumulator |= prefix << bitCount
      bitCount += codeSize
      while (bitCount >= 8) {
        output[position] = accumulator & 0xff
        position += 1
        accumulator >>>= 8
        bitCount -= 8
        if (position - blockStart === 256) {
          output[blockStart] = 255
          blockStart = position
          position += 1
        }
      }
      if (next >= 1 << codeSize && codeSize < 12) codeSize += 1
      if (next < maximumCodes) {
        children[key] = next
        added[addedCount] = key
        addedCount += 1
        next += 1
      } else {
        accumulator |= clearCode << bitCount
        bitCount += codeSize
        while (bitCount >= 8) {
          output[position] = accumulator & 0xff
          position += 1
          accumulator >>>= 8
          bitCount -= 8
          if (position - blockStart === 256) {
            output[blockStart] = 255
            blockStart = position
            position += 1
          }
        }
        for (let entry = 0; entry < addedCount; entry += 1) children[added[entry] ?? 0] = 0
        addedCount = 0
        next = clearCode + 2
        codeSize = minimumCodeSize + 1
      }
      prefix = value
    }
    // The last prefix, then the end code, which may need one more bit like any following code.
    const finalCodes = [prefix, endCode]
    for (let final = 0; final < 2; final += 1) {
      accumulator |= (finalCodes[final] ?? 0) << bitCount
      bitCount += codeSize
      while (bitCount >= 8) {
        output[position] = accumulator & 0xff
        position += 1
        accumulator >>>= 8
        bitCount -= 8
        if (position - blockStart === 256) {
          output[blockStart] = 255
          blockStart = position
          position += 1
        }
      }
      if (final === 0 && next >= 1 << codeSize && codeSize < 12) codeSize += 1
    }
    if (bitCount > 0) {
      output[position] = accumulator & 0xff
      position += 1
      if (position - blockStart === 256) {
        output[blockStart] = 255
        blockStart = position
        position += 1
      }
    }
    for (let entry = 0; entry < addedCount; entry += 1) children[added[entry] ?? 0] = 0
    const lastBlock = position - blockStart - 1
    if (lastBlock > 0) {
      output[blockStart] = lastBlock
      output[position] = 0
      writer.end = position + 1
    } else {
      output[blockStart] = 0
      writer.end = blockStart + 1
    }
  }
}

/** The smallest LZW minimum code size that covers palette indices below `colors`. */
export const gifMinimumCodeSize = (colors: number): number => {
  let size = 2
  while (1 << size < colors) size += 1
  return size
}

/**
 * Decodes one frame's LZW data into `output`. `data` holds the frame's sub-blocks starting at
 * `offset` (the byte after the minimum code size). Returns the offset after the block terminator.
 * The sub-block payload is first gathered into one buffer so code reads need no block checks.
 * Strings are written in place, last byte first, from per-code lengths instead of a stack.
 */
export const decodeGifLzw = (
  data: Uint8Array,
  offset: number,
  minimumCodeSize: number,
  output: Uint8Array,
  scratch: GifLzwDecodeScratch,
): number => {
  if (minimumCodeSize < 2 || minimumCodeSize > 8) {
    throw invalidInput(`GIF LZW minimum code size ${minimumCodeSize} is invalid`)
  }
  // Gather the payload. Four zero bytes after it let the last refill read past the end safely.
  const size = data.byteLength
  let payload = 0
  let position = offset
  for (let blocks = 0; ; blocks += 1) {
    if (position >= size) throw truncatedInput('GIF LZW data is truncated')
    const length = data[position] ?? 0
    position += 1
    if (length === 0) break
    if (position + length > size) throw truncatedInput('GIF data sub-block is truncated')
    if (blocks >= 1_000_000) throw invalidInput('GIF contains too many data sub-blocks')
    if (scratch.packed.byteLength < payload + length + 4) {
      const grown = new Uint8Array(Math.max(scratch.packed.byteLength * 2, payload + length + 4))
      grown.set(scratch.packed.subarray(0, payload))
      scratch.packed = grown
    }
    scratch.packed.set(data.subarray(position, position + length), payload)
    payload += length
    position += length
  }
  const next = position
  const packed = scratch.packed
  packed.fill(0, payload, payload + 4)

  const prefix = scratch.prefix
  const suffix = scratch.suffix
  const lengths = scratch.lengths
  const clearCode = 1 << minimumCodeSize
  const endCode = clearCode + 1
  for (let code = 0; code < clearCode; code += 1) {
    suffix[code] = code
    lengths[code] = 1
  }
  const expected = output.byteLength
  let codeSize = minimumCodeSize + 1
  let codeMask = (1 << codeSize) - 1
  let available = endCode + 1
  let previous = -1
  let written = 0
  let accumulator = 0
  let bitCount = 0
  let read = 0
  for (;;) {
    // Codes are at most 12 bits, so one 16-bit refill always covers the next code.
    if (bitCount < codeSize) {
      accumulator |= ((packed[read] ?? 0) | ((packed[read + 1] ?? 0) << 8)) << bitCount
      read += 2
      bitCount += 16
    }
    // Bits past the payload are padding, so the stream ended without an end code.
    if ((read << 3) - bitCount + codeSize > payload << 3) {
      throw invalidInput('GIF LZW stream did not reach an end code')
    }
    const code = accumulator & codeMask
    accumulator >>>= codeSize
    bitCount -= codeSize
    if (code === clearCode) {
      codeSize = minimumCodeSize + 1
      codeMask = (1 << codeSize) - 1
      available = endCode + 1
      previous = -1
      continue
    }
    if (code === endCode) break
    if (previous < 0) {
      if (code >= clearCode) throw invalidInput('GIF LZW stream starts with an invalid code')
      if (written >= expected) throw invalidInput('GIF LZW stream contains too many pixels')
      output[written] = code
      written += 1
      previous = code
      continue
    }
    let length: number
    let first: number
    if (code < clearCode) {
      if (written >= expected) throw invalidInput('GIF LZW stream contains too many pixels')
      output[written] = code
      length = 1
      first = code
    } else if (code < available) {
      length = lengths[code] ?? 0
      if (written + length > expected) throw invalidInput('GIF LZW stream contains too many pixels')
      let cursor = written + length - 1
      let walk = code
      while (walk >= clearCode) {
        output[cursor] = suffix[walk] ?? 0
        cursor -= 1
        walk = prefix[walk] ?? 0
      }
      output[cursor] = walk
      first = walk
    } else if (code === available) {
      const previousLength = lengths[previous] ?? 0
      length = previousLength + 1
      if (written + length > expected) throw invalidInput('GIF LZW stream contains too many pixels')
      let cursor = written + previousLength - 1
      let walk = previous
      while (walk >= clearCode) {
        output[cursor] = suffix[walk] ?? 0
        cursor -= 1
        walk = prefix[walk] ?? 0
      }
      output[cursor] = walk
      first = walk
      output[written + previousLength] = first
    } else {
      throw invalidInput('GIF LZW stream references an unavailable code')
    }
    written += length
    if (available < maximumCodes) {
      prefix[available] = previous
      suffix[available] = first
      lengths[available] = (lengths[previous] ?? 0) + 1
      available += 1
      if (available === 1 << codeSize && codeSize < 12) {
        codeSize += 1
        codeMask = (1 << codeSize) - 1
      }
    }
    previous = code
  }
  if (written !== expected) {
    throw truncatedInput(`GIF frame decoded ${written} of ${expected} pixels`)
  }
  return next
}

export interface GifLzwDecodeScratch {
  readonly prefix: Uint16Array
  readonly suffix: Uint8Array
  readonly lengths: Uint16Array
  /** Gathered sub-block payload; grows to the largest frame seen. */
  packed: Uint8Array
}

export const createGifLzwDecodeScratch = (): GifLzwDecodeScratch => ({
  prefix: new Uint16Array(maximumCodes),
  suffix: new Uint8Array(maximumCodes),
  lengths: new Uint16Array(maximumCodes),
  packed: new Uint8Array(1 << 16),
})
