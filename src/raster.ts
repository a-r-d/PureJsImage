import { invalidInput } from './errors.ts'
import type { PixelBlock } from './pixel.ts'

export type RasterSampleType =
  | 'uint8'
  | 'uint16'
  | 'uint32'
  | 'uint64'
  | 'int8'
  | 'int16'
  | 'int32'
  | 'float16'
  | 'float32'
  | 'float64'

export interface RasterFormat {
  readonly sampleType: RasterSampleType
  readonly channels: number
  readonly planar: boolean
}

/**
 * Raster samples use canonical big-endian byte order. For planar blocks, each
 * channel plane starts `planeStride` bytes after the previous plane.
 */
export interface RasterBlock {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly stride: number
  readonly planeStride?: number
  readonly format: RasterFormat
  readonly data: Uint8Array
  readonly release?: () => void
}

export interface RasterDecoder {
  readonly width: number
  readonly height: number
  readonly format: RasterFormat
  decode(request?: RasterDecodeRequest): AsyncIterable<RasterBlock>
}

export interface RasterDecodeRequest {
  readonly x?: number
  readonly y?: number
  readonly width?: number
  readonly height?: number
}

export interface RasterDisplayRange {
  readonly black: number
  readonly white: number
}

export interface RasterDisplayOptions {
  readonly channels: readonly [number] | readonly [number, number, number]
  readonly ranges: readonly RasterDisplayRange[]
}

export const rasterSampleBytes = (sampleType: RasterSampleType): 1 | 2 | 4 | 8 => {
  if (sampleType === 'uint8' || sampleType === 'int8') return 1
  if (sampleType === 'uint16' || sampleType === 'int16' || sampleType === 'float16') return 2
  if (sampleType === 'uint32' || sampleType === 'int32' || sampleType === 'float32') {
    return 4
  }
  return 8
}

const halfFloat = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

const readSample = (
  data: Uint8Array,
  view: DataView,
  offset: number,
  sampleType: RasterSampleType,
): number => {
  if (sampleType === 'uint8') return view.getUint8(offset)
  if (sampleType === 'uint16') return view.getUint16(offset, false)
  if (sampleType === 'uint32') return view.getUint32(offset, false)
  if (sampleType === 'uint64') {
    return view.getUint32(offset, false) * 4_294_967_296 + view.getUint32(offset + 4, false)
  }
  if (sampleType === 'int8') return view.getInt8(offset)
  if (sampleType === 'int16') return view.getInt16(offset, false)
  if (sampleType === 'int32') return view.getInt32(offset, false)
  if (sampleType === 'float16') return halfFloat(view.getUint16(offset, false))
  if (sampleType === 'float32') return view.getFloat32(offset, false)
  if (sampleType === 'float64') return view.getFloat64(offset, false)
  return data[offset] ?? 0
}

const displayByte = (value: number, range: RasterDisplayRange): number => {
  if (Number.isNaN(value)) return 0
  const scaled = (value - range.black) / (range.white - range.black)
  if (scaled <= 0) return 0
  if (scaled >= 1) return 255
  return Math.round(scaled * 255)
}

const validateBlock = (block: RasterBlock, bytesPerSample: number): number => {
  const { channels, planar } = block.format
  if (
    !Number.isSafeInteger(channels) ||
    channels < 1 ||
    !Number.isSafeInteger(block.width) ||
    block.width < 1 ||
    !Number.isSafeInteger(block.height) ||
    block.height < 1 ||
    !Number.isSafeInteger(block.stride)
  ) {
    throw invalidInput('Raster conversion received invalid block dimensions')
  }
  const rowBytes = block.width * bytesPerSample * (planar ? 1 : channels)
  if (!Number.isSafeInteger(rowBytes) || block.stride < rowBytes) {
    throw invalidInput('Raster conversion received an invalid row stride')
  }
  const occupiedPlaneBytes = block.stride * (block.height - 1) + rowBytes
  const planeStride = planar ? block.planeStride : occupiedPlaneBytes
  if (
    !Number.isSafeInteger(occupiedPlaneBytes) ||
    planeStride === undefined ||
    !Number.isSafeInteger(planeStride) ||
    planeStride < occupiedPlaneBytes
  ) {
    throw invalidInput('Raster conversion received an invalid plane stride')
  }
  const requiredBytes = planar
    ? planeStride * (channels - 1) + occupiedPlaneBytes
    : occupiedPlaneBytes
  if (!Number.isSafeInteger(requiredBytes) || block.data.byteLength < requiredBytes) {
    throw invalidInput('Raster conversion received truncated sample data')
  }
  return planeStride
}

export const rasterToPixels = async function* (
  blocks: AsyncIterable<RasterBlock>,
  options: Readonly<RasterDisplayOptions>,
): AsyncGenerator<PixelBlock> {
  if (options.ranges.length !== options.channels.length) {
    throw invalidInput('Raster display ranges must match the selected channels')
  }
  if (
    options.channels.some((channel) => !Number.isSafeInteger(channel) || channel < 0) ||
    options.ranges.some(
      (range) =>
        !Number.isFinite(range.black) ||
        !Number.isFinite(range.white) ||
        range.black === range.white,
    )
  ) {
    throw invalidInput('Raster display selection is invalid')
  }
  for await (const block of blocks) {
    try {
      const bytesPerSample = rasterSampleBytes(block.format.sampleType)
      const planeStride = validateBlock(block, bytesPerSample)
      if (options.channels.some((channel) => channel >= block.format.channels)) {
        throw invalidInput('Raster display channel is outside the block format')
      }
      const outputChannels = options.channels.length
      const outputStride = block.width * outputChannels
      const output = new Uint8Array(outputStride * block.height)
      const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
      for (let row = 0; row < block.height; row += 1) {
        for (let x = 0; x < block.width; x += 1) {
          for (let selected = 0; selected < outputChannels; selected += 1) {
            const channel = options.channels[selected]
            const range = options.ranges[selected]
            if (channel === undefined || range === undefined) {
              throw invalidInput('Raster display selection is incomplete')
            }
            const source = block.format.planar
              ? channel * planeStride + row * block.stride + x * bytesPerSample
              : row * block.stride + (x * block.format.channels + channel) * bytesPerSample
            output[row * outputStride + x * outputChannels + selected] = displayByte(
              readSample(block.data, view, source, block.format.sampleType),
              range,
            )
          }
        }
      }
      yield {
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        stride: outputStride,
        format: outputChannels === 1 ? 'gray8' : 'rgb8',
        data: output,
      }
    } finally {
      block.release?.()
    }
  }
}
