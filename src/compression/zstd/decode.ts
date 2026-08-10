import {
  ImageError,
  invalidInput,
  limitExceeded,
  truncatedInput,
  unsupportedOperation,
} from '../../errors.ts'
import { ReverseBitReader } from './bitstream.ts'
import {
  buildFseTable,
  decodeFseSymbol,
  initialFseState,
  parseFseTable,
  rleFseTable,
  type FseTable,
} from './fse.ts'
import { decodeHuffmanStream, parseHuffmanTable, type HuffmanTable } from './huffman.ts'
import { xxhash64Low32 } from './xxhash64.ts'

const zstandardMagic = 0xfd2f_b528
const skippableMagicMinimum = 0x184d_2a50
const skippableMagicMaximum = 0x184d_2a5f
const maximumBlockBytes = 128 * 1024
const defaultMaximumOutputBytes = 64 * 1024 * 1024
const defaultMaximumWindowBytes = 64 * 1024 * 1024
const maximumArrayBytes = 0x7fff_ffff

const literalLengthBaselines = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128,
  256, 512, 1024, 2048, 4096, 8192, 16_384, 32_768, 65_536,
] as const
const literalLengthBits = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12,
  13, 14, 15, 16,
] as const
const matchLengthBaselines = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
  29, 30, 31, 32, 33, 34, 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051,
  4099, 8195, 16_387, 32_771, 65_539,
] as const
const matchLengthBits = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
  1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
] as const

const predefinedLiteralLengths = buildFseTable(
  [
    4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1,
    -1, -1, -1, -1,
  ],
  6,
)
const predefinedMatchLengths = buildFseTable(
  [
    1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1,
  ],
  6,
)
const predefinedOffsets = buildFseTable(
  [1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1],
  5,
)

export interface ZstdDecodeOptions {
  readonly maxOutputBytes?: number
  readonly expectedOutputBytes?: number
  readonly maxWindowBytes?: number
}

interface DecoderOptions {
  readonly maxOutputBytes: number
  readonly expectedOutputBytes?: number
  readonly maxWindowBytes: number
}

interface EntropyState {
  huffman?: HuffmanTable
  literalLengths?: FseTable
  offsets?: FseTable
  matchLengths?: FseTable
}

class OutputBuffer {
  private data: Uint8Array
  private readonly maximumLength: number
  length = 0

  constructor(initialCapacity: number, maximumLength: number) {
    this.data = new Uint8Array(initialCapacity)
    this.maximumLength = maximumLength
  }

  appendRepeated(value: number, count: number, blockLimit: number): void {
    this.reserve(this.length + count, blockLimit)
    this.data.fill(value, this.length, this.length + count)
    this.length += count
  }

  append(data: Uint8Array, start: number, count: number, blockLimit: number): void {
    if (start < 0 || count < 0 || start + count > data.byteLength) {
      throw invalidInput('Invalid Zstandard literal copy bounds')
    }
    this.reserve(this.length + count, blockLimit)
    this.data.set(data.subarray(start, start + count), this.length)
    this.length += count
  }

  copyMatch(
    offset: number,
    count: number,
    frameStart: number,
    windowSize: number,
    blockLimit: number,
  ): void {
    if (!Number.isSafeInteger(offset) || offset <= 0 || offset > windowSize) {
      throw invalidInput('Invalid Zstandard match offset')
    }
    if (offset > this.length - frameStart) {
      throw invalidInput('Zstandard match offset precedes frame history')
    }
    this.reserve(this.length + count, blockLimit)
    for (let index = 0; index < count; index += 1) {
      this.data[this.length] = this.data[this.length - offset] ?? 0
      this.length += 1
    }
  }

  view(start = 0, end = this.length): Uint8Array {
    return this.data.subarray(start, end)
  }

  finish(): Uint8Array {
    return this.view()
  }

  private reserve(required: number, blockLimit: number): void {
    if (!Number.isSafeInteger(required) || required < this.length) {
      throw limitExceeded('Zstandard output size arithmetic overflow')
    }
    if (required > blockLimit) {
      throw invalidInput('Zstandard block exceeds its declared output limit')
    }
    if (required > this.maximumLength) {
      throw limitExceeded('Zstandard output exceeds maxOutputBytes')
    }
    if (required <= this.data.byteLength) return

    let capacity = Math.max(1024, this.data.byteLength * 2)
    capacity = Math.min(this.maximumLength, Math.max(required, capacity))
    const grown = new Uint8Array(capacity)
    grown.set(this.data.subarray(0, this.length))
    this.data = grown
  }
}

