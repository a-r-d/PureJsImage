import { throwIfAborted } from '../abort.ts'
import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import type { PixelColorSemantics } from '../color.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import { validateImageDimensions } from '../limits.ts'
import type { JpegXlEncodeOptions } from '../pipeline.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'

export class JpegXlBitWriter {
  #bytes = new Uint8Array(256)
  #bitPosition = 0

  writeBits(value: number, count: number): void {
    if (
      !Number.isSafeInteger(value) ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 32 ||
      value < 0 ||
      value >= 2 ** count
    ) {
      throw invalidInput('JPEG XL output bit field is invalid')
    }
    this.#ensure(this.#bitPosition + count)
    let remaining = count
    let position = this.#bitPosition
    let source = value
    while (remaining > 0) {
      const bitOffset = position & 7
      const chunkBits = Math.min(remaining, 8 - bitOffset)
      const mask = 2 ** chunkBits - 1
      const byteOffset = position >>> 3
      this.#bytes[byteOffset] =
        (this.#bytes[byteOffset] ?? 0) | ((Math.floor(source) & mask) << bitOffset)
      source = Math.floor(source / 2 ** chunkBits)
      position += chunkBits
      remaining -= chunkBits
    }
    this.#bitPosition += count
  }

  alignToByte(): void {
    const padding = (8 - (this.#bitPosition & 7)) & 7
    if (padding !== 0) this.writeBits(0, padding)
  }

  finish(): Uint8Array {
    this.alignToByte()
    return this.#bytes.slice(0, this.#bitPosition >>> 3)
  }

  #ensure(bits: number): void {
    const bytes = Math.ceil(bits / 8)
    if (bytes <= this.#bytes.byteLength) return
    let length = this.#bytes.byteLength
    while (length < bytes) length *= 2
    const grown = new Uint8Array(length)
    grown.set(this.#bytes)
    this.#bytes = grown
  }
}

export const writeU32 = (
  writer: JpegXlBitWriter,
  value: number,
  distributions: readonly (
    | { readonly value: number }
    | { readonly bits: number; readonly offset: number }
  )[],
): void => {
  for (let selector = 0; selector < distributions.length; selector += 1) {
    const distribution = distributions[selector]
    if (!distribution) continue
    if ('value' in distribution) {
      if (distribution.value !== value) continue
      writer.writeBits(selector, 2)
      return
    }
    const encoded = value - distribution.offset
    if (encoded < 0 || encoded >= 2 ** distribution.bits) continue
    writer.writeBits(selector, 2)
    writer.writeBits(encoded, distribution.bits)
    return
  }
  throw invalidInput('JPEG XL output integer is outside its distribution')
}

const writeZeroU64 = (writer: JpegXlBitWriter): void => writer.writeBits(0, 2)

const writeDimension = (writer: JpegXlBitWriter, dimension: number): void =>
  writeU32(writer, dimension, [
    { bits: 9, offset: 1 },
    { bits: 13, offset: 1 },
    { bits: 18, offset: 1 },
    { bits: 30, offset: 1 },
  ])

const writeBitDepth = (writer: JpegXlBitWriter, bitDepth: 8 | 16): void => {
  writer.writeBits(0, 1)
  writeU32(writer, bitDepth, [{ value: 8 }, { value: 10 }, { value: 12 }, { bits: 6, offset: 1 }])
}

const writeName = (writer: JpegXlBitWriter): void =>
  writeU32(writer, 0, [
    { value: 0 },
    { bits: 4, offset: 0 },
    { bits: 5, offset: 16 },
    { bits: 10, offset: 48 },
  ])

const nextHuffmanKey = (key: number, length: number): number => {
  let step = 2 ** (length - 1)
  while ((key & step) !== 0) step >>>= 1
  return (key & (step - 1)) + step
}

const writeVarUint16 = (writer: JpegXlBitWriter, value: number): void => {
  if (value === 0) {
    writer.writeBits(0, 1)
    return
  }
  writer.writeBits(1, 1)
  if (value === 1) {
    writer.writeBits(0, 4)
    return
  }
  const bits = Math.floor(Math.log2(value))
  if (bits > 15) throw invalidInput('JPEG XL prefix alphabet is too large')
  writer.writeBits(bits, 4)
  writer.writeBits(value - 2 ** bits, bits)
}

const codeLengthStatic = new Map<number, Readonly<{ key: number; bits: number }>>([
  [0, Object.freeze({ key: 0, bits: 2 })],
  [1, Object.freeze({ key: 7, bits: 4 })],
  [4, Object.freeze({ key: 1, bits: 2 })],
  [5, Object.freeze({ key: 15, bits: 4 })],
])

const writeCodeLengthStaticSymbol = (writer: JpegXlBitWriter, symbol: 0 | 1 | 4 | 5): void => {
  const code = codeLengthStatic.get(symbol)
  if (!code) throw invalidInput('JPEG XL code-length symbol is unavailable')
  writer.writeBits(code.key, code.bits)
}

export interface PrefixEncoding {
  readonly keys: Uint16Array
  readonly lengths: Uint8Array
  readonly singleSymbol?: number
}

const writeEntropyHeader = (
  writer: JpegXlBitWriter,
  contexts: number,
  alphabetSize: number,
): void => {
  writer.writeBits(0, 1)
  if (contexts > 1) {
    writer.writeBits(1, 1)
    writer.writeBits(0, 2)
  }
  writer.writeBits(1, 1)
  writer.writeBits(8, 4)
  writer.writeBits(0, 4)
  writer.writeBits(0, 4)
  writeVarUint16(writer, alphabetSize - 1)
}

const canonicalEncoding = (lengths: Uint8Array): PrefixEncoding => {
  const keys = new Uint16Array(lengths.length)
  const maximumBits = lengths.reduce((maximum, length) => Math.max(maximum, length), 0)
  let key = 0
  for (let bits = 1; bits <= maximumBits; bits += 1) {
    for (let symbol = 0; symbol < lengths.length; symbol += 1) {
      if (lengths[symbol] !== bits) continue
      keys[symbol] = key
      key = nextHuffmanKey(key, bits)
    }
  }
  return Object.freeze({ keys, lengths })
}

const writeFixedPrefixCode = (writer: JpegXlBitWriter, contexts: number): PrefixEncoding => {
  writeEntropyHeader(writer, contexts, 512)
  writer.writeBits(0, 2)

  for (let index = 0; index < 8; index += 1) writeCodeLengthStaticSymbol(writer, 0)
  writeCodeLengthStaticSymbol(writer, 1)
  for (let index = 0; index < 2; index += 1) writeCodeLengthStaticSymbol(writer, 0)
  writeCodeLengthStaticSymbol(writer, 1)
  for (let symbol = 0; symbol < 512; symbol += 1) writer.writeBits(0, 1)
  return canonicalEncoding(new Uint8Array(512).fill(9))
}

const validateHybridValue = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 131_071) {
    throw invalidInput('JPEG XL Modular residual is outside the supported encoder range')
  }
}

const hybridToken = (value: number): number => {
  validateHybridValue(value)
  return value < 256 ? value : 248 + Math.floor(Math.log2(value))
}

export const writeHybridUint = (
  writer: JpegXlBitWriter,
  value: number,
  encoding: Readonly<PrefixEncoding>,
): void => {
  const token = hybridToken(value)
  const length = encoding.lengths[token]
  const key = encoding.keys[token]
  if (
    length === undefined ||
    key === undefined ||
    (length === 0 && encoding.singleSymbol !== token)
  ) {
    throw invalidInput('JPEG XL Modular entropy token is missing from its prefix code')
  }
  writer.writeBits(key, length)
  if (value >= 256) {
    const extraBits = token - 248
    writer.writeBits(value - 2 ** extraBits, extraBits)
  }
}

export const packSigned = (value: number): number => (value < 0 ? -2 * value - 1 : 2 * value)

export const writeModularTree = (writer: JpegXlBitWriter, predictor = 1): void => {
  if (!Number.isSafeInteger(predictor) || predictor < 0 || predictor > 13) {
    throw invalidInput('JPEG XL Modular predictor is invalid')
  }
  const frequencies = new Uint32Array(Math.max(2, predictor + 1))
  frequencies[0] = predictor === 0 ? 5 : 4
  if (predictor !== 0) frequencies[predictor] = 1
  const encoding = writePrefixCode(writer, 6, frequencies)
  for (const symbol of [0, predictor, 0, 0, 0]) writeHybridUint(writer, symbol, encoding)
}

const huffmanLengths = (frequencies: Uint32Array): Uint8Array | undefined => {
  interface Node {
    readonly weight: number
    readonly minimumSymbol: number
    readonly symbol?: number
    readonly left?: Node
    readonly right?: Node
  }
  const nodes: Node[] = []
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    const weight = frequencies[symbol] ?? 0
    if (weight > 0) nodes.push({ weight, minimumSymbol: symbol, symbol })
  }
  if (nodes.length < 2) return undefined
  while (nodes.length > 1) {
    nodes.sort(
      (left, right) => left.weight - right.weight || left.minimumSymbol - right.minimumSymbol,
    )
    const left = nodes.shift()
    const right = nodes.shift()
    if (!left || !right) throw invalidInput('JPEG XL Huffman tree is incomplete')
    nodes.push({
      weight: left.weight + right.weight,
      minimumSymbol: Math.min(left.minimumSymbol, right.minimumSymbol),
      left,
      right,
    })
  }
  const lengths = new Uint8Array(frequencies.length)
  const visit = (node: Readonly<Node>, depth: number): void => {
    if (node.symbol !== undefined) {
      if (depth > 15) throw limitExceeded('JPEG XL Huffman code exceeds 15 bits')
      lengths[node.symbol] = depth
      return
    }
    if (!node.left || !node.right) throw invalidInput('JPEG XL Huffman node is incomplete')
    visit(node.left, depth + 1)
    visit(node.right, depth + 1)
  }
  visit(nodes[0] as Node, 0)
  return lengths
}

const codeLengthOrder = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15]

