import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../../errors.ts'
import type { ImageLimitOptions, ImageLimits } from '../../limits.ts'
import { resolveLimits, validateImageDimensions } from '../../limits.ts'
import { rasterSampleBytes, type RasterBlock, type RasterSampleType } from '../../raster.ts'
import { createImageSource, readExactly, type ImageInput, type ImageSource } from '../../source.ts'
import type {
  MultidimensionalRasterDataset,
  RasterChannelInfo,
  RasterPlaneRequest,
} from '../dataset.ts'

export type EnviInterleave = 'bsq' | 'bil' | 'bip'
export type EnviByteOrder = 0 | 1
export type SupportedEnviDataType = 1 | 2 | 3 | 4 | 5 | 12 | 13
export type EnviFileType = 'ENVI Standard' | 'ENVI Classification'

export interface EnviClassInfo {
  readonly value: number
  readonly name: string
  readonly color: {
    readonly red: number
    readonly green: number
    readonly blue: number
  }
}

/** Paired ENVI header and binary sources plus bounded-read limits. */
export interface EnviOpenOptions extends ImageLimitOptions {
  readonly header: ImageInput
  readonly data: ImageInput
  readonly maxHeaderBytes?: number
  readonly rowsPerBlock?: number
}

/**
 * Lazy ENVI Standard or Classification dataset. Native numeric samples,
 * metadata, interleave, and byte order are preserved. Plane and ROI reads use
 * calculated ranges and do not materialize the complete binary source.
 */
export interface EnviDataset extends MultidimensionalRasterDataset {
  readonly format: 'envi'
  readonly dataType: SupportedEnviDataType
  readonly interleave: EnviInterleave
  readonly byteOrder: EnviByteOrder
  readonly headerOffset: number
  readonly fileType: EnviFileType
  readonly classes?: readonly EnviClassInfo[]
  readonly description?: string
  readonly sensorType?: string
  readonly defaultBands?: readonly number[]
  readonly sourceBytesRead: number
  readonly metadata: Readonly<Record<string, string>>
}

interface ParsedEnviHeader {
  readonly bands: number
  readonly bandNames?: readonly string[]
  readonly byteOrder: EnviByteOrder
  readonly dataType: SupportedEnviDataType
  readonly defaultBands?: readonly number[]
  readonly description?: string
  readonly fileType: EnviFileType
  readonly classes?: readonly EnviClassInfo[]
  readonly fwhm?: readonly number[]
  readonly headerOffset: number
  readonly interleave: EnviInterleave
  readonly lines: number
  readonly metadata: Readonly<Record<string, string>>
  readonly noDataValue?: number
  readonly samples: number
  readonly sensorType?: string
  readonly wavelength?: readonly number[]
  readonly wavelengthUnit?: string
}

interface HeaderField {
  readonly key: string
  readonly value: string
}

const requiredHeaderFields = [
  'samples',
  'lines',
  'bands',
  'file type',
  'data type',
  'interleave',
  'byte order',
] as const

const positiveIntegerOption = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const normalizedKey = (value: string): string => value.trim().toLowerCase().replaceAll(/\s+/g, ' ')

