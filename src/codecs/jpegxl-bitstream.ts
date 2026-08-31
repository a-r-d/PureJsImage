import { invalidInput, truncatedInput } from '../errors.ts'

export class JpegXlBitReader {
  readonly #data: Uint8Array
  #bitPosition: number

  constructor(data: Uint8Array, bitPosition = 0) {
    this.#data = data
    this.#bitPosition = bitPosition
  }

  get bitPosition(): number {
    return this.#bitPosition
  }

  get remainingBits(): number {
    return this.#data.byteLength * 8 - this.#bitPosition
  }

  readBits(count: number): number {
    if (!Number.isInteger(count) || count < 0 || count > 32) {
      throw invalidInput('JPEG XL bit width is invalid')
    }
    if (this.#bitPosition + count > this.#data.byteLength * 8) {
      throw truncatedInput('JPEG XL codestream is truncated')
    }
    let value = 0
    for (let index = 0; index < count; index += 1) {
      const position = this.#bitPosition + index
      const byte = this.#data[position >>> 3]
      if (byte === undefined) throw truncatedInput('JPEG XL codestream is truncated')
      value += ((byte >>> (position & 7)) & 1) * 2 ** index
    }
    this.#bitPosition += count
    return value >>> 0
  }

  peekBits(count: number): number {
    const position = this.#bitPosition
    const value = this.readBits(count)
    this.#bitPosition = position
    return value
  }

  skipBits(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.remainingBits) {
      throw invalidInput('JPEG XL bit skip is invalid')
    }
    this.#bitPosition += count
  }

  alignToByte(): void {
    const remainder = this.#bitPosition & 7
    if (remainder !== 0) this.skipBits(8 - remainder)
  }
}

export const jpegXlCeilLog2 = (value: number): number => {
  if (!Number.isInteger(value) || value < 1) throw invalidInput('JPEG XL integer is invalid')
  let bits = 0
  let limit = 1
  while (limit < value) {
    limit *= 2
    bits += 1
  }
  return bits
}

export const readJpegXlVarUint8 = (reader: JpegXlBitReader): number => {
  if (reader.readBits(1) === 0) return 0
  const bits = reader.readBits(3)
  return bits === 0 ? 1 : 2 ** bits + reader.readBits(bits)
}

export const readJpegXlVarUint16 = (reader: JpegXlBitReader): number => {
  if (reader.readBits(1) === 0) return 0
  const bits = reader.readBits(4)
  return bits === 0 ? 1 : 2 ** bits + reader.readBits(bits)
}

export interface JpegXlHybridUintConfig {
  readonly splitExponent: number
  readonly splitToken: number
  readonly msbInToken: number
  readonly lsbInToken: number
}

export const readJpegXlHybridUintConfig = (
  reader: JpegXlBitReader,
  logAlphabetSize: number,
): JpegXlHybridUintConfig => {
  const splitExponent = reader.readBits(jpegXlCeilLog2(logAlphabetSize + 1))
  let msbInToken = 0
  let lsbInToken = 0
  if (splitExponent !== logAlphabetSize) {
    msbInToken = reader.readBits(jpegXlCeilLog2(splitExponent + 1))
    if (msbInToken > splitExponent) {
      throw invalidInput('JPEG XL hybrid integer configuration is invalid')
    }
    lsbInToken = reader.readBits(jpegXlCeilLog2(splitExponent - msbInToken + 1))
  }
  if (msbInToken + lsbInToken > splitExponent) {
    throw invalidInput('JPEG XL hybrid integer configuration is invalid')
  }
  return Object.freeze({
    splitExponent,
    splitToken: 2 ** splitExponent,
    msbInToken,
    lsbInToken,
  })
}

export const readJpegXlHybridUint = (
  reader: JpegXlBitReader,
  config: JpegXlHybridUintConfig,
  token: number,
): number => {
  if (token < config.splitToken) return token
  const tokenPayload = token - config.splitToken
  const tokenBits = config.msbInToken + config.lsbInToken
  const extraBits = config.splitExponent - tokenBits + Math.floor(tokenPayload / 2 ** tokenBits)
  if (extraBits < 0 || extraBits > 29) {
    throw invalidInput('JPEG XL hybrid integer exceeds the supported range')
  }
  const lowMask = 2 ** config.lsbInToken - 1
  const low = token & lowMask
  const shiftedToken = Math.floor(token / 2 ** config.lsbInToken)
  const tokenMask = 2 ** config.msbInToken - 1
  const high = 2 ** config.msbInToken + (shiftedToken & tokenMask)
  const value =
    ((high * 2 ** extraBits + reader.readBits(extraBits)) * 2 ** config.lsbInToken + low) >>> 0
  return value
}