const codeLengthEncoding = (): PrefixEncoding => {
  const lengths = new Uint8Array(18)
  for (let index = 0; index < codeLengthOrder.length; index += 1) {
    const symbol = codeLengthOrder[index]
    if (symbol === undefined) throw invalidInput('JPEG XL code-length order is incomplete')
    lengths[symbol] = index < 14 ? 4 : 5
  }
  return canonicalEncoding(lengths)
}

const writeComplexHuffmanCode = (writer: JpegXlBitWriter, lengths: Uint8Array): void => {
  writer.writeBits(0, 2)
  for (let index = 0; index < codeLengthOrder.length; index += 1) {
    writeCodeLengthStaticSymbol(writer, index < 14 ? 4 : 5)
  }
  const encoding = codeLengthEncoding()
  for (const length of lengths) {
    writer.writeBits(encoding.keys[length] ?? 0, encoding.lengths[length] ?? 0)
  }
}

const writeSimpleHuffmanCode = (
  writer: JpegXlBitWriter,
  alphabetSize: number,
  symbols: readonly number[],
  frequencies: Uint32Array,
): PrefixEncoding => {
  writer.writeBits(1, 2)
  writer.writeBits(symbols.length - 1, 2)
  const symbolBits = Math.ceil(Math.log2(alphabetSize))
  const ordered =
    symbols.length === 3
      ? [
          [...symbols].sort(
            (left, right) => (frequencies[right] ?? 0) - (frequencies[left] ?? 0) || left - right,
          )[0] ?? 0,
          ...[...symbols]
            .sort(
              (left, right) => (frequencies[right] ?? 0) - (frequencies[left] ?? 0) || left - right,
            )
            .slice(1)
            .sort((left, right) => left - right),
        ]
      : [...symbols]
  for (const symbol of ordered) writer.writeBits(symbol, symbolBits)
  if (symbols.length === 4) writer.writeBits(0, 1)
  const lengths = new Uint8Array(alphabetSize)
  if (symbols.length === 1) {
    lengths[ordered[0] ?? 0] = 0
  } else if (symbols.length === 2) {
    for (const symbol of [...ordered].sort((left, right) => left - right)) lengths[symbol] = 1
  } else if (symbols.length === 3) {
    lengths[ordered[0] ?? 0] = 1
    lengths[ordered[1] ?? 0] = 2
    lengths[ordered[2] ?? 0] = 2
  } else {
    for (const symbol of [...ordered].sort((left, right) => left - right)) lengths[symbol] = 2
  }
  const encoding = canonicalEncoding(lengths)
  return symbols.length === 1
    ? Object.freeze({ ...encoding, singleSymbol: ordered[0] ?? 0 })
    : encoding
}