const requireBytes = (offset: number, count: number, end: number, label: string): void => {
  if (!Number.isSafeInteger(offset + count) || count < 0 || offset < 0 || offset + count > end) {
    throw truncatedInput(`Truncated Zstandard ${label}`)
  }
}

const readUint32Le = (data: Uint8Array, offset: number): number =>
  ((data[offset] ?? 0) |
    ((data[offset + 1] ?? 0) << 8) |
    ((data[offset + 2] ?? 0) << 16) |
    ((data[offset + 3] ?? 0) << 24)) >>>
  0

const readLittleEndian = (data: Uint8Array, offset: number, size: number, end: number): number => {
  requireBytes(offset, size, end, 'integer field')
  let value = 0n
  for (let index = 0; index < size; index += 1) {
    value |= BigInt(data[offset + index] ?? 0) << BigInt(index * 8)
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw limitExceeded('Zstandard integer field exceeds JavaScript safe range')
  }
  return Number(value)
}

const validateLimit = (value: number | undefined, fallback: number, name: string): number => {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > maximumArrayBytes) {
    throw invalidInput(
      `${name} must be a non-negative safe integer no larger than ${maximumArrayBytes}`,
    )
  }
  return resolved
}

const normalizeOptions = (options: ZstdDecodeOptions): DecoderOptions => {
  const maxOutputBytes = validateLimit(
    options.maxOutputBytes,
    defaultMaximumOutputBytes,
    'maxOutputBytes',
  )
  const maxWindowBytes = validateLimit(
    options.maxWindowBytes,
    defaultMaximumWindowBytes,
    'maxWindowBytes',
  )
  const expectedOutputBytes = options.expectedOutputBytes
  if (
    expectedOutputBytes !== undefined &&
    (!Number.isSafeInteger(expectedOutputBytes) ||
      expectedOutputBytes < 0 ||
      expectedOutputBytes > maxOutputBytes)
  ) {
    throw invalidInput('expectedOutputBytes must be within maxOutputBytes')
  }
  return expectedOutputBytes === undefined
    ? { maxOutputBytes, maxWindowBytes }
    : { maxOutputBytes, maxWindowBytes, expectedOutputBytes }
}

