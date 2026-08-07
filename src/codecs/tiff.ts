import type {
  DecodeRequest,
  EncodeRequest,
  ImageCodec,
  ImageDecoder,
  ImageEncoder,
  ImageMetadata,
} from '../codec.ts'
import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { PixelBlock, PixelFormat } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'

const blockRows = 32
const compressionNone = 1
const compressionLzw = 5
const compressionDeflate = 8
const compressionAdobeDeflate = 32946
const compressionPackBits = 32773
const photometricWhiteIsZero = 0
const photometricBlackIsZero = 1
const photometricRgb = 2
const photometricPalette = 3

interface IfdEntry {
  readonly fieldType: number
  readonly count: number
  readonly valueOffset: number
  readonly inline: Uint8Array
}

interface TiffIfd {
  readonly offset: number
  readonly entries: ReadonlyMap<number, IfdEntry>
  readonly nextOffset: number
}

interface TiffDescription {
  readonly littleEndian: boolean
  readonly width: number
  readonly height: number
  readonly bitsPerSample: readonly number[]
  readonly compression: number
  readonly photometric: number
  readonly fillOrder: number
  readonly samplesPerPixel: number
  readonly rowsPerStrip: number
  readonly stripOffsets: readonly number[]
  readonly stripByteCounts: readonly number[]
  readonly stripsPerPlane: number
  readonly planarConfiguration: number
  readonly predictor: number
  readonly palette: Uint8Array | undefined
  readonly alphaSample: number | undefined
  readonly associatedAlpha: boolean
  readonly orientation: number
  readonly frames: number
  readonly pixelFormat: 'gray8' | 'rgb8' | 'rgba8'
}

interface Region {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const isTiff = (header: Uint8Array): boolean =>
  (header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2a && header[3] === 0) ||
  (header[0] === 0x4d && header[1] === 0x4d && header[2] === 0 && header[3] === 0x2a)

const checkedEnd = (offset: number, length: number, size: number, label: string): number => {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw invalidInput(`TIFF ${label} extent is invalid`)
  }
  const end = offset + length
  if (!Number.isSafeInteger(end) || end > size) {
    throw truncatedInput(`TIFF ${label} exceeds the input`)
  }
  return end
}

const uint16 = (bytes: Uint8Array, offset: number, littleEndian: boolean): number => {
  if (offset < 0 || offset + 2 > bytes.byteLength) throw truncatedInput('TIFF SHORT is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, littleEndian)
}

const uint32 = (bytes: Uint8Array, offset: number, littleEndian: boolean): number => {
  if (offset < 0 || offset + 4 > bytes.byteLength) throw truncatedInput('TIFF LONG is truncated')
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, littleEndian)
}

const readIfd = async (
  source: ImageSource,
  offset: number,
  littleEndian: boolean,
): Promise<TiffIfd> => {
  checkedEnd(offset, 2, source.size, 'IFD header')
  const countBytes = await readExactly(source, offset, 2)
  const entryCount = uint16(countBytes, 0, littleEndian)
  const ifdBytes = 2 + entryCount * 12 + 4
  checkedEnd(offset, ifdBytes, source.size, 'IFD')
  const bytes = await readExactly(source, offset, ifdBytes)
  const entries = new Map<number, IfdEntry>()

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = 2 + index * 12
    const tag = uint16(bytes, entryOffset, littleEndian)
    if (entries.has(tag)) throw invalidInput(`TIFF IFD contains duplicate tag ${tag}`)
    entries.set(tag, {
      fieldType: uint16(bytes, entryOffset + 2, littleEndian),
      count: uint32(bytes, entryOffset + 4, littleEndian),
      valueOffset: uint32(bytes, entryOffset + 8, littleEndian),
      inline: bytes.slice(entryOffset + 8, entryOffset + 12),
    })
  }

  return {
    offset,
    entries,
    nextOffset: uint32(bytes, 2 + entryCount * 12, littleEndian),
  }
}

const fieldBytes = (fieldType: number): number => {
  if (fieldType === 1) return 1
  if (fieldType === 3) return 2
  if (fieldType === 4) return 4
  throw invalidInput(`TIFF field type ${fieldType} is unsupported for this tag`)
}

