import type { ImageCodec, ImageMetadata } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { ImageSource } from '../source.ts'
import { readExactly } from '../source.ts'
import { ascii, uint32BigEndian } from './helpers.ts'

const signature = [137, 80, 78, 71, 13, 10, 26, 10] as const

const isPng = (header: Uint8Array): boolean =>
  signature.every((byte, index) => header[index] === byte)

const colorSpace = (colorType: number): string => {
  if (colorType === 0 || colorType === 4) return 'gray'
  if (colorType === 3) return 'indexed'
  return 'srgb'
}

export const pngCodec: ImageCodec = {
  format: 'png',
  mimeTypes: ['image/png'],
  minimumBytes: signature.length,
  detect: isPng,
  async metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> {
    const header = await readExactly(source, 0, 33)
    if (!isPng(header) || ascii(header, 12, 4) !== 'IHDR' || uint32BigEndian(header, 8) !== 13) {
      throw invalidInput('PNG is missing a valid IHDR chunk')
    }

    const width = uint32BigEndian(header, 16)
    const height = uint32BigEndian(header, 20)
    const bitDepth = header[24]
    const colorType = header[25]
    if (bitDepth === undefined || colorType === undefined || ![0, 2, 3, 4, 6].includes(colorType)) {
      throw invalidInput('PNG has unsupported or invalid color metadata')
    }

    let frames = 1
    let hasAlpha = colorType === 4 || colorType === 6
    let offset = 33
    let chunks = 0

    while (offset + 12 <= source.size && chunks < 10_000) {
      const chunkHeader = await readExactly(source, offset, 8)
      const length = uint32BigEndian(chunkHeader, 0)
      const type = ascii(chunkHeader, 4, 4)
      const end = offset + 12 + length
      if (!Number.isSafeInteger(end) || end > source.size)
        throw invalidInput(`PNG ${type} chunk is truncated`)

      if (type === 'tRNS') hasAlpha = true
      if (type === 'acTL') {
        if (length < 8) throw invalidInput('PNG acTL chunk is invalid')
        const animation = await readExactly(source, offset + 8, 8)
        frames = uint32BigEndian(animation, 0)
        if (frames < 1) throw invalidInput('PNG animation has no frames')
      }
      if (type === 'IDAT' || type === 'IEND') break

      offset = end
      chunks += 1
    }
    if (chunks >= 10_000) throw invalidInput('PNG contains too many metadata chunks')

    validateImageDimensions(width, height, frames, limits)
    return {
      width,
      height,
      format: 'png',
      mimeType: 'image/png',
      hasAlpha,
      colorSpace: colorSpace(colorType),
      bitDepth,
      frames,
    }
  },
}
