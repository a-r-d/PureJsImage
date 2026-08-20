import { unsupportedOperation } from '../../../src/errors.ts'
import type { RasterSampleType } from '../../../src/raster.ts'

export interface OmeZarrDisplayRange {
  readonly minimum: number
  readonly maximum: number
}

export const omeZarrDisplayRange = (
  sampleType: RasterSampleType,
): OmeZarrDisplayRange | undefined => {
  if (sampleType === 'uint8') return { minimum: 0, maximum: 255 }
  if (sampleType === 'uint16') return { minimum: 0, maximum: 65_535 }
  if (sampleType === 'uint32') return { minimum: 0, maximum: 4_294_967_295 }
  if (sampleType === 'int8') return { minimum: -128, maximum: 127 }
  if (sampleType === 'int16') return { minimum: -32_768, maximum: 32_767 }
  if (sampleType === 'int32') return { minimum: -2_147_483_648, maximum: 2_147_483_647 }
  if (sampleType === 'float16' || sampleType === 'float32' || sampleType === 'float64') {
    return undefined
  }
  throw unsupportedOperation(
    'OME-Zarr WSI display does not support uint64 because browser numeric conversion is not exact',
  )
}

export const omeZarrChannelColor = (
  channelCount: number,
  channel: number,
  explicit: number | undefined,
): readonly [number, number, number] => {
  if (channelCount === 1) return [255, 255, 255]
  if (explicit !== undefined) {
    return [(explicit >>> 16) & 255, (explicit >>> 8) & 255, explicit & 255]
  }
  if (channel === 0) return [255, 0, 0]
  if (channel === 1) return [0, 255, 0]
  return [0, 0, 255]
}

export const compositeOmeZarrSample = (
  rgba: Uint8ClampedArray,
  pixel: number,
  normalized: number,
  color: readonly [number, number, number],
): void => {
  const offset = pixel * 4
  const bounded = Math.min(1, Math.max(0, normalized))
  rgba[offset] = Math.min(255, (rgba[offset] ?? 0) + bounded * color[0])
  rgba[offset + 1] = Math.min(255, (rgba[offset + 1] ?? 0) + bounded * color[1])
  rgba[offset + 2] = Math.min(255, (rgba[offset + 2] ?? 0) + bounded * color[2])
}

export const normalizeOmeZarrSample = (
  value: number,
  minimum: number,
  maximum: number,
  gamma: number,
): number => {
  if (!Number.isFinite(value) || maximum <= minimum || gamma <= 0) return 0
  const linear = Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)))
  return linear ** (1 / gamma)
}

export const omeZarrDefaultChannelColor = (channel: number, count: number): number => {
  const [red, green, blue] = omeZarrChannelColor(count, channel, undefined)
  return (red << 16) | (green << 8) | blue
}

export const omeZarrLabelColor = (
  value: number,
  colors: ReadonlyMap<number, readonly [number, number, number, number]>,
): readonly [number, number, number, number] => {
  const explicit = colors.get(value)
  if (explicit !== undefined) return explicit
  let hash = Math.imul(value ^ 0x9e37_79b9, 0x85eb_ca6b)
  hash ^= hash >>> 13
  return [72 + ((hash >>> 16) & 127), 72 + ((hash >>> 8) & 127), 72 + (hash & 127), 210]
}

export const overlayOmeZarrLabel = (
  rgba: Uint8ClampedArray,
  pixel: number,
  color: readonly [number, number, number, number],
  opacity: number,
): void => {
  const alpha = Math.min(1, Math.max(0, opacity)) * (color[3] / 255)
  if (alpha === 0) return
  const offset = pixel * 4
  rgba[offset] = (rgba[offset] ?? 0) * (1 - alpha) + color[0] * alpha
  rgba[offset + 1] = (rgba[offset + 1] ?? 0) * (1 - alpha) + color[1] * alpha
  rgba[offset + 2] = (rgba[offset + 2] ?? 0) * (1 - alpha) + color[2] * alpha
}