const entryValues = async (
  source: ImageSource,
  entry: IfdEntry,
  littleEndian: boolean,
  tag: number,
  maximumCount: number,
): Promise<number[]> => {
  if (entry.count < 1 || entry.count > maximumCount) {
    throw invalidInput(`TIFF tag ${tag} has invalid count ${entry.count}`)
  }
  const bytesPerValue = fieldBytes(entry.fieldType)
  const byteLength = entry.count * bytesPerValue
  if (!Number.isSafeInteger(byteLength)) throw invalidInput(`TIFF tag ${tag} is too large`)
  const bytes =
    byteLength <= 4
      ? entry.inline.subarray(0, byteLength)
      : await readExactly(
          source,
          entry.valueOffset,
          checkedEnd(entry.valueOffset, byteLength, source.size, `tag ${tag}`) - entry.valueOffset,
        )
  const values: number[] = []
  for (let index = 0; index < entry.count; index += 1) {
    const valueOffset = index * bytesPerValue
    values.push(
      entry.fieldType === 1
        ? (bytes[valueOffset] ?? 0)
        : entry.fieldType === 3
          ? uint16(bytes, valueOffset, littleEndian)
          : uint32(bytes, valueOffset, littleEndian),
    )
  }
  return values
}

const requiredValues = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  tag: number,
  maximumCount: number,
): Promise<number[]> => {
  const entry = ifd.entries.get(tag)
  if (!entry) throw invalidInput(`TIFF required tag ${tag} is missing`)
  return entryValues(source, entry, littleEndian, tag, maximumCount)
}

const optionalValues = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  tag: number,
  maximumCount: number,
): Promise<number[] | undefined> => {
  const entry = ifd.entries.get(tag)
  return entry ? entryValues(source, entry, littleEndian, tag, maximumCount) : undefined
}

const singleValue = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  tag: number,
  fallback?: number,
): Promise<number> => {
  const values = await optionalValues(source, ifd, littleEndian, tag, 1)
  const value = values?.[0] ?? fallback
  if (value === undefined) throw invalidInput(`TIFF required tag ${tag} is missing`)
  return value
}

const countFrames = async (
  source: ImageSource,
  first: TiffIfd,
  littleEndian: boolean,
  limits: ImageLimits,
): Promise<number> => {
  let frames = 1
  let nextOffset = first.nextOffset
  const seen = new Set([first.offset])
  while (nextOffset !== 0) {
    if (seen.has(nextOffset)) throw invalidInput('TIFF top-level IFD chain contains a loop')
    seen.add(nextOffset)
    frames += 1
    if (frames > limits.maxFrames) {
      throw limitExceeded(`TIFF frame count exceeds maxFrames ${limits.maxFrames}`)
    }
    nextOffset = (await readIfd(source, nextOffset, littleEndian)).nextOffset
  }
  return frames
}

const paletteFor = async (
  source: ImageSource,
  ifd: TiffIfd,
  littleEndian: boolean,
  bitDepth: number,
): Promise<Uint8Array> => {
  const colors = 2 ** bitDepth
  const values = await requiredValues(source, ifd, littleEndian, 320, colors * 3)
  if (values.length !== colors * 3) {
    throw invalidInput(`TIFF color map must contain ${colors * 3} entries`)
  }
  const palette = new Uint8Array(colors * 3)
  for (let index = 0; index < colors; index += 1) {
    palette[index * 3] = (values[index] ?? 0) >>> 8
    palette[index * 3 + 1] = (values[colors + index] ?? 0) >>> 8
    palette[index * 3 + 2] = (values[colors * 2 + index] ?? 0) >>> 8
  }
  return palette
}

