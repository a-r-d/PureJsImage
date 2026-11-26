import type { ImageCodec, ImageMetadata } from '../codec.ts'
import { invalidInput, truncatedInput } from '../errors.ts'
import { type ImageLimits, validateImageDimensions } from '../limits.ts'
import { type ImageSource, SourceReader, readExactly } from '../source.ts'
import { ascii, uint16LittleEndian } from './helpers.ts'

export const isGif = (header: Uint8Array): boolean => {
  const version = header.byteLength >= 6 ? ascii(header, 0, 6) : ''
  return version === 'GIF87a' || version === 'GIF89a'
}

export const colorTableBytes = (packed: number): number => 3 * 2 ** ((packed & 0x07) + 1)

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
  encoderPixelFormats: ['gray8', 'rgb8', 'rgba8'],
  selection: { frames: true, resolutionLevels: false },
  async metadata(source: ImageSource, limits: ImageLimits): Promise<ImageMetadata> {
    const header = await readExactly(source, 0, 13)
    if (!isGif(header)) throw invalidInput('GIF header is invalid')

    const width = uint16LittleEndian(header, 6)
    const height = uint16LittleEndian(header, 8)
    const packed = header[10]
    if (packed === undefined) throw invalidInput('GIF logical screen descriptor is truncated')
    validateImageDimensions(width, height, 1, limits)

    const reader = new SourceReader(source, 13)
    const hasGlobalPalette = (packed & 0x80) !== 0
    if (hasGlobalPalette) reader.skip(colorTableBytes(packed))

    let frames = 0
    let hasAlpha = false
    let sawTrailer = false
    for (let blocks = 0; reader.position < source.size && blocks < 1_000_000; blocks += 1) {
      const marker = await reader.readByte()
      if (marker === 0x3b) {
        sawTrailer = true
        break
      }

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
        const left = uint16LittleEndian(descriptor, 0)
        const top = uint16LittleEndian(descriptor, 2)
        const frameWidth = uint16LittleEndian(descriptor, 4)
        const frameHeight = uint16LittleEndian(descriptor, 6)
        const imagePacked = descriptor[8]
        if (imagePacked === undefined) throw invalidInput('GIF image descriptor is truncated')
        if (
          frameWidth < 1 ||
          frameHeight < 1 ||
          left + frameWidth > width ||
          top + frameHeight > height
        ) {
          throw invalidInput(
            `GIF frame ${left},${top} ${frameWidth}x${frameHeight} exceeds ${width}x${height}`,
          )
        }
        const hasLocalPalette = (imagePacked & 0x80) !== 0
        if (hasLocalPalette) reader.skip(colorTableBytes(imagePacked))
        if (!hasGlobalPalette && !hasLocalPalette) {
          throw invalidInput('GIF frame has no color table')
        }
        const minimumCodeSize = await reader.readByte()
        if (minimumCodeSize < 2 || minimumCodeSize > 8) {
          throw invalidInput(`GIF LZW minimum code size ${minimumCodeSize} is invalid`)
        }
        await skipSubBlocks(reader)
        frames += 1
        if (frames > limits.maxFrames) validateImageDimensions(width, height, frames, limits)
        continue
      }

      throw invalidInput(`GIF contains an unknown block marker: 0x${marker.toString(16)}`)
    }

    if (!sawTrailer) throw truncatedInput('GIF trailer is missing')
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
  async createDecoder(source, limits, options) {
    const { decodeGif } = await import('./gif-pixels.ts')
    return decodeGif(source, limits, options)
  },
  async createEncoder(sink, request) {
    const { createGifEncoder } = await import('./gif-encode.ts')
    return createGifEncoder(sink, request)
  },
  async createAnimationDecoder(source, limits) {
    const { decodeGifAnimation } = await import('./gif-pixels.ts')
    return decodeGifAnimation(source, limits)
  },
  async createAnimationEncoder(sink, request) {
    const { createGifAnimationEncoder } = await import('./gif-encode.ts')
    return createGifAnimationEncoder(sink, request)
  },
}
