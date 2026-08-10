import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'

export type LercDataType = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface LercDecodeResult {
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly dataType: LercDataType
  readonly bytesPerSample: 1 | 2 | 4 | 8
  /** Pixel-interleaved samples in little-endian LERC byte order. */
  readonly data: Uint8Array
  /** One byte per pixel; 1 is valid and 0 is invalid. */
  readonly mask: Uint8Array
  /** One validity mask per decoded sample. */
  readonly sampleMasks: readonly Uint8Array[]
  readonly noDataValue?: number
}

interface LercHeader {
  readonly version: number
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly validPixels: number
  readonly microBlockSize: number
  readonly blobSize: number
  readonly dataType: LercDataType
  readonly blobsMore: number
  readonly passNoData: boolean
  readonly allInteger: boolean
  readonly maxZError: number
  readonly minimum: number
  readonly maximum: number
  readonly noDataValue: number
  readonly originalNoDataValue: number
}

class LercReader {
  readonly data: Uint8Array
  readonly view: DataView
  offset: number
  readonly end: number

  constructor(data: Uint8Array, offset = 0, end = data.byteLength) {
    this.data = data
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    this.offset = offset
    this.end = end
  }

  get remaining(): number {
    return this.end - this.offset
  }

  require(bytes: number, label: string): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || this.offset + bytes > this.end) {
      throw truncatedInput(`LERC ${label} is truncated`)
    }
  }

  byte(label: string): number {
    this.require(1, label)
    const value = this.data[this.offset]
    this.offset += 1
    if (value === undefined) throw truncatedInput(`LERC ${label} is truncated`)
    return value
  }

  int16(label: string): number {
    this.require(2, label)
    const value = this.view.getInt16(this.offset, true)
    this.offset += 2
    return value
  }

  uint16(label: string): number {
    this.require(2, label)
    const value = this.view.getUint16(this.offset, true)
    this.offset += 2
    return value
  }

  int32(label: string): number {
    this.require(4, label)
    const value = this.view.getInt32(this.offset, true)
    this.offset += 4
    return value
  }

  uint32(label: string): number {
    this.require(4, label)
    const value = this.view.getUint32(this.offset, true)
    this.offset += 4
    return value
  }

  float64(label: string): number {
    this.require(8, label)
    const value = this.view.getFloat64(this.offset, true)
    this.offset += 8
    return value
  }

  bytes(length: number, label: string): Uint8Array {
    this.require(length, label)
    const value = this.data.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }
}

const isLercDataType = (value: number): value is LercDataType =>
  value === 0 ||
  value === 1 ||
  value === 2 ||
  value === 3 ||
  value === 4 ||
  value === 5 ||
  value === 6 ||
  value === 7

const dataTypeBytes = (dataType: LercDataType): 1 | 2 | 4 | 8 => {
  if (dataType <= 1) return 1
  if (dataType <= 3) return 2
  if (dataType <= 6) return 4
  return 8
}

const checkedProduct = (left: number, right: number, label: string): number => {
  const value = left * right
  if (!Number.isSafeInteger(value) || value < 0) throw limitExceeded(`LERC ${label} is too large`)
  return value
}

const fletcher32 = (data: Uint8Array): number => {
  let sum1 = 0xffff
  let sum2 = 0xffff
  let offset = 0
  let words = Math.floor(data.byteLength / 2)
  while (words > 0) {
    let count = Math.min(words, 359)
    words -= count
    while (count > 0) {
      sum1 += (data[offset] ?? 0) << 8
      offset += 1
      sum1 += data[offset] ?? 0
      offset += 1
      sum2 += sum1
      count -= 1
    }
    sum1 = (sum1 & 0xffff) + (sum1 >>> 16)
    sum2 = (sum2 & 0xffff) + (sum2 >>> 16)
  }
  if ((data.byteLength & 1) !== 0) {
    sum1 += (data[offset] ?? 0) << 8
    sum2 += sum1
  }
  sum1 = (sum1 & 0xffff) + (sum1 >>> 16)
  sum2 = (sum2 & 0xffff) + (sum2 >>> 16)
  return ((sum2 << 16) | sum1) >>> 0
}