const parseLiteralSection = (
  data: Uint8Array,
  start: number,
  end: number,
  entropy: EntropyState,
  blockMaximum: number,
): { readonly literals: Uint8Array; readonly nextOffset: number } => {
  const first = data[start]
  if (first === undefined || start >= end)
    throw truncatedInput('Truncated Zstandard literals section')
  const type = first & 3
  const sizeFormat = (first >>> 2) & 3

  let headerBytes: number
  let regeneratedSize: number
  let compressedSize = 0
  let streamCount = 1
  if (type <= 1) {
    if (sizeFormat === 0 || sizeFormat === 2) {
      headerBytes = 1
      regeneratedSize = first >>> 3
    } else if (sizeFormat === 1) {
      headerBytes = 2
      requireBytes(start, headerBytes, end, 'literals header')
      regeneratedSize = ((data[start] ?? 0) | ((data[start + 1] ?? 0) << 8)) >>> 4
    } else {
      headerBytes = 3
      requireBytes(start, headerBytes, end, 'literals header')
      regeneratedSize =
        ((data[start] ?? 0) | ((data[start + 1] ?? 0) << 8) | ((data[start + 2] ?? 0) << 16)) >>> 4
    }
  } else if (sizeFormat <= 1) {
    headerBytes = 3
    requireBytes(start, headerBytes, end, 'literals header')
    const header =
      (data[start] ?? 0) | ((data[start + 1] ?? 0) << 8) | ((data[start + 2] ?? 0) << 16)
    regeneratedSize = (header >>> 4) & 0x3ff
    compressedSize = (header >>> 14) & 0x3ff
    streamCount = sizeFormat === 0 ? 1 : 4
  } else if (sizeFormat === 2) {
    headerBytes = 4
    requireBytes(start, headerBytes, end, 'literals header')
    const header = readUint32Le(data, start)
    regeneratedSize = (header >>> 4) & 0x3fff
    compressedSize = (header >>> 18) & 0x3fff
    streamCount = 4
  } else {
    headerBytes = 5
    requireBytes(start, headerBytes, end, 'literals header')
    let header = 0
    for (let index = 0; index < 5; index += 1) {
      header += (data[start + index] ?? 0) * 2 ** (index * 8)
    }
    regeneratedSize = Math.floor(header / 2 ** 4) & 0x3ffff
    compressedSize = Math.floor(header / 2 ** 22) & 0x3ffff
    streamCount = 4
  }

  if (regeneratedSize > blockMaximum) {
    throw invalidInput('Zstandard literals exceed the block maximum')
  }
  const contentStart = start + headerBytes
  const literals = new Uint8Array(regeneratedSize)
  if (type === 0) {
    requireBytes(contentStart, regeneratedSize, end, 'raw literals')
    literals.set(data.subarray(contentStart, contentStart + regeneratedSize))
    return { literals, nextOffset: contentStart + regeneratedSize }
  }
  if (type === 1) {
    requireBytes(contentStart, 1, end, 'RLE literal')
    literals.fill(data[contentStart] ?? 0)
    return { literals, nextOffset: contentStart + 1 }
  }

  requireBytes(contentStart, compressedSize, end, 'compressed literals')
  const contentEnd = contentStart + compressedSize
  let table = entropy.huffman
  let streamsStart = contentStart
  if (type === 2) {
    const parsed = parseHuffmanTable(data, contentStart, contentEnd)
    table = parsed.table
    entropy.huffman = table
    streamsStart += parsed.bytesRead
  } else if (table === undefined) {
    throw invalidInput('Treeless Zstandard literals require a previous Huffman table')
  }

  if (streamCount === 1) {
    if (regeneratedSize > 0) {
      decodeHuffmanStream(data, streamsStart, contentEnd, literals, 0, regeneratedSize, table)
    } else if (streamsStart !== contentEnd) {
      throw invalidInput('Empty Zstandard literals contain compressed data')
    }
  } else {
    requireBytes(streamsStart, 6, contentEnd, 'Huffman jump table')
    const size1 = (data[streamsStart] ?? 0) | ((data[streamsStart + 1] ?? 0) << 8)
    const size2 = (data[streamsStart + 2] ?? 0) | ((data[streamsStart + 3] ?? 0) << 8)
    const size3 = (data[streamsStart + 4] ?? 0) | ((data[streamsStart + 5] ?? 0) << 8)
    const stream1 = streamsStart + 6
    const stream2 = stream1 + size1
    const stream3 = stream2 + size2
    const stream4 = stream3 + size3
    if (stream4 > contentEnd) throw invalidInput('Invalid Zstandard Huffman stream sizes')

    const regeneratedPerStream = Math.ceil(regeneratedSize / 4)
    const fourthSize = regeneratedSize - regeneratedPerStream * 3
    if (fourthSize < 0) throw invalidInput('Invalid Zstandard Huffman output sizes')
    decodeHuffmanStream(data, stream1, stream2, literals, 0, regeneratedPerStream, table)
    decodeHuffmanStream(
      data,
      stream2,
      stream3,
      literals,
      regeneratedPerStream,
      regeneratedPerStream,
      table,
    )
    decodeHuffmanStream(
      data,
      stream3,
      stream4,
      literals,
      regeneratedPerStream * 2,
      regeneratedPerStream,
      table,
    )
    decodeHuffmanStream(
      data,
      stream4,
      contentEnd,
      literals,
      regeneratedPerStream * 3,
      fourthSize,
      table,
    )
  }
  return { literals, nextOffset: contentEnd }
}

const readSequenceCount = (
  data: Uint8Array,
  offset: number,
  end: number,
): { readonly count: number; readonly nextOffset: number } => {
  requireBytes(offset, 1, end, 'sequence count')
  const first = data[offset] ?? 0
  if (first === 0) return { count: 0, nextOffset: offset + 1 }
  if (first < 128) return { count: first, nextOffset: offset + 1 }
  if (first < 255) {
    requireBytes(offset, 2, end, 'sequence count')
    return { count: ((first - 128) << 8) + (data[offset + 1] ?? 0), nextOffset: offset + 2 }
  }
  requireBytes(offset, 3, end, 'sequence count')
  return {
    count: (data[offset + 1] ?? 0) + ((data[offset + 2] ?? 0) << 8) + 0x7f00,
    nextOffset: offset + 3,
  }
}