const describeTiff = async (source: ImageSource, limits: ImageLimits): Promise<TiffDescription> => {
  if (source.size < 8) throw truncatedInput('TIFF header is truncated')
  const header = await readExactly(source, 0, 8)
  if (!isTiff(header)) throw invalidInput('TIFF byte order or version is invalid')
  const littleEndian = header[0] === 0x49
  const firstIfdOffset = uint32(header, 4, littleEndian)
  if (firstIfdOffset < 8) throw invalidInput('TIFF first IFD offset is invalid')
  const ifd = await readIfd(source, firstIfdOffset, littleEndian)
  const width = await singleValue(source, ifd, littleEndian, 256)
  const height = await singleValue(source, ifd, littleEndian, 257)
  const frames = await countFrames(source, ifd, littleEndian, limits)
  validateImageDimensions(width, height, frames, limits)

  const samplesPerPixel = await singleValue(source, ifd, littleEndian, 277, 1)
  if (!Number.isSafeInteger(samplesPerPixel) || samplesPerPixel < 1 || samplesPerPixel > 4) {
    throw unsupportedOperation(`TIFF SamplesPerPixel ${samplesPerPixel} is unsupported`)
  }
  const rawBits = (await optionalValues(source, ifd, littleEndian, 258, samplesPerPixel)) ?? [1]
  const bitsPerSample =
    rawBits.length === 1 && samplesPerPixel > 1
      ? Array.from({ length: samplesPerPixel }, () => rawBits[0] ?? 1)
      : rawBits
  if (bitsPerSample.length !== samplesPerPixel) {
    throw invalidInput('TIFF BitsPerSample count does not match SamplesPerPixel')
  }

  const sampleFormats = (await optionalValues(source, ifd, littleEndian, 339, samplesPerPixel)) ?? [
    1,
  ]
  if (sampleFormats.some((format) => format !== 1)) {
    throw unsupportedOperation('TIFF currently supports only unsigned integer samples')
  }
  const compression = await singleValue(source, ifd, littleEndian, 259, compressionNone)
  if (
    compression !== compressionNone &&
    compression !== compressionLzw &&
    compression !== compressionDeflate &&
    compression !== compressionAdobeDeflate &&
    compression !== compressionPackBits
  ) {
    throw unsupportedOperation(`TIFF compression ${compression} is unsupported`)
  }
  const photometric = await singleValue(source, ifd, littleEndian, 262)
  if (
    photometric !== photometricWhiteIsZero &&
    photometric !== photometricBlackIsZero &&
    photometric !== photometricRgb &&
    photometric !== photometricPalette
  ) {
    throw unsupportedOperation(`TIFF photometric interpretation ${photometric} is unsupported`)
  }
  const baseSamples = photometric === photometricRgb ? 3 : 1
  if (samplesPerPixel < baseSamples || samplesPerPixel > baseSamples + 1) {
    throw unsupportedOperation('TIFF supports at most one alpha sample')
  }
  const alphaSample = samplesPerPixel === baseSamples + 1 ? baseSamples : undefined
  const extraSamples =
    (await optionalValues(source, ifd, littleEndian, 338, samplesPerPixel - baseSamples)) ?? []
  if (
    extraSamples.length > 1 ||
    extraSamples.some((value) => value !== 0 && value !== 1 && value !== 2)
  ) {
    throw unsupportedOperation('TIFF extra sample metadata is unsupported')
  }
  if (extraSamples.length > 0 && alphaSample === undefined) {
    throw invalidInput('TIFF ExtraSamples does not match SamplesPerPixel')
  }

  const baseBitDepth = bitsPerSample[0] ?? 0
  if (photometric === photometricRgb) {
    if (bitsPerSample.some((bits) => bits !== 8)) {
      throw unsupportedOperation('TIFF RGB decoding currently requires 8-bit samples')
    }
  } else if (![1, 2, 4, 8].includes(baseBitDepth)) {
    throw unsupportedOperation(`TIFF ${baseBitDepth}-bit grayscale or palette data is unsupported`)
  }
  if (alphaSample !== undefined && bitsPerSample[alphaSample] !== 8) {
    throw unsupportedOperation('TIFF alpha decoding currently requires an 8-bit alpha sample')
  }

  const fillOrder = await singleValue(source, ifd, littleEndian, 266, 1)
  if (fillOrder !== 1) throw unsupportedOperation(`TIFF FillOrder ${fillOrder} is unsupported`)
  const planarConfiguration = await singleValue(source, ifd, littleEndian, 284, 1)
  if (planarConfiguration !== 1 && planarConfiguration !== 2) {
    throw unsupportedOperation(`TIFF PlanarConfiguration ${planarConfiguration} is unsupported`)
  }
  if (planarConfiguration === 1 && alphaSample !== undefined && baseBitDepth !== 8) {
    throw unsupportedOperation('TIFF packed grayscale or palette alpha requires planar storage')
  }
  const predictor = await singleValue(source, ifd, littleEndian, 317, 1)
  if (predictor !== 1 && predictor !== 2) {
    throw unsupportedOperation(`TIFF Predictor ${predictor} is unsupported`)
  }
  if (predictor === 2 && bitsPerSample.some((bits) => bits !== 8)) {
    throw unsupportedOperation('TIFF horizontal prediction currently requires 8-bit samples')
  }

  const declaredRowsPerStrip = await singleValue(source, ifd, littleEndian, 278, 0xffffffff)
  if (declaredRowsPerStrip < 1) throw invalidInput('TIFF RowsPerStrip must be positive')
  const rowsPerStrip = Math.min(declaredRowsPerStrip, height)
  const stripsPerPlane = Math.ceil(height / rowsPerStrip)
  const expectedStrips = stripsPerPlane * (planarConfiguration === 2 ? samplesPerPixel : 1)
  const stripOffsets = await requiredValues(source, ifd, littleEndian, 273, expectedStrips)
  const stripByteCounts = await requiredValues(source, ifd, littleEndian, 279, expectedStrips)
  if (stripOffsets.length !== expectedStrips || stripByteCounts.length !== expectedStrips) {
    throw invalidInput(`TIFF expected ${expectedStrips} strip offsets and byte counts`)
  }
  for (let index = 0; index < expectedStrips; index += 1) {
    checkedEnd(
      stripOffsets[index] ?? -1,
      stripByteCounts[index] ?? -1,
      source.size,
      `strip ${index}`,
    )
  }

  const orientation = await singleValue(source, ifd, littleEndian, 274, 1)
  if (orientation < 1 || orientation > 8)
    throw invalidInput(`TIFF Orientation ${orientation} is invalid`)
  const palette =
    photometric === photometricPalette
      ? await paletteFor(source, ifd, littleEndian, baseBitDepth)
      : undefined

  return {
    littleEndian,
    width,
    height,
    bitsPerSample,
    compression,
    photometric,
    fillOrder,
    samplesPerPixel,
    rowsPerStrip,
    stripOffsets,
    stripByteCounts,
    stripsPerPlane,
    planarConfiguration,
    predictor,
    palette,
    alphaSample,
    associatedAlpha: extraSamples[0] === 1,
    orientation,
    frames,
    pixelFormat:
      alphaSample !== undefined
        ? 'rgba8'
        : photometric === photometricWhiteIsZero || photometric === photometricBlackIsZero
          ? 'gray8'
          : 'rgb8',
  }
}

