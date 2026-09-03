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

class BrotliBitWriter {
  #bytes = new Uint8Array(64)
  #position = 0

  writeBits(value: number, count: number): void {
    if (
      !Number.isSafeInteger(value) ||
      !Number.isSafeInteger(count) ||
      value < 0 ||
      count < 0 ||
      count > 24 ||
      value >= 2 ** count
    ) {
      throw invalidInput('Brotli output bit field is invalid')
    }
    this.#ensure(this.#position + count)
    for (let index = 0; index < count; index += 1) {
      if (((value >>> index) & 1) !== 0) {
        const position = this.#position + index
        this.#bytes[position >>> 3] = (this.#bytes[position >>> 3] ?? 0) | (1 << (position & 7))
      }
    }
    this.#position += count
  }

  finish(): Uint8Array {
    return this.#bytes.slice(0, Math.ceil(this.#position / 8))
  }

  #ensure(bitsNeeded: number): void {
    const bytesNeeded = Math.ceil(bitsNeeded / 8)
    if (bytesNeeded <= this.#bytes.byteLength) return
    let length = this.#bytes.byteLength
    while (length < bytesNeeded) length *= 2
    const grown = new Uint8Array(length)
    grown.set(this.#bytes)
    this.#bytes = grown
  }
}

interface BrotliPrefixCode {
  read(reader: BrotliBitReader): number
}

const reverseBits = (value: number, count: number): number => {
  let reversed = 0
  for (let index = 0; index < count; index += 1) {
    reversed = reversed * 2 + ((value >>> index) & 1)
  }
  return reversed
}

const prefixCode = (lengths: readonly number[] | Uint8Array): BrotliPrefixCode => {
  const counts = new Uint16Array(16)
  for (const length of lengths) {
    if (length < 0 || length > 15) throw invalidInput('Brotli prefix code length is invalid')
    if (length !== 0) counts[length] = (counts[length] ?? 0) + 1
  }
  const nextCodes = new Uint16Array(16)
  let code = 0
  for (let length = 1; length < nextCodes.length; length += 1) {
    code = (code + (counts[length - 1] ?? 0)) << 1
    nextCodes[length] = code
  }
  const symbols = new Map<number, number>()
  for (let symbol = 0; symbol < lengths.length; symbol += 1) {
    const length = lengths[symbol] ?? 0
    if (length === 0) continue
    const symbolCode = nextCodes[length] ?? 0
    nextCodes[length] = symbolCode + 1
    symbols.set(length * 65_536 + symbolCode, symbol)
  }
  if (symbols.size === 0) throw invalidInput('Brotli prefix code has no symbols')
  return Object.freeze({
    read: (reader: BrotliBitReader): number => {
      let value = 0
      for (let length = 1; length <= 15; length += 1) {
        value = value * 2 + reader.readBits(1)
        const symbol = symbols.get(length * 65_536 + value)
        if (symbol !== undefined) return symbol
      }
      throw invalidInput('Brotli prefix code is invalid')
    },
  })
}

const constantPrefixCode = (symbol: number): BrotliPrefixCode =>
  Object.freeze({ read: (): number => symbol })

const readCodeLengthCodeLength = (reader: BrotliBitReader): number => {
  if (reader.readBits(1) === 0) return reader.readBits(1) === 0 ? 0 : 3
  if (reader.readBits(1) === 0) return 4
  if (reader.readBits(1) === 0) return 2
  return reader.readBits(1) === 0 ? 1 : 5
}

const codeLengthOrder = Object.freeze([
  1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15,
])

const readPrefixCode = (reader: BrotliBitReader, alphabetSize: number): BrotliPrefixCode => {
  const selector = reader.readBits(2)
  if (selector === 1) {
    const symbolCount = reader.readBits(2) + 1
    const alphabetBits = Math.ceil(Math.log2(alphabetSize))
    const symbols: number[] = []
    for (let index = 0; index < symbolCount; index += 1) {
      const symbol = reader.readBits(alphabetBits)
      if (symbol >= alphabetSize || symbols.includes(symbol)) {
        throw invalidInput('Brotli simple prefix code symbol is invalid')
      }
      symbols.push(symbol)
    }
    if (symbolCount === 1) return constantPrefixCode(symbols[0] ?? 0)
    const lengths = new Uint8Array(alphabetSize)
    if (symbolCount === 2) {
      lengths[symbols[0] ?? 0] = 1
      lengths[symbols[1] ?? 0] = 1
    } else if (symbolCount === 3) {
      lengths[symbols[0] ?? 0] = 1
      lengths[symbols[1] ?? 0] = 2
      lengths[symbols[2] ?? 0] = 2
    } else {
      const treeSelect = reader.readBits(1)
      const selected = treeSelect === 0 ? [2, 2, 2, 2] : [1, 2, 3, 3]
      for (let index = 0; index < symbols.length; index += 1) {
        lengths[symbols[index] ?? 0] = selected[index] ?? 0
      }
    }
    return prefixCode(lengths)
  }
  if (selector !== 0 && selector !== 2 && selector !== 3) {
    throw invalidInput('Brotli complex prefix code selector is invalid')
  }
  const codeLengthLengths = new Uint8Array(18)
  let nonzero = 0
  let sum = 0
  for (let index = selector; index < codeLengthOrder.length; index += 1) {
    const symbol = codeLengthOrder[index]
    if (symbol === undefined) throw invalidInput('Brotli code-length order is incomplete')
    const length = readCodeLengthCodeLength(reader)
    codeLengthLengths[symbol] = length
    if (length !== 0) {
      nonzero += 1
      sum += 32 >>> length
      if (sum > 32) throw invalidInput('Brotli code-length prefix code is over-subscribed')
      if (nonzero >= 2 && sum === 32) break
    }
  }
  let codeLengthTree: BrotliPrefixCode
  if (nonzero === 1) {
    const symbol = codeLengthLengths.findIndex((length) => length !== 0)
    codeLengthTree = constantPrefixCode(symbol)
  } else {
    if (sum !== 32) throw invalidInput('Brotli code-length prefix code is incomplete')
    codeLengthTree = prefixCode(codeLengthLengths)
  }

  const lengths = new Uint8Array(alphabetSize)
  let position = 0
  let lengthSum = 0
  let previousNonzero = 8
  let pending: number | undefined
  while (position < alphabetSize && lengthSum < 32_768) {
    const symbol = pending ?? codeLengthTree.read(reader)
    pending = undefined
    if (symbol === 16 || symbol === 17) {
      const extraBits = symbol === 16 ? 2 : 3
      let repeat = reader.readBits(extraBits) + 3
      while (position + repeat < alphabetSize) {
        const next = codeLengthTree.read(reader)
        if (next !== symbol) {
          pending = next
          break
        }
        repeat = 2 ** extraBits * (repeat - 2) + reader.readBits(extraBits) + 3
      }
      if (position + repeat > alphabetSize) {
        throw invalidInput('Brotli repeated code length exceeds its alphabet')
      }
      const repeatedLength = symbol === 16 ? previousNonzero : 0
      lengths.fill(repeatedLength, position, position + repeat)
      if (repeatedLength !== 0) lengthSum += repeat * (32_768 >>> repeatedLength)
      position += repeat
    } else {
      if (symbol < 0 || symbol > 15) throw invalidInput('Brotli code length is invalid')
      lengths[position] = symbol
      if (symbol !== 0) {
        previousNonzero = symbol
        lengthSum += 32_768 >>> symbol
      }
      position += 1
    }
    if (lengthSum > 32_768) throw invalidInput('Brotli prefix code is over-subscribed')
  }
  if (lengthSum !== 32_768) throw invalidInput('Brotli prefix code is incomplete')
  return prefixCode(lengths)
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

const insertLengthBases = Object.freeze([
  0, 1, 2, 3, 4, 5, 6, 8, 10, 14, 18, 26, 34, 50, 66, 98, 130, 194, 322, 578, 1090, 2114, 6210,
  22_594,
])
const insertLengthExtraBits = Object.freeze([
  0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 12, 14, 24,
])
const copyLengthBases = Object.freeze([
  2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 18, 22, 30, 38, 54, 70, 102, 134, 198, 326, 582, 1094, 2118,
])
const copyLengthExtraBits = Object.freeze([
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 7, 8, 9, 10, 24,
])

const decodeInsertAndCopySymbol = (
  symbol: number,
): Readonly<{ insertCode: number; copyCode: number; implicitDistance: boolean }> => {
  if (symbol < 0 || symbol >= 704) throw invalidInput('Brotli insert-and-copy symbol is invalid')
  const local = symbol & 63
  const row = local >>> 3
  const column = local & 7
  if (symbol < 64)
    return Object.freeze({ insertCode: row, copyCode: column, implicitDistance: true })
  if (symbol < 128) {
    return Object.freeze({ insertCode: row, copyCode: column + 8, implicitDistance: true })
  }
  if (symbol < 192)
    return Object.freeze({ insertCode: row, copyCode: column, implicitDistance: false })
  if (symbol < 256) {
    return Object.freeze({ insertCode: row, copyCode: column + 8, implicitDistance: false })
  }
  if (symbol < 320) {
    return Object.freeze({ insertCode: row + 8, copyCode: column, implicitDistance: false })
  }
  if (symbol < 384) {
    return Object.freeze({ insertCode: row + 8, copyCode: column + 8, implicitDistance: false })
  }
  if (symbol < 448) {
    return Object.freeze({ insertCode: row, copyCode: column + 16, implicitDistance: false })
  }
  if (symbol < 512) {
    return Object.freeze({ insertCode: row + 16, copyCode: column, implicitDistance: false })
  }
  if (symbol < 576) {
    return Object.freeze({ insertCode: row + 8, copyCode: column + 16, implicitDistance: false })
  }
  if (symbol < 640) {
    return Object.freeze({ insertCode: row + 16, copyCode: column + 8, implicitDistance: false })
  }
  return Object.freeze({ insertCode: row + 16, copyCode: column + 16, implicitDistance: false })
}

const decodedLength = (
  reader: BrotliBitReader,
  code: number,
  bases: readonly number[],
  extraBits: readonly number[],
): number => {
  const base = bases[code]
  const bits = extraBits[code]
  if (base === undefined || bits === undefined) throw invalidInput('Brotli length code is invalid')
  return base + reader.readBits(bits)
}

const growOutput = (output: Uint8Array, byteLength: number): Uint8Array => {
  if (byteLength === output.byteLength) return output
  const grown = new Uint8Array(byteLength)
  grown.set(output)
  return grown
}

/**
 * Decode the bounded RFC 7932 subset emitted by `encodeBrotli` in addition to
 * uncompressed and metadata meta-blocks. Other compressed features reject
 * explicitly instead of falling through to a platform decoder.
 */
export const decodeBrotli = (
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
  let output: Uint8Array<ArrayBufferLike> = new Uint8Array()
  let metadataBytes = 0
  const lastDistances = [4, 11, 15, 16]

  while (true) {
    const isLast = reader.readBits(1) !== 0
    if (isLast && reader.readBits(1) !== 0) {
      reader.requireZeroTail()
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
    const blockBytes = readMetaBlockLength(reader, 4 + nibbleSelector)
    if (output.byteLength > maxOutputBytes - blockBytes) {
      throw limitExceeded(
        `Brotli output requires ${output.byteLength + blockBytes} bytes; maxOutputBytes is ${maxOutputBytes}`,
      )
    }
    const blockStart = output.byteLength
    output = growOutput(output, blockStart + blockBytes)
    if (!isLast && reader.readBits(1) !== 0) {
      reader.alignWithZeroPadding()
      output.set(reader.readAlignedBytes(blockBytes), blockStart)
      continue
    }

    if (reader.readBits(1) !== 0 || reader.readBits(1) !== 0 || reader.readBits(1) !== 0) {
      throw unsupportedOperation('Brotli block switching is not supported')
    }
    const npostfix = reader.readBits(2)
    const ndirect = reader.readBits(4) << npostfix
    if (npostfix !== 0) throw unsupportedOperation('Brotli distance postfix bits are not supported')
    if (reader.readBits(2) !== 0) {
      throw unsupportedOperation('Brotli literal context modes are not supported')
    }
    if (reader.readBits(1) !== 0 || reader.readBits(1) !== 0) {
      throw unsupportedOperation('Multiple Brotli context trees are not supported')
    }
    const literalTree = readPrefixCode(reader, 256)
    const commandTree = readPrefixCode(reader, 704)
    const distanceTree = readPrefixCode(reader, 16 + ndirect + 48)
    let position = blockStart
    const blockEnd = blockStart + blockBytes
    while (position < blockEnd) {
      const command = decodeInsertAndCopySymbol(commandTree.read(reader))
      const insertLength = decodedLength(
        reader,
        command.insertCode,
        insertLengthBases,
        insertLengthExtraBits,
      )
      const copyLength = decodedLength(
        reader,
        command.copyCode,
        copyLengthBases,
        copyLengthExtraBits,
      )
      if (position > blockEnd - insertLength) {
        throw invalidInput('Brotli literal insertion exceeds its meta-block')
      }
      for (let index = 0; index < insertLength; index += 1) {
        output[position] = literalTree.read(reader)
        position += 1
      }
      if (position === blockEnd) break
      if (position > blockEnd - copyLength) {
        throw invalidInput('Brotli backward copy exceeds its meta-block')
      }
      const distanceSymbol = command.implicitDistance ? 0 : distanceTree.read(reader)
      let distance: number
      if (distanceSymbol === 0) distance = lastDistances[0] ?? 4
      else if (distanceSymbol >= 16 && distanceSymbol < 16 + ndirect) {
        distance = distanceSymbol - 15
        lastDistances.unshift(distance)
        lastDistances.length = 4
      } else {
        throw unsupportedOperation(
          'Brotli encoded distances outside the direct subset are unsupported',
        )
      }
      if (distance <= 0 || distance > position) {
        throw invalidInput('Brotli backward distance precedes the output')
      }
      for (let index = 0; index < copyLength; index += 1) {
        output[position] = output[position - distance] ?? 0
        position += 1
      }
    }
    if (isLast) {
      reader.requireZeroTail()
      return output
    }
  }
}

const lengthCode = (
  length: number,
  bases: readonly number[],
  extraBits: readonly number[],
): Readonly<{ code: number; extra: number; bits: number }> => {
  for (let code = bases.length - 1; code >= 0; code -= 1) {
    const base = bases[code]
    const bits = extraBits[code]
    if (base === undefined || bits === undefined || length < base) continue
    const extra = length - base
    if (extra < 2 ** bits) return Object.freeze({ code, extra, bits })
  }
  throw invalidInput('Brotli length is outside the supported range')
}

const insertAndCopySymbol = (
  insertCode: number,
  copyCode: number,
  explicitDistance: boolean,
): number => {
  if (!explicitDistance && insertCode < 8 && copyCode < 16) {
    return (copyCode < 8 ? 0 : 64) + insertCode * 8 + (copyCode & 7)
  }
  if (insertCode < 8 && copyCode < 8) return 128 + insertCode * 8 + copyCode
  if (insertCode < 8 && copyCode < 16) return 192 + insertCode * 8 + (copyCode - 8)
  if (insertCode < 16 && copyCode < 8) return 256 + (insertCode - 8) * 8 + copyCode
  if (insertCode < 16 && copyCode < 16) {
    return 320 + (insertCode - 8) * 8 + (copyCode - 8)
  }
  if (insertCode < 8) return 384 + insertCode * 8 + (copyCode - 16)
  if (insertCode >= 16 && copyCode < 8) return 448 + (insertCode - 16) * 8 + copyCode
  if (insertCode < 16) return 512 + (insertCode - 8) * 8 + (copyCode - 16)
  if (copyCode < 16) return 576 + (insertCode - 16) * 8 + (copyCode - 8)
  return 640 + (insertCode - 16) * 8 + (copyCode - 16)
}

const writeSimplePrefixCode = (
  writer: BrotliBitWriter,
  symbol: number,
  alphabetSize: number,
): void => {
  writer.writeBits(1, 2)
  writer.writeBits(0, 2)
  writer.writeBits(symbol, Math.ceil(Math.log2(alphabetSize)))
}

const writeFixedLiteralPrefixCode = (writer: BrotliBitWriter): void => {
  writer.writeBits(3, 2)
  for (let index = 0; index < 15; index += 1) {
    if (index === 5) writer.writeBits(7, 4)
    else writer.writeBits(0, 2)
  }
  for (const extra of [2, 2, 2, 1]) writer.writeBits(extra, 2)
}

const repeatingTail = (
  input: Uint8Array,
): Readonly<{ insertLength: number; copyLength: number; distance: number }> | undefined => {
  for (let distance = 1; distance <= 4; distance += 1) {
    if (input.byteLength - distance < 2) continue
    let matches = true
    for (let index = distance; index < input.byteLength; index += 1) {
      if (input[index] !== input[index - distance]) {
        matches = false
        break
      }
    }
    if (matches) {
      return Object.freeze({
        insertLength: distance,
        copyLength: input.byteLength - distance,
        distance,
      })
    }
  }
  return undefined
}

const writeCompressedMetaBlock = (
  writer: BrotliBitWriter,
  input: Uint8Array,
  isLast: boolean,
): void => {
  writer.writeBits(isLast ? 1 : 0, 1)
  if (isLast) writer.writeBits(0, 1)
  const nibbles = input.byteLength <= 65_536 ? 4 : input.byteLength <= 1_048_576 ? 5 : 6
  writer.writeBits(nibbles - 4, 2)
  writer.writeBits(input.byteLength - 1, nibbles * 4)
  if (!isLast) writer.writeBits(0, 1)

  const repeat = repeatingTail(input)
  const insert = lengthCode(
    repeat?.insertLength ?? input.byteLength,
    insertLengthBases,
    insertLengthExtraBits,
  )
  const copy = lengthCode(repeat?.copyLength ?? 2, copyLengthBases, copyLengthExtraBits)
  const commandSymbol = insertAndCopySymbol(insert.code, copy.code, repeat !== undefined)
  const ndirect = repeat ? 4 : 0
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 2)
  writer.writeBits(ndirect, 4)
  writer.writeBits(0, 2)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writeFixedLiteralPrefixCode(writer)
  writeSimplePrefixCode(writer, commandSymbol, 704)
  writeSimplePrefixCode(writer, repeat ? 15 + repeat.distance : 0, 16 + ndirect + 48)
  writer.writeBits(insert.extra, insert.bits)
  writer.writeBits(copy.extra, copy.bits)
  const literalBytes = repeat?.insertLength ?? input.byteLength
  for (let index = 0; index < literalBytes; index += 1) {
    writer.writeBits(reverseBits(input[index] ?? 0, 8), 8)
  }
}

/** Encode bytes with a bounded, first-party compressed RFC 7932 subset. */
export const encodeBrotli = (input: Uint8Array): Uint8Array => {
  if (input.byteLength === 0) return Uint8Array.of(6)
  const writer = new BrotliBitWriter()
  writer.writeBits(0, 1)
  let offset = 0
  while (offset < input.byteLength) {
    const end = Math.min(offset + 16_777_216, input.byteLength)
    writeCompressedMetaBlock(writer, input.subarray(offset, end), end === input.byteLength)
    offset = end
  }
  return writer.finish()
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
