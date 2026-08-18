import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'

export interface JpegLosslessDecodeOptions {
  readonly requiredSelection?: number
}

export interface JpegLosslessFrame {
  readonly width: number
  readonly height: number
  readonly precision: number
  readonly selection: number
  readonly pointTransform: number
  readonly samplesLittleEndian: Uint8Array
}

interface HuffmanTable {
  readonly counts: Uint8Array
  readonly symbols: Uint8Array
  readonly firstCodes: Int32Array
  readonly firstSymbols: Int32Array
  readonly fastLengths: Uint8Array
  readonly fastSymbols: Uint8Array
}

const byte = (data: ArrayLike<number>, index: number): number => data[index] ?? 0

const readUint16 = (data: Uint8Array, offset: number): number => {
  if (offset + 2 > data.byteLength) throw truncatedInput('JPEG lossless segment is truncated')
  return (byte(data, offset) << 8) | byte(data, offset + 1)
}

const huffmanTable = (counts: Uint8Array, symbols: Uint8Array): HuffmanTable => {
  const firstCodes = new Int32Array(16)
  const firstSymbols = new Int32Array(16)
  const fastLengths = new Uint8Array(256)
  const fastSymbols = new Uint8Array(256)
  let code = 0
  let symbol = 0
  for (let index = 0; index < 16; index += 1) {
    const count = byte(counts, index)
    const length = index + 1
    firstCodes[index] = code
    firstSymbols[index] = symbol
    if (code + count > 1 << (index + 1)) {
      throw invalidInput('JPEG lossless Huffman table is oversubscribed')
    }
    if (length <= 8) {
      const suffixCount = 1 << (8 - length)
      for (let symbolOffset = 0; symbolOffset < count; symbolOffset += 1) {
        const prefix = (code + symbolOffset) * suffixCount
        const value = byte(symbols, symbol + symbolOffset)
        for (let suffix = 0; suffix < suffixCount; suffix += 1) {
          const entry = prefix + suffix
          fastLengths[entry] = length
          fastSymbols[entry] = value
        }
      }
    }
    code = (code + count) << 1
    symbol += count
  }
  return { counts, symbols, firstCodes, firstSymbols, fastLengths, fastSymbols }
}

const parseHuffmanTables = (
  data: Uint8Array,
  start: number,
  end: number,
  dcTables: Map<number, HuffmanTable>,
): void => {
  let offset = start
  while (offset < end) {
    const specification = byte(data, offset)
    offset += 1
    if (offset + 16 > end) throw truncatedInput('JPEG lossless Huffman table counts are truncated')
    const counts = data.subarray(offset, offset + 16)
    offset += 16
    let symbolCount = 0
    for (const count of counts) symbolCount += count
    if (symbolCount < 1 || offset + symbolCount > end) {
      throw truncatedInput('JPEG lossless Huffman table symbols are truncated')
    }
    const tableClass = specification >>> 4
    if (tableClass !== 0) {
      throw unsupportedOperation('JPEG lossless AC Huffman tables are unsupported')
    }
    dcTables.set(
      specification & 15,
      huffmanTable(counts, data.subarray(offset, offset + symbolCount)),
    )
    offset += symbolCount
  }
}

class LosslessBitReader {
  readonly #data: Uint8Array
  #offset: number
  #bits = 0
  #bitCount = 0

  constructor(data: Uint8Array, offset: number) {
    this.#data = data
    this.#offset = offset
  }

  align(): void {
    this.#bits = 0
    this.#bitCount = 0
  }