const decodePackBits = (encoded: Uint8Array, expectedBytes: number): Uint8Array => {
  const output = new Uint8Array(expectedBytes)
  let sourceOffset = 0
  let outputOffset = 0
  while (sourceOffset < encoded.byteLength && outputOffset < expectedBytes) {
    const controlByte = encoded[sourceOffset]
    if (controlByte === undefined) break
    sourceOffset += 1
    const control = controlByte > 127 ? controlByte - 256 : controlByte
    if (control >= 0) {
      const count = control + 1
      if (sourceOffset + count > encoded.byteLength || outputOffset + count > expectedBytes) {
        throw truncatedInput('TIFF PackBits literal run exceeds its strip')
      }
      output.set(encoded.subarray(sourceOffset, sourceOffset + count), outputOffset)
      sourceOffset += count
      outputOffset += count
    } else if (control >= -127) {
      const value = encoded[sourceOffset]
      const count = 1 - control
      if (value === undefined || outputOffset + count > expectedBytes) {
        throw truncatedInput('TIFF PackBits repeat run exceeds its strip')
      }
      output.fill(value, outputOffset, outputOffset + count)
      sourceOffset += 1
      outputOffset += count
    }
  }
  if (outputOffset !== expectedBytes) {
    throw truncatedInput(`TIFF PackBits produced ${outputOffset} of ${expectedBytes} bytes`)
  }
  return output
}

class LzwBitReader {
  readonly #data: Uint8Array
  #bitOffset = 0

  constructor(data: Uint8Array) {
    this.#data = data
  }