const parseHeaderFields = (text: string): readonly HeaderField[] => {
  const normalized = text.startsWith('\uFEFF') ? text.slice(1) : text
  const lines = normalized.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  let lineIndex = 0
  while (lineIndex < lines.length && (lines[lineIndex]?.trim() ?? '') === '') lineIndex += 1
  if (lines[lineIndex]?.trim() !== 'ENVI') throw invalidInput('ENVI header must begin with ENVI')
  lineIndex += 1
  const fields: HeaderField[] = []
  while (lineIndex < lines.length) {
    const raw = lines[lineIndex] ?? ''
    lineIndex += 1
    if (raw.trim().length === 0 || raw.trimStart().startsWith(';')) continue
    const equals = raw.indexOf('=')
    if (equals < 1) throw invalidInput('ENVI header line is missing a field assignment')
    const key = normalizedKey(raw.slice(0, equals))
    if (!/^[a-z][a-z0-9 _-]*$/.test(key)) throw invalidInput(`ENVI header field ${key} is invalid`)
    let value = raw.slice(equals + 1).trim()
    if (value.startsWith('{')) {
      value = value.slice(1)
      const parts: string[] = []
      let closed = false
      while (true) {
        const close = value.indexOf('}')
        if (close >= 0) {
          const trailing = value.slice(close + 1).trim()
          if (trailing.length !== 0) {
            throw invalidInput(`ENVI header field ${key} has data after its closing brace`)
          }
          parts.push(value.slice(0, close))
          closed = true
          break
        }
        parts.push(value)
        const next = lines[lineIndex]
        if (next === undefined) break
        lineIndex += 1
        value = next
      }
      if (!closed) throw truncatedInput(`ENVI header field ${key} has an unterminated list`)
      value = parts.join('\n').trim()
    } else if (value.includes('}')) {
      throw invalidInput(`ENVI header field ${key} has an unmatched closing brace`)
    }
    fields.push({ key, value })
  }
  return fields
}

const fieldMap = (fields: readonly HeaderField[]): ReadonlyMap<string, string> => {
  const result = new Map<string, string>()
  for (const field of fields) {
    if (result.has(field.key))
      throw invalidInput(`ENVI header field ${field.key} occurs more than once`)
    result.set(field.key, field.value)
  }
  for (const required of requiredHeaderFields) {
    if (!result.has(required)) throw invalidInput(`ENVI header requires ${required}`)
  }
  return result
}

const requiredValue = (fields: ReadonlyMap<string, string>, key: string): string => {
  const value = fields.get(key)
  if (value === undefined || value.trim().length === 0) throw invalidInput(`ENVI ${key} is empty`)
  return value.trim()
}

const integerField = (
  fields: ReadonlyMap<string, string>,
  key: string,
  minimum: number,
): number => {
  const raw = requiredValue(fields, key)
  if (!/^[0-9]+$/.test(raw)) throw invalidInput(`ENVI ${key} must be an integer`)
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw invalidInput(`ENVI ${key} must be a safe integer at least ${minimum}`)
  }
  return value
}

const numericValue = (raw: string, name: string): number => {
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'nan') return Number.NaN
  if (normalized === 'inf' || normalized === '+inf' || normalized === 'infinity') {
    return Number.POSITIVE_INFINITY
  }
  if (normalized === '-inf' || normalized === '-infinity') return Number.NEGATIVE_INFINITY
  const value = Number(raw)
  if (!Number.isFinite(value)) throw invalidInput(`ENVI ${name} contains an invalid number`)
  return value
}

const listValues = (raw: string): readonly string[] =>
  raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

const numericList = (
  fields: ReadonlyMap<string, string>,
  key: string,
): readonly number[] | undefined => {
  const raw = fields.get(key)
  if (raw === undefined) return undefined
  return Object.freeze(listValues(raw).map((value) => numericValue(value, key)))
}

const stringList = (
  fields: ReadonlyMap<string, string>,
  key: string,
): readonly string[] | undefined => {
  const raw = fields.get(key)
  return raw === undefined ? undefined : Object.freeze(listValues(raw))
}

const exactBandList = <Value>(
  name: string,
  values: readonly Value[] | undefined,
  bands: number,
): readonly Value[] | undefined => {
  if (values !== undefined && values.length !== bands) {
    throw invalidInput(`ENVI ${name} must contain exactly ${bands} values`)
  }
  return values
}