interface HuffmanEntry {
  readonly bits: number
  readonly key: number
  readonly symbol: number
}

export class JpegXlHuffmanCode {
  readonly #entries: readonly HuffmanEntry[]
  readonly #maximumBits: number

  constructor(entries: readonly HuffmanEntry[]) {
    if (entries.length === 0) throw invalidInput('JPEG XL Huffman code is empty')
    this.#entries = entries
    this.#maximumBits = entries.reduce((maximum, entry) => Math.max(maximum, entry.bits), 0)
  }

  readSymbol(reader: JpegXlBitReader): number {
    if (this.#maximumBits === 0) return this.#entries[0]?.symbol ?? 0
    let key = 0
    for (let bits = 1; bits <= this.#maximumBits; bits += 1) {
      key |= reader.readBits(1) << (bits - 1)
      const entry = this.#entries.find(
        (candidate) => candidate.bits === bits && candidate.key === key,
      )
      if (entry) return entry.symbol
    }
    throw invalidInput('JPEG XL Huffman symbol is invalid')
  }
}

const nextHuffmanKey = (key: number, length: number): number => {
  let step = 2 ** (length - 1)
  while ((key & step) !== 0) step >>>= 1
  return (key & (step - 1)) + step
}

const buildHuffmanCode = (
  symbols: readonly number[],
  lengths: readonly number[],
): JpegXlHuffmanCode => {
  const maximumBits = lengths.reduce((maximum, length) => Math.max(maximum, length), 0)
  const entries: HuffmanEntry[] = []
  let key = 0
  for (let bits = 1; bits <= maximumBits; bits += 1) {
    for (let index = 0; index < symbols.length; index += 1) {
      if (lengths[index] !== bits) continue
      const symbol = symbols[index]
      if (symbol === undefined) throw invalidInput('JPEG XL Huffman symbol is missing')
      entries.push(Object.freeze({ bits, key, symbol }))
      key = nextHuffmanKey(key, bits)
    }
  }
  if (entries.length === 1) {
    const entry = entries[0]
    if (!entry) throw invalidInput('JPEG XL Huffman code is empty')
    return new JpegXlHuffmanCode([Object.freeze({ bits: 0, key: 0, symbol: entry.symbol })])
  }
  if (entries.length === 0 && symbols.length === 1) {
    const symbol = symbols[0]
    if (symbol === undefined) throw invalidInput('JPEG XL Huffman symbol is missing')
    return new JpegXlHuffmanCode([Object.freeze({ bits: 0, key: 0, symbol })])
  }
  return new JpegXlHuffmanCode(entries)
}

const readSimpleHuffmanCode = (
  reader: JpegXlBitReader,
  alphabetSize: number,
): JpegXlHuffmanCode => {
  const symbolBits = alphabetSize > 1 ? Math.floor(Math.log2(alphabetSize - 1)) + 1 : 0
  const count = reader.readBits(2) + 1
  const symbols: number[] = []
  for (let index = 0; index < count; index += 1) {
    const symbol = reader.readBits(symbolBits)
    if (symbol >= alphabetSize || symbols.includes(symbol)) {
      throw invalidInput('JPEG XL simple Huffman code is invalid')
    }
    symbols.push(symbol)
  }
  const shape = count === 4 ? count + reader.readBits(1) : count
  if (shape === 1) return buildHuffmanCode(symbols, [0])
  if (shape === 2) {
    symbols.sort((left, right) => left - right)
    return buildHuffmanCode(symbols, [1, 1])
  }
  if (shape === 3) {
    const tail = symbols.slice(1).sort((left, right) => left - right)
    return buildHuffmanCode([symbols[0] ?? 0, ...tail], [1, 2, 2])
  }
  if (shape === 4) {
    symbols.sort((left, right) => left - right)
    return buildHuffmanCode(symbols, [2, 2, 2, 2])
  }
  if (shape === 5) {
    const tail = symbols.slice(2).sort((left, right) => left - right)
    return buildHuffmanCode([symbols[0] ?? 0, symbols[1] ?? 0, ...tail], [1, 2, 3, 3])
  }
  throw invalidInput('JPEG XL simple Huffman code shape is invalid')
}