  read(width: number): number | undefined {
    if (this.#bitOffset + width > this.#data.byteLength * 8) return undefined
    let value = 0
    for (let bit = 0; bit < width; bit += 1) {
      const absolute = this.#bitOffset + bit
      const byte = this.#data[absolute >>> 3] ?? 0
      value = (value << 1) | ((byte >>> (7 - (absolute & 7))) & 1)
    }
    this.#bitOffset += width
    return value
  }
}

const decodeLzw = (encoded: Uint8Array, expectedBytes: number): Uint8Array => {
  const clearCode = 256
  const endCode = 257
  const prefixes = new Uint16Array(4096)
  const suffixes = new Uint8Array(4096)
  const stack = new Uint8Array(4096)
  const output = new Uint8Array(expectedBytes)
  const reader = new LzwBitReader(encoded)
  let nextCode = 258
  let codeWidth = 9
  let previousCode = -1
  let outputOffset = 0
  let ended = false

  const reset = (): void => {
    nextCode = 258
    codeWidth = 9
    previousCode = -1
  }

  const expand = (code: number): { first: number; length: number } => {
    let current = code
    let length = 0
    while (current >= 256) {
      if (current >= nextCode || length >= stack.byteLength) {
        throw invalidInput('TIFF LZW dictionary reference is invalid')
      }
      stack[length] = suffixes[current] ?? 0
      length += 1
      current = prefixes[current] ?? 0
    }
    if (length >= stack.byteLength) throw invalidInput('TIFF LZW dictionary chain is invalid')
    stack[length] = current
    return { first: current, length: length + 1 }
  }

  const writeExpanded = (length: number): void => {
    if (outputOffset + length > expectedBytes) {
      throw invalidInput('TIFF LZW output exceeds the declared strip size')
    }
    for (let index = length - 1; index >= 0; index -= 1) {
      output[outputOffset] = stack[index] ?? 0
      outputOffset += 1
    }
  }

  while (outputOffset < expectedBytes) {
    const code = reader.read(codeWidth)
    if (code === undefined) break
    if (code === clearCode) {
      reset()
      continue
    }
    if (code === endCode) {
      ended = true
      break
    }

    let first: number
    if (code < nextCode) {
      const sequence = expand(code)
      first = sequence.first
      writeExpanded(sequence.length)
    } else if (code === nextCode && previousCode >= 0) {
      const sequence = expand(previousCode)
      first = sequence.first
      writeExpanded(sequence.length)
      if (outputOffset >= expectedBytes) {
        throw invalidInput('TIFF LZW special code exceeds the declared strip size')
      }
      output[outputOffset] = first
      outputOffset += 1
    } else {
      throw invalidInput(`TIFF LZW code ${code} is invalid`)
    }

    if (previousCode >= 0 && nextCode < 4096) {
      prefixes[nextCode] = previousCode
      suffixes[nextCode] = first
      nextCode += 1
      if (codeWidth < 12 && nextCode === (1 << codeWidth) - 1) codeWidth += 1
    }
    previousCode = code
  }

  if (outputOffset !== expectedBytes) {
    throw truncatedInput(`TIFF LZW produced ${outputOffset} of ${expectedBytes} bytes`)
  }
  if (!ended) {
    const end = reader.read(codeWidth)
    if (end !== undefined && end !== endCode) {
      throw invalidInput('TIFF LZW data continues past the declared strip size')
    }
  }
  return output
}

const decodeDeflate = async (
  encoded: Uint8Array,
  expectedBytes: number,
  maximumBytes: number,
): Promise<Uint8Array> => {
  const output = new Uint8Array(maximumBytes)
  let offset = 0
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const stream = new Blob([encoded.slice()])
      .stream()
      .pipeThrough(new DecompressionStream('deflate'))
    reader = stream.getReader()
    while (true) {
      const result = await reader.read()
      if (result.done) break
      if (offset + result.value.byteLength > maximumBytes) {
        throw invalidInput('TIFF Deflate output exceeds RowsPerStrip')
      }
      output.set(result.value, offset)
      offset += result.value.byteLength
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'ImageError') throw error
    throw invalidInput('TIFF Deflate strip is invalid')
  } finally {
    reader?.releaseLock()
  }
  if (offset < expectedBytes) {
    throw truncatedInput(`TIFF Deflate produced ${offset} of at least ${expectedBytes} bytes`)
  }
  return output.subarray(0, expectedBytes)
}

const reversePredictor = (
  data: Uint8Array,
  rowBytes: number,
  rows: number,
  stride: number,
): void => {
  for (let row = 0; row < rows; row += 1) {
    const rowOffset = row * rowBytes
    for (let offset = stride; offset < rowBytes; offset += 1) {
      const index = rowOffset + offset
      data[index] = ((data[index] ?? 0) + (data[index - stride] ?? 0)) & 0xff
    }
  }
}

const decodeStrip = async (
  source: ImageSource,
  description: TiffDescription,
  physicalStrip: number,
  expectedBytes: number,
  rowBytes: number,
  rows: number,
  predictorStride: number,
): Promise<Uint8Array> => {
  const offset = description.stripOffsets[physicalStrip]
  const byteCount = description.stripByteCounts[physicalStrip]
  if (offset === undefined || byteCount === undefined) throw invalidInput('TIFF strip is missing')
  const encoded = await readExactly(source, offset, byteCount)
  let decoded: Uint8Array
  if (description.compression === compressionNone) {
    if (encoded.byteLength !== expectedBytes) {
      throw invalidInput(
        `TIFF uncompressed strip has ${encoded.byteLength}, expected ${expectedBytes} bytes`,
      )
    }
    decoded = encoded.slice()
  } else if (description.compression === compressionPackBits) {
    decoded = decodePackBits(encoded, expectedBytes)
  } else if (description.compression === compressionLzw) {
    decoded = decodeLzw(encoded, expectedBytes)
  } else {
    decoded = await decodeDeflate(encoded, expectedBytes, rowBytes * description.rowsPerStrip)
  }
  if (description.predictor === 2) {
    reversePredictor(decoded, rowBytes, rows, predictorStride)
  }
  return decoded
}