export const writePrefixCode = (
  writer: JpegXlBitWriter,
  contexts: number,
  frequencies: Uint32Array,
): PrefixEncoding => {
  let maximumSymbol = frequencies.length - 1
  while (maximumSymbol > 0 && frequencies[maximumSymbol] === 0) maximumSymbol -= 1
  const alphabetSize = maximumSymbol + 1
  if (alphabetSize === 1) {
    writeEntropyHeader(writer, contexts, alphabetSize)
    return Object.freeze({
      keys: new Uint16Array(1),
      lengths: Uint8Array.of(0),
      singleSymbol: 0,
    })
  }
  const symbols: number[] = []
  for (let symbol = 0; symbol < alphabetSize; symbol += 1) {
    if ((frequencies[symbol] ?? 0) > 0) symbols.push(symbol)
  }
  if (symbols.length <= 4) {
    writeEntropyHeader(writer, contexts, alphabetSize)
    return writeSimpleHuffmanCode(writer, alphabetSize, symbols, frequencies)
  }
  let lengths: Uint8Array
  try {
    const candidate = huffmanLengths(frequencies.subarray(0, alphabetSize))
    if (!candidate) throw invalidInput('JPEG XL Huffman frequencies are empty')
    lengths = candidate
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('exceeds 15 bits')) throw error
    return writeFixedPrefixCode(writer, contexts)
  }
  writeEntropyHeader(writer, contexts, alphabetSize)
  writeComplexHuffmanCode(writer, lengths)
  return canonicalEncoding(lengths)
}

export interface HybridUintEncoding {
  readonly splitExponent: number
  readonly msbInToken: number
  readonly lsbInToken: number
}

const encodeHybridUintPacked = (value: number, config: Readonly<HybridUintEncoding>): number => {
  validateHybridValue(value)
  const splitToken = 2 ** config.splitExponent
  if (value < splitToken) return value
  const lowMask = 2 ** config.lsbInToken - 1
  const low = value & lowMask
  const shifted = Math.floor(value / 2 ** config.lsbInToken)
  const extraBitCount = Math.floor(Math.log2(shifted)) - config.msbInToken
  const high = Math.floor(shifted / 2 ** extraBitCount)
  const tokenPayload =
    (extraBitCount - (config.splitExponent - config.msbInToken - config.lsbInToken)) *
      2 ** (config.msbInToken + config.lsbInToken) +
    (high - 2 ** config.msbInToken) * 2 ** config.lsbInToken +
    low
  const token = splitToken + tokenPayload
  const extraBits = shifted - high * 2 ** extraBitCount
  return token + extraBitCount * 256 + extraBits * 8_192
}

export const hybridTokenForEncoding = (
  value: number,
  config: Readonly<HybridUintEncoding>,
): number => encodeHybridUintPacked(value, config) & 255

const writeVarUint8 = (writer: JpegXlBitWriter, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw invalidInput('JPEG XL ANS histogram integer is invalid')
  }
  if (value === 0) {
    writer.writeBits(0, 1)
    return
  }
  writer.writeBits(1, 1)
  if (value === 1) {
    writer.writeBits(0, 3)
    return
  }
  const bits = Math.floor(Math.log2(value))
  writer.writeBits(bits, 3)
  writer.writeBits(value - 2 ** bits, bits)
}

const histogramLogCodes = new Map<
  number,
  Readonly<{ readonly key: number; readonly bits: number }>
>([
  [-1, Object.freeze({ key: 17, bits: 5 })],
  [0, Object.freeze({ key: 11, bits: 4 })],
  [1, Object.freeze({ key: 15, bits: 4 })],
  [2, Object.freeze({ key: 3, bits: 4 })],
  [3, Object.freeze({ key: 9, bits: 4 })],
  [4, Object.freeze({ key: 7, bits: 4 })],
  [5, Object.freeze({ key: 4, bits: 3 })],
  [6, Object.freeze({ key: 2, bits: 3 })],
  [7, Object.freeze({ key: 5, bits: 3 })],
  [8, Object.freeze({ key: 6, bits: 3 })],
  [9, Object.freeze({ key: 0, bits: 3 })],
  [10, Object.freeze({ key: 33, bits: 6 })],
  [11, Object.freeze({ key: 1, bits: 7 })],
])

