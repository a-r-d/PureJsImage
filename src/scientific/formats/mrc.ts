import { invalidInput, limitExceeded, truncatedInput, unsupportedOperation } from '../../errors.ts'
import type { ImageLimitOptions, ImageLimits } from '../../limits.ts'
import { resolveLimits, validateImageDimensions } from '../../limits.ts'
import { rasterSampleBytes, type RasterBlock, type RasterSampleType } from '../../raster.ts'
import {
  createImageSource,
  readExactly,
  type ImageInput,
  type ImageSource,
  type ImageSourceReadOptions,
} from '../../source.ts'
import type {
  MultidimensionalRasterDataset,
  PhysicalPixelSize,
  RasterChannelInfo,
  RasterPlaneRequest,
} from '../legacy-dataset.ts'

const headerBytes = 1_024

export type MrcMode = 0 | 1 | 2 | 6 | 12
export type MrcByteOrder = 'little-endian' | 'big-endian'

export interface MrcHeader {
  readonly NX: number
  readonly NY: number
  readonly NZ: number
  readonly MODE: MrcMode
  readonly NXSTART: number
  readonly NYSTART: number
  readonly NZSTART: number
  readonly MX: number
  readonly MY: number
  readonly MZ: number
  readonly cellDimensions: Readonly<{ x: number; y: number; z: number }>
  readonly cellAngles: Readonly<{ alpha: number; beta: number; gamma: number }>
  readonly MAPC: 1 | 2 | 3
  readonly MAPR: 1 | 2 | 3
  readonly MAPS: 1 | 2 | 3
  readonly DMIN: number
  readonly DMAX: number
  readonly DMEAN: number
  readonly ISPG: number
  readonly NSYMBT: number
  readonly EXTTYP: string
  readonly NVERSION: number
  readonly origin: Readonly<{ x: number; y: number; z: number }>
  readonly MAP: 'MAP '
  readonly machineStamp: readonly [number, number, number, number]
  readonly RMS: number
  readonly labels: readonly string[]
}

export interface MrcOpenOptions extends ImageLimitOptions {
  readonly rowsPerBlock?: number
}

/** A lazy MRC2014 or compatible CCP4 scalar image or volume. */
export interface MrcDataset extends MultidimensionalRasterDataset {
  readonly format: 'mrc'
  readonly header: MrcHeader
  readonly mode: MrcMode
  readonly byteOrder: MrcByteOrder
  readonly sourceBytesRead: number
  readonly sourceReadCalls: number
}

class CountingSource implements ImageSource {
  readonly size: number
  readonly #source: ImageSource
  bytesRead = 0
  readCalls = 0

  constructor(source: ImageSource) {
    this.#source = source
    this.size = source.size
  }

  async read(
    offset: number,
    length: number,
    options: Readonly<ImageSourceReadOptions> = {},
  ): Promise<Uint8Array> {
    const data = await this.#source.read(offset, length, options)
    this.readCalls += 1
    this.bytesRead += data.byteLength
    return data
  }
}

const positiveIntegerOption = (name: string, value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw invalidInput(`${name} must be a positive safe integer`)
  }
  return value
}

const safeNumber = (value: bigint, name: string): number => {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw limitExceeded(`MRC ${name} exceeds the JavaScript safe integer range`)
  }
  return Number(value)
}

const byteOrderFromStamp = (bytes: Uint8Array): MrcByteOrder => {
  const first = bytes[212]
  const second = bytes[213]
  const third = bytes[214]
  const fourth = bytes[215]
  if (third !== 0 || fourth !== 0) throw invalidInput('MRC machine stamp is invalid')
  if (first === 0x44 && (second === 0x44 || second === 0x41)) return 'little-endian'
  if (first === 0x11 && second === 0x11) return 'big-endian'
  throw invalidInput('MRC machine stamp does not declare a supported byte order')
}

const ascii = (bytes: Uint8Array, offset: number, length: number): string => {
  let value = ''
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[offset + index] ?? 0
    value += String.fromCharCode(byte)
  }
  return value
}

const axis = (value: number, name: string): 1 | 2 | 3 => {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw invalidInput(`MRC ${name} must be 1, 2, or 3`)
  }
  return value
}

