import { invalidInput, truncatedInput } from '../../errors.ts'
import { ReverseBitReader } from './bitstream.ts'
import { decodeFseWeights } from './fse.ts'

interface HuffmanEntry {
  readonly symbol: number
  readonly bits: number
}

export interface HuffmanTable {
  readonly accuracyLog: number
  readonly entries: readonly HuffmanEntry[]
}

export interface ParsedHuffmanTable {
  readonly table: HuffmanTable
  readonly bytesRead: number
}

export const parseHuffmanTable = (
  data: Uint8Array,
  start: number,
  end: number,
): ParsedHuffmanTable => {
  const header = data[start]
  if (header === undefined || start >= end) {
    throw truncatedInput('Truncated Zstandard Huffman tree')
  }

  let weights: Uint8Array
  let bytesRead: number
  if (header >= 128) {
    const count = header - 127
    const encodedBytes = Math.ceil(count / 2)
    if (start + 1 + encodedBytes > end) {
      throw truncatedInput('Truncated direct Zstandard Huffman weights')
    }
    weights = new Uint8Array(count)
    for (let index = 0; index < count; index += 1) {
      const packed = data[start + 1 + (index >>> 1)] ?? 0
      weights[index] = (index & 1) === 0 ? packed >>> 4 : packed & 15
    }
    bytesRead = 1 + encodedBytes
  } else {
    if (header === 0 || start + 1 + header > end) {
      throw invalidInput('Invalid FSE-compressed Zstandard Huffman weights')
    }
    weights = decodeFseWeights(data, start + 1, start + 1 + header, 255)
    bytesRead = 1 + header
  }

  if (weights.byteLength === 0 || weights.byteLength >= 256) {
    throw invalidInput('Invalid Zstandard Huffman symbol count')
  }

  let weightTotal = 0
  for (const weight of weights) {
    if (weight > 11) throw invalidInput('Zstandard Huffman weight exceeds its format limit')
    if (weight > 0) weightTotal += 2 ** (weight - 1)
  }
  if (weightTotal === 0) throw invalidInput('Empty Zstandard Huffman tree')

  const accuracyLog = Math.floor(Math.log2(weightTotal)) + 1
  if (accuracyLog > 11) throw invalidInput('Zstandard Huffman tree is too deep')
  const remainder = 2 ** accuracyLog - weightTotal
  if (remainder <= 0 || (remainder & (remainder - 1)) !== 0) {
    throw invalidInput('Invalid implied Zstandard Huffman weight')
  }
  const lastWeight = Math.floor(Math.log2(remainder)) + 1

  const completeWeights = new Uint8Array(weights.byteLength + 1)
  completeWeights.set(weights)
  completeWeights[weights.byteLength] = lastWeight
  return { table: buildHuffmanTable(completeWeights, accuracyLog), bytesRead }
}

const buildHuffmanTable = (weights: Uint8Array, accuracyLog: number): HuffmanTable => {
  const rankCounts = new Uint16Array(accuracyLog + 1)
  for (const weight of weights) {
    if (weight > accuracyLog) throw invalidInput('Invalid Zstandard Huffman weight')
    rankCounts[weight] = (rankCounts[weight] ?? 0) + 1
  }

  const symbols: number[] = []
  for (let weight = 0; weight <= accuracyLog; weight += 1) {
    for (let symbol = 0; symbol < weights.byteLength; symbol += 1) {
      if (weights[symbol] === weight) symbols.push(symbol)
    }
  }

  const tableSize = 2 ** accuracyLog
  const entries: HuffmanEntry[] = new Array(tableSize)
  let symbolOffset = rankCounts[0] ?? 0
  let tableOffset = 0
  for (let weight = 1; weight <= accuracyLog; weight += 1) {
    const count = rankCounts[weight] ?? 0
    const span = 2 ** (weight - 1)
    const bits = accuracyLog + 1 - weight
    for (let rank = 0; rank < count; rank += 1) {
      const symbol = symbols[symbolOffset]
      if (symbol === undefined) throw invalidInput('Incomplete Zstandard Huffman symbols')
      symbolOffset += 1
      for (let fill = 0; fill < span; fill += 1) {
        entries[tableOffset] = { symbol, bits }
        tableOffset += 1
      }
    }
  }
  if (tableOffset !== tableSize) throw invalidInput('Incomplete Zstandard Huffman table')
  return { accuracyLog, entries }
}

export const decodeHuffmanStream = (
  data: Uint8Array,
  start: number,
  end: number,
  output: Uint8Array,
  outputStart: number,
  outputLength: number,
  table: HuffmanTable,
): void => {
  if (outputStart < 0 || outputLength < 0 || outputStart + outputLength > output.byteLength) {
    throw invalidInput('Invalid Zstandard Huffman output bounds')
  }
  const reader = new ReverseBitReader(data, start, end)
  for (let index = 0; index < outputLength; index += 1) {
    const key = reader.peekBitsPadded(table.accuracyLog)
    const entry = table.entries[key]
    if (entry === undefined) throw invalidInput('Invalid Zstandard Huffman code')
    reader.skipBits(entry.bits)
    output[outputStart + index] = entry.symbol
  }
  reader.assertConsumed()
}