const parseSequenceTable = (
  mode: number,
  previous: FseTable | undefined,
  predefined: FseTable,
  data: Uint8Array,
  offset: number,
  end: number,
  maxSymbol: number,
  maxAccuracyLog: number,
): { readonly table: FseTable; readonly nextOffset: number } => {
  if (mode === 0) return { table: predefined, nextOffset: offset }
  if (mode === 1) {
    requireBytes(offset, 1, end, 'RLE sequence table')
    const symbol = data[offset] ?? 0
    if (symbol > maxSymbol) throw invalidInput('Zstandard RLE sequence symbol is out of range')
    return { table: rleFseTable(symbol), nextOffset: offset + 1 }
  }
  if (mode === 2) {
    const parsed = parseFseTable(data, offset, end, maxSymbol, maxAccuracyLog)
    return { table: parsed.table, nextOffset: offset + parsed.bytesRead }
  }
  if (previous === undefined) {
    throw invalidInput('Repeated Zstandard FSE mode requires a previous table')
  }
  return { table: previous, nextOffset: offset }
}

const resolveOffset = (
  offsetValue: number,
  literalLength: number,
  repeatedOffsets: number[],
): number => {
  if (offsetValue > 3) {
    const offset = offsetValue - 3
    repeatedOffsets[2] = repeatedOffsets[1] ?? 0
    repeatedOffsets[1] = repeatedOffsets[0] ?? 0
    repeatedOffsets[0] = offset
    return offset
  }

  const repeatIndex = offsetValue - 1 + (literalLength === 0 ? 1 : 0)
  if (repeatIndex < 0) throw invalidInput('Invalid zero Zstandard offset value')
  if (repeatIndex <= 2) {
    const offset = repeatedOffsets[repeatIndex]
    if (offset === undefined) throw invalidInput('Invalid Zstandard repeated offset')
    for (let index = repeatIndex; index > 0; index -= 1) {
      repeatedOffsets[index] = repeatedOffsets[index - 1] ?? 0
    }
    repeatedOffsets[0] = offset
    return offset
  }

  const offset = (repeatedOffsets[0] ?? 0) - 1
  repeatedOffsets[2] = repeatedOffsets[1] ?? 0
  repeatedOffsets[1] = repeatedOffsets[0] ?? 0
  repeatedOffsets[0] = offset
  return offset
}

const decodeSequences = (
  data: Uint8Array,
  start: number,
  end: number,
  literals: Uint8Array,
  entropy: EntropyState,
  repeatedOffsets: number[],
  output: OutputBuffer,
  frameStart: number,
  windowSize: number,
  blockLimit: number,
): void => {
  const sequenceCount = readSequenceCount(data, start, end)
  if (sequenceCount.count === 0) {
    if (sequenceCount.nextOffset !== end) {
      throw invalidInput('Sequence-free Zstandard block has trailing data')
    }
    output.append(literals, 0, literals.byteLength, blockLimit)
    return
  }

  requireBytes(sequenceCount.nextOffset, 1, end, 'sequence modes')
  const modes = data[sequenceCount.nextOffset] ?? 0
  if ((modes & 3) !== 0) throw invalidInput('Reserved Zstandard sequence mode bits are set')
  let offset = sequenceCount.nextOffset + 1

  const literalTable = parseSequenceTable(
    modes >>> 6,
    entropy.literalLengths,
    predefinedLiteralLengths,
    data,
    offset,
    end,
    35,
    9,
  )
  offset = literalTable.nextOffset
  const offsetTable = parseSequenceTable(
    (modes >>> 4) & 3,
    entropy.offsets,
    predefinedOffsets,
    data,
    offset,
    end,
    31,
    8,
  )
  offset = offsetTable.nextOffset
  const matchTable = parseSequenceTable(
    (modes >>> 2) & 3,
    entropy.matchLengths,
    predefinedMatchLengths,
    data,
    offset,
    end,
    52,
    9,
  )
  offset = matchTable.nextOffset
  entropy.literalLengths = literalTable.table
  entropy.offsets = offsetTable.table
  entropy.matchLengths = matchTable.table

  if (offset >= end) throw truncatedInput('Truncated Zstandard sequence bitstream')
  const reader = new ReverseBitReader(data, offset, end)
  let literalState = initialFseState(literalTable.table, reader)
  let offsetState = initialFseState(offsetTable.table, reader)
  let matchState = initialFseState(matchTable.table, reader)
  let literalOffset = 0

  for (let sequence = 0; sequence < sequenceCount.count; sequence += 1) {
    const literalCode = literalTable.table.entries[literalState]?.symbol
    const offsetCode = offsetTable.table.entries[offsetState]?.symbol
    const matchCode = matchTable.table.entries[matchState]?.symbol
    if (literalCode === undefined || offsetCode === undefined || matchCode === undefined) {
      throw invalidInput('Invalid Zstandard sequence FSE state')
    }
    const literalBaseline = literalLengthBaselines[literalCode]
    const literalBits = literalLengthBits[literalCode]
    const matchBaseline = matchLengthBaselines[matchCode]
    const matchBits = matchLengthBits[matchCode]
    if (
      literalBaseline === undefined ||
      literalBits === undefined ||
      matchBaseline === undefined ||
      matchBits === undefined ||
      offsetCode > 31
    ) {
      throw invalidInput('Invalid Zstandard sequence code')
    }

    const offsetValue = 2 ** offsetCode + reader.readBits(offsetCode)
    const matchLength = matchBaseline + reader.readBits(matchBits)
    const literalLength = literalBaseline + reader.readBits(literalBits)
    if (literalOffset + literalLength > literals.byteLength) {
      throw invalidInput('Zstandard sequence consumes too many literals')
    }
    output.append(literals, literalOffset, literalLength, blockLimit)
    literalOffset += literalLength
    const matchOffset = resolveOffset(offsetValue, literalLength, repeatedOffsets)
    output.copyMatch(matchOffset, matchLength, frameStart, windowSize, blockLimit)

    if (sequence + 1 < sequenceCount.count) {
      const nextLiteral = decodeFseSymbol(literalTable.table, literalState, reader)
      literalState = nextLiteral.state
      const nextMatch = decodeFseSymbol(matchTable.table, matchState, reader)
      matchState = nextMatch.state
      const nextOffset = decodeFseSymbol(offsetTable.table, offsetState, reader)
      offsetState = nextOffset.state
    }
  }

  output.append(literals, literalOffset, literals.byteLength - literalOffset, blockLimit)
  reader.assertConsumed()
}

