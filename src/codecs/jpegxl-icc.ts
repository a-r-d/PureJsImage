import { invalidInput, limitExceeded } from '../errors.ts'
import {
  type JpegXlBitReader,
  JpegXlEntropySymbolReader,
  readJpegXlEntropyCode,
} from './jpegxl-bitstream.ts'

const ICC_CONTEXTS = 41
const ICC_HEADER_BYTES = 128
const tagNames = [
  'cprt',
  'wtpt',
  'bkpt',
  'rXYZ',
  'gXYZ',
  'bXYZ',
  'kXYZ',
  'rTRC',
  'gTRC',
  'bTRC',
  'kTRC',
  'chad',
  'desc',
  'chrm',
  'dmnd',
  'dmdd',
  'lumi',
] as const
const typeNames = ['XYZ ', 'desc', 'text', 'mluc', 'para', 'curv', 'sf32', 'gbd '] as const

const readU64 = (reader: JpegXlBitReader): number => {
  const selector = reader.readBits(2)
  if (selector === 0) return 0
  if (selector === 1) return 1 + reader.readBits(4)
  if (selector === 2) return 17 + reader.readBits(8)
  let result = reader.readBits(12)
  let shift = 12
  while (shift < 64 && reader.readBits(1) !== 0) {
    const count = Math.min(8, 64 - shift)
    result += reader.readBits(count) * 2 ** shift
    if (!Number.isSafeInteger(result)) throw invalidInput('JPEG XL ICC size exceeds safe range')
    shift += count
  }
  return result
}

const kind1 = (value: number): number => {
  if ((value >= 65 && value <= 90) || (value >= 97 && value <= 122)) return 0
  if ((value >= 48 && value <= 57) || value === 44 || value === 46) return 1
  if (value === 0) return 2
  if (value === 1) return 3
  if (value < 16) return 4
  if (value > 240) return value === 255 ? 6 : 5
  return 7
}

const kind2 = (value: number): number => {
  if ((value >= 65 && value <= 90) || (value >= 97 && value <= 122)) return 0
  if ((value >= 48 && value <= 57) || value === 44 || value === 46) return 1
  if (value < 16) return 2
  return value > 240 ? 3 : 4
}

const contextFor = (index: number, previous: number, beforePrevious: number): number =>
  index <= ICC_HEADER_BYTES ? 0 : 1 + kind1(previous) + kind2(beforePrevious) * 8

const readVarint = (data: Uint8Array, position: { value: number }, end: number): number => {
  let result = 0
  let factor = 1
  for (let index = 0; index < 10; index += 1) {
    if (position.value >= end) throw invalidInput('JPEG XL ICC varint is truncated')
    const byte = data[position.value] ?? 0
    position.value += 1
    const payload = byte & 0x7f
    if (index === 9 && payload > 1) throw invalidInput('JPEG XL ICC varint exceeds 64 bits')
    result += payload * factor
    if (!Number.isSafeInteger(result)) throw invalidInput('JPEG XL ICC varint exceeds safe range')
    if ((byte & 0x80) === 0) return result
    factor *= 128
  }
  throw invalidInput('JPEG XL ICC varint exceeds ten bytes')
}

class IccOutput {
  readonly data: Uint8Array
  length = 0

  constructor(size: number) {
    this.data = new Uint8Array(size)
  }

  reserve(count: number): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.data.length - this.length) {
      throw invalidInput('JPEG XL ICC expands beyond its declared size')
    }
  }

  writeByte(value: number): void {
    this.reserve(1)
    this.data[this.length++] = value
  }

  append(bytes: Uint8Array): void {
    this.reserve(bytes.length)
    this.data.set(bytes, this.length)
    this.length += bytes.length
  }
}

const appendU32 = (output: IccOutput, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw invalidInput('JPEG XL ICC 32-bit value is invalid')
  }
  output.reserve(4)
  output.writeByte((value >>> 24) & 255)
  output.writeByte((value >>> 16) & 255)
  output.writeByte((value >>> 8) & 255)
  output.writeByte(value & 255)
}