const codeLengthOrder = [1, 2, 3, 4, 0, 5, 17, 6, 16, 7, 8, 9, 10, 11, 12, 13, 14, 15]
const codeLengthStaticBits = [2, 2, 2, 3, 2, 2, 2, 4, 2, 2, 2, 3, 2, 2, 2, 4]
const codeLengthStaticSymbols = [0, 4, 3, 2, 0, 4, 3, 1, 0, 4, 3, 2, 0, 4, 3, 5]

const readCodeLengthSymbol = (reader: JpegXlBitReader): number => {
  const key = reader.peekBits(4)
  const bits = codeLengthStaticBits[key]
  const symbol = codeLengthStaticSymbols[key]
  if (bits === undefined || symbol === undefined) {
    throw invalidInput('JPEG XL Huffman code length is invalid')
  }
  reader.skipBits(bits)
  return symbol
}

const readComplexHuffmanCode = (
  reader: JpegXlBitReader,
  alphabetSize: number,
  skip: number,
): JpegXlHuffmanCode => {
  const codeLengthCodeLengths = new Array<number>(18).fill(0)
  let space = 32
  let count = 0
  for (let index = skip; index < codeLengthOrder.length && space > 0; index += 1) {
    const order = codeLengthOrder[index]
    if (order === undefined) throw invalidInput('JPEG XL Huffman order is invalid')
    const length = readCodeLengthSymbol(reader)
    codeLengthCodeLengths[order] = length
    if (length !== 0) {
      space -= 32 >>> length
      count += 1
    }
  }
  if (count !== 1 && space !== 0) throw invalidInput('JPEG XL Huffman code is incomplete')
  const codeLengthSymbols = codeLengthCodeLengths.map((_, symbol) => symbol)
  const codeLengthCode = buildHuffmanCode(codeLengthSymbols, codeLengthCodeLengths)
  const lengths = new Array<number>(alphabetSize).fill(0)
  let symbol = 0
  let previousLength = 8
  let repeat = 0
  let repeatedLength = 0
  let remainingSpace = 32_768
  while (symbol < alphabetSize && remainingSpace > 0) {
    const length = codeLengthCode.readSymbol(reader)
    if (length < 16) {
      repeat = 0
      lengths[symbol] = length
      symbol += 1
      if (length !== 0) {
        previousLength = length
        remainingSpace -= 32_768 >>> length
      }
      continue
    }
    const extraBits = length - 14
    const newLength = length === 16 ? previousLength : 0
    if (repeatedLength !== newLength) {
      repeat = 0
      repeatedLength = newLength
    }
    const oldRepeat = repeat
    if (repeat > 0) repeat = (repeat - 2) << extraBits
    repeat += reader.readBits(extraBits) + 3
    const delta = repeat - oldRepeat
    if (symbol + delta > alphabetSize) throw invalidInput('JPEG XL Huffman repeat is invalid')
    lengths.fill(repeatedLength, symbol, symbol + delta)
    symbol += delta
    if (repeatedLength !== 0) remainingSpace -= delta << (15 - repeatedLength)
  }
  if (remainingSpace !== 0) throw invalidInput('JPEG XL Huffman code is incomplete')
  return buildHuffmanCode(
    lengths.map((_, index) => index),
    lengths,
  )
}

export const readJpegXlHuffmanCode = (
  reader: JpegXlBitReader,
  alphabetSize: number,
): JpegXlHuffmanCode => {
  if (!Number.isInteger(alphabetSize) || alphabetSize < 1 || alphabetSize > 32_768) {
    throw invalidInput('JPEG XL Huffman alphabet size is invalid')
  }
  const mode = reader.readBits(2)
  return mode === 1
    ? readSimpleHuffmanCode(reader, alphabetSize)
    : readComplexHuffmanCode(reader, alphabetSize, mode)
}

interface JpegXlLz77Config {
  readonly enabled: boolean
  readonly minimumSymbol: number
  readonly minimumLength: number
  readonly lengthConfig: JpegXlHybridUintConfig
  readonly distanceContext: number
}

export interface JpegXlEntropyCode {
  readonly contextMap: readonly number[]
  readonly uintConfigs: readonly JpegXlHybridUintConfig[]
  readonly huffmanCodes: readonly JpegXlHuffmanCode[] | undefined
  readonly aliasTables: readonly JpegXlAliasTable[] | undefined
  readonly lz77: JpegXlLz77Config
}

