import { throwIfAborted } from '../abort.ts'
import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import type { PixelColorSemantics } from '../color.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { defaultJpegXlWeightedPredictor, JpegXlWeightedPredictor } from './jpegxl-decode.ts'
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

type JpegXlSampleBitDepth = 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16
type JpegXlLosslessEffort = 1 | 3 | 5 | 7

interface ResolvedJpegXlEncodeOptions {
  readonly mode: 'lossless'
  readonly effort: JpegXlLosslessEffort
  readonly container: boolean
  readonly sampleBitDepth: JpegXlSampleBitDepth
  readonly alphaBitDepth?: JpegXlSampleBitDepth
}

const writeBitDepth = (writer: JpegXlBitWriter, bitDepth: JpegXlSampleBitDepth): void => {
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
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_048_695) {
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
  [12, Object.freeze({ key: 65, bits: 7 })],
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
    const omittedAvailable = Math.max(0, (output[omitted] ?? 0) - 1)
    const omittedReduction = Math.min(omittedAvailable, excess)
    output[omitted] = (output[omitted] ?? 0) - omittedReduction
    excess -= omittedReduction
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

const writeAnsHistogram = (writer: JpegXlBitWriter, frequencies: Uint16Array): Uint16Array => {
  const symbols: number[] = []
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    if ((frequencies[symbol] ?? 0) !== 0) symbols.push(symbol)
  }
  if (symbols.length <= 2) {
    writer.writeBits(1, 1)
    writer.writeBits(symbols.length - 1, 1)
    for (const symbol of symbols) writeVarUint8(writer, symbol)
    if (symbols.length === 2) writer.writeBits(frequencies[symbols[0] ?? 0] ?? 0, 12)
    return frequencies
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
  const serialized = new Uint16Array(frequencies.length)
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    const frequency = frequencies[symbol] ?? 0
    const logCount =
      symbol === omitted ? 11 : frequency === 0 ? -1 : Math.floor(Math.log2(frequency))
    logCounts[symbol] = logCount
  }
  for (let symbol = 0; symbol < frequencies.length; ) {
    const logCount = logCounts[symbol] ?? -1
    if (
      logCount === -1 &&
      symbol > 0 &&
      symbol !== omitted + 1 &&
      (logCounts[symbol - 1] ?? 0) === -1
    ) {
      let repeated = 1
      while (
        repeated < 259 &&
        symbol + repeated < frequencies.length &&
        (logCounts[symbol + repeated] ?? 0) === -1
      ) {
        repeated += 1
      }
      if (repeated >= 4) {
        const repeatCode = histogramLogCodes.get(12)
        if (!repeatCode) throw invalidInput('JPEG XL ANS repeat code is unavailable')
        writer.writeBits(repeatCode.key, repeatCode.bits)
        writeVarUint8(writer, repeated - 4)
        symbol += repeated
        continue
      }
    }
    const code = histogramLogCodes.get(logCount)
    if (!code) throw invalidInput('JPEG XL ANS log-count code is unavailable')
    writer.writeBits(code.key, code.bits)
    symbol += 1
  }
  for (let symbol = 0; symbol < frequencies.length; symbol += 1) {
    const frequency = frequencies[symbol] ?? 0
    const logCount = logCounts[symbol] ?? -1
    if (symbol !== omitted && frequency > 1) {
      const precision = Math.max(0, Math.min(logCount, 13 - ((12 - logCount) >>> 1)))
      const mantissa = Math.floor((frequency - 2 ** logCount) / 2 ** (logCount - precision))
      writer.writeBits(mantissa, precision)
      serialized[symbol] = 2 ** logCount + mantissa * 2 ** (logCount - precision)
    } else if (symbol !== omitted && frequency === 1) {
      serialized[symbol] = 1
    }
  }
  const assigned = serialized.reduce((sum, frequency) => sum + frequency, 0)
  serialized[omitted] = 4_096 - assigned
  return serialized
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
      rightOffset[under] = cutoff[over] ?? 0
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
      offset = position + (rightOffset[index] ?? 0) - (cutoff[index] ?? 0)
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
  lz77 = false,
): AnsEncoding => {
  if (
    contextMap.length < 1 ||
    frequencies.length < 1 ||
    frequencies.length > 256 ||
    (contextMap.length === 1 && frequencies.length !== 1) ||
    (lz77 && contextMap.length < 2)
  ) {
    throw invalidInput('JPEG XL ANS encoding shape is invalid')
  }
  writer.writeBits(lz77 ? 1 : 0, 1)
  if (lz77) {
    writeU32(writer, 224, [
      { value: 224 },
      { value: 512 },
      { value: 4_096 },
      { bits: 15, offset: 8 },
    ])
    writeU32(writer, 3, [
      { value: 3 },
      { value: 4 },
      { bits: 2, offset: 5 },
      { bits: 8, offset: 9 },
    ])
    writer.writeBits(0, 4)
  }
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
    if (config.splitExponent !== 8) {
      writer.writeBits(config.msbInToken, Math.ceil(Math.log2(config.splitExponent + 1)))
      writer.writeBits(
        config.lsbInToken,
        Math.ceil(Math.log2(config.splitExponent - config.msbInToken + 1)),
      )
    }
  }
  const normalized = frequencies.map(normalizedAnsFrequencies)
  const serialized = normalized.map((histogram) => writeAnsHistogram(writer, histogram))
  return Object.freeze({
    contextMap,
    config: Object.freeze({ ...config }),
    histograms: Object.freeze(serialized.map(ansHistogramEncoding)),
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
  const packedValues = new Uint32Array(count)
  for (let index = 0; index < count; index += 1) {
    packedValues[index] = encodeHybridUintPacked(values[index] ?? 0, encoding.config)
  }
  writeAnsPackedValues(writer, packedValues, contexts, count, encoding)
}

const writeAnsPackedValues = (
  writer: JpegXlBitWriter,
  packedValues: Uint32Array,
  contexts: Uint16Array,
  count: number,
  encoding: Readonly<AnsEncoding>,
): void => {
  const renormalizedWords = new Int32Array(count)
  renormalizedWords.fill(-1)
  let state = 0x13_0000
  for (let index = count - 1; index >= 0; index -= 1) {
    const context = contexts[index]
    const histogramIndex = context === undefined ? undefined : encoding.contextMap[context]
    const histogram = histogramIndex === undefined ? undefined : encoding.histograms[histogramIndex]
    if (!histogram) throw invalidInput('JPEG XL ANS token is incomplete')
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
    const packed = packedValues[index] ?? 0
    writer.writeBits(packed >>> 13, (packed >>> 8) & 31)
  }
}

type ModularPixelFormat = 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16'

const leftResidualFrequencies = (
  pixels: Uint8Array,
  imageWidth: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
  format: ModularPixelFormat,
): Uint32Array => {
  const frequencies = new Uint32Array(512)
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
        const token = hybridToken(packSigned(sample - left))
        frequencies[token] = (frequencies[token] ?? 0) + 1
        left = sample
      }
    }
  }
  return frequencies
}