const normalizedAnsFrequencies = (counts: Uint32Array): Uint16Array => {
  let maximumSymbol = counts.length - 1
  while (maximumSymbol > 0 && counts[maximumSymbol] === 0) maximumSymbol -= 1
  const output = new Uint16Array(Math.max(3, maximumSymbol + 1))
  const present: number[] = []
  let total = 0
  let omitted = 0
  for (let symbol = 0; symbol <= maximumSymbol; symbol += 1) {
    const count = counts[symbol] ?? 0
    if (count === 0) continue
    present.push(symbol)
    total += count
    if (count > (counts[omitted] ?? 0)) omitted = symbol
  }
  if (present.length === 0) {
    output[0] = 4_096
    return output
  }
  if (present.length === 1) {
    output[present[0] ?? 0] = 4_096
    return output
  }
  if (present.length === 2) {
    const first = present[0] ?? 0
    const frequency = Math.max(
      1,
      Math.min(4_095, Math.round(((counts[first] ?? 0) * 4_096) / total)),
    )
    output[first] = frequency
    output[present[1] ?? 0] = 4_096 - frequency
    return output
  }
  let assigned = 0
  for (const symbol of present) {
    const frequency = Math.max(1, Math.floor(((counts[symbol] ?? 0) * 4_096) / total))
    output[symbol] = frequency
    assigned += frequency
  }
  if (assigned > 4_096) {
    let excess = assigned - 4_096
    for (const symbol of present) {
      if (symbol === omitted || excess === 0) continue
      const available = Math.max(0, (output[symbol] ?? 0) - 1)
      const reduction = Math.min(available, excess)
      output[symbol] = (output[symbol] ?? 0) - reduction
      excess -= reduction
    }
    if (excess !== 0) throw invalidInput('JPEG XL ANS histogram cannot be normalized')
  } else {
    output[omitted] = (output[omitted] ?? 0) + 4_096 - assigned
  }
  for (const symbol of present) {
    if (symbol === omitted || (output[symbol] ?? 0) < 2_048) continue
    const excess = (output[symbol] ?? 0) - 2_047
    output[symbol] = 2_047
    output[omitted] = (output[omitted] ?? 0) + excess
  }
  return output
}

const writeAnsHistogram = (writer: JpegXlBitWriter, frequencies: Uint16Array): void => {
  const symbols: number[] = []
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    if ((frequencies[symbol] ?? 0) !== 0) symbols.push(symbol)
  }
  if (symbols.length <= 2) {
    writer.writeBits(1, 1)
    writer.writeBits(symbols.length - 1, 1)
    for (const symbol of symbols) writeVarUint8(writer, symbol)
    if (symbols.length === 2) writer.writeBits(frequencies[symbols[0] ?? 0] ?? 0, 12)
    return
  }
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(1, 1)
  writer.writeBits(1, 1)
  writer.writeBits(1, 1)
  writer.writeBits(6, 3)
  writeVarUint8(writer, frequencies.length - 3)
  let omitted = 0
  for (let symbol = 1; symbol < frequencies.length; symbol += 1) {
    if ((frequencies[symbol] ?? 0) > (frequencies[omitted] ?? 0)) omitted = symbol
  }
  const logCounts = new Int8Array(frequencies.length)
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    const frequency = frequencies[symbol] ?? 0
    const logCount =
      symbol === omitted ? 11 : frequency === 0 ? -1 : Math.floor(Math.log2(frequency))
    logCounts[symbol] = logCount
    const code = histogramLogCodes.get(logCount)
    if (!code) throw invalidInput('JPEG XL ANS log-count code is unavailable')
    writer.writeBits(code.key, code.bits)
  }
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    const frequency = frequencies[symbol] ?? 0
    const logCount = logCounts[symbol] ?? -1
    if (symbol !== omitted && frequency > 1) {
      const precision = Math.max(0, Math.min(logCount, 13 - ((12 - logCount) >>> 1)))
      writer.writeBits(
        Math.floor((frequency - 2 ** logCount) / 2 ** (logCount - precision)),
        precision,
      )
    }
  }
}

interface AnsHistogramEncoding {
  readonly frequencies: Uint16Array
  readonly residuals: readonly (Uint16Array | undefined)[]
}

const ansHistogramEncoding = (frequencies: Uint16Array): AnsHistogramEncoding => {
  const tableSize = 256
  const entrySize = 16
  const cutoff = new Uint16Array(tableSize)
  const rightSymbol = new Uint16Array(tableSize)
  const rightOffset = new Int32Array(tableSize)
  const singleSymbol = frequencies.indexOf(4_096)
  if (singleSymbol < 0) {
    const underfull: number[] = []
    const overfull: number[] = []
    for (let index = 0; index < tableSize; index += 1) {
      cutoff[index] = frequencies[index] ?? 0
      if ((cutoff[index] ?? 0) > entrySize) overfull.push(index)
      else if ((cutoff[index] ?? 0) < entrySize) underfull.push(index)
    }
    while (overfull.length > 0) {
      const over = overfull.pop()
      const under = underfull.pop()
      if (over === undefined || under === undefined) {
        throw invalidInput('JPEG XL ANS alias table is invalid')
      }
      const missing = entrySize - (cutoff[under] ?? 0)
      cutoff[over] = (cutoff[over] ?? 0) - missing
      rightSymbol[under] = over
      rightOffset[under] = (cutoff[over] ?? 0) - (cutoff[under] ?? 0)
      if ((cutoff[over] ?? 0) < entrySize) underfull.push(over)
      else if ((cutoff[over] ?? 0) > entrySize) overfull.push(over)
    }
  }
  const residuals: (Uint16Array | undefined)[] = Array.from(frequencies, (frequency) =>
    frequency === 0 ? undefined : new Uint16Array(frequency),
  )
  for (let residual = 0; residual < 4_096; residual += 1) {
    const index = residual >>> 4
    const position = residual & 15
    let symbol: number
    let offset: number
    if (singleSymbol >= 0) {
      symbol = singleSymbol
      offset = residual
    } else if (position >= (cutoff[index] ?? 0)) {
      symbol = rightSymbol[index] ?? 0
      offset = position + (rightOffset[index] ?? 0)
    } else {
      symbol = index
      offset = position
    }
    const table = residuals[symbol]
    if (!table || offset < 0 || offset >= table.length) {
      throw invalidInput('JPEG XL ANS encoding table is invalid')
    }
    table[offset] = residual
  }
  return Object.freeze({ frequencies, residuals: Object.freeze(residuals) })
}