const parseHeader = (
  input: Uint8Array,
): { readonly header: LercHeader; readonly reader: LercReader } => {
  const reader = new LercReader(input)
  const identifier = reader.bytes(6, 'identifier')
  if (
    identifier[0] !== 0x4c ||
    identifier[1] !== 0x65 ||
    identifier[2] !== 0x72 ||
    identifier[3] !== 0x63 ||
    identifier[4] !== 0x32 ||
    identifier[5] !== 0x20
  ) {
    throw invalidInput('LERC segment does not start with a Lerc2 identifier')
  }
  const version = reader.int32('version')
  if (version < 1 || version > 6)
    throw unsupportedOperation(`LERC2 version ${version} is unsupported`)
  const checksum = version >= 3 ? reader.uint32('checksum') : undefined
  const height = reader.int32('height')
  const width = reader.int32('width')
  const depth = version >= 4 ? reader.int32('depth') : 1
  const validPixels = reader.int32('valid pixel count')
  const microBlockSize = reader.int32('microblock size')
  const blobSize = reader.int32('blob size')
  const rawDataType = reader.int32('data type')
  const blobsMore = version >= 6 ? reader.int32('remaining blob count') : 0
  let passNoData = false
  let allInteger = false
  if (version >= 6) {
    passNoData = reader.byte('nodata flag') !== 0
    allInteger = reader.byte('integer flag') !== 0
    const reserved3 = reader.byte('reserved flag')
    const reserved4 = reader.byte('reserved flag')
    if (reserved3 !== 0 || reserved4 !== 0)
      throw unsupportedOperation('LERC reserved header flags are unsupported')
  }
  const maxZError = reader.float64('maximum error')
  const minimum = reader.float64('minimum')
  const maximum = reader.float64('maximum')
  const noDataValue = version >= 6 ? reader.float64('nodata value') : 0
  const originalNoDataValue = version >= 6 ? reader.float64('original nodata value') : 0
  if (
    !Number.isSafeInteger(width) ||
    width < 1 ||
    !Number.isSafeInteger(height) ||
    height < 1 ||
    !Number.isSafeInteger(depth) ||
    depth < 1 ||
    !Number.isSafeInteger(validPixels) ||
    validPixels < 0 ||
    !Number.isSafeInteger(microBlockSize) ||
    microBlockSize < 1 ||
    microBlockSize > 32 ||
    !Number.isSafeInteger(blobSize) ||
    blobSize < reader.offset ||
    !Number.isSafeInteger(blobsMore) ||
    blobsMore < 0 ||
    !isLercDataType(rawDataType)
  ) {
    throw invalidInput('LERC header contains invalid dimensions or fields')
  }
  if (blobSize > input.byteLength) throw truncatedInput('LERC blob is truncated')
  const pixels = checkedProduct(width, height, 'pixel count')
  if (validPixels > pixels) throw invalidInput('LERC valid pixel count exceeds image dimensions')
  const dataType = rawDataType
  const outputBytes = checkedProduct(
    checkedProduct(pixels, depth, 'sample count'),
    dataTypeBytes(dataType),
    'output size',
  )
  if (outputBytes > 0x7fff_ffff) throw limitExceeded('LERC decoded output exceeds 2 GiB')
  if (
    !Number.isFinite(maxZError) ||
    maxZError < 0 ||
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    minimum > maximum
  ) {
    throw invalidInput('LERC numeric range is invalid')
  }

  if (checksum !== undefined) {
    const actual = fletcher32(input.subarray(14, blobSize))
    if (actual !== checksum) throw invalidInput('LERC checksum does not match')
  }
  return {
    header: Object.freeze({
      version,
      width,
      height,
      depth,
      validPixels,
      microBlockSize,
      blobSize,
      dataType,
      blobsMore,
      passNoData,
      allInteger,
      maxZError,
      minimum,
      maximum,
      noDataValue,
      originalNoDataValue,
    }),
    reader: new LercReader(input, reader.offset, blobSize),
  }
}

const decodeMaskRle = (encoded: Uint8Array, outputBytes: number): Uint8Array => {
  const reader = new LercReader(encoded)
  const output = new Uint8Array(outputBytes)
  let outputOffset = 0
  while (true) {
    const count = reader.int16('mask RLE count')
    if (count === -32_768) break
    if (count === 0) throw invalidInput('LERC mask RLE contains a zero run')
    const amount = Math.abs(count)
    if (outputOffset + amount > output.byteLength)
      throw invalidInput('LERC mask RLE exceeds its output')
    if (count > 0) {
      output.set(reader.bytes(amount, 'mask RLE literal'), outputOffset)
    } else {
      output.fill(reader.byte('mask RLE value'), outputOffset, outputOffset + amount)
    }
    outputOffset += amount
  }
  if (outputOffset !== output.byteLength || reader.remaining !== 0) {
    throw invalidInput('LERC mask RLE length is invalid')
  }
  return output
}