const writeLeftResiduals = (
  writer: JpegXlBitWriter,
  pixels: Uint8Array,
  imageWidth: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
  format: ModularPixelFormat,
  encoding: Readonly<PrefixEncoding>,
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
        writeHybridUint(writer, packSigned(sample - left), encoding)
        left = sample
      }
    }
  }
}

interface ModularPlanes {
  readonly values: readonly Int32Array[]
  readonly widths: readonly number[]
  readonly heights: readonly number[]
}

interface ModularTransforms {
  readonly useRct: boolean
  readonly palette?: Readonly<{
    readonly channelCount: 3 | 4
    readonly colorCount: number
    readonly deltaCount: number
    readonly predictor: number
  }>
  readonly squeeze?: readonly ModularSqueezeParameter[]
}

interface ModularSqueezeParameter {
  readonly horizontal: boolean
  readonly inPlace: true
  readonly beginChannel: number
  readonly channelCount: number
}

interface PreparedModularPlanes {
  readonly planes: ModularPlanes
  readonly transforms: ModularTransforms
}

const createModularPlanes = (
  pixels: Uint8Array,
  imageWidth: number,
  originX: number,
  originY: number,
  width: number,
  height: number,
  format: ModularPixelFormat,
  useRct: boolean,
): ModularPlanes => {
  const highDepth = format.endsWith('16')
  const channels = format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3
  const bytesPerSample = highDepth ? 2 : 1
  const bytesPerPixel = channels * bytesPerSample
  const values = Array.from({ length: channels }, () => new Int32Array(width * height))
  for (let channel = 0; channel < channels; channel += 1) {
    const plane = values[channel]
    if (!plane) throw invalidInput('JPEG XL Modular plane is unavailable')
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const position =
          ((originY + y) * imageWidth + originX + x) * bytesPerPixel + channel * bytesPerSample
        plane[y * width + x] = highDepth
          ? (pixels[position] ?? 0) * 256 + (pixels[position + 1] ?? 0)
          : (pixels[position] ?? 0)
      }
    }
  }
  if (useRct) {
    const red = values[0]
    const green = values[1]
    const blue = values[2]
    if (!red || !green || !blue) throw invalidInput('JPEG XL RCT planes are unavailable')
    for (let position = 0; position < red.length; position += 1) {
      const redSample = red[position] ?? 0
      const greenSample = green[position] ?? 0
      const blueSample = blue[position] ?? 0
      const second = redSample - blueSample
      const base = blueSample + (second >> 1)
      const third = greenSample - base
      red[position] = base + (third >> 1)
      green[position] = second
      blue[position] = third
    }
  }
  return Object.freeze({
    values: Object.freeze(values),
    widths: Object.freeze(Array.from({ length: channels }, () => width)),
    heights: Object.freeze(Array.from({ length: channels }, () => height)),
  })
}

const palettePlanes = (
  planes: Readonly<ModularPlanes>,
  channelCount: 3 | 4,
): PreparedModularPlanes | undefined => {
  const first = planes.values[0]
  const width = planes.widths[0]
  const height = planes.heights[0]
  if (!first || width === undefined || height === undefined) return undefined
  const colors: number[][] = []
  const indices = new Int32Array(first.length)
  const lookup = new Map<string, number>()
  for (let position = 0; position < first.length; position += 1) {
    let key = ''
    const color: number[] = []
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = planes.values[channel]?.[position]
      if (sample === undefined) throw invalidInput('JPEG XL Palette source sample is missing')
      color.push(sample)
      key += `${sample},`
    }
    let index = lookup.get(key)
    if (index === undefined) {
      if (colors.length === 256) return undefined
      index = colors.length
      lookup.set(key, index)
      colors.push(color)
    }
    indices[position] = index
  }
  const palette = new Int32Array(colors.length * channelCount)
  for (let channel = 0; channel < channelCount; channel += 1) {
    for (let color = 0; color < colors.length; color += 1) {
      palette[channel * colors.length + color] = colors[color]?.[channel] ?? 0
    }
  }
  return Object.freeze({
    planes: Object.freeze({
      values: Object.freeze([palette, indices]),
      widths: Object.freeze([colors.length, width]),
      heights: Object.freeze([channelCount, height]),
    }),
    transforms: Object.freeze({
      useRct: false,
      palette: Object.freeze({
        channelCount,
        colorCount: colors.length,
        deltaCount: 0,
        predictor: 0,
      }),
    }),
  })
}

const smoothSqueezeTendency = (previous: number, average: number, next: number): number => {
  let difference = 0
  if (previous >= average && average >= next) {
    difference = Math.trunc((4 * previous - 3 * next - average + 6) / 12)
    if (difference - (difference & 1) > 2 * (previous - average)) {
      difference = 2 * (previous - average) + 1
    }
    if (difference + (difference & 1) > 2 * (average - next)) {
      difference = 2 * (average - next)
    }
  } else if (previous <= average && average <= next) {
    difference = Math.trunc((4 * previous - 3 * next - average - 6) / 12)
    if (difference + (difference & 1) < 2 * (previous - average)) {
      difference = 2 * (previous - average) - 1
    }
    if (difference - (difference & 1) < 2 * (average - next)) {
      difference = 2 * (average - next)
    }
  }
  return difference
}

const horizontalSqueeze = (
  input: Int32Array,
  width: number,
  height: number,
): readonly [Int32Array, Int32Array] => {
  const averageWidth = Math.ceil(width / 2)
  const residualWidth = Math.floor(width / 2)
  const average = new Int32Array(averageWidth * height)
  const residual = new Int32Array(residualWidth * height)
  for (let y = 0; y < height; y += 1) {
    const inputRow = y * width
    const averageRow = y * averageWidth
    const residualRow = y * residualWidth
    for (let x = 0; x < averageWidth; x += 1) {
      const first = input[inputRow + 2 * x] ?? 0
      if (x >= residualWidth) {
        average[averageRow + x] = first
      } else {
        const difference = first - (input[inputRow + 2 * x + 1] ?? 0)
        average[averageRow + x] = first - Math.trunc(difference / 2)
      }
    }
    for (let x = 0; x < residualWidth; x += 1) {
      const currentAverage = average[averageRow + x] ?? 0
      const nextAverage = average[averageRow + Math.min(x + 1, averageWidth - 1)] ?? 0
      const previous = x === 0 ? currentAverage : (input[inputRow + 2 * x - 1] ?? 0)
      residual[residualRow + x] =
        (input[inputRow + 2 * x] ?? 0) -
        (input[inputRow + 2 * x + 1] ?? 0) -
        smoothSqueezeTendency(previous, currentAverage, nextAverage)
    }
  }
  return Object.freeze([average, residual])
}