export interface AnsEncoding {
  readonly contextMap: Uint8Array
  readonly config: HybridUintEncoding
  readonly histograms: readonly AnsHistogramEncoding[]
}

export const writeAnsCode = (
  writer: JpegXlBitWriter,
  contextMap: Uint8Array,
  frequencies: readonly Uint32Array[],
  config: Readonly<HybridUintEncoding>,
): AnsEncoding => {
  if (
    contextMap.length < 1 ||
    frequencies.length < 1 ||
    frequencies.length > 256 ||
    (contextMap.length === 1 && frequencies.length !== 1)
  ) {
    throw invalidInput('JPEG XL ANS encoding shape is invalid')
  }
  writer.writeBits(0, 1)
  if (contextMap.length === 1) {
    if (contextMap[0] !== 0) throw invalidInput('JPEG XL single ANS context is invalid')
  } else if (frequencies.length <= 8) {
    const histogramBits = Math.ceil(Math.log2(frequencies.length))
    writer.writeBits(1, 1)
    writer.writeBits(histogramBits, 2)
    for (const histogram of contextMap) writer.writeBits(histogram, histogramBits)
  } else {
    writer.writeBits(0, 1)
    writer.writeBits(1, 1)
    const alphabet = Array.from({ length: 256 }, (_, index) => index)
    const encodedContextMap = Uint8Array.from(contextMap, (histogram) => {
      const position = alphabet.indexOf(histogram)
      if (position < 0) throw invalidInput('JPEG XL ANS context map is invalid')
      alphabet.splice(position, 1)
      alphabet.unshift(histogram)
      return position
    })
    const mapFrequencies = new Uint32Array(256)
    for (const histogram of encodedContextMap) {
      mapFrequencies[histogram] = (mapFrequencies[histogram] ?? 0) + 1
    }
    const mapEncoding = writePrefixCode(writer, 1, mapFrequencies)
    for (const histogram of encodedContextMap) writeHybridUint(writer, histogram, mapEncoding)
  }
  writer.writeBits(0, 1)
  writer.writeBits(3, 2)
  for (let histogram = 0; histogram < frequencies.length; histogram += 1) {
    writer.writeBits(config.splitExponent, 4)
    writer.writeBits(config.msbInToken, Math.ceil(Math.log2(config.splitExponent + 1)))
    writer.writeBits(
      config.lsbInToken,
      Math.ceil(Math.log2(config.splitExponent - config.msbInToken + 1)),
    )
  }
  const normalized = frequencies.map(normalizedAnsFrequencies)
  for (const histogram of normalized) writeAnsHistogram(writer, histogram)
  return Object.freeze({
    contextMap,
    config: Object.freeze({ ...config }),
    histograms: Object.freeze(normalized.map(ansHistogramEncoding)),
  })
}

export const writeAnsValues = (
  writer: JpegXlBitWriter,
  values: Uint32Array,
  contexts: Uint16Array,
  count: number,
  encoding: Readonly<AnsEncoding>,
): void => {
  if (count < 1 || count > values.length || count > contexts.length) {
    throw invalidInput('JPEG XL ANS token count is invalid')
  }
  const renormalizedWords = new Int32Array(count)
  renormalizedWords.fill(-1)
  const packedValues = new Uint32Array(count)
  for (let index = 0; index < count; index += 1) {
    packedValues[index] = encodeHybridUintPacked(values[index] ?? 0, encoding.config)
  }
  let state = 0x13_0000
  for (let index = count - 1; index >= 0; index -= 1) {
    const context = contexts[index]
    const histogramIndex = context === undefined ? undefined : encoding.contextMap[context]
    const histogram = histogramIndex === undefined ? undefined : encoding.histograms[histogramIndex]
    const value = values[index]
    if (!histogram || value === undefined) throw invalidInput('JPEG XL ANS token is incomplete')
    const token = (packedValues[index] ?? 0) & 255
    const frequency = histogram.frequencies[token] ?? 0
    const residuals = histogram.residuals[token]
    if (frequency === 0 || !residuals) throw invalidInput('JPEG XL ANS token has zero frequency')
    if (state >= frequency * 1_048_576) {
      renormalizedWords[index] = state & 0xffff
      state = Math.floor(state / 65_536)
    }
    const offset = state % frequency
    const residual = residuals[offset]
    if (residual === undefined) throw invalidInput('JPEG XL ANS residual is missing')
    state = 4_096 * Math.floor(state / frequency) + residual
  }
  writer.writeBits(state >>> 0, 32)
  for (let index = 0; index < count; index += 1) {
    const word = renormalizedWords[index]
    if (word !== undefined && word >= 0) writer.writeBits(word, 16)
    const value = values[index]
    if (value === undefined) throw invalidInput('JPEG XL ANS value is missing')
    const packed = packedValues[index] ?? 0
    writer.writeBits(packed >>> 13, (packed >>> 8) & 31)
  }
}