const readMask = (
  reader: LercReader,
  header: LercHeader,
  previousMask?: Uint8Array,
): Uint8Array => {
  const pixels = header.width * header.height
  const packedBytes = Math.ceil(pixels / 8)
  const compressedBytes = reader.int32('mask byte count')
  if (compressedBytes < 0 || compressedBytes > reader.remaining)
    throw invalidInput('LERC mask byte count is invalid')
  let packed: Uint8Array
  if (header.validPixels === 0) {
    if (compressedBytes !== 0) throw invalidInput('Empty LERC image must not contain a mask')
    packed = new Uint8Array(packedBytes)
  } else if (header.validPixels === pixels) {
    if (compressedBytes !== 0) throw invalidInput('Full LERC image must not contain a mask')
    packed = new Uint8Array(packedBytes).fill(0xff)
  } else {
    if (compressedBytes === 0) {
      if (previousMask?.byteLength !== pixels) {
        throw invalidInput('Partial LERC image is missing its mask')
      }
      const valid = previousMask.reduce((total, value) => total + (value === 0 ? 0 : 1), 0)
      if (valid !== header.validPixels) {
        throw invalidInput('Reused LERC mask valid count does not match its header')
      }
      return previousMask
    }
    packed = decodeMaskRle(reader.bytes(compressedBytes, 'mask'), packedBytes)
  }
  const mask = new Uint8Array(pixels)
  let valid = 0
  for (let index = 0; index < pixels; index += 1) {
    const present = ((packed[index >>> 3] ?? 0) & (0x80 >>> (index & 7))) !== 0
    if (present) {
      mask[index] = 1
      valid += 1
    }
  }
  if (valid !== header.validPixels)
    throw invalidInput('LERC mask valid count does not match its header')
  return mask
}

const readTypedValue = (reader: LercReader, dataType: LercDataType, label: string): number => {
  reader.require(dataTypeBytes(dataType), label)
  const offset = reader.offset
  reader.offset += dataTypeBytes(dataType)
  if (dataType === 0) return reader.view.getInt8(offset)
  if (dataType === 1) return reader.view.getUint8(offset)
  if (dataType === 2) return reader.view.getInt16(offset, true)
  if (dataType === 3) return reader.view.getUint16(offset, true)
  if (dataType === 4) return reader.view.getInt32(offset, true)
  if (dataType === 5) return reader.view.getUint32(offset, true)
  if (dataType === 6) return reader.view.getFloat32(offset, true)
  return reader.view.getFloat64(offset, true)
}

const writeTypedValue = (
  output: DataView,
  sampleIndex: number,
  dataType: LercDataType,
  value: number,
): void => {
  const offset = sampleIndex * dataTypeBytes(dataType)
  if (dataType === 0) output.setInt8(offset, value)
  else if (dataType === 1) output.setUint8(offset, value)
  else if (dataType === 2) output.setInt16(offset, value, true)
  else if (dataType === 3) output.setUint16(offset, value, true)
  else if (dataType === 4) output.setInt32(offset, value, true)
  else if (dataType === 5) output.setUint32(offset, value, true)
  else if (dataType === 6) output.setFloat32(offset, value, true)
  else output.setFloat64(offset, value, true)
}

const outputValue = (output: DataView, sampleIndex: number, dataType: LercDataType): number => {
  const offset = sampleIndex * dataTypeBytes(dataType)
  if (dataType === 0) return output.getInt8(offset)
  if (dataType === 1) return output.getUint8(offset)
  if (dataType === 2) return output.getInt16(offset, true)
  if (dataType === 3) return output.getUint16(offset, true)
  if (dataType === 4) return output.getInt32(offset, true)
  if (dataType === 5) return output.getUint32(offset, true)
  if (dataType === 6) return output.getFloat32(offset, true)
  return output.getFloat64(offset, true)
}