const verticalSqueeze = (
  input: Int32Array,
  width: number,
  height: number,
): readonly [Int32Array, Int32Array] => {
  const averageHeight = Math.ceil(height / 2)
  const residualHeight = Math.floor(height / 2)
  const average = new Int32Array(width * averageHeight)
  const residual = new Int32Array(width * residualHeight)
  for (let y = 0; y < averageHeight; y += 1) {
    const firstRow = 2 * y * width
    const averageRow = y * width
    if (y >= residualHeight) {
      average.set(input.subarray(firstRow, firstRow + width), averageRow)
    } else {
      const secondRow = firstRow + width
      for (let x = 0; x < width; x += 1) {
        const first = input[firstRow + x] ?? 0
        const difference = first - (input[secondRow + x] ?? 0)
        average[averageRow + x] = first - Math.trunc(difference / 2)
      }
    }
  }
  for (let y = 0; y < residualHeight; y += 1) {
    const firstRow = 2 * y * width
    const secondRow = firstRow + width
    const averageRow = y * width
    const nextAverageRow = Math.min(y + 1, averageHeight - 1) * width
    const previousRow = y === 0 ? -1 : firstRow - width
    for (let x = 0; x < width; x += 1) {
      const currentAverage = average[averageRow + x] ?? 0
      const nextAverage = average[nextAverageRow + x] ?? 0
      const previous = previousRow < 0 ? currentAverage : (input[previousRow + x] ?? 0)
      residual[y * width + x] =
        (input[firstRow + x] ?? 0) -
        (input[secondRow + x] ?? 0) -
        smoothSqueezeTendency(previous, currentAverage, nextAverage)
    }
  }
  return Object.freeze([average, residual])
}

const squeezePlanes = (
  input: Readonly<ModularPlanes>,
  originalChannelCount: number,
  effort: JpegXlLosslessEffort,
): Readonly<{
  readonly planes: ModularPlanes
  readonly parameters: readonly ModularSqueezeParameter[]
}> => {
  const values = [...input.values]
  const widths = [...input.widths]
  const heights = [...input.heights]
  const parameters: ModularSqueezeParameter[] = []
  const maximumSteps = effort === 5 ? 2 : 12
  for (let step = 0; step < maximumSteps; step += 1) {
    const width = widths[0] ?? 0
    const height = heights[0] ?? 0
    const horizontal = width >= height ? width > 8 : height <= 8 && width > 8
    if ((!horizontal && height <= 8) || (horizontal && width <= 8)) break
    const residualValues: Int32Array[] = []
    const residualWidths: number[] = []
    const residualHeights: number[] = []
    for (let channel = 0; channel < originalChannelCount; channel += 1) {
      const plane = values[channel]
      const planeWidth = widths[channel]
      const planeHeight = heights[channel]
      if (!plane || planeWidth === undefined || planeHeight === undefined) {
        throw invalidInput('JPEG XL Squeeze source plane is missing')
      }
      const [average, residual] = horizontal
        ? horizontalSqueeze(plane, planeWidth, planeHeight)
        : verticalSqueeze(plane, planeWidth, planeHeight)
      values[channel] = average
      widths[channel] = horizontal ? Math.ceil(planeWidth / 2) : planeWidth
      heights[channel] = horizontal ? planeHeight : Math.ceil(planeHeight / 2)
      residualValues.push(residual)
      residualWidths.push(horizontal ? Math.floor(planeWidth / 2) : planeWidth)
      residualHeights.push(horizontal ? planeHeight : Math.floor(planeHeight / 2))
    }
    values.splice(originalChannelCount, 0, ...residualValues)
    widths.splice(originalChannelCount, 0, ...residualWidths)
    heights.splice(originalChannelCount, 0, ...residualHeights)
    parameters.push(
      Object.freeze({
        horizontal,
        inPlace: true,
        beginChannel: 0,
        channelCount: originalChannelCount,
      }),
    )
  }
  return Object.freeze({
    planes: Object.freeze({
      values: Object.freeze(values),
      widths: Object.freeze(widths),
      heights: Object.freeze(heights),
    }),
    parameters: Object.freeze(parameters),
  })
}

const prepareSingleGroupPlanes = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: ModularPixelFormat,
  effort: JpegXlLosslessEffort,
): PreparedModularPlanes => {
  const channelCount = format.startsWith('rgba') ? 4 : format.startsWith('rgb') ? 3 : 1
  const raw = createModularPlanes(pixels, width, 0, 0, width, height, format, false)
  if (effort >= 5 && (channelCount === 3 || channelCount === 4)) {
    const palette = palettePlanes(raw, channelCount)
    if (palette) return palette
    const deltaPalette = deltaPalettePlanes(raw, channelCount)
    if (deltaPalette) return deltaPalette
  }
  if (effort >= 5 && width * height * channelCount <= 131_072) {
    const squeezed = squeezePlanes(raw, channelCount, effort)
    return Object.freeze({
      planes: squeezed.planes,
      transforms: Object.freeze({ useRct: false, squeeze: squeezed.parameters }),
    })
  }
  let useRct = channelCount >= 3
  if (effort >= 3 && useRct) {
    const red = raw.values[0]
    const green = raw.values[1]
    const blue = raw.values[2]
    if (!red || !green || !blue) throw invalidInput('JPEG XL correlation planes are missing')
    const step = Math.max(1, Math.floor(red.length / 4_096))
    let difference = 0
    let samples = 0
    for (let position = 0; position < red.length; position += step) {
      difference +=
        Math.abs((red[position] ?? 0) - (green[position] ?? 0)) +
        Math.abs((green[position] ?? 0) - (blue[position] ?? 0))
      samples += 1
    }
    const sampleScale = format.endsWith('16') ? 257 : 1
    useRct = difference / Math.max(1, samples) < 128 * sampleScale
  }
  const transformed = useRct
    ? createModularPlanes(pixels, width, 0, 0, width, height, format, true)
    : raw
  return Object.freeze({
    planes: transformed,
    transforms: Object.freeze({ useRct }),
  })
}

const fixedPrediction = (
  predictor: number,
  left: number,
  top: number,
  topTop: number,
  topLeft: number,
  topRight: number,
  topRightRight: number,
  leftLeft: number,
  weightedPrediction = 0,
): number => {
  switch (predictor) {
    case 0:
      return 0
    case 1:
      return left
    case 2:
      return top
    case 3:
      return Math.trunc((left + top) / 2)
    case 4: {
      const candidate = left + top - topLeft
      return Math.abs(candidate - left) < Math.abs(candidate - top) ? left : top
    }
    case 5:
      return Math.max(Math.min(left, top), Math.min(Math.max(left, top), left + top - topLeft))
    case 6:
      return weightedPrediction
    case 7:
      return topRight
    case 8:
      return topLeft
    case 9:
      return leftLeft
    case 10:
      return Math.trunc((left + topLeft) / 2)
    case 11:
      return Math.trunc((topLeft + top) / 2)
    case 12:
      return Math.trunc((top + topRight) / 2)
    case 13:
      return Math.trunc(
        (6 * top - 2 * topTop + 7 * left + leftLeft + topRightRight + 3 * topRight + 8) / 16,
      )
    default:
      throw invalidInput(`JPEG XL fixed predictor ${predictor} is invalid`)
  }
}