const visitModularResiduals = (
  pixels: Uint8Array,
  imageWidth: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
  visit: (packedResidual: number) => void,
): void => {
  const highDepth = format.endsWith('16')
  const channels = format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3
  const bytesPerSample = highDepth ? 2 : 1
  const bytesPerPixel = channels * bytesPerSample
  for (let channel = 0; channel < channels; channel += 1) {
    for (let y = 0; y < height; y += 1) {
      let left = 0
      for (let x = 0; x < width; x += 1) {
        const position =
          ((originY + y) * imageWidth + originX + x) * bytesPerPixel + channel * bytesPerSample
        const sample = highDepth
          ? (pixels[position] ?? 0) * 256 + (pixels[position + 1] ?? 0)
          : (pixels[position] ?? 0)
        if (x === 0 && y > 0) {
          const top =
            ((originY + y - 1) * imageWidth + originX + x) * bytesPerPixel +
            channel * bytesPerSample
          left = highDepth ? (pixels[top] ?? 0) * 256 + (pixels[top + 1] ?? 0) : (pixels[top] ?? 0)
        }
        visit(packSigned(sample - left))
        left = sample
      }
    }
  }
}

const modularFrequencies = (
  pixels: Uint8Array,
  imageWidth: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
): Uint32Array => {
  const frequencies = new Uint32Array(512)
  visitModularResiduals(
    pixels,
    imageWidth,
    originX,
    originY,
    width,
    height,
    format,
    (packedResidual) => {
      const token = hybridToken(packedResidual)
      frequencies[token] = (frequencies[token] ?? 0) + 1
    },
  )
  return frequencies
}

const writeModularPixels = (
  writer: JpegXlBitWriter,
  pixels: Uint8Array,
  imageWidth: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
  encoding: Readonly<PrefixEncoding>,
): void =>
  visitModularResiduals(
    pixels,
    imageWidth,
    originX,
    originY,
    width,
    height,
    format,
    (packedResidual) => writeHybridUint(writer, packedResidual, encoding),
  )

export const writeModularHeader = (writer: JpegXlBitWriter, useGlobalTree: boolean): void => {
  writer.writeBits(useGlobalTree ? 1 : 0, 1)
  writer.writeBits(1, 1)
  writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { bits: 4, offset: 2 }, { bits: 8, offset: 18 }])
}

const encodeSingleGroupSection = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
): Uint8Array => {
  const writer = new JpegXlBitWriter()
  writer.writeBits(1, 1)
  writer.writeBits(0, 1)
  writeModularHeader(writer, false)
  writeModularTree(writer)
  const encoding = writePrefixCode(
    writer,
    1,
    modularFrequencies(pixels, width, 0, 0, width, height, format),
  )
  writeModularPixels(writer, pixels, width, 0, 0, width, height, format, encoding)
  return writer.finish()
}

const encodeGlobalSection = (
  frequencies: Uint32Array,
): Readonly<{ readonly section: Uint8Array; readonly encoding: PrefixEncoding }> => {
  const writer = new JpegXlBitWriter()
  writer.writeBits(1, 1)
  writer.writeBits(1, 1)
  writeModularTree(writer)
  const encoding = writePrefixCode(writer, 1, frequencies)
  writeModularHeader(writer, true)
  return Object.freeze({ section: writer.finish(), encoding })
}

const encodeGroupSection = (
  pixels: Uint8Array,
  imageWidth: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
  encoding: Readonly<PrefixEncoding>,
): Uint8Array => {
  const writer = new JpegXlBitWriter()
  writeModularHeader(writer, true)
  writeModularPixels(writer, pixels, imageWidth, originX, originY, width, height, format, encoding)
  return writer.finish()
}

const encodeFrameSections = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
): readonly Uint8Array[] => {
  const groupDimension = 1_024
  const groupsAcross = Math.ceil(width / groupDimension)
  const groupsDown = Math.ceil(height / groupDimension)
  const groupCount = groupsAcross * groupsDown
  if (groupCount === 1) {
    return Object.freeze([encodeSingleGroupSection(pixels, width, height, format)])
  }
  const dcGroupDimension = groupDimension * 8
  const dcGroupCount = Math.ceil(width / dcGroupDimension) * Math.ceil(height / dcGroupDimension)
  const frequencies = new Uint32Array(512)
  for (let groupY = 0; groupY < groupsDown; groupY += 1) {
    for (let groupX = 0; groupX < groupsAcross; groupX += 1) {
      const originX = groupX * groupDimension
      const originY = groupY * groupDimension
      const groupFrequencies = modularFrequencies(
        pixels,
        width,
        originX,
        originY,
        Math.min(groupDimension, width - originX),
        Math.min(groupDimension, height - originY),
        format,
      )
      for (let token = 0; token < frequencies.length; token += 1) {
        frequencies[token] = (frequencies[token] ?? 0) + (groupFrequencies[token] ?? 0)
      }
    }
  }
  const global = encodeGlobalSection(frequencies)
  const sections: Uint8Array[] = [global.section, new Uint8Array(0)]
  for (let index = 0; index < dcGroupCount; index += 1) sections.push(new Uint8Array(0))
  for (let groupY = 0; groupY < groupsDown; groupY += 1) {
    for (let groupX = 0; groupX < groupsAcross; groupX += 1) {
      const originX = groupX * groupDimension
      const originY = groupY * groupDimension
      sections.push(
        encodeGroupSection(
          pixels,
          width,
          originX,
          originY,
          Math.min(groupDimension, width - originX),
          Math.min(groupDimension, height - originY),
          format,
          global.encoding,
        ),
      )
    }
  }
  if (sections.length > 65_536) throw limitExceeded('JPEG XL output has too many sections')
  return Object.freeze(sections)
}

const concatenate = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0)
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

const ascii = (value: string): Uint8Array =>
  Uint8Array.from(value, (character) => character.charCodeAt(0))

