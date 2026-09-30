import { throwIfAborted } from '../abort.ts'
import type { ImageDecoder } from '../codec.ts'
import { invalidInput, limitExceeded, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import {
  parseGrayIccTransform,
  parseGrayIccTransform16,
  parseRgbIccTransform16,
  writeRgbIcc16,
} from './icc.ts'
import type { JpegXlFrameStructure } from './jpegxl-decode.ts'

/** Fixed curve storage and bounded copies of the profile's CLUT data. */
export const jpegXlProfileWorkingBytes = (frame: Readonly<JpegXlFrameStructure>): number => {
  if (Math.max(frame.bitDepth, frame.alphaBitDepth ?? 0) <= 8) return 256
  return frame.colorChannels === 1 ? 131_072 : 3_149_824 + (frame.iccProfile?.byteLength ?? 0) * 2
}

/** Convert gray RGBA or integer 16-bit rows without an 8-bit color intermediate. */
export const createJpegXlProfileDecoder = (
  decoder: ImageDecoder,
  frame: Readonly<JpegXlFrameStructure>,
  limits: Readonly<ImageLimits>,
): ImageDecoder => {
  const profile = frame.iccProfile
  if (!profile) throw invalidInput('JPEG XL profile conversion requires an ICC profile')
  const high = decoder.pixelFormat.endsWith('16')
  if (
    decoder.pixelFormat !== 'gray16' &&
    decoder.pixelFormat !== 'rgb16' &&
    decoder.pixelFormat !== 'rgba16' &&
    !(frame.colorChannels === 1 && decoder.pixelFormat === 'rgba8')
  )
    throw unsupportedOperation('JPEG XL profile conversion requires supported integer rows')
  if (jpegXlProfileWorkingBytes(frame) > limits.maxDecodedBytes)
    throw limitExceeded('JPEG XL profile tables exceed maxDecodedBytes')
  const gray8 = frame.colorChannels === 1 && !high ? parseGrayIccTransform(profile) : undefined
  const gray16 = frame.colorChannels === 1 && high ? parseGrayIccTransform16(profile) : undefined
  const rgb16 = frame.colorChannels === 3 ? parseRgbIccTransform16(profile) : undefined
  const channels = decoder.pixelFormat.startsWith('gray')
    ? 1
    : decoder.pixelFormat.startsWith('rgba')
      ? 4
      : 3
  const colorScale = 65_535 / (2 ** frame.bitDepth - 1)
  const alphaMaximum = 2 ** (frame.alphaBitDepth ?? 16) - 1
  const alphaScale = 65_535 / alphaMaximum
  const associated = frame.alphaAssociated
  const colorSemantics = Object.freeze({
    family: channels === 1 ? ('gray' as const) : ('rgb' as const),
    primaries: 'srgb' as const,
    transfer: Object.freeze({ kind: 'srgb' as const }),
    matrix: 'identity' as const,
    range: 'full' as const,
    alpha: channels === 4 ? ('straight' as const) : ('none' as const),
    provenance: 'decoder-converted' as const,
  })
  const displayRanges = Object.freeze(
    Array.from({ length: channels }, () => Object.freeze({ black: 0, white: high ? 65_535 : 255 })),
  )
  return {
    width: decoder.width,
    height: decoder.height,
    pixelFormat: decoder.pixelFormat,
    colorSemantics,
    capabilities: decoder.capabilities,
    async *decode(request) {
      const scratch = rgb16 ? new Uint16Array(3) : undefined
      for await (const block of decoder.decode(request)) {
        try {
          if (block.format !== decoder.pixelFormat)
            throw invalidInput('JPEG XL profile input format changed')
          const view = new DataView(block.data.buffer, block.data.byteOffset, block.data.byteLength)
          for (let y = 0; y < block.height; y++) {
            throwIfAborted(request?.signal)
            if (gray8) {
              for (let x = 0; x < block.width; x++) {
                const offset = y * block.stride + x * 4
                const value = gray8[block.data[offset] ?? 0] ?? 0
                block.data[offset] = value
                block.data[offset + 1] = value
                block.data[offset + 2] = value
              }
            } else if (gray16) {
              for (let x = 0; x < block.width; x++) {
                const offset = y * block.stride + x * channels * 2
                const alpha = channels === 4 ? view.getUint16(offset + 6, false) : alphaMaximum
                const scale = associated
                  ? alpha === 0
                    ? 0
                    : (colorScale * alphaMaximum) / alpha
                  : colorScale
                const value =
                  associated && alpha === 0
                    ? 0
                    : (gray16[
                        Math.min(65_535, Math.round(view.getUint16(offset, false) * scale))
                      ] ?? 0)
                view.setUint16(offset, value, false)
                if (channels === 4) {
                  view.setUint16(offset + 2, value, false)
                  view.setUint16(offset + 4, value, false)
                  view.setUint16(
                    offset + 6,
                    Math.round(view.getUint16(offset + 6, false) * alphaScale),
                    false,
                  )
                }
              }
            } else if (rgb16 && scratch) {
              for (let x = 0; x < block.width; x++) {
                const offset = y * block.stride + x * channels * 2
                const alpha = channels === 4 ? view.getUint16(offset + 6, false) : alphaMaximum
                const scale = associated
                  ? alpha === 0
                    ? 0
                    : (colorScale * alphaMaximum) / alpha
                  : colorScale
                if (associated && alpha === 0) scratch.fill(0)
                else
                  writeRgbIcc16(
                    rgb16,
                    Math.min(65_535, Math.round(view.getUint16(offset, false) * scale)),
                    Math.min(65_535, Math.round(view.getUint16(offset + 2, false) * scale)),
                    Math.min(65_535, Math.round(view.getUint16(offset + 4, false) * scale)),
                    scratch,
                    0,
                  )
                view.setUint16(offset, scratch[0] ?? 0, false)
                view.setUint16(offset + 2, scratch[1] ?? 0, false)
                view.setUint16(offset + 4, scratch[2] ?? 0, false)
                if (channels === 4)
                  view.setUint16(
                    offset + 6,
                    Math.round(view.getUint16(offset + 6, false) * alphaScale),
                    false,
                  )
              }
            }
          }
          yield Object.freeze({ ...block, colorSemantics, displayRanges })
        } finally {
          block.release?.()
        }
      }
    },
  }
}