const visitPlaneResiduals = (
  planes: Readonly<ModularPlanes>,
  predictors: readonly number[],
  visit: (packedResidual: number, channel: number) => void,
): void => {
  for (let channel = 0; channel < planes.values.length; channel += 1) {
    const plane = planes.values[channel]
    const width = planes.widths[channel]
    const height = planes.heights[channel]
    const predictor = predictors[channel]
    if (!plane || width === undefined || height === undefined || predictor === undefined) {
      throw invalidInput('JPEG XL predictor plane is missing')
    }
    const weightedPredictor =
      predictor === 6
        ? new JpegXlWeightedPredictor(width, defaultJpegXlWeightedPredictor)
        : undefined
    const weightedProperties = weightedPredictor ? new Int32Array(16) : undefined
    for (let y = 0; y < height; y += 1) {
      const row = y * width
      const previous = row - width
      const beforePrevious = previous - width
      for (let x = 0; x < width; x += 1) {
        const position = row + x
        const left = x > 0 ? (plane[position - 1] ?? 0) : y > 0 ? (plane[previous + x] ?? 0) : 0
        const top = y > 0 ? (plane[previous + x] ?? 0) : left
        const topLeft = x > 0 && y > 0 ? (plane[previous + x - 1] ?? 0) : left
        const topRight = x + 1 < width && y > 0 ? (plane[previous + x + 1] ?? 0) : top
        const topRightRight = x + 2 < width && y > 0 ? (plane[previous + x + 2] ?? 0) : topRight
        const topTop = y > 1 ? (plane[beforePrevious + x] ?? 0) : top
        const leftLeft = x > 1 ? (plane[position - 2] ?? 0) : left
        const weightedPrediction =
          weightedPredictor && weightedProperties
            ? weightedPredictor.predict(
                x,
                y,
                width,
                top,
                left,
                topRight,
                topLeft,
                topTop,
                weightedProperties,
              )
            : 0
        const predicted = fixedPrediction(
          predictor,
          left,
          top,
          topTop,
          topLeft,
          topRight,
          topRightRight,
          leftLeft,
          weightedPrediction,
        )
        const sample = plane[position] ?? 0
        visit(packSigned(sample - predicted), channel)
        weightedPredictor?.update(sample, x, y)
      }
    }
  }
}

function deltaPalettePlanes(
  planes: Readonly<ModularPlanes>,
  channelCount: 3 | 4,
): PreparedModularPlanes | undefined {
  const width = planes.widths[0]
  const height = planes.heights[0]
  const first = planes.values[0]
  if (width === undefined || height === undefined || !first) return undefined
  const residualPlanes = Array.from({ length: channelCount }, () => new Int32Array(first.length))
  const positions = new Uint32Array(channelCount)
  visitPlaneResiduals(
    planes,
    Array.from({ length: channelCount }, () => 5),
    (packedResidual, channel) => {
      const position = positions[channel] ?? 0
      const output = residualPlanes[channel]
      if (!output) throw invalidInput('JPEG XL delta Palette residual plane is missing')
      output[position] = (packedResidual >>> 1) ^ -(packedResidual & 1)
      positions[channel] = position + 1
    },
  )
  const deltas: number[][] = []
  const lookup = new Map<string, number>()
  const indices = new Int32Array(first.length)
  for (let position = 0; position < first.length; position += 1) {
    let key = ''
    const delta: number[] = []
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = residualPlanes[channel]?.[position]
      if (sample === undefined) throw invalidInput('JPEG XL delta Palette sample is missing')
      delta.push(sample)
      key += `${sample},`
    }
    let index = lookup.get(key)
    if (index === undefined) {
      if (deltas.length === 256) return undefined
      index = deltas.length
      lookup.set(key, index)
      deltas.push(delta)
    }
    indices[position] = index
  }
  const palette = new Int32Array(deltas.length * channelCount)
  for (let channel = 0; channel < channelCount; channel += 1) {
    for (let delta = 0; delta < deltas.length; delta += 1) {
      palette[channel * deltas.length + delta] = deltas[delta]?.[channel] ?? 0
    }
  }
  return Object.freeze({
    planes: Object.freeze({
      values: Object.freeze([palette, indices]),
      widths: Object.freeze([deltas.length, width]),
      heights: Object.freeze([channelCount, height]),
    }),
    transforms: Object.freeze({
      useRct: false,
      palette: Object.freeze({
        channelCount,
        colorCount: 0,
        deltaCount: deltas.length,
        predictor: 5,
      }),
    }),
  })
}

const predictorCandidates = (effort: JpegXlLosslessEffort): readonly number[] =>
  effort === 1
    ? Object.freeze([1])
    : effort === 3
      ? Object.freeze([1, 2, 5])
      : effort === 5
        ? Object.freeze([1, 2, 3, 4, 5, 6, 13])
        : Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])

const predictorCandidatesForPlanes = (
  planes: Readonly<ModularPlanes>,
  effort: JpegXlLosslessEffort,
): readonly number[] => {
  const candidates = predictorCandidates(effort)
  const sampleCount = planes.values.reduce((sum, plane) => sum + plane.length, 0)
  return sampleCount <= 32_768 ? candidates : candidates.filter((candidate) => candidate !== 6)
}

const choosePredictors = (
  planes: Readonly<ModularPlanes>,
  effort: JpegXlLosslessEffort,
): readonly number[] => {
  const candidates = predictorCandidatesForPlanes(planes, effort)
  const selected: number[] = []
  for (let channel = 0; channel < planes.values.length; channel += 1) {
    const plane = planes.values[channel]
    const width = planes.widths[channel]
    const height = planes.heights[channel]
    if (!plane || width === undefined || height === undefined) {
      throw invalidInput('JPEG XL predictor search plane is missing')
    }
    const singlePlane = Object.freeze({
      values: Object.freeze([plane]),
      widths: Object.freeze([width]),
      heights: Object.freeze([height]),
    })
    let bestPredictor = candidates[0] ?? 1
    let bestScore = Number.POSITIVE_INFINITY
    for (const candidate of candidates) {
      let score = 0
      visitPlaneResiduals(singlePlane, [candidate], (packedResidual) => {
        score += Math.log2(packedResidual + 2)
      })
      if (score < bestScore) {
        bestScore = score
        bestPredictor = candidate
      }
    }
    selected.push(bestPredictor)
  }
  return Object.freeze(selected)
}

interface ModularTreeSymbol {
  readonly propertyPlusOne: number
  readonly split?: number
  readonly channel?: number
}

