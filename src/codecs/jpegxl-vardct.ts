import { throwIfAborted } from '../abort.ts'
import type { DecoderOptions, DecodeRequest, ImageDecoder } from '../codec.ts'
import { invalidInput, unsupportedOperation } from '../errors.ts'
import type { ImageLimits } from '../limits.ts'
import type { PixelBlock } from '../pixel.ts'
import { readExactly, type ImageSource } from '../source.ts'
import { decodeJpegCoefficientImage, type JpegRegion } from './jpeg-baseline.ts'
import type { JpegCoefficientImage } from './jpeg-coefficients.ts'
import { inspectJpegXlSource, JpegXlCodestreamSource } from './jpegxl-container.ts'
import { readJpegXlSourceFrameStructure } from './jpegxl-decode.ts'
import { decodeJpegXlJpegReconstruction } from './jpegxl-jpeg-reconstruct-source.ts'
import { resolveJpegXlLimits } from './jpegxl-limits.ts'
import { decodeJpegXlDct8Section, type JpegXlVarDctPixels } from './jpegxl-vardct-render.ts'

const scaleDenominator = (request: Readonly<DecodeRequest>): 1 | 2 | 4 | 8 => {
  const scale = request.scaleDenominator ?? 1
  if (scale !== 1 && scale !== 2 && scale !== 4 && scale !== 8) {
    throw invalidInput('JPEG XL decode scale denominator must be 1, 2, 4, or 8')
  }
  return scale
}

const decodeRegion = (
  width: number,
  height: number,
  request: Readonly<DecodeRequest>,
): JpegRegion => {
  const x = request.x ?? 0
  const y = request.y ?? 0
  const outputWidth = request.width ?? width - x
  const outputHeight = request.height ?? height - y
  if (
    !Number.isSafeInteger(x) ||
    !Number.isSafeInteger(y) ||
    !Number.isSafeInteger(outputWidth) ||
    !Number.isSafeInteger(outputHeight) ||
    x < 0 ||
    y < 0 ||
    outputWidth < 1 ||
    outputHeight < 1 ||
    x + outputWidth > width ||
    y + outputHeight > height
  ) {
    throw invalidInput('JPEG XL decode region is invalid')
  }
  return Object.freeze({ x, y, width: outputWidth, height: outputHeight })
}

class JpegDerivedJpegXlDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat = 'rgb8' as const
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: true,
    progressive: false,
  })
  readonly #image: JpegCoefficientImage
  readonly #signal: AbortSignal | undefined

  constructor(image: JpegCoefficientImage, signal: AbortSignal | undefined) {
    this.width = image.width
    this.height = image.height
    this.#image = image
    this.#signal = signal
  }

  async *decode(request: Readonly<DecodeRequest> = {}): AsyncGenerator<PixelBlock> {
    const scale = scaleDenominator(request)
    const outputWidth = Math.ceil(this.width / scale)
    const outputHeight = Math.ceil(this.height / scale)
    const region = decodeRegion(outputWidth, outputHeight, request)
    throwIfAborted(this.#signal)
    throwIfAborted(request.signal)
    for await (const block of decodeJpegCoefficientImage(this.#image, region, scale)) {
      throwIfAborted(this.#signal)
      throwIfAborted(request.signal)
      yield block
    }
  }
}

export const createJpegDerivedJpegXlDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
): Promise<ImageDecoder> => {
  const decoded = await decodeJpegXlJpegReconstruction(source, {
    limits,
    ...(options.signal ? { signal: options.signal } : {}),
  })
  return new JpegDerivedJpegXlDecoder(decoded.image, options.signal)
}

class VarDctJpegXlDecoder implements ImageDecoder {
  readonly width: number
  readonly height: number
  readonly pixelFormat: 'gray8' | 'rgb8'
  readonly capabilities = Object.freeze({
    sequential: true,
    regionDecode: true,
    scaledDecode: false,
    progressive: false,
  })
  readonly #pixels: JpegXlVarDctPixels
  readonly #signal: AbortSignal | undefined

  constructor(pixels: JpegXlVarDctPixels, signal: AbortSignal | undefined) {
    this.width = pixels.width
    this.height = pixels.height
    this.pixelFormat = pixels.format
    this.#pixels = pixels
    this.#signal = signal
  }

  async *decode(request: Readonly<DecodeRequest> = {}): AsyncGenerator<PixelBlock> {
    if ((request.scaleDenominator ?? 1) !== 1) {
      throw unsupportedOperation('JPEG XL VarDCT scaled decode is not supported yet')
    }
    const region = decodeRegion(this.width, this.height, request)
    throwIfAborted(this.#signal)
    throwIfAborted(request.signal)
    const channels = this.pixelFormat === 'gray8' ? 1 : 3
    const stride = region.width * channels
    const data = new Uint8Array(stride * region.height)
    const sourceStride = this.width * channels
    for (let row = 0; row < region.height; row += 1) {
      const sourceOffset = (region.y + row) * sourceStride + region.x * channels
      data.set(this.#pixels.data.subarray(sourceOffset, sourceOffset + stride), row * stride)
    }
    yield Object.freeze({
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      stride,
      format: this.pixelFormat,
      data,
    })
  }
}

export const createJpegXlVarDctDecoder = async (
  source: ImageSource,
  limits: ImageLimits,
  options: Readonly<DecoderOptions> = {},
): Promise<ImageDecoder> => {
  const jpegXlLimits = resolveJpegXlLimits()
  const structure = await inspectJpegXlSource(source, jpegXlLimits, options)
  if (structure.metadataBoxes.some(({ type }) => type === 'jbrd')) {
    return createJpegDerivedJpegXlDecoder(source, limits, options)
  }
  const logical = new JpegXlCodestreamSource(source, structure)
  const frame = await readJpegXlSourceFrameStructure(
    logical,
    limits,
    options,
    jpegXlLimits.maxHeaderBytes,
  )
  const section = frame.sections[0]
  if (!section) throw invalidInput('JPEG XL VarDCT section is missing')
  const data = await readExactly(logical, section.offset, section.length, options)
  return new VarDctJpegXlDecoder(
    decodeJpegXlDct8Section(data, frame, limits),
    options.signal,
  )
}