const reducedDataType = (dataType: LercDataType, code: number): LercDataType => {
  if (dataType === 2) {
    if (code === 0) return 2
    if (code === 1) return 1
    if (code === 2) return 0
  } else if (dataType === 3) {
    if (code === 0) return 3
    if (code === 1) return 1
  } else if (dataType === 4) {
    if (code === 0) return 4
    if (code === 1) return 3
    if (code === 2) return 2
    if (code === 3) return 1
  } else if (dataType === 5) {
    if (code === 0) return 5
    if (code === 1) return 3
    if (code === 2) return 1
  } else if (dataType === 6) {
    if (code === 0) return 6
    if (code === 1) return 2
    return 1
  } else if (dataType === 7) {
    if (code === 0) return 7
    if (code === 1) return 6
    if (code === 2) return 4
    if (code === 3) return 2
  } else {
    return dataType
  }
  throw invalidInput('LERC tile uses an invalid reduced data type')
}

const readPackedValues = (
  reader: LercReader,
  count: number,
  bits: number,
  version: number,
): Uint32Array => {
  if (!Number.isSafeInteger(count) || count < 0 || bits < 0 || bits >= 32) {
    throw invalidInput('LERC bit-stuffed array header is invalid')
  }
  const output = new Uint32Array(count)
  if (bits === 0 || count === 0) return output
  const byteCount = Math.ceil((count * bits) / 8)
  const bytes = reader.bytes(byteCount, 'bit-stuffed values')
  if (version >= 3) {
    let bitOffset = 0
    for (let index = 0; index < count; index += 1) {
      let value = 0
      for (let bit = 0; bit < bits; bit += 1) {
        const sourceBit = bitOffset + bit
        value |= (((bytes[sourceBit >>> 3] ?? 0) >>> (sourceBit & 7)) & 1) << bit
      }
      output[index] = value >>> 0
      bitOffset += bits
    }
    return output
  }
  const paddedBytes = Math.ceil(byteCount / 4) * 4
  const padded = new Uint8Array(paddedBytes)
  padded.set(bytes)
  const view = new DataView(padded.buffer)
  const unusedTail = paddedBytes - byteCount
  if (unusedTail > 0) {
    const last = paddedBytes - 4
    view.setUint32(last, view.getUint32(last, true) << (unusedTail * 8), true)
  }
  let bitPosition = 0
  for (let index = 0; index < count; index += 1) {
    const wordIndex = Math.floor(bitPosition / 32)
    const inWord = bitPosition & 31
    const first = view.getUint32(wordIndex * 4, true)
    let value: number
    if (32 - inWord >= bits) {
      value = (first >>> (32 - inWord - bits)) & (2 ** bits - 1)
    } else {
      const firstBits = 32 - inWord
      const second = view.getUint32((wordIndex + 1) * 4, true)
      value =
        ((first & (2 ** firstBits - 1)) << (bits - firstBits)) |
        (second >>> (32 - bits + firstBits))
    }
    output[index] = value >>> 0
    bitPosition += bits
  }
  return output
}

const readBitStuffer = (
  reader: LercReader,
  maximumElements: number,
  version: number,
): Uint32Array => {
  const header = reader.byte('bit-stuffer header')
  const countBytesCode = header >>> 6
  const countBytes = countBytesCode === 0 ? 4 : 3 - countBytesCode
  const useLut = (header & 0x20) !== 0
  const bits = header & 0x1f
  const count =
    countBytes === 1
      ? reader.byte('bit-stuffer element count')
      : countBytes === 2
        ? reader.uint16('bit-stuffer element count')
        : reader.uint32('bit-stuffer element count')
  if (count > maximumElements) throw invalidInput('LERC bit-stuffed element count exceeds its tile')
  if (!useLut) return readPackedValues(reader, count, bits, version)
  if (bits === 0) throw invalidInput('LERC LUT bit width is zero')
  const lutEntries = reader.byte('LERC LUT size') - 1
  if (lutEntries < 0) throw invalidInput('LERC LUT size is invalid')
  const packedLut = readPackedValues(reader, lutEntries, bits, version)
  let indexBits = 0
  while (lutEntries >>> indexBits !== 0) indexBits += 1
  if (indexBits === 0) throw invalidInput('LERC LUT index width is zero')
  const indexes = readPackedValues(reader, count, indexBits, version)
  const output = new Uint32Array(count)
  for (let index = 0; index < count; index += 1) {
    const lutIndex = indexes[index] ?? 0
    if (lutIndex === 0) output[index] = 0
    else {
      const value = packedLut[lutIndex - 1]
      if (value === undefined) throw invalidInput('LERC LUT index is out of range')
      output[index] = value
    }
  }
  return output
}