const uint32 = (value: number): Uint8Array =>
  Uint8Array.of((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255)

const box = (type: string, payload: Uint8Array): Uint8Array => {
  const size = payload.byteLength + 8
  if (size > 0xffff_ffff) throw limitExceeded(`JPEG XL ${type} box exceeds 32-bit size`)
  return concatenate([uint32(size), ascii(type), payload])
}

const wrapContainer = (codestream: Uint8Array): Uint8Array =>
  concatenate([
    Uint8Array.of(0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a),
    box('ftyp', concatenate([ascii('jxl '), uint32(0), ascii('jxl ')])),
    box('jxlc', codestream),
  ])

const encodeCodestream = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
): Uint8Array => {
  const sections = encodeFrameSections(pixels, width, height, format)
  const writer = new JpegXlBitWriter()
  const highDepth = format.endsWith('16')
  const hasAlpha = format.startsWith('rgba')
  const grayscale = format.startsWith('gray')

  writer.writeBits(0xff, 8)
  writer.writeBits(0x0a, 8)
  writer.writeBits(0, 1)
  writeDimension(writer, height)
  writer.writeBits(0, 3)
  writeDimension(writer, width)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writeBitDepth(writer, highDepth ? 16 : 8)
  writer.writeBits(1, 1)
  writeU32(writer, hasAlpha ? 1 : 0, [
    { value: 0 },
    { value: 1 },
    { bits: 4, offset: 2 },
    { bits: 12, offset: 1 },
  ])
  if (hasAlpha) {
    if (highDepth) {
      writer.writeBits(0, 1)
      writeU32(writer, 0, [
        { value: 0 },
        { value: 1 },
        { bits: 4, offset: 2 },
        { bits: 6, offset: 18 },
      ])
      writeBitDepth(writer, 16)
      writeU32(writer, 0, [{ value: 0 }, { value: 3 }, { value: 4 }, { bits: 3, offset: 1 }])
      writeName(writer)
      writer.writeBits(0, 1)
    } else {
      writer.writeBits(1, 1)
    }
  }
  writer.writeBits(0, 1)
  if (grayscale) {
    writer.writeBits(0, 1)
    writer.writeBits(0, 1)
    writeU32(writer, 1, [
      { value: 0 },
      { value: 1 },
      { bits: 4, offset: 2 },
      { bits: 6, offset: 18 },
    ])
    writeU32(writer, 1, [
      { value: 0 },
      { value: 1 },
      { bits: 4, offset: 2 },
      { bits: 6, offset: 18 },
    ])
    writer.writeBits(0, 1)
    writeU32(writer, 13, [
      { value: 0 },
      { value: 1 },
      { bits: 4, offset: 2 },
      { bits: 6, offset: 18 },
    ])
    writeU32(writer, 1, [
      { value: 0 },
      { value: 1 },
      { bits: 4, offset: 2 },
      { bits: 6, offset: 18 },
    ])
  } else {
    writer.writeBits(1, 1)
  }
  writeZeroU64(writer)
  writer.writeBits(1, 1)
  writer.alignToByte()

  writer.writeBits(0, 1)
  writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }])
  writer.writeBits(1, 1)
  writeZeroU64(writer)
  writer.writeBits(0, 1)
  writeU32(writer, 1, [{ value: 1 }, { value: 2 }, { value: 4 }, { value: 8 }])
  if (hasAlpha) {
    writeU32(writer, 1, [{ value: 1 }, { value: 2 }, { value: 4 }, { value: 8 }])
  }
  writer.writeBits(3, 2)
  writeU32(writer, 1, [{ value: 1 }, { value: 2 }, { value: 3 }, { bits: 3, offset: 4 }])
  writer.writeBits(0, 1)
  writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { bits: 2, offset: 3 }])
  if (hasAlpha) {
    writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { bits: 2, offset: 3 }])
  }
  writer.writeBits(1, 1)
  writeName(writer)
  writer.writeBits(0, 1)
  writer.writeBits(0, 1)
  writer.writeBits(0, 2)
  writeZeroU64(writer)
  writeZeroU64(writer)
  writer.writeBits(0, 1)
  writer.alignToByte()
  for (const section of sections) {
    writeU32(writer, section.byteLength, [
      { bits: 10, offset: 0 },
      { bits: 14, offset: 1_024 },
      { bits: 22, offset: 17_408 },
      { bits: 30, offset: 4_211_712 },
    ])
  }
  writer.alignToByte()
  return concatenate([writer.finish(), ...sections])
}

const supportedFormat = (
  format: PixelFormat,
): format is 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16' =>
  format === 'gray8' ||
  format === 'gray16' ||
  format === 'rgb8' ||
  format === 'rgb16' ||
  format === 'rgba8' ||
  format === 'rgba16'

const readOptions = (value: unknown): Readonly<Required<JpegXlEncodeOptions>> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidInput('JPEG XL encoder options must be an object')
  }
  const options = value as Readonly<Record<string, unknown>>
  for (const key of Object.keys(options)) {
    if (key !== 'mode' && key !== 'effort' && key !== 'container') {
      throw invalidInput(`Unknown JPEG XL encoder option: ${key}`)
    }
  }
  if (options.mode !== undefined && options.mode !== 'lossless') {
    throw invalidInput('JPEG XL encoder mode must be lossless')
  }
  if (options.effort !== undefined && options.effort !== 1) {
    throw invalidInput('JPEG XL encoder effort must be 1')
  }
  if (options.container !== undefined && typeof options.container !== 'boolean') {
    throw invalidInput('JPEG XL encoder container must be a boolean')
  }
  return Object.freeze({ mode: 'lossless', effort: 1, container: options.container ?? true })
}

export const acceptsJpegXlColorSemantics = (semantics: PixelColorSemantics): boolean =>
  (semantics.family === 'gray' || semantics.family === 'rgb') &&
  semantics.primaries === 'srgb' &&
  semantics.transfer.kind === 'srgb' &&
  semantics.matrix === 'identity' &&
  semantics.range === 'full' &&
  (semantics.alpha === 'none' || semantics.alpha === 'straight') &&
  (semantics.provenance === 'assumed-default' ||
    semantics.provenance === 'container-signaled' ||
    semantics.provenance === 'decoder-converted') &&
  semantics.renderingIntent === 'relative' &&
  semantics.icc === undefined