const decodeCompressedBlock = (
  data: Uint8Array,
  start: number,
  end: number,
  blockMaximum: number,
  entropy: EntropyState,
  repeatedOffsets: number[],
  output: OutputBuffer,
  frameStart: number,
  windowSize: number,
  blockLimit: number,
): void => {
  const literalSection = parseLiteralSection(data, start, end, entropy, blockMaximum)
  decodeSequences(
    data,
    literalSection.nextOffset,
    end,
    literalSection.literals,
    entropy,
    repeatedOffsets,
    output,
    frameStart,
    windowSize,
    blockLimit,
  )
}

const decodeFrame = (
  data: Uint8Array,
  start: number,
  output: OutputBuffer,
  options: DecoderOptions,
): number => {
  let offset = start + 4
  requireBytes(offset, 1, data.byteLength, 'frame header descriptor')
  const descriptor = data[offset] ?? 0
  offset += 1
  if ((descriptor & 0x08) !== 0) throw invalidInput('Reserved Zstandard frame header bit is set')

  const contentSizeFlag = descriptor >>> 6
  const singleSegment = (descriptor & 0x20) !== 0
  const checksum = (descriptor & 0x04) !== 0
  const dictionaryFlag = descriptor & 3
  const dictionaryBytes =
    dictionaryFlag === 0 ? 0 : dictionaryFlag === 1 ? 1 : dictionaryFlag === 2 ? 2 : 4
  const contentSizeBytes =
    contentSizeFlag === 0
      ? singleSegment
        ? 1
        : 0
      : contentSizeFlag === 1
        ? 2
        : contentSizeFlag === 2
          ? 4
          : 8

  let windowSize: number | undefined
  if (!singleSegment) {
    requireBytes(offset, 1, data.byteLength, 'window descriptor')
    const windowDescriptor = data[offset] ?? 0
    offset += 1
    const exponent = windowDescriptor >>> 3
    const mantissa = windowDescriptor & 7
    const base = 2 ** (10 + exponent)
    windowSize = base + (base / 8) * mantissa
  }

  const dictionaryId = readLittleEndian(data, offset, dictionaryBytes, data.byteLength)
  offset += dictionaryBytes
  if (dictionaryId !== 0) {
    throw unsupportedOperation(`Zstandard dictionary ${dictionaryId} is not supported`)
  }

  let contentSize: number | undefined
  if (contentSizeBytes > 0) {
    contentSize = readLittleEndian(data, offset, contentSizeBytes, data.byteLength)
    if (contentSizeBytes === 2) contentSize += 256
    offset += contentSizeBytes
  }
  if (singleSegment) windowSize = contentSize
  if (windowSize === undefined) throw invalidInput('Zstandard frame has no window size')
  if (windowSize > options.maxWindowBytes) {
    throw limitExceeded('Zstandard frame window exceeds maxWindowBytes')
  }
  if (contentSize !== undefined && contentSize > options.maxOutputBytes - output.length) {
    throw limitExceeded('Zstandard frame content size exceeds maxOutputBytes')
  }

  const frameStart = output.length
  const blockMaximum = Math.min(windowSize, maximumBlockBytes)
  const entropy: EntropyState = {}
  const repeatedOffsets = [1, 4, 8]
  let lastBlock = false
  while (!lastBlock) {
    requireBytes(offset, 3, data.byteLength, 'block header')
    const header =
      (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8) | ((data[offset + 2] ?? 0) << 16)
    offset += 3
    lastBlock = (header & 1) !== 0
    const type = (header >>> 1) & 3
    const size = header >>> 3
    if (type === 3) throw invalidInput('Reserved Zstandard block type')
    if (size > blockMaximum) throw invalidInput('Zstandard block exceeds the frame block maximum')

    const blockStart = output.length
    const blockLimit = blockStart + blockMaximum
    if (type === 0) {
      requireBytes(offset, size, data.byteLength, 'raw block')
      output.append(data, offset, size, blockLimit)
      offset += size
    } else if (type === 1) {
      requireBytes(offset, 1, data.byteLength, 'RLE block')
      output.appendRepeated(data[offset] ?? 0, size, blockLimit)
      offset += 1
    } else {
      requireBytes(offset, size, data.byteLength, 'compressed block')
      decodeCompressedBlock(
        data,
        offset,
        offset + size,
        blockMaximum,
        entropy,
        repeatedOffsets,
        output,
        frameStart,
        windowSize,
        blockLimit,
      )
      offset += size
    }
    if (output.length - blockStart > blockMaximum) {
      throw invalidInput('Zstandard block produced too much output')
    }
  }

  const frameLength = output.length - frameStart
  if (contentSize !== undefined && frameLength !== contentSize) {
    throw invalidInput(
      `Zstandard frame decoded ${frameLength} bytes; expected frame content size ${contentSize}`,
    )
  }
  if (checksum) {
    requireBytes(offset, 4, data.byteLength, 'content checksum')
    const expectedChecksum = readUint32Le(data, offset)
    const actualChecksum = xxhash64Low32(output.view(frameStart, output.length))
    if (actualChecksum !== expectedChecksum)
      throw invalidInput('Zstandard content checksum mismatch')
    offset += 4
  }
  return offset
}