const classificationClasses = (
  fields: ReadonlyMap<string, string>,
  fileType: EnviFileType,
  bands: number,
): readonly EnviClassInfo[] | undefined => {
  if (fileType !== 'ENVI Classification') return undefined
  if (bands !== 1) throw invalidInput('ENVI Classification requires exactly one band')
  const count = integerField(fields, 'classes', 1)
  const names = stringList(fields, 'class names')
  const lookup = numericList(fields, 'class lookup')
  if (names === undefined) throw invalidInput('ENVI Classification requires class names')
  if (lookup === undefined) throw invalidInput('ENVI Classification requires class lookup')
  if (names.length !== count) {
    throw invalidInput(`ENVI class names must contain exactly ${count} values`)
  }
  if (lookup.length !== count * 3) {
    throw invalidInput(`ENVI class lookup must contain exactly ${count * 3} RGB values`)
  }
  return Object.freeze(
    Array.from({ length: count }, (_, value) => {
      const red = lookup[value * 3]
      const green = lookup[value * 3 + 1]
      const blue = lookup[value * 3 + 2]
      if (
        red === undefined ||
        green === undefined ||
        blue === undefined ||
        !Number.isSafeInteger(red) ||
        !Number.isSafeInteger(green) ||
        !Number.isSafeInteger(blue) ||
        red < 0 ||
        red > 255 ||
        green < 0 ||
        green > 255 ||
        blue < 0 ||
        blue > 255
      ) {
        throw invalidInput('ENVI class lookup values must be integers from 0 through 255')
      }
      return Object.freeze({
        value,
        name: names[value] ?? '',
        color: Object.freeze({ red, green, blue }),
      })
    }),
  )
}

const dataType = (value: number): SupportedEnviDataType => {
  if (
    value === 1 ||
    value === 2 ||
    value === 3 ||
    value === 4 ||
    value === 5 ||
    value === 12 ||
    value === 13
  ) {
    return value
  }
  if (value === 6 || value === 9) {
    throw unsupportedOperation(`ENVI complex data type ${value} is unsupported`)
  }
  if (value === 14 || value === 15) {
    throw unsupportedOperation(
      `ENVI 64-bit integer data type ${value} is unsupported without a lossless native raster representation`,
    )
  }
  throw unsupportedOperation(`ENVI data type ${value} is unsupported`)
}

const sampleType = (value: SupportedEnviDataType): RasterSampleType => {
  if (value === 1) return 'uint8'
  if (value === 2) return 'int16'
  if (value === 3) return 'int32'
  if (value === 4) return 'float32'
  if (value === 5) return 'float64'
  if (value === 12) return 'uint16'
  return 'uint32'
}

const parseEnviHeader = (text: string): ParsedEnviHeader => {
  const fields = fieldMap(parseHeaderFields(text))
  const samples = integerField(fields, 'samples', 1)
  const lines = integerField(fields, 'lines', 1)
  const bands = integerField(fields, 'bands', 1)
  const headerOffset = fields.has('header offset') ? integerField(fields, 'header offset', 0) : 0
  const fileTypeRaw = requiredValue(fields, 'file type')
  const normalizedFileType = fileTypeRaw.toLowerCase()
  if (normalizedFileType !== 'envi standard' && normalizedFileType !== 'envi classification') {
    throw unsupportedOperation(`ENVI file type ${fileTypeRaw} is unsupported`)
  }
  const fileType: EnviFileType =
    normalizedFileType === 'envi classification' ? 'ENVI Classification' : 'ENVI Standard'
  const parsedDataType = dataType(integerField(fields, 'data type', 1))
  const interleaveRaw = requiredValue(fields, 'interleave').toLowerCase()
  if (interleaveRaw !== 'bsq' && interleaveRaw !== 'bil' && interleaveRaw !== 'bip') {
    throw unsupportedOperation(`ENVI interleave ${interleaveRaw} is unsupported`)
  }
  const byteOrderRaw = integerField(fields, 'byte order', 0)
  if (byteOrderRaw !== 0 && byteOrderRaw !== 1) throw invalidInput('ENVI byte order must be 0 or 1')
  const bandNames = exactBandList('band names', stringList(fields, 'band names'), bands)
  const wavelength = exactBandList('wavelength', numericList(fields, 'wavelength'), bands)
  const fwhm = exactBandList('fwhm', numericList(fields, 'fwhm'), bands)
  const defaultBandsRaw = numericList(fields, 'default bands')
  const defaultBands = defaultBandsRaw?.map((value) => {
    if (!Number.isSafeInteger(value) || value < 1 || value > bands) {
      throw invalidInput('ENVI default bands contains an invalid one-based band number')
    }
    return value - 1
  })
  if (defaultBands !== undefined && defaultBands.length !== 1 && defaultBands.length !== 3) {
    throw invalidInput('ENVI default bands must contain one or three bands')
  }
  const noDataRaw = fields.get('data ignore value')
  const description = fields.get('description')?.trim()
  const sensorType = fields.get('sensor type')?.trim()
  const wavelengthUnit = fields.get('wavelength units')?.trim()
  const classes = classificationClasses(fields, fileType, bands)
  return {
    samples,
    lines,
    bands,
    headerOffset,
    fileType,
    dataType: parsedDataType,
    interleave: interleaveRaw,
    byteOrder: byteOrderRaw,
    metadata: Object.freeze(Object.fromEntries(fields)),
    ...(bandNames === undefined ? {} : { bandNames }),
    ...(wavelength === undefined ? {} : { wavelength }),
    ...(fwhm === undefined ? {} : { fwhm }),
    ...(defaultBands === undefined ? {} : { defaultBands: Object.freeze(defaultBands) }),
    ...(noDataRaw === undefined
      ? {}
      : { noDataValue: numericValue(noDataRaw, 'data ignore value') }),
    ...(description === undefined || description.length === 0 ? {} : { description }),
    ...(sensorType === undefined || sensorType.length === 0 ? {} : { sensorType }),
    ...(wavelengthUnit === undefined || wavelengthUnit.length === 0 ? {} : { wavelengthUnit }),
    ...(classes === undefined ? {} : { classes }),
  }
}

