import { invalidInput } from '../errors.ts'
import { type RasterBlock, type RasterSampleType, rasterSampleBytes } from '../raster.ts'

const halfFloat = (bits: number): number => {
  const sign = (bits & 0x8000) === 0 ? 1 : -1
  const exponent = (bits >>> 10) & 0x1f
  const fraction = bits & 0x03ff
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024)
  if (exponent === 0x1f) return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024)
}

const floatToHalf = (value: number): number => {
  const float = new Float32Array(1)
  const bits = new Uint32Array(float.buffer)
  float[0] = value
  const word = bits[0] ?? 0
  const sign = (word >>> 16) & 0x8000
  const exponent = (word >>> 23) & 0xff
  const fraction = word & 0x7fffff
  if (exponent === 0xff) return sign | (fraction === 0 ? 0x7c00 : 0x7e00)
  const halfExponent = exponent - 127 + 15
  if (halfExponent >= 0x1f) return sign | 0x7c00
  if (halfExponent <= 0) {
    if (halfExponent < -10) return sign
    const significand = fraction | 0x800000
    const shift = 14 - halfExponent
    const rounded = (significand + (1 << (shift - 1)) - 1 + ((significand >>> shift) & 1)) >>> shift
    return sign | rounded
  }
  const rounded = fraction + 0x0fff + ((fraction >>> 13) & 1)
  if ((rounded & 0x800000) !== 0) {
    const nextExponent = halfExponent + 1
    return nextExponent >= 0x1f ? sign | 0x7c00 : sign | (nextExponent << 10)
  }
  return sign | (halfExponent << 10) | (rounded >>> 13)
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
    const value = view.getBigUint64(offset, false)
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidInput('Scientific uint64 sample exceeds exact numeric conversion')
    }
    return Number(value)
  }
  if (sampleType === 'int8') return view.getInt8(offset)
  if (sampleType === 'int16') return view.getInt16(offset, false)
  if (sampleType === 'int32') return view.getInt32(offset, false)
  if (sampleType === 'int64') {
    const value = view.getBigInt64(offset, false)
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw invalidInput('Scientific int64 sample exceeds exact numeric conversion')
    }
    return Number(value)
  }
  if (sampleType === 'float16') return halfFloat(view.getUint16(offset, false))
  if (sampleType === 'float32') return view.getFloat32(offset, false)
  if (sampleType === 'float64') return view.getFloat64(offset, false)
  return data[offset] ?? 0
}

/** Reads one exact 64-bit integer sample from canonical big-endian raster bytes. */
export const readRasterBigIntSample = (
  view: DataView,
  offset: number,
  sampleType: 'uint64' | 'int64',
): bigint =>
  sampleType === 'uint64' ? view.getBigUint64(offset, false) : view.getBigInt64(offset, false)

/** Writes one exact 64-bit integer sample using canonical big-endian raster bytes. */
export const writeRasterBigIntSample = (
  view: DataView,
  offset: number,
  sampleType: 'uint64' | 'int64',
  value: bigint,
): void => {
  if (sampleType === 'uint64') {
    if (value < 0n || value > (1n << 64n) - 1n) {
      throw invalidInput(`Scientific uint64 sample ${value} is outside uint64`)
    }
    view.setBigUint64(offset, value, false)
    return
  }
  if (value < -(1n << 63n) || value > (1n << 63n) - 1n) {
    throw invalidInput(`Scientific int64 sample ${value} is outside int64`)
  }
  view.setBigInt64(offset, value, false)
}

/** Writes one numeric sample using the raster model's canonical big-endian byte order. */
export const writeRasterSample = (
  view: DataView,
  offset: number,
  sampleType: RasterSampleType,
  value: number,
): void => {
  if (sampleType === 'uint8') view.setUint8(offset, value)
  else if (sampleType === 'uint16') view.setUint16(offset, value, false)
  else if (sampleType === 'uint32') view.setUint32(offset, value, false)
  else if (sampleType === 'uint64' || sampleType === 'int64') {
    if (!Number.isSafeInteger(value)) {
      throw invalidInput(`Scientific ${sampleType} sample requires an exact safe integer`)
    }
    writeRasterBigIntSample(view, offset, sampleType, BigInt(value))
  } else if (sampleType === 'int8') view.setInt8(offset, value)
  else if (sampleType === 'int16') view.setInt16(offset, value, false)
  else if (sampleType === 'int32') view.setInt32(offset, value, false)
  else if (sampleType === 'float16') view.setUint16(offset, floatToHalf(value), false)
  else if (sampleType === 'float32') view.setFloat32(offset, value, false)
  else view.setFloat64(offset, value, false)
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