interface JpegXlAliasEntry {
  readonly cutoff: number
  readonly rightSymbol: number
  readonly leftFrequency: number
  readonly rightFrequency: number
  readonly rightOffset: number
}

interface JpegXlAliasTable {
  readonly entries: readonly JpegXlAliasEntry[]
  readonly logEntrySize: number
  readonly entryMask: number
}

const readJpegXlU32 = (
  reader: JpegXlBitReader,
  distributions: readonly (
    | { readonly value: number }
    | { readonly offset: number; readonly bits: number }
  )[],
): number => {
  const distribution = distributions[reader.readBits(2)]
  if (!distribution) throw invalidInput('JPEG XL integer distribution is invalid')
  return 'value' in distribution
    ? distribution.value
    : distribution.offset + reader.readBits(distribution.bits)
}

const readLz77Fields = (
  reader: JpegXlBitReader,
): Omit<JpegXlLz77Config, 'lengthConfig' | 'distanceContext'> => {
  const enabled = reader.readBits(1) !== 0
  if (!enabled) return Object.freeze({ enabled, minimumSymbol: 0, minimumLength: 0 })
  return Object.freeze({
    enabled,
    minimumSymbol: readJpegXlU32(reader, [
      { value: 224 },
      { value: 512 },
      { value: 4_096 },
      { offset: 8, bits: 15 },
    ]),
    minimumLength: readJpegXlU32(reader, [
      { value: 3 },
      { value: 4 },
      { offset: 5, bits: 2 },
      { offset: 9, bits: 8 },
    ]),
  })
}

const inverseMoveToFront = (values: number[]): void => {
  const alphabet = Array.from({ length: 256 }, (_, index) => index)
  for (let index = 0; index < values.length; index += 1) {
    const position = values[index]
    if (position === undefined || position >= alphabet.length) {
      throw invalidInput('JPEG XL context map is invalid')
    }
    const value = alphabet[position]
    if (value === undefined) throw invalidInput('JPEG XL context map is invalid')
    values[index] = value
    alphabet.splice(position, 1)
    alphabet.unshift(value)
  }
}

const verifyContextMap = (contextMap: readonly number[]): number => {
  const maximum = contextMap.reduce((value, entry) => Math.max(value, entry), 0)
  const seen = new Set(contextMap)
  if (maximum >= 256 || seen.size !== maximum + 1) {
    throw invalidInput('JPEG XL context map is incomplete')
  }
  return maximum + 1
}

const readHistogramVarUint = (reader: JpegXlBitReader): number => readJpegXlVarUint8(reader)

const histogramLogCountEntries = [
  { bits: 3, key: 0, value: 10 },
  { bits: 7, key: 1, value: 12 },
  { bits: 3, key: 2, value: 7 },
  { bits: 4, key: 3, value: 3 },
  { bits: 3, key: 4, value: 6 },
  { bits: 3, key: 5, value: 8 },
  { bits: 3, key: 6, value: 9 },
  { bits: 4, key: 7, value: 5 },
  { bits: 4, key: 9, value: 4 },
  { bits: 4, key: 11, value: 1 },
  { bits: 4, key: 15, value: 2 },
  { bits: 5, key: 17, value: 0 },
  { bits: 6, key: 33, value: 11 },
  { bits: 7, key: 65, value: 13 },
] as const

const readHistogramLogCount = (reader: JpegXlBitReader): number => {
  for (const entry of histogramLogCountEntries) {
    if (reader.peekBits(entry.bits) !== entry.key) continue
    reader.skipBits(entry.bits)
    return entry.value - 1
  }
  throw invalidInput('JPEG XL ANS histogram is invalid')
}

const flatHistogram = (length: number): number[] => {
  const count = Math.floor(4_096 / length)
  const remainder = 4_096 % length
  return Array.from({ length }, (_, index) => count + (index < remainder ? 1 : 0))
}