const appendText = (output: IccOutput, text: string): void => {
  for (let index = 0; index < text.length; index += 1) output.writeByte(text.charCodeAt(index))
}

const initialHeader = (size: number): Uint8Array => {
  const header = new Uint8Array(ICC_HEADER_BYTES)
  header.set([4, 0, 0, 0], 8)
  header.set([0x6d, 0x6e, 0x74, 0x72, 0x52, 0x47, 0x42, 0x20, 0x58, 0x59, 0x5a, 0x20], 12)
  header.set([0x61, 0x63, 0x73, 0x70], 36)
  header.set([246, 214, 0, 1, 0, 0, 0, 0, 211, 45], 70)
  header[0] = (size >>> 24) & 255
  header[1] = (size >>> 16) & 255
  header[2] = (size >>> 8) & 255
  header[3] = size & 255
  return header
}

const predictHeader = (output: Uint8Array, prediction: Uint8Array, index: number): void => {
  if (index === 8 && output.length >= 8) prediction.set(output.slice(4, 8), 80)
  if (index === 41 && output.length >= 41) {
    if (output[40] === 65) prediction.set([80, 80, 76], 41)
    if (output[40] === 77) prediction.set([83, 70, 84], 41)
  }
  if (index === 42 && output.length >= 42) {
    if (output[40] === 83 && output[41] === 71) prediction.set([73, 32], 42)
    if (output[40] === 83 && output[41] === 85) prediction.set([78, 87], 42)
  }
}

const shuffled = (input: Uint8Array, width: 2 | 4): Uint8Array => {
  const height = Math.ceil(input.byteLength / width)
  const output = new Uint8Array(input.byteLength)
  let row = 0
  let position = 0
  for (let index = 0; index < input.byteLength; index += 1) {
    output[index] = input[position] ?? 0
    position += height
    if (position >= input.byteLength) {
      row += 1
      position = row
    }
  }
  return output
}

const uint32 = (data: Uint8Array, offset: number): number =>
  ((data[offset] ?? 0) * 0x1000000 +
    (data[offset + 1] ?? 0) * 0x10000 +
    (data[offset + 2] ?? 0) * 0x100 +
    (data[offset + 3] ?? 0)) >>>
  0

const predictedByte = (
  output: Uint8Array,
  start: number,
  index: number,
  stride: number,
  width: 1 | 2 | 4,
  order: 0 | 1 | 2,
): number => {
  const predict = (first: number, second: number, third: number): number =>
    order === 0 ? first : order === 1 ? first * 2 - second : first * 3 - second * 3 + third
  if (width === 1) {
    return (
      predict(
        output[start + index - stride] ?? 0,
        output[start + index - stride * 2] ?? 0,
        output[start + index - stride * 3] ?? 0,
      ) & 255
    )
  }
  const aligned = start + (index & ~(width - 1))
  const value =
    width === 2
      ? predict(
          ((output[aligned - stride] ?? 0) << 8) + (output[aligned - stride + 1] ?? 0),
          ((output[aligned - stride * 2] ?? 0) << 8) + (output[aligned - stride * 2 + 1] ?? 0),
          ((output[aligned - stride * 3] ?? 0) << 8) + (output[aligned - stride * 3 + 1] ?? 0),
        )
      : predict(
          uint32(output, aligned - stride),
          uint32(output, aligned - stride * 2),
          uint32(output, aligned - stride * 3),
        )
  return (value >>> ((width - 1 - (index & (width - 1))) * 8)) & 255
}

