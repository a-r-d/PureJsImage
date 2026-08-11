import { invalidInput, limitExceeded, truncatedInput } from '../../errors.ts'
import type { ImageLimitOptions, ImageLimits } from '../../limits.ts'
import { resolveLimits, validateImageDimensions } from '../../limits.ts'
import type { RasterBlock } from '../../raster.ts'
import { createImageSource, readExactly, type ImageInput, type ImageSource } from '../../source.ts'
import type {
  MultidimensionalRasterDataset,
  PhysicalPixelSize,
  RasterChannelInfo,
  RasterPlaneRequest,
} from '../dataset.ts'

const magic = 'Gwyddion Simple Field 1.0\n'
const magicBytes = new TextEncoder().encode(magic)
const fieldNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/
const reservedFields = new Set([
  'XRes',
  'YRes',
  'XReal',
  'YReal',
  'XOffset',
  'YOffset',
  'XYUnits',
  'ZUnits',
  'Title',
])

/** Limits controlling GSF header parsing and bounded row output. */
export interface GsfOpenOptions extends ImageLimitOptions {
  readonly maxHeaderBytes?: number
  readonly rowsPerBlock?: number
}

/** Native float32 values and physical metadata for a new GSF file. */
export interface GsfWriteOptions extends ImageLimitOptions {
  readonly width: number
  readonly height: number
  readonly values: Float32Array | readonly number[]
  readonly xReal?: number
  readonly yReal?: number
  readonly xOffset?: number
  readonly yOffset?: number
  readonly xyUnit?: string
  readonly valueUnit?: string
  readonly title?: string
  readonly metadata?: Readonly<Record<string, string>>
}

/**
 * Lazy Gwyddion Simple Field surface. Float32 height samples, physical spacing,
 * offsets, units, and header metadata are preserved. Region reads fetch selected
 * rows without producing display pixels.
 */
export interface GsfDataset extends MultidimensionalRasterDataset {
  readonly format: 'gsf'
  readonly dataOffset: number
  readonly metadata: Readonly<Record<string, string>>
}

interface ParsedGsfHeader {
  readonly dataOffset: number
  readonly height: number
  readonly metadata: Readonly<Record<string, string>>
  readonly width: number
  readonly xOffset?: number
  readonly xReal?: number
  readonly xyUnit?: string
  readonly yOffset?: number
  readonly yReal?: number
  readonly title?: string
  readonly valueUnit?: string
}

const positiveIntegerOption = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const finiteNumber = (name: string, raw: string): number => {
  if (raw.trim().length === 0) throw invalidInput(`GSF ${name} is empty`)
  const value = Number(raw)
  if (!Number.isFinite(value)) throw invalidInput(`GSF ${name} must be finite`)
  return value
}

const positiveNumber = (name: string, raw: string): number => {
  const value = finiteNumber(name, raw)
  if (value <= 0) throw invalidInput(`GSF ${name} must be positive`)
  return value
}

const positiveDimension = (name: 'XRes' | 'YRes', raw: string | undefined): number => {
  if (raw === undefined) throw invalidInput(`GSF requires ${name}`)
  if (!/^[0-9]+$/.test(raw.trim())) throw invalidInput(`GSF ${name} must be a positive integer`)
  return positiveIntegerOption(`GSF ${name}`, Number(raw))
}

const optionalField = (fields: ReadonlyMap<string, string>, name: string): string | undefined => {
  const value = fields.get(name)
  return value === undefined || value.length === 0 ? undefined : value
}