const supportedMode = (value: number): MrcMode => {
  if (value === 0 || value === 1 || value === 2 || value === 6 || value === 12) return value
  throw unsupportedOperation(`MRC MODE ${value} is unsupported`)
}

const parseLabels = (bytes: Uint8Array, count: number): readonly string[] => {
  if (count < 0 || count > 10) throw invalidInput('MRC NLABL must be from 0 through 10')
  const labels: string[] = []
  for (let label = 0; label < count; label += 1) {
    const raw = bytes.subarray(224 + label * 80, 224 + (label + 1) * 80)
    for (const byte of raw) {
      if (byte !== 0 && (byte < 0x20 || byte > 0x7e)) {
        throw invalidInput('MRC label contains non-ASCII data')
      }
    }
    labels.push(ascii(raw, 0, raw.byteLength).replaceAll('\0', ' ').trimEnd())
  }
  return Object.freeze(labels)
}

const parseHeader = (
  bytes: Uint8Array,
): { readonly header: MrcHeader; readonly byteOrder: MrcByteOrder } => {
  if (ascii(bytes, 208, 4) !== 'MAP ') throw invalidInput('MRC MAP signature is missing')
  const byteOrder = byteOrderFromStamp(bytes)
  const littleEndian = byteOrder === 'little-endian'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const integer = (offset: number): number => view.getInt32(offset, littleEndian)
  const real = (offset: number): number => view.getFloat32(offset, littleEndian)
  const NX = integer(0)
  const NY = integer(4)
  const NZ = integer(8)
  if (NX < 1 || NY < 1 || NZ < 1) throw invalidInput('MRC dimensions must be positive')
  const MAPC = axis(integer(64), 'MAPC')
  const MAPR = axis(integer(68), 'MAPR')
  const MAPS = axis(integer(72), 'MAPS')
  if (new Set([MAPC, MAPR, MAPS]).size !== 3) {
    throw invalidInput('MRC MAPC, MAPR, and MAPS must be a permutation of 1, 2, and 3')
  }
  const NSYMBT = integer(92)
  if (NSYMBT < 0) throw invalidInput('MRC NSYMBT must be non-negative')
  const machineStamp = Object.freeze([
    bytes[212] ?? 0,
    bytes[213] ?? 0,
    bytes[214] ?? 0,
    bytes[215] ?? 0,
  ] as const)
  const labelCount = integer(220)
  const header: MrcHeader = Object.freeze({
    NX,
    NY,
    NZ,
    MODE: supportedMode(integer(12)),
    NXSTART: integer(16),
    NYSTART: integer(20),
    NZSTART: integer(24),
    MX: integer(28),
    MY: integer(32),
    MZ: integer(36),
    cellDimensions: Object.freeze({ x: real(40), y: real(44), z: real(48) }),
    cellAngles: Object.freeze({ alpha: real(52), beta: real(56), gamma: real(60) }),
    MAPC,
    MAPR,
    MAPS,
    DMIN: real(76),
    DMAX: real(80),
    DMEAN: real(84),
    ISPG: integer(88),
    NSYMBT,
    EXTTYP: ascii(bytes, 104, 4).replaceAll('\0', ' ').trim(),
    NVERSION: integer(108),
    origin: Object.freeze({ x: real(196), y: real(200), z: real(204) }),
    MAP: 'MAP ',
    machineStamp,
    RMS: real(216),
    labels: parseLabels(bytes, labelCount),
  })
  return { header, byteOrder }
}

const modeSampleType = (mode: MrcMode): RasterSampleType => {
  if (mode === 0) return 'int8'
  if (mode === 1) return 'int16'
  if (mode === 2) return 'float32'
  if (mode === 6) return 'uint16'
  return 'float16'
}

const physicalSize = (cell: number, samples: number): PhysicalPixelSize | undefined =>
  Number.isFinite(cell) && cell > 0 && Number.isSafeInteger(samples) && samples > 0
    ? Object.freeze({ value: cell / samples, unit: 'Å' })
    : undefined

const origin = (value: number): PhysicalPixelSize | undefined =>
  Number.isFinite(value) ? Object.freeze({ value, unit: 'Å' }) : undefined

