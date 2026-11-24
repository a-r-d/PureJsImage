import type { EncodeRequest, ImageEncoder } from '../codec.ts'
import { ImageError, invalidInput } from '../errors.ts'
import type { PixelBlock } from '../pixel.ts'
import type { ImageSink } from '../sink.ts'
import { createJpegXlFloatEncoder } from './jpegxl-float-encode.ts'
import {
  createJpegXlModularEncoder,
  withCodestreamOrientation,
  withStructuredIccColor,
  withUntaggedJpegXlColorSemantics,
  writesJpegXlIccInModular,
} from './jpegxl-modular-encode.ts'

/** Chooses the JPEG XL writer for one encode request. The codec loads this module on first encode. */
export const createJpegXlCodecEncoder = async (
  sink: ImageSink,
  input: EncodeRequest,
): Promise<ImageEncoder> => {
  const request = withCodestreamOrientation(withUntaggedJpegXlColorSemantics(input))
  const structured = withStructuredIccColor(request)
  const options = request.options
  const lossy =
    typeof options === 'object' && options !== null && 'mode' in options && options.mode === 'lossy'
  const profile = request.metadata?.icc
  const grayProfileOnRgb =
    profile !== undefined &&
    String.fromCharCode(...profile.subarray(16, 20)) === 'GRAY' &&
    (request.pixelFormat === 'rgb8' || request.pixelFormat === 'rgb16')
  // Lossy output cannot embed a profile, and the native writer keeps a gray profile only on gray
  // or gray-alpha samples, so both write the equal structured color instead.
  if (structured && (lossy || grayProfileOnRgb)) return createJpegXlEncoder(sink, structured)
  // A GRAY curve without a structured equal, such as a sampled dot-gain curve on a grayscale
  // JPEG, stays exact in lossless output when the equal RGB channels fold back to gray.
  if (grayProfileOnRgb && !lossy && request.colorSemantics?.icc)
    return grayRowsEncoder(
      await createJpegXlEncoder(sink, {
        ...request,
        pixelFormat: request.pixelFormat === 'rgb16' ? 'gray16' : 'gray8',
        colorSemantics: { ...request.colorSemantics, family: 'gray' },
      }),
      request.pixelFormat === 'rgb16' ? 2 : 1,
    )
  return createJpegXlEncoder(sink, request, structured)
}

/**
 * Writes RGB rows with equal channels as gray rows. Unequal channels cannot carry a GRAY profile,
 * so they fail with INVALID_INPUT. The inner encoder copies each row, so one scratch buffer serves.
 */
const grayRowsEncoder = (inner: ImageEncoder, sampleBytes: 1 | 2): ImageEncoder => {
  const grayFormat = sampleBytes === 2 ? 'gray16' : 'gray8'
  let scratch = new Uint8Array(0)
  return {
    async write(block: PixelBlock): Promise<void> {
      const rowBytes = block.width * sampleBytes
      if (scratch.length < rowBytes * block.height)
        scratch = new Uint8Array(rowBytes * block.height)
      const data = block.data
      for (let y = 0; y < block.height; y++) {
        let source = y * block.stride
        let target = y * rowBytes
        for (let x = 0; x < block.width; x++) {
          for (let byte = 0; byte < sampleBytes; byte++) {
            const value = data[source + byte] ?? 0
            if (
              value !== data[source + sampleBytes + byte] ||
              value !== data[source + 2 * sampleBytes + byte]
            )
              throw invalidInput('A GRAY ICC profile requires equal RGB samples')
            scratch[target + byte] = value
          }
          source += 3 * sampleBytes
          target += sampleBytes
        }
      }
      await inner.write({
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
        stride: rowBytes,
        format: grayFormat,
        data: scratch.subarray(0, rowBytes * block.height),
        ...(block.colorSemantics
          ? { colorSemantics: { ...block.colorSemantics, family: 'gray' as const } }
          : {}),
      })
    },
    finish: () => inner.finish(),
    abort: async (reason: unknown) => inner.abort?.(reason),
  }
}

const createJpegXlEncoder = async (
  sink: ImageSink,
  request: EncodeRequest,
  structured?: EncodeRequest,
): Promise<ImageEncoder> => {
  if (
    request.pixelFormat !== 'grayf32' &&
    request.pixelFormat !== 'rgbf32' &&
    request.pixelFormat !== 'rgbaf32' &&
    request.pixelFormat !== 'gray32' &&
    request.pixelFormat !== 'rgb32' &&
    (request.metadata?.icc === undefined ||
      request.colorSemantics?.icc === undefined ||
      writesJpegXlIccInModular(request))
  )
    return createJpegXlModularEncoder(sink, request)
  try {
    return createJpegXlFloatEncoder(sink, request)
  } catch (error) {
    // Exact profile embedding stages complete native planes. A frame beyond that working budget
    // writes the equal structured color through the bounded encoder instead.
    if (structured && error instanceof ImageError && error.code === 'LIMIT_EXCEEDED')
      return createJpegXlEncoder(sink, structured)
    throw error
  }
}