const parseHeaderText = (text: string, dataOffset: number): ParsedGsfHeader => {
  if (!text.startsWith(magic)) throw invalidInput('GSF magic line is missing')
  const lines = text.slice(magic.length).split('\n')
  if (lines.at(-1) !== '') throw invalidInput('GSF header lines must end with LF')
  lines.pop()
  const fields = new Map<string, string>()
  for (const line of lines) {
    const equals = line.indexOf('=')
    if (equals < 0) throw invalidInput('GSF header line is missing =')
    const name = line.slice(0, equals).trim()
    const value = line.slice(equals + 1).trim()
    if (!fieldNamePattern.test(name)) throw invalidInput(`GSF header field name ${name} is invalid`)
    if (fields.has(name)) throw invalidInput(`GSF header field ${name} occurs more than once`)
    fields.set(name, value)
  }
  const width = positiveDimension('XRes', fields.get('XRes'))
  const height = positiveDimension('YRes', fields.get('YRes'))
  const xRealRaw = optionalField(fields, 'XReal')
  const yRealRaw = optionalField(fields, 'YReal')
  const xOffsetRaw = optionalField(fields, 'XOffset')
  const yOffsetRaw = optionalField(fields, 'YOffset')
  const xyUnit = optionalField(fields, 'XYUnits')
  const valueUnit = optionalField(fields, 'ZUnits')
  const title = optionalField(fields, 'Title')
  const metadata = Object.freeze(Object.fromEntries(fields))
  return {
    dataOffset,
    width,
    height,
    metadata,
    ...(xRealRaw === undefined ? {} : { xReal: positiveNumber('XReal', xRealRaw) }),
    ...(yRealRaw === undefined ? {} : { yReal: positiveNumber('YReal', yRealRaw) }),
    ...(xOffsetRaw === undefined ? {} : { xOffset: finiteNumber('XOffset', xOffsetRaw) }),
    ...(yOffsetRaw === undefined ? {} : { yOffset: finiteNumber('YOffset', yOffsetRaw) }),
    ...(xyUnit === undefined ? {} : { xyUnit }),
    ...(valueUnit === undefined ? {} : { valueUnit }),
    ...(title === undefined ? {} : { title }),
  }
}

const parseGsfHeader = async (
  source: ImageSource,
  maxHeaderBytes: number,
): Promise<ParsedGsfHeader> => {
  const amount = Math.min(source.size, maxHeaderBytes)
  const prefix = await source.read(0, amount)
  if (prefix.byteLength < magicBytes.byteLength) throw truncatedInput('GSF magic line is truncated')
  for (let index = 0; index < magicBytes.byteLength; index += 1) {
    if (prefix[index] !== magicBytes[index]) throw invalidInput('GSF magic line is missing')
  }
  const nul = prefix.indexOf(0, magicBytes.byteLength)
  if (nul < 0) {
    if (source.size > amount) throw limitExceeded(`GSF header exceeds ${maxHeaderBytes} bytes`)
    throw truncatedInput('GSF header terminator is missing')
  }
  const dataOffset = Math.ceil((nul + 1) / 4) * 4
  const padding = dataOffset - nul
  if (padding < 1 || padding > 4 || dataOffset > source.size) {
    throw invalidInput('GSF header/data offset is impossible')
  }
  const padded = dataOffset <= prefix.byteLength ? prefix : await readExactly(source, 0, dataOffset)
  for (let index = nul; index < dataOffset; index += 1) {
    if (padded[index] !== 0) throw invalidInput('GSF header padding must contain only NUL bytes')
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(padded.subarray(0, nul))
  } catch {
    throw invalidInput('GSF header is not valid UTF-8')
  }
  return parseHeaderText(text, dataOffset)
}

const physical = (
  value: number | undefined,
  unit: string | undefined,
): PhysicalPixelSize | undefined =>
  value === undefined
    ? undefined
    : Object.freeze({ value, ...(unit === undefined ? {} : { unit }) })

const validatePlaneRequest = (
  request: Readonly<RasterPlaneRequest>,
  width: number,
  height: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
  if (request.z !== 0 || request.t !== 0) throw invalidInput('GSF Z/T plane coordinate must be 0')
  if (request.resolutionLevel !== undefined && request.resolutionLevel !== 0) {
    throw invalidInput('GSF resolutionLevel must be 0')
  }
  const channels =
    request.c === undefined ? [0] : typeof request.c === 'number' ? [request.c] : request.c
  if (channels.length !== 1 || channels[0] !== 0)
    throw invalidInput('GSF channel selection must be 0')
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
    throw invalidInput('GSF raster region is outside the dataset')
  }
  return { x, y, width: selectedWidth, height: selectedHeight }
}