const readRanges = (
  reader: LercReader,
  header: LercHeader,
): {
  readonly minimums: readonly number[]
  readonly maximums: readonly number[]
} => {
  if (header.version < 4 || header.depth === 1) {
    return Object.freeze({ minimums: [header.minimum], maximums: [header.maximum] })
  }
  const minimums: number[] = []
  const maximums: number[] = []
  for (let depth = 0; depth < header.depth; depth += 1) {
    minimums.push(readTypedValue(reader, header.dataType, 'minimum range'))
  }
  for (let depth = 0; depth < header.depth; depth += 1) {
    maximums.push(readTypedValue(reader, header.dataType, 'maximum range'))
  }
  for (let depth = 0; depth < header.depth; depth += 1) {
    const minimum = minimums[depth]
    const maximum = maximums[depth]
    if (
      minimum === undefined ||
      maximum === undefined ||
      !Number.isFinite(minimum) ||
      !Number.isFinite(maximum) ||
      minimum > maximum
    ) {
      throw invalidInput('LERC per-depth range is invalid')
    }
  }
  return Object.freeze({ minimums: Object.freeze(minimums), maximums: Object.freeze(maximums) })
}

const fillConstant = (
  output: DataView,
  mask: Uint8Array,
  header: LercHeader,
  minimums: readonly number[],
): void => {
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel] === 0) continue
    for (let depth = 0; depth < header.depth; depth += 1) {
      writeTypedValue(
        output,
        pixel * header.depth + depth,
        header.dataType,
        minimums[depth] ?? header.minimum,
      )
    }
  }
}

const decodeOneSweep = (
  reader: LercReader,
  output: DataView,
  mask: Uint8Array,
  header: LercHeader,
): void => {
  const bytesPerSample = dataTypeBytes(header.dataType)
  const pixelBytes = header.depth * bytesPerSample
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    if (mask[pixel] === 0) continue
    const values = reader.bytes(pixelBytes, 'one-sweep pixels')
    new Uint8Array(output.buffer, output.byteOffset + pixel * pixelBytes, pixelBytes).set(values)
  }
}

const decodeTiles = (
  reader: LercReader,
  output: DataView,
  mask: Uint8Array,
  header: LercHeader,
  maximums: readonly number[],
): void => {
  const tilesAcross = Math.ceil(header.width / header.microBlockSize)
  const tilesDown = Math.ceil(header.height / header.microBlockSize)
  for (let tileY = 0; tileY < tilesDown; tileY += 1) {
    const y0 = tileY * header.microBlockSize
    const tileHeight = Math.min(header.microBlockSize, header.height - y0)
    for (let tileX = 0; tileX < tilesAcross; tileX += 1) {
      const x0 = tileX * header.microBlockSize
      const tileWidth = Math.min(header.microBlockSize, header.width - x0)
      for (let depth = 0; depth < header.depth; depth += 1) {
        const flag = reader.byte('tile header')
        const difference = header.version >= 5 && (flag & 4) !== 0
        const patternMask = header.version >= 5 ? 14 : 15
        if (((flag >>> 2) & patternMask) !== ((x0 >>> 3) & patternMask)) {
          throw invalidInput('LERC tile integrity pattern does not match its position')
        }
        if (difference && depth === 0)
          throw invalidInput('LERC first depth cannot use difference coding')
        const reducedCode = flag >>> 6
        const encoding = flag & 3
        let validInTile = 0
        for (let y = 0; y < tileHeight; y += 1) {
          const row = (y0 + y) * header.width + x0
          for (let x = 0; x < tileWidth; x += 1) validInTile += mask[row + x] ?? 0
        }
        if (encoding === 2) {
          for (let y = 0; y < tileHeight; y += 1) {
            const row = (y0 + y) * header.width + x0
            for (let x = 0; x < tileWidth; x += 1) {
              const pixel = row + x
              if (mask[pixel] !== 0) {
                const sample = pixel * header.depth + depth
                writeTypedValue(
                  output,
                  sample,
                  header.dataType,
                  difference ? outputValue(output, sample - 1, header.dataType) : 0,
                )
              }
            }
          }
          continue
        }
        if (encoding === 0) {
          if (difference) throw invalidInput('LERC raw tile cannot use difference coding')
          for (let y = 0; y < tileHeight; y += 1) {
            const row = (y0 + y) * header.width + x0
            for (let x = 0; x < tileWidth; x += 1) {
              const pixel = row + x
              if (mask[pixel] !== 0) {
                writeTypedValue(
                  output,
                  pixel * header.depth + depth,
                  header.dataType,
                  readTypedValue(reader, header.dataType, 'raw tile value'),
                )
              }
            }
          }
          continue
        }
        const usedType = reducedDataType(
          difference && header.dataType < 6 ? 4 : header.dataType,
          reducedCode,
        )
        const offset = readTypedValue(reader, usedType, 'tile offset')
        const maximum = maximums[depth] ?? header.maximum
        if (encoding === 3) {
          for (let y = 0; y < tileHeight; y += 1) {
            const row = (y0 + y) * header.width + x0
            for (let x = 0; x < tileWidth; x += 1) {
              const pixel = row + x
              if (mask[pixel] !== 0) {
                const sample = pixel * header.depth + depth
                const value = difference
                  ? Math.min(offset + outputValue(output, sample - 1, header.dataType), maximum)
                  : offset
                writeTypedValue(output, sample, header.dataType, value)
              }
            }
          }
          continue
        }
        if (encoding !== 1) throw invalidInput(`LERC tile encoding ${encoding} is invalid`)
        const quantized = readBitStuffer(reader, tileWidth * tileHeight, header.version)
        if (quantized.length !== validInTile)
          throw invalidInput('LERC tile value count does not match its mask')
        let quantizedIndex = 0
        const scale = 2 * header.maxZError
        for (let y = 0; y < tileHeight; y += 1) {
          const row = (y0 + y) * header.width + x0
          for (let x = 0; x < tileWidth; x += 1) {
            const pixel = row + x
            if (mask[pixel] !== 0) {
              const sample = pixel * header.depth + depth
              let value = offset + (quantized[quantizedIndex] ?? 0) * scale
              quantizedIndex += 1
              if (difference) value += outputValue(output, sample - 1, header.dataType)
              writeTypedValue(output, sample, header.dataType, Math.min(value, maximum))
            }
          }
        }
      }
    }
  }
}