const readJpegXlAnsHistogram = (reader: JpegXlBitReader): number[] => {
  if (reader.readBits(1) !== 0) {
    const count = reader.readBits(1) + 1
    const symbols = Array.from({ length: count }, () => readHistogramVarUint(reader))
    const maximum = symbols.reduce((value, symbol) => Math.max(value, symbol), 0)
    const frequencies = new Array<number>(maximum + 1).fill(0)
    const first = symbols[0]
    if (first === undefined) throw invalidInput('JPEG XL ANS histogram is empty')
    if (count === 1) {
      frequencies[first] = 4_096
      return frequencies
    }
    const second = symbols[1]
    if (second === undefined || second === first)
      throw invalidInput('JPEG XL ANS histogram symbols are invalid')
    frequencies[first] = reader.readBits(12)
    frequencies[second] = 4_096 - frequencies[first]
    return frequencies
  }
  if (reader.readBits(1) !== 0) {
    const alphabetSize = readHistogramVarUint(reader) + 1
    if (alphabetSize > 4_096) throw invalidInput('JPEG XL flat ANS histogram is too large')
    return flatHistogram(alphabetSize)
  }
  let log = 0
  while (log < 3 && reader.readBits(1) !== 0) log += 1
  const shift = (reader.readBits(log) | (2 ** log)) - 1
  if (shift > 13) throw invalidInput('JPEG XL ANS histogram shift is invalid')
  const length = readHistogramVarUint(reader) + 3
  const frequencies = new Array<number>(length).fill(0)
  const logCounts = new Array<number>(length).fill(0)
  const repeats = new Array<number>(length).fill(0)
  let omittedLog = -1
  let omittedPosition = -1
  for (let index = 0; index < length; index += 1) {
    const logCount = readHistogramLogCount(reader)
    logCounts[index] = logCount
    if (logCount === 12) {
      const repeatLength = readHistogramVarUint(reader)
      repeats[index] = repeatLength + 5
      index += repeatLength + 3
      continue
    }
    if (logCount > omittedLog) {
      omittedLog = logCount
      omittedPosition = index
    }
  }
  if (omittedPosition < 0 || logCounts[omittedPosition + 1] === 12) {
    throw invalidInput('JPEG XL ANS histogram has no omitted symbol')
  }
  let total = 0
  let previous = 0
  let remainingRepeats = 0
  for (let index = 0; index < length; index += 1) {
    const repeat = repeats[index] ?? 0
    if (repeat !== 0) {
      remainingRepeats = repeat - 1
      previous = index > 0 ? (frequencies[index - 1] ?? 0) : 0
    }
    let frequency = 0
    if (remainingRepeats > 0) {
      frequency = previous
      remainingRepeats -= 1
    } else {
      const code = logCounts[index] ?? -1
      if (index !== omittedPosition && code >= 0) {
        if (shift === 0 || code === 0) {
          frequency = 2 ** code
        } else {
          const precision = Math.max(0, Math.min(code, shift - ((12 - code) >>> 1)))
          frequency = 2 ** code + reader.readBits(precision) * 2 ** (code - precision)
        }
      }
    }
    frequencies[index] = frequency
    total += frequency
  }
  frequencies[omittedPosition] = 4_096 - total
  if ((frequencies[omittedPosition] ?? 0) <= 0)
    throw invalidInput('JPEG XL ANS histogram frequencies are invalid')
  return frequencies
}