class GsfRasterDataset implements GsfDataset {
  readonly format = 'gsf' as const
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ = 1
  readonly sizeC = 1
  readonly sizeT = 1
  readonly sampleType = 'float32' as const
  readonly dimensionOrder = 'XYCZT'
  readonly channels: readonly RasterChannelInfo[]
  readonly physicalSizeX?: PhysicalPixelSize
  readonly physicalSizeY?: PhysicalPixelSize
  readonly originX?: PhysicalPixelSize
  readonly originY?: PhysicalPixelSize
  readonly metadata: Readonly<Record<string, string>>
  readonly dataOffset: number
  readonly #source: ImageSource
  readonly #rowsPerBlock: number

  constructor(source: ImageSource, header: ParsedGsfHeader, rowsPerBlock: number) {
    this.#source = source
    this.#rowsPerBlock = rowsPerBlock
    this.sizeX = header.width
    this.sizeY = header.height
    this.dataOffset = header.dataOffset
    this.metadata = header.metadata
    this.channels = Object.freeze([
      Object.freeze({
        samplesPerPixel: 1,
        ...(header.title === undefined ? {} : { name: header.title }),
        ...(header.valueUnit === undefined ? {} : { unit: header.valueUnit }),
      }),
    ])
    const pixelX = header.xReal === undefined ? undefined : header.xReal / header.width
    const pixelY = header.yReal === undefined ? undefined : header.yReal / header.height
    const physicalSizeX = physical(pixelX, header.xyUnit)
    const physicalSizeY = physical(pixelY, header.xyUnit)
    const originX = physical(header.xOffset, header.xyUnit)
    const originY = physical(header.yOffset, header.xyUnit)
    if (physicalSizeX !== undefined) this.physicalSizeX = physicalSizeX
    if (physicalSizeY !== undefined) this.physicalSizeY = physicalSizeY
    if (originX !== undefined) this.originX = originX
    if (originY !== undefined) this.originY = originY
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    const region = validatePlaneRequest(request, this.sizeX, this.sizeY)
    for (let localY = 0; localY < region.height; localY += this.#rowsPerBlock) {
      const blockHeight = Math.min(this.#rowsPerBlock, region.height - localY)
      const rowBytes = region.width * 4
      const output = new Uint8Array(rowBytes * blockHeight)
      const outputView = new DataView(output.buffer)
      for (let row = 0; row < blockHeight; row += 1) {
        const sourceOffset =
          this.dataOffset + ((region.y + localY + row) * this.sizeX + region.x) * 4
        const input = await readExactly(this.#source, sourceOffset, rowBytes)
        const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength)
        for (let column = 0; column < region.width; column += 1) {
          outputView.setFloat32(
            (row * region.width + column) * 4,
            inputView.getFloat32(column * 4, true),
            false,
          )
        }
      }
      yield {
        x: region.x,
        y: region.y + localY,
        width: region.width,
        height: blockHeight,
        stride: rowBytes,
        format: Object.freeze({ sampleType: 'float32', channels: 1, planar: false }),
        data: output,
      }
    }
  }
}

/** Opens and validates one GSF surface while leaving float32 rows lazy. */
export const openGsf = async (
  input: ImageInput,
  options: Readonly<GsfOpenOptions> = {},
): Promise<GsfDataset> => {
  const limits = resolveLimits(options)
  const maxHeaderBytes = positiveIntegerOption(
    'maxHeaderBytes',
    options.maxHeaderBytes ?? 1_048_576,
  )
  const rowsPerBlock = positiveIntegerOption('rowsPerBlock', options.rowsPerBlock ?? 32)
  const source = await createImageSource(input, limits)
  const header = await parseGsfHeader(source, maxHeaderBytes)
  validateImageDimensions(header.width, header.height, 1, limits)
  const payloadBytes = BigInt(header.width) * BigInt(header.height) * 4n
  if (payloadBytes > BigInt(limits.maxDecodedBytes)) {
    throw limitExceeded(
      `GSF sample payload is ${payloadBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
    )
  }
  const expectedSize = BigInt(header.dataOffset) + payloadBytes
  if (expectedSize > BigInt(source.size)) throw truncatedInput('GSF float32 payload is truncated')
  if (expectedSize < BigInt(source.size))
    throw invalidInput('GSF contains unexpected trailing data')
  return new GsfRasterDataset(source, header, rowsPerBlock)
}

const validateHeaderText = (name: string, value: string): void => {
  if (!fieldNamePattern.test(name)) throw invalidInput(`GSF metadata field name ${name} is invalid`)
  if (value.includes('\n') || value.includes('\0') || value.includes('\r')) {
    throw invalidInput(`GSF metadata field ${name} contains a forbidden line terminator or NUL`)
  }
}

const numberText = (name: string, value: number, positive: boolean): string => {
  if (!Number.isFinite(value) || (positive && value <= 0)) {
    throw invalidInput(`GSF ${name} must be ${positive ? 'positive and ' : ''}finite`)
  }
  return String(value)
}

/** Encodes a complete GSF surface with little-endian float32 samples. */
export const encodeGsf = (options: Readonly<GsfWriteOptions>): Uint8Array => {
  const limits: Readonly<ImageLimits> = resolveLimits(options)
  validateImageDimensions(options.width, options.height, 1, limits)
  const samples = options.width * options.height
  if (!Number.isSafeInteger(samples) || options.values.length !== samples) {
    throw invalidInput('GSF values length must equal width * height')
  }
  const payloadBytes = BigInt(samples) * 4n
  if (payloadBytes > BigInt(limits.maxDecodedBytes)) {
    throw limitExceeded(
      `GSF sample payload is ${payloadBytes} bytes; maxDecodedBytes is ${limits.maxDecodedBytes}`,
    )
  }
  const lines = [magic.trimEnd(), `XRes = ${options.width}`, `YRes = ${options.height}`]
  if (options.xReal !== undefined) lines.push(`XReal = ${numberText('XReal', options.xReal, true)}`)
  if (options.yReal !== undefined) lines.push(`YReal = ${numberText('YReal', options.yReal, true)}`)
  if (options.xOffset !== undefined)
    lines.push(`XOffset = ${numberText('XOffset', options.xOffset, false)}`)
  if (options.yOffset !== undefined)
    lines.push(`YOffset = ${numberText('YOffset', options.yOffset, false)}`)
  const strings: readonly [string, string | undefined][] = [
    ['XYUnits', options.xyUnit],
    ['ZUnits', options.valueUnit],
    ['Title', options.title],
  ]
  for (const [name, value] of strings) {
    if (value === undefined) continue
    validateHeaderText(name, value)
    lines.push(`${name} = ${value}`)
  }
  for (const [name, value] of Object.entries(options.metadata ?? {})) {
    if (reservedFields.has(name)) continue
    validateHeaderText(name, value)
    lines.push(`${name} = ${value}`)
  }
  const header = new TextEncoder().encode(`${lines.join('\n')}\n`)
  const padding = 4 - (header.byteLength % 4)
  const totalBytes = BigInt(header.byteLength + padding) + payloadBytes
  if (totalBytes > BigInt(limits.maxInputBytes)) {
    throw limitExceeded(
      `Encoded GSF is ${totalBytes} bytes; maxInputBytes is ${limits.maxInputBytes}`,
    )
  }
  const output = new Uint8Array(Number(totalBytes))
  output.set(header)
  const view = new DataView(output.buffer)
  const dataOffset = header.byteLength + padding
  for (let index = 0; index < samples; index += 1) {
    view.setFloat32(dataOffset + index * 4, options.values[index] ?? 0, true)
  }
  return output
}