const regionFor = (description: TiffDescription, request: DecodeRequest): Region => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const width = request.width ?? description.width - x
  const height = request.height ?? description.height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    x < 0 ||
    y < 0 ||
    width < 1 ||
    height < 1 ||
    x + width > description.width ||
    y + height > description.height
  ) {
    throw invalidInput('TIFF decode region is invalid')
  }
  return { x, y, width, height }
}

const bitsPerChunkyPixel = (description: TiffDescription): number =>
  description.bitsPerSample.reduce((total, bits) => total + bits, 0)

const packedSample = (data: Uint8Array, bitOffset: number, bitDepth: number): number => {
  const byte = data[bitOffset >>> 3]
  if (byte === undefined) throw truncatedInput('TIFF packed sample is truncated')
  const shift = 8 - bitDepth - (bitOffset & 7)
  if (shift < 0) throw unsupportedOperation('TIFF samples crossing byte boundaries are unsupported')
  return (byte >>> shift) & ((1 << bitDepth) - 1)
}

const sampleAt = (
  planes: readonly Uint8Array[],
  description: TiffDescription,
  rowWithinStrip: number,
  x: number,
  sample: number,
): number => {
  const bitDepth = description.bitsPerSample[sample]
  if (bitDepth === undefined) throw invalidInput('TIFF sample index is invalid')
  if (description.planarConfiguration === 2) {
    const plane = planes[sample]
    if (!plane) throw truncatedInput('TIFF sample plane is missing')
    const rowBytes = Math.ceil((description.width * bitDepth) / 8)
    return packedSample(plane, rowWithinStrip * rowBytes * 8 + x * bitDepth, bitDepth)
  }

  const plane = planes[0]
  if (!plane) throw truncatedInput('TIFF chunky strip is missing')
  const pixelBits = bitsPerChunkyPixel(description)
  const rowBytes = Math.ceil((description.width * pixelBits) / 8)
  let sampleOffset = 0
  for (let index = 0; index < sample; index += 1)
    sampleOffset += description.bitsPerSample[index] ?? 0
  return packedSample(plane, rowWithinStrip * rowBytes * 8 + x * pixelBits + sampleOffset, bitDepth)
}

const scaleSample = (value: number, bits: number): number =>
  bits === 8 ? value : Math.round((value * 255) / ((1 << bits) - 1))

const unassociate = (value: number, alpha: number): number =>
  alpha === 0 ? 0 : alpha === 255 ? value : Math.min(255, Math.round((value * 255) / alpha))

class TiffDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: PixelFormat
  readonly capabilities
  readonly #source: ImageSource
  readonly #description: TiffDescription

  constructor(source: ImageSource, description: TiffDescription) {
    this.#source = source
    this.#description = description
    this.width = description.width
    this.height = description.height
    this.pixelFormat = description.pixelFormat
    this.capabilities = Object.freeze({
      sequential: true,
      regionDecode: true,
      scaledDecode: false,
      progressive: false,
    })
  }

  async *decode(request: DecodeRequest = {}): AsyncGenerator<PixelBlock> {
    const region = regionFor(this.#description, request)
    const outputChannels = this.pixelFormat === 'gray8' ? 1 : this.pixelFormat === 'rgb8' ? 3 : 4
    const firstStrip = Math.floor(region.y / this.#description.rowsPerStrip)
    const lastStrip = Math.floor((region.y + region.height - 1) / this.#description.rowsPerStrip)

    for (let logicalStrip = firstStrip; logicalStrip <= lastStrip; logicalStrip += 1) {
      const stripY = logicalStrip * this.#description.rowsPerStrip
      const stripRows = Math.min(this.#description.rowsPerStrip, this.height - stripY)
      const planes: Uint8Array[] = []
      if (this.#description.planarConfiguration === 1) {
        const rowBytes = Math.ceil((this.width * bitsPerChunkyPixel(this.#description)) / 8)
        planes.push(
          await decodeStrip(
            this.#source,
            this.#description,
            logicalStrip,
            rowBytes * stripRows,
            rowBytes,
            stripRows,
            this.#description.samplesPerPixel,
          ),
        )
      } else {
        for (let sample = 0; sample < this.#description.samplesPerPixel; sample += 1) {
          const bits = this.#description.bitsPerSample[sample] ?? 0
          const rowBytes = Math.ceil((this.width * bits) / 8)
          planes.push(
            await decodeStrip(
              this.#source,
              this.#description,
              sample * this.#description.stripsPerPlane + logicalStrip,
              rowBytes * stripRows,
              rowBytes,
              stripRows,
              1,
            ),
          )
        }
      }

      const intersectionStart = Math.max(region.y, stripY)
      const intersectionEnd = Math.min(region.y + region.height, stripY + stripRows)
      for (let imageY = intersectionStart; imageY < intersectionEnd; imageY += blockRows) {
        const rows = Math.min(blockRows, intersectionEnd - imageY)
        const output = new Uint8Array(region.width * rows * outputChannels)
        for (let localY = 0; localY < rows; localY += 1) {
          const rowWithinStrip = imageY + localY - stripY
          for (let outputX = 0; outputX < region.width; outputX += 1) {
            const sourceX = region.x + outputX
            const target = (localY * region.width + outputX) * outputChannels
            const alpha =
              this.#description.alphaSample === undefined
                ? 255
                : scaleSample(
                    sampleAt(
                      planes,
                      this.#description,
                      rowWithinStrip,
                      sourceX,
                      this.#description.alphaSample,
                    ),
                    this.#description.bitsPerSample[this.#description.alphaSample] ?? 8,
                  )
            let red: number
            let green: number
            let blue: number
            if (this.#description.photometric === photometricRgb) {
              red = sampleAt(planes, this.#description, rowWithinStrip, sourceX, 0)
              green = sampleAt(planes, this.#description, rowWithinStrip, sourceX, 1)
              blue = sampleAt(planes, this.#description, rowWithinStrip, sourceX, 2)
            } else if (this.#description.photometric === photometricPalette) {
              const index = sampleAt(planes, this.#description, rowWithinStrip, sourceX, 0)
              const paletteOffset = index * 3
              red = this.#description.palette?.[paletteOffset] ?? 0
              green = this.#description.palette?.[paletteOffset + 1] ?? 0
              blue = this.#description.palette?.[paletteOffset + 2] ?? 0
            } else {
              const bits = this.#description.bitsPerSample[0] ?? 8
              let gray = scaleSample(
                sampleAt(planes, this.#description, rowWithinStrip, sourceX, 0),
                bits,
              )
              if (this.#description.photometric === photometricWhiteIsZero) gray = 255 - gray
              red = gray
              green = gray
              blue = gray
            }
            if (this.#description.associatedAlpha) {
              red = unassociate(red, alpha)
              green = unassociate(green, alpha)
              blue = unassociate(blue, alpha)
            }
            if (this.pixelFormat === 'gray8') {
              output[target] = red
            } else {
              output[target] = red
              output[target + 1] = green
              output[target + 2] = blue
              if (this.pixelFormat === 'rgba8') output[target + 3] = alpha
            }
          }
        }
        yield {
          x: 0,
          y: imageY - region.y,
          width: region.width,
          height: rows,
          stride: region.width * outputChannels,
          format: this.pixelFormat,
          data: output,
        }
      }
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const validateEncoderOptions = (options: unknown): void => {
  if (!isRecord(options)) throw invalidInput('TIFF encoder options must be an object')
  const compression = options.compression
  if (compression !== undefined && compression !== 'none') {
    throw unsupportedOperation('TIFF encoding currently supports only compression: none')
  }
}

const writeIfdEntry = (
  view: DataView,
  offset: number,
  tag: number,
  fieldType: number,
  count: number,
  value: number,
): void => {
  view.setUint16(offset, tag, true)
  view.setUint16(offset + 2, fieldType, true)
  view.setUint32(offset + 4, count, true)
  if (fieldType === 3 && count === 1) view.setUint16(offset + 8, value, true)
  else view.setUint32(offset + 8, value, true)
}

const tiffHeader = (width: number, height: number, format: PixelFormat): Uint8Array => {
  const samples = format === 'gray8' ? 1 : format === 'rgb8' ? 3 : 4
  const entryCount = format === 'rgba8' ? 12 : 11
  const ifdOffset = 8
  const ifdBytes = 2 + entryCount * 12 + 4
  const bitsBytes = samples === 1 ? 0 : samples * 2
  const pixelOffset = ifdOffset + ifdBytes + bitsBytes
  const output = new Uint8Array(pixelOffset)
  const view = new DataView(output.buffer)
  output.set([0x49, 0x49, 0x2a, 0])
  view.setUint32(4, ifdOffset, true)
  view.setUint16(ifdOffset, entryCount, true)
  let entryOffset = ifdOffset + 2
  const entry = (tag: number, fieldType: number, count: number, value: number): void => {
    writeIfdEntry(view, entryOffset, tag, fieldType, count, value)
    entryOffset += 12
  }
  entry(256, 4, 1, width)
  entry(257, 4, 1, height)
  entry(258, 3, samples, samples === 1 ? 8 : ifdOffset + ifdBytes)
  entry(259, 3, 1, compressionNone)
  entry(262, 3, 1, format === 'gray8' ? photometricBlackIsZero : photometricRgb)
  entry(273, 4, 1, pixelOffset)
  entry(274, 3, 1, 1)
  entry(277, 3, 1, samples)
  entry(278, 4, 1, height)
  entry(279, 4, 1, width * height * samples)
  entry(284, 3, 1, 1)
  if (format === 'rgba8') entry(338, 3, 1, 2)
  view.setUint32(entryOffset, 0, true)
  if (samples > 1) {
    for (let sample = 0; sample < samples; sample += 1) {
      view.setUint16(ifdOffset + ifdBytes + sample * 2, 8, true)
    }
  }
  return output
}

class TiffEncoder implements ImageEncoder {
  readonly #sink: ImageSink
  readonly #width: number
  readonly #height: number
  readonly #format: 'gray8' | 'rgb8' | 'rgba8'
  #y = 0

  private constructor(
    sink: ImageSink,
    width: number,
    height: number,
    format: 'gray8' | 'rgb8' | 'rgba8',
  ) {
    this.#sink = sink
    this.#width = width
    this.#height = height
    this.#format = format
  }

  static async create(sink: ImageSink, request: EncodeRequest): Promise<TiffEncoder> {
    validateEncoderOptions(request.options)
    if (
      request.pixelFormat !== 'gray8' &&
      request.pixelFormat !== 'rgb8' &&
      request.pixelFormat !== 'rgba8'
    ) {
      throw unsupportedOperation(`TIFF encoding does not support ${request.pixelFormat} pixels`)
    }
    await sink.write(tiffHeader(request.width, request.height, request.pixelFormat))
    return new TiffEncoder(sink, request.width, request.height, request.pixelFormat)
  }

  async write(block: PixelBlock): Promise<void> {
    const channels = this.#format === 'gray8' ? 1 : this.#format === 'rgb8' ? 3 : 4
    if (
      block.x !== 0 ||
      block.y !== this.#y ||
      block.width !== this.#width ||
      block.height < 1 ||
      block.format !== this.#format ||
      block.stride < this.#width * channels ||
      block.data.byteLength < block.stride * block.height ||
      this.#y + block.height > this.#height
    ) {
      throw invalidInput('TIFF encoder received a non-sequential or malformed pixel block')
    }
    const rowBytes = this.#width * channels
    for (let row = 0; row < block.height; row += 1) {
      await this.#sink.write(block.data.subarray(row * block.stride, row * block.stride + rowBytes))
      this.#y += 1
    }
  }

  async finish(): Promise<void> {
    if (this.#y !== this.#height) {
      throw truncatedInput(`TIFF encoder received ${this.#y} of ${this.#height} rows`)
    }
  }
}

const metadata = (description: TiffDescription): ImageMetadata => ({
  width: description.width,
  height: description.height,
  format: 'tiff',
  mimeType: 'image/tiff',
  hasAlpha: description.alphaSample !== undefined,
  orientation: description.orientation,
  colorSpace:
    description.photometric === photometricRgb
      ? 'srgb'
      : description.photometric === photometricPalette
        ? 'indexed'
        : 'gray',
  bitDepth: Math.max(...description.bitsPerSample),
  frames: description.frames,
})

export const tiffCodec: ImageCodec = {
  format: 'tiff',
  mimeTypes: ['image/tiff', 'image/x-tiff'],
  minimumBytes: 4,
  detect: isTiff,
  metadata: async (source, limits) => metadata(await describeTiff(source, limits)),
  createDecoder: async (source, limits) =>
    new TiffDecoder(source, await describeTiff(source, limits)),
  createEncoder: async (sink, request) => TiffEncoder.create(sink, request),
}
