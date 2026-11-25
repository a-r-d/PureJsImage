import type { ImageCodec, ImageMetadata } from '../codec.ts'
import { invalidInput, truncatedInput } from '../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import { type ImageSource, readExactly } from '../source.ts'

const isQoi = (header: Uint8Array): boolean =>
  header[0] === 0x71 && header[1] === 0x6f && header[2] === 0x69 && header[3] === 0x66
export const headerBytes = 14

export const endMarker = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 1])

export interface QoiDescription {
  readonly width: number
  readonly height: number
  readonly channels: 3 | 4
  readonly colorspace: 0 | 1
}

const uint32 = (data: Uint8Array, offset: number): number =>
  ((data[offset] ?? 0) * 16_777_216 +
    (data[offset + 1] ?? 0) * 65_536 +
    (data[offset + 2] ?? 0) * 256 +
    (data[offset + 3] ?? 0)) >>>
  0

export const describeQoi = async (
  source: ImageSource,
  limits: ImageLimits,
): Promise<QoiDescription> => {
  if (source.size < headerBytes + endMarker.byteLength)
    throw truncatedInput('QOI header is truncated')
  const header = await readExactly(source, 0, headerBytes)
  if (!isQoi(header)) throw invalidInput('QOI signature is invalid')
  const width = uint32(header, 4)
  const height = uint32(header, 8)
  const channels = header[12]
  const colorspace = header[13]
  if (channels !== 3 && channels !== 4) throw invalidInput('QOI channels field must be 3 or 4')
  if (colorspace !== 0 && colorspace !== 1)
    throw invalidInput('QOI colorspace field must be 0 or 1')
  validateImageDimensions(width, height, 1, limits, channels)
  return { width, height, channels, colorspace }
}

const metadata = (description: QoiDescription): ImageMetadata => ({
  width: description.width,
  height: description.height,
  format: 'qoi',
  mimeType: 'image/qoi',
  hasAlpha: description.channels === 4,
  bitDepth: 8,
  components: description.channels,
  channels: description.channels,
  frames: 1,
  colorSpace: description.colorspace === 0 ? 'srgb-linear-alpha' : 'linear',
  codecProfile: description.colorspace,
  lossless: true,
})

export const qoiCodec: ImageCodec = {
  format: 'qoi',
  mimeTypes: ['image/qoi'],
  minimumBytes: 4,
  encoderPixelFormats: ['gray8', 'rgb8', 'rgba8'],
  detect: isQoi,
  metadata: async (source, limits) => metadata(await describeQoi(source, limits)),
  async createDecoder(source, limits) {
    const { createQoiDecoder } = await import('./qoi-pixels.ts')
    return createQoiDecoder(source, limits)
  },
  async createEncoder(sink, request) {
    const { createQoiEncoder } = await import('./qoi-pixels.ts')
    return createQoiEncoder(sink, request)
  },
}
