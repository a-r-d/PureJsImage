import { invalidInput, truncatedInput } from '../../errors.ts'
import { ForwardBitReader, ReverseBitReader } from './bitstream.ts'

export interface FseEntry {
  readonly symbol: number
  readonly bits: number
  readonly baseline: number
}

export interface FseTable {
  readonly accuracyLog: number
  readonly entries: readonly FseEntry[]
}

export interface ParsedFseTable {
  readonly table: FseTable
  readonly bytesRead: number
}

const highBit = (value: number): number => Math.floor(Math.log2(value))

export const parseFseTable = (
  data: Uint8Array,
  start: number,
  end: number,
  maxSymbol: number,
  maxAccuracyLog: number,
): ParsedFseTable => {
  if (start >= end) throw truncatedInput('Truncated Zstandard FSE table')
  if (!Number.isInteger(maxSymbol) || maxSymbol < 1 || maxSymbol > 255) {
    throw invalidInput('Invalid Zstandard FSE symbol limit')
  }

  const reader = new ForwardBitReader(data, start, end)
  const accuracyLog = reader.readBits(4) + 5
  if (accuracyLog > maxAccuracyLog) {
    throw invalidInput('Zstandard FSE accuracy log exceeds its format limit')
  }

  const probabilities: number[] = []
  let remaining = 2 ** accuracyLog + 1
  let threshold = 2 ** accuracyLog
  let bits = accuracyLog + 1
  let previousZero = false

  while (remaining > 1) {
    if (previousZero) {
      let repeatedZeros = 0
      let repeat: number
      do {
        repeat = reader.readBits(2)
        repeatedZeros += repeat
        if (probabilities.length + repeatedZeros > maxSymbol) {
          throw invalidInput('Zstandard FSE table has too many symbols')
        }
      } while (repeat === 3)
      for (let index = 0; index < repeatedZeros; index += 1) probabilities.push(0)
    }

    if (probabilities.length > maxSymbol) {
      throw invalidInput('Zstandard FSE table has too many symbols')
    }

    const maximum = 2 * threshold - 1 - remaining
    const low = reader.peekBits(bits - 1)
    let count: number
    if (low < maximum) {
      count = reader.readBits(bits - 1)
    } else {
      count = reader.readBits(bits)
      if (count >= threshold) count -= maximum
    }
    count -= 1

    probabilities.push(count)
    remaining -= Math.abs(count)
    if (remaining < 1) throw invalidInput('Invalid Zstandard FSE probabilities')
    previousZero = count === 0

    if (remaining < threshold) {
      bits = highBit(remaining) + 1
      threshold = 2 ** (bits - 1)
    }
  }

  if (remaining !== 1 || probabilities.length < 2) {
    throw invalidInput('Incomplete Zstandard FSE probability table')
  }

  return {
    table: buildFseTable(probabilities, accuracyLog),
    bytesRead: reader.bytesRead,
  }
}

