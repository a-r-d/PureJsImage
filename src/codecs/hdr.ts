import type { ImageCodec, ImageMetadata } from '../codec.ts'
import { invalidInput, truncatedInput, unsupportedOperation } from '../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import type { ImageSource } from '../source.ts'

const isHdr = (header: Uint8Array): boolean => {
  if (header.byteLength < 6 || header[0] !== 0x23 || header[1] !== 0x3f) return false
  const signature = String.fromCharCode(...header.subarray(2, Math.min(header.byteLength, 10)))
  return signature.startsWith('RADIANCE') || signature.startsWith('RGBE')
}
const maximumHeaderBytes = 65_536

type Axis = 'X' | 'Y'

type Direction = '+' | '-'

export interface HdrDescription {
  readonly width: number
  readonly height: number
  readonly dataOffset: number
  readonly majorAxis: Axis
  readonly xDirection: Direction
  readonly yDirection: Direction
  readonly exposure: number | undefined
  readonly gamma: number | undefined
  readonly orientation: string
}

const headerEnd = (data: Uint8Array): number => {
  for (let offset = 0; offset + 1 < data.byteLength; offset += 1) {
    if (data[offset] === 0x0a && data[offset + 1] === 0x0a) return offset + 2
    if (
      offset + 3 < data.byteLength &&
      data[offset] === 0x0d &&
      data[offset + 1] === 0x0a &&
      data[offset + 2] === 0x0d &&
      data[offset + 3] === 0x0a
    ) {
      return offset + 4
    }
  }
  return -1
}

const lineEnd = (data: Uint8Array, offset: number): number => {
  for (let index = offset; index < data.byteLength; index += 1) {
    if (data[index] === 0x0a) return index
  }
  return -1
}

const ascii = (data: Uint8Array, start: number, end: number): string => {
  let value = ''
  for (let offset = start; offset < end; offset += 1) {
    const byte = data[offset]
    if (byte === undefined) throw truncatedInput('Radiance HDR text is truncated')
    if (byte !== 0x0d) value += String.fromCharCode(byte)
  }
  return value
}

const finitePositiveMetadata = (label: string, value: string): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw invalidInput(`Radiance HDR ${label} must be finite and greater than zero`)
  }
  return parsed
}

export const describeHdr = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<HdrDescription> => {
  const prefix = await source.read(0, Math.min(source.size, maximumHeaderBytes))
  if (!isHdr(prefix)) throw invalidInput('Radiance HDR signature is invalid')
  const emptyLineEnd = headerEnd(prefix)
  if (emptyLineEnd < 0) {
    if (source.size > maximumHeaderBytes) {
      throw invalidInput(`Radiance HDR header exceeds ${maximumHeaderBytes} bytes`)
    }
    throw truncatedInput('Radiance HDR header terminator is missing')
  }
  const resolutionEnd = lineEnd(prefix, emptyLineEnd)
  if (resolutionEnd < 0) throw truncatedInput('Radiance HDR resolution line is truncated')
  const header = ascii(prefix, 0, emptyLineEnd)
  const lines = header.split(/\r?\n/)
  const signature = lines[0]
  if (signature !== '#?RADIANCE' && signature !== '#?RGBE') {
    throw invalidInput('Radiance HDR signature line is invalid')
  }
  let formatSeen = false
  let exposure: number | undefined
  let gamma: number | undefined
  for (const line of lines.slice(1)) {
    if (line.length === 0) continue
    if (line.startsWith('FORMAT=')) {
      if (formatSeen) throw invalidInput('Radiance HDR contains multiple FORMAT fields')
      if (line !== 'FORMAT=32-bit_rle_rgbe') {
        throw unsupportedOperation(`Radiance HDR format ${line.slice(7)} is unsupported`)
      }
      formatSeen = true
    } else if (line.startsWith('EXPOSURE=')) {
      const value = finitePositiveMetadata('EXPOSURE', line.slice(9))
      exposure = (exposure ?? 1) * value
    } else if (line.startsWith('GAMMA=')) {
      gamma = finitePositiveMetadata('GAMMA', line.slice(6))
    }
  }
  if (!formatSeen) throw invalidInput('Radiance HDR FORMAT field is missing')

  const orientation = ascii(prefix, emptyLineEnd, resolutionEnd).trim()
  const match = /^([+-])([XY])\s+([1-9]\d*)\s+([+-])([XY])\s+([1-9]\d*)$/.exec(orientation)
  if (!match || match[2] === match[5]) {
    throw invalidInput('Radiance HDR resolution or orientation line is invalid')
  }
  const firstSize = Number(match[3])
  const secondSize = Number(match[6])
  if (!Number.isSafeInteger(firstSize) || !Number.isSafeInteger(secondSize)) {
    throw invalidInput('Radiance HDR dimensions exceed safe integer range')
  }
  const firstAxis = match[2] as Axis
  const width = firstAxis === 'X' ? firstSize : secondSize
  const height = firstAxis === 'Y' ? firstSize : secondSize
  validateImageDimensions(width, height, 1, limits, 12)
  return {
    width,
    height,
    dataOffset: resolutionEnd + 1,
    majorAxis: firstAxis,
    xDirection: (firstAxis === 'X' ? match[1] : match[4]) as Direction,
    yDirection: (firstAxis === 'Y' ? match[1] : match[4]) as Direction,
    exposure,
    gamma,
    orientation,
  }
}

const metadata = (description: HdrDescription): ImageMetadata => ({
  width: description.width,
  height: description.height,
  format: 'hdr',
  mimeType: 'image/vnd.radiance',
  hasAlpha: false,
  bitDepth: 32,
  sampleFormat: 'floating-point',
  components: 3,
  channels: 3,
  frames: 1,
  colorSpace: 'linear-rgb',
  lossless: false,
  ...(description.exposure === undefined ? {} : { exposure: description.exposure }),
  ...(description.gamma === undefined ? {} : { gamma: description.gamma }),
  storageOrientation: description.orientation,
})

export const hdrCodec: ImageCodec = {
  format: 'hdr',
  mimeTypes: ['image/vnd.radiance', 'image/x-hdr'],
  minimumBytes: 6,
  encoderPixelFormats: ['rgb8', 'rgba8', 'rgbf32'],
  detect: isHdr,
  metadata: async (source, limits) => metadata(await describeHdr(source, limits)),
  async createDecoder(source, limits) {
    const { createHdrDecoder } = await import('./hdr-pixels.ts')
    return createHdrDecoder(source, limits)
  },
  async createEncoder(sink, request) {
    const { createHdrEncoder } = await import('./hdr-pixels.ts')
    return createHdrEncoder(sink, request)
  },
}