const readHeader = async (
  source: ImageSource,
  maxHeaderBytes: number,
): Promise<ParsedEnviHeader> => {
  if (source.size > maxHeaderBytes)
    throw limitExceeded(`ENVI header exceeds ${maxHeaderBytes} bytes`)
  const bytes = await readExactly(source, 0, source.size)
  if (bytes.includes(0)) throw invalidInput('ENVI header contains a NUL byte')
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw invalidInput('ENVI header is not valid UTF-8')
  }
  return parseEnviHeader(text)
}

const validateRegion = (
  request: Readonly<RasterPlaneRequest>,
  width: number,
  height: number,
  bands: number,
): {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly channels: readonly number[]
} => {
  if (request.z !== 0 || request.t !== 0) throw invalidInput('ENVI Z/T plane coordinate must be 0')
  if (request.resolutionLevel !== undefined && request.resolutionLevel !== 0) {
    throw invalidInput('ENVI resolutionLevel must be 0')
  }
  const channels =
    request.c === undefined
      ? Array.from({ length: bands }, (_, index) => index)
      : typeof request.c === 'number'
        ? [request.c]
        : [...request.c]
  if (
    channels.length < 1 ||
    channels.some((channel) => !Number.isSafeInteger(channel) || channel < 0 || channel >= bands) ||
    new Set(channels).size !== channels.length
  ) {
    throw invalidInput('ENVI channel selection is invalid')
  }
  const x = request.x ?? 0
  const y = request.y ?? 0
  const selectedWidth = request.width ?? width - x
  const selectedHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(selectedWidth) ||
    !Number.isSafeInteger(selectedHeight) ||
    x < 0 ||
    y < 0 ||
    selectedWidth < 1 ||
    selectedHeight < 1 ||
    x + selectedWidth > width ||
    y + selectedHeight > height
  ) {
    throw invalidInput('ENVI raster region is outside the dataset')
  }
  return { x, y, width: selectedWidth, height: selectedHeight, channels }
}

const copyCanonicalSample = (
  input: Uint8Array,
  inputOffset: number,
  output: Uint8Array,
  outputOffset: number,
  bytesPerSample: number,
  littleEndian: boolean,
): void => {
  if (!littleEndian || bytesPerSample === 1) {
    output.set(input.subarray(inputOffset, inputOffset + bytesPerSample), outputOffset)
    return
  }
  for (let byte = 0; byte < bytesPerSample; byte += 1) {
    output[outputOffset + byte] = input[inputOffset + bytesPerSample - byte - 1] ?? 0
  }
}