const validateRequest = (
  request: Readonly<RasterPlaneRequest>,
  width: number,
  height: number,
  depth: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } => {
  if (!Number.isSafeInteger(request.z) || request.z < 0 || request.z >= depth || request.t !== 0) {
    throw invalidInput('MRC Z/T plane coordinate is outside the volume')
  }
  if (request.resolutionLevel !== undefined && request.resolutionLevel !== 0) {
    throw invalidInput('MRC resolutionLevel must be 0')
  }
  const channels =
    request.c === undefined ? [0] : typeof request.c === 'number' ? [request.c] : request.c
  if (channels.length !== 1 || channels[0] !== 0) {
    throw invalidInput('MRC channel selection must be 0')
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
    throw invalidInput('MRC raster region is outside the volume')
  }
  return { x, y, width: selectedWidth, height: selectedHeight }
}

class MrcRasterDataset implements MrcDataset {
  readonly format = 'mrc' as const
  readonly header: MrcHeader
  readonly mode: MrcMode
  readonly byteOrder: MrcByteOrder
  readonly sizeX: number
  readonly sizeY: number
  readonly sizeZ: number
  readonly sizeC = 1
  readonly sizeT = 1
  readonly sampleType: RasterSampleType
  readonly dimensionOrder = 'XYZCT'
  readonly channels: readonly RasterChannelInfo[] = Object.freeze([{ samplesPerPixel: 1 }])
  readonly physicalSizeX?: PhysicalPixelSize
  readonly physicalSizeY?: PhysicalPixelSize
  readonly physicalSizeZ?: PhysicalPixelSize
  readonly originX?: PhysicalPixelSize
  readonly originY?: PhysicalPixelSize
  readonly originZ?: PhysicalPixelSize
  readonly metadata: Readonly<Record<string, string>>
  readonly #source: CountingSource
  readonly #dataOffset: number
  readonly #limits: Readonly<ImageLimits>
  readonly #rowsPerBlock: number

  constructor(
    source: CountingSource,
    parsed: { readonly header: MrcHeader; readonly byteOrder: MrcByteOrder },
    dataOffset: number,
    limits: Readonly<ImageLimits>,
    rowsPerBlock: number,
  ) {
    this.#source = source
    this.header = parsed.header
    this.mode = parsed.header.MODE
    this.byteOrder = parsed.byteOrder
    this.#dataOffset = dataOffset
    this.#limits = limits
    this.#rowsPerBlock = rowsPerBlock
    this.sampleType = modeSampleType(this.mode)
    const storedSizes = [parsed.header.NX, parsed.header.NY, parsed.header.NZ] as const
    const logicalSizes = [0, 0, 0]
    logicalSizes[parsed.header.MAPC - 1] = storedSizes[0]
    logicalSizes[parsed.header.MAPR - 1] = storedSizes[1]
    logicalSizes[parsed.header.MAPS - 1] = storedSizes[2]
    this.sizeX = logicalSizes[0] ?? 0
    this.sizeY = logicalSizes[1] ?? 0
    this.sizeZ = logicalSizes[2] ?? 0
    const physicalSizeX = physicalSize(parsed.header.cellDimensions.x, parsed.header.MX)
    const physicalSizeY = physicalSize(parsed.header.cellDimensions.y, parsed.header.MY)
    const physicalSizeZ = physicalSize(parsed.header.cellDimensions.z, parsed.header.MZ)
    const originX = origin(parsed.header.origin.x)
    const originY = origin(parsed.header.origin.y)
    const originZ = origin(parsed.header.origin.z)
    if (physicalSizeX !== undefined) this.physicalSizeX = physicalSizeX
    if (physicalSizeY !== undefined) this.physicalSizeY = physicalSizeY
    if (physicalSizeZ !== undefined) this.physicalSizeZ = physicalSizeZ
    if (originX !== undefined) this.originX = originX
    if (originY !== undefined) this.originY = originY
    if (originZ !== undefined) this.originZ = originZ
    this.metadata = Object.freeze({
      MODE: String(parsed.header.MODE),
      MAPC: String(parsed.header.MAPC),
      MAPR: String(parsed.header.MAPR),
      MAPS: String(parsed.header.MAPS),
      ISPG: String(parsed.header.ISPG),
      NVERSION: String(parsed.header.NVERSION),
      ...(parsed.header.EXTTYP.length === 0 ? {} : { EXTTYP: parsed.header.EXTTYP }),
    })
  }