const decodeZstdInternal = (input: Uint8Array, options: DecoderOptions): Uint8Array => {
  if (input.byteLength === 0) throw truncatedInput('Empty Zstandard input')
  const initialCapacity = options.expectedOutputBytes ?? Math.min(options.maxOutputBytes, 64 * 1024)
  const output = new OutputBuffer(initialCapacity, options.maxOutputBytes)
  let offset = 0
  let decodedFrames = 0
  while (offset < input.byteLength) {
    requireBytes(offset, 4, input.byteLength, 'frame magic')
    const magic = readUint32Le(input, offset)
    if (magic >= skippableMagicMinimum && magic <= skippableMagicMaximum) {
      requireBytes(offset + 4, 4, input.byteLength, 'skippable frame size')
      const frameSize = readUint32Le(input, offset + 4)
      requireBytes(offset + 8, frameSize, input.byteLength, 'skippable frame')
      offset += 8 + frameSize
      continue
    }
    if (magic !== zstandardMagic) throw invalidInput('Invalid Zstandard frame magic')
    offset = decodeFrame(input, offset, output, options)
    decodedFrames += 1
  }
  if (decodedFrames === 0) throw invalidInput('Zstandard input contains no decodable frames')
  if (options.expectedOutputBytes !== undefined && output.length !== options.expectedOutputBytes) {
    throw invalidInput(
      `Zstandard decoded ${output.length} bytes; expected ${options.expectedOutputBytes}`,
    )
  }
  return output.finish()
}

export const decodeZstd = (input: Uint8Array, options: ZstdDecodeOptions = {}): Uint8Array => {
  if (!(input instanceof Uint8Array)) throw invalidInput('Zstandard input must be a Uint8Array')
  try {
    return decodeZstdInternal(input, normalizeOptions(options))
  } catch (error: unknown) {
    if (error instanceof ImageError) throw error
    throw invalidInput('Invalid Zstandard input')
  }
}