  consumeRestart(expected: number): void {
    this.align()
    if (
      this.#offset + 1 >= this.#data.byteLength ||
      byte(this.#data, this.#offset) !== 0xff ||
      byte(this.#data, this.#offset + 1) !== expected
    ) {
      throw invalidInput('JPEG lossless restart marker is missing')
    }
    this.#offset += 2
  }

  #fillBits(): void {
    if (this.#offset >= this.#data.byteLength)
      throw truncatedInput('JPEG lossless entropy is truncated')
    const value = byte(this.#data, this.#offset)
    this.#offset += 1
    if (value === 0xff) {
      if (this.#offset >= this.#data.byteLength) {
        throw truncatedInput('JPEG lossless byte stuffing is truncated')
      }
      const stuffed = byte(this.#data, this.#offset)
      this.#offset += 1
      if (stuffed !== 0) {
        throw invalidInput(`Unexpected JPEG lossless marker ff${stuffed.toString(16)}`)
      }
    }
    if (this.#bitCount === 0) this.#bits = 0
    this.#bits = ((this.#bits << 8) | value) >>> 0
    this.#bitCount += 8
  }

  readBit(): number {
    if (this.#bitCount === 0) this.#fillBits()
    this.#bitCount -= 1
    return (this.#bits >>> this.#bitCount) & 1
  }

  readBits(length: number): number {
    let value = 0
    for (let index = 0; index < length; index += 1) value = (value << 1) | this.readBit()
    return value
  }

  peekBits(length: number): number | undefined {
    if (length <= 0) return 0
    if (this.#bitCount >= length) {
      return (this.#bits >>> (this.#bitCount - length)) & ((1 << length) - 1)
    }
    const savedOffset = this.#offset
    const savedBits = this.#bits
    const savedCount = this.#bitCount
    try {
      return this.readBits(length)
    } catch {
      return undefined
    } finally {
      this.#offset = savedOffset
      this.#bits = savedBits
      this.#bitCount = savedCount
    }
  }

  skipBits(length: number): void {
    for (let index = 0; index < length; index += 1) this.readBit()
  }

  receiveAndExtend(length: number): number {
    if (length === 0) return 0
    if (length > 16) throw invalidInput('JPEG lossless difference category is invalid')
    const value = this.readBits(length)
    const threshold = 1 << (length - 1)
    return value < threshold ? value + ((-1 << length) + 1) : value
  }
}

const decodeHuffman = (reader: LosslessBitReader, table: HuffmanTable): number => {
  const prefix = reader.peekBits(8)
  if (prefix !== undefined) {
    const length = byte(table.fastLengths, prefix)
    if (length !== 0) {
      reader.skipBits(length)
      return byte(table.fastSymbols, prefix)
    }
  }
  let code = 0
  for (let length = 0; length < 16; length += 1) {
    code = (code << 1) | reader.readBit()
    const count = byte(table.counts, length)
    const firstCode = table.firstCodes[length]
    const firstSymbol = table.firstSymbols[length]
    if (firstCode === undefined || firstSymbol === undefined) continue
    const offset = code - firstCode
    if (offset >= 0 && offset < count) {
      const symbol = table.symbols[firstSymbol + offset]
      if (symbol === undefined) throw invalidInput('JPEG lossless Huffman symbol is missing')
      return symbol
    }
  }
  throw invalidInput('JPEG lossless Huffman code is invalid')
}

const predict = (selection: number, ra: number, rb: number, rc: number): number => {
  switch (selection) {
    case 1:
      return ra
    case 2:
      return rb
    case 3:
      return rc
    case 4:
      return ra + rb - rc
    case 5:
      return ra + ((rb - rc) >> 1)
    case 6:
      return rb + ((ra - rc) >> 1)
    case 7:
      return (ra + rb) >> 1
    default:
      throw unsupportedOperation(`JPEG lossless selection value ${selection} is unsupported`)
  }
}

const skipSegment = (data: Uint8Array, offset: number): number => {
  const length = readUint16(data, offset)
  if (length < 2) throw invalidInput('JPEG lossless segment length is invalid')
  const end = offset + length
  if (end > data.byteLength) throw truncatedInput('JPEG lossless segment is truncated')
  return end
}

export const decodeJpegLosslessFrame = (
  encoded: Uint8Array,
  options: Readonly<JpegLosslessDecodeOptions> = {},
): JpegLosslessFrame => {
  if (encoded.byteLength < 4 || byte(encoded, 0) !== 0xff || byte(encoded, 1) !== 0xd8) {
    throw invalidInput('JPEG lossless frame is missing SOI')
  }
  const dcTables = new Map<number, HuffmanTable>()
  let width = 0
  let height = 0
  let precision = 0
  let componentId = 1
  let sawFrame = false
  let restartInterval = 0
  let offset = 2
  let scanOffset = -1
  let tableId = 0
  let selection = 1
  let pointTransform = 0

  while (offset + 1 < encoded.byteLength) {
    if (byte(encoded, offset) !== 0xff) throw invalidInput('JPEG lossless marker is missing')
    offset += 1
    let marker = byte(encoded, offset)
    offset += 1
    while (marker === 0xff && offset < encoded.byteLength) {
      marker = byte(encoded, offset)
      offset += 1
    }
    if (marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const start = offset + 2
    const end = skipSegment(encoded, offset)
    if (marker === 0xc3) {
      if (end - start < 6) throw truncatedInput('JPEG lossless frame header is truncated')
      precision = byte(encoded, start)
      height = readUint16(encoded, start + 1)
      width = readUint16(encoded, start + 3)
      const components = byte(encoded, start + 5)
      if (precision < 2 || precision > 16) {
        throw unsupportedOperation(`JPEG lossless precision ${precision} is unsupported`)
      }
      if (components !== 1) {
        throw unsupportedOperation('JPEG lossless color scans are unsupported')
      }
      if (end - start !== 9) throw invalidInput('JPEG lossless frame header is invalid')
      componentId = byte(encoded, start + 6)
      const sampling = byte(encoded, start + 7)
      const quantization = byte(encoded, start + 8)
      if (sampling >>> 4 !== 1 || (sampling & 15) !== 1) {
        throw unsupportedOperation('JPEG lossless non-1:1 sampling is unsupported')
      }
      if (quantization !== 0)
        throw invalidInput('JPEG lossless quantization table selector must be 0')
      sawFrame = true
    } else if (marker === 0xc4) {
      parseHuffmanTables(encoded, start, end, dcTables)
    } else if (marker === 0xdd) {
      if (end - start !== 2) throw invalidInput('JPEG lossless restart interval is invalid')
      restartInterval = readUint16(encoded, start)
    } else if (marker === 0xda) {
      if (!sawFrame) throw invalidInput('JPEG lossless scan precedes SOF3')
      if (end - start < 6) throw truncatedInput('JPEG lossless scan header is truncated')
      const scanComponents = byte(encoded, start)
      if (scanComponents !== 1) {
        throw unsupportedOperation('JPEG lossless interleaved scans are unsupported')
      }
      if (end - start !== 6) throw invalidInput('JPEG lossless scan header is invalid')
      if (byte(encoded, start + 1) !== componentId) {
        throw invalidInput('JPEG lossless scan component does not match SOF3')
      }
      const selectors = byte(encoded, start + 2)
      tableId = selectors >>> 4
      if ((selectors & 15) !== 0) {
        throw invalidInput('JPEG lossless AC table selector must be 0')
      }
      selection = byte(encoded, start + 3)
      const endSpectral = byte(encoded, start + 4)
      const approximation = byte(encoded, start + 5)
      if (endSpectral !== 0 || approximation >>> 4 !== 0) {
        throw invalidInput('JPEG lossless scan spectral selection is invalid')
      }
      pointTransform = approximation & 15
      if (options.requiredSelection !== undefined && selection !== options.requiredSelection) {
        throw unsupportedOperation(
          `JPEG lossless selection value ${selection} is unsupported for this transfer syntax`,
        )
      }
      if (selection < 1 || selection > 7) {
        throw unsupportedOperation(`JPEG lossless selection value ${selection} is unsupported`)
      }
      scanOffset = end
      break
    } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      throw unsupportedOperation('JPEG lossless decoder does not accept DCT frames')
    } else if (marker >= 0xc5 && marker <= 0xcf && marker !== 0xc8) {
      throw unsupportedOperation(
        `JPEG frame marker 0x${marker.toString(16)} is unsupported by the lossless decoder`,
      )
    }
    offset = end
  }

  if (!sawFrame || scanOffset < 0) throw invalidInput('JPEG lossless SOF3 scan is missing')
  if (width < 1 || height < 1) throw invalidInput('JPEG lossless dimensions are invalid')
  const table = dcTables.get(tableId)
  if (table === undefined) throw invalidInput('JPEG lossless Huffman table is missing')
  if (pointTransform >= precision) {
    throw invalidInput('JPEG lossless point transform exceeds sample precision')
  }

  const reader = new LosslessBitReader(encoded, scanOffset)
  const sampleCount = width * height
  const samples = new Int32Array(sampleCount)
  const mask = (1 << precision) - 1
  const firstPredictor = 1 << (precision - pointTransform - 1)
  let samplesSinceRestart = 0
  let restart = 0
  let restartLine = true

  for (let index = 0; index < sampleCount; index += 1) {
    if (restartInterval > 0 && samplesSinceRestart === restartInterval) {
      reader.consumeRestart(0xd0 + (restart & 7))
      restart += 1
      samplesSinceRestart = 0
      restartLine = true
    }
    const x = index % width
    let predicted: number
    if (samplesSinceRestart === 0) {
      predicted = firstPredictor
    } else if (restartLine || Math.floor(index / width) === 0) {
      predicted = samples[index - 1] ?? 0
    } else if (x === 0) {
      predicted = samples[index - width] ?? 0
    } else {
      predicted = predict(
        selection,
        samples[index - 1] ?? 0,
        samples[index - width] ?? 0,
        samples[index - width - 1] ?? 0,
      )
    }
    const category = decodeHuffman(reader, table)
    const diff = reader.receiveAndExtend(category)
    samples[index] = (predicted + diff) & mask
    samplesSinceRestart += 1
    if (x === width - 1) restartLine = false
  }

  const bytesPerSample = precision <= 8 ? 1 : 2
  const output = new Uint8Array(sampleCount * bytesPerSample)
  for (let index = 0; index < sampleCount; index += 1) {
    const value = (samples[index] ?? 0) << pointTransform
    if (bytesPerSample === 1) {
      output[index] = value & 0xff
    } else {
      output[index * 2] = value & 0xff
      output[index * 2 + 1] = (value >> 8) & 0xff
    }
  }
  return Object.freeze({
    width,
    height,
    precision,
    selection,
    pointTransform,
    samplesLittleEndian: output,
  })
}