export const decodeJpegXlIccCommands = (
  encoded: Uint8Array,
  maxOutputBytes: number,
): Uint8Array => {
  const commandPosition = { value: 0 }
  const outputSize = readVarint(encoded, commandPosition, encoded.byteLength)
  if (outputSize > maxOutputBytes) {
    throw limitExceeded(`JPEG XL ICC requires ${outputSize} bytes; limit is ${maxOutputBytes}`)
  }
  const commandBytes = readVarint(encoded, commandPosition, encoded.byteLength)
  const commandEnd = commandPosition.value + commandBytes
  if (commandEnd > encoded.byteLength) throw invalidInput('JPEG XL ICC command stream is truncated')
  const dataPosition = { value: commandEnd }
  const output = new IccOutput(outputSize)
  const prediction = initialHeader(outputSize)
  for (let index = 0; index < ICC_HEADER_BYTES && output.length < outputSize; index += 1) {
    predictHeader(output.data, prediction, index)
    if (dataPosition.value >= encoded.byteLength)
      throw invalidInput('JPEG XL ICC header is truncated')
    output.writeByte(((encoded[dataPosition.value] ?? 0) + (prediction[index] ?? 0)) & 255)
    dataPosition.value += 1
  }
  if (output.length === outputSize) {
    if (commandPosition.value !== commandEnd || dataPosition.value !== encoded.byteLength) {
      throw invalidInput('JPEG XL ICC contains trailing commands or data')
    }
    return output.data
  }

  const tagsEncoded = readVarint(encoded, commandPosition, commandEnd)
  if (tagsEncoded > 0) {
    const tagCount = tagsEncoded - 1
    if (tagCount > Math.floor((outputSize - ICC_HEADER_BYTES - 4) / 12)) {
      throw invalidInput('JPEG XL ICC tag table exceeds its declared size')
    }
    appendU32(output, tagCount)
    let previousStart = ICC_HEADER_BYTES + tagCount * 12
    let previousSize = 0
    while (commandPosition.value < commandEnd) {
      const command = encoded[commandPosition.value] ?? 0
      commandPosition.value += 1
      const code = command & 63
      if (code === 0) break
      let tag: string
      if (code === 1) {
        if (dataPosition.value + 4 > encoded.byteLength)
          throw invalidInput('JPEG XL ICC tag is truncated')
        tag = String.fromCharCode(...encoded.subarray(dataPosition.value, dataPosition.value + 4))
        dataPosition.value += 4
      } else if (code === 2) tag = 'rTRC'
      else if (code === 3) tag = 'rXYZ'
      else {
        const named = tagNames[code - 4]
        if (!named) throw invalidInput('JPEG XL ICC tag code is invalid')
        tag = named
      }
      appendText(output, tag)
      let size = previousSize
      if (
        tag === 'rXYZ' ||
        tag === 'gXYZ' ||
        tag === 'bXYZ' ||
        tag === 'kXYZ' ||
        tag === 'wtpt' ||
        tag === 'bkpt' ||
        tag === 'lumi'
      )
        size = 20
      const start =
        (command & 64) !== 0
          ? readVarint(encoded, commandPosition, commandEnd)
          : previousStart + previousSize
      appendU32(output, start)
      if ((command & 128) !== 0) size = readVarint(encoded, commandPosition, commandEnd)
      appendU32(output, size)
      previousStart = start
      previousSize = size
      if (code === 2) {
        for (const sibling of ['gTRC', 'bTRC']) {
          appendText(output, sibling)
          appendU32(output, start)
          appendU32(output, size)
        }
      } else if (code === 3) {
        for (let sibling = 1; sibling <= 2; sibling += 1) {
          appendText(output, sibling === 1 ? 'gXYZ' : 'bXYZ')
          appendU32(output, start + size * sibling)
          appendU32(output, size)
        }
      }
    }
  }

  while (commandPosition.value < commandEnd) {
    const command = encoded[commandPosition.value] ?? 0
    commandPosition.value += 1
    if (command === 1 || command === 2 || command === 3) {
      const count = readVarint(encoded, commandPosition, commandEnd)
      output.reserve(count)
      if (dataPosition.value + count > encoded.byteLength)
        throw invalidInput('JPEG XL ICC data is truncated')
      let bytes = encoded.subarray(dataPosition.value, dataPosition.value + count)
      if (command === 2 || command === 3) bytes = shuffled(bytes, command === 2 ? 2 : 4)
      output.append(bytes)
      dataPosition.value += count
    } else if (command === 4) {
      if (commandPosition.value >= commandEnd)
        throw invalidInput('JPEG XL ICC predictor is truncated')
      const flags = encoded[commandPosition.value] ?? 0
      commandPosition.value += 1
      const widthCode = (flags & 3) + 1
      if (widthCode === 3) throw invalidInput('JPEG XL ICC predictor width is invalid')
      const width = widthCode === 1 ? 1 : widthCode === 2 ? 2 : 4
      const orderCode = (flags >>> 2) & 3
      if (orderCode === 3) throw invalidInput('JPEG XL ICC predictor order is invalid')
      const order = orderCode === 0 ? 0 : orderCode === 1 ? 1 : 2
      const stride = (flags & 16) !== 0 ? readVarint(encoded, commandPosition, commandEnd) : width
      if (stride < width || output.length === 0 || stride * 4 >= output.length) {
        throw invalidInput('JPEG XL ICC predictor stride is invalid')
      }
      const count = readVarint(encoded, commandPosition, commandEnd)
      output.reserve(count)
      if (dataPosition.value + count > encoded.byteLength)
        throw invalidInput('JPEG XL ICC predictor data is truncated')
      let residuals = encoded.subarray(dataPosition.value, dataPosition.value + count)
      if (width === 2 || width === 4) residuals = shuffled(residuals, width)
      output.reserve(count)
      const start = output.length
      for (let index = 0; index < count; index += 1) {
        output.writeByte(
          (predictedByte(output.data, start, index, stride, width, order) +
            (residuals[index] ?? 0)) &
            255,
        )
      }
      dataPosition.value += count
    } else if (command === 10) {
      appendText(output, 'XYZ ')
      appendU32(output, 0)
      if (dataPosition.value + 12 > encoded.byteLength)
        throw invalidInput('JPEG XL ICC XYZ data is truncated')
      output.append(encoded.subarray(dataPosition.value, dataPosition.value + 12))
      dataPosition.value += 12
    } else if (command >= 16 && command < 16 + typeNames.length) {
      appendText(output, typeNames[command - 16] ?? '')
      appendU32(output, 0)
    } else throw invalidInput('JPEG XL ICC command is invalid')
    if (output.length > outputSize)
      throw invalidInput('JPEG XL ICC expands beyond its declared size')
  }
  if (dataPosition.value !== encoded.byteLength || output.length !== outputSize) {
    throw invalidInput('JPEG XL ICC decoded size is inconsistent')
  }
  return output.data
}

export const readJpegXlIcc = (
  reader: JpegXlBitReader,
  maxCompressedBytes: number,
  maxOutputBytes: number,
): Uint8Array => {
  const encodedSize = readU64(reader)
  if (encodedSize > maxCompressedBytes) {
    throw limitExceeded(
      `JPEG XL compressed ICC requires ${encodedSize} bytes; limit is ${maxCompressedBytes}`,
    )
  }
  const code = readJpegXlEntropyCode(reader, ICC_CONTEXTS)
  const symbols = new JpegXlEntropySymbolReader(code, Math.max(1, encodedSize))
  const encoded = new Uint8Array(encodedSize)
  for (let index = 0; index < encodedSize; index += 1) {
    const previous = encoded[index - 1] ?? 0
    const beforePrevious = encoded[index - 2] ?? 0
    const symbol = symbols.readHybridUint(contextFor(index, previous, beforePrevious), reader)
    if (symbol > 255) throw invalidInput('JPEG XL ICC entropy symbol exceeds one byte')
    encoded[index] = symbol
  }
  if (!symbols.hasValidFinalState()) throw invalidInput('JPEG XL ICC entropy state is invalid')
  return decodeJpegXlIccCommands(encoded, maxOutputBytes)
}