class EnviRasterDataset implements EnviDataset {
  readonly format = 'envi' as const
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ = 1
  readonly sizeC: number
  readonly sizeT = 1
  readonly sampleType: RasterSampleType
  readonly dimensionOrder = 'XYCZT'
  readonly channels: readonly RasterChannelInfo[]
  readonly noDataValue?: number
  readonly metadata: Readonly<Record<string, string>>
  readonly dataType: SupportedEnviDataType
  readonly interleave: EnviInterleave
  readonly byteOrder: EnviByteOrder
  readonly headerOffset: number
  readonly fileType: EnviFileType
  readonly classes?: readonly EnviClassInfo[]
  readonly description?: string
  readonly sensorType?: string
  readonly defaultBands?: readonly number[]
  readonly #data: ImageSource
  readonly #limits: Readonly<ImageLimits>
  readonly #rowsPerBlock: number
  #sourceBytesRead = 0

  constructor(
    data: ImageSource,
    header: ParsedEnviHeader,
    limits: Readonly<ImageLimits>,
    rowsPerBlock: number,
  ) {
    this.#data = data
    this.#limits = limits
    this.#rowsPerBlock = rowsPerBlock
    this.sizeX = header.samples
    this.sizeY = header.lines
    this.sizeC = header.bands
    this.sampleType = sampleType(header.dataType)
    this.dataType = header.dataType
    this.interleave = header.interleave
    this.byteOrder = header.byteOrder
    this.headerOffset = header.headerOffset
    this.fileType = header.fileType
    this.metadata = header.metadata
    if (header.classes !== undefined) this.classes = header.classes
    if (header.noDataValue !== undefined) this.noDataValue = header.noDataValue
    if (header.description !== undefined) this.description = header.description
    if (header.sensorType !== undefined) this.sensorType = header.sensorType
    if (header.defaultBands !== undefined) this.defaultBands = header.defaultBands
    this.channels = Object.freeze(
      Array.from({ length: header.bands }, (_, index) => {
        const center = header.wavelength?.[index]
        const fwhm = header.fwhm?.[index]
        return Object.freeze({
          id: `Band:${index + 1}`,
          name: header.bandNames?.[index] ?? `Band ${index + 1}`,
          samplesPerPixel: 1,
          ...(center === undefined
            ? {}
            : {
                spectral: Object.freeze({
                  center,
                  ...(header.wavelengthUnit === undefined ? {} : { unit: header.wavelengthUnit }),
                  ...(fwhm === undefined ? {} : { fwhm }),
                }),
              }),
        })
      }),
    )
  }

  get sourceBytesRead(): number {
    return this.#sourceBytesRead
  }