const modularTreeSymbols = (channels: number): readonly ModularTreeSymbol[] => {
  if (!Number.isSafeInteger(channels) || channels < 1 || channels > 128) {
    throw invalidInput(`JPEG XL channel tree does not support ${channels} channels`)
  }
  const symbols: ModularTreeSymbol[] = []
  const pending: { readonly first: number; readonly last: number }[] = [
    { first: 0, last: channels - 1 },
  ]
  while (pending.length > 0) {
    const range = pending.shift()
    if (!range) throw invalidInput('JPEG XL channel tree range is missing')
    if (range.first === range.last) {
      symbols.push({ propertyPlusOne: 0, channel: range.first })
      continue
    }
    const split = Math.floor((range.first + range.last) / 2)
    symbols.push({ propertyPlusOne: 1, split })
    pending.push({ first: split + 1, last: range.last }, { first: range.first, last: split })
  }
  return Object.freeze(symbols)
}

const writeChannelTree = (writer: JpegXlBitWriter, predictors: readonly number[]): Uint8Array => {
  const symbols = modularTreeSymbols(predictors.length)
  const frequencies = new Uint32Array(512)
  for (const node of symbols) {
    frequencies[node.propertyPlusOne] = (frequencies[node.propertyPlusOne] ?? 0) + 1
    if (node.propertyPlusOne === 0) {
      const predictor = predictors[node.channel ?? -1]
      if (predictor === undefined) throw invalidInput('JPEG XL channel predictor is missing')
      frequencies[predictor] = (frequencies[predictor] ?? 0) + 1
      frequencies[0] = (frequencies[0] ?? 0) + 3
    } else {
      frequencies[packSigned(node.split ?? 0)] = (frequencies[packSigned(node.split ?? 0)] ?? 0) + 1
    }
  }
  const encoding = writePrefixCode(writer, 6, frequencies)
  const contextToChannel: number[] = []
  for (const node of symbols) {
    writeHybridUint(writer, node.propertyPlusOne, encoding)
    if (node.propertyPlusOne === 0) {
      const channel = node.channel
      const predictor = channel === undefined ? undefined : predictors[channel]
      if (channel === undefined || predictor === undefined) {
        throw invalidInput('JPEG XL channel tree leaf is incomplete')
      }
      for (const symbol of [predictor, 0, 0, 0]) writeHybridUint(writer, symbol, encoding)
      contextToChannel.push(channel)
    } else {
      writeHybridUint(writer, packSigned(node.split ?? 0), encoding)
    }
  }
  return Uint8Array.from(contextToChannel)
}

interface ModularEntropyPlan {
  readonly predictors: readonly number[]
  readonly treePredictors: readonly number[]
  readonly leafToChannel: Uint8Array
  readonly entropyContextMap: Uint8Array
  readonly frequencies: readonly Uint32Array[]
  readonly packedValues: Uint32Array
  readonly contexts: Uint16Array
  readonly lz77: boolean
}

const buildEntropyPlan = (
  planes: Readonly<ModularPlanes>,
  effort: JpegXlLosslessEffort,
  allowLz77 = true,
): ModularEntropyPlan => {
  const clustered =
    planes.values.length > 8 ||
    (planes.values.length === 2 && planes.values.some((plane) => plane.length < 1_024))
  let predictors = choosePredictors(planes, effort)
  let treePredictors = predictors
  if (clustered) {
    let bestPredictor = 1
    let bestScore = Number.POSITIVE_INFINITY
    for (const candidate of predictorCandidatesForPlanes(planes, effort)) {
      let score = 0
      const trial = Array.from({ length: planes.values.length }, () => candidate)
      visitPlaneResiduals(planes, trial, (packedResidual) => {
        score += Math.log2(packedResidual + 2)
      })
      if (score < bestScore) {
        bestScore = score
        bestPredictor = candidate
      }
    }
    predictors = Object.freeze(Array.from({ length: planes.values.length }, () => bestPredictor))
    treePredictors = Object.freeze([bestPredictor])
  }
  const leafWriter = new JpegXlBitWriter()
  const leafToChannel = writeChannelTree(leafWriter, treePredictors)
  const channelContexts = new Uint16Array(planes.values.length)
  for (let context = 0; context < leafToChannel.length; context += 1) {
    channelContexts[leafToChannel[context] ?? 0] = context
  }
  const originalCount = planes.values.reduce((sum, plane) => sum + plane.length, 0)
  const residuals = new Uint32Array(originalCount)
  const residualContexts = new Uint16Array(originalCount)
  let residualPosition = 0
  visitPlaneResiduals(planes, predictors, (packedResidual, channel) => {
    residuals[residualPosition] = packedResidual
    residualContexts[residualPosition] = channelContexts[channel] ?? 0
    residualPosition += 1
  })
  const config = Object.freeze({ splitExponent: 4, msbInToken: 2, lsbInToken: 0 })
  const useLz77 = allowLz77 && effort >= 5 && originalCount >= 64
  const packedValues = new Uint32Array(useLz77 ? originalCount * 2 : originalCount)
  const contexts = new Uint16Array(packedValues.length)
  const matches = Array.from({ length: effort === 7 ? 4 : 1 }, () => new Map<number, number>())
  const distanceMultiplier = planes.widths.reduce((maximum, width) => Math.max(maximum, width), 0)
  const matchHash = (position: number): number =>
    (Math.imul(residuals[position] ?? 0, 0x1e35_a7bd) ^
      Math.imul(residuals[position + 1] ?? 0, 0x94d0_49bb) ^
      (residuals[position + 2] ?? 0)) >>>
    0
  let count = 0
  for (let position = 0; position < originalCount; ) {
    const value = residuals[position] ?? 0
    let matchPosition = -1
    let matchLength = 0
    if (useLz77 && position + 2 < originalCount) {
      const hash = matchHash(position)
      for (const candidates of matches) {
        const candidate = candidates.get(hash)
        if (candidate === undefined || position - candidate > 1_048_576) continue
        let candidateLength = 0
        while (
          position + candidateLength < originalCount &&
          (residuals[candidate + candidateLength] ?? 0) ===
            (residuals[position + candidateLength] ?? 0)
        ) {
          candidateLength += 1
        }
        if (candidateLength > matchLength) {
          matchLength = candidateLength
          matchPosition = candidate
        }
      }
      for (let history = matches.length - 1; history > 0; history -= 1) {
        const previous = matches[history - 1]?.get(hash)
        if (previous !== undefined) matches[history]?.set(hash, previous)
      }
      matches[0]?.set(hash, position)
      if (matchLength < 3) matchPosition = -1
    }
    if (matchPosition >= 0) {
      const lengthPacked = encodeHybridUintPacked(matchLength - 3, {
        splitExponent: 0,
        msbInToken: 0,
        lsbInToken: 0,
      })
      packedValues[count] = (lengthPacked & ~255) | (224 + (lengthPacked & 255))
      contexts[count] = residualContexts[position] ?? 0
      count += 1
      const distance = position - matchPosition
      const distanceCode =
        distance === distanceMultiplier
          ? 0
          : distance === 1
            ? 1
            : distance === distanceMultiplier + 1
              ? 2
              : distance === distanceMultiplier - 1
                ? 3
                : distance === distanceMultiplier * 2
                  ? 4
                  : distance === 2
                    ? 5
                    : distance + 119
      packedValues[count] = encodeHybridUintPacked(distanceCode, config)
      contexts[count] = leafToChannel.length
      count += 1
      const matchEnd = position + matchLength
      position += 1
      while (position < matchEnd) {
        if (position + 2 < originalCount) {
          const hash = matchHash(position)
          for (let history = matches.length - 1; history > 0; history -= 1) {
            const previous = matches[history - 1]?.get(hash)
            if (previous !== undefined) matches[history]?.set(hash, previous)
          }
          matches[0]?.set(hash, position)
        }
        position += 1
      }
      continue
    }
    packedValues[count] = encodeHybridUintPacked(value, config)
    contexts[count] = residualContexts[position] ?? 0
    count += 1
    position += 1
  }
  const histogramCount = clustered ? 1 : planes.values.length
  const frequencies = Array.from({ length: histogramCount }, () => new Uint32Array(256))
  const entropyContextMap = new Uint8Array(leafToChannel.length + (useLz77 ? 1 : 0))
  for (let context = 0; context < leafToChannel.length; context += 1) {
    entropyContextMap[context] = clustered ? 0 : (leafToChannel[context] ?? 0)
  }
  if (useLz77) entropyContextMap[leafToChannel.length] = 0
  for (let position = 0; position < count; position += 1) {
    const context = contexts[position] ?? 0
    const histogram = frequencies[entropyContextMap[context] ?? 0]
    if (!histogram) throw invalidInput('JPEG XL Modular histogram is missing')
    const token = (packedValues[position] ?? 0) & 255
    histogram[token] = (histogram[token] ?? 0) + 1
  }
  return Object.freeze({
    predictors,
    treePredictors,
    leafToChannel,
    entropyContextMap,
    frequencies: Object.freeze(frequencies),
    packedValues: packedValues.slice(0, count),
    contexts: contexts.slice(0, count),
    lz77: useLz77,
  })
}