export const buildFseTable = (probabilities: readonly number[], accuracyLog: number): FseTable => {
  if (!Number.isInteger(accuracyLog) || accuracyLog < 0 || accuracyLog > 15) {
    throw invalidInput('Invalid Zstandard FSE accuracy log')
  }
  const tableSize = 2 ** accuracyLog
  if (tableSize === 1) {
    if (probabilities.length !== 1 || probabilities[0] !== 1) {
      throw invalidInput('Invalid Zstandard RLE FSE table')
    }
    return { accuracyLog: 0, entries: [{ symbol: 0, bits: 0, baseline: 0 }] }
  }

  let total = 0
  let highThreshold = tableSize - 1
  const symbols = new Int16Array(tableSize)
  symbols.fill(-1)
  const next = new Uint16Array(probabilities.length)

  for (let symbol = 0; symbol < probabilities.length; symbol += 1) {
    const probability = probabilities[symbol] ?? 0
    if (!Number.isInteger(probability) || probability < -1) {
      throw invalidInput('Invalid Zstandard FSE probability')
    }
    total += Math.abs(probability)
    if (probability === -1) {
      symbols[highThreshold] = symbol
      highThreshold -= 1
      next[symbol] = 1
    } else {
      next[symbol] = probability
    }
  }
  if (total !== tableSize) throw invalidInput('Invalid Zstandard FSE probability total')

  const mask = tableSize - 1
  const step = (tableSize >>> 1) + (tableSize >>> 3) + 3
  let position = 0
  for (let symbol = 0; symbol < probabilities.length; symbol += 1) {
    const probability = probabilities[symbol] ?? 0
    for (let count = 0; count < probability; count += 1) {
      symbols[position] = symbol
      do {
        position = (position + step) & mask
      } while (position > highThreshold)
    }
  }
  if (position !== 0) throw invalidInput('Invalid Zstandard FSE symbol spread')

  const entries: FseEntry[] = new Array(tableSize)
  for (let state = 0; state < tableSize; state += 1) {
    const symbol = symbols[state]
    if (symbol === undefined || symbol < 0) {
      throw invalidInput('Incomplete Zstandard FSE decode table')
    }
    const nextState = next[symbol] ?? 0
    next[symbol] = nextState + 1
    const stateBits = accuracyLog - highBit(nextState)
    entries[state] = {
      symbol,
      bits: stateBits,
      baseline: nextState * 2 ** stateBits - tableSize,
    }
  }

  return { accuracyLog, entries }
}

export const rleFseTable = (symbol: number): FseTable => {
  if (!Number.isInteger(symbol) || symbol < 0 || symbol > 255) {
    throw invalidInput('Invalid Zstandard RLE symbol')
  }
  return { accuracyLog: 0, entries: [{ symbol, bits: 0, baseline: 0 }] }
}

export const initialFseState = (table: FseTable, reader: ReverseBitReader): number =>
  reader.readBits(table.accuracyLog)

export interface DecodedFseSymbol {
  readonly symbol: number
  readonly state: number
}

export const decodeFseSymbol = (
  table: FseTable,
  state: number,
  reader: ReverseBitReader,
): DecodedFseSymbol => {
  const entry = table.entries[state]
  if (entry === undefined) throw invalidInput('Invalid Zstandard FSE state')
  return {
    symbol: entry.symbol,
    state: entry.baseline + reader.readBits(entry.bits),
  }
}

export const decodeFseWeights = (
  data: Uint8Array,
  start: number,
  end: number,
  maximumOutput: number,
): Uint8Array => {
  const parsed = parseFseTable(data, start, end, 255, 6)
  const streamStart = start + parsed.bytesRead
  if (streamStart >= end) throw truncatedInput('Truncated Zstandard Huffman weight stream')
  const reader = new ReverseBitReader(data, streamStart, end)
  let state1 = initialFseState(parsed.table, reader)
  let state2 = initialFseState(parsed.table, reader)
  const output = new Uint8Array(maximumOutput)
  let length = 0

  while (true) {
    const first = parsed.table.entries[state1]
    if (first === undefined || length >= maximumOutput) {
      throw invalidInput('Invalid Zstandard Huffman weight stream')
    }
    output[length] = first.symbol
    length += 1
    const firstBits = reader.readBitsPadded(first.bits)
    state1 = first.baseline + firstBits.value
    if (firstBits.overflow) {
      const final = parsed.table.entries[state2]
      if (final === undefined || length >= maximumOutput) {
        throw invalidInput('Invalid Zstandard Huffman weight stream')
      }
      output[length] = final.symbol
      length += 1
      break
    }

    const second = parsed.table.entries[state2]
    if (second === undefined || length >= maximumOutput) {
      throw invalidInput('Invalid Zstandard Huffman weight stream')
    }
    output[length] = second.symbol
    length += 1
    const secondBits = reader.readBitsPadded(second.bits)
    state2 = second.baseline + secondBits.value
    if (secondBits.overflow) {
      const final = parsed.table.entries[state1]
      if (final === undefined || length >= maximumOutput) {
        throw invalidInput('Invalid Zstandard Huffman weight stream')
      }
      output[length] = final.symbol
      length += 1
      break
    }
  }

  return output.subarray(0, length)
}