const buildAliasTable = (
  frequenciesInput: readonly number[],
  logAlphabetSize: number,
): JpegXlAliasTable => {
  const frequencies = [...frequenciesInput]
  while (frequencies.length > 0 && frequencies[frequencies.length - 1] === 0) frequencies.pop()
  if (frequencies.length === 0) frequencies.push(4_096)
  const tableSize = 2 ** logAlphabetSize
  if (frequencies.length > tableSize) throw invalidInput('JPEG XL ANS alphabet is too large')
  const entrySize = 4_096 / tableSize
  const cutoff = new Array<number>(tableSize).fill(0)
  const rightSymbol = new Array<number>(tableSize).fill(0)
  const rightOffset = new Array<number>(tableSize).fill(0)
  const singleSymbol = frequencies.indexOf(4_096)
  if (singleSymbol >= 0) {
    return Object.freeze({
      entries: Object.freeze(
        Array.from({ length: tableSize }, (_, index) =>
          Object.freeze({
            cutoff: 0,
            rightSymbol: singleSymbol,
            leftFrequency: 0,
            rightFrequency: 4_096,
            rightOffset: entrySize * index,
          }),
        ),
      ),
      logEntrySize: 12 - logAlphabetSize,
      entryMask: entrySize - 1,
    })
  }
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
    if (over === undefined || under === undefined)
      throw invalidInput('JPEG XL ANS alias table is invalid')
    const missing = entrySize - (cutoff[under] ?? 0)
    cutoff[over] = (cutoff[over] ?? 0) - missing
    rightSymbol[under] = over
    rightOffset[under] = cutoff[over] ?? 0
    if ((cutoff[over] ?? 0) < entrySize) underfull.push(over)
    else if ((cutoff[over] ?? 0) > entrySize) overfull.push(over)
  }
  const entries = Array.from({ length: tableSize }, (_, index): JpegXlAliasEntry => {
    const currentCutoff = cutoff[index] ?? 0
    if (currentCutoff === entrySize) {
      return Object.freeze({
        cutoff: 0,
        rightSymbol: index,
        leftFrequency: frequencies[index] ?? 0,
        rightFrequency: frequencies[index] ?? 0,
        rightOffset: 0,
      })
    }
    const right = rightSymbol[index] ?? 0
    return Object.freeze({
      cutoff: currentCutoff,
      rightSymbol: right,
      leftFrequency: frequencies[index] ?? 0,
      rightFrequency: frequencies[right] ?? 0,
      rightOffset: (rightOffset[index] ?? 0) - currentCutoff,
    })
  })
  return Object.freeze({
    entries: Object.freeze(entries),
    logEntrySize: 12 - logAlphabetSize,
    entryMask: entrySize - 1,
  })
}

const readContextMap = (
  reader: JpegXlBitReader,
  contexts: number,
  recursionDepth: number,
): { readonly contextMap: readonly number[]; readonly histogramCount: number } => {
  if (reader.readBits(1) !== 0) {
    const bitsPerEntry = reader.readBits(2)
    const contextMap = Array.from({ length: contexts }, () => reader.readBits(bitsPerEntry))
    return Object.freeze({
      contextMap: Object.freeze(contextMap),
      histogramCount: verifyContextMap(contextMap),
    })
  }
  if (recursionDepth >= 4) throw invalidInput('JPEG XL context map nesting is too deep')
  const useMoveToFront = reader.readBits(1) !== 0
  const sink = readJpegXlEntropyCode(reader, 1, recursionDepth + 1)
  const symbolReader = new JpegXlEntropySymbolReader(sink)
  const contextMap = Array.from({ length: contexts }, () => symbolReader.readHybridUint(0, reader))
  if (useMoveToFront) inverseMoveToFront(contextMap)
  return Object.freeze({
    contextMap: Object.freeze(contextMap),
    histogramCount: verifyContextMap(contextMap),
  })
}

export const readJpegXlEntropyCode = (
  reader: JpegXlBitReader,
  contexts: number,
  recursionDepth = 0,
): JpegXlEntropyCode => {
  if (!Number.isInteger(contexts) || contexts < 1 || contexts > 65_536) {
    throw invalidInput('JPEG XL entropy context count is invalid')
  }
  const lz77Fields = readLz77Fields(reader)
  const lengthConfig = lz77Fields.enabled
    ? readJpegXlHybridUintConfig(reader, 8)
    : Object.freeze({
        splitExponent: 0,
        splitToken: 1,
        msbInToken: 0,
        lsbInToken: 0,
      })
  const mapped =
    contexts + (lz77Fields.enabled ? 1 : 0) > 1
      ? readContextMap(reader, contexts + (lz77Fields.enabled ? 1 : 0), recursionDepth)
      : Object.freeze({ contextMap: Object.freeze([0]), histogramCount: 1 })
  const usePrefixCode = reader.readBits(1) !== 0
  const logAlphabetSize = usePrefixCode ? 15 : reader.readBits(2) + 5
  const uintConfigs = Array.from({ length: mapped.histogramCount }, () =>
    readJpegXlHybridUintConfig(reader, logAlphabetSize),
  )
  const huffmanCodes = usePrefixCode
    ? Array.from({ length: mapped.histogramCount }, () => readJpegXlVarUint16(reader) + 1).map(
        (alphabetSize) =>
          alphabetSize === 1
            ? buildHuffmanCode([0], [0])
            : readJpegXlHuffmanCode(reader, alphabetSize),
      )
    : undefined
  const aliasTables = usePrefixCode
    ? undefined
    : Object.freeze(
        Array.from({ length: mapped.histogramCount }, () =>
          buildAliasTable(readJpegXlAnsHistogram(reader), logAlphabetSize),
        ),
      )
  const distanceContext = mapped.contextMap[mapped.contextMap.length - 1]
  if (distanceContext === undefined) throw invalidInput('JPEG XL distance context is missing')
  return Object.freeze({
    contextMap: mapped.contextMap,
    uintConfigs: Object.freeze(uintConfigs),
    huffmanCodes: huffmanCodes ? Object.freeze(huffmanCodes) : undefined,
    aliasTables,
    lz77: Object.freeze({
      enabled: lz77Fields.enabled,
      minimumSymbol: lz77Fields.minimumSymbol,
      minimumLength: lz77Fields.minimumLength,
      lengthConfig,
      distanceContext,
    }),
  })
}