  async #read(offset: number, length: number): Promise<Uint8Array> {
    this.#sourceBytesRead += length
    return readExactly(this.#data, offset, length)
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    const region = validateRegion(request, this.sizeX, this.sizeY, this.sizeC)
    const bytesPerSample = rasterSampleBytes(this.sampleType)
    const rowBytes = region.width * bytesPerSample
    const maximumRows = Math.max(
      1,
      Math.floor(this.#limits.maxDecodedBytes / (rowBytes * region.channels.length)),
    )
    const rowsPerBlock = Math.min(this.#rowsPerBlock, maximumRows)
    if (rowBytes * region.channels.length > this.#limits.maxDecodedBytes) {
      throw limitExceeded('ENVI selected raster row exceeds maxDecodedBytes')
    }
    const littleEndian = this.byteOrder === 0
    for (let localY = 0; localY < region.height; localY += rowsPerBlock) {
      const blockHeight = Math.min(rowsPerBlock, region.height - localY)
      const planeStride = rowBytes * blockHeight
      const output = new Uint8Array(planeStride * region.channels.length)
      for (let row = 0; row < blockHeight; row += 1) {
        const sourceY = region.y + localY + row
        if (this.interleave === 'bip') {
          const inputOffset =
            this.headerOffset + (sourceY * this.sizeX + region.x) * this.sizeC * bytesPerSample
          const input = await this.#read(inputOffset, region.width * this.sizeC * bytesPerSample)
          for (let selected = 0; selected < region.channels.length; selected += 1) {
            const channel = region.channels[selected]
            if (channel === undefined) continue
            for (let column = 0; column < region.width; column += 1) {
              copyCanonicalSample(
                input,
                (column * this.sizeC + channel) * bytesPerSample,
                output,
                selected * planeStride + row * rowBytes + column * bytesPerSample,
                bytesPerSample,
                littleEndian,
              )
            }
          }
          continue
        }
        for (let selected = 0; selected < region.channels.length; selected += 1) {
          const channel = region.channels[selected]
          if (channel === undefined) continue
          const sampleIndex =
            this.interleave === 'bsq'
              ? (channel * this.sizeY + sourceY) * this.sizeX + region.x
              : (sourceY * this.sizeC + channel) * this.sizeX + region.x
          const input = await this.#read(this.headerOffset + sampleIndex * bytesPerSample, rowBytes)
          const outputRow = selected * planeStride + row * rowBytes
          if (!littleEndian || bytesPerSample === 1) {
            output.set(input, outputRow)
          } else {
            for (let column = 0; column < region.width; column += 1) {
              copyCanonicalSample(
                input,
                column * bytesPerSample,
                output,
                outputRow + column * bytesPerSample,
                bytesPerSample,
                true,
              )
            }
          }
        }
      }
      yield {
        x: region.x,
        y: region.y + localY,
        width: region.width,
        height: blockHeight,
        stride: rowBytes,
        planeStride,
        format: Object.freeze({
          sampleType: this.sampleType,
          channels: region.channels.length,
          planar: true,
        }),
        data: output,
      }
    }
  }
}

/**
 * Opens paired ENVI Standard or Classification inputs in BSQ, BIL, or BIP
 * layout. Header bytes are read eagerly, while binary samples remain lazy.
 * Classification names and RGB lookup colors are preserved. Complex values,
 * 64-bit integer values, unsupported file types, and malformed or mismatched
 * inputs reject.
 */
export const openEnvi = async (options: Readonly<EnviOpenOptions>): Promise<EnviDataset> => {
  const limits = resolveLimits(options)
  const maxHeaderBytes = positiveIntegerOption(
    'maxHeaderBytes',
    options.maxHeaderBytes ?? 4_194_304,
  )
  const rowsPerBlock = positiveIntegerOption('rowsPerBlock', options.rowsPerBlock ?? 16)
  const headerSource = await createImageSource(options.header, {
    ...limits,
    maxInputBytes: Math.min(limits.maxInputBytes, maxHeaderBytes),
  })
  const header = await readHeader(headerSource, maxHeaderBytes)
  if (header.fileType === 'ENVI Standard') {
    validateImageDimensions(header.samples, header.lines, 1, limits)
  } else {
    if (header.samples > limits.maxWidth) {
      throw limitExceeded(`ENVI width ${header.samples} exceeds maxWidth ${limits.maxWidth}`)
    }
    if (header.lines > limits.maxHeight) {
      throw limitExceeded(`ENVI height ${header.lines} exceeds maxHeight ${limits.maxHeight}`)
    }
  }
  if (header.bands > limits.maxFrames) {
    throw limitExceeded(`ENVI band count ${header.bands} exceeds maxFrames ${limits.maxFrames}`)
  }
  const dataSource = await createImageSource(options.data, limits)
  const bytesPerSample = BigInt(rasterSampleBytes(sampleType(header.dataType)))
  const payloadBytes =
    BigInt(header.samples) * BigInt(header.lines) * BigInt(header.bands) * bytesPerSample
  const expectedBytes = BigInt(header.headerOffset) + payloadBytes
  if (expectedBytes > BigInt(dataSource.size))
    throw truncatedInput('ENVI binary raster is truncated')
  if (expectedBytes < BigInt(dataSource.size))
    throw invalidInput('ENVI binary raster contains unexpected trailing data')
  return new EnviRasterDataset(dataSource, header, limits, rowsPerBlock)
}