  get sourceBytesRead(): number {
    return this.#source.bytesRead
  }

  get sourceReadCalls(): number {
    return this.#source.readCalls
  }

  #storedOffset(x: number, y: number, z: number, bytesPerSample: number): number {
    const coordinate = (selectedAxis: 1 | 2 | 3): number =>
      selectedAxis === 1 ? x : selectedAxis === 2 ? y : z
    const column = coordinate(this.header.MAPC)
    const row = coordinate(this.header.MAPR)
    const section = coordinate(this.header.MAPS)
    const index =
      (BigInt(section) * BigInt(this.header.NY) + BigInt(row)) * BigInt(this.header.NX) +
      BigInt(column)
    return safeNumber(BigInt(this.#dataOffset) + index * BigInt(bytesPerSample), 'sample offset')
  }

  #copyCanonical(
    input: Uint8Array,
    inputOffset: number,
    output: Uint8Array,
    outputOffset: number,
    bytesPerSample: number,
  ): void {
    if (this.byteOrder === 'big-endian' || bytesPerSample === 1) {
      output.set(input.subarray(inputOffset, inputOffset + bytesPerSample), outputOffset)
      return
    }
    for (let byte = 0; byte < bytesPerSample; byte += 1) {
      output[outputOffset + byte] = input[inputOffset + bytesPerSample - byte - 1] ?? 0
    }
  }