// Signed (x, y) offsets for JPEG XL's 120 format-defined LZ77 special distances.
const jpegXlSpecialDistances = new Int8Array([
  0, 1, 1, 0, 1, 1, -1, 1, 0, 2, 2, 0, 1, 2, -1, 2, 2, 1, -2, 1, 2, 2, -2, 2, 0, 3, 3, 0, 1, 3, -1,
  3, 3, 1, -3, 1, 2, 3, -2, 3, 3, 2, -3, 2, 0, 4, 4, 0, 1, 4, -1, 4, 4, 1, -4, 1, 3, 3, -3, 3, 2, 4,
  -2, 4, 4, 2, -4, 2, 0, 5, 3, 4, -3, 4, 4, 3, -4, 3, 5, 0, 1, 5, -1, 5, 5, 1, -5, 1, 2, 5, -2, 5,
  5, 2, -5, 2, 4, 4, -4, 4, 3, 5, -3, 5, 5, 3, -5, 3, 0, 6, 6, 0, 1, 6, -1, 6, 6, 1, -6, 1, 2, 6,
  -2, 6, 6, 2, -6, 2, 4, 5, -4, 5, 5, 4, -5, 4, 3, 6, -3, 6, 6, 3, -6, 3, 0, 7, 7, 0, 1, 7, -1, 7,
  5, 5, -5, 5, 7, 1, -7, 1, 4, 6, -4, 6, 6, 4, -6, 4, 2, 7, -2, 7, 7, 2, -7, 2, 3, 7, -3, 7, 7, 3,
  -7, 3, 5, 6, -5, 6, 6, 5, -6, 5, 8, 0, 4, 7, -4, 7, 7, 4, -7, 4, 8, 1, 8, 2, 6, 6, -6, 6, 8, 3, 5,
  7, -5, 7, 7, 5, -7, 5, 8, 4, 6, 7, -6, 7, 7, 6, -7, 6, 8, 5, 7, 7, -7, 7, 8, 6, 8, 7,
])
const JPEG_XL_SPECIAL_DISTANCE_COUNT = jpegXlSpecialDistances.length / 2

const jpegXlSpecialDistance = (index: number, multiplier: number): number =>
  Math.max(
    1,
    (jpegXlSpecialDistances[index * 2] ?? 0) +
      multiplier * (jpegXlSpecialDistances[index * 2 + 1] ?? 0),
  )

export class JpegXlEntropySymbolReader {
  readonly #code: JpegXlEntropyCode
  readonly #maximumSymbols: number
  readonly #window: Uint32Array | undefined
  readonly #windowMask: number
  readonly #distanceMultiplier: number
  #symbolsRead = 0
  #windowLength = 0
  #writePosition = 0
  #copyPosition = 0
  #remainingCopies = 0
  #ansState: number | undefined

  constructor(code: JpegXlEntropyCode, maximumSymbols = 67_108_864, distanceMultiplier = 0) {
    if (!Number.isSafeInteger(maximumSymbols) || maximumSymbols < 1) {
      throw invalidInput('JPEG XL entropy symbol limit is invalid')
    }
    if (!Number.isSafeInteger(distanceMultiplier) || distanceMultiplier < 0) {
      throw invalidInput('JPEG XL LZ77 distance multiplier is invalid')
    }
    this.#code = code
    this.#maximumSymbols = maximumSymbols
    this.#distanceMultiplier = distanceMultiplier
    const windowCapacity = 2 ** Math.ceil(Math.log2(Math.min(maximumSymbols, 1_048_576)))
    this.#window = code.lz77.enabled ? new Uint32Array(windowCapacity) : undefined
    this.#windowMask = windowCapacity - 1
  }