const writeAnsPixels = (
  writer: JpegXlBitWriter,
  plan: Readonly<ModularEntropyPlan>,
  encoding: Readonly<AnsEncoding>,
): void => {
  writeAnsPackedValues(writer, plan.packedValues, plan.contexts, plan.packedValues.length, encoding)
}

export const writeModularHeader = (
  writer: JpegXlBitWriter,
  useGlobalTree: boolean,
  transforms: Readonly<ModularTransforms> = Object.freeze({ useRct: false }),
): void => {
  writer.writeBits(useGlobalTree ? 1 : 0, 1)
  writer.writeBits(1, 1)
  const transformCount =
    (transforms.useRct ? 1 : 0) +
    (transforms.palette ? 1 : 0) +
    (transforms.squeeze && transforms.squeeze.length > 0 ? 1 : 0)
  writeU32(writer, transformCount, [
    { value: 0 },
    { value: 1 },
    { bits: 4, offset: 2 },
    { bits: 8, offset: 18 },
  ])
  if (transforms.useRct) {
    writeU32(writer, 0, [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }])
    writeU32(writer, 0, [
      { bits: 3, offset: 0 },
      { bits: 6, offset: 8 },
      { bits: 10, offset: 72 },
      { bits: 13, offset: 1_096 },
    ])
    writeU32(writer, 6, [
      { value: 6 },
      { bits: 2, offset: 0 },
      { bits: 4, offset: 2 },
      { bits: 6, offset: 10 },
    ])
  }
  if (transforms.palette) {
    writeU32(writer, 1, [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }])
    writeU32(writer, 0, [
      { bits: 3, offset: 0 },
      { bits: 6, offset: 8 },
      { bits: 10, offset: 72 },
      { bits: 13, offset: 1_096 },
    ])
    writeU32(writer, transforms.palette.channelCount, [
      { value: 1 },
      { value: 3 },
      { value: 4 },
      { bits: 13, offset: 1 },
    ])
    writeU32(writer, transforms.palette.colorCount, [
      { bits: 8, offset: 0 },
      { bits: 10, offset: 256 },
      { bits: 12, offset: 1_280 },
      { bits: 16, offset: 5_376 },
    ])
    writeU32(writer, transforms.palette.deltaCount, [
      { value: 0 },
      { bits: 8, offset: 1 },
      { bits: 10, offset: 257 },
      { bits: 16, offset: 1_281 },
    ])
    writer.writeBits(transforms.palette.predictor, 4)
  }
  if (transforms.squeeze && transforms.squeeze.length > 0) {
    writeU32(writer, 2, [{ value: 0 }, { value: 1 }, { value: 2 }, { value: 3 }])
    writeU32(writer, transforms.squeeze.length, [
      { value: 0 },
      { bits: 4, offset: 1 },
      { bits: 6, offset: 9 },
      { bits: 8, offset: 41 },
    ])
    for (const parameter of transforms.squeeze) {
      writer.writeBits(parameter.horizontal ? 1 : 0, 1)
      writer.writeBits(1, 1)
      writeU32(writer, parameter.beginChannel, [
        { bits: 3, offset: 0 },
        { bits: 6, offset: 8 },
        { bits: 10, offset: 72 },
        { bits: 13, offset: 1_096 },
      ])
      writeU32(writer, parameter.channelCount, [
        { value: 1 },
        { value: 2 },
        { value: 3 },
        { bits: 4, offset: 4 },
      ])
    }
  }
}

const encodeFastSingleGroupSection = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: ModularPixelFormat,
): Uint8Array => {
  const writer = new JpegXlBitWriter()
  writer.writeBits(1, 1)
  writer.writeBits(0, 1)
  writeModularHeader(writer, false)
  writeModularTree(writer)
  const encoding = writePrefixCode(
    writer,
    1,
    leftResidualFrequencies(pixels, width, 0, 0, width, height, format),
  )
  writeLeftResiduals(writer, pixels, width, 0, 0, width, height, format, encoding)
  return writer.finish()
}