  #copyCanonicalSpan(input: Uint8Array, output: Uint8Array, bytesPerSample: number): void {
    if (this.byteOrder === 'big-endian' || bytesPerSample === 1) {
      output.set(input)
      return
    }
    const end = input.byteLength
    const inputOffset = input.byteOffset
    const destOffset = output.byteOffset
    if (
      bytesPerSample === 2 &&
      (end & 1) === 0 &&
      (inputOffset & 1) === 0 &&
      (destOffset & 1) === 0
    ) {
      if ((end & 3) === 0 && (inputOffset & 3) === 0 && (destOffset & 3) === 0) {
        const sourceView = new Uint32Array(input.buffer, inputOffset, end >> 2)
        const destView = new Uint32Array(output.buffer, destOffset, end >> 2)
        for (let index = 0; index < sourceView.length; index += 1) {
          const value = sourceView[index] ?? 0
          destView[index] = ((value & 0x00ff_00ff) << 8) | ((value >>> 8) & 0x00ff_00ff)
        }
        return
      }
      const sourceView = new Uint16Array(input.buffer, inputOffset, end >> 1)
      const destView = new Uint16Array(output.buffer, destOffset, end >> 1)
      for (let index = 0; index < sourceView.length; index += 1) {
        const value = sourceView[index] ?? 0
        destView[index] = ((value & 0xff) << 8) | (value >>> 8)
      }
      return
    }
    if (bytesPerSample === 4) {
      for (let offset = 0; offset < end; offset += 4) {
        output[offset] = input[offset + 3] ?? 0
        output[offset + 1] = input[offset + 2] ?? 0
        output[offset + 2] = input[offset + 1] ?? 0
        output[offset + 3] = input[offset] ?? 0
      }
      return
    }
    for (let offset = 0; offset < end; offset += bytesPerSample) {
      this.#copyCanonical(input, offset, output, offset, bytesPerSample)
    }
  }

  async *readPlane(request: Readonly<RasterPlaneRequest>): AsyncGenerator<RasterBlock> {
    const region = validateRequest(request, this.sizeX, this.sizeY, this.sizeZ)
    const bytesPerSample = rasterSampleBytes(this.sampleType)
    const rowBytes = region.width * bytesPerSample
    if (rowBytes > this.#limits.maxDecodedBytes) {
      throw limitExceeded('MRC selected raster row exceeds maxDecodedBytes')
    }
    const rowsPerBlock = Math.min(
      this.#rowsPerBlock,
      Math.max(1, Math.floor(this.#limits.maxDecodedBytes / rowBytes)),
    )
    const packedRows =
      this.header.MAPC === 1 &&
      this.header.MAPR === 2 &&
      region.x === 0 &&
      region.width === this.sizeX
    const readOptions = request.signal === undefined ? {} : { signal: request.signal }
    const format = Object.freeze({
      sampleType: this.sampleType,
      channels: 1,
      planar: false,
    })
    for (let localY = 0; localY < region.height; localY += rowsPerBlock) {
      const blockHeight = Math.min(rowsPerBlock, region.height - localY)
      const output = new Uint8Array(rowBytes * blockHeight)
      if (packedRows) {
        const inputOffset = this.#storedOffset(
          region.x,
          region.y + localY,
          request.z,
          bytesPerSample,
        )
        const input = await readExactly(
          this.#source,
          inputOffset,
          rowBytes * blockHeight,
          readOptions,
        )
        this.#copyCanonicalSpan(input, output, bytesPerSample)
      } else {
        for (let row = 0; row < blockHeight; row += 1) {
          const logicalY = region.y + localY + row
          const targetRow = row * rowBytes
          if (this.header.MAPC === 1) {
            const inputOffset = this.#storedOffset(region.x, logicalY, request.z, bytesPerSample)
            const input = await readExactly(this.#source, inputOffset, rowBytes, readOptions)
            this.#copyCanonicalSpan(
              input,
              output.subarray(targetRow, targetRow + rowBytes),
              bytesPerSample,
            )
          } else {
            for (let x = 0; x < region.width; x += 1) {
              const inputOffset = this.#storedOffset(
                region.x + x,
                logicalY,
                request.z,
                bytesPerSample,
              )
              const input = await readExactly(
                this.#source,
                inputOffset,
                bytesPerSample,
                readOptions,
              )
              this.#copyCanonical(input, 0, output, targetRow + x * bytesPerSample, bytesPerSample)
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
        format,
        data: output,
      }
    }
  }
}

/**
 * Opens an MRC2014 or compatible CCP4 scalar image or volume. The 1024-byte
 * header is read eagerly. Extended-header contents and voxel data remain lazy.
 * Plane and ROI reads use calculated source offsets and never materialize the
 * complete volume. Non-default MAPC/MAPR/MAPS layouts may require strided
 * sample reads.
 */
export const openMrc = async (
  input: ImageInput,
  options: Readonly<MrcOpenOptions> = {},
): Promise<MrcDataset> => {
  const limits = resolveLimits(options)
  const rowsPerBlock = positiveIntegerOption('rowsPerBlock', options.rowsPerBlock ?? 16)
  const source = new CountingSource(await createImageSource(input, limits))
  if (source.size < headerBytes) throw truncatedInput('MRC header is truncated')
  const parsed = parseHeader(await readExactly(source, 0, headerBytes))
  const bytesPerSample = rasterSampleBytes(modeSampleType(parsed.header.MODE))
  const dataOffset = safeNumber(BigInt(headerBytes) + BigInt(parsed.header.NSYMBT), 'data offset')
  if (dataOffset > source.size) throw truncatedInput('MRC extended header exceeds the input')
  const sampleCount = BigInt(parsed.header.NX) * BigInt(parsed.header.NY) * BigInt(parsed.header.NZ)
  const dataEnd = BigInt(dataOffset) + sampleCount * BigInt(bytesPerSample)
  if (dataEnd > BigInt(source.size)) throw truncatedInput('MRC voxel data is truncated')
  const logicalSizes = [0, 0, 0]
  logicalSizes[parsed.header.MAPC - 1] = parsed.header.NX
  logicalSizes[parsed.header.MAPR - 1] = parsed.header.NY
  logicalSizes[parsed.header.MAPS - 1] = parsed.header.NZ
  validateImageDimensions(logicalSizes[0] ?? 0, logicalSizes[1] ?? 0, logicalSizes[2] ?? 0, limits)
  return new MrcRasterDataset(source, parsed, dataOffset, limits, rowsPerBlock)
}
