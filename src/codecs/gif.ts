import type { ImageCodec, ImageMetadata } from '../codec.ts'
import { invalidInput } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import { validateImageDimensions } from '../limits.ts'
import type { ImageSource } from '../source.ts'
import { SourceReader, readExactly } from '../source.ts'
import { ascii, uint16LittleEndian } from './helpers.ts'

const isGif = (header: Uint8Array): boolean => {
  const version = header.byteLength >= 6 ? ascii(header, 0, 6) : ''
  return version === 'GIF87a' || version === 'GIF89a'
}

const colorTableBytes = (packed: number): number => 3 * 2 ** ((packed & 0x07) + 1)

const skipSubBlocks = async (reader: SourceReader): Promise<void> => {
  for (let blocks = 0; blocks < 1_000_000; blocks += 1) {
    const length = await reader.readByte()
    if (length === 0) return
    reader.skip(length)
  }
  throw invalidInput('GIF contains too many data sub-blocks')
}

export const gifCodec: ImageCodec = {
  format: 'gif',
  mimeTypes: ['image/gif'],
  minimumBytes: 6,
  detect: isGif,
  async metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> {
    const header = await readExactly(source, 0, 13)
    if (!isGif(header)) throw invalidInput('GIF header is invalid')

    const width = uint16LittleEndian(header, 6)
    const height = uint16LittleEndian(header, 8)
    const packed = header[10]
    if (packed === undefined) throw invalidInput('GIF logical screen descriptor is truncated')

    const reader = new SourceReader(source, 13)
    if ((packed & 0x80) !== 0) reader.skip(colorTableBytes(packed))

    let frames = 0
    let hasAlpha = false
    for (let blocks = 0; reader.position < source.size && blocks < 1_000_000; blocks += 1) {
      const marker = await reader.readByte()
      if (marker === 0x3b) break

      if (marker === 0x21) {
        const label = await reader.readByte()
        if (label === 0xf9) {
          const length = await reader.readByte()
          if (length !== 4) throw invalidInput('GIF graphics control extension is invalid')
          const control = await reader.read(4)
          hasAlpha ||= ((control[0] ?? 0) & 0x01) !== 0
          if ((await reader.readByte()) !== 0)
            throw invalidInput('GIF extension terminator is missing')
        } else {
          await skipSubBlocks(reader)
        }
        continue
      }

      if (marker === 0x2c) {
        const descriptor = await reader.read(9)
        const imagePacked = descriptor[8]
        if (imagePacked === undefined) throw invalidInput('GIF image descriptor is truncated')
        if ((imagePacked & 0x80) !== 0) reader.skip(colorTableBytes(imagePacked))
        await reader.readByte()
        await skipSubBlocks(reader)
        frames += 1
        if (frames > limits.maxFrames) validateImageDimensions(width, height, frames, limits)
        continue
      }

      throw invalidInput(`GIF contains an unknown block marker: 0x${marker.toString(16)}`)
    }

    if (frames < 1) throw invalidInput('GIF contains no image frames')
    validateImageDimensions(width, height, frames, limits)
    return {
      width,
      height,
      format: 'gif',
      mimeType: 'image/gif',
      hasAlpha,
      colorSpace: 'indexed',
      bitDepth: (packed & 0x07) + 1,
      frames,
    }
  },
}