  hasValidFinalState(): boolean {
    return this.#ansState === undefined || this.#ansState === 0x13_0000
  }

  readHybridUint(context: number, reader: JpegXlBitReader): number {
    if (this.#symbolsRead >= this.#maximumSymbols) {
      throw invalidInput('JPEG XL entropy stream exceeds its symbol limit')
    }
    this.#symbolsRead += 1
    return this.#readHybridUint(context, reader)
  }

  #readHybridUint(context: number, reader: JpegXlBitReader): number {
    if (this.#remainingCopies > 0) {
      const copied = this.#window?.[this.#copyPosition]
      if (copied === undefined) throw invalidInput('JPEG XL LZ77 reference is invalid')
      this.#copyPosition = (this.#copyPosition + 1) & this.#windowMask
      this.#remainingCopies -= 1
      this.#append(copied)
      return copied
    }
    const histogram = this.#code.contextMap[context]
    if (histogram === undefined) throw invalidInput('JPEG XL entropy context is invalid')
    const token = this.#readToken(histogram, reader)
    if (this.#code.lz77.enabled && token >= this.#code.lz77.minimumSymbol) {
      this.#remainingCopies =
        readJpegXlHybridUint(
          reader,
          this.#code.lz77.lengthConfig,
          token - this.#code.lz77.minimumSymbol,
        ) + this.#code.lz77.minimumLength
      if (this.#remainingCopies > this.#maximumSymbols - this.#symbolsRead + 1) {
        throw invalidInput('JPEG XL LZ77 run exceeds the entropy symbol limit')
      }
      const distanceToken = this.#readToken(this.#code.lz77.distanceContext, reader)
      const distanceConfig = this.#code.uintConfigs[this.#code.lz77.distanceContext]
      if (!distanceConfig) throw invalidInput('JPEG XL LZ77 distance configuration is missing')
      const distanceCode = readJpegXlHybridUint(reader, distanceConfig, distanceToken)
      const distance =
        this.#distanceMultiplier === 0
          ? distanceCode + 1
          : distanceCode < JPEG_XL_SPECIAL_DISTANCE_COUNT
            ? jpegXlSpecialDistance(distanceCode, this.#distanceMultiplier)
            : distanceCode + 1 - JPEG_XL_SPECIAL_DISTANCE_COUNT
      const windowCapacity = this.#window?.length ?? 1_048_576
      if (distance > this.#windowLength || distance > windowCapacity) {
        throw invalidInput('JPEG XL LZ77 distance is invalid')
      }
      this.#copyPosition = (this.#writePosition - distance + windowCapacity) & this.#windowMask
      return this.#readHybridUint(context, reader)
    }
    const config = this.#code.uintConfigs[histogram]
    if (!config) throw invalidInput('JPEG XL hybrid integer configuration is missing')
    const value = readJpegXlHybridUint(reader, config, token)
    if (this.#code.lz77.enabled) this.#append(value)
    return value
  }

  #readToken(histogram: number, reader: JpegXlBitReader): number {
    const huffman = this.#code.huffmanCodes?.[histogram]
    if (huffman) return huffman.readSymbol(reader)
    const alias = this.#code.aliasTables?.[histogram]
    if (!alias) throw invalidInput('JPEG XL entropy histogram is missing')
    if (this.#ansState === undefined) this.#ansState = reader.readBits(32)
    const residual = this.#ansState & 4_095
    const index = residual >>> alias.logEntrySize
    const position = residual & alias.entryMask
    const entry = alias.entries[index]
    if (!entry) throw invalidInput('JPEG XL ANS state is invalid')
    const right = position >= entry.cutoff
    const symbol = right ? entry.rightSymbol : index
    const frequency = right ? entry.rightFrequency : entry.leftFrequency
    const offset = position + (right ? entry.rightOffset : 0)
    this.#ansState = (frequency * Math.floor(this.#ansState / 4_096) + offset) >>> 0
    if (this.#ansState < 65_536) {
      this.#ansState = (this.#ansState * 65_536 + reader.readBits(16)) >>> 0
    }
    return symbol
  }

  #append(value: number): void {
    if (!this.#window) throw invalidInput('JPEG XL LZ77 window is missing')
    this.#window[this.#writePosition] = value
    this.#writePosition = (this.#writePosition + 1) & this.#windowMask
    this.#windowLength = Math.min(this.#window.length, this.#windowLength + 1)
  }
}
