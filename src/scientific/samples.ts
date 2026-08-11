import { invalidInput } from '../errors.ts'
import { rasterSampleBytes, type RasterBlock, type RasterSampleType } from '../raster.ts'

const halfFloat = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

export const readRasterSample = (
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

export interface ValidatedRasterBlockLayout {
  readonly bytesPerSample: 1 | 2 | 4 | 8
  readonly planeStride: number
}

export const validateRasterBlock = (block: RasterBlock): ValidatedRasterBlockLayout => {
  const bytesPerSample = rasterSampleBytes(block.format.sampleType)
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
    throw invalidInput('Scientific raster block has invalid dimensions')
  }
  const rowBytes = block.width * bytesPerSample * (planar ? 1 : channels)
  if (!Number.isSafeInteger(rowBytes) || block.stride < rowBytes) {
    throw invalidInput('Scientific raster block has an invalid row stride')
  }
  const occupiedPlaneBytes = block.stride * (block.height - 1) + rowBytes
  const planeStride = planar ? block.planeStride : occupiedPlaneBytes
  if (
    !Number.isSafeInteger(occupiedPlaneBytes) ||
    planeStride === undefined ||
    !Number.isSafeInteger(planeStride) ||
    planeStride < occupiedPlaneBytes
  ) {
    throw invalidInput('Scientific raster block has an invalid plane stride')
  }
  const requiredBytes = planar
    ? planeStride * (channels - 1) + occupiedPlaneBytes
    : occupiedPlaneBytes
  if (!Number.isSafeInteger(requiredBytes) || block.data.byteLength < requiredBytes) {
    throw invalidInput('Scientific raster block contains truncated sample data')
  }
  return { bytesPerSample, planeStride }
}

export const rasterSampleOffset = (
  block: RasterBlock,
  layout: ValidatedRasterBlockLayout,
  x: number,
  y: number,
  channel: number,
): number =>
  block.format.planar
    ? channel * layout.planeStride + y * block.stride + x * layout.bytesPerSample
    : y * block.stride + (x * block.format.channels + channel) * layout.bytesPerSample