const encodeFastFrameSections = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: ModularPixelFormat,
): readonly Uint8Array[] => {
  const groupDimension = 1_024
  const groupsAcross = Math.ceil(width / groupDimension)
  const groupsDown = Math.ceil(height / groupDimension)
  if (groupsAcross * groupsDown === 1) {
    return Object.freeze([encodeFastSingleGroupSection(pixels, width, height, format)])
  }
  const frequencies = new Uint32Array(512)
  for (let groupY = 0; groupY < groupsDown; groupY += 1) {
    for (let groupX = 0; groupX < groupsAcross; groupX += 1) {
      const originX = groupX * groupDimension
      const originY = groupY * groupDimension
      const groupFrequencies = leftResidualFrequencies(
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
  const globalWriter = new JpegXlBitWriter()
  globalWriter.writeBits(1, 1)
  globalWriter.writeBits(1, 1)
  writeModularTree(globalWriter)
  const encoding = writePrefixCode(globalWriter, 1, frequencies)
  writeModularHeader(globalWriter, true)
  const dcGroupDimension = groupDimension * 8
  const dcGroupCount = Math.ceil(width / dcGroupDimension) * Math.ceil(height / dcGroupDimension)
  const sections: Uint8Array[] = [globalWriter.finish(), new Uint8Array(0)]
  for (let index = 0; index < dcGroupCount; index += 1) sections.push(new Uint8Array(0))
  for (let groupY = 0; groupY < groupsDown; groupY += 1) {
    for (let groupX = 0; groupX < groupsAcross; groupX += 1) {
      const originX = groupX * groupDimension
      const originY = groupY * groupDimension
      const groupWidth = Math.min(groupDimension, width - originX)
      const groupHeight = Math.min(groupDimension, height - originY)
      const writer = new JpegXlBitWriter()
      writeModularHeader(writer, true)
      writeLeftResiduals(
        writer,
        pixels,
        width,
        originX,
        originY,
        groupWidth,
        groupHeight,
        format,
        encoding,
      )
      sections.push(writer.finish())
    }
  }
  return Object.freeze(sections)
}

const encodeSingleGroupSection = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: ModularPixelFormat,
  effort: JpegXlLosslessEffort,
): Uint8Array => {
  const encodePrepared = (
    prepared: Readonly<PreparedModularPlanes>,
    allowLz77: boolean,
  ): Uint8Array => {
    const plan = buildEntropyPlan(prepared.planes, effort, allowLz77)
    const writer = new JpegXlBitWriter()
    writer.writeBits(1, 1)
    writer.writeBits(0, 1)
    writeModularHeader(writer, false, prepared.transforms)
    writeChannelTree(writer, plan.treePredictors)
    const encoding = writeAnsCode(
      writer,
      plan.entropyContextMap,
      plan.frequencies,
      { splitExponent: 4, msbInToken: 2, lsbInToken: 0 },
      plan.lz77,
    )
    writeAnsPixels(writer, plan, encoding)
    return writer.finish()
  }
  const prepared = prepareSingleGroupPlanes(pixels, width, height, format, effort)
  const candidates = [encodePrepared(prepared, false)]
  if (effort >= 5) candidates.push(encodePrepared(prepared, true))
  if (prepared.transforms.squeeze) {
    const channelCount = format.startsWith('rgba') ? 4 : format.startsWith('rgb') ? 3 : 1
    const rawBase = Object.freeze({
      planes: createModularPlanes(pixels, width, 0, 0, width, height, format, false),
      transforms: Object.freeze({ useRct: false }),
    })
    candidates.push(encodePrepared(rawBase, false), encodePrepared(rawBase, true))
    if (channelCount >= 3) {
      const rctBase = Object.freeze({
        planes: createModularPlanes(pixels, width, 0, 0, width, height, format, true),
        transforms: Object.freeze({ useRct: true }),
      })
      candidates.push(encodePrepared(rctBase, false), encodePrepared(rctBase, true))
    }
  }
  return candidates.reduce((smallest, candidate) =>
    candidate.byteLength < smallest.byteLength ? candidate : smallest,
  )
}

const encodeFrameSections = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: ModularPixelFormat,
  effort: JpegXlLosslessEffort,
): readonly Uint8Array[] => {
  const groupDimension = 1_024
  const groupsAcross = Math.ceil(width / groupDimension)
  const groupsDown = Math.ceil(height / groupDimension)
  const groupCount = groupsAcross * groupsDown
  if (effort === 1) {
    const fast = encodeFastFrameSections(pixels, width, height, format)
    if (groupCount !== 1) return fast
    const ans = encodeSingleGroupSection(pixels, width, height, format, effort)
    const fastSection = fast[0]
    if (!fastSection) throw invalidInput('JPEG XL fast Modular section is missing')
    return Object.freeze([ans.byteLength < fastSection.byteLength ? ans : fastSection])
  }
  if (groupCount === 1) {
    return Object.freeze([encodeSingleGroupSection(pixels, width, height, format, effort)])
  }
  return encodeFastFrameSections(pixels, width, height, format)
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

const boxHeader = (type: string, payloadBytes: number): Uint8Array => {
  const size = payloadBytes + 8
  if (size > 0xffff_ffff) throw limitExceeded(`JPEG XL ${type} box exceeds 32-bit size`)
  return concatenate([uint32(size), ascii(type)])
}

const containerPrefix = (codestreamBytes: number): Uint8Array =>
  concatenate([
    Uint8Array.of(0, 0, 0, 12, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a),
    boxHeader('ftyp', 12),
    ascii('jxl '),
    uint32(0),
    ascii('jxl '),
    boxHeader('jxlc', codestreamBytes),
  ])

interface EncodedJpegXlCodestream {
  readonly header: Uint8Array
  readonly sections: readonly Uint8Array[]
  readonly byteLength: number
}

const encodeCodestream = (
  pixels: Uint8Array,
  width: number,
  height: number,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
  options: Readonly<ResolvedJpegXlEncodeOptions>,
): EncodedJpegXlCodestream => {
  const sections = encodeFrameSections(pixels, width, height, format, options.effort)
  const writer = new JpegXlBitWriter()
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
  writeBitDepth(writer, options.sampleBitDepth)
  writer.writeBits(1, 1)
  writeU32(writer, hasAlpha ? 1 : 0, [
    { value: 0 },
    { value: 1 },
    { bits: 4, offset: 2 },
    { bits: 12, offset: 1 },
  ])
  if (hasAlpha) {
    if (options.alphaBitDepth !== 8) {
      writer.writeBits(0, 1)
      writeU32(writer, 0, [
        { value: 0 },
        { value: 1 },
        { bits: 4, offset: 2 },
        { bits: 6, offset: 18 },
      ])
      writeBitDepth(writer, options.alphaBitDepth ?? options.sampleBitDepth)
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
  const header = writer.finish()
  return Object.freeze({
    header,
    sections,
    byteLength: sections.reduce((sum, section) => sum + section.byteLength, header.byteLength),
  })
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

const sampleBitDepth = (name: string, value: unknown): JpegXlSampleBitDepth | undefined => {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 8 || value > 16) {
    throw invalidInput(`JPEG XL ${name} must be an integer from 8 to 16`)
  }
  return value as JpegXlSampleBitDepth
}

const readOptions = (
  value: unknown,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
): Readonly<ResolvedJpegXlEncodeOptions> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidInput('JPEG XL encoder options must be an object')
  }
  const options = value as Readonly<Record<string, unknown>>
  for (const key of Object.keys(options)) {
    if (
      key !== 'mode' &&
      key !== 'effort' &&
      key !== 'container' &&
      key !== 'sampleBitDepth' &&
      key !== 'alphaBitDepth'
    ) {
      throw invalidInput(`Unknown JPEG XL encoder option: ${key}`)
    }
  }
  if (options.mode !== undefined && options.mode !== 'lossless') {
    throw invalidInput('JPEG XL encoder mode must be lossless')
  }
  if (
    options.effort !== undefined &&
    options.effort !== 1 &&
    options.effort !== 3 &&
    options.effort !== 5 &&
    options.effort !== 7
  ) {
    throw invalidInput('JPEG XL encoder effort must be 1, 3, 5, or 7')
  }
  if (options.container !== undefined && typeof options.container !== 'boolean') {
    throw invalidInput('JPEG XL encoder container must be a boolean')
  }
  const declaredColorDepth = sampleBitDepth('sampleBitDepth', options.sampleBitDepth)
  const declaredAlphaDepth = sampleBitDepth('alphaBitDepth', options.alphaBitDepth)
  const highStorage = format.endsWith('16')
  const hasAlpha = format.startsWith('rgba')
  const resolvedColorDepth = declaredColorDepth ?? (highStorage ? 16 : 8)
  if (highStorage ? resolvedColorDepth < 9 : resolvedColorDepth !== 8) {
    throw invalidInput(
      highStorage
        ? 'JPEG XL 16-bit storage sampleBitDepth must be from 9 to 16'
        : 'JPEG XL 8-bit storage sampleBitDepth must be 8',
    )
  }
  if (!hasAlpha && declaredAlphaDepth !== undefined) {
    throw invalidInput('JPEG XL alphaBitDepth requires RGBA input')
  }
  const resolvedAlphaDepth = hasAlpha ? (declaredAlphaDepth ?? resolvedColorDepth) : undefined
  if (resolvedAlphaDepth !== undefined && (highStorage ? false : resolvedAlphaDepth !== 8)) {
    throw invalidInput('JPEG XL 8-bit RGBA storage alphaBitDepth must be 8')
  }
  return Object.freeze({
    mode: 'lossless',
    effort: (options.effort ?? 1) as JpegXlLosslessEffort,
    container: options.container ?? true,
    sampleBitDepth: resolvedColorDepth,
    ...(resolvedAlphaDepth === undefined ? {} : { alphaBitDepth: resolvedAlphaDepth }),
  })
}

const validateDeclaredSamples = (
  pixels: Uint8Array,
  format: 'gray8' | 'gray16' | 'rgb8' | 'rgb16' | 'rgba8' | 'rgba16',
  options: Readonly<ResolvedJpegXlEncodeOptions>,
): void => {
  if (!format.endsWith('16')) return
  const channels = format.startsWith('gray') ? 1 : format.startsWith('rgba') ? 4 : 3
  const colorMaximum = 2 ** options.sampleBitDepth - 1
  const alphaMaximum = 2 ** (options.alphaBitDepth ?? options.sampleBitDepth) - 1
  for (let offset = 0; offset < pixels.byteLength; offset += channels * 2) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample =
        (pixels[offset + channel * 2] ?? 0) * 256 + (pixels[offset + channel * 2 + 1] ?? 0)
      const maximum = channel === 3 ? alphaMaximum : colorMaximum
      if (sample > maximum) {
        throw invalidInput(
          `JPEG XL ${channel === 3 ? 'alpha' : 'color'} sample exceeds its declared bit depth`,
        )
      }
    }
  }
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
  readonly #options: Readonly<ResolvedJpegXlEncodeOptions>
  #pixels: Uint8Array | undefined
  readonly #rowBytes: number
  #nextY = 0
  #state: 'open' | 'finishing' | 'finished' | 'aborted' = 'open'
  #managedLiveBytes = 0
  #managedPeakBytes = 0

  get managedPeakBytes(): number {
    return this.#managedPeakBytes
  }

  constructor(
    sink: ImageSink,
    request: EncodeRequest,
    options: Readonly<ResolvedJpegXlEncodeOptions>,
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
    this.#retain(this.#pixels.byteLength)
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
      validateDeclaredSamples(pixels, this.#request.pixelFormat, this.#options)
      const codestream = encodeCodestream(
        pixels,
        this.#request.width,
        this.#request.height,
        this.#request.pixelFormat,
        this.#options,
      )
      const channels = this.#request.pixelFormat.startsWith('gray')
        ? 1
        : this.#request.pixelFormat.startsWith('rgba')
          ? 4
          : 3
      const sampleCount = this.#request.width * this.#request.height * channels
      const advancedSingleGroup =
        this.#options.effort > 1 && this.#request.width <= 1_024 && this.#request.height <= 1_024
      this.#observePeak(
        pixels.byteLength +
          codestream.byteLength * 2 +
          (advancedSingleGroup ? sampleCount * 32 : 4_096),
      )
      const prefix = this.#options.container ? containerPrefix(codestream.byteLength) : undefined
      const outputBytes = codestream.byteLength + (prefix?.byteLength ?? 0)
      const jpegXlLimits = resolveJpegXlLimits()
      if (outputBytes > jpegXlLimits.maxCodestreamBytes) {
        throw limitExceeded(
          `JPEG XL output requires ${outputBytes} bytes; maxCodestreamBytes is ${jpegXlLimits.maxCodestreamBytes}`,
        )
      }
      const sectionBytes = codestream.sections.reduce(
        (sum, section) => sum + section.byteLength,
        codestream.header.byteLength + (prefix?.byteLength ?? 0),
      )
      this.#retain(sectionBytes)
      this.#pixels = undefined
      this.#release(pixels.byteLength)
      if (prefix) await this.#sink.write(prefix)
      await this.#sink.write(codestream.header)
      for (const section of codestream.sections) {
        throwIfAborted(this.#request.signal)
        if (section.byteLength > 0) await this.#sink.write(section)
      }
      this.#release(sectionBytes)
      this.#state = 'finished'
    } catch (error) {
      await this.abort(error)
      throw error
    }
  }

  async abort(reason: unknown): Promise<void> {
    if (this.#state === 'aborted' || this.#state === 'finished') return
    this.#state = 'aborted'
    if (this.#pixels) this.#release(this.#pixels.byteLength)
    this.#pixels = undefined
    try {
      await this.#sink.abort(reason)
    } catch {
      // Preserve the failure that caused the encoder to abort.
    }
  }

  #retain(bytes: number): void {
    this.#managedLiveBytes += bytes
    this.#managedPeakBytes = Math.max(this.#managedPeakBytes, this.#managedLiveBytes)
  }

  #release(bytes: number): void {
    this.#managedLiveBytes = Math.max(0, this.#managedLiveBytes - bytes)
  }

  #observePeak(bytes: number): void {
    this.#managedPeakBytes = Math.max(this.#managedPeakBytes, bytes)
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
  return new JpegXlModularEncoder(sink, request, readOptions(request.options, request.pixelFormat))
}