const validateColorSemantics = (request: EncodeRequest): void => {
  const semantics = request.colorSemantics
  if (!semantics) {
    throw unsupportedOperation('JPEG XL encoding requires explicit sRGB pixel color semantics')
  }
  const grayscale = request.pixelFormat.startsWith('gray')
  const alpha = request.pixelFormat.startsWith('rgba')
  if (
    !acceptsJpegXlColorSemantics(semantics) ||
    semantics.family !== (grayscale ? 'gray' : 'rgb') ||
    semantics.alpha !== (alpha ? 'straight' : 'none')
  ) {
    throw unsupportedOperation(
      'JPEG XL encoding supports full-range sRGB or sRGB grayscale pixels with relative rendering intent and straight alpha only',
    )
  }
}

class JpegXlModularEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #request: EncodeRequest
  readonly #options: Readonly<Required<JpegXlEncodeOptions>>
  #pixels: Uint8Array | undefined
  readonly #rowBytes: number
  #nextY = 0
  #state: 'open' | 'finishing' | 'finished' | 'aborted' = 'open'

  constructor(
    sink: ImageSink,
    request: EncodeRequest,
    options: Readonly<Required<JpegXlEncodeOptions>>,
  ) {
    this.#sink = sink
    this.#request = request
    this.#options = options
    const channels = request.pixelFormat.startsWith('gray')
      ? 1
      : request.pixelFormat.startsWith('rgba')
        ? 4
        : 3
    const bytesPerSample = request.pixelFormat.endsWith('16') ? 2 : 1
    this.#rowBytes = request.width * channels * bytesPerSample
    this.#pixels = new Uint8Array(this.#rowBytes * request.height)
  }

  async write(block: PixelBlock): Promise<void> {
    if (this.#state !== 'open') throw invalidInput('Cannot write to a closed JPEG XL encoder')
    try {
      throwIfAborted(this.#request.signal)
      if (
        block.x !== 0 ||
        block.y !== this.#nextY ||
        block.width !== this.#request.width ||
        block.height < 1 ||
        block.y + block.height > this.#request.height ||
        block.format !== this.#request.pixelFormat ||
        block.stride < this.#rowBytes ||
        block.data.byteLength < block.stride * (block.height - 1) + this.#rowBytes
      ) {
        throw invalidInput('JPEG XL encoder requires ordered, full-width pixel blocks')
      }
      const pixels = this.#pixels
      if (!pixels) throw invalidInput('JPEG XL encoder pixel storage is unavailable')
      for (let row = 0; row < block.height; row += 1) {
        const source = row * block.stride
        pixels.set(
          block.data.subarray(source, source + this.#rowBytes),
          (this.#nextY + row) * this.#rowBytes,
        )
      }
      this.#nextY += block.height
    } catch (error) {
      await this.abort(error)
      throw error
    }
  }

  async finish(): Promise<void> {
    if (this.#state !== 'open') throw invalidInput('JPEG XL encoder is already closed')
    this.#state = 'finishing'
    try {
      if (this.#nextY !== this.#request.height) {
        throw truncatedInput(
          `JPEG XL encoder received ${this.#nextY} of ${this.#request.height} rows`,
        )
      }
      throwIfAborted(this.#request.signal)
      if (!supportedFormat(this.#request.pixelFormat)) {
        throw unsupportedOperation(
          `JPEG XL encoding does not support ${this.#request.pixelFormat} pixels`,
        )
      }
      const pixels = this.#pixels
      if (!pixels) throw invalidInput('JPEG XL encoder pixel storage is unavailable')
      const codestream = encodeCodestream(
        pixels,
        this.#request.width,
        this.#request.height,
        this.#request.pixelFormat,
      )
      const output = this.#options.container ? wrapContainer(codestream) : codestream
      const jpegXlLimits = resolveJpegXlLimits()
      if (output.byteLength > jpegXlLimits.maxCodestreamBytes) {
        throw limitExceeded(
          `JPEG XL output requires ${output.byteLength} bytes; maxCodestreamBytes is ${jpegXlLimits.maxCodestreamBytes}`,
        )
      }
      await this.#sink.write(output)
      this.#pixels = undefined
      this.#state = 'finished'
    } catch (error) {
      await this.abort(error)
      throw error
    }
  }

  async abort(reason: unknown): Promise<void> {
    if (this.#state === 'aborted' || this.#state === 'finished') return
    this.#state = 'aborted'
    this.#pixels = undefined
    try {
      await this.#sink.abort(reason)
    } catch {
      // Preserve the failure that caused the encoder to abort.
    }
  }
}

export const createJpegXlModularEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
): Promise<ImageEncoder> => {
  if (!supportedFormat(request.pixelFormat)) {
    throw unsupportedOperation(`JPEG XL encoding does not support ${request.pixelFormat} pixels`)
  }
  validateColorSemantics(request)
  if (request.metadata?.exif || request.metadata?.icc || request.metadata?.xmp) {
    throw unsupportedOperation('JPEG XL metadata preservation is not supported by this encoder yet')
  }
  const limits = request.limits
  if (limits) validateImageDimensions(request.width, request.height, 1, limits)
  const channels = request.pixelFormat.startsWith('gray')
    ? 1
    : request.pixelFormat.startsWith('rgba')
      ? 4
      : 3
  const bytesPerSample = request.pixelFormat.endsWith('16') ? 2 : 1
  const workingBytes =
    BigInt(request.width) * BigInt(request.height) * BigInt(channels * bytesPerSample)
  if (limits && workingBytes > BigInt(limits.maxDecodedBytes)) {
    throw limitExceeded(
      `JPEG XL encoder pixels require ${workingBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
    )
  }
  return new JpegXlModularEncoder(sink, request, readOptions(request.options))
}