interface HuffmanNode {
  zero: number
  one: number
  value: number
}

class HuffmanWordReader {
  readonly #reader: LercReader
  readonly #start: number
  #word = 0
  #bit = 0

  constructor(reader: LercReader) {
    this.#reader = reader
    this.#start = reader.offset
  }

  readBit(label: string): number {
    const wordOffset = this.#start + this.#word * 4
    if (wordOffset + 4 > this.#reader.end) throw truncatedInput(`LERC ${label} is truncated`)
    const value = this.#reader.view.getUint32(wordOffset, true)
    const bit = (value >>> (31 - this.#bit)) & 1
    this.#bit += 1
    if (this.#bit === 32) {
      this.#bit = 0
      this.#word += 1
    }
    return bit
  }

  readValue(bits: number, label: string): number {
    let value = 0
    for (let bit = 0; bit < bits; bit += 1) value = value * 2 + this.readBit(label)
    return value
  }

  finish(extraWords: number): void {
    const words = this.#word + (this.#bit > 0 ? 1 : 0) + extraWords
    const bytes = words * 4
    this.#reader.require(bytes, 'Huffman bitstream')
    this.#reader.offset = this.#start + bytes
  }
}

const readHuffmanTree = (reader: LercReader, version: number): readonly HuffmanNode[] => {
  const tableVersion = reader.int32('Huffman table version')
  const size = reader.int32('Huffman table size')
  const first = reader.int32('Huffman table first code')
  const end = reader.int32('Huffman table end code')
  if (
    tableVersion < 2 ||
    !Number.isSafeInteger(size) ||
    size < 2 ||
    size >= 1 << 15 ||
    first < 0 ||
    first >= end ||
    end - first > size
  ) {
    throw invalidInput('LERC Huffman table header is invalid')
  }
  const lengths = readBitStuffer(reader, end - first, version)
  if (lengths.length !== end - first)
    throw invalidInput('LERC Huffman code length count is invalid')
  const codeReader = new HuffmanWordReader(reader)
  const nodes: HuffmanNode[] = [{ zero: -1, one: -1, value: -1 }]
  let symbols = 0
  for (let index = first; index < end; index += 1) {
    const symbol = index < size ? index : index - size
    if (symbol < 0 || symbol >= size)
      throw invalidInput('LERC Huffman symbol wraps outside its table')
    const length = lengths[index - first] ?? 0
    if (length === 0) continue
    if (length > 32) throw invalidInput('LERC Huffman code exceeds 32 bits')
    const code = codeReader.readValue(length, 'Huffman code table')
    let nodeIndex = 0
    for (let position = length - 1; position >= 0; position -= 1) {
      const bit = Math.floor(code / 2 ** position) & 1
      const node = nodes[nodeIndex]
      if (!node || node.value >= 0)
        throw invalidInput('LERC Huffman code table has a prefix conflict')
      const existing = bit === 0 ? node.zero : node.one
      if (position === 0) {
        if (existing >= 0) throw invalidInput('LERC Huffman code table repeats a code')
        const childIndex = nodes.length
        nodes.push({ zero: -1, one: -1, value: symbol })
        if (bit === 0) node.zero = childIndex
        else node.one = childIndex
      } else if (existing >= 0) {
        nodeIndex = existing
      } else {
        const childIndex = nodes.length
        nodes.push({ zero: -1, one: -1, value: -1 })
        if (bit === 0) node.zero = childIndex
        else node.one = childIndex
        nodeIndex = childIndex
      }
    }
    symbols += 1
  }
  codeReader.finish(0)
  if (symbols < 2) throw invalidInput('LERC Huffman table has fewer than two symbols')
  return nodes
}

const decodeHuffmanValue = (reader: HuffmanWordReader, nodes: readonly HuffmanNode[]): number => {
  let nodeIndex = 0
  for (let depth = 0; depth <= 32; depth += 1) {
    const node = nodes[nodeIndex]
    if (!node) throw invalidInput('LERC Huffman tree traversal is invalid')
    if (node.value >= 0) return node.value
    nodeIndex = reader.readBit('Huffman pixels') === 0 ? node.zero : node.one
    if (nodeIndex < 0) throw invalidInput('LERC Huffman pixel code is invalid')
  }
  throw invalidInput('LERC Huffman pixel code exceeds 32 bits')
}

const decodeHuffman = (
  reader: LercReader,
  output: DataView,
  mask: Uint8Array,
  header: LercHeader,
  mode: number,
): void => {
  if (header.dataType !== 0 && header.dataType !== 1) {
    throw unsupportedOperation('LERC floating-point Huffman coding is unsupported')
  }
  if (mode !== 1 && mode !== 2) throw invalidInput(`LERC Huffman mode ${mode} is invalid`)
  const tree = readHuffmanTree(reader, header.version)
  const bits = new HuffmanWordReader(reader)
  const symbolOffset = header.dataType === 0 ? 128 : 0
  if (mode === 2) {
    for (let pixel = 0; pixel < mask.length; pixel += 1) {
      if (mask[pixel] === 0) continue
      for (let depth = 0; depth < header.depth; depth += 1) {
        writeTypedValue(
          output,
          pixel * header.depth + depth,
          header.dataType,
          decodeHuffmanValue(bits, tree) - symbolOffset,
        )
      }
    }
  } else {
    for (let depth = 0; depth < header.depth; depth += 1) {
      let previous = 0
      for (let y = 0; y < header.height; y += 1) {
        for (let x = 0; x < header.width; x += 1) {
          const pixel = y * header.width + x
          if (mask[pixel] === 0) continue
          const sample = pixel * header.depth + depth
          let delta = decodeHuffmanValue(bits, tree) - symbolOffset
          if (x > 0 && mask[pixel - 1] !== 0) delta += previous
          else if (y > 0 && mask[pixel - header.width] !== 0) {
            delta += outputValue(output, sample - header.width * header.depth, header.dataType)
          } else delta += previous
          writeTypedValue(output, sample, header.dataType, delta)
          previous = outputValue(output, sample, header.dataType)
        }
      }
    }
  }
  bits.finish(1)
}
interface DecodedLercBlob {
  readonly result: LercDecodeResult
  readonly version: number
  readonly blobsMore: number
  readonly blobSize: number
}

const decodeLercBlob = (input: Uint8Array, previousMask?: Uint8Array): DecodedLercBlob => {
  const { header, reader } = parseHeader(input)

  const mask = readMask(reader, header, previousMask)
  const outputBytes = header.width * header.height * header.depth * dataTypeBytes(header.dataType)
  const data = new Uint8Array(outputBytes)
  const output = new DataView(data.buffer)
  let ranges: { readonly minimums: readonly number[]; readonly maximums: readonly number[] } =
    Object.freeze({
      minimums: Object.freeze([header.minimum]),
      maximums: Object.freeze([header.maximum]),
    })
  if (header.validPixels > 0 && header.minimum !== header.maximum)
    ranges = readRanges(reader, header)
  if (header.validPixels > 0) {
    const constant = ranges.minimums.every((minimum, index) => minimum === ranges.maximums[index])
    if (header.minimum === header.maximum || constant)
      fillConstant(output, mask, header, ranges.minimums)
    else {
      const oneSweep = reader.byte('data mode')
      if (oneSweep !== 0) decodeOneSweep(reader, output, mask, header)
      else {
        const huffmanEligible =
          (header.version >= 2 && header.dataType <= 1 && header.maxZError === 0.5) ||
          (header.version >= 6 && header.dataType >= 6 && header.maxZError === 0)
        const mode = huffmanEligible ? reader.byte('image encoding mode') : 0
        if (mode === 0) decodeTiles(reader, output, mask, header, ranges.maximums)
        else decodeHuffman(reader, output, mask, header, mode)
      }
    }
  }
  if (reader.offset !== header.blobSize)
    throw invalidInput('LERC blob contains trailing or unconsumed bytes')
  return Object.freeze({
    result: Object.freeze({
      width: header.width,
      height: header.height,
      depth: header.depth,
      dataType: header.dataType,
      bytesPerSample: dataTypeBytes(header.dataType),
      data,
      mask,
      sampleMasks: Object.freeze(new Array<Uint8Array>(header.depth).fill(mask)),
      ...(header.passNoData ? { noDataValue: header.originalNoDataValue } : {}),
    }),
    version: header.version,
    blobsMore: header.blobsMore,
    blobSize: header.blobSize,
  })
}

export const decodeLerc2 = (input: Uint8Array): LercDecodeResult => {
  const blobs: LercDecodeResult[] = []
  let offset = 0
  let priorRemaining: number | undefined
  let previousMask: Uint8Array | undefined
  while (offset < input.byteLength) {
    const decoded = decodeLercBlob(input.subarray(offset), previousMask)
    if (priorRemaining !== undefined && priorRemaining !== decoded.blobsMore + 1) {
      throw invalidInput('LERC concatenated blob count is inconsistent')
    }
    blobs.push(decoded.result)
    previousMask = decoded.result.mask
    offset += decoded.blobSize
    priorRemaining = decoded.version >= 6 ? decoded.blobsMore : undefined
    if (decoded.version >= 6 && decoded.blobsMore === 0 && offset !== input.byteLength) {
      throw invalidInput('LERC segment has undeclared trailing blobs')
    }
  }
  const first = blobs[0]
  if (!first) throw truncatedInput('LERC segment is empty')
  if (blobs.length === 1) return first
  const depth = blobs.reduce((total, blob) => total + blob.depth, 0)
  const bytesPerSample = first.bytesPerSample
  const pixels = checkedProduct(first.width, first.height, 'pixel count')
  const outputBytes = checkedProduct(
    checkedProduct(pixels, depth, 'sample count'),
    bytesPerSample,
    'output size',
  )
  if (outputBytes > 0x7fff_ffff) throw limitExceeded('LERC decoded output exceeds 2 GiB')
  for (const blob of blobs) {
    if (
      blob.width !== first.width ||
      blob.height !== first.height ||
      blob.dataType !== first.dataType
    ) {
      throw invalidInput('LERC concatenated blobs have inconsistent dimensions or sample types')
    }
  }
  const data = new Uint8Array(outputBytes)
  const sampleMasks: Uint8Array[] = []
  const mask = new Uint8Array(pixels).fill(1)
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    let targetSample = pixel * depth
    for (const blob of blobs) {
      const sourceOffset = pixel * blob.depth * bytesPerSample
      data.set(
        blob.data.subarray(sourceOffset, sourceOffset + blob.depth * bytesPerSample),
        targetSample * bytesPerSample,
      )
      targetSample += blob.depth
      if (blob.mask[pixel] === 0) mask[pixel] = 0
    }
  }
  for (const blob of blobs) sampleMasks.push(...blob.sampleMasks)
  const noDataValue = blobs.every((blob) => blob.noDataValue === first.noDataValue)
    ? first.noDataValue
    : undefined
  return Object.freeze({
    width: first.width,
    height: first.height,
    depth,
    dataType: first.dataType,
    bytesPerSample,
    data,
    mask,
    sampleMasks: Object.freeze(sampleMasks),
    ...(noDataValue === undefined ? {} : { noDataValue }),
  })
}
